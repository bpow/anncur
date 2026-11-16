import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../annotation/types.js';
import {
  builtinProfiles,
  caseDiseaseProfile,
  caseFamilyProfile,
  casePhenotypesProfile,
  caseVariantProfile,
  individualProfile,
} from './builtin.js';
import { addProfileKeywords } from './keywords.js';
import { ProfileRegistry } from './registry.js';
import { summarizeIndividuals } from './summary.js';

const registry = new ProfileRegistry(
  addProfileKeywords(new Ajv2020({ strict: true, allErrors: true })),
  builtinProfiles,
);
const validate = (body: Parameters<ProfileRegistry['validate']>[0]) => {
  const result = registry.validate(body);
  return result && !result.ok ? result.errors : [];
};

const iri = (n: number) => `https://x.example/annotations/${n}`;
const annotation = (n: number, profile: string, value: JsonValue) => ({
  id: iri(n),
  body: { type: 'StructuredBody', profile, value },
});
const fact = (
  n: number,
  profile: string,
  individuals: number | number[],
  value: Record<string, JsonValue>,
) => annotation(n, profile, { individuals: [individuals].flat().map(iri), ...value });

describe('summarizeIndividuals', () => {
  it('computes a case-individual value from the facts that link to each individual', () => {
    const { individuals, unlinked } = summarizeIndividuals(
      [
        annotation(1, individualProfile.iri, { case: 'II-1', previouslyPublished: 'PMID:1' }),
        annotation(2, individualProfile.iri, { case: 'II-2' }),
        fact(3, caseVariantProfile.iri, 1, { geneName: 'MYH7', variant: 'c.1208G>A' }),
        fact(4, casePhenotypesProfile.iri, 1, {
          casePresentingHpos: [{ id: 'HP:0001251', label: 'Ataxia' }],
          course: 'Progressive.',
        }),
        fact(5, casePhenotypesProfile.iri, 1, {
          casePresentingHpos: [{ id: 'HP:0001251', label: 'Ataxia' }, { label: 'gait trouble' }],
          caseNotHpos: [{ label: 'seizures' }],
        }),
        fact(6, caseFamilyProfile.iri, 1, { familyInfo: 'Father affected.' }),
        fact(7, caseFamilyProfile.iri, 1, { familyInfo: 'Parents are cousins.' }),
        fact(8, caseFamilyProfile.iri, 1, { familyInfo: 'Father affected.' }),
        fact(9, caseDiseaseProfile.iri, 2, { diseaseAssertion: 'HCM' }),
        fact(10, caseFamilyProfile.iri, 99, { familyInfo: 'Lost.' }),
        { id: iri(11), bodyValue: 'A comment, not a fact.' },
      ],
      validate,
    );
    expect(unlinked).toEqual([iri(10)]);
    const [first, second] = individuals;
    expect(first).toEqual({
      individual: iri(1),
      value: {
        case: 'II-1',
        previouslyPublished: 'PMID:1',
        variants: [{ geneName: 'MYH7', variant: 'c.1208G>A' }],
        casePresentingHpos: [{ id: 'HP:0001251', label: 'Ataxia' }, { label: 'gait trouble' }],
        caseNotHpos: [{ label: 'seizures' }],
        familyInfo: 'Father affected.; Parents are cousins.',
      },
      sources: {
        case: [iri(1)],
        previouslyPublished: [iri(1)],
        variants: [iri(3)],
        casePresentingHpos: [iri(4), iri(5)],
        caseNotHpos: [iri(5)],
        familyInfo: [iri(6), iri(7)],
      },
      facts: [iri(3), iri(4), iri(5), iri(6), iri(7), iri(8)],
      errors: [],
    });
    // No variant yet: the summary says what is missing.
    expect(second?.value).toEqual({ case: 'II-2', diseaseAssertion: 'HCM' });
    expect(second?.errors.map((e) => e.instancePath)).toEqual(['/value']);
  });

  it('adds one variant item per fact, once for a variant reported twice', () => {
    const { individuals } = summarizeIndividuals([
      annotation(1, individualProfile.iri, { case: 'P1' }),
      fact(2, caseVariantProfile.iri, 1, { variant: 'c.1A>G' }),
      fact(3, caseVariantProfile.iri, 1, { variant: 'c.2C>T', caid: 'CA1' }),
      fact(4, caseVariantProfile.iri, 1, { variant: 'c.1A>G' }),
    ]);
    expect(individuals[0]?.value['variants']).toEqual([
      { variant: 'c.1A>G' },
      { variant: 'c.2C>T', caid: 'CA1' },
    ]);
    expect(individuals[0]?.sources['variants']).toEqual([iri(2), iri(3)]);
  });

  it('counts a fact for every individual it names that the reader can see', () => {
    const { individuals, unlinked } = summarizeIndividuals([
      annotation(1, individualProfile.iri, { case: 'II-1' }),
      annotation(2, individualProfile.iri, { case: 'II-2' }),
      fact(3, caseDiseaseProfile.iri, [1, 2, 99], { diseaseAssertion: 'HCM' }),
      fact(4, caseFamilyProfile.iri, [98, 99], { familyInfo: 'Lost.' }),
    ]);
    expect(
      individuals.map((i) => [i.value['diseaseAssertion'], i.sources['diseaseAssertion']]),
    ).toEqual([
      ['HCM', [iri(3)]],
      ['HCM', [iri(3)]],
    ]);
    expect(unlinked).toEqual([iri(4)]);
  });
});
