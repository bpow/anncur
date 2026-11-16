/**
 * Annotations a link field may name (ADR 0035): those with a structured body
 * of the field's profile, labelled by the body's `label` field.
 */
import type { Annotation } from '@curanno/api-client';
import type { InjectionKey, Ref } from 'vue';
import { quoteOf, structuredBodies, type AnnotationLink, type BodyProfile } from '@curanno/model';
import { fieldsOf, type SchemaField } from './schema';

/** Annotations a link may name besides those saved: a batch's items, by local id (ADR 0037). */
export interface ExtraLink {
  id: string;
  profile: string;
  value: unknown;
  quote: string;
}
export const EXTRA_LINKS: InjectionKey<Ref<ExtraLink[]>> = Symbol('extra links');

/** The extras that `link` may name, labelled as suggestions. */
export function extraCandidates(
  extras: readonly ExtraLink[],
  link: AnnotationLink,
): LinkCandidate[] {
  return extras
    .filter((e) => e.profile === link.profile)
    .map((e) => ({
      id: e.id,
      label: `${labelOf(e.value, link.label) ?? e.id} (suggested)`,
      quote: e.quote,
    }));
}

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
