import type { SuggestionBatch } from '@anncur/api-client';
import { individualProfile, type BodyProfile } from '@anncur/model';
import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeGuest } from '../guest/fake';
import { installFakeApi, json, type Route } from '../test/fake-api';
import { useAnnotationsStore } from './annotations';
import { draftOf, orderAcceptances, useBatchesStore, type ReviewItem } from './batches';

const PAGE = 'https://example.org/article';
const BATCH = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const IRI = 'https://annotations.test/annotations/11111111-1111-4111-8111-111111111111';
const batch: SuggestionBatch = {
  id: BATCH,
  group: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  groupName: 'Curators',
  document: BATCH,
  documentUri: PAGE,
  creator: BATCH,
  engine: { name: 'engine', version: '1' },
  created: '2026-11-15T10:00:00Z',
  counts: { pending: 1, accepted: 0, rejected: 0 },
  items: [
    {
      id: '_:i1',
      status: 'pending',
      selector: { type: 'TextQuoteSelector', exact: 'The individual was a boy aged twelve.' },
      body: { type: 'StructuredBody', profile: individualProfile.iri, value: { case: 'II-1' } },
    },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup(route: Route) {
  const api = installFakeApi((call) => {
    const override = route(call);
    if (override) return override;
    const path = call.url.pathname;
    if (path === '/x/suggestion-batches') return json({ total: 1, items: [batch] });
    if (path === `/x/suggestion-batches/${BATCH}`) return json(batch);
    if (path.endsWith('/accept')) return json({ items: [{ id: '_:i1', annotation: IRI }] });
    if (path.startsWith('/annotations/'))
      return json({
        id: IRI,
        type: 'Annotation',
        target: { source: PAGE },
        body: { type: 'TextualBody', value: 'Private annotation' },
      });
    if (path.endsWith('/acl')) return json([]);
    return undefined;
  });
  const guest = createFakeGuest({ document: { uri: PAGE, links: [] } });
  const batches = useBatchesStore();
  await batches.load(guest, [PAGE]);
  const review = batches.pending[0]!;
  const accept = () => batches.accept(guest, [{ item: review, draft: draftOf(review) }]);
  const reset = () => {
    useAnnotationsStore().resetSession();
    batches.clear(guest);
  };
  return { api, guest, batches, accept, reset };
}

beforeEach(() => setActivePinia(createPinia()));

describe('reviewed dependencies', () => {
  const linkedProfile: BodyProfile = {
    iri: 'https://example.org/linked',
    title: 'Linked',
    schema: {
      type: 'object',
      properties: {
        next: { type: 'string', annotation: { profile: 'https://example.org/linked' } },
      },
    },
  };
  function reviews(links: Record<string, string | undefined>): ReviewItem[] {
    return Object.entries(links).map(([id, next]) => ({
      batch,
      documentUri: PAGE,
      key: id,
      target: { type: 'SpecificResource', source: PAGE },
      item: {
        ...batch.items[0]!,
        id,
        body: {
          type: 'StructuredBody',
          profile: linkedProfile.iri,
          value: next ? { next } : {},
        },
      },
    }));
  }
  it('orders transitive dependencies once, keeping explicitly reviewed drafts', () => {
    const items = reviews({ '_:a': '_:b', '_:b': '_:c', '_:c': undefined });
    const chosen = [
      { item: items[0]!, draft: draftOf(items[0]!) },
      { item: items[1]!, draft: { ...draftOf(items[1]!), text: 'Reviewed dependency' } },
    ];
    const ordered = orderAcceptances(chosen, items, () => linkedProfile);
    expect(ordered.map((a) => a.item.item.id)).toEqual(['_:c', '_:b', '_:a']);
    expect(ordered[1]).toBe(chosen[1]);
  });
  it('rejects cycles introduced during review before sending any acceptance', () => {
    const items = reviews({ '_:a': '_:b', '_:b': '_:a' });
    expect(() =>
      orderAcceptances(
        [{ item: items[0]!, draft: draftOf(items[0]!) }],
        items,
        () => linkedProfile,
      ),
    ).toThrow(/cycle/);
  });
});

describe('batch review sessions', () => {
  it('does not start annotation reads after acceptance returns to another identity', async () => {
    const response = deferred<Response>();
    const { api, batches, guest, accept, reset } = await setup(({ url }) =>
      url.pathname.endsWith('/accept') ? response.promise : undefined,
    );
    const accepting = accept();
    await flushPromises();
    reset();
    response.resolve(json({ items: [{ id: '_:i1', annotation: IRI }] }));
    await accepting;
    expect(api.calls.some((c) => c.url.pathname.startsWith('/annotations/'))).toBe(false);
    expect(batches.items).toEqual([]);
    expect(guest.anchoring.value.size).toBe(0);
  });

  it('does not restore private annotations when an old read finishes after sign-out', async () => {
    const response = deferred<Response>();
    const { api, batches, guest, accept, reset } = await setup(({ url }) =>
      url.pathname.startsWith('/annotations/') ? response.promise : undefined,
    );
    const accepting = accept();
    await flushPromises();
    expect(api.calls.some((c) => c.url.pathname.startsWith('/annotations/'))).toBe(true);
    reset();
    response.resolve(
      json({
        id: IRI,
        type: 'Annotation',
        target: { source: PAGE },
        body: { type: 'TextualBody', value: 'Private old-session annotation' },
      }),
    );
    await accepting;
    expect(useAnnotationsStore().all).toEqual([]);
    expect(batches.items).toEqual([]);
    expect(guest.anchoring.value.size).toBe(0);
  });

  it('does not restore batches when a rejection refresh finishes after sign-out', async () => {
    const response = deferred<Response>();
    let refreshing = false;
    const { guest, batches, reset } = await setup(({ url }) => {
      if (url.pathname.endsWith('/reject')) {
        refreshing = true;
        return json(batch);
      }
      if (refreshing && url.pathname === `/x/suggestion-batches/${BATCH}`) return response.promise;
      return undefined;
    });
    const rejecting = batches.reject(guest, batches.pending[0]!);
    await flushPromises();
    reset();
    response.resolve(json(batch));
    await rejecting;
    expect(batches.items).toEqual([]);
    expect(guest.anchoring.value.size).toBe(0);
  });
});
