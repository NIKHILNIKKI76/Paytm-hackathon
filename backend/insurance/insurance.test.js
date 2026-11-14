import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createInsuranceServer } from './server.js';
import { createAssistant, policyText } from './assistant.js';
import { compareQuotes, demoQuotes } from './quotes.js';

const now = '2026-11-14T10:00:00.000Z';
const offers = () => demoQuotes({ vehicle: {}, cover: 'comprehensive', termMonths: 12, now });

test('required addon, budget, price priority and no-match scenarios follow insurance.md', () => {
  const prefs = { budget: 10000, budgetMode: 'hard', requiredAddOns: ['zero_depreciation'], priority: 'repair_cost' };
  assert.equal(compareQuotes(offers(), prefs, {}, now).recommendedQuoteId, 'quote-a');
  const price = compareQuotes(offers(), { ...prefs, requiredAddOns: [], priority: 'price' }, {}, now);
  assert.equal(price.recommendedQuoteId, 'quote-b');
  assert.equal(price.quotes.find((row) => row.quote.id === 'quote-a').vsQuote.premium, 900);
  assert.equal(compareQuotes(offers(), { ...prefs, budget: 9000 }, {}, now).status, 'no_confirmed_match');
  assert.equal(compareQuotes(offers(), {}, {}, now).recommendedQuoteId, null);
});

test('unknown required quote terms cannot qualify for recommendation', () => {
  const quotes = offers().slice(0, 2);
  quotes[0].addOns = null;
  const result = compareQuotes(quotes, { requiredAddOns: ['zero_depreciation'] }, {}, now);
  assert.equal(result.status, 'no_confirmed_match');
  assert.ok(result.quotes[0].verify.length);
});

test('five synthetic providers receive preference ranks and switch leaders with priorities', () => {
  const quotes = offers();
  assert.equal(quotes.length, 5);
  const cheap = compareQuotes(quotes, { priority: 'price' }, {}, now);
  assert.equal(cheap.recommendedQuoteId, 'quote-b');
  assert.deepEqual(cheap.quotes.map((row) => row.rank), [1, 2, 3, 4, 5]);
  const repairs = compareQuotes(quotes, { budget: 14000, budgetMode: 'hard', priority: 'repair_cost' }, {}, now);
  assert.equal(repairs.recommendedQuoteId, 'quote-c');
  const strict = compareQuotes(quotes, { budget: 10000, budgetMode: 'hard', priority: 'price', requiredAddOns: ['zero_depreciation'] }, {}, now);
  assert.equal(strict.recommendedQuoteId, 'quote-a');
  assert.equal(strict.quotes[0].rank, 1);
  assert.ok(strict.quotes.slice(1).every((row) => row.rank === null));
  assert.ok(compareQuotes(quotes, {}, {}, now).quotes.every((row) => row.rank === null));
});

