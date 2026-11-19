/**
 * Case-variant facts that still need their Allele Registry or ClinVar IDs
 * (ADR 0039, docs/variant-ids-plan.md), grouped by the variant as written,
 * so that a curator settles a variant once for every article that reports it.
 */
import type { Annotation, components } from '@curanno/api-client';
import {
  annotationUuid,
  caseVariantProfile,
  documentOf,
  quoteOf,
  structuredBodies,
  type JsonValue,
  type StructuredBody,
} from '@curanno/model';

export type VariantCandidate = components['schemas']['VariantCandidate'];

/** One case-variant fact without IDs. */
export interface MissingFact {
  /** The annotation's IRI. */
  iri: string;
  uuid: string;
  /** The document the fact is on. */
  source: string;
  /** The text the fact is anchored to, when it has a quote. */
  quote?: string;
  /** Whether the caller may edit it. */
  writable: boolean;
}

/** Facts reporting the same variant in the same gene. */
export interface MissingVariant {
  key: string;
  variant: string;
  /** The gene the facts name, when they agree on one. */
  gene?: string;
  facts: MissingFact[];
}

type Value = Record<string, JsonValue>;

function variantBody(annotation: Annotation): (StructuredBody & { value: Value }) | undefined {
  return structuredBodies(annotation).find(
    (body): body is StructuredBody & { value: Value } =>
      body.profile === caseVariantProfile.iri &&
      typeof body.value === 'object' &&
      body.value !== null &&
      !Array.isArray(body.value),
  );
}

const text = (value: JsonValue | undefined): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ') : undefined;

/** Whether a case-variant value still needs IDs: none given, and not marked unresolvable. */
export function needsIds(value: Value): boolean {
  return (
    text(value['variant']) !== undefined &&
    value['caid'] === undefined &&
    value['clinVarId'] === undefined &&
    value['idSource'] !== 'unresolvable'
  );
}

/** The facts among these annotations that need IDs, grouped by variant and gene, most facts first. */
export function missingVariants(annotations: readonly Annotation[]): MissingVariant[] {
  const groups = new Map<string, MissingVariant>();
  for (const annotation of annotations) {
    const body = variantBody(annotation);
    if (!body || !needsIds(body.value)) continue;
    const variant = text(body.value['variant'])!;
    const gene = text(body.value['geneName'])?.toUpperCase();
    const key = `${gene ?? ''}\u0000${variant}`;
    const group = groups.get(key) ?? { key, variant, ...(gene ? { gene } : {}), facts: [] };
    const quote = quoteOf(annotation);
    group.facts.push({
      iri: annotation.id,
      uuid: annotationUuid(annotation.id),
      source: documentOf(annotation) ?? '',
      ...(quote ? { quote } : {}),
      writable: (annotation.permissions ?? []).includes('update'),
    });
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => b.facts.length - a.facts.length || a.variant.localeCompare(b.variant),
  );
}

/** The value with a candidate's IDs, as the sidebar's Use these IDs fills them. */
export function withCandidate(value: Value, candidate: VariantCandidate): Value {
  const next: Value = { ...value };
  delete next['caid'];
  delete next['clinVarId'];
  if (candidate.caid) next['caid'] = candidate.caid;
  if (candidate.clinVar.length === 1) next['clinVarId'] = candidate.clinVar[0]!.variationId;
  if (candidate.gnomad) next['gnomad'] = candidate.gnomad;
  else delete next['gnomad'];
  next['idSource'] = 'looked up';
  return next;
}

/** The value marked unresolvable, without IDs. */
export function unresolvable(value: Value): Value {
  const next: Value = { ...value };
  delete next['caid'];
  delete next['clinVarId'];
  next['idSource'] = 'unresolvable';
  return next;
}

const INPUT_KEYS = [
  '@context',
  'type',
  'body',
  'bodyValue',
  'target',
  'motivation',
  'generator',
  'generated',
  'audience',
  'rights',
  'canonical',
  'via',
  'stylesheet',
] as const;

/**
 * The annotation as an update sends it, with its case-variant body's value changed.
 * Other bodies, and the case-variant body's creator (ADR 0034), stay as they are.
 */
export function updatedInput(
  annotation: Annotation,
  change: (value: Value) => Value,
): Record<string, unknown> | undefined {
  const body = variantBody(annotation);
  if (!body) return undefined;
  const input: Record<string, unknown> = {};
  for (const key of INPUT_KEYS) {
    const v = (annotation as Record<string, unknown>)[key];
    if (v !== undefined) input[key] = v;
  }
  const replace = (b: unknown) => (b === body ? { ...body, value: change(body.value) } : b);
  input['body'] = Array.isArray(annotation.body)
    ? (annotation.body as unknown[]).map(replace)
    : replace(annotation.body);
  return input;
}
