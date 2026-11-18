import { describe, expect, it } from 'vitest';
import { articleFromHtml } from './html.ts';

const page = (head: string) =>
  `<!doctype html><html><head><title>A case</title>${head}</head><body><p>Patient 1 presented with syncope.</p></body></html>`;

describe('articleFromHtml', () => {
  it('names a publisher page by its DOI', () => {
    const article = articleFromHtml(
      page('<meta name="citation_doi" content="10.1000/Example.1">'),
      'https://journal.example/article/123',
    );
    expect(article.id).toBe('10.1000/example.1');
    expect(article.document.uri).toBe('https://journal.example/article/123');
  });

  it('names a PMC page by its PMC id, and a page with neither by its URL', () => {
    expect(articleFromHtml(page(''), 'https://pmc.ncbi.nlm.nih.gov/articles/pmc123/').id).toBe(
      'PMC123',
    );
    expect(articleFromHtml(page(''), 'https://journal.example/article/123').id).toBe(
      'https://journal.example/article/123',
    );
  });
});
