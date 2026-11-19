/**
 * Fills the Allele Registry, ClinVar and gnomAD IDs of a draft's variants
 * through CurAnno's variant lookup (ADR 0039, docs/variant-ids-plan.md).
 * It fills only when the answer leaves no choice to make: one registered
 * allele, with nothing the lookup found wrong. Everything else is reported,
 * and listed under `notInBatch` for the curator, with the candidates.
 */
import type { components } from '@curanno/api-client';
import type { BodyProfile, JsonValue, VariantLookupFields } from '@curanno/model';
import type { Draft } from './draft.ts';
import { profileForKind } from './profiles.ts';

export type VariantResolution = components['schemas']['VariantResolution'];
export type Resolve = (query: string, gene: string | undefined) => Promise<VariantResolution>;

export interface VariantOutcome {
  item: string;
  variant: string;
  outcome: 'filled' | 'left' | 'failed';
  ids?: { caid?: string; clinVarId?: string; gnomad?: string };
  /** What the lookup assumed or found, for the curator. */
  notes: string[];
  /** For a variant left for the curator: the alleles it could be. */
  candidates?: string[];
}

/** Thrown by a `Resolve` when no lookup can succeed, such as when the server has it turned off. */
export class LookupUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LookupUnavailable';
  }
}

/**
 * Query warnings that say the lookup assumed the MANE Select transcript or its version. They
 * leave one answer only when the article's protein change confirms it: the lookup flags a
 * protein change that does not follow, so a candidate without that warning agrees with it.
 */
const ASSUMPTIONS = new Set(['transcript-assumed', 'version-assumed']);

/** Whether the variant's text gives a protein change next to the nucleotide change. */
const statesProtein = (variant: string): boolean => /(^|[\s(;,/])p\.\(?[A-Z*]/.test(variant);
/** Candidate warnings that do not make the candidate doubtful. */
const HARMLESS = new Set(['no-clinvar']);

/** What `notInBatch` lines from this command start with, so a rerun replaces them. */
export const NOTE_PREFIX = 'Variant lookup';

/** The field with the `variantLookup` keyword in a profile's schema, and the fields it names. */
export function variantField(
  profile: BodyProfile,
): { field: string; fields: VariantLookupFields } | undefined {
  const properties = profile.schema['properties'];
  if (typeof properties !== 'object' || properties === null) return undefined;
  for (const [field, schema] of Object.entries(properties as Record<string, unknown>)) {
    const lookup = (schema as { variantLookup?: unknown } | null)?.variantLookup;
    if (typeof lookup === 'object' && lookup !== null) {
      return { field, fields: lookup };
    }
  }
  return undefined;
}

const str = (value: JsonValue | undefined): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

function describe(c: VariantResolution['candidates'][number]): string {
  const ids = [
    c.caid ?? 'not registered',
    ...c.clinVar.map((v) => `ClinVar ${v.variationId}`),
  ].join(', ');
  return `${c.title ?? c.hgvs.transcript ?? c.hgvs.genomic ?? 'an allele'} (${ids})`;
}

export async function lookUpVariants(
  draft: Draft,
  options: { profiles: readonly BodyProfile[]; resolve: Resolve },
): Promise<{ draft: Draft; outcomes: VariantOutcome[] }> {
  const outcomes: VariantOutcome[] = [];
  const items = [];
  for (const item of draft.items) {
    let profile: BodyProfile | undefined;
    try {
      profile = profileForKind(options.profiles, item.kind);
    } catch {
      profile = undefined;
    }
    const lookup = profile ? variantField(profile) : undefined;
    const value = item.value;
    if (!lookup || typeof value !== 'object' || value === null || Array.isArray(value)) {
      items.push(item);
      continue;
    }
    const { field, fields } = lookup;
    const variant = str(value[field]);
    const has = (name: string | undefined) => name !== undefined && value[name] !== undefined;
    // IDs the article states, and variants already marked unresolvable, are left as they are.
    if (
      !variant ||
      has(fields.caid) ||
      has(fields.clinVarId) ||
      (fields.idSource && value[fields.idSource] === 'unresolvable')
    ) {
      items.push(item);
      continue;
    }
    const gene = str(fields.gene ? value[fields.gene] : undefined) ?? draft.gene;

    let result: VariantResolution;
    try {
      result = await options.resolve(variant, gene);
    } catch (err) {
      if (err instanceof LookupUnavailable) throw err;
      outcomes.push({ item: item.id, variant, outcome: 'failed', notes: [(err as Error).message] });
      items.push(item);
      continue;
    }
    const notes = result.warnings.map((w) => w.message);
    const [only, ...others] = result.candidates;
    const assumed = result.warnings.filter((w) => ASSUMPTIONS.has(w.code));
    const confirmed =
      assumed.length === 0 || (statesProtein(variant) && only?.hgvs.protein !== undefined);
    if (!confirmed) {
      notes.push(
        'The lookup had to assume the transcript, and the article gives no protein change to confirm it.',
      );
    }
    const settled =
      only !== undefined &&
      others.length === 0 &&
      only.caid !== undefined &&
      confirmed &&
      result.warnings.every((w) => ASSUMPTIONS.has(w.code)) &&
      only.warnings.every((w) => HARMLESS.has(w.code));
    if (!settled) {
      notes.push(...result.candidates.flatMap((c) => c.warnings.map((w) => w.message)));
      outcomes.push({
        item: item.id,
        variant,
        outcome: 'left',
        notes: [...new Set(notes)],
        candidates: result.candidates.map(describe),
      });
      items.push(item);
      continue;
    }
    notes.push(...only.warnings.map((w) => w.message));
    const ids: VariantOutcome['ids'] = { caid: only.caid! };
    if (only.clinVar.length === 1) ids.clinVarId = only.clinVar[0]!.variationId;
    if (only.gnomad && !has(fields.gnomad)) ids.gnomad = only.gnomad;
    const next: Record<string, JsonValue> = { ...value };
    if (fields.caid) next[fields.caid] = ids.caid!;
    if (fields.clinVarId && ids.clinVarId) next[fields.clinVarId] = ids.clinVarId;
    if (fields.gnomad && ids.gnomad) next[fields.gnomad] = ids.gnomad;
    if (fields.idSource) next[fields.idSource] = 'looked up';
    outcomes.push({ item: item.id, variant, outcome: 'filled', ids, notes });
    items.push({ ...item, value: next });
  }

  // Replace this command's earlier notes, so a rerun does not repeat them.
  const kept = (draft.notInBatch ?? []).filter((n) => !n.startsWith(`${NOTE_PREFIX} `));
  const added = outcomes
    .filter((o) => o.outcome !== 'filled')
    .map((o) => {
      const what =
        o.outcome === 'failed'
          ? 'could not be looked up'
          : o.candidates?.length
            ? `needs a curator to choose: ${o.candidates.join('; ')}`
            : 'found no allele';
      return `${NOTE_PREFIX} ${o.item}: ${o.variant} ${what}.${o.notes.length ? ` ${o.notes.join(' ')}` : ''}`;
    });
  const notInBatch = [...kept, ...added];
  return {
    draft: { ...draft, items, ...(notInBatch.length ? { notInBatch } : {}) },
    outcomes,
  };
}
