/** Small argument checks shared by the built-in tools. */

export function expectRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("arguments must be a JSON object");
  }
  return value as Record<string, unknown>;
}

export function expectString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`"${key}" must be a non-empty string`);
  }
  return value;
}
