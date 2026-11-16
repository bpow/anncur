import type { Annotation, SuggestionBatch } from '@curanno/api-client';
import { caseFamilyProfile, individualProfile } from '@curanno/model';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { TooltipProvider } from 'reka-ui';
import { beforeEach, describe, expect, it } from 'vitest';
import { h } from 'vue';
import { forgetCurrentUser } from '../current-user';
import { GUEST_KEY } from '../guest';
import { createFakeGuest, type FakeGuest } from '../guest/fake';
import { useAnnotationsStore } from '../stores/annotations';
import { useProfilesStore } from '../stores/profiles';
import { installFakeApi, json, type FakeApi } from '../test/fake-api';
import BatchReview from './BatchReview.vue';

const PAGE = 'https://example.org/article';
const BASE = 'https://annotations.test/annotations/';
const GROUP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BATCH = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const quote = (exact: string) => ({ type: 'TextQuoteSelector', exact });

function batchOf(statuses: Record<string, string> = {}): SuggestionBatch {
  const items = [
    {
      id: '_:i1',
      selector: quote('II-1, a boy of 12'),
      body: { type: 'StructuredBody', profile: individualProfile.iri, value: { case: 'II-1' } },
    },
    {
      id: '_:f1',
      selector: quote('His parents are cousins.'),
      body: {
        type: 'StructuredBody',
        profile: caseFamilyProfile.iri,
        value: { individuals: ['_:i1'], familyInfo: 'Parents are cousins.' },
      },
    },
  ].map((i) => ({ ...i, status: statuses[i.id] ?? 'pending' }));
  const pending = items.filter((i) => i.status === 'pending').length;
  return {
    id: BATCH,
    group: GROUP,
    groupName: 'Curators',
    document: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    engine: { name: 'curanno-extract', version: '0.3.0', nickname: 'qwen / prompt 3' },
    creator: GROUP,
    created: '2026-11-15T10:00:00Z',
    counts: { pending, accepted: items.length - pending, rejected: 0 },
    items,
  } as SuggestionBatch;
}

let api: FakeApi;
let guest: FakeGuest;
let batch: SuggestionBatch;

beforeEach(async () => {
  setActivePinia(createPinia());
  forgetCurrentUser();
  batch = batchOf();
  let next = 1;
  api = installFakeApi(({ method, url, body }) => {
    const path = url.pathname;
    if (path === '/x/profiles') {
      return json(
        [individualProfile, caseFamilyProfile].map((p) => ({ ...p, builtin: true, enabled: true })),
      );
    }
    if (path === '/x/me') return json({ iri: 'https://annotations.test/x/users/7' });
    if (path === '/x/suggestion-batches' && method === 'GET') {
      const listed = batch.counts.pending ? [batch] : [];
      return json({ total: listed.length, items: listed });
    }
    if (path === `/x/suggestion-batches/${BATCH}`) return json(batch);
    if (path === `/x/suggestion-batches/${BATCH}/accept`) {
      const items = (body as { items: { id: string; existing?: string }[] }).items;
      const decided = items.map((i) => ({
        id: i.id,
        annotation: i.existing ?? `${BASE}${next++}`,
      }));
      batch = batchOf(Object.fromEntries(items.map((i) => [i.id, 'accepted'])));
      return json({ items: decided });
    }
    if (path === `/x/suggestion-batches/${BATCH}/reject`) {
      batch = batchOf({ '_:i1': 'rejected', '_:f1': 'rejected' });
      return json(batch);
    }
    if (path.startsWith('/annotations/') && method === 'GET') {
      const id = `${BASE}${path.split('/').pop()}`;
      return json({ id, type: 'Annotation', target: { source: PAGE } });
    }
    if (path.endsWith('/acl') && method === 'PUT') return json([]);
    return undefined;
  });
  await useProfilesStore().load();
  guest = createFakeGuest({ document: { uri: PAGE, links: [] } });
});

const mountReview = () =>
  mount(() => h(TooltipProvider, () => h(BatchReview)), {
    global: { provide: { [GUEST_KEY as symbol]: guest } },
  });

