/**
 * A `fetch` that answers from recorded responses of the Allele Registry and
 * VariantValidator (`fixtures/*.json`, trimmed copies of live answers), for
 * tests. A request with no recording fails, as an unreachable service would.
 */
import { readFileSync } from 'node:fs';

export interface Recording {
  status: number;
  body: unknown;
}

export function loadRecordings(name = 'myh7'): Record<string, Recording> {
  const url = new URL(`../../src/variants/fixtures/${name}.json`, import.meta.url);
  // Run from src (vitest) or dist (built): both resolve to src/variants/fixtures.
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, Recording>;
}

export function fixtureFetch(
  recordings: Record<string, Recording> = loadRecordings(),
  requested: string[] = [],
): typeof fetch {
  return (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    const recording = recordings[url];
    if (!recording) return Promise.reject(new TypeError(`fetch failed: no recording for ${url}`));
    return Promise.resolve(
      new Response(JSON.stringify(recording.body), {
        status: recording.status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
}
