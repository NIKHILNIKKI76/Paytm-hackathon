import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createAssistant, policyText } from './assistant.js';
import {
  fields, InputError, policyFields, preferenceFields, promptIds, reusablePreferences, vehicleFields, vehicleKey,
} from './inputs.js';
import { compareQuotes, demoQuotes } from './quotes.js';

async function body(request, limit = 32_768) {
  const parts = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      request.resume();
      throw new InputError('Request body is too large.', 413);
    }
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

async function json(request) {
  const bytes = await body(request);
  try {
    const value = JSON.parse(bytes);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {}
  throw new InputError('Expected a JSON object.');
}

function patch(target, update) {
  for (const [key, value] of Object.entries(update)) {
    if (value === null) delete target[key];
    else target[key] = value;
  }
}

function prompts(journey) {
  const result = [];
  if (!journey.skipped.includes('keep_zero_depreciation') &&
      journey.policy.addOns?.includes('zero_depreciation') &&
      !Object.hasOwn(journey.preferences, 'requiredAddOns') &&
      !Object.hasOwn(journey.preferences, 'preferredAddOns')) {
    result.push({ id: 'keep_zero_depreciation', question: 'Keep zero depreciation?' });
  }
  if (!journey.skipped.includes('price_or_repairs') && journey.priceSorts > 0 &&
      !Object.hasOwn(journey.preferences, 'priority')) {
    result.push({ id: 'price_or_repairs', question: 'Prioritise a lower premium or lower repair contributions?' });
  }
  return result;
}

export function createInsuranceServer({
  quoteProvider = demoQuotes,
  assistant = createAssistant(process.env.SARVAM_API_KEY?.trim()),
  clock = () => new Date().toISOString(),
} = {}) {
  const customers = new Map();
  const journeys = new Map();

  async function route(request) {
    const { pathname } = new URL(request.url, 'http://localhost');
    const method = request.method;
    if (pathname === '/insurance/journeys' && method === 'POST') {
      const input = await json(request);
      const vehicle = fields(input.vehicle ?? {}, vehicleFields);
      const policy = fields(input.policy ?? {}, policyFields);
      const key = vehicleKey(vehicle);
      let customerToken = input.customerToken;
      if (customerToken === undefined) {
        customerToken = randomUUID();
        customers.set(customerToken, new Map());
      }
      const saved = customers.get(customerToken);
      if (!saved) throw new InputError('Customer token not found.', 404);
      const journey = {
        id: randomUUID(), vehicle, policy, customerToken,
        preferences: structuredClone(saved.get(key) ?? {}), skipped: [],
        priceSorts: 0, selectedQuoteId: null, quoteSet: null,
      };
      journeys.set(journey.id, journey);
      return { status: 201, data: { ...view(journey), customerToken } };
    }

    const match = /^\/insurance\/journeys\/([^/]+)(?:\/([^/]+))?$/.exec(pathname);
    const journey = match && journeys.get(match[1]);
    if (!journey || request.headers.authorization !== `Bearer ${journey.customerToken}`) {
      throw new InputError('Journey not found.', 404);
    }
    const action = match[2];
    const now = clock();
    const preferences = () => Object.fromEntries(Object.entries(journey.preferences).map(([key, item]) => [key, item.value]));

    if (!action && method === 'GET') return { data: view(journey) };

    if (!action && method === 'PATCH') {
      const input = await json(request);
      const vehicle = fields(input.vehicle ?? {}, vehicleFields, { allowClear: true });
      const policy = fields(input.policy ?? {}, policyFields, { allowClear: true });
      const changes = fields(input.preferences ?? {}, preferenceFields, { allowClear: true });
      const previousKey = vehicleKey(journey.vehicle);
      patch(journey.vehicle, vehicle);
      const currentKey = vehicleKey(journey.vehicle);
      if (previousKey !== currentKey) {
        journey.policy = {};
        journey.preferences = structuredClone(customers.get(journey.customerToken).get(currentKey) ?? {});
        journey.priceSorts = 0;
        journey.skipped = [];
      }
      patch(journey.policy, policy);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) delete journey.preferences[key];
        else journey.preferences[key] = { value, source: 'customer', confirmed: true, scope: currentKey, updatedAt: now };
      }
      if (Object.keys(vehicle).length || Object.keys(policy).length || Object.keys(changes).length) {
        journey.selectedQuoteId = null;
      }
      return { data: view(journey) };
    }

    if (action === 'events' && method === 'POST') {
      const input = await json(request);
      if (input.type === 'sort_by_price') journey.priceSorts += 1;
      else if (input.type === 'skip_prompt' && promptIds.includes(input.promptId)) {
        if (!journey.skipped.includes(input.promptId)) journey.skipped.push(input.promptId);
      } else throw new InputError('Unknown journey event.');
      return { data: view(journey) };
    }

    if (action === 'saved-preferences') {
      const key = vehicleKey(journey.vehicle);
      if (!key) throw new InputError('Confirm the car before saving preferences.', 409);
      const saved = customers.get(journey.customerToken);
      if (method === 'PUT') {
        const { keys } = await json(request);
        if (!Array.isArray(keys) || keys.some((name) => !reusablePreferences.includes(name) ||
          !Object.hasOwn(journey.preferences, name))) {
          throw new InputError('Choose confirmed, reusable preference keys.');
        }
        saved.set(key, Object.fromEntries(keys.map((name) => [name, structuredClone(journey.preferences[name])])));
        return { data: { savedKeys: [...new Set(keys)] } };
      }
      if (method === 'DELETE') {
        saved.delete(key);
        return { data: { savedKeys: [] } };
      }
    }

    if (action === 'policy-extraction' && method === 'POST') {
      if (!assistant) throw new InputError('Configure the AI provider or enter policy details manually.', 503);
      if (request.headers['x-document-consent'] !== 'true') {
        throw new InputError('Confirm document processing before uploading.');
      }
      const contentType = request.headers['content-type']?.split(';')[0];
      const source = await policyText(contentType, await body(request, 5 * 1024 * 1024));
      return { data: { ...await assistant.policy(source), requiresConfirmation: true } };
    }

    if (action === 'preference-extraction' && method === 'POST') {
      if (!assistant) throw new InputError('Configure the AI provider or enter preferences manually.', 503);
      const { text } = await json(request);
      if (typeof text !== 'string' || !text.trim() || text.length > 1500) {
        throw new InputError('Provide up to 1,500 characters of preference text.');
      }
      return { data: { suggestedPreferences: await assistant.preferences(text), requiresConfirmation: true } };
    }

    if ((action === 'quotes' && method === 'GET') || (action === 'selection' && method === 'POST')) {
      if (action === 'quotes') return { data: await results(journey, preferences(), now, quoteProvider) };
      const { quoteId } = await json(request);
      const existing = journey.quoteSet;
      const context = quoteContext(journey, preferences(), now);
      if (!existing || existing.key !== context.key || existing.expiresAt <= now) {
        throw new InputError('Refresh the quote comparison before selecting a quote.', 409);
      }
      const quotes = compareQuotes(existing.quotes, preferences(), journey.policy, now);
      if (!quotes.quotes.some((row) => row.quote.id === quoteId && !row.misses.length && !row.verify.length)) {
        throw new InputError('Choose an eligible quote that meets the confirmed requirements.', 409);
      }
      journey.selectedQuoteId = quoteId;
      return { data: { selectedQuoteId: quoteId, status: 'selected' } };
    }

    throw new InputError('Route not found.', 404);
  }

  const pages = new Map([
    ['/', ['index.html', 'text/html']],
    ['/app.js', ['app.js', 'text/javascript']],
    ['/styles.css', ['styles.css', 'text/css']],
    ['/car.webp', ['car.webp', 'image/webp']],
  ]);

  return createServer(async (request, response) => {
    const page = request.method === 'GET' && pages.get(request.url.split('?')[0]);
    if (page) {
      try {
        const [name, type] = page;
        const content = await readFile(new URL('../../frontend/insurance/' + name, import.meta.url));
        response.writeHead(200, { 'Content-Type': type }).end(content);
      } catch {
        response.writeHead(404).end();
      }
      return;
    }
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    try {
      const { status = 200, data } = await route(request);
      response.writeHead(status).end(JSON.stringify(data));
    } catch (error) {
      const expected = error instanceof InputError;
      response.writeHead(expected ? error.status : 500)
        .end(JSON.stringify({ error: expected ? error.message : 'Insurance request failed.' }));
    }
  });
}

