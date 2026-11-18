/**
 * Suggestion batches waiting for review on the open documents (ADR 0037):
 * loaded from the API, their pending items highlighted in the page, and
 * accepted or rejected through it. Accepting sends the annotations the
 * curator reviewed; the server links facts to the individuals accepted
 * with or before them.
 */
import { unwrap, type SuggestionBatch, type SuggestionItem } from '@curanno/api-client';
import {
  localLinks,
  type Agent,
  type BodyProfile,
  type JsonValue,
  type OneOrMany,
  type Selector,
  type SpecificResource,
} from '@curanno/model';
import { defineStore } from 'pinia';
import { computed, shallowRef } from 'vue';
import { buildInput, withEditor, type AnnotationDraft } from '../api/annotations';
import { useApi } from '../api/client';
import { currentUserIri } from '../current-user';
import type { Guest } from '../guest';
import { useAnnotationsStore } from './annotations';
import { useProfilesStore } from './profiles';

export interface ReviewItem {
  batch: SuggestionBatch;
  item: SuggestionItem;
  documentUri: string;
  /** What the item is highlighted under in the page. */
  key: string;
  target: SpecificResource;
}

/** One item to accept: as the reviewed draft, or as an annotation already saved. */
export type Acceptance =
  { item: ReviewItem; draft: AnnotationDraft } | { item: ReviewItem; existing: string };

const keyOf = (batch: string, local: string) =>
  `urn:x-curanno-suggestion:${batch}/${local.slice(2)}`;

/** The engine, as the creator of a suggested body (ADR 0034). */
export function engineAgent(batch: SuggestionBatch): Agent {
  return {
    type: 'Software',
    name: batch.engine.name,
    nickname: batch.engine.nickname ?? batch.engine.version,
  };
}

/** The draft the editor starts from for an item: its value, made by the engine. */
export function draftOf(review: ReviewItem): AnnotationDraft {
  return {
    text: '',
    tags: [],
    structured: {
      profile: review.item.body.profile,
      value: review.item.body.value as JsonValue,
      creator: engineAgent(review.batch),
      created: review.batch.created,
    },
  };
}

