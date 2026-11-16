/**
 * The deployment's profiles, as an engine outside the sidebar reads them
 * through the API, and the kinds a run or a draft names.
 */
import { createHash } from 'node:crypto';
import { unwrap, type ApiClient } from '@curanno/api-client';
import { exactTerm, outputSchema, type ResolveTerms, type Term } from '@curanno/extract';
import {
  ProfileRegistry,
  addAnnotationFormats,
  addProfileKeywords,
  isDerived,
  type BodyProfile,
  type StructuredBody,
} from '@curanno/model';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export interface Profiles {
  all: BodyProfile[];
  registry: ProfileRegistry;
  validate: (body: StructuredBody) => readonly { instancePath: string; message: string }[];
}

export async function loadProfiles(api: ApiClient): Promise<Profiles> {
  const all = unwrap(await api.GET('/x/profiles')) as unknown as BodyProfile[];
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  addAnnotationFormats(ajv);
  addProfileKeywords(ajv);
  const registry = new ProfileRegistry(ajv, all);
  const validate = (body: StructuredBody) => {
    const result = registry.validate(body);
    return result && !result.ok ? result.errors : [];
  };
  return { all, registry, validate };
}

/** A kind's short name: its profile IRI's last segment before the version, as `case-family`. */
export function shortKind(profile: BodyProfile): string {
  const parts = profile.iri.replace(/\/+$/, '').split('/');
  const last = parts.at(-1) ?? profile.iri;
  return /^\d+$/.test(last) ? (parts.at(-2) ?? last) : last;
}

/** The profile a kind names: an IRI, or its end such as `case-family` or `individual/1`. */
export function profileForKind(profiles: readonly BodyProfile[], kind: string): BodyProfile {
  const found = profiles.filter(
    (p) => p.iri === kind || p.iri.endsWith(`/${kind}`) || p.iri.endsWith(`/${kind}/1`),
  );
  if (found.length !== 1) {
    throw new Error(
      found.length
        ? `${kind} names several kinds: ${found.map((p) => p.iri).join(', ')}`
        : `there is no kind ${kind}`,
    );
  }
  const profile = found[0]!;
  if (isDerived(profile.schema)) throw new Error(`${kind} is computed from facts, not suggested`);
  // A kind the model cannot be asked about cannot be checked the same way either.
  outputSchema(profile);
  return profile;
}

/** Ontology labels resolved through the API; only an exact label or synonym counts. */
export function termResolver(api: ApiClient): ResolveTerms {
  return async (ontology, labels) => {
    const found = new Map<string, Term>();
    for (const label of labels) {
      const { data } = await api.GET('/x/ontologies/{name}/terms', {
        params: {
          path: { name: ontology.name },
          query: { q: label, limit: 10, ...(ontology.root ? { root: ontology.root } : {}) },
        },
      });
      const term = data ? exactTerm(label, data) : undefined;
      if (term) found.set(label, term);
    }
    return found;
  };
}

/** What a rerun with the same kinds replaces: the pending items of the last run (ADR 0037). */
export function rerunKey(profiles: readonly BodyProfile[]): string {
  const iris = profiles
    .map((p) => p.iri)
    .sort()
    .join('\n');
  return `kinds-${createHash('sha256').update(iris).digest('hex').slice(0, 16)}`;
}
