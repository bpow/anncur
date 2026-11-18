/** JSON with object keys sorted, so equal values compare equal whatever order their keys came in. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}
