/**
 * An article from a saved web page: a publisher's article page, or a PMC
 * page for an article PMC will not serve as text (publishers who do not
 * allow it, author manuscripts). The text is the page's as the guest
 * reads it (the body, by the model's text rules), so quotes found here are
 * found on the page the curator opens; the identifiers are those the guest
 * would report (ADR 0014).
 */
import { collectDocument } from '@curanno/guest/document-metadata';
import { blockStarts, createDomAdapter, extractText, type DomLikeNode } from '@curanno/model';
import { Window } from 'happy-dom';
import { articleIdOf, type Article, type Passage } from './bioc.ts';

export function articleFromHtml(html: string, url?: string): Article {
  const probe = new Window().document;
  probe.write(html);
  const canonical = probe.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? undefined;
  const href = url ?? canonical;
  if (!href) throw new Error('give the page its URL with --url: it names no canonical link');
  const window = new Window({ url: href });
  const document = window.document;
  document.write(html);
  const root = document.body as unknown as DomLikeNode;
  const map = extractText(root, createDomAdapter());
  const starts = blockStarts(root, map);
  const chars = [...map.text];
  const bounds = [0, ...starts, chars.length];
  const passages: Passage[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const text = chars
      .slice(bounds[i], bounds[i + 1])
      .join('')
      .trim();
    if (text) passages.push({ n: passages.length + 1, section: '', text });
  }
  const found = collectDocument(document);
  window.close();
  const metadata = {
    uri: found.uri,
    ...(found.title ? { title: found.title } : {}),
    links: found.links.map(({ uri, relation }) => ({ uri, relation })),
  };
  return {
    id: articleIdOf(metadata),
    ...(found.title ? { title: found.title } : {}),
    scopes: [{ key: 'body', text: map.text, blockStarts: starts }],
    passages,
    document: metadata,
  };
}
