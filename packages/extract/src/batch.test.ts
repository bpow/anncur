import {
  addProfileKeywords,
  builtinProfiles,
  caseFamilyProfile,
  evidenceExcerptProfile,
  individualProfile,
  ProfileRegistry,
  type StructuredBody,
} from '@curanno/model';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { extractBatch, runOrder } from './batch.js';
import { answer, createFakeEndpoint } from './testing.js';

const registry = new ProfileRegistry(
  addProfileKeywords(new Ajv2020({ strict: true, allErrors: true })),
  builtinProfiles,
);
const validate = (body: StructuredBody) => {
  const result = registry.validate(body);
  return result && !result.ok ? result.errors : [];
};
const TEXT = 'Patient 2 was unaffected. Her parents are cousins.';
const scopes = [{ key: 'body', text: TEXT }];

describe('runOrder', () => {
  it('asks about the kinds others link to first', () => {
    expect(runOrder([caseFamilyProfile, evidenceExcerptProfile, individualProfile])).toEqual([
      individualProfile,
      evidenceExcerptProfile,
      caseFamilyProfile,
    ]);
  });
});

describe('extractBatch', () => {
  it('links facts to the individuals of the same batch, and to saved ones', async () => {
    const fake = createFakeEndpoint((request) =>
      JSON.stringify(request.response_format).includes('familyInfo')
        ? answer([
            {
              quote: 'Her parents are cousins.',
              value: { individuals: ['Patient 2', 'II-1'], familyInfo: 'Consanguineous.' },
            },
          ])
        : answer([{ quote: 'Patient 2 was unaffected.', value: { case: 'Patient 2' } }]),
    );
    const progress: string[] = [];
    const result = await extractBatch(
      {
        scopes,
        profiles: [caseFamilyProfile, individualProfile],
        saved: () => [{ id: 'https://a.test/annotations/1', label: 'II-1' }],
      },
      { url: 'http://localhost:1234', model: 'm' },
      {
        validate,
        fetch: fake.fetch,
        onProgress: (p) => progress.push(`${p.kind} ${p.step}/${p.steps}`),
      },
    );
    expect(result.items.map((i) => [i.id, i.profile, i.value])).toEqual([
      ['_:s1', individualProfile.iri, { case: 'Patient 2' }],
      [
        '_:s2',
        caseFamilyProfile.iri,
        { familyInfo: 'Consanguineous.', individuals: ['_:s1', 'https://a.test/annotations/1'] },
      ],
    ]);
    expect(result.items[1]?.selectors.quote.exact).toBe('Her parents are cousins.');
    expect(progress).toEqual(['Individual 1/2', 'Case family history 2/2']);
  });

  it('skips a kind with nothing to link to, without asking', async () => {
    const fake = createFakeEndpoint(() => answer([]));
    const result = await extractBatch(
      { scopes, profiles: [caseFamilyProfile] },
      { url: 'http://localhost:1234', model: 'm' },
      { validate, fetch: fake.fetch },
    );
    expect(result).toEqual({ items: [], rejected: 0, skipped: [caseFamilyProfile.title] });
    expect(fake.requests).toHaveLength(0);
  });

  it('sends an API key as a bearer token when one is given', async () => {
    let auth: string | null = null;
    const fake = createFakeEndpoint(() => answer([]));
    const spy: typeof fetch = (input, init) => {
      auth = new Headers(init?.headers).get('authorization');
      return fake.fetch(input, init);
    };
    await extractBatch(
      { scopes, profiles: [evidenceExcerptProfile] },
      { url: 'https://llm.example', model: 'm', apiKey: 'sk-test' },
      { validate, fetch: spy },
    );
    expect(auth).toBe('Bearer sk-test');
  });
});
