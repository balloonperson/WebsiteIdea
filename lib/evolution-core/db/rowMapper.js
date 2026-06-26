// node:sqlite returns rows with null-prototype objects keyed by the raw
// snake_case column names. Repositories work in camelCase, so every read
// goes through this converter.

export function rowToCamel(row) {
  if (!row) return row;
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

export function rowsToCamel(rows) {
  return rows.map(rowToCamel);
}
