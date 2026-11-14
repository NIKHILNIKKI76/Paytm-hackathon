import { compareQuotes } from './quotes.js';

const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const money = (value) => value == null ? 'unconfirmed' : currency.format(value);
const readable = (value) => value.replaceAll('_', ' ');

export function replyToCustomer(message, journey, now, history = []) {
  const question = message.trim().toLowerCase();
  const earlierQuestion = history.findLast((entry) => entry.role === 'user')?.text.toLowerCase() ?? '';
  const isFollowUp = /^(why|how much|what about it|tell me more)[?!.]*$/.test(question);
  const search = isFollowUp ? earlierQuestion + ' ' + question : question;
  const preferences = Object.fromEntries(Object.entries(journey?.preferences ?? {}).map(([key, field]) => [key, field.value]));
  if (/\b(cover|pay|claim|approve)\b/.test(search) && /\b(will|guarantee|approved)\b/.test(search)) {
    return 'The insurer decides claim outcomes using your issued policy. I can explain the details provided in this renewal and compare the sample quotes.';
  }
  if (/\b(quote|quotes|compare|cheaper|recommend|best|selected|premium)\b/.test(search)) {
    const quotes = journey?.quoteSet?.quotes ?? [];
    if (!quotes.length || journey.quoteSet.expiresAt <= now) return 'Open the Quotes step to load a current comparison. I can then explain the results using your confirmed preferences.';
    const result = compareQuotes(quotes, preferences, journey.policy, now);
    const selected = quotes.find((item) => item.id === journey.selectedQuoteId);
    if (/\bselected\b/.test(search) && selected) return `You selected ${selected.insurer} · ${selected.product} at ${money(selected.premium)} for this demo.`;
    const best = result.quotes.find((item) => item.quote.id === result.recommendedQuoteId);
    const intro = best ? `${best.quote.insurer} · ${best.quote.product} is the best match. ${best.reasons.join(' ')}`
      : result.status === 'no_confirmed_match' ? 'No quote meets all confirmed requirements.' : 'Here are the current sample quotes.';
    const descriptions = result.quotes.map(({quote, deductible, misses, verify}) =>
      `${quote.insurer} costs ${money(quote.premium)} with ${money(quote.idv)} insured value and ${money(deductible)} combined deductible where both apply. ${(misses.concat(verify)).join(' ')}`.trim());
    return [intro.trim(), ...descriptions].join('\n');
  }
  if (/\b(preference|preferences|budget|priority|remember|must have)\b/.test(search)) {
    const parts = [];
    if (preferences.budget != null) parts.push(`Budget ${money(preferences.budget)}${preferences.budgetMode ? ` (${preferences.budgetMode})` : ''}`);
    if (preferences.priority) parts.push(`Priority ${readable(preferences.priority)}`);
    if (preferences.cover) parts.push(`Requested cover ${readable(preferences.cover)}`);
    if (preferences.requiredAddOns?.length) parts.push(`Required add-ons ${preferences.requiredAddOns.map(readable).join(', ')}`);
    if (preferences.preferredAddOns?.length) parts.push(`Preferred add-ons ${preferences.preferredAddOns.map(readable).join(', ')}`);
    if (preferences.minimumIdv != null) parts.push(`Minimum insured value ${money(preferences.minimumIdv)}`);
    if (preferences.garage) parts.push(`Preferred garage ${preferences.garage}`);
    return parts.length ? parts.join('\n') + '\nUse Preferences used on the Quotes screen to make changes.' : 'There are no confirmed preferences yet. You can confirm them as you go or edit them on the Quotes screen.';
  }
  if (/\b(policy|car|vehicle|cover|idv|deductible|depreciation|expires|expiry)\b/.test(search)) {
    if (!journey) return 'Start a renewal to share your car and current policy details with this chat.';
    const { vehicle, policy } = journey;
    const details = [
      vehicle.registration ?? [vehicle.make, vehicle.model].filter(Boolean).join(' '),
      policy.insurer, policy.cover && readable(policy.cover), policy.expiry && `expires ${policy.expiry}`,
    ].filter(Boolean);
    const addOns = policy.addOns?.map(readable).join(', ');
    return `${details.join(' · ') || 'Your current cover details are still unconfirmed'}. Insured value: ${money(policy.idv)}. Compulsory deductible: ${money(policy.compulsoryDeductible)}. Voluntary deductible: ${money(policy.voluntaryDeductible)}. Add-ons: ${addOns || (Array.isArray(policy.addOns) ? 'none recorded' : 'unconfirmed')}.`;
  }
  return 'Ask me about your current policy, the preferences used in your renewal, or why a quote matches. I use the details you’ve confirmed in this demo.';
}
