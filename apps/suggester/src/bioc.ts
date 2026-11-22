/**
 * An article from PubMed Central's open-access BioC JSON, as the text the
 * pipeline reads and the identifiers Anncur finds its document by
 * (ADR 0014). Each passage is a block, as the guest reports a page's
 * paragraphs; references are left out.
 */
import type { ScopeText } from '@anncur/extract';
import { pageFragmentSelector, type Selector } from '@anncur/model';
import type { components } from '@anncur/api-client';

type DocumentMetadata = components['schemas']['DocumentMetadata'];

interface BiocPassage {
  infons?: Record<string, string>;
  offset?: number;
  text?: string;
}

interface BiocDocument {
  id?: string;
  passages?: BiocPassage[];
}

export interface Passage {
  /** 1-based, in reading order, for pointing at a passage. */
  n: number;
  /** BioC's section type, such as `CASE`, `RESULTS` or `TABLE`. */
  section: string;
  text: string;
}

export interface Article {
  /** The PMC id, else the DOI, else the URL or `urn:x-pdf:` fingerprint; a draft names it as `article`. */
  id: string;
  title?: string;
  /** One scope, `body`, for a page; one per page, `page=N`, for a PDF, as the guest reports them. */
  scopes: ScopeText[];
  passages: Passage[];
  document: DocumentMetadata;
}

const SKIPPED_SECTIONS = new Set(['REF']);

export const pmcUrl = (pmcid: string): string => `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`;

/** A target's selector: the quote, inside a page fragment when the scope is a PDF page. */
export function selectorFor(scopeKey: string, quote: Selector): Selector {
  const page = /^page=(\d+)$/.exec(scopeKey)?.[1];
  return page ? pageFragmentSelector(Number(page), [quote]) : quote;
}

/** The id a draft names an article by: its PMC id, else its DOI, else the document's own URI. */
export function articleIdOf(document: DocumentMetadata): string {
  const uris = [document.uri, ...(document.links ?? []).map((l) => l.uri)];
  for (const uri of uris) {
    const pmc = /\/(PMC\d+)\b/i.exec(uri)?.[1];
    if (pmc) return pmc.toUpperCase();
  }
  const doi = (document.links ?? []).find((l) => l.relation === 'doi');
  const name = doi && /10\.\d{4,9}\/\S+/.exec(doi.uri)?.[0];
  return name ? name.toLowerCase() : document.uri;
}

/** The first document of a BioC JSON collection, or of a list of them as the PMC service sends. */
function firstDocument(json: unknown): BiocDocument {
  const collections = Array.isArray(json) ? json : [json];
  for (const c of collections) {
    const documents = (c as { documents?: BiocDocument[] } | null)?.documents;
    if (documents?.[0]) return documents[0];
  }
  throw new Error('no document in the BioC JSON');
}

export function articleFromBioc(json: unknown): Article {
  const doc = firstDocument(json);
  const passages = (doc.passages ?? []).filter(
    (p) => p.text?.trim() && !SKIPPED_SECTIONS.has(p.infons?.['section_type'] ?? ''),
  );
  const front = doc.passages?.find((p) => p.infons?.['article-id_pmc'] !== undefined);
  const raw = front?.infons?.['article-id_pmc'] ?? doc.id ?? '';
  const pmcid = raw.startsWith('PMC') ? raw : `PMC${raw}`;
  if (pmcid === 'PMC') throw new Error('the BioC JSON names no PMC id');
  const title = doc.passages?.find((p) => p.infons?.['section_type'] === 'TITLE')?.text?.trim();
  const doi = front?.infons?.['article-id_doi'];

  let text = '';
  let length = 0;
  const blockStarts: number[] = [];
  const read: Passage[] = [];
  for (const p of passages) {
    blockStarts.push(length);
    const block = p.text!.trim();
    read.push({ n: read.length + 1, section: p.infons?.['section_type'] ?? '', text: block });
    text += block;
    length += [...block].length;
  }
  const self = pmcUrl(pmcid);
  return {
    id: pmcid,
    ...(title ? { title } : {}),
    scopes: [{ key: 'body', text, blockStarts: blockStarts.slice(1) }],
    passages: read,
    document: {
      uri: self,
      ...(title ? { title } : {}),
      links: [
        { uri: self, relation: 'self' },
        ...(doi ? [{ uri: `https://doi.org/${doi}`, relation: 'doi' as const }] : []),
      ],
    },
  };
}

export const BIOC_URL = 'https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pmcoa.cgi';

/** An open-access article's BioC JSON, from PMC's BioC service. */
export async function fetchBioc(
  pmcid: string,
  options: { base?: string; fetch?: typeof fetch } = {},
): Promise<unknown> {
  const url = `${options.base ?? BIOC_URL}/BioC_json/${encodeURIComponent(pmcid)}/unicode`;
  const response = await (options.fetch ?? fetch)(url, {
    headers: { 'user-agent': 'anncur-suggester' },
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const body = await response.text();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    // The service answers 200 with a plain-text message for an article it does not have.
    throw new Error(`${pmcid} is not in PMC's open-access BioC service: ${body.slice(0, 120)}`);
  }
}