function view(journey) {
  const { id, vehicle, policy, preferences, selectedQuoteId } = journey;
  return { id, vehicle, policy, preferences, selectedQuoteId, prompts: prompts(journey) };
}

function quoteContext(journey, preferences, now) {
  if (!vehicleKey(journey.vehicle)) throw new InputError('Confirm the car before requesting quotes.', 409);
  const vehicle = { ...journey.vehicle, startDate: journey.vehicle.startDate ?? now.slice(0, 10) };
  const policy = { ...journey.policy };
  const cover = preferences.cover ?? policy.cover ?? 'comprehensive';
  const termMonths = vehicle.termMonths ?? 12;
  if (cover === 'own_damage' && (!policy.thirdPartyExpiry || policy.thirdPartyExpiry < vehicle.startDate)) {
    throw new InputError('Confirm active third-party cover for the requested start date.', 409);
  }
  const requested = { vehicle, policy, cover, termMonths };
  return { requested, key: JSON.stringify(requested) };
}

async function results(journey, preferences, now, quoteProvider) {
  const { requested, key } = quoteContext(journey, preferences, now);
  let quoteSet = journey.quoteSet;
  if (quoteSet?.key !== key || quoteSet.expiresAt <= now) {
    const offers = await quoteProvider({ ...requested, now });
    const quotes = offers.filter((quote) => quote.cover === requested.cover &&
      quote.termMonths === requested.termMonths && quote.startDate === requested.vehicle.startDate);
    const validUntil = quotes.map((quote) => quote.expiresAt)
      .filter((time) => Number.isFinite(Date.parse(time)))
      .map((time) => new Date(time).toISOString()).filter((time) => time > now).sort()[0];
    quoteSet = { key, quotes, expiresAt: validUntil ?? now };
    const currentPreferences = Object.fromEntries(
      Object.entries(journey.preferences).map(([name, item]) => [name, item.value]),
    );
    if (quoteContext(journey, currentPreferences, now).key !== key) {
      throw new InputError('Quote inputs changed. Request a fresh comparison.', 409);
    }
    journey.quoteSet = quoteSet;
    preferences = currentPreferences;
  }
  return {
    ...compareQuotes(quoteSet.quotes, preferences, requested.policy, now),
    preferences: journey.preferences,
    requestedCover: requested.cover,
    requestedTermMonths: requested.termMonths,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.INSURANCE_PORT ?? 3001);
  createInsuranceServer().listen(port, '127.0.0.1', () => {
    process.stdout.write(`Insurance API listening on http://127.0.0.1:${port}\n`);
  });
}
