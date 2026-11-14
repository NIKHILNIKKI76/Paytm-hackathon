const find = (selector) => document.querySelector(selector);
const carForm = find('#car-form');
const coverForm = find('#cover-form');
const preferenceForm = find('#preferences-form');
const feedback = find('#feedback');
const base = '/insurance/journeys';
const zeroDep = 'zero_depreciation';
const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const labels = {
  comprehensive: 'Comprehensive', third_party: 'Third-party', own_damage: 'Own damage',
  zero_depreciation: 'Zero depreciation', roadside_assistance: 'Roadside assistance',
  engine_protection: 'Engine protection', return_to_invoice: 'Return to invoice',
  price: 'Lower upfront price', repair_cost: 'Lower repair contributions', compare: 'Show both',
};
let journey;
let user;
let token = localStorage.getItem('insurance-demo-token');
let result;
let priceSort = false;
let comparePolicy = false;
let busy = false;
let vehicleSuggestion;

function notify(message = '', error = false) {
  feedback.textContent = message;
  feedback.classList.toggle('error', error);
}

function run(callback) {
  return async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const button = event.submitter ?? (event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null);
    if (button) button.disabled = true;
    notify();
    try {
      await callback(event);
    } catch (error) {
      notify(error.message, true);
    } finally {
      if (button) button.disabled = false;
      busy = false;
    }
  };
}

async function api(path, { method = 'GET', data, file } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  if (file) {
    headers['Content-Type'] = file.type;
    headers['X-Document-Consent'] = 'true';
  }
  const response = await fetch(base + path, { method, headers, body: file ?? JSON.stringify(data) });
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.error), { status: response.status });
  return payload;
}

const route = (suffix = '') => '/' + journey.id + suffix;
const confirmed = () => Object.fromEntries(Object.entries(journey.preferences).map(([key, field]) => [key, field.value]));

function step(name) {
  const sections = ['car', 'cover', 'quotes'];
  const steps = document.querySelectorAll('.steps li');
  sections.forEach((id, i) => {
    find('#' + id).hidden = name !== id;
    if (name === id) steps[i].setAttribute('aria-current', 'step');
    else steps[i].removeAttribute('aria-current');
  });
}

function populate(form, values) {
  for (const [key, value] of Object.entries(values)) {
    const control = form.elements.namedItem(key);
    if (control && value !== undefined) control.value = value ?? '';
  }
}

function currentAddOns() {
  return [...coverForm.querySelectorAll('[name=addOns]:checked')].map((control) => control.value);
}

function fillPolicy(policy) {
  populate(coverForm, policy);
  if (Array.isArray(policy.addOns)) {
    for (const control of coverForm.querySelectorAll('[name=addOns]')) control.checked = policy.addOns.includes(control.value);
  }
  find('#keep-cover').hidden = !currentAddOns().includes(zeroDep);
}

function keepValue(preferences) {
  if (preferences.requiredAddOns?.includes(zeroDep)) return 'required';
  if (preferences.preferredAddOns?.includes(zeroDep)) return 'preferred';
  return preferences.requiredAddOns || preferences.preferredAddOns ? 'optional' : '';
}

function addOnPreference(prefs, keep) {
  const requiredAddOns = (prefs.requiredAddOns ?? []).filter((key) => key !== zeroDep);
  const preferredAddOns = (prefs.preferredAddOns ?? []).filter((key) => key !== zeroDep);
  if (keep === 'required') requiredAddOns.push(zeroDep);
  if (keep === 'preferred') preferredAddOns.push(zeroDep);
  return { requiredAddOns, preferredAddOns };
}

async function start(vehicle, policy) {
  const data = { vehicle, policy, ...(token ? { customerToken: token } : {}) };
  try {
    journey = await api('', { method: 'POST', data });
  } catch (error) {
    if (error.status !== 404 || !token) throw error;
    token = null;
    delete data.customerToken;
    journey = await api('', { method: 'POST', data });
  }
  if (journey.customerToken) {
    token = journey.customerToken;
    localStorage.setItem('insurance-demo-token', token);
  }
  renderJourney();
}

