import type { Annotation } from '@curanno/api-client';
import { caseVariantProfile, individualProfile } from '@curanno/model';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_KEY } from '../../api/client';
import { fakeApi, json, type FakeApi } from '../../test/fake-api';
import { missingVariants, withCandidate } from '../../variants/missing';
import Variants from './index.vue';

const BASE = 'http://api.test/annotations/';
const uuid = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;

function fact(
  n: number,
  value: Record<string, unknown>,
  { source = `https://pmc.example/PMC${n}`, permissions = ['read', 'update'] } = {},
): Annotation {
  return {
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    id: `${BASE}${uuid(n)}`,
    type: 'Annotation',
    target: {
      source,
      selector: {
        type: 'TextQuoteSelector',
        exact: `The proband carried ${String(value['variant'])}.`,
      },
    },
    body: [
      { type: 'TextualBody', value: 'note', purpose: 'commenting' },
      {
        type: 'StructuredBody',
        profile: caseVariantProfile.iri,
        value: { individuals: ['https://x.example/annotations/i'], ...value },
      },
    ],
    permissions,
  } as unknown as Annotation;
}

const candidate = {
  caid: 'CA010365',
  title: 'NM_000257.4(MYH7):c.1208G>A (p.Arg403Gln)',
  hgvs: { transcript: 'NM_000257.4:c.1208G>A' },
  clinVar: [{ variationId: '14087', url: 'https://www.ncbi.nlm.nih.gov/clinvar/variation/14087/' }],
  gnomad: '14-23429278-C-T',
  warnings: [],
};

describe('missingVariants', () => {
  it('groups facts without IDs by gene and variant, most facts first', () => {
    const groups = missingVariants([
      fact(1, { variant: 'c.1208G>A', geneName: 'myh7' }),
      fact(2, { variant: ' c.1208G>A ', geneName: 'MYH7' }),
      fact(3, { variant: 'c.1208G>A' }),
      fact(4, { variant: 'c.2A>G', caid: 'CA1' }),
      fact(5, { variant: 'exon 3 deletion', idSource: 'unresolvable' }),
      {
        ...fact(6, {}),
        body: { type: 'StructuredBody', profile: individualProfile.iri, value: { case: 'P1' } },
      },
    ]);
    expect(groups.map((g) => [g.variant, g.gene, g.facts.length])).toEqual([
      ['c.1208G>A', 'MYH7', 2],
      ['c.1208G>A', undefined, 1],
    ]);
    expect(groups[0]!.facts[0]).toMatchObject({
      uuid: uuid(1),
      source: 'https://pmc.example/PMC1',
      quote: 'The proband carried c.1208G>A.',
      writable: true,
    });
  });

  it('replaces any earlier IDs with the candidate’s', () => {
    expect(withCandidate({ variant: 'x', caid: 'CA9', gnomad: 'old' }, candidate)).toEqual({
      variant: 'x',
      caid: 'CA010365',
      clinVarId: '14087',
      gnomad: '14-23429278-C-T',
      idSource: 'looked up',
    });
  });
});

describe('the variants page', () => {
  let api: FakeApi;
  let stored: Map<string, Annotation>;

  beforeEach(() => {
    stored = new Map(
      [
        fact(1, { variant: 'c.1208G>A', geneName: 'MYH7' }),
        fact(2, { variant: 'c.1208G>A', geneName: 'MYH7' }),
        fact(3, { variant: 'c.1208G>A', geneName: 'MYH7' }, { permissions: ['read'] }),
      ].map((a) => [uuid(Number(a.id.slice(BASE.length, BASE.length + 8))), a]),
    );
    api = fakeApi(({ method, url, body }) => {
      if (url.pathname === '/x/search') {
        const items = [...stored.values()];
        return json({ total: items.length, items });
      }
      if (url.pathname === '/x/variants/resolve') {
        return json({ query: 'c.1208G>A', candidates: [candidate], warnings: [], steps: [] });
      }
      const id = url.pathname.replace('/annotations/', '');
      if (method === 'GET' && stored.has(id)) {
        return json(stored.get(id), { headers: { etag: `"${id}-1"` } });
      }
      if (method === 'PUT' && stored.has(id)) {
        const updated = { ...stored.get(id)!, ...(body as object) } as Annotation;
        stored.set(id, updated);
        return json(updated, { headers: { etag: `"${id}-2"` } });
      }
      return undefined;
    });
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function mountPage(): VueWrapper {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const wrapper: VueWrapper = mount(Variants, {
      global: { provide: { [API_KEY as symbol]: api.client } },
      attachTo: document.body,
    });
    return wrapper;
  }

  it('looks a variant up with its gene and saves the IDs to every fact the caller may edit', async () => {
    const wrapper = mountPage();
    await flushPromises();
    const search = api.calls.find((c) => c.url.pathname === '/x/search')?.url.searchParams;
    expect(search?.get('profile')).toBe(caseVariantProfile.iri);
    expect(wrapper.text()).toContain('1 variant in 3 annotations');
    expect(wrapper.find('input[name="gene"]').element).toHaveProperty('value', 'MYH7');

    await wrapper.find('form').trigger('submit');
    await flushPromises();
    const resolve = api.calls.find((c) => c.url.pathname === '/x/variants/resolve')?.url;
    expect(Object.fromEntries(resolve?.searchParams ?? [])).toEqual({
      q: 'c.1208G>A',
      gene: 'MYH7',
    });

    const use = wrapper.findAll('button').find((b) => b.text() === 'Use for 2 annotations');
    await use!.trigger('click');
    await flushPromises();

    const puts = api.calls.filter((c) => c.method === 'PUT');
    expect(puts.map((c) => c.url.pathname)).toEqual([
      `/annotations/${uuid(1)}`,
      `/annotations/${uuid(2)}`,
    ]);
    const sent = puts[0]!.body as { body: { type: string; value?: unknown }[] };
    expect(sent.body[0]).toEqual({ type: 'TextualBody', value: 'note', purpose: 'commenting' });
    expect(sent.body[1]!.value).toEqual({
      individuals: ['https://x.example/annotations/i'],
      variant: 'c.1208G>A',
      geneName: 'MYH7',
      caid: 'CA010365',
      clinVarId: '14087',
      gnomad: '14-23429278-C-T',
      idSource: 'looked up',
    });
    expect(sent).not.toHaveProperty('permissions');
    // The read-only fact remains, with what happened.
    expect(wrapper.text()).toContain('1 variant in 1 annotation');
    expect(wrapper.text()).toContain('2 saved, 1 left as they were');
  });

  it('marks a variant unresolvable', async () => {
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.find('button.link').trigger('click');
    await flushPromises();
    const puts = api.calls.filter((c) => c.method === 'PUT');
    expect(puts).toHaveLength(2);
    const sent = puts[0]!.body as { body: { value?: Record<string, unknown> }[] };
    expect(sent.body[1]!.value?.['idSource']).toBe('unresolvable');
  });
});
