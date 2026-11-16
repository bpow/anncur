/**
 * One article through the model and into CurAnno as a suggestion batch for
 * a group (ADR 0037), through the public API and an access token
 * (ADR 0038). The engine never reads annotations: facts link only to the
 * individuals suggested in the same batch.
 */
import { unwrap, type ApiClient, type SuggestionItemInput } from '@curanno/api-client';
import { PROMPT_VERSION, extractBatch, type BatchProgress, type Endpoint } from '@curanno/extract';
import type { BodyProfile, StructuredBody } from '@curanno/model';
import type { Article } from './bioc.ts';
import { rerunKey, termResolver } from './profiles.ts';

export const ENGINE_NAME = 'curanno-suggester';
export const ENGINE_VERSION = '0.1.0';

export interface RunConfig {
  api: ApiClient;
  group: string;
  endpoint: Endpoint;
  /** The kinds to ask about, and how to check a value against its profile. */
  kinds: BodyProfile[];
  validate: (body: StructuredBody) => readonly { instancePath: string; message: string }[];
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
      profiles: config.kinds,
      ...(config.instructions ? { instructions: config.instructions } : {}),
    },
    config.endpoint,
    {
      validate: config.validate,
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
    key: rerunKey(config.kinds),
    items,
  };
  if (config.dryRun) return { ...outcome, body };
  const batch = unwrap(await config.api.POST('/x/suggestion-batches', { body }));
  return { ...outcome, batch: batch.id };
}
