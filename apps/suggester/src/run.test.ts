import { readFileSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApiClient } from '@curanno/api-client';
import { answer, createFakeEndpoint } from '@curanno/extract/testing';
import { builtinProfiles, caseFamilyProfile, individualProfile } from '@curanno/model';
import { describe, expect, it } from 'vitest';
import { articleFromBioc } from './bioc.ts';
import { loadProfiles, rerunKey, suggestFor } from './run.ts';
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
    const profiles = await loadProfiles(api, ['case-family', 'individual/1']);
    expect(profiles.chosen.map((p) => p.iri)).toEqual([
      caseFamilyProfile.iri,
      individualProfile.iri,
    ]);
    const outcome = await suggestFor(article, {
      api,
      group: GROUP,
      endpoint: { url: 'http://127.0.0.1:1234', model: 'qwen' },
      profiles,
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
        key: rerunKey(profiles.chosen),
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

  it('refuses a profile that is computed or unknown', async () => {
    const { api } = fakeApi();
    await expect(loadProfiles(api, ['case-individual'])).rejects.toThrow(/computed/);
    await expect(loadProfiles(api, ['nothing'])).rejects.toThrow(/no profile nothing/);
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
});
