import { readFileSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApiClient } from '@curanno/api-client';
import { answer, createFakeEndpoint } from '@curanno/extract/testing';
import { builtinProfiles, caseFamilyProfile, individualProfile } from '@curanno/model';
import { describe, expect, it } from 'vitest';
import { articleFromBioc } from './bioc.ts';
import { loadProfiles, profileForKind, rerunKey } from './profiles.ts';
import { runKey, suggestFor } from './run.ts';
import { State } from './state.ts';

const article = articleFromBioc(
  JSON.parse(readFileSync(new URL('../test/PMC0000001.json', import.meta.url), 'utf8')) as unknown,
);
const GROUP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function fakeApi() {
  const posted: unknown[] = [];
  const auth: (string | null)[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    const request = input as Request;
    auth.push(request.headers.get('authorization'));
    const url = new URL(request.url);
    if (url.pathname === '/x/profiles') {
      return Response.json(builtinProfiles.map((p) => ({ ...p, builtin: true, enabled: true })));
    }
    if (url.pathname === '/x/suggestion-batches') {
      posted.push(await request.json());
      return Response.json({ id: 'b1' }, { status: 201 });
    }
    return Response.json([]);
  };
  return {
    posted,
    auth,
    api: createApiClient({ baseUrl: 'https://curanno.test', token: () => 'cat_x', fetch }),
  };
}

describe('suggestFor', () => {
  it('posts individuals and the facts linked to them as one batch, by quote only', async () => {
    const { api, posted, auth } = fakeApi();
    const model = createFakeEndpoint((request) =>
      JSON.stringify(request.response_format).includes('familyInfo')
        ? answer([
            {
              quote: 'His parents are first cousins.',
              value: { individuals: ['Patient 1'], familyInfo: 'Consanguineous.' },
            },
          ])
        : answer([
            {
              quote: 'Patient 1, a 14-year-old boy, presented with syncope.',
              value: { case: 'Patient 1' },
            },
          ]),
    );
    const { all, validate } = await loadProfiles(api);
    const kinds = ['case-family', 'individual/1'].map((k) => profileForKind(all, k));
    expect(kinds.map((p) => p.iri)).toEqual([caseFamilyProfile.iri, individualProfile.iri]);
    const outcome = await suggestFor(article, {
      api,
      group: GROUP,
      endpoint: { url: 'http://127.0.0.1:1234', model: 'qwen' },
      kinds,
      validate,
      fetch: model.fetch,
    });
    expect(outcome).toMatchObject({ items: 2, rejected: 0, skipped: [], batch: 'b1' });
    expect(auth.every((a) => a === 'Bearer cat_x')).toBe(true);
    // Only the quote selector: a position in PMC's text means nothing on another copy.
    const items = (posted[0] as { items: { selector: unknown }[] }).items;
    expect(items.every((i) => !Array.isArray(i.selector))).toBe(true);
    expect(posted).toMatchObject([
      {
        group: GROUP,
        document: article.document,
        engine: {
          name: 'curanno-suggester',
          version: '0.1.0 / prompt 3',
          nickname: 'qwen / prompt 3',
        },
        key: rerunKey(kinds),
        items: [
          {
            id: '_:s1',
            selector: {
              type: 'TextQuoteSelector',
              exact: 'Patient 1, a 14-year-old boy, presented with syncope.',
            },
            body: {
              type: 'StructuredBody',
              profile: individualProfile.iri,
              value: { case: 'Patient 1' },
            },
          },
          {
            id: '_:s2',
            selector: { type: 'TextQuoteSelector', exact: 'His parents are first cousins.' },
            body: {
              type: 'StructuredBody',
              profile: caseFamilyProfile.iri,
              value: { familyInfo: 'Consanguineous.', individuals: ['_:s1'] },
            },
          },
        ],
      },
    ]);
  });

  it('refuses a kind that is computed or unknown', async () => {
    const { api } = fakeApi();
    const { all } = await loadProfiles(api);
    expect(() => profileForKind(all, 'case-individual')).toThrow(/computed/);
    expect(() => profileForKind(all, 'nothing')).toThrow(/no kind nothing/);
  });
});

describe('State', () => {
  it('remembers what each run has done, across opens', async () => {
    const file = path.join(await mkdtemp(path.join(tmpdir(), 'suggester-')), 'state.json');
    const state = await State.open(file);
    expect(state.isDone('PMC1', 'run-a')).toBe(false);
    await state.record('PMC1', 'run-a', 'b1');
    const again = await State.open(file);
    expect(again.isDone('PMC1', 'run-a')).toBe(true);
    expect(again.isDone('PMC1', 'run-b')).toBe(false);
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 1 });
  });

  const identity = {
    apiUrl: 'https://curanno.test',
    group: GROUP,
    endpoint: { url: 'http://localhost:1234', model: 'qwen' },
    kinds: [individualProfile],
    instructions: 'Only cases in MYH7',
  };
  it.each([
    { ...identity, apiUrl: 'https://another-curanno.test' },
    { ...identity, group: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    { ...identity, endpoint: { ...identity.endpoint, url: 'http://localhost:4321' } },
    { ...identity, endpoint: { ...identity.endpoint, model: 'another-model' } },
    { ...identity, instructions: 'Only cases in MYBPC3' },
    {
      ...identity,
      kinds: [{ ...individualProfile, schema: { ...individualProfile.schema, required: [] } }],
    },
  ])('does not reuse a checkpoint after the run configuration changes: %j', async (changed) => {
    const file = path.join(await mkdtemp(path.join(tmpdir(), 'suggester-')), 'state.json');
    const state = await State.open(file);
    await state.record('PMC1', runKey(identity), 'b1');
    const again = await State.open(file);
    expect(again.isDone('PMC1', runKey(identity))).toBe(true);
    expect(again.isDone('PMC1', runKey(changed))).toBe(false);
  });

  it('normalizes equivalent destinations and profile order without mutating the inputs', () => {
    const kinds = [individualProfile, caseFamilyProfile];
    const first = runKey({ ...identity, kinds });
    expect(
      runKey({
        ...identity,
        apiUrl: `${identity.apiUrl}/`,
        endpoint: { ...identity.endpoint, url: `${identity.endpoint.url}/v1/` },
        kinds: [...kinds].reverse(),
        instructions: ` ${identity.instructions} `,
      }),
    ).toBe(first);
    expect(kinds).toEqual([individualProfile, caseFamilyProfile]);
  });

  it('ignores profile bookkeeping timestamps returned by the API', () => {
    const listed = {
      ...individualProfile,
      builtin: true,
      enabled: true,
      modified: '2026-11-18T10:00:00Z',
    };
    expect(runKey({ ...identity, kinds: [listed] })).toBe(runKey(identity));
  });
});
