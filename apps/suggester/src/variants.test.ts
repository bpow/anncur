import { builtinProfiles, caseVariantProfile } from '@curanno/model';
import { describe, expect, it } from 'vitest';
import type { Draft, DraftItem } from './draft.ts';
import {
  LookupUnavailable,
  lookUpVariants,
  variantField,
  type Resolve,
  type VariantResolution,
} from './variants.ts';

const myh7 = {
  caid: 'CA010365',
  title: 'NM_000257.4(MYH7):c.1208G>A (p.Arg403Gln)',
  geneSymbol: 'MYH7',
  hgvs: { transcript: 'NM_000257.4:c.1208G>A', protein: 'NP_000248.2:p.Arg403Gln' },
  clinVar: [{ variationId: '14087', url: 'https://www.ncbi.nlm.nih.gov/clinvar/variation/14087/' }],
  gnomad: '14-23429278-C-T',
  warnings: [],
} satisfies VariantResolution['candidates'][number];

const answer = (
  query: string,
  candidates: VariantResolution['candidates'],
  warnings: VariantResolution['warnings'] = [],
): VariantResolution => ({ query, candidates, warnings, steps: [] });

const variant = (id: string, value: Record<string, string>): DraftItem => ({
  id,
  kind: 'case-variant',
  quote: 'quote',
  value: { individuals: ['_:i1'], ...value },
});

const draft = (items: DraftItem[], notInBatch?: string[]): Draft => ({
  article: 'PMC0000001',
  gene: 'MYH7',
  engine: { model: 'model', skill: 'curanno-suggest', version: '1' },
  items,
  ...(notInBatch ? { notInBatch } : {}),
});

function resolver(answers: Record<string, VariantResolution | Error>) {
  const asked: [string, string | undefined][] = [];
  const resolve: Resolve = (q, gene) => {
    asked.push([q, gene]);
    const a = answers[q];
    if (!a) throw new Error(`unexpected query ${q}`);
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
  };
  return { resolve, asked };
}

describe('variantField', () => {
  it('finds the variant field of the case-variant profile', () => {
    expect(variantField(caseVariantProfile)).toMatchObject({
      field: 'variant',
      fields: { gene: 'geneName', caid: 'caid', idSource: 'idSource' },
    });
  });
});

