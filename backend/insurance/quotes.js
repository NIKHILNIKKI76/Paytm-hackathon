import sampleQuotes from './synthetic-quotes.json' with { type: 'json' };

export function demoQuotes({ vehicle, cover, termMonths, now }) {
  if (cover !== 'comprehensive' || termMonths !== 12) return [];
  return sampleQuotes.map((quote) => ({
    ...structuredClone(quote), cover, termMonths, startDate: vehicle.startDate ?? now.slice(0, 10),
    expiresAt: new Date(Date.parse(now) + 30 * 60_000).toISOString(),
    currency: 'INR', ncb: null, garages: null, addOnLimits: null, termsUrl: null,
    conditions: [], eligibility: 'eligible', source: 'sample',
  }));
}

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const known = (value) => value !== null && value !== undefined;
const labels = {
  zero_depreciation: 'zero depreciation',
  roadside_assistance: 'roadside assistance',
  engine_protection: 'engine protection',
  return_to_invoice: 'return to invoice',
};

function deductible(quote) {
  if (!known(quote.compulsoryDeductible) || !known(quote.voluntaryDeductible)) return null;
  return quote.compulsoryDeductible + quote.voluntaryDeductible;
}

function evaluate(quote, preferences, now) {
  const misses = [];
  const verify = [];
  const matches = [];
  if (quote.eligibility === 'ineligible') misses.push('The insurer marked this quote ineligible.');
  else if (quote.eligibility !== 'eligible') verify.push('Confirm insurer eligibility.');
  if (!Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= Date.parse(now)) {
    verify.push('Refresh this quote to confirm validity.');
  }

  if (!known(quote.premium)) verify.push('Confirm the total payable premium.');
  else if (preferences.budget && preferences.budgetMode) {
    if (quote.premium <= preferences.budget) matches.push(`Within your ${money.format(preferences.budget)} budget.`);
    else if (preferences.budgetMode === 'hard') misses.push(`Over budget by ${money.format(quote.premium - preferences.budget)}.`);
  }
  if (known(preferences.minimumIdv)) {
    if (!known(quote.idv)) verify.push('Confirm the insured value.');
    else if (quote.idv < preferences.minimumIdv) misses.push('Insured value is below your minimum.');
    else matches.push('Meets your minimum insured value.');
  }
  for (const addOn of preferences.requiredAddOns ?? []) {
    if (!Array.isArray(quote.addOns)) verify.push(`Confirm whether ${labels[addOn]} is included.`);
    else if (quote.addOns.includes(addOn)) matches.push(`Includes required ${labels[addOn]}.`);
    else misses.push(`Does not include required ${labels[addOn]}.`);
  }
  if (preferences.garage && Array.isArray(quote.garages) &&
      quote.garages.some((garage) => garage.toLowerCase() === preferences.garage.toLowerCase())) {
    matches.push('Lists your preferred cashless garage.');
  }
  return { quote, misses, verify, matches, deductible: deductible(quote) };
}

function rankValue(row, preferences) {
  const addOns = row.quote.addOns ?? [];
  const preferred = (preferences.preferredAddOns ?? []).filter((addOn) => addOns.includes(addOn)).length;
  const garageMatch = preferences.garage && row.quote.garages?.some(
    (garage) => garage.toLowerCase() === preferences.garage.toLowerCase(),
  ) ? 1 : 0;
  const premium = row.quote.premium ?? Infinity;
  const overBudget = preferences.budgetMode === 'flexible' && premium > preferences.budget ? 1 : 0;
  if (preferences.priority === 'price') return [premium, -preferred, -garageMatch];
  if (preferences.priority === 'repair_cost') {
    return [overBudget, row.deductible ?? Infinity, -preferred, -garageMatch, premium];
  }
  return [overBudget, -preferred, -garageMatch];
}

export function differences(base, quote) {
  const fields = ['premium', 'idv', 'compulsoryDeductible', 'voluntaryDeductible'];
  const changes = Object.fromEntries(fields.map((field) => [
    field, known(base[field]) && known(quote[field]) ? quote[field] - base[field] : null,
  ]));
  changes.cover = base.cover && quote.cover ? { from: base.cover, to: quote.cover } : null;
  changes.addOns = Array.isArray(base.addOns) && Array.isArray(quote.addOns) ? {
    added: quote.addOns.filter((addOn) => !base.addOns.includes(addOn)),
    removed: base.addOns.filter((addOn) => !quote.addOns.includes(addOn)),
  } : null;
  return changes;
}

export function compareQuotes(quotes, preferences, policy, now) {
  const rows = quotes.map((quote) => evaluate(quote, preferences, now));
  const confirmed = rows.filter((row) => !row.misses.length && !row.verify.length);
  const hasPriority = preferences.priority === 'price' || preferences.priority === 'repair_cost';
  const hasPreference = hasPriority || rows.some((row) => row.matches.length) ||
    preferences.preferredAddOns?.length || preferences.budgetMode === 'flexible' && preferences.budget;
  const neutral = !hasPreference || preferences.priority === 'compare';
  const compare = (a, b) => {
    const left = rankValue(a, preferences);
    const right = rankValue(b, preferences);
    for (const [index, value] of left.entries()) {
      if (value !== right[index]) return value < right[index] ? -1 : 1;
    }
    return 0;
  };
  if (!neutral) confirmed.sort(compare);
  const best = !neutral && confirmed[0] &&
    (confirmed.length === 1 || compare(confirmed[0], confirmed[1]) !== 0) ? confirmed[0] : null;
  const baseline = best ?? confirmed[0] ?? rows[0];
  return {
    status: !rows.length ? 'no_quotes' : !confirmed.length ? 'no_confirmed_match' : best ? 'recommended' : 'compare',
    recommendedQuoteId: best?.quote.id ?? null,
    comparisonBaselineQuoteId: baseline?.quote.id ?? null,
    quotes: [...confirmed, ...rows.filter((row) => row.misses.length || row.verify.length)].map((row) => {
      const rank = neutral || row.misses.length || row.verify.length ? null
        : 1 + confirmed.filter((other) => compare(other, row) < 0).length;
      const reasons = [...row.matches];
      if (row === best && preferences.priority === 'price' && known(row.quote.premium)) {
        reasons.push('Lowest upfront premium among confirmed matches.');
      }
      if (row === best && preferences.priority === 'repair_cost' && known(row.deductible)) {
        reasons.push(`Combined deductible is ${money.format(row.deductible)} on claims where both deductibles apply.`);
      }
      const checks = ['idv', 'compulsoryDeductible', 'voluntaryDeductible', 'addOnLimits', 'ncb', 'garages']
        .filter((field) => !known(row.quote[field]));
      if (!known(row.quote.addOns)) checks.push('addOns');
      return {
        ...row, rank, reasons, checkInsurerTerms: checks,
        vsQuote: baseline === row ? null : differences(baseline.quote, row.quote),
        vsCurrentPolicy: Object.keys(policy).length ? differences(policy, row.quote) : null,
      };
    }),
  };
}