function renderJourney() {
  coverForm.reset();
  find('#upload-form').reset();
  vehicleSuggestion = null;
  find('#vehicle-suggestion').hidden = true;
  fillPolicy(journey.policy);
  populate(coverForm, { keep: keepValue(confirmed()) });
  priceSort = false;
  comparePolicy = false;
  find('#policy-comparison').setAttribute('aria-pressed', 'false');
  step('cover');
}

function patch(data) {
  return api(route(), { method: 'PATCH', data }).then((value) => { journey = value; });
}

function node(tag, content, className) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  if (className) element.className = className;
  return element;
}

function button(label, callback, className) {
  const element = node('button', label, className);
  element.type = 'button';
  element.addEventListener('click', run(callback));
  return element;
}

function money(value) {
  return value == null ? 'Check insurer terms' : currency.format(value);
}

function describeChanges(change, includePremium = true) {
  const messages = [];
  const amounts = { premium: 'upfront premium', idv: 'insured value', compulsoryDeductible: 'compulsory deductible', voluntaryDeductible: 'voluntary deductible' };
  for (const [key, label] of Object.entries(amounts)) {
    if (change[key] && (includePremium || key !== 'premium')) {
      messages.push(`${money(Math.abs(change[key]))} ${change[key] < 0 ? 'lower' : 'higher'} ${label}`);
    }
  }
  if (change.cover && change.cover.from !== change.cover.to) messages.push(`Changes to ${labels[change.cover.to]} cover`);
  for (const key of change.addOns?.added ?? []) messages.push(`Adds ${labels[key] ?? key}`);
  for (const key of change.addOns?.removed ?? []) messages.push(`Drops ${labels[key] ?? key}`);
  return messages;
}

function renderQuotes() {
  const list = find('#quote-list');
  list.replaceChildren();
  find('#selection').hidden = !journey.selectedQuoteId;
  find('#selection').textContent = journey.selectedQuoteId ? 'Quote selected for this demo.' : '';
  if (result.status === 'no_quotes') list.append(node('p', 'This demo has one-year comprehensive quotes only.', 'panel'));
  if (result.status === 'no_confirmed_match') list.append(node('p', 'No quote meets all confirmed requirements. Review the reasons below or edit your preferences.', 'panel'));
  const rows = priceSort ? [...result.quotes].sort((a, b) => (a.quote.premium ?? Infinity) - (b.quote.premium ?? Infinity)) : result.quotes;
  for (const row of rows) {
    const { quote } = row;
    const best = result.recommendedQuoteId === quote.id;
    const card = node('article', undefined, best ? 'quote best' : 'quote');
    if (best) card.append(node('div', 'Best match for your preferences', 'tag'));
    const heading = node('div', undefined, 'heading');
    heading.append(node('h3', `${quote.insurer} · ${quote.product}`), node('span', money(quote.premium), 'price'));
    card.append(heading, node('p', `${labels[quote.cover]} · ${quote.termMonths} months`));
    const details = node('dl');
    for (const [key, value] of [
      ['Insured value (IDV)', money(quote.idv)], ['Compulsory deductible', money(quote.compulsoryDeductible)],
      ['Voluntary deductible', money(quote.voluntaryDeductible)],
      ['Included add-ons', quote.addOns ? quote.addOns.map((key) => labels[key] ?? key).join(', ') || 'None' : 'Check insurer terms'],
    ]) {
      const item = node('div');
      item.append(node('dt', key), node('dd', value));
      details.append(item);
    }
    card.append(details);
    for (const reason of [...row.reasons, ...row.misses, ...row.verify, ...(quote.conditions ?? [])]) card.append(node('p', reason));
    const changes = comparePolicy ? row.vsCurrentPolicy : row.vsQuote;
    if (changes) {
      const summary = describeChanges(changes);
      card.append(node('p', summary.length ? `${comparePolicy ? 'Versus current policy' : 'Versus comparison quote'}: ${summary.join(' · ')}` : 'No differences in the confirmed fields shown.'));
    } else if (comparePolicy) card.append(node('p', 'Enter current policy details to compare.'));
    if (!row.misses.length && !row.verify.length) {
      card.append(button(journey.selectedQuoteId === quote.id ? 'Selected' : 'Select quote', async () => {
        const selection = await api(route('/selection'), { method: 'POST', data: { quoteId: quote.id } });
        journey.selectedQuoteId = selection.selectedQuoteId;
        renderQuotes();
        find('#selection').scrollIntoView({ block: 'nearest' });
      }, best ? '' : 'secondary'));
    }
    list.append(card);
  }
}

