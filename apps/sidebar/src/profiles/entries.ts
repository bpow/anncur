/** A structured value laid out for reading, with labels from its profile's schema. */
import { linkedIris, type JsonValue } from '@curanno/model';
import type { SchemaField } from './schema';

function show(v: JsonValue): string {
  if (Array.isArray(v)) return v.map(show).join(', ');
  return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
}

export interface Entry {
  key: string;
  label: string;
  text?: string;
  items?: Entry[][];
}

export function isObject(v: JsonValue | undefined): v is Record<string, JsonValue> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The label of a linked annotation, or undefined when it is not loaded. */
export type LinkLabel = (field: SchemaField, iri: string) => string | undefined;

// Labels come from the schema's titles; keys it doesn't describe keep their names.
// Only one level of object lists is laid out; deeper ones are shown as JSON.
export function entriesOf(
  value: Record<string, JsonValue>,
  fields: SchemaField[],
  options: { nested?: boolean; linkLabel?: LinkLabel } = {},
): Entry[] {
  const { nested = false, linkLabel } = options;
  return Object.entries(value).map(([key, v]) => {
    const field = fields.find((f) => f.name === key);
    const label = field?.title ?? key;
    if (!nested && field?.kind === 'object-list' && Array.isArray(v) && v.every(isObject)) {
      return {
        key,
        label,
        items: v.map((item) => entriesOf(item, field.fields ?? [], { nested: true })),
      };
    }
    if (field?.kind === 'term-list' && Array.isArray(v) && v.every(isObject)) {
      const terms = v.map((t) =>
        t['id'] ? `${show(t['label'] ?? '')} (${show(t['id'])})` : show(t['label'] ?? ''),
      );
      return { key, label, text: terms.join(', ') };
    }
    if (field?.kind === 'annotation') {
      const labels = linkedIris(v).map((iri) => linkLabel?.(field, iri) ?? 'not on this page');
      return { key, label, text: labels.join(', ') };
    }
    return { key, label, text: show(v) };
  });
}
