/**
 * Suggestion batches through the API (ADR 0037): who may see and decide on
 * them, links between items, and reruns.
 */
import { caseFamilyProfile, individualProfile, type JsonValue } from '@curanno/model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  alice,
  bob,
  carol,
  createTestContext,
  databaseUrl,
  PUBLIC_URL,
  type TestContext,
  type TestUser,
} from '../test/harness.js';

const PAGE = 'https://journal.example/articles/42';
const quote = (exact: string) => ({ type: 'TextQuoteSelector', exact });

interface Batch {
  id: string;
  document: string;
  counts: { pending: number; accepted: number; rejected: number };
  items: { id: string; status: string; annotation?: string; body: { value: JsonValue } }[];
}

const individual = (id: string, label: string) => ({
  id,
  selector: quote(`${label} was a boy`),
  body: { type: 'StructuredBody', profile: individualProfile.iri, value: { case: label } },
});
const family = (id: string, individuals: string[], familyInfo: string) => ({
  id,
  selector: quote(familyInfo),
  body: {
    type: 'StructuredBody',
    profile: caseFamilyProfile.iri,
    value: { individuals, familyInfo },
  },
});
// What a client sends to accept an item: the annotation it wants, built from the item.
const annotationOf = (item: ReturnType<typeof individual> | ReturnType<typeof family>) => ({
  type: 'Annotation',
  motivation: 'describing',
  body: item.body,
  target: { source: PAGE, selector: item.selector },
});

