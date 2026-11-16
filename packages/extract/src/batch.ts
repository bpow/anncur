/**
 * Several kinds of suggestion from one document, as one suggestion batch
 * (ADR 0037). Kinds that other kinds link to (individuals) are asked about
 * first. The later kinds may then name the batch's own items by local id
 * (`_:s1`), as well as annotations already saved, so nothing needs saving
 * in between. The sidebar and the bulk suggester both run this.
 */
import {
  LOCAL_PLACEHOLDER,
  linkFieldsOf,
  replaceLocalIds,
  type AnnotationLink,
  type BodyProfile,
  type JsonValue,
  type StructuredBody,
  type TextSelectors,
} from '@curanno/model';
import type { Endpoint } from './endpoint.js';
import { extract, type ExtractOptions, type LinkTarget, type ScopeText } from './extract.js';

export interface BatchInput {
  scopes: readonly ScopeText[];
  profiles: readonly BodyProfile[];
  instructions?: string;
  /** Annotations already saved that a link field may name, besides the batch's own items. */
  saved?: (link: AnnotationLink) => readonly LinkTarget[];
}

export interface BatchItem {
  /** The item's local id in the batch. */
  id: string;
  scope: string;
  selectors: TextSelectors;
  profile: string;
  value: JsonValue;
  unresolvedTerms: string[];
}

export interface BatchProgress {
  /** The kind being asked about, which of the kinds it is, and how far through the text. */
  kind: string;
  step: number;
  steps: number;
  done: number;
  total: number;
}

export interface BatchResult {
  items: BatchItem[];
  /** Suggestions set aside: a quote not in the text, or a value that does not fit. */
  rejected: number;
  /** Kinds not asked about because there was nothing to link them to. */
  skipped: string[];
}

export interface BatchOptions extends Omit<ExtractOptions, 'onProgress'> {
  onProgress?: (progress: BatchProgress) => void;
}

/** Kinds that other kinds link to come first, so that their suggestions can be linked to. */
export function runOrder(profiles: readonly BodyProfile[]): BodyProfile[] {
  const linkedTo = new Set(
    profiles.flatMap((p) => linkFieldsOf(p.schema).map((f) => f.link.profile)),
  );
  const links = (p: BodyProfile) => linkFieldsOf(p.schema).length > 0;
  return [...profiles].sort(
    (a, b) =>
      Number(links(a)) - Number(links(b)) ||
      Number(linkedTo.has(b.iri)) - Number(linkedTo.has(a.iri)),
  );
}

/** `body` with local ids in its link fields swapped for IRIs, so that a profile's IRI pattern accepts it. */
export function withPlaceholders(body: StructuredBody, profile: BodyProfile): StructuredBody {
  const one = { get: (iri: string) => (iri === profile.iri ? profile : undefined) };
  return replaceLocalIds(body, one, (id) => `${LOCAL_PLACEHOLDER}${id.slice(2)}`);
}

function labelOf(value: JsonValue, field: string | undefined): string | undefined {
  if (!field || typeof value !== 'object' || value === null || Array.isArray(value)) return;
  const label = value[field];
  return typeof label === 'string' ? label : undefined;
}

export async function extractBatch(
  input: BatchInput,
  endpoint: Endpoint,
  options: BatchOptions,
): Promise<BatchResult> {
  const { onProgress, validate, ...rest } = options;
  const order = runOrder(input.profiles);
  const items: BatchItem[] = [];
  const skipped: string[] = [];
  let rejected = 0;
  for (const [step, profile] of order.entries()) {
    const link = linkFieldsOf(profile.schema)[0]?.link;
    const links: LinkTarget[] = link
      ? [
          ...(input.saved?.(link) ?? []),
          ...items.flatMap((i) => {
            const label = labelOf(i.value, link.label);
            return i.profile === link.profile && label ? [{ id: i.id, label }] : [];
          }),
        ]
      : [];
    if (link && !links.length) {
      skipped.push(profile.title);
      continue;
    }
    const result = await extract(
      {
        scopes: input.scopes,
        profile,
        ...(input.instructions?.trim() ? { instructions: input.instructions } : {}),
        ...(links.length ? { links } : {}),
      },
      endpoint,
      {
        ...rest,
        validate: (body) => validate(withPlaceholders(body, profile)),
        ...(onProgress
          ? {
              onProgress: (done: number, total: number) =>
                onProgress({
                  kind: profile.title,
                  step: step + 1,
                  steps: order.length,
                  done,
                  total,
                }),
            }
          : {}),
      },
    );
    rejected += result.rejected.length;
    for (const s of result.suggestions) {
      items.push({
        id: `_:s${items.length + 1}`,
        scope: s.scope,
        selectors: s.selectors,
        profile: profile.iri,
        value: s.value,
        unresolvedTerms: s.unresolvedTerms,
      });
    }
  }
  return { items, rejected, skipped };
}
