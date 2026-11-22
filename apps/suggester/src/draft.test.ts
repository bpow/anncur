import { readFileSync } from 'node:fs';
import type { ResolveTerms } from '@anncur/extract';
import {
  ProfileRegistry,
  addAnnotationFormats,
  addProfileKeywords,
  builtinProfiles,
  casePhenotypesProfile,
  individualProfile,
} from '@anncur/model';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { articleFromBioc } from './bioc.ts';
import { checkDraft, type Draft, type DraftItem } from './draft.ts';

const article = articleFromBioc(
  JSON.parse(readFileSync(new URL('../test/PMC0000001.json', import.meta.url), 'utf8')) as unknown,
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
addAnnotationFormats(ajv);
addProfileKeywords(ajv);
const registry = new ProfileRegistry(ajv, builtinProfiles);
const terms: ResolveTerms = (_ontology, labels) =>
  Promise.resolve(
    new Map(
      labels
        .filter((l) => l.toLowerCase() === 'syncope')
        .map((l) => [l, { id: 'HP:0001279', label: 'Syncope' }]),
    ),
  );
const check = (items: DraftItem[]) =>
  checkDraft(
    {
      article: 'PMC0000001',
      gene: 'MYH7',
      engine: { model: 'claude-opus-5-5', skill: 'anncur-suggest', version: '1' },
      items,
    } satisfies Draft,
    article,
    { profiles: builtinProfiles, registry, resolveTerms: terms },
  );

const individual: DraftItem = {
  id: '_:i1',
  kind: 'individual',
  passage: 2,
  quote: 'Patient 1, a 14-year-old boy, presented with syncope.',
  value: { case: 'Patient 1' },
};

describe('checkDraft', () => {
  it('turns a sound draft into a batch: quotes as selectors, labels as terms', async () => {
    const result = await check([
      individual,
      {
        id: '_:f1',
        kind: 'case-phenotypes',
        quote: 'presented with syncope.',
        value: { individuals: ['_:i1'], casePresentingHpos: ['syncope', 'odd gait'] },
      },
    ]);
    expect(result.problems).toEqual([]);
    expect(result.unresolved).toEqual([{ item: '_:f1', labels: ['odd gait'] }]);
    expect(result.batch).toMatchObject({
      document: article.document,
      engine: {
        name: 'claude-code',
        version: 'anncur-suggest 1',
        nickname: 'claude-opus-5-5 / anncur-suggest 1',
      },
      items: [
        {
          id: '_:i1',
          selector: { type: 'TextQuoteSelector', exact: individual.quote },
          body: { profile: individualProfile.iri, value: { case: 'Patient 1' } },
        },
        {
          id: '_:f1',
          selector: { type: 'TextQuoteSelector', exact: 'presented with syncope.' },
          body: {
            profile: casePhenotypesProfile.iri,
            value: {
              individuals: ['_:i1'],
              casePresentingHpos: [{ id: 'HP:0001279', label: 'Syncope' }, { label: 'odd gait' }],
            },
          },
        },
      ],
    });
    expect(result.batch?.items[1]?.selector).toHaveProperty('prefix');
  });

  it('says item by item what has to change', async () => {
    const result = await check([
      individual,
      { ...individual, id: '_:i2' },
      {
        id: '_:f1',
        kind: 'case-family',
        passage: 3,
        quote: 'His parents were first cousins.',
        value: { individuals: ['_:i1'], familyInfo: 'Consanguineous.' },
      },
      { id: '_:f2', kind: 'case-nonsense', quote: individual.quote, value: {} },
      {
        id: '_:f3',
        kind: 'case-family',
        quote: 'His parents are first cousins.',
        value: { individuals: ['_:nobody'], familyInfo: 'Consanguineous.' },
      },
      { id: '_:x', kind: 'case-individual', quote: individual.quote, value: {} },
    ]);
    expect(result.batch).toBeUndefined();
    expect(result.problems).toEqual(
      expect.arrayContaining([
        { item: '_:i2', message: 'says the same as _:i1 on the same quote' },
        {
          item: '_:f1',
          path: 'quote',
          message: expect.stringContaining(
            'not in the article word for word (passage 3)',
          ) as unknown,
        },
        { item: '_:f2', path: 'kind', message: 'there is no kind case-nonsense' },
        { item: '_:f3', path: 'value/individuals', message: 'no item _:nobody in this batch' },
        {
          item: '_:x',
          path: 'kind',
          message: 'case-individual is computed from facts, not suggested',
        },
      ]),
    );
  });

  it('replaces an ontology id the lookup does not confirm', async () => {
    const result = await check([
      individual,
      {
        id: '_:f1',
        kind: 'case-phenotypes',
        quote: 'presented with syncope.',
        value: {
          individuals: ['_:i1'],
          casePresentingHpos: [{ id: 'HP:9999999', label: 'Syncope' }],
        },
      },
    ]);
    expect(result.replacedIds).toEqual([
      { item: '_:f1', given: 'HP:9999999', label: 'Syncope', now: 'HP:0001279' },
    ]);
    expect(result.problems).toEqual([]);
  });
});
