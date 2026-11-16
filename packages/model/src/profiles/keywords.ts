/**
 * Schema keywords that profiles may use beyond JSON Schema 2020-12. They
 * only annotate: validation ignores them, and editors read them to choose a
 * widget (docs/body-profiles.md).
 */

/**
 * On an array of `{id?, label}` items: offer terms of this loaded ontology
 * (docs/ontologies.md), optionally only `root` and its descendants.
 */
export interface OntologyLookup {
  name: string;
  root?: string;
}

/**
 * On a string property, or an array of strings: each value is the IRI of an
 * annotation whose structured body has `profile`. `label` names the field of
 * the linked profile that holds the linked annotation's label, so readers can
 * show it without storing it (ADR 0035).
 */
export interface AnnotationLink {
  profile: string;
  label?: string;
}

/** The IRIs a link field's value names, whether it holds one or a list. */
export function linkedIris(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Minimal view of an Ajv instance, so this package does not depend on Ajv's types. */
export interface KeywordRegistry {
  addKeyword(definition: { keyword: string; metaSchema?: object }): unknown;
}

export function addProfileKeywords<T extends KeywordRegistry>(ajv: T): T {
  ajv.addKeyword({
    keyword: 'ontology',
    metaSchema: {
      type: 'object',
      required: ['name'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', pattern: '^[a-z][a-z0-9]*$' },
        root: { type: 'string' },
      },
    },
  });
  ajv.addKeyword({
    keyword: 'annotation',
    metaSchema: {
      type: 'object',
      required: ['profile'],
      additionalProperties: false,
      properties: { profile: { type: 'string' }, label: { type: 'string' } },
    },
  });
  // At a schema's root: bodies of the profile are computed, not written (ADR 0036).
  ajv.addKeyword({ keyword: 'derived', metaSchema: { type: 'boolean' } });
  return ajv;
}

/** Whether a profile's bodies are computed rather than written, so editors should not offer it. */
export function isDerived(schema: Record<string, unknown>): boolean {
  return schema['derived'] === true;
}
