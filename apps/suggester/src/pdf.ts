/**
 * An article from a PDF file, such as one downloaded from the publisher.
 * Each page is a scope of its own, its text as PDF.js's text layer renders
 * it in the viewer (text model, section 11), so quotes found here anchor on
 * the page the curator opens. The document is the one the viewer reports:
 * the PDF's fingerprint, and its URL when it has one (document identity,
 * section 7).
 */
import { pageTextScope } from '@curanno/guest/pdf-text';
import { blockStarts, deriveDocumentUris } from '@curanno/model';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { articleIdOf, type Article, type Passage } from './bioc.ts';

export async function articleFromPdf(data: Uint8Array, url?: string): Promise<Article> {
  const task = getDocument({ data, verbosity: 0 });
  const pdf = await task.promise;
  try {
    const fingerprint = pdf.fingerprints[0];
    if (!fingerprint) throw new Error('the PDF has no fingerprint');
    const scopes: Article['scopes'] = [];
    const passages: Passage[] = [];
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (
        await pdf.getPage(page)
      ).getTextContent({ includeMarkedContent: true, disableNormalization: true });
      const { root, map } = pageTextScope(content.items as Parameters<typeof pageTextScope>[0]);
      const starts = blockStarts(root, map);
      scopes.push({ key: `page=${page}`, text: map.text, blockStarts: starts });
      const chars = [...map.text];
      const bounds = [0, ...starts, chars.length];
      for (let i = 0; i + 1 < bounds.length; i++) {
        const text = chars
          .slice(bounds[i], bounds[i + 1])
          .join('')
          .trim();
        if (text) passages.push({ n: passages.length + 1, section: `page ${page}`, text });
      }
    }
    let title: string | undefined;
    try {
      const info = (await pdf.getMetadata()).info as { Title?: unknown };
      if (typeof info.Title === 'string' && info.Title.trim()) title = info.Title.trim();
    } catch {
      // No metadata is fine.
    }
    const uri = url ?? `urn:x-pdf:${fingerprint}`;
    const document = {
      uri,
      ...(title ? { title } : {}),
      links: deriveDocumentUris({ url: uri, pdfFingerprint: fingerprint }).map(
        ({ uri, relation }) => ({ uri, relation }),
      ),
    };
    return { id: articleIdOf(document), ...(title ? { title } : {}), scopes, passages, document };
  } finally {
    await task.destroy();
  }
}