async function setup(t, options = {}) {
  const server = createInsuranceServer({ clock: () => now, assistant: null, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  let auth = {};
  const call = async (path, method = 'GET', data, extra = {}) => {
    const response = await fetch(base + path, {
      method, headers: { ...auth, ...(data ? { 'Content-Type': 'application/json' } : {}), ...extra },
      body: data ? JSON.stringify(data) : undefined,
    });
    const value = await response.json();
    return { status: response.status, value, response };
  };
  return { call, base, authenticate: (headers) => { auth = headers; } };
}

test('API journey supports manual input, ranking, selection invalidation, saved preferences and skipped prompts', async (t) => {
  const { call, authenticate } = await setup(t);
  let { value: journey } = await call('/insurance/journeys', 'POST', { vehicle: { registration: 'DL01AB1234' }, policy: { addOns: ['zero_depreciation'] } });
  const token = journey.customerToken;
  authenticate({ Authorization: `Bearer ${token}` });
  const path = `/insurance/journeys/${journey.id}`;
  assert.equal((await call(path + '/quotes')).value.status, 'compare');
  await call(path, 'PATCH', { preferences: { budget: 10000, budgetMode: 'hard', requiredAddOns: ['zero_depreciation'], priority: 'price' } });
  assert.equal((await call(path + '/quotes')).value.recommendedQuoteId, 'quote-a');
  assert.equal((await call(path + '/selection', 'POST', { quoteId: 'quote-a' })).status, 200);
  await call(path, 'PATCH', { preferences: { budget: 9000 } });
  assert.equal((await call(path)).value.selectedQuoteId, null);
  assert.equal((await call(path + '/quotes')).value.status, 'no_confirmed_match');
  assert.equal((await call(path + '/selection', 'POST', { quoteId: 'quote-b' })).status, 409);
  await call(path + '/saved-preferences', 'PUT', { keys: ['requiredAddOns'] });
  journey = (await call('/insurance/journeys', 'POST', { vehicle: { registration: 'DL01AB1234' }, customerToken: token })).value;
  assert.deepEqual(journey.preferences.requiredAddOns.value, ['zero_depreciation']);
  const next = `/insurance/journeys/${journey.id}`;
  await call(next + '/events', 'POST', { type: 'sort_by_price' });
  assert.equal((await call(next)).value.preferences.priority, undefined);
  await call(next + '/events', 'POST', { type: 'skip_prompt', promptId: 'price_or_repairs' });
  assert.ok(!(await call(next)).value.prompts.some((prompt) => prompt.id === 'price_or_repairs'));
  authenticate({});
  assert.equal((await call(next)).status, 404);
});

test('own-damage requires third-party dates; unsupported inputs and missing AI are handled', async (t) => {
  const { call, authenticate } = await setup(t);
  const { value } = await call('/insurance/journeys', 'POST', { vehicle: { registration: 'DL01AB1234' }, policy: { cover: 'own_damage' } });
  authenticate({ Authorization: `Bearer ${value.customerToken}` });
  const path = `/insurance/journeys/${value.id}`;
  assert.equal((await call(path + '/quotes')).status, 409);
  assert.equal((await call(path, 'PATCH', { policy: { thirdPartyExpiry: '2028-01-01' } })).status, 200);
  assert.equal((await call(path + '/quotes')).value.status, 'no_quotes');
  assert.equal((await call(path, 'PATCH', { policy: { expiry: '2026-02-30' } })).status, 400);
  assert.equal((await call(path + '/preference-extraction', 'POST', { text: 'low price' })).status, 503);
});

test('Sarvam suggestions are schema-filtered and chat uses confirmed context without credentials', async () => {
  const requests = [];
  const client = { chat: { completionsV2: async (request) => {
    requests.push(request);
    return { choices: [{ message: { content: requests.length === 1
      ? '{"budget":10000,"budgetMode":"hard","invented":true,"priority":"invalid"}' : 'Sample quote B has a lower premium.' } }] };
  } } };
  const assistant = createAssistant('test-only-not-a-real-key', client);
  assert.deepEqual(await assistant.preferences('Budget 10000'), { budget: 10000, budgetMode: 'hard' });
  assert.match(await assistant.explain('Compare', { preferences: { budget: 10000 } }), /Sample quote B/);
  assert.equal(requests[0].model, 'sarvam-105b');
  assert.ok(!JSON.stringify(requests).includes('test-only-not-a-real-key'));
});

test('policy extraction separates vehicle and policy suggestions and provider failures are safe', async () => {
  const assistant = createAssistant('test-only', { chat: { completionsV2: async () => ({
    choices: [{ message: { content: '```json\n{"registration":"DL 01 AB 1234","insurer":"Sample insurer","idv":510000,"addOns":["zero_depreciation"]}\n```' } }],
  }) } });
  const result = await assistant.policy('Synthetic fixture policy text');
  assert.deepEqual(result.suggestedVehicle, { registration: 'DL01AB1234' });
  assert.deepEqual(result.suggestedPolicy, { insurer: 'Sample insurer', idv: 510000, addOns: ['zero_depreciation'] });
  const failed = createAssistant('test-only', { chat: { completionsV2: async () => { throw new Error('private transport error'); } } });
  await assert.rejects(failed.preferences('test'), /AI extraction is unavailable/);
  await assert.rejects(failed.explain('test', {}), /Sarvam chat is unavailable/);
});

test('signed-in chat requires opt-in for Sarvam and stores provider response', async (t) => {
  let aiCalls = 0;
  const { call, authenticate } = await setup(t, { assistant: { explain: async (_message, context) => {
    aiCalls++;
    assert.equal(context.preferences.priority, 'price');
    assert.equal(context.comparison.recommendedQuoteId, 'quote-b');
    return 'Sarvam test reply using confirmed preferences.';
  } } });
  const signup = await call('/insurance/signup', 'POST', { email: 'demo@example.test', password: 'test-password-123' });
  authenticate({ Cookie: signup.response.headers.get('set-cookie').split(';')[0] });
  const { value: journey } = await call('/insurance/journeys', 'POST', { vehicle: { registration: 'DL01AB1234' } });
  await call(`/insurance/journeys/${journey.id}`, 'PATCH', { preferences: { priority: 'price' } });
  assert.equal((await call('/insurance/chat', 'POST', { message: 'Preferences?' })).value.provider, 'local');
  const reply = await call('/insurance/chat', 'POST', { message: 'Explain my preferences' }, { 'X-AI-Consent': 'true' });
  assert.equal(reply.value.provider, 'sarvam');
  assert.match(reply.value.messages.at(-1).text, /Sarvam test reply/);
  assert.equal(aiCalls, 1);
  assert.equal((await call('/insurance/chat', 'DELETE')).value.messages.length, 0);
});

test('sample guest chat follows changed preferences, rankings and cover without sign-in', async (t) => {
  const contexts = [];
  const { call, authenticate } = await setup(t, { assistant: { explain: async (_message, context) => {
    contexts.push(context);
    return `Current budget: ${context.preferences.budget}; recommendation: ${context.comparison.recommendedQuoteId}`;
  } } });
  const { value: journey } = await call('/insurance/journeys', 'POST', { vehicle: { registration: 'DL01AB1234' }, policy: { cover: 'comprehensive' } });
  authenticate({ Authorization: `Bearer ${journey.customerToken}` });
  const path = `/insurance/journeys/${journey.id}`;
  await call(path, 'PATCH', { preferences: { budget: 10000, budgetMode: 'hard', priority: 'price', requiredAddOns: ['zero_depreciation'] } });
  let reply = await call(path + '/chat', 'POST', { message: 'Why this provider?' }, { 'X-AI-Consent': 'true' });
  assert.equal(reply.value.provider, 'sarvam');
  assert.equal(contexts.at(-1).comparison.recommendedQuoteId, 'quote-a');
  await call(path, 'PATCH', { preferences: { budget: 9000, requiredAddOns: [] } });
  reply = await call(path + '/chat', 'POST', { message: 'What about now?' }, { 'X-AI-Consent': 'true' });
  assert.match(reply.value.messages.at(-1).text, /9000.*quote-b/);
  await call(path, 'PATCH', { preferences: { cover: 'third_party' } });
  await call(path + '/chat', 'POST', { message: 'Any quotes?' }, { 'X-AI-Consent': 'true' });
  assert.equal(contexts.at(-1).comparison.status, 'no_quotes');
  assert.equal(contexts.at(-1).comparison.requestedCover, 'third_party');
  authenticate({ Authorization: 'Bearer wrong-token' });
  assert.equal((await call(path + '/chat')).status, 404);
});

test('document signatures and unreadable inputs fail without AI requests', async () => {
  assert.throws(() => policyText('application/pdf', Buffer.from('not a PDF')), /contents/);
  assert.throws(() => policyText('image/png', Buffer.alloc(0)), /empty/);
  assert.throws(() => policyText('text/plain', Buffer.from('hello')), /Upload/);
  await assert.rejects(policyText('application/pdf', Buffer.from('%PDF-broken')), /Could not read/);
});

test('frontend and backend are served together and expose no secret config', async (t) => {
  const { base, call } = await setup(t);
  const page = await fetch(base);
  assert.match(await page.text(), /chat-ai-consent/);
  for (const path of ['/app.js', '/styles.css', '/car.webp']) assert.equal((await fetch(base + path)).status, 200);
  assert.deepEqual((await call('/insurance/status')).value, { aiConfigured: false, model: 'sarvam-105b', scope: 'private_car_renewal' });
});
