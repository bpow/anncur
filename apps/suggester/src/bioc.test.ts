import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { articleFromBioc, fetchBioc } from './bioc.ts';

const bioc = JSON.parse(
  readFileSync(new URL('../test/PMC0000001.json', import.meta.url), 'utf8'),
) as unknown;

describe('articleFromBioc', () => {
  it('reads the passages as blocks, without the references, and the identifiers', () => {
    const article = articleFromBioc(bioc);
    expect(article.pmcid).toBe('PMC0000001');
    expect(article.scope).toEqual({
      key: 'body',
      text: 'A family with cardiomyopathyPatient 1, a 14-year-old boy, presented with syncope.His parents are first cousins.',
      blockStarts: [28, 81],
    });
    expect(article.document).toEqual({
      uri: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC0000001/',
      title: 'A family with cardiomyopathy',
      links: [
        { uri: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC0000001/', relation: 'self' },
        { uri: 'https://doi.org/10.1000/example.1', relation: 'doi' },
      ],
    });
  });

  it('says so when the service has no such article', async () => {
    const fake: typeof fetch = () => Promise.resolve(new Response('No result can be found.'));
    await expect(fetchBioc('PMC9', { fetch: fake })).rejects.toThrow(/not in PMC's open-access/);
  });
});
