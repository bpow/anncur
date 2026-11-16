import { answer, createFakeEndpoint } from '@curanno/extract/testing';
import {
  caseFamilyProfile,
  caseIndividualProfile,
  evidenceExcerptProfile,
  individualProfile,
} from '@curanno/model';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeGuest } from '../guest/fake';
import { installFakeApi, json, type FakeApi } from '../test/fake-api';
import { useProfilesStore } from './profiles';
import { useSuggestionsStore } from './suggestions';

const PAGE = 'https://example.org/article';
const TEXT = 'Patient 1 had seizures and ataxia.Patient 2 was unaffected.';
const endpoint = { label: 'Local', url: 'http://127.0.0.1:1234', models: ['m'] };
const document = { uri: PAGE, title: 'Article', links: [{ uri: PAGE, relation: 'self' as const }] };

const GROUP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let api: FakeApi;

beforeEach(async () => {
  setActivePinia(createPinia());
  api = installFakeApi(({ method, url }) => {
    if (method === 'POST' && url.pathname === '/x/suggestion-batches') {
      return json({ id: 'b1' }, { status: 201 });
    }
    if (url.pathname === '/x/profiles') {
      return json(
        [evidenceExcerptProfile, caseIndividualProfile, individualProfile, caseFamilyProfile].map(
          (p) => ({
            ...p,
            builtin: true,
            enabled: true,
          }),
        ),
      );
    }
    if (url.pathname === '/x/ontologies/hp/terms') {
      const q = url.searchParams.get('q');
      return json(
        q === 'Seizures' ? [{ id: 'HP:0001250', label: 'Seizure', synonym: 'Seizures' }] : [],
      );
    }
    return undefined;
  });
  await useProfilesStore().load();
});

afterEach(() => vi.unstubAllGlobals());

function model(suggestions: { quote: string; value: unknown }[]) {
  const fake = createFakeEndpoint(() => answer(suggestions));
  vi.stubGlobal('fetch', fake.fetch);
  return fake;
}

const run = (...profiles: (typeof evidenceExcerptProfile)[]) => ({
  document,
  profiles,
  group: GROUP,
  endpoint,
  model: 'm',
});
const posted = () =>
  api.calls
    .filter((c) => c.method === 'POST' && c.url.pathname === '/x/suggestion-batches')
    .map(
      (c) =>
        c.body as {
          group: string;
          engine: unknown;
          items: { id: string; selector: unknown; body: { profile: string; value: unknown } }[];
        },
    );

