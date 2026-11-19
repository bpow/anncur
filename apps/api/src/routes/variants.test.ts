/** Variant lookup through the API (ADR 0039); the resolver itself is tested in src/variants. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alice, createTestContext, databaseUrl, type TestContext } from '../test/harness.js';

describe.skipIf(!databaseUrl)('variant lookup turned off', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({
      config: {
        variantLookup: {
          enabled: false,
          registryUrl: 'https://reg.genome.network',
          variantValidatorUrl: 'https://rest.variantvalidator.org',
          timeoutMs: 1000,
        },
      },
    });
  });
  afterAll(() => ctx.close());

  it('answers 404', async () => {
    const res = await ctx.as(alice, { method: 'GET', url: '/x/variants/resolve?q=c.1A%3EG' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ detail: string }>().detail).toMatch(/turned off/);
  });
});

describe.skipIf(!databaseUrl)('variant lookup', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it('lets a browser reuse a result for an hour', async () => {
    const res = await ctx.as(alice, {
      method: 'GET',
      url: `/x/variants/resolve?q=${encodeURIComponent('NM_000257.4:c.1208G>A')}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
  });

  it('refuses a gene that is not an HGNC symbol', async () => {
    const res = await ctx.as(alice, {
      method: 'GET',
      url: '/x/variants/resolve?q=c.1A%3EG&gene=not%20a%20gene',
    });
    expect(res.statusCode).toBe(400);
  });
});