describe('BatchReview', () => {
  it("shows a group's pending batch on the page, a fact under its individual", async () => {
    const wrapper = mountReview();
    await flushPromises();
    expect(api.calls.find((c) => c.url.pathname === '/x/suggestion-batches')?.url.search).toContain(
      `uri=${encodeURIComponent(PAGE)}`,
    );
    const section = wrapper.find('section.batch');
    expect(section.text()).toContain('qwen / prompt 3');
    expect(section.text()).toContain('for Curators');
    expect(section.find('.members').text()).toContain('His parents are cousins.');
    // The fact names its individual by the suggestion's label.
    expect(section.find('.members').text()).toContain('II-1 (suggested)');
    expect([...guest.anchoring.value.keys()]).toHaveLength(2);
  });

  it('does not reload when the guest republishes the same documents', async () => {
    mountReview();
    await flushPromises();
    const loads = () => api.calls.filter((c) => c.url.pathname.startsWith('/x/suggestion-batches'));
    const before = loads().length;
    guest.setDocument(PAGE);
    await flushPromises();
    expect(loads()).toHaveLength(before);
  });

  it('saves an individual with its facts in one request, shared with the group', async () => {
    const wrapper = mountReview();
    await flushPromises();
    const button = wrapper.findAll('button').find((b) => b.text().startsWith('Save with its'));
    await button!.trigger('click');
    await flushPromises();

    const accept = api.calls.find((c) => c.url.pathname.endsWith('/accept'));
    const items = (accept?.body as { items: { id: string; annotation: Annotation }[] }).items;
    expect(items.map((i) => i.id)).toEqual(['_:i1', '_:f1']);
    expect(items[1]?.annotation).toMatchObject({
      target: { source: PAGE, selector: quote('His parents are cousins.') },
      body: {
        profile: caseFamilyProfile.iri,
        value: { individuals: ['_:i1'], familyInfo: 'Parents are cousins.' },
        creator: { type: 'Software', name: 'curanno-extract', nickname: 'qwen / prompt 3' },
      },
    });
    const shares = api.calls.filter((c) => c.method === 'PUT' && c.url.pathname.endsWith('/acl'));
    expect(shares.map((c) => c.body)).toEqual([
      [{ principal: GROUP, permission: 'read' }],
      [{ principal: GROUP, permission: 'read' }],
    ]);
    expect(useAnnotationsStore().rootsOf(PAGE)).toHaveLength(2);
    expect(wrapper.find('section.batch').exists()).toBe(false);
    expect(guest.anchoring.value.size).toBe(0);
  });

  it('saves a reviewed fact that links to its suggested individual', async () => {
    const wrapper = mountReview();
    await flushPromises();
    const fact = wrapper.find('.members li.suggestion');
    await fact.findAll('button').find((b) => b.text() === 'Review and save')!.trigger('click');
    await fact.find('form.editor').trigger('submit');
    await flushPromises();
    const accept = api.calls.find((c) => c.url.pathname.endsWith('/accept'));
    const items = (accept?.body as { items: { id: string }[] }).items;
    expect(items.map((i) => i.id)).toEqual(['_:i1', '_:f1']);
  });

  it('takes an individual as one already on the page', async () => {
    const saved = `${BASE}99`;
    useAnnotationsStore().upsert(
      {
        id: saved,
        type: 'Annotation',
        target: { source: PAGE },
        body: { type: 'StructuredBody', profile: individualProfile.iri, value: { case: 'II-1' } },
      } as Annotation,
      PAGE,
    );
    const wrapper = mountReview();
    await flushPromises();
    await wrapper.find('label.same select').setValue(saved);
    await flushPromises();
    const accept = api.calls.find((c) => c.url.pathname.endsWith('/accept'));
    expect(accept?.body).toEqual({ items: [{ id: '_:i1', existing: saved }] });
  });

  it('rejects a suggestion', async () => {
    const wrapper = mountReview();
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Reject')!
      .trigger('click');
    await flushPromises();
    expect(api.calls.find((c) => c.url.pathname.endsWith('/reject'))?.body).toEqual({
      items: ['_:i1'],
    });
    expect(wrapper.find('section.batch').exists()).toBe(false);
  });
});