function renderPreferences() {
  const prefs = confirmed();
  preferenceForm.reset();
  populate(preferenceForm, { ...prefs, keep: keepValue(prefs) });
  const applied = [
    prefs.budget && prefs.budgetMode && `${money(prefs.budget)} ${prefs.budgetMode === 'hard' ? 'cap' : 'budget'}`,
    labels[prefs.priority],
    ...(prefs.requiredAddOns ?? []).map((key) => `${labels[key] ?? key} required`),
    ...(prefs.preferredAddOns ?? []).map((key) => `${labels[key] ?? key} preferred`),
    prefs.minimumIdv != null && `Minimum IDV ${money(prefs.minimumIdv)}`,
    prefs.garage,
  ].filter(Boolean);
  find('#preferences-summary').textContent = applied.join(' · ') || 'None confirmed';
  const space = find('#inline-prompt');
  space.replaceChildren();
  if (!journey.prompts.some((prompt) => prompt.id === 'price_or_repairs')) return;
  const panel = node('div', undefined, 'panel');
  panel.append(node('strong', 'What matters more for this renewal?'));
  const actions = node('div', undefined, 'actions');
  for (const [priority, label] of [['price', 'Lower upfront price'], ['repair_cost', 'Lower repair contribution'], ['compare', 'Show both']]) {
    actions.append(button(label, async () => {
      await patch({ preferences: { priority } });
      priceSort = false;
      await showQuotes();
    }, 'secondary'));
  }
  actions.append(button('Skip', async () => {
    journey = await api(route('/events'), { method: 'POST', data: { type: 'skip_prompt', promptId: 'price_or_repairs' } });
    renderPreferences();
  }, 'link'));
  panel.append(actions);
  space.append(panel);
}

async function showQuotes() {
  result = await api(route('/quotes'));
  find('#quote-summary').textContent = `${journey.vehicle.registration ?? journey.vehicle.model} · ${labels[result.requestedCover]} · ${result.requestedTermMonths} months`;
  renderPreferences();
  renderQuotes();
  step('quotes');
}

find('#manual').addEventListener('click', () => {
  const manual = find('#manual-fields');
  manual.hidden = !manual.hidden;
  manual.disabled = manual.hidden;
  const registration = carForm.elements.registration;
  registration.disabled = !manual.hidden;
  find('#registration-fields').hidden = !manual.hidden;
  find('#manual').textContent = manual.hidden ? 'Enter details manually' : 'Use registration number';
});

carForm.addEventListener('submit', run(async () => {
  const vehicle = Object.fromEntries(new FormData(carForm));
  if (vehicle.year) vehicle.year = Number(vehicle.year);
  await start(vehicle);
}));

find('#sample').addEventListener('click', run(() => start({ registration: 'DL01AB1234' }, {
  insurer: 'Sample previous insurer', cover: 'comprehensive', idv: 510000,
  compulsoryDeductible: 1000, voluntaryDeductible: 0, addOns: [zeroDep], priorNcb: 0,
})));

coverForm.addEventListener('change', ({ target }) => {
  if (target.name === 'addOns') find('#keep-cover').hidden = !currentAddOns().includes(zeroDep);
});
find('#back-car').addEventListener('click', () => step('car'));
find('#back-cover').addEventListener('click', () => step('cover'));

const suggestion = node('label', undefined, 'check');
suggestion.id = 'vehicle-suggestion';
suggestion.hidden = true;
const useSuggestedVehicle = node('input');
useSuggestedVehicle.type = 'checkbox';
const suggestionLabel = node('span');
suggestion.append(useSuggestedVehicle, suggestionLabel);
coverForm.prepend(suggestion);

find('#upload-form').addEventListener('submit', run(async () => {
  const file = new FormData(find('#upload-form')).get('file');
  const extracted = await api(route('/policy-extraction'), { method: 'POST', file });
  fillPolicy(extracted.suggestedPolicy ?? {});
  vehicleSuggestion = extracted.suggestedVehicle;
  suggestion.hidden = !Object.keys(vehicleSuggestion ?? {}).length;
  useSuggestedVehicle.checked = false;
  suggestionLabel.textContent = 'Use extracted vehicle details: ' + Object.values(vehicleSuggestion ?? {}).join(' · ');
  notify('Review the extracted details before continuing.');
}));

