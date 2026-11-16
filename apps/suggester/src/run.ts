/**
 * One article through the model and into CurAnno as a suggestion batch for
 * a group (ADR 0037), through the public API and an access token
 * (ADR 0038). The engine never reads annotations: facts link only to the
 * individuals suggested in the same batch.
 */
import { createHash } from 'node:crypto';
import { unwrap, type ApiClient, type SuggestionItemInput } from '@curanno/api-client';
import {
  PROMPT_VERSION,
  exactTerm,
  extractBatch,
  outputSchema,
  type BatchProgress,
  type Endpoint,
  type ResolveTerms,
  type Term,
} from '@curanno/extract';
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
import type { Article } from './bioc.ts';

export const ENGINE_NAME = 'curanno-suggester';
export const ENGINE_VERSION = '0.1.0';

export interface Profiles {
  chosen: BodyProfile[];
  validate: (body: StructuredBody) => readonly { instancePath: string; message: string }[];
}

/** The deployment's profiles, and those `wanted` names: an IRI, or its end such as `individual/1`. */
export async function loadProfiles(api: ApiClient, wanted: readonly string[]): Promise<Profiles> {
  const all = unwrap(await api.GET('/x/profiles')) as unknown as BodyProfile[];
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  addAnnotationFormats(ajv);
  addProfileKeywords(ajv);
  const registry = new ProfileRegistry(ajv, all);
  const chosen = wanted.map((name) => {
    const found = all.filter(
      (p) => p.iri === name || p.iri.endsWith(`/${name}`) || p.iri.endsWith(`/${name}/1`),
    );
    if (found.length !== 1) {
      throw new Error(
        found.length
          ? `${name} names several profiles: ${found.map((p) => p.iri).join(', ')}`
          : `no profile ${name}`,
      );
    }
    const profile = found[0]!;
    if (isDerived(profile.schema)) throw new Error(`${profile.iri} is computed, not suggested`);
    outputSchema(profile);
    return profile;
  });
  const validate = (body: StructuredBody) => {
    const result = registry.validate(body);
    return result && !result.ok ? result.errors : [];
  };
  return { chosen, validate };
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

export interface RunConfig {
  api: ApiClient;
  group: string;
  endpoint: Endpoint;
  profiles: Profiles;
  instructions?: string;
  /** Print the batch instead of posting it. */
  dryRun?: boolean;
  fetch?: typeof fetch;
  onProgress?: (progress: BatchProgress) => void;
}

export interface RunOutcome {
  items: number;
  rejected: number;
  skipped: string[];
  /** The posted batch, or in a dry run the batch that would have been. */
  batch?: string;
  body?: unknown;
}

export async function suggestFor(article: Article, config: RunConfig): Promise<RunOutcome> {
  const result = await extractBatch(
    {
      scopes: [article.scope],
      profiles: config.profiles.chosen,
      ...(config.instructions ? { instructions: config.instructions } : {}),
    },
    config.endpoint,
    {
      validate: config.profiles.validate,
      resolveTerms: termResolver(config.api),
      ...(config.fetch ? { fetch: config.fetch } : {}),
      ...(config.onProgress ? { onProgress: config.onProgress } : {}),
    },
  );
  const outcome: RunOutcome = {
    items: result.items.length,
    rejected: result.rejected,
    skipped: result.skipped,
  };
  if (!result.items.length) return outcome;
  // Only the quote: offsets in PMC's text say nothing about the page a curator reads.
  const items: SuggestionItemInput[] = result.items.map((i) => ({
    id: i.id,
    selector: i.selectors.quote as SuggestionItemInput['selector'],
    body: { type: 'StructuredBody', profile: i.profile, value: i.value },
  }));
  const body = {
    group: config.group,
    document: article.document,
    engine: {
      name: ENGINE_NAME,
      version: `${ENGINE_VERSION} / prompt ${PROMPT_VERSION}`,
      nickname: `${config.endpoint.model} / prompt ${PROMPT_VERSION}`,
    },
    key: rerunKey(config.profiles.chosen),
    items,
  };
  if (config.dryRun) return { ...outcome, body };
  const batch = unwrap(await config.api.POST('/x/suggestion-batches', { body }));
  return { ...outcome, batch: batch.id };
}