describe('suggestions store', () => {
  it('asks the model about the page and posts what comes back as a batch for the group', async () => {
    const guest = createFakeGuest({ document, text: [{ text: TEXT, blockStarts: [34] }] });
    const fake = model([
      {
        quote: 'Patient 1 had seizures and ataxia.',
        value: {
          case: 'Patient 1',
          variants: [{ variant: 'c.1A>G' }],
          casePresentingHpos: ['Seizures', 'ataxia'],
        },
      },
      {
        quote: 'Patient 3 was never mentioned.',
        value: { case: 'Patient 3', variants: [{ variant: 'x' }] },
      },
    ]);
    const store = useSuggestionsStore();
    await store.run(guest, run(caseIndividualProfile));

    expect(store.status).toBe('done');
    expect(store.rejected).toBe(1);
    expect(store.posted).toBe(1);
    expect(fake.requests[0]?.model).toBe('m');
    const [batch] = posted();
    expect(batch).toMatchObject({
      group: GROUP,
      document: { uri: PAGE, title: 'Article', links: [{ uri: PAGE, relation: 'self' }] },
      engine: { name: 'curanno-extract', version: 'prompt 3', nickname: 'm / prompt 3' },
      items: [
        {
          id: '_:s1',
          selector: [
            { type: 'TextQuoteSelector', exact: 'Patient 1 had seizures and ataxia.' },
            { type: 'TextPositionSelector', start: 0, end: 34 },
          ],
          body: {
            profile: caseIndividualProfile.iri,
            value: {
              casePresentingHpos: [{ id: 'HP:0001250', label: 'Seizure' }, { label: 'ataxia' }],
            },
          },
        },
      ],
    });
  });

  it('puts a PDF page suggestion inside its page fragment', async () => {
    const guest = createFakeGuest({
      document,
      text: [
        { text: 'Front page.', page: 1 },
        { text: TEXT, page: 2 },
      ],
    });
    model([{ quote: 'Patient 2 was unaffected.', value: { kind: 'case' } }]);
    await useSuggestionsStore().run(guest, run(evidenceExcerptProfile));
    expect(posted()[0]?.items[0]?.selector).toEqual([
      {
        type: 'FragmentSelector',
        conformsTo: 'http://tools.ietf.org/rfc/rfc3778',
        value: 'page=2',
        refinedBy: [
          expect.objectContaining({
            type: 'TextQuoteSelector',
            exact: 'Patient 2 was unaffected.',
          }),
          { type: 'TextPositionSelector', start: 34, end: 59 },
        ],
      },
    ]);
  });

  it('links facts to the individuals suggested in the same run', async () => {
    const guest = createFakeGuest({ document, text: [{ text: TEXT }] });
    const fake = createFakeEndpoint((request) =>
      JSON.stringify(request.response_format).includes('familyInfo')
        ? answer([
            {
              quote: 'Patient 2 was unaffected.',
              value: { individuals: ['Patient 2'], familyInfo: 'Unaffected.' },
            },
          ])
        : answer([{ quote: 'Patient 2 was unaffected.', value: { case: 'Patient 2' } }]),
    );
    vi.stubGlobal('fetch', fake.fetch);
    const store = useSuggestionsStore();
    await store.run(guest, run(caseFamilyProfile, individualProfile));
    expect(store.status).toBe('done');
    expect(posted()[0]?.items.map((i) => [i.id, i.body.value])).toEqual([
      ['_:s1', { case: 'Patient 2' }],
      ['_:s2', { familyInfo: 'Unaffected.', individuals: ['_:s1'] }],
    ]);
    // The facts were asked with the run's individuals to choose from.
    expect(JSON.stringify(fake.requests[1]?.response_format)).toContain('"enum":["Patient 2"]');
  });

  it('leaves out a kind with nothing to link to, and posts nothing when nothing came back', async () => {
    const guest = createFakeGuest({ document, text: [{ text: TEXT }] });
    const fake = model([]);
    const store = useSuggestionsStore();
    await store.run(guest, run(caseFamilyProfile));
    expect(store.status).toBe('done');
    expect(store.skipped).toEqual([caseFamilyProfile.title]);
    expect(fake.requests).toHaveLength(0);
    expect(posted()).toEqual([]);
  });

  it('says what went wrong', async () => {
    const store = useSuggestionsStore();
    const silent = createFakeGuest({ document });
    await store.run(silent, run(evidenceExcerptProfile));
    expect(store.status).toBe('failed');
    expect(store.error).toMatch(/cannot send its text/);

    const guest = createFakeGuest({ document, text: [{ text: TEXT }] });
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    await store.run(guest, run(evidenceExcerptProfile));
    expect(store.status).toBe('failed');
    expect(store.error).toMatch(/could not reach http:\/\/127\.0\.0\.1:1234/);
  });

  it('stops when cancelled', async () => {
    const guest = createFakeGuest({ document, text: [{ text: TEXT }] });
    let release: () => void = () => undefined;
    const fake = createFakeEndpoint(
      () => new Promise<string>((resolve) => (release = () => resolve(answer([])))),
    );
    vi.stubGlobal('fetch', fake.fetch);
    const store = useSuggestionsStore();
    const running = store.run(guest, run(evidenceExcerptProfile));
    await vi.waitFor(() => expect(fake.requests).toHaveLength(1));
    store.cancel();
    release();
    await running;
    expect(store.status).toBe('cancelled');
    expect(posted()).toEqual([]);
  });

  it('stops while the page is still reading out its text', async () => {
    const guest = createFakeGuest({ document, text: [{ text: TEXT }] });
    guest.requestText = () => new Promise(() => undefined);
    const fake = model([]);
    const store = useSuggestionsStore();
    const running = store.run(guest, run(evidenceExcerptProfile));
    expect(store.status).toBe('reading');
    store.cancel();
    await running;
    expect(store.status).toBe('cancelled');
    expect(fake.requests).toHaveLength(0);
  });
});