coverForm.addEventListener('submit', run(async () => {
  const data = new FormData(coverForm);
  const policy = Object.fromEntries(['insurer','expiry','cover','idv','compulsoryDeductible','voluntaryDeductible','claimedSinceIssuance','priorNcb'].map((key) => {
    const value = data.get(key);
    if (!value) return [key, null];
    if (key === 'claimedSinceIssuance') return [key, value === 'true'];
    return [key, ['idv','compulsoryDeductible','voluntaryDeductible','priorNcb'].includes(key) ? Number(value) : value];
  }));
  policy.addOns = data.getAll('addOns').length || Array.isArray(journey.policy.addOns) || !suggestion.hidden
    ? data.getAll('addOns') : null;
  const input = { policy };
  const keep = data.get('keep');
  if (keep && !find('#keep-cover').hidden) input.preferences = addOnPreference(confirmed(), keep);
  if (!suggestion.hidden && useSuggestedVehicle.checked) input.vehicle = vehicleSuggestion;
  await patch(input);
  await showQuotes();
}));

preferenceForm.addEventListener('submit', run(async () => {
  const values = Object.fromEntries(new FormData(preferenceForm));
  if (Boolean(values.budget) !== Boolean(values.budgetMode)) throw new Error('Set both the budget and its type, or clear both.');
  const preferences = {
    budget: values.budget ? Number(values.budget) : null, budgetMode: values.budgetMode || null,
    priority: values.priority || null, minimumIdv: values.minimumIdv ? Number(values.minimumIdv) : null,
    garage: values.garage || null,
  };
  if (values.keep !== keepValue(confirmed())) Object.assign(preferences, addOnPreference(confirmed(), values.keep));
  await patch({ preferences });
  priceSort = false;
  await showQuotes();
}));

find('#ai-form').addEventListener('submit', run(async () => {
  const text = new FormData(find('#ai-form')).get('text');
  const { suggestedPreferences: prefs } = await api(route('/preference-extraction'), { method: 'POST', data: { text } });
  populate(preferenceForm, prefs);
  if (keepValue(prefs)) populate(preferenceForm, { keep: keepValue(prefs) });
  notify('Review the suggested fields and select Update quotes to confirm them.');
}));

find('#sort').addEventListener('click', run(async () => {
  journey = await api(route('/events'), { method: 'POST', data: { type: 'sort_by_price' } });
  priceSort = true;
  renderPreferences();
  renderQuotes();
}));
find('#policy-comparison').addEventListener('click', (event) => {
  comparePolicy = !comparePolicy;
  event.currentTarget.setAttribute('aria-pressed', String(comparePolicy));
  renderQuotes();
});
find('#save').addEventListener('click', run(async () => {
  const keys = Object.keys(confirmed()).filter((key) => !['budget', 'budgetMode'].includes(key));
  if (!keys.length) throw new Error('Confirm a reusable preference before saving.');
  await api(route('/saved-preferences'), { method: 'PUT', data: { keys } });
  notify('Confirmed preferences saved for the next renewal on this car.');
}));
find('#clear-saved').addEventListener('click', run(async () => {
  await api(route('/saved-preferences'), { method: 'DELETE' });
  notify('Saved preferences cleared for future visits.');
}));


const accountDialog = find('#account-dialog');
const chatDialog = find('#chat-dialog');
const accountForm = find('#account-form');
const chatForm = find('#chat-form');
let signup = false;
let returnToChat = false;

async function accountApi(action, method = 'GET', data) {
  const response = await fetch('/insurance/' + action, {
    method,
    ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error);
  return payload;
}

function dialogAction(feedbackId, callback) {
  return async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const output = find(feedbackId);
    const control = event.submitter ?? (event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null);
    if (control) control.disabled = true;
    output.textContent = '';
    try {
      await callback(event);
    } catch (error) {
      output.textContent = error.message;
    } finally {
      if (control) control.disabled = false;
      busy = false;
    }
  };
}

