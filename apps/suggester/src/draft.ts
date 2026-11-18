/**
 * A draft batch, as an assistant such as Claude Code writes it
 * (docs/claude-skills-plan.md, section 3): kinds by short name, quotes as
 * plain text, individuals by local id. `checkDraft` turns it into the batch
 * the API takes, or says, item by item, what has to change. Nothing the
 * assistant claims is taken on trust: every quote must be in the article,
 * every term must resolve through the API, and every value must fit.
 */
import { stableStringify } from '@curanno/model';
import type { components } from '@curanno/api-client';
import {
  buildView,
  locateQuote,
  outputSchema,
  resolveOntologyFields,
  type ResolveTerms,
} from '@curanno/extract';
import {
  checkItems,
  describeRange,
  utf16ToCodePoint,
  type BodyProfile,
  type JsonValue,
  type ProfileRegistry,
  type StructuredBody,
} from '@curanno/model';
import { selectorFor, type Article } from './bioc.ts';
import { profileForKind, rerunKey } from './profiles.ts';

type BatchInput = components['schemas']['SuggestionBatchInput'];

/** A batch as the API takes it, but for the group, which `post` adds. */
export interface DraftBatch {
  document: BatchInput['document'];
  engine: BatchInput['engine'];
  key: string;
  items: BatchInput['items'];
}

export interface DraftItem {
  id: string;
  kind: string;
  /** The passage the quote is from, as `text` numbers them; a hint for messages only. */
  passage?: number;
  quote: string;
  value: JsonValue;
}

export interface Draft {
  article: string;
  gene?: string;
  engine: { model: string; skill: string; version: string };
  items: DraftItem[];
  /** What the assistant found but could not put in the batch, for the curator. */
  notInBatch?: string[];
}

export interface Problem {
  item?: string;
  path?: string;
  message: string;
}

export interface CheckResult {
  problems: Problem[];
  /** Ontology labels left as text, by item; not problems, but worth another look. */
  unresolved: { item: string; labels: string[] }[];
  /** Ids the assistant gave that the ontology lookup did not confirm, replaced by the lookup's. */
  replacedIds: { item: string; given: string; label: string; now?: string }[];
  /** The batch, without its group, when there are no problems. */
  batch?: DraftBatch;
}

export const ENGINE_NAME = 'claude-code';

/** Labels and ids of the terms in an item's ontology fields, as given. */
function givenTerms(value: unknown, out: { id: string; label: string }[] = []) {
  if (Array.isArray(value)) value.forEach((v) => givenTerms(v, out));
  else if (typeof value === 'object' && value !== null) {
    const { id, label } = value as { id?: unknown; label?: unknown };
    if (typeof id === 'string' && typeof label === 'string') out.push({ id, label });
    else Object.values(value).forEach((v) => givenTerms(v, out));
  }
  return out;
}

type ScopeView = ReturnType<typeof buildView>;
type Located = Extract<ReturnType<typeof locateQuote>, { ok: true }>;

/** The one place a quote is found across the scopes: once in one scope, nowhere else. */
function locateInScopes(
  views: { key: string; view: ScopeView }[],
  quote: string,
):
  | (Located & { key: string; view: ScopeView })
  | { ok: false; reason: Exclude<ReturnType<typeof locateQuote>, { ok: true }>['reason'] } {
  let found: (Located & { key: string; view: ScopeView }) | undefined;
  for (const { key, view } of views) {
    const located = locateQuote(view, quote, { start: 0, end: view.text.length });
    if (!located.ok) {
      if (located.reason === 'not-found') continue;
      return located;
    }
    if (found) return { ok: false, reason: 'ambiguous' };
    found = { ...located, key, view };
  }
  return found ?? { ok: false, reason: 'not-found' };
}

