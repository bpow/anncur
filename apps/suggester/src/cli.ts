#!/usr/bin/env node
/**
 * Suggests annotations for PubMed Central articles and posts them for a
 * group to review in CurAnno (ADR 0037, 0038):
 *
 *   CURANNO_TOKEN=cat_… node apps/suggester/src/cli.ts \
 *     --api https://curanno.example --group <uuid> \
 *     --endpoint http://localhost:1234 --model qwen3 \
 *     --profile individual --profile case-family --profile case-phenotypes \
 *     --pmcid PMC1234567 [--list ids.txt] [--bioc article.json] \
 *     [--state suggester-state.json] [--api-key-env OPENAI_API_KEY] [--dry-run]
 *
 * Articles come from PMC's open-access BioC service, or from BioC JSON
 * files with --bioc. Scheduling is the caller's: run it from cron.
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createApiClient } from '@curanno/api-client';
import { PROMPT_VERSION } from '@curanno/extract';
import { articleFromBioc, fetchBioc, type Article } from './bioc.ts';
import { loadProfiles, rerunKey, suggestFor } from './run.ts';
import { State } from './state.ts';

const { values } = parseArgs({
  options: {
    api: { type: 'string' },
    'token-env': { type: 'string', default: 'CURANNO_TOKEN' },
    group: { type: 'string' },
    endpoint: { type: 'string' },
    model: { type: 'string' },
    'api-key-env': { type: 'string' },
    profile: { type: 'string', multiple: true, default: [] },
    pmcid: { type: 'string', multiple: true, default: [] },
    list: { type: 'string' },
    bioc: { type: 'string', multiple: true, default: [] },
    'bioc-url': { type: 'string' },
    instructions: { type: 'string' },
    state: { type: 'string' },
    force: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});

function required(name: keyof typeof values): string {
  const value = values[name];
  if (typeof value !== 'string' || !value) throw new Error(`--${name} is required`);
  return value;
}

async function main(): Promise<number> {
  const apiUrl = required('api');
  const token = process.env[values['token-env']];
  if (!token && !values['dry-run']) {
    throw new Error(
      `set ${values['token-env']} to an access token with the suggestions:write scope`,
    );
  }
  const apiKeyEnv = values['api-key-env'];
  const apiKey = apiKeyEnv ? process.env[apiKeyEnv] : undefined;
  if (apiKeyEnv && !apiKey) throw new Error(`${apiKeyEnv} is not set`);
  const endpoint = {
    url: required('endpoint'),
    model: required('model'),
    ...(apiKey ? { apiKey } : {}),
  };
  const group = values['dry-run'] ? (values.group ?? '') : required('group');
  if (!values.profile.length) throw new Error('name at least one --profile, such as individual');

  const api = createApiClient({ baseUrl: apiUrl, ...(token ? { token: () => token } : {}) });
  const profiles = await loadProfiles(api, values.profile).catch((err: unknown) => {
    throw new Error(`could not read the profiles from ${apiUrl}: ${(err as Error).message}`);
  });
  const run = `${rerunKey(profiles.chosen)} ${endpoint.model} prompt ${PROMPT_VERSION}`;
  const state = await State.open(values.state);

  const ids = [...values.pmcid];
  if (values.list) {
    const listed = await readFile(values.list, 'utf8');
    ids.push(...listed.split(/\s+/).filter((l) => /^PMC\d+$/i.test(l)));
  }
  const sources: (() => Promise<Article>)[] = [
    ...values.bioc.map(
      (file) => async () => articleFromBioc(JSON.parse(await readFile(file, 'utf8'))),
    ),
    ...ids.map(
      (id) => async () =>
        articleFromBioc(
          await fetchBioc(id.toUpperCase(), values['bioc-url'] ? { base: values['bioc-url'] } : {}),
        ),
    ),
  ];
  if (!sources.length) throw new Error('name articles with --pmcid, --list or --bioc');

  let failures = 0;
  for (const load of sources) {
    let article: Article;
    try {
      article = await load();
    } catch (err) {
      failures++;
      console.error(`skipped: ${(err as Error).message}`);
      continue;
    }
    if (!values.force && state.isDone(article.pmcid, run)) {
      console.error(`${article.pmcid}: done already`);
      continue;
    }
    try {
      const outcome = await suggestFor(article, {
        api,
        group,
        endpoint,
        profiles,
        ...(values.instructions ? { instructions: values.instructions } : {}),
        dryRun: values['dry-run'],
        onProgress: (p) => {
          if (p.done === p.total)
            console.error(`${article.pmcid}: ${p.kind} (${p.step} of ${p.steps}) read`);
        },
      });
      const notes = [
        `${outcome.items} suggestion${outcome.items === 1 ? '' : 's'}`,
        ...(outcome.rejected ? [`${outcome.rejected} set aside`] : []),
        ...(outcome.skipped.length ? [`not asked about ${outcome.skipped.join(', ')}`] : []),
      ];
      if (values['dry-run']) {
        console.log(JSON.stringify(outcome.body ?? null, null, 2));
      } else {
        await state.record(article.pmcid, run, outcome.batch);
      }
      console.error(
        `${article.pmcid}: ${notes.join('; ')}${outcome.batch ? `, posted as batch ${outcome.batch}` : ''}`,
      );
    } catch (err) {
      failures++;
      console.error(`${article.pmcid}: failed: ${(err as Error).message}`);
    }
  }
  return failures ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error((err as Error).message);
    process.exit(2);
  },
);
