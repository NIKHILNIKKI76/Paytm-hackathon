export class InputError extends Error {
  status = 400;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("Expected a JSON object.");
  return value as Record<string, unknown>;
}
export function textField(value: unknown, name: string, maximum = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    throw new InputError(`${name} must be a non-empty string of at most ${maximum} characters.`);
  return value.trim();
}
export function amount(value: unknown, name: string, maximum = 10000000): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > maximum
      || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001)
    throw new InputError(`${name} must be a positive amount with at most two decimal places, up to ${maximum}.`);
  return value;
}
export function identity(input: Record<string, unknown>) {
  const pan = textField(input.pan, "pan", 10).toUpperCase();
  const phone = textField(input.phone, "phone", 10);
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) throw new InputError("Invalid PAN format.");
  if (!/^[6-9][0-9]{9}$/.test(phone)) throw new InputError("phone must be a 10-digit Indian mobile number.");
  return { pan, phone };
}
