import { caseVariantProfile, type JsonValue } from '@curanno/model';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeApi, json, problem, type FakeApi } from '../test/fake-api';
import StructuredBodyEditor from './StructuredBodyEditor.vue';

const individual = 'https://x.example/annotations/1';

const found = {
  query: 'c.1208G>A',
  gene: 'MYH7',
  candidates: [
    {
      caid: 'CA010365',
      title: 'NM_000257.4(MYH7):c.1208G>A (p.Arg403Gln)',
      registryUrl:
        'https://reg.clinicalgenome.org/redmine/projects/registry/genboree_registry/by_caid?caid=CA010365',
      geneSymbol: 'MYH7',
      hgvs: {
        genomic: 'NC_000014.9:g.23429278C>T',
        transcript: 'NM_000257.4:c.1208G>A',
        protein: 'NP_000248.2:p.Arg403Gln',
      },
      clinVar: [
        { variationId: '14087', url: 'https://www.ncbi.nlm.nih.gov/clinvar/variation/14087/' },
      ],
      gnomad: '14-23429278-C-T',
      dbSnp: 'rs121913624',
      warnings: [],
    },
  ],
  warnings: [
    {
      code: 'transcript-assumed',
      message:
        'No transcript was given, so the MANE Select transcript NM_000257.4 of MYH7 was used.',
    },
  ],
  steps: [{ service: 'registry', request: 'NM_000257.4:c.1208G>A', outcome: 'found CA010365' }],
};

function mountEditor(modelValue: JsonValue) {
  return mount(StructuredBodyEditor, { props: { profile: caseVariantProfile, modelValue } });
}

/** The value the editor emitted last. */
function emitted(wrapper: ReturnType<typeof mountEditor>): JsonValue {
  const events = wrapper.emitted('update:modelValue') ?? [];
  return events.at(-1)?.[0] as JsonValue;
}

describe('variant lookup in the case-variant editor', () => {
  let api: FakeApi;
  beforeEach(() => {
    setActivePinia(createPinia());
    api = installFakeApi(({ url }) =>
      url.pathname === '/x/variants/resolve' ? json(found) : undefined,
    );
  });
  enableAutoUnmount(afterEach);

  it('looks the variant up with the fact’s gene and fills the IDs it picks', async () => {
    const wrapper = mountEditor({
      individuals: [individual],
      geneName: 'MYH7',
      variant: 'c.1208G>A',
      clinVarId: '1',
    });
    await wrapper.get('button.look-up').trigger('click');
    await flushPromises();

    const call = api.calls.find((c) => c.url.pathname === '/x/variants/resolve');
    expect(Object.fromEntries(call?.url.searchParams ?? [])).toEqual({
      q: 'c.1208G>A',
      gene: 'MYH7',
    });
    expect(wrapper.text()).toContain('MANE Select transcript NM_000257.4');
    expect(wrapper.get('.candidate a').attributes('href')).toContain('caid=CA010365');

    await wrapper.get('.candidate button').trigger('click');
    expect(emitted(wrapper)).toEqual({
      individuals: [individual],
      geneName: 'MYH7',
      variant: 'c.1208G>A',
      clinVarId: '14087',
      caid: 'CA010365',
      gnomad: '14-23429278-C-T',
      idSource: 'looked up',
    });
  });

  it('marks a variant unresolvable and clears its IDs', async () => {
    const wrapper = mountEditor({
      individuals: [individual],
      variant: 'exon 3-5 deletion',
      caid: 'CA1',
      clinVarId: '2',
    });
    await wrapper.get('button.mark-unresolvable').trigger('click');
    expect(emitted(wrapper)).toEqual({
      individuals: [individual],
      variant: 'exon 3-5 deletion',
      idSource: 'unresolvable',
    });
    expect(api.calls).toHaveLength(0);
  });

  it('says so when lookup is turned off', async () => {
    installFakeApi(() => problem(404, 'Not Found', 'variant lookup is turned off on this server'));
    const wrapper = mountEditor({ individuals: [individual], variant: 'c.1A>G' });
    await wrapper.get('button.look-up').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Type the IDs by hand');
  });

  it('cannot look up an empty variant', () => {
    const wrapper = mountEditor({ individuals: [individual] });
    expect(wrapper.get('button.look-up').attributes('disabled')).toBeDefined();
  });
});