export async function checkDraft(
  draft: Draft,
  article: Article,
  options: {
    profiles: readonly BodyProfile[];
    registry: Pick<ProfileRegistry, 'get' | 'validate'>;
    resolveTerms: ResolveTerms;
  },
): Promise<CheckResult> {
  const problems: Problem[] = [];
  const unresolved: CheckResult['unresolved'] = [];
  const replacedIds: CheckResult['replacedIds'] = [];
  if (draft.article.toUpperCase() !== article.id.toUpperCase()) {
    problems.push({ message: `the draft is for ${draft.article}, the text is ${article.id}` });
  }
  const views = article.scopes.map((scope) => ({
    key: scope.key,
    view: buildView(scope.text, scope.blockStarts),
  }));
  const items: BatchInput['items'] = [];
  const used = new Map<string, BodyProfile>();
  const seen = new Map<string, string>();

  for (const item of draft.items) {
    let profile: BodyProfile;
    try {
      profile = profileForKind(options.profiles, item.kind);
    } catch (err) {
      problems.push({ item: item.id, path: 'kind', message: (err as Error).message });
      continue;
    }
    used.set(profile.iri, profile);
    const where = item.passage ? ` (passage ${item.passage})` : '';
    const located = locateInScopes(views, item.quote);
    if (!located.ok) {
      const message = {
        'too-short': 'the quote is too short to find reliably; quote a whole sentence',
        'not-found':
          views.length > 1
            ? `the quote is not on any one page word for word${where}; copy it exactly, and quote only what is on one page`
            : `the quote is not in the article word for word${where}; copy it exactly, without joining or shortening`,
        ambiguous: 'the quote occurs more than once; quote more of the sentence',
      }[located.reason];
      problems.push({ item: item.id, path: 'quote', message: message ?? located.reason });
      continue;
    }
    const { source } = located.view;
    const selectors = describeRange(source, {
      start: utf16ToCodePoint(source, located.start),
      end: utf16ToCodePoint(source, located.end),
    });

    const given = givenTerms(item.value);
    const resolved = await resolveOntologyFields(
      item.value,
      outputSchema(profile).ontologyFields,
      options.resolveTerms,
    );
    const now = givenTerms(resolved.value);
    for (const g of given) {
      const match = now.find((t) => t.label.toLowerCase() === g.label.toLowerCase());
      if (match?.id !== g.id) {
        replacedIds.push({
          item: item.id,
          given: g.id,
          label: g.label,
          ...(match ? { now: match.id } : {}),
        });
      }
    }
    if (resolved.unresolved.length) unresolved.push({ item: item.id, labels: resolved.unresolved });

    const value = resolved.value as JsonValue;
    const key = `${profile.iri}\n${selectors.quote.exact}\n${stableStringify(value)}`;
    const twin = seen.get(key);
    if (twin) {
      problems.push({ item: item.id, message: `says the same as ${twin} on the same quote` });
      continue;
    }
    seen.set(key, item.id);
    const body: StructuredBody = { type: 'StructuredBody', profile: profile.iri, value };
    items.push({
      id: item.id,
      selector: selectorFor(
        located.key,
        selectors.quote,
      ) as BatchInput['items'][number]['selector'],
      body: body as BatchInput['items'][number]['body'],
    });
  }

  // Local ids, links and values against their profiles, as the API will check them.
  for (const issue of checkItems(items as never, options.registry)) {
    const at = /^\/items\/(\d+)(\/body)?(.*)$/.exec(issue.instancePath);
    const item = at ? items[Number(at[1])]?.id : undefined;
    problems.push({
      ...(item ? { item } : {}),
      ...(at?.[3] ? { path: at[3].replace(/^\//, '') } : {}),
      message: issue.message,
    });
  }

  const result: CheckResult = { problems, unresolved, replacedIds };
  if (problems.length || !items.length) {
    if (!items.length && !problems.length) problems.push({ message: 'the draft has no items' });
    return result;
  }
  const { skill, version, model } = draft.engine;
  return {
    ...result,
    batch: {
      document: article.document,
      engine: {
        name: ENGINE_NAME,
        version: `${skill} ${version}`,
        nickname: `${model} / ${skill} ${version}`,
      },
      key: rerunKey([...used.values()]),
      items,
    },
  };
}