function renderAccount() {
  find('#account-title').textContent = user ? 'Your account' : signup ? 'Create account' : 'Sign in';
  find('#account-button').textContent = user ? 'Your account' : 'Sign in';
  find('#account-email').textContent = user?.email ?? '';
  accountForm.hidden = Boolean(user);
  find('#account-profile').hidden = !user;
  find('#account-submit').textContent = signup ? 'Create account' : 'Sign in';
  find('#account-switch').textContent = signup ? 'Back to sign in' : 'Create account';
  accountForm.elements.password.autocomplete = signup ? 'new-password' : 'current-password';
  find('#chat-content').hidden = !user;
  find('#chat-gate').hidden = Boolean(user);
}

async function restoreAccount() {
  const profile = await accountApi('account');
  user = profile.user;
  if (user) {
    journey = profile.journey;
    if (journey) renderJourney();
    else step('car');
  }
  renderAccount();
}

function renderMessages(messages) {
  const log = find('#messages');
  log.replaceChildren();
  for (const item of messages) {
    const entry = node('div', undefined, 'message ' + item.role);
    entry.append(node('strong', item.role === 'user' ? 'You' : 'Insurance assistant'), node('p', item.text));
    log.append(entry);
  }
  log.scrollTop = log.scrollHeight;
}

async function showChat() {
  find('#chat-feedback').textContent = '';
  chatDialog.showModal();
  if (user) renderMessages((await accountApi('chat')).messages);
}

find('#open-chat').addEventListener('click', dialogAction('#chat-feedback', showChat));
find('#close-chat').addEventListener('click', () => chatDialog.close());
find('#close-account').addEventListener('click', () => accountDialog.close());
find('#account-button').addEventListener('click', () => {
  returnToChat = false;
  find('#account-feedback').textContent = '';
  accountDialog.showModal();
});
find('#chat-signin').addEventListener('click', () => {
  chatDialog.close();
  returnToChat = true;
  find('#account-feedback').textContent = '';
  accountDialog.showModal();
});
find('#account-switch').addEventListener('click', () => {
  signup = !signup;
  accountForm.elements.password.value = '';
  find('#account-feedback').textContent = '';
  renderAccount();
});
accountForm.addEventListener('submit', dialogAction('#account-feedback', async () => {
  const guest = !user && journey;
  const credentials = Object.fromEntries(new FormData(accountForm));
  await accountApi(signup ? 'signup' : 'signin', 'POST', credentials);
  accountForm.reset();
  await restoreAccount();
  if (guest && !journey) {
    await start(guest.vehicle, guest.policy);
    const preferences = Object.fromEntries(Object.entries(guest.preferences).map(([key, field]) => [key, field.value]));
    if (Object.keys(preferences).length) {
      await patch({ preferences });
      renderJourney();
    }
  }
  accountDialog.close();
  if (returnToChat) await showChat();
}));
find('#signout').addEventListener('click', dialogAction('#account-feedback', async () => {
  await accountApi('signout', 'POST');
  user = null;
  journey = null;
  result = null;
  token = null;
  localStorage.removeItem('insurance-demo-token');
  carForm.reset();
  coverForm.reset();
  chatForm.reset();
  renderMessages([]);
  find('#quote-list').replaceChildren();
  renderAccount();
  step('car');
  accountDialog.close();
}));
async function sendMessage(message) {
  const { messages } = await accountApi('chat', 'POST', { message });
  renderMessages(messages);
  chatForm.reset();
  chatForm.elements.message.focus();
}
chatForm.addEventListener('submit', dialogAction('#chat-feedback', () => sendMessage(chatForm.elements.message.value)));
for (const prompt of find('#chat-questions').querySelectorAll('button')) {
  prompt.addEventListener('click', dialogAction('#chat-feedback', () => sendMessage(prompt.textContent)));
}
find('#clear-chat').addEventListener('click', dialogAction('#chat-feedback', async () => {
  renderMessages((await accountApi('chat', 'DELETE')).messages);
  find('#chat-feedback').textContent = 'Chat history cleared.';
}));

busy = true;
restoreAccount().catch(() => notify('Could not load your account. You can try signing in again.', true))
  .finally(() => { busy = false; });
