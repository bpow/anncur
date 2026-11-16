/**
 * An article from PubMed Central's open-access BioC JSON, as the text the
 * pipeline reads and the identifiers CurAnno finds its document by
 * (ADR 0014). Each passage is a block, as the guest reports a page's
 * paragraphs; references are left out.
 */
import type { ScopeText } from '@curanno/extract';
import type { components } from '@curanno/api-client';

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
  pmcid: string;
  title?: string;
  scope: ScopeText;
  passages: Passage[];
  document: DocumentMetadata;
}

const SKIPPED_SECTIONS = new Set(['REF']);

export const pmcUrl = (pmcid: string): string => `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`;

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
    pmcid,
    ...(title ? { title } : {}),
    scope: { key: 'body', text, blockStarts: blockStarts.slice(1) },
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
    headers: { 'user-agent': 'curanno-suggester' },
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
