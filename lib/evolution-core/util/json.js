export function toJsonColumn(value) {
  return JSON.stringify(value ?? null);
}

export function fromJsonColumn(text, fallback = null) {
  if (text == null) return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}
