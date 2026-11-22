import { answer, createFakeEndpoint } from '@anncur/extract/testing';
import {
  caseFamilyProfile,
  evidenceExcerptProfile,
  individualProfile,
  type BodyProfile,
} from '@anncur/model';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { GUEST_KEY } from '../guest';
import { createFakeGuest, type FakeGuest } from '../guest/fake';
import { useAnnotationsStore } from '../stores/annotations';
import { useProfilesStore } from '../stores/profiles';
import { installFakeApi, json, type FakeApi } from '../test/fake-api';
import SuggestPanel from './SuggestPanel.vue';

const PAGE = 'https://example.org/article';
const GROUP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEXT = 'Functional studies showed reduced activity. The variant was absent from gnomAD.';
const document = { uri: PAGE, title: 'Article', links: [{ uri: PAGE, relation: 'self' as const }] };

let api: FakeApi;
let guest: FakeGuest;
let profileList: BodyProfile[];

beforeEach(async () => {
  setActivePinia(createPinia());
  profileList = [evidenceExcerptProfile];
  config.extractEndpoints = [
    { label: 'LM Studio', url: 'http://127.0.0.1:1234', models: ['qwen'] },
  ];
  api = installFakeApi(({ method, url, body }) => {
    if (url.pathname === '/x/profiles') {
      return json(profileList.map((p) => ({ ...p, builtin: true, enabled: true })));
    }
    if (url.pathname === '/x/me') {
      return json({ id: 'u1', groups: [{ id: GROUP, name: 'Curators' }] });
    }
    if (method === 'POST' && url.pathname === '/x/suggestion-batches') {
      return json({ id: 'b1', body }, { status: 201 });
    }
    if (method === 'GET' && url.pathname === '/x/suggestion-batches') {
      return json({ total: 0, items: [] });
    }
    return undefined;
  });
  await useProfilesStore().load();
  guest = createFakeGuest({ document, text: [{ text: TEXT }] });
  vi.stubGlobal(
    'fetch',
    createFakeEndpoint(() =>
      answer([
        { quote: 'Functional studies showed reduced activity.', value: { kind: 'functional' } },
        { quote: 'The variant was absent from gnomAD.', value: { kind: 'population' } },
      ]),
    ).fetch,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  config.extractEndpoints = [];
});

function mountPanel() {
  return mount(SuggestPanel, { global: { provide: { [GUEST_KEY as symbol]: guest } } });
}

describe('SuggestPanel', () => {
  it('is not offered without an endpoint or a page that can send its text', () => {
    config.extractEndpoints = [];
    expect(mountPanel().find('section').exists()).toBe(false);
    config.extractEndpoints = [{ label: 'x', url: 'http://127.0.0.1:1234', models: [] }];
    guest.setText(undefined);
    expect(mountPanel().find('section').exists()).toBe(false);
  });

  it('says where the text goes, and posts what comes back for the chosen group', async () => {
    const wrapper = mountPanel();
    await wrapper.find('button').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('is sent to 127.0.0.1:1234 (LM Studio)');
    expect(wrapper.text()).toContain('saved for Curators to review');
    expect((wrapper.find('select[name="model"]').element as HTMLSelectElement).value).toBe('qwen');
    await wrapper.find('input[name="profile"]').setValue(true);
    await wrapper.find('form').trigger('submit');
    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('2 suggestions saved for review below'),
    );
    const post = api.calls.find(
      (c) => c.method === 'POST' && c.url.pathname === '/x/suggestion-batches',
    );
    expect(post?.body).toMatchObject({
      group: GROUP,
      engine: { nickname: 'qwen / prompt 3' },
      items: [
        { body: { profile: evidenceExcerptProfile.iri, value: { kind: 'functional' } } },
        { body: { profile: evidenceExcerptProfile.iri, value: { kind: 'population' } } },
      ],
    });
    // The review below is told to look for the new batch.
    expect(
      api.calls.filter((c) => c.method === 'GET' && c.url.pathname === '/x/suggestion-batches'),
    ).toHaveLength(1);
  });

  it('drops a run whose page went away before the model answered', async () => {
    let release: () => void = () => undefined;
    const fake = createFakeEndpoint(
      () =>
        new Promise<string>(
          (resolve) =>
            (release = () =>
              resolve(
                answer([
                  { quote: 'The variant was absent from gnomAD.', value: { kind: 'population' } },
                ]),
              )),
        ),
    );
    vi.stubGlobal('fetch', fake.fetch);
    const wrapper = mountPanel();
    await wrapper.find('button').trigger('click');
    await flushPromises();
    await wrapper.find('input[name="profile"]').setValue(true);
    await wrapper.find('form').trigger('submit');
    await vi.waitFor(() => expect(fake.requests).toHaveLength(1));
    guest.setDocument('https://example.org/elsewhere');
    await flushPromises();
    release();
    await flushPromises();
    expect(api.calls.some((c) => c.url.pathname === '/x/suggestion-batches')).toBe(false);
  });

  it('asks for individuals too when facts have none to link to', async () => {
    profileList = [individualProfile, caseFamilyProfile];
    await useProfilesStore().load();
    const wrapper = mountPanel();
    await wrapper.find('button').trigger('click');
    await flushPromises();
    const kinds = wrapper.findAll('input[name="profile"]');
    await kinds[1]!.setValue(true);
    expect(wrapper.text()).toContain('choose Individual too, or save one on this page first');
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined();

    await kinds[0]!.setValue(true);
    expect(wrapper.text()).not.toContain('choose Individual too');
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeUndefined();

    // Or with an individual already saved on the page, facts alone will do.
    await kinds[0]!.setValue(false);
    useAnnotationsStore().upsert(
      {
        '@context': 'http://www.w3.org/ns/anno.jsonld',
        id: 'https://annotations.test/annotations/22222222-2222-4222-8222-222222222222',
        type: 'Annotation',
        target: { source: PAGE },
        body: { type: 'StructuredBody', profile: individualProfile.iri, value: { case: 'II-1' } },
      },
      PAGE,
    );
    await flushPromises();
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeUndefined();
  });
});
