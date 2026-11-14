export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const text = (max) => (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const integer = (min, max) => (value) => Number.isSafeInteger(value) && value >= min && value <= max;
const oneOf = (...values) => (value) => values.includes(value);
const list = (check) => (value) => Array.isArray(value) && value.length <= 20 && value.every(check);
const money = integer(0, 100_000_000);
const date = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const cover = oneOf('comprehensive', 'third_party', 'own_damage');
const addOn = oneOf('zero_depreciation', 'roadside_assistance', 'engine_protection', 'return_to_invoice');

export const vehicleFields = {
  registration: (value) => typeof value === 'string' && /^[a-z0-9 -]{4,20}$/i.test(value) &&
    /^[a-z0-9]{4,12}$/i.test(value.replace(/[ -]/g, '')),
  city: text(80),
  make: text(80),
  model: text(80),
  variant: text(80),
  year: integer(1900, new Date().getFullYear() + 1),
  startDate: date,
  termMonths: integer(1, 36),
};
export const policyFields = {
  insurer: text(120),
  cover,
  expiry: date,
  thirdPartyExpiry: date,
  idv: money,
  compulsoryDeductible: money,
  voluntaryDeductible: money,
  addOns: list(addOn),
  priorNcb: integer(0, 100),
  claimedSinceIssuance: (value) => typeof value === 'boolean',
};
export const preferenceFields = {
  cover,
  budget: (value) => Number.isSafeInteger(value) && value > 0 && money(value),
  budgetMode: oneOf('hard', 'flexible'),
  priority: oneOf('price', 'repair_cost', 'compare'),
  requiredAddOns: list(addOn),
  preferredAddOns: list(addOn),
  minimumIdv: money,
  garage: text(120),
};
export const reusablePreferences = ['cover', 'priority', 'requiredAddOns', 'preferredAddOns', 'minimumIdv', 'garage'];
export const promptIds = ['keep_zero_depreciation', 'price_or_repairs'];

export function fields(value, schema, { allowClear = false, ignoreInvalid = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputError('Expected a JSON object.');
  }
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (Object.hasOwn(schema, key) && ((entry === null && allowClear) || schema[key](entry))) {
      result[key] = typeof entry === 'string' ? entry.trim() : entry;
    } else if (!ignoreInvalid) {
      throw new InputError(`Unsupported or invalid field: ${key}.`);
    }
  }
  if (result.registration) result.registration = result.registration.replace(/[ -]/g, '').toUpperCase();
  return result;
}

export function vehicleKey(vehicle) {
  if (vehicle.registration) return vehicle.registration;
  if (vehicle.make && vehicle.model && vehicle.variant && vehicle.city && vehicle.year) {
    return JSON.stringify([vehicle.make, vehicle.model, vehicle.variant, vehicle.city, vehicle.year]).toLowerCase();
  }
  return null;
}
