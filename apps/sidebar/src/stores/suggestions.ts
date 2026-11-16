/**
 * Suggested annotations (ADR 0032, 0037): the page's text from its guest,
 * the model at a configured endpoint, and what came back, posted as one
 * suggestion batch for a group to review. A run covers several kinds at
 * once: kinds that others link to (individuals) go first, and the later
 * kinds link to them by the batch's local ids, so nothing has to be saved
 * between the two.
 */
import { unwrap, type SuggestionItemInput } from '@curanno/api-client';
import {
  EndpointError,
  PROMPT_VERSION,
  exactTerm,
  extractBatch,
  type BatchProgress,
  type ResolveTerms,
  type ScopeText,
  type Suggestion,
  type Term,
} from '@curanno/extract';
import {
  pageFragmentSelector,
  type BodyProfile,
  type GuestScopeText,
  type SpecificResource,
} from '@curanno/model';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useApi } from '../api/client';
import type { ExtractEndpoint } from '../config';
import type { Guest, GuestDocument } from '../guest';
import { linkCandidates } from '../profiles/links';
import { useAnnotationsStore } from './annotations';
import { useProfilesStore } from './profiles';

export type RunStatus = 'idle' | 'reading' | 'asking' | 'done' | 'failed' | 'cancelled';

export interface RunRequest {
  document: GuestDocument;
  profiles: BodyProfile[];
  /** The group whose batch it is. */
  group: string;
  endpoint: ExtractEndpoint;
  model: string;
  instructions?: string;
}

function scopeKey(scope: GuestScopeText): string {
  return scope.page === undefined ? 'body' : `page=${scope.page}`;
}

function toScopeText(scope: GuestScopeText): ScopeText {
  return {
    key: scopeKey(scope),
    text: scope.text,
    ...(scope.blockStarts ? { blockStarts: scope.blockStarts } : {}),
  };
}

/** The target for a suggestion: the scope's selectors, inside a page fragment for a PDF page. */
export function targetOf(
  documentUri: string,
  suggestion: Pick<Suggestion, 'scope' | 'selectors'>,
): SpecificResource {
  const selectors = [suggestion.selectors.quote, suggestion.selectors.position];
  const page = /^page=(\d+)$/.exec(suggestion.scope)?.[1];
  return {
    type: 'SpecificResource',
    source: documentUri,
    selector: page ? [pageFragmentSelector(Number(page), selectors)] : selectors,
  };
}

/** Ontology labels resolved through `/x/ontologies`; only an exact label or synonym counts. */
const resolveTerms: ResolveTerms = async (ontology, labels) => {
  const found = new Map<string, Term>();
  for (const label of labels) {
    try {
      const { data } = await useApi().GET('/x/ontologies/{name}/terms', {
        params: {
          path: { name: ontology.name },
          query: { q: label, limit: 10, ...(ontology.root ? { root: ontology.root } : {}) },
        },
      });
      const term = data ? exactTerm(label, data) : undefined;
      if (term) found.set(label, term);
    } catch {
      // An ontology that is not loaded leaves the label as written.
    }
  }
  return found;
};

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true });
    promise.then(resolve, reject);
  });
}

function messageOf(err: unknown): string {
  if (err instanceof EndpointError) {
    return err.status === undefined
      ? `${err.message}. If this is Ollama, check that it is running and that OLLAMA_ORIGINS allows ${window.location.origin}.`
      : err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

export const useSuggestionsStore = defineStore('suggestions', () => {
  const status = ref<RunStatus>('idle');
  /** Which kind is being asked about, and how far through the page it is. */
  const progress = ref<BatchProgress>();
  const error = ref<string>();
  const posted = ref(0);
  const rejected = ref(0);
  /** Kinds left out because there was nothing on the page, or in the run, to link them to. */
  const skipped = ref<string[]>([]);
  /** The document of the current or last run. */
  const documentUri = ref<string>();
  let controller: AbortController | undefined;

  function clear(): void {
    controller?.abort();
    controller = undefined;
    status.value = 'idle';
    progress.value = undefined;
    error.value = undefined;
    posted.value = 0;
    rejected.value = 0;
    skipped.value = [];
    documentUri.value = undefined;
  }

  function cancel(): void {
    controller?.abort();
  }

  async function run(guest: Guest, request: RunRequest): Promise<void> {
    clear();
    const own = new AbortController();
    controller = own;
    const { document } = request;
    documentUri.value = document.uri;
    status.value = 'reading';
    try {
      const scopes = await untilAborted(guest.requestText(document.uri), own.signal);
      if (!scopes)
        throw new Error('This page cannot send its text. Reload it to update the guest.');
      status.value = 'asking';
      const profiles = useProfilesStore();
      const saved = useAnnotationsStore().rootsOf(document.uri);
      const result = await extractBatch(
        {
          scopes: scopes.map(toScopeText),
          profiles: request.profiles,
          ...(request.instructions?.trim() ? { instructions: request.instructions } : {}),
          saved: (link) => linkCandidates(saved, link).map(({ id, label }) => ({ id, label })),
        },
        { url: request.endpoint.url, model: request.model },
        {
          validate: (body) => profiles.validate(body),
          resolveTerms,
          signal: own.signal,
          onProgress: (next) => {
            if (controller === own) progress.value = next;
          },
        },
      );
      skipped.value = result.skipped;
      const items: SuggestionItemInput[] = result.items.map((i) => ({
        id: i.id,
        selector: targetOf(document.uri, i).selector as SuggestionItemInput['selector'],
        body: { type: 'StructuredBody', profile: i.profile, value: i.value },
      }));
      const set = result.rejected;
      if (controller !== own) return;
      rejected.value = set;
      if (items.length) {
        unwrap(
          await useApi().POST('/x/suggestion-batches', {
            body: {
              group: request.group,
              document: {
                uri: document.uri,
                ...(document.title ? { title: document.title } : {}),
                links: document.links.map(({ uri, relation }) => ({ uri, relation })),
              },
              engine: {
                name: 'curanno-extract',
                version: `prompt ${PROMPT_VERSION}`,
                nickname: `${request.model} / prompt ${PROMPT_VERSION}`,
              },
              items,
            },
          }),
        );
      }
      posted.value = items.length;
      status.value = 'done';
    } catch (err) {
      if (controller !== own) return;
      if (own.signal.aborted) {
        status.value = 'cancelled';
      } else {
        status.value = 'failed';
        error.value = messageOf(err);
      }
    } finally {
      if (controller === own) controller = undefined;
    }
  }

  return { status, progress, error, posted, rejected, skipped, documentUri, run, cancel, clear };
});
