/**
 * The JSON Schema the model's answer must follow, derived from a profile's
 * schema. Constrained decoders (llama.cpp's grammars behind Ollama, vLLM's
 * guided decoding, hosted structured outputs) accept a subset of JSON
 * Schema, so the projection keeps structure, types, enums, required fields
 * and descriptions, and leaves length and pattern limits to the profile's
 * own validation afterwards. An ontology field (`ontology` keyword on an
 * array of `{id?, label}`) becomes an array of labels: the model never
 * supplies identifiers, the ontology lookup does (ADR 0031). A link to
 * another annotation (`annotation` keyword, ADR 0035) is left out as well:
 * the model names the linked annotation by its label, from a list the
 * caller gives, and the pipeline fills in the IRI.
 */
import type { AnnotationLink, BodyProfile, JsonSchema, OntologyLookup } from '@curanno/model';

/** Where an ontology field is in a value: property names, and `*` for every array item. */
export type ValuePath = string[];

export interface OntologyField {
  path: ValuePath;
  ontology: OntologyLookup;
}

export interface OutputSchema {
  /** `{suggestions: [{quote, value}]}`, the shape the model returns. */
  schema: JsonSchema;
  /** The projected schema of one suggestion's value, for the prompt. */
  valueSchema: JsonSchema;
  /** The ontology fields of the profile, whose labels are resolved after the answer. */
  ontologyFields: OntologyField[];
  /** The profile's link field, if it has one; only a top-level one with a `label` is supported. */
  link?: LinkField;
}

export interface LinkField extends AnnotationLink {
  field: string;
  label: string;
}

/** Thrown for a profile whose schema cannot be turned into an output schema. */
export class UnsupportedProfileError extends Error {}

const KEPT = new Set([
  'type',
  'enum',
  'const',
  'title',
  'description',
  'required',
  'minItems',
  'maxItems',
]);

type Schema = Record<string, unknown>;

function isSchema(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function project(node: unknown, path: ValuePath, fields: OntologyField[]): Schema {
  if (!isSchema(node)) throw new UnsupportedProfileError(`not a schema at /${path.join('/')}`);
  for (const keyword of ['$ref', 'oneOf', 'anyOf', 'allOf', 'if', 'not']) {
    if (keyword in node) {
      throw new UnsupportedProfileError(`${keyword} is not supported (at /${path.join('/')})`);
    }
  }
  const out: Schema = {};
  for (const [key, value] of Object.entries(node)) if (KEPT.has(key)) out[key] = value;

  const ontology = node['ontology'];
  if (isSchema(ontology) && typeof ontology['name'] === 'string') {
    fields.push({ path, ontology: ontology as unknown as OntologyLookup });
    const labels: Schema = { type: 'array', items: { type: 'string' } };
    if (typeof node['title'] === 'string') labels['title'] = node['title'];
    if (typeof node['description'] === 'string') {
      labels['description'] =
        `${node['description']} Give each term as a label; identifiers are looked up later.`;
    }
    return labels;
  }

  if (isSchema(node['properties'])) {
    const properties: Schema = {};
    for (const [name, child] of Object.entries(node['properties'])) {
      properties[name] = project(child, [...path, name], fields);
    }
    out['properties'] = properties;
    out['additionalProperties'] = false;
  }
  if ('items' in node) out['items'] = project(node['items'], [...path, '*'], fields);
  return out;
}

function linkOf(profile: BodyProfile): LinkField | undefined {
  const properties = profile.schema['properties'];
  if (!isSchema(properties)) return undefined;
  const links = Object.entries(properties).flatMap(([field, child]) => {
    const annotation = isSchema(child) ? child['annotation'] : undefined;
    return isSchema(annotation) ? [{ field, ...(annotation as unknown as AnnotationLink) }] : [];
  });
  if (links.length > 1) throw new UnsupportedProfileError('more than one annotation link');
  const [link] = links;
  if (!link) return undefined;
  if (!link.label) throw new UnsupportedProfileError(`the link ${link.field} names no label`);
  return { ...link, label: link.label };
}

/**
 * `labels` are those of the annotations a link field may name. The model
 * must pick one of them, so a profile with a link needs at least one.
 */
export function outputSchema(profile: BodyProfile, labels?: readonly string[]): OutputSchema {
  const ontologyFields: OntologyField[] = [];
  const link = linkOf(profile);
  const value = project(profile.schema, [], ontologyFields);
  if (link) {
    const properties = value['properties'] as Schema;
    delete properties[link.field];
    const required = value['required'];
    if (Array.isArray(required)) value['required'] = required.filter((r) => r !== link.field);
    if (labels?.length) {
      const own = isSchema(properties[link.label]) ? properties[link.label] : {};
      properties[link.label] = {
        ...(own as Schema),
        type: 'string',
        enum: [...new Set(labels)],
        description: 'Which one the passage is about, by one of these labels.',
      };
    }
  }
  const schema: JsonSchema = {
    type: 'object',
    required: ['suggestions'],
    additionalProperties: false,
    properties: {
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['quote', 'value'],
          additionalProperties: false,
          properties: {
            quote: {
              type: 'string',
              description:
                'A passage copied character for character from the document that supports the value.',
            },
            value,
          },
        },
      },
    },
  };
  return { schema, valueSchema: value, ontologyFields, ...(link ? { link } : {}) };
}