/** The reviewed drafts and their pending dependencies, in dependency order. */
export function orderAcceptances(
  selected: Acceptance[],
  reviews: ReviewItem[],
  profileOf: (iri: string) => BodyProfile | undefined,
): Acceptance[] {
  const batch = selected[0]?.item.batch.id;
  if (selected.some((a) => a.item.batch.id !== batch)) {
    throw new Error('Accept items of one batch at a time');
  }
  const byId = new Map(reviews.filter((r) => r.batch.id === batch).map((r) => [r.item.id, r]));
  const explicit = new Map(selected.map((a) => [a.item.item.id, a]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const ordered: Acceptance[] = [];
  const visit = (acceptance: Acceptance): void => {
    const id = acceptance.item.item.id;
    if (done.has(id)) return;
    if (visiting.has(id)) throw new Error('The reviewed items link to each other in a cycle');
    visiting.add(id);
    const draft = 'draft' in acceptance ? acceptance.draft : undefined;
    if (draft?.structured) {
      const body = { type: 'StructuredBody' as const, ...draft.structured };
      for (const link of localLinks(body, { get: profileOf })) {
        for (const dependency of link.ids) {
          const review = byId.get(dependency);
          if (!review || review.item.status === 'rejected') {
            throw new Error(`The reviewed item links to unavailable suggestion ${dependency}`);
          }
          if (review.item.body.profile !== link.profile) {
            throw new Error(`${dependency} is not a ${link.profile} suggestion`);
          }
          if (review.item.status === 'accepted') continue;
          visit(
            explicit.get(dependency) ?? {
              item: review,
              draft: { ...draftOf(review), ...(draft.acl ? { acl: draft.acl } : {}) },
            },
          );
        }
      }
    }
    visiting.delete(id);
    done.add(id);
    ordered.push(acceptance);
  };
  selected.forEach(visit);
  return ordered;
}

export const useBatchesStore = defineStore('batches', () => {
  /** By document URI. */
  const byDocument = shallowRef(new Map<string, SuggestionBatch[]>());
  /** Whether pending items are highlighted in the page; off while the sidebar folds them away. */
  const shown = shallowRef(true);
  let session = 0;
  let loadGeneration = 0;

  const items = computed<ReviewItem[]>(() =>
    [...byDocument.value].flatMap(([documentUri, batches]) =>
      batches.flatMap((batch) =>
        batch.items.map((item) => ({
          batch,
          item,
          documentUri,
          key: keyOf(batch.id, item.id),
          target: {
            type: 'SpecificResource',
            source: documentUri,
            selector: item.selector as OneOrMany<Selector>,
          },
        })),
      ),
    ),
  );
  const pending = computed(() => items.value.filter((r) => r.item.status === 'pending'));

  function replace(uri: string, batches: SuggestionBatch[]): void {
    const next = new Map(byDocument.value);
    if (batches.length) next.set(uri, batches);
    else next.delete(uri);
    byDocument.value = next;
  }

  function highlight(guest: Guest, uri: string): void {
    if (!shown.value) return;
    const items = pending.value.filter((r) => r.documentUri === uri);
    if (items.length) {
      guest.anchor(
        items.map((r) => ({ id: r.key, target: r.target, style: 'suggested' as const })),
        uri,
      );
    }
  }

  /** The pending batches of the caller's groups on these documents, highlighted in the page. */
  async function load(guest: Guest, uris: string[]): Promise<void> {
    const started = session;
    const generation = ++loadGeneration;
    for (const uri of uris) {
      const list = unwrap(
        await useApi().GET('/x/suggestion-batches', {
          params: { query: { uri, pending: true, limit: 50, offset: 0 } },
        }),
      );
      const batches = await Promise.all(
        list.items.map(async (b) =>
          unwrap(
            await useApi().GET('/x/suggestion-batches/{id}', { params: { path: { id: b.id } } }),
          ),
        ),
      );
      if (started !== session || generation !== loadGeneration) return;
      unhighlight(guest, uri);
      replace(uri, batches);
      highlight(guest, uri);
    }
  }

  function unhighlight(guest: Guest, uri: string): void {
    const keys = items.value.filter((r) => r.documentUri === uri).map((r) => r.key);
    if (keys.length) guest.unanchor(keys);
  }

  function show(guest: Guest, visible: boolean): void {
    if (visible === shown.value) return;
    for (const uri of byDocument.value.keys()) unhighlight(guest, uri);
    shown.value = visible;
    for (const uri of byDocument.value.keys()) highlight(guest, uri);
  }

  /** Forget the batches of documents no longer open. */
  function keepOnly(guest: Guest, uris: string[]): void {
    for (const uri of byDocument.value.keys()) {
      if (!uris.includes(uri)) {
        unhighlight(guest, uri);
        replace(uri, []);
      }
    }
  }

  async function refresh(
    guest: Guest,
    batch: SuggestionBatch,
    uri: string,
    started: number,
  ): Promise<void> {
    if (started !== session) return;
    const next = unwrap(
      await useApi().GET('/x/suggestion-batches/{id}', { params: { path: { id: batch.id } } }),
    );
    if (started !== session || !byDocument.value.has(uri)) return;
    unhighlight(guest, uri);
    const others = (byDocument.value.get(uri) ?? []).filter((b) => b.id !== batch.id);
    replace(uri, next.counts.pending ? [...others, next] : others);
    highlight(guest, uri);
  }

  /**
   * Accept items of one batch, in order: an individual before the facts
   * that link to it. Each draft becomes an annotation as the composer would
   * post it, and is shared as its draft asks.
   */
  async function accept(guest: Guest, acceptances: Acceptance[]): Promise<void> {
    const started = session;
    const [first] = acceptances;
    if (!first) return;
    const { batch, documentUri } = first.item;
    const profiles = useProfilesStore();
    const annotations = useAnnotationsStore();
    acceptances = orderAcceptances(acceptances, items.value, (iri) => profiles.byIri(iri));
    const entries = await Promise.all(
      acceptances.map(async (a) => {
        if ('existing' in a) return { id: a.item.item.id, existing: a.existing };
        const before = draftOf(a.item).structured;
        const structured =
          a.draft.structured && (await withEditor(before, a.draft.structured, currentUserIri));
        const draft = { ...a.draft, ...(structured ? { structured } : {}) };
        const purpose = draft.structured ? profiles.purposeOf(draft.structured.profile) : undefined;
        const annotation = buildInput(draft, a.item.target, {
          ...(purpose ? { structuredPurpose: purpose } : {}),
        });
        return { id: a.item.item.id, annotation };
      }),
    );
    if (started !== session) return;
    const { items: decided } = unwrap(
      await useApi().POST('/x/suggestion-batches/{id}/accept', {
        params: { path: { id: batch.id } },
        body: { items: entries },
      }),
    );
    if (started !== session) return;
    for (const [i, { annotation }] of decided.entries()) {
      const acceptance = acceptances[i]!;
      if ('existing' in acceptance) continue;
      const { annotation: saved } = await annotations.fetch(annotation);
      if (started !== session) return;
      annotations.upsert(saved, documentUri);
      if (acceptance.draft.acl?.length) await annotations.share(annotation, acceptance.draft.acl);
      if (started !== session) return;
    }
    await refresh(guest, batch, documentUri, started);
  }

  async function reject(guest: Guest, review: ReviewItem): Promise<void> {
    const started = session;
    unwrap(
      await useApi().POST('/x/suggestion-batches/{id}/reject', {
        params: { path: { id: review.batch.id } },
        body: { items: [review.item.id] },
      }),
    );
    await refresh(guest, review.batch, review.documentUri, started);
  }

  async function discardBatch(guest: Guest, batch: SuggestionBatch, uri: string): Promise<void> {
    const started = session;
    unwrap(
      await useApi().DELETE('/x/suggestion-batches/{id}', { params: { path: { id: batch.id } } }),
    );
    if (started !== session) return;
    unhighlight(guest, uri);
    replace(
      uri,
      (byDocument.value.get(uri) ?? []).filter((b) => b.id !== batch.id),
    );
    highlight(guest, uri);
  }

  function clear(guest: Guest): void {
    session++;
    for (const uri of byDocument.value.keys()) unhighlight(guest, uri);
    byDocument.value = new Map();
  }

  return {
    byDocument,
    items,
    pending,
    shown,
    load,
    keepOnly,
    show,
    accept,
    reject,
    discardBatch,
    clear,
  };
});