describe('lookUpVariants', () => {
  it('fills the IDs of a single registered allele, with the draft’s gene', async () => {
    const { resolve, asked } = resolver({
      'c.1208G>A': answer(
        'c.1208G>A',
        [myh7],
        [{ code: 'transcript-assumed', message: 'MANE Select NM_000257.4 was used.' }],
      ),
    });
    const { draft: next, outcomes } = await lookUpVariants(
      draft([variant('_:v1', { variant: 'c.1208G>A' })]),
      { profiles: builtinProfiles, resolve },
    );
    expect(asked).toEqual([['c.1208G>A', 'MYH7']]);
    expect(next.items[0]!.value).toEqual({
      individuals: ['_:i1'],
      variant: 'c.1208G>A',
      caid: 'CA010365',
      clinVarId: '14087',
      gnomad: '14-23429278-C-T',
      idSource: 'looked up',
    });
    expect(outcomes).toEqual([
      {
        item: '_:v1',
        variant: 'c.1208G>A',
        outcome: 'filled',
        ids: { caid: 'CA010365', clinVarId: '14087', gnomad: '14-23429278-C-T' },
        notes: ['MANE Select NM_000257.4 was used.'],
      },
    ]);
    expect(next.notInBatch).toBeUndefined();
  });

  it('prefers the fact’s own gene', async () => {
    const { resolve, asked } = resolver({ 'c.1A>G': answer('c.1A>G', [myh7]) });
    await lookUpVariants(draft([variant('_:v1', { variant: 'c.1A>G', geneName: 'TNNT2' })]), {
      profiles: builtinProfiles,
      resolve,
    });
    expect(asked).toEqual([['c.1A>G', 'TNNT2']]);
  });

  it('leaves stated IDs, unresolvable variants and other kinds alone', async () => {
    const { resolve, asked } = resolver({});
    const items: DraftItem[] = [
      variant('_:v1', { variant: 'c.1A>G', clinVarId: '1', idSource: 'stated' }),
      variant('_:v2', { variant: 'exon 3 deletion', idSource: 'unresolvable' }),
      { id: '_:i1', kind: 'individual', quote: 'q', value: { case: 'II-1' } },
    ];
    const { draft: next, outcomes } = await lookUpVariants(draft(items), {
      profiles: builtinProfiles,
      resolve,
    });
    expect(asked).toEqual([]);
    expect(outcomes).toEqual([]);
    expect(next.items).toEqual(items);
  });

  it('leaves a choice to the curator, with the candidates under notInBatch', async () => {
    const other = { ...myh7, caid: 'CA2', title: 'NM_000257.4(MYH7):c.1207C>A', clinVar: [] };
    const { resolve } = resolver({
      'p.R403Q': answer(
        'p.R403Q',
        [myh7, other],
        [
          { code: 'protein-only', message: 'Only a protein change was given.' },
          { code: 'several-candidates', message: '2 registered cDNA changes produce it.' },
        ],
      ),
      'NM_000257.4:c.1208C>A': answer(
        'NM_000257.4:c.1208C>A',
        [],
        [{ code: 'reference-mismatch', message: 'given=C, found=G.' }],
      ),
    });
    const { draft: next, outcomes } = await lookUpVariants(
      draft(
        [
          variant('_:v1', { variant: 'p.R403Q' }),
          variant('_:v2', { variant: 'NM_000257.4:c.1208C>A' }),
        ],
        ['Patient 7 is only in the supplement.', 'Variant lookup _:v9: an earlier run.'],
      ),
      { profiles: builtinProfiles, resolve },
    );
    expect(outcomes.map((o) => o.outcome)).toEqual(['left', 'left']);
    expect(next.items.map((i) => i.value)).toEqual([
      { individuals: ['_:i1'], variant: 'p.R403Q' },
      { individuals: ['_:i1'], variant: 'NM_000257.4:c.1208C>A' },
    ]);
    expect(next.notInBatch).toEqual([
      'Patient 7 is only in the supplement.',
      'Variant lookup _:v1: p.R403Q needs a curator to choose: NM_000257.4(MYH7):c.1208G>A (p.Arg403Gln) (CA010365, ClinVar 14087); NM_000257.4(MYH7):c.1207C>A (CA2). Only a protein change was given. 2 registered cDNA changes produce it.',
      'Variant lookup _:v2: NM_000257.4:c.1208C>A found no allele. given=C, found=G.',
    ]);
  });

  it('does not fill a candidate the lookup has doubts about', async () => {
    const doubtful = {
      ...myh7,
      warnings: [{ code: 'protein-differs' as const, message: 'The article gives p.Arg403Trp.' }],
    };
    const { resolve } = resolver({ 'c.1208G>A (p.Arg403Trp)': answer('q', [doubtful]) });
    const { outcomes } = await lookUpVariants(
      draft([variant('_:v1', { variant: 'c.1208G>A (p.Arg403Trp)' })]),
      { profiles: builtinProfiles, resolve },
    );
    expect(outcomes[0]).toMatchObject({
      outcome: 'left',
      notes: ['The article gives p.Arg403Trp.'],
    });
  });

  it('does not fill an allele nobody has registered', async () => {
    const unregistered: VariantResolution['candidates'][number] = { ...myh7 };
    delete unregistered.caid;
    const { resolve } = resolver({
      'c.1A>G': answer('c.1A>G', [{ ...unregistered, clinVar: [] }]),
    });
    const { outcomes } = await lookUpVariants(draft([variant('_:v1', { variant: 'c.1A>G' })]), {
      profiles: builtinProfiles,
      resolve,
    });
    expect(outcomes[0]!.outcome).toBe('left');
  });

  it('reports a lookup that failed and carries on', async () => {
    const { resolve } = resolver({
      'c.1A>G': new Error('Bad Gateway'),
      'c.1208G>A': answer('c.1208G>A', [myh7]),
    });
    const { outcomes, draft: next } = await lookUpVariants(
      draft([variant('_:v1', { variant: 'c.1A>G' }), variant('_:v2', { variant: 'c.1208G>A' })]),
      { profiles: builtinProfiles, resolve },
    );
    expect(outcomes.map((o) => o.outcome)).toEqual(['failed', 'filled']);
    expect(next.notInBatch).toEqual([
      'Variant lookup _:v1: c.1A>G could not be looked up. Bad Gateway',
    ]);
  });
  it('stops when the lookup is turned off', async () => {
    const { resolve } = resolver({ 'c.1A>G': new LookupUnavailable('turned off') });
    await expect(
      lookUpVariants(draft([variant('_:v1', { variant: 'c.1A>G' })]), {
        profiles: builtinProfiles,
        resolve,
      }),
    ).rejects.toThrow('turned off');
  });
});