describe.skipIf(!databaseUrl)('suggestion batches', () => {
  let ctx: TestContext;
  let group: string;
  beforeAll(async () => {
    ctx = await createTestContext();
    const created = await ctx.as(alice, {
      method: 'POST',
      url: '/x/groups',
      payload: { name: 'Curators' },
    });
    group = created.json<{ id: string }>().id;
    const me = await ctx.as(carol, { method: 'GET', url: '/x/me' });
    const added = await ctx.as(alice, {
      method: 'PUT',
      url: `/x/groups/${group}/members/${me.json<{ id: string }>().id}`,
      payload: { role: 'member' },
    });
    expect(added.statusCode, added.body).toBe(204);
  });
  afterAll(() => ctx.close());

  async function post(user: TestUser, items: unknown[], extra: Record<string, unknown> = {}) {
    return ctx.as(user, {
      method: 'POST',
      url: '/x/suggestion-batches',
      payload: {
        group,
        document: { uri: PAGE, title: 'A case report', links: [] },
        engine: { name: 'curanno-extract', version: '0.3.0', nickname: 'qwen / prompt 3' },
        items,
        ...extra,
      },
    });
  }
  async function batchOf(user: TestUser, items: unknown[], extra: Record<string, unknown> = {}) {
    const res = await post(user, items, extra);
    expect(res.statusCode, res.body).toBe(201);
    return res.json<Batch>();
  }
  const decide = (user: TestUser, id: string, action: 'accept' | 'reject', items: unknown[]) =>
    ctx.as(user, {
      method: 'POST',
      url: `/x/suggestion-batches/${id}/${action}`,
      payload: { items },
    });
  const status = (batch: Batch) => Object.fromEntries(batch.items.map((i) => [i.id, i.status]));

  it('lets members of the group post and read a batch, and no one else', async () => {
    const batch = await batchOf(alice, [individual('_:i1', 'II-1')]);
    expect(batch.counts).toEqual({ pending: 1, accepted: 0, rejected: 0 });
    expect(batch).toMatchObject({ documentUri: PAGE, documentTitle: 'A case report' });
    expect(
      (await ctx.as(carol, { method: 'GET', url: `/x/suggestion-batches/${batch.id}` })).statusCode,
    ).toBe(200);
    expect(
      (await ctx.as(bob, { method: 'GET', url: `/x/suggestion-batches/${batch.id}` })).statusCode,
    ).toBe(404);
    expect((await post(bob, [individual('_:i1', 'II-1')])).statusCode).toBe(403);
    expect((await decide(bob, batch.id, 'reject', ['_:i1'])).statusCode).toBe(404);
    expect(
      (await ctx.as(bob, { method: 'DELETE', url: `/x/suggestion-batches/${batch.id}` }))
        .statusCode,
    ).toBe(404);

    const list = (user: TestUser, query = '') =>
      ctx.as(user, {
        method: 'GET',
        url: `/x/suggestion-batches?uri=${encodeURIComponent(PAGE)}${query}`,
      });
    expect(
      (await list(carol)).json<{ items: { id: string }[] }>().items.map((b) => b.id),
    ).toContain(batch.id);
    expect((await list(bob)).json()).toEqual({ total: 0, items: [] });
  });

  it('refuses items that link wrongly or fail their profile', async () => {
    const res = await post(alice, [
      individual('_:i1', 'II-1'),
      family('_:f1', ['_:nobody'], 'Cousins.'),
      family('_:f2', ['_:f1'], 'Cousins.'),
    ]);
    expect(res.statusCode).toBe(422);
    expect(
      res.json<{ errors: { instancePath: string }[] }>().errors.map((e) => e.instancePath),
    ).toEqual(['/items/1/body/value/individuals', '/items/2/body/value/individuals']);
  });

  it('accepts an individual and its fact together, linking the fact to the new annotation', async () => {
    const i1 = individual('_:i1', 'II-1');
    const f1 = family('_:f1', ['_:i1'], 'Her parents are cousins.');
    const batch = await batchOf(alice, [i1, f1]);

    const early = await decide(carol, batch.id, 'accept', [
      { id: '_:f1', annotation: annotationOf(f1) },
    ]);
    expect(early.statusCode).toBe(409);

    const res = await decide(carol, batch.id, 'accept', [
      { id: '_:i1', annotation: annotationOf(i1) },
      { id: '_:f1', annotation: annotationOf(f1) },
    ]);
    expect(res.statusCode, res.body).toBe(200);
    const [made, fact] = res.json<{ items: { id: string; annotation: string }[] }>().items;
    expect(made?.annotation.startsWith(`${PUBLIC_URL}/annotations/`)).toBe(true);
    const saved = await ctx.as(carol, {
      method: 'GET',
      url: fact!.annotation.slice(PUBLIC_URL.length),
    });
    expect(saved.json<{ body: { value: JsonValue } }>().body.value).toEqual({
      individuals: [made!.annotation],
      familyInfo: 'Her parents are cousins.',
    });
    // The curator who accepted it made it; the poster cannot read it until it is shared.
    expect(
      (await ctx.as(alice, { method: 'GET', url: fact!.annotation.slice(PUBLIC_URL.length) }))
        .statusCode,
    ).toBe(404);

    const after = (
      await ctx.as(carol, { method: 'GET', url: `/x/suggestion-batches/${batch.id}` })
    ).json<Batch>();
    expect(status(after)).toEqual({ '_:i1': 'accepted', '_:f1': 'accepted' });
    expect(after.items[0]?.annotation).toBe(made?.annotation);
    expect(
      (await decide(carol, batch.id, 'accept', [{ id: '_:i1', annotation: annotationOf(i1) }]))
        .statusCode,
    ).toBe(409);
  });

  it('accepts an item as an annotation that is already saved', async () => {
    const i1 = individual('_:i1', 'II-1');
    const saved = await ctx.as(carol, {
      method: 'POST',
      url: '/annotations/',
      payload: annotationOf(i1),
    });
    const iri = saved.json<{ id: string }>().id;
    const f1 = family('_:f1', ['_:i1'], 'Father affected.');
    const batch = await batchOf(alice, [i1, f1]);

    const wrong = await decide(carol, batch.id, 'accept', [{ id: '_:f1', existing: iri }]);
    expect(wrong.statusCode).toBe(422);
    const res = await decide(carol, batch.id, 'accept', [
      { id: '_:i1', existing: iri },
      { id: '_:f1', annotation: annotationOf(f1) },
    ]);
    expect(res.statusCode, res.body).toBe(200);
    const fact = res.json<{ items: { annotation: string }[] }>().items[1]!.annotation;
    const body = (await ctx.as(carol, { method: 'GET', url: fact.slice(PUBLIC_URL.length) })).json<{
      body: { value: { individuals: string[] } };
    }>().body;
    expect(body.value.individuals).toEqual([iri]);
  });

  it('takes a rejected individual out of the facts that name it', async () => {
    const batch = await batchOf(alice, [
      individual('_:i1', 'II-1'),
      individual('_:i2', 'II-2'),
      family('_:only', ['_:i1'], 'Only about II-1.'),
      family('_:both', ['_:i1', '_:i2'], 'About both.'),
    ]);
    const res = await decide(carol, batch.id, 'reject', ['_:i1']);
    expect(res.statusCode, res.body).toBe(200);
    const after = res.json<Batch>();
    expect(status(after)).toEqual({
      '_:i1': 'rejected',
      '_:i2': 'pending',
      '_:only': 'rejected',
      '_:both': 'pending',
    });
    expect(after.items[3]?.body.value).toEqual({
      individuals: ['_:i2'],
      familyInfo: 'About both.',
    });
    expect(after.counts).toEqual({ pending: 2, accepted: 0, rejected: 2 });
  });

  it('replaces the pending items of an earlier run with the same key', async () => {
    const key = { key: 'run-1' };
    const first = await batchOf(
      alice,
      [individual('_:i1', 'II-1'), individual('_:i2', 'II-2')],
      key,
    );
    const accepted = await decide(carol, first.id, 'accept', [
      { id: '_:i1', annotation: annotationOf(individual('_:i1', 'II-1')) },
    ]);
    expect(accepted.statusCode).toBe(200);
    const unrelated = await batchOf(alice, [individual('_:i1', 'II-1')]);

    const second = await batchOf(alice, [individual('_:i1', 'II-1')], key);
    const get = (id: string) =>
      ctx.as(carol, { method: 'GET', url: `/x/suggestion-batches/${id}` });
    expect(status((await get(first.id)).json<Batch>())).toEqual({ '_:i1': 'accepted' });
    expect((await get(unrelated.id)).json<Batch>().counts.pending).toBe(1);
    expect((await get(second.id)).json<Batch>().counts.pending).toBe(1);

    // A run with nothing decided goes altogether.
    const third = await batchOf(alice, [individual('_:i3', 'II-3')], key);
    expect((await get(second.id)).statusCode).toBe(404);
    expect((await get(third.id)).statusCode).toBe(200);
  });

  it('lets a member delete a batch', async () => {
    const batch = await batchOf(alice, [individual('_:i1', 'II-1')]);
    expect(
      (await ctx.as(carol, { method: 'DELETE', url: `/x/suggestion-batches/${batch.id}` }))
        .statusCode,
    ).toBe(204);
    expect(
      (await ctx.as(alice, { method: 'GET', url: `/x/suggestion-batches/${batch.id}` })).statusCode,
    ).toBe(404);
  });
});
