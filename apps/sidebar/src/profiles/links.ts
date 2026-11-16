/**
 * Annotations a link field may name (ADR 0035): those with a structured body
 * of the field's profile, labelled by the body's `label` field.
 */
import type { Annotation } from '@curanno/api-client';
import { quoteOf, structuredBodies, type AnnotationLink, type BodyProfile } from '@curanno/model';
import { fieldsOf, type SchemaField } from './schema';

export interface LinkCandidate {
  id: string;
  label: string;
  quote: string;
}

export function labelOf(value: unknown, field: string | undefined): string | undefined {
  if (!field || typeof value !== 'object' || value === null || Array.isArray(value)) return;
  const label = (value as Record<string, unknown>)[field];
  return typeof label === 'string' ? label : undefined;
}

export function linkCandidates(
  annotations: readonly Annotation[],
  link: AnnotationLink,
): LinkCandidate[] {
  return annotations.flatMap((a) => {
    const body = structuredBodies(a).find((b) => b.profile === link.profile);
    if (!body) return [];
    return [{ id: a.id, label: labelOf(body.value, link.label) ?? a.id, quote: quoteOf(a) ?? '' }];
  });
}

/** A label for each linked annotation that is loaded, by IRI. */
export function linkLabels(
  annotations: readonly Annotation[],
  link: AnnotationLink,
): Map<string, string> {
  return new Map(linkCandidates(annotations, link).map((c) => [c.id, c.label]));
}

/** The profile's link field, if it has one. */
export function linkOf(profile: BodyProfile): AnnotationLink | undefined {
  return linkFieldOf(profile)?.link;
}

export function linkFieldOf(profile: BodyProfile): SchemaField | undefined {
  return fieldsOf(profile.schema).find((f) => f.kind === 'annotation' && f.link);
}
