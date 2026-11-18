import { readFileSync } from 'node:fs';
import {
  ProfileRegistry,
  addAnnotationFormats,
  addProfileKeywords,
  builtinProfiles,
} from '@curanno/model';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { checkDraft } from './draft.ts';
import { articleFromPdf } from './pdf.ts';

const data = () =>
  new Uint8Array(
    readFileSync(
      new URL(
        '../../../packages/guest/corpus/cases/pdf-plos-ten-rules/original.pdf',
        import.meta.url,
      ),
    ),
  );
const FINGERPRINT = 'urn:x-pdf:3f6b7856e86ad0bde1aa184aae3ded66';

describe('articleFromPdf', () => {
  it('reads each page as a scope, and the document as the viewer reports a picked file', async () => {
    const article = await articleFromPdf(data());
    expect(article.id).toBe(FINGERPRINT);
    expect(article.scopes.map((s) => s.key)).toEqual(['page=1', 'page=2', 'page=3', 'page=4']);
    expect(article.passages[1]).toMatchObject({ n: 2, section: 'page 2' });
    expect(article.document.uri).toBe(FINGERPRINT);
    expect(article.document.links).toEqual([{ uri: FINGERPRINT, relation: 'self' }]);
  });

  it('records the URL it came from beside the fingerprint', async () => {
    const url =
      'https://journals.plos.org/ploscompbiol/article/file?id=10.1371/journal.pcbi.1003285&type=printable';
    const article = await articleFromPdf(data(), url);
    expect(article.document.links).toEqual([
      { uri: url, relation: 'self' },
      { uri: FINGERPRINT, relation: 'pdf_fingerprint' },
    ]);
  });

  it('puts a draft quote inside the page fragment of the one page it is on', async () => {
    const article = await articleFromPdf(data());
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    addAnnotationFormats(ajv);
    addProfileKeywords(ajv);
    const registry = new ProfileRegistry(ajv, builtinProfiles);
    const draft = (quote: string) =>
      checkDraft(
        {
          article: FINGERPRINT,
          engine: { model: 'claude-opus-5-5', skill: 'curanno-suggest', version: '1' },
          items: [{ id: '_:i1', kind: 'individual', quote, value: { case: 'Rule 4' } }],
        },
        article,
        { profiles: builtinProfiles, registry, resolveTerms: () => Promise.resolve(new Map()) },
      );

    const found = await draft(
      'Even the slightest change to a computer program can have large intended or unintended consequences.',
    );
    expect(found.problems).toEqual([]);
    expect(found.batch?.items[0]?.selector).toMatchObject({
      type: 'FragmentSelector',
      value: 'page=2',
      refinedBy: [{ type: 'TextQuoteSelector', prefix: expect.any(String) as string }],
    });

    const everyPage = await draft('PLOS Computational Biology | www.ploscompbiol.org');
    expect(everyPage.problems[0]?.message).toMatch(/more than once/);
    const spanning = await draft(
      'There is a large difference between observing that a result has been reproduced',
    );
    expect(spanning.problems[0]?.message).toMatch(/not on any one page/);
  });
});
