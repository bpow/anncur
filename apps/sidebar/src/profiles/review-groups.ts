/**
 * How a batch's pending items are laid out for review (ADR 0037): each item
 * that others link to by local id heads a group with the items linking to
 * it, so an individual is reviewed with its facts.
 */
import { linkFieldsOf, linkedIris, type BodyProfile } from '@curanno/model';
import type { SuggestionItem } from '@curanno/api-client';

export interface ReviewGroup<T> {
  /** The item the others link to; absent for the items that link to nothing in the batch. */
  head?: T;
  members: T[];
}

/** The local ids an item's value links to. */
export function localLinksOf(
  item: SuggestionItem,
  profileOf: (iri: string) => BodyProfile | undefined,
): string[] {
  const profile = profileOf(item.body.profile);
  const value = item.body.value;
  if (!profile || typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  return linkFieldsOf(profile.schema).flatMap(({ field }) =>
    linkedIris((value as Record<string, unknown>)[field]).filter((v) => v.startsWith('_:')),
  );
}

/**
 * Groups `items` (one batch's, in order). An item linking to several heads
 * goes under the first; one linking to none that are among `items` goes
 * with the rest.
 */
export function groupForReview<T extends { item: SuggestionItem }>(
  items: T[],
  profileOf: (iri: string) => BodyProfile | undefined,
): ReviewGroup<T>[] {
  const links = new Map(items.map((r) => [r.item.id, localLinksOf(r.item, profileOf)]));
  const linked = new Set([...links.values()].flat());
  const heads = items.filter((r) => linked.has(r.item.id));
  const groups = new Map(heads.map((h) => [h.item.id, { head: h, members: [] as T[] }]));
  const rest: T[] = [];
  for (const r of items) {
    if (groups.has(r.item.id)) continue;
    const under = (links.get(r.item.id) ?? []).find((id) => groups.has(id));
    if (under) groups.get(under)!.members.push(r);
    else rest.push(r);
  }
  return [...groups.values(), ...(rest.length ? [{ members: rest }] : [])];
}
