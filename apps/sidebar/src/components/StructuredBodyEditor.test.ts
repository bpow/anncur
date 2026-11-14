import {
  caseFamilyProfile,
  caseIndividualProfile,
  evidenceExcerptProfile,
  individualProfile,
  type BodyProfile,
} from '@curanno/model';
import type { Annotation } from '@curanno/api-client';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { describe, expect, it } from 'vitest';
import { useAnnotationsStore } from '../stores/annotations';
import { installFakeApi, json } from '../test/fake-api';
import StructuredBodyEditor from './StructuredBodyEditor.vue';

describe('StructuredBodyEditor', () => {
  it('builds fields from the profile schema', () => {
    const wrapper = mount(StructuredBodyEditor, {
      props: { profile: evidenceExcerptProfile, modelValue: {} },
    });
    const kind = wrapper.find('select[name="kind"]');
    expect(kind.exists()).toBe(true);
    expect(kind.attributes('required')).toBeDefined();
    expect(kind.findAll('option').map((o) => o.text())).toEqual([
      '—',
      'case',
      'functional',
      'segregation',
      'population',
      'computational',
      'other',
    ]);
    expect(wrapper.find('textarea[name="summary"]').exists()).toBe(true);
    expect(wrapper.find('select[name="confidence"]').exists()).toBe(true);
    expect(wrapper.find('input[name="identifiers"]').exists()).toBe(true);
  });

  it('marks a required list field required until it has an item', async () => {
    const profile: BodyProfile = {
      ...evidenceExcerptProfile,
      schema: { ...evidenceExcerptProfile.schema, required: ['kind', 'identifiers'] },
    };
    const wrapper = mount(StructuredBodyEditor, { props: { profile, modelValue: {} } });
    const identifiers = () => wrapper.find('input[name="identifiers"]');
    expect(identifiers().attributes('required')).toBeDefined();
    expect(identifiers().attributes('aria-required')).toBe('true');
    await wrapper.setProps({ modelValue: { identifiers: ['PMID:1'] } });
    expect(identifiers().attributes('required')).toBeUndefined();
    expect(identifiers().attributes('aria-required')).toBe('true');
  });

  it('emits the value with enum, list and text fields set and empty ones dropped', async () => {
    const wrapper = mount(StructuredBodyEditor, {
      props: { profile: evidenceExcerptProfile, modelValue: { summary: 'old' } },
    });
    await wrapper.find('select[name="kind"]').setValue('case');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      { summary: 'old', kind: 'case' },
    ]);

    await wrapper.setProps({ modelValue: { summary: 'old', kind: 'case' } });
    const identifiers = wrapper.find('input[name="identifiers"]');
    expect(wrapper.find(`label[for="${identifiers.attributes('id')}"]`).text()).toBe('identifiers');
    await identifiers.setValue('PMID:1');
    await identifiers.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    await wrapper.setProps({
      modelValue: { summary: 'old', kind: 'case', identifiers: ['PMID:1'] },
    });
    await identifiers.setValue('HGNC:2');
    await identifiers.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      { summary: 'old', kind: 'case', identifiers: ['PMID:1', 'HGNC:2'] },
    ]);

    await wrapper.setProps({ modelValue: { summary: 'old', kind: 'case' } });
    await wrapper.find('textarea[name="summary"]').setValue('');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([{ kind: 'case' }]);
  });

  it('shows validation errors under the field they point at', () => {
    const wrapper = mount(StructuredBodyEditor, {
      props: {
        profile: evidenceExcerptProfile,
        modelValue: { kind: 'case', identifiers: ['bad'] },
        errors: [
          { instancePath: '/value/identifiers/0', message: 'must match pattern' },
          { instancePath: '/value', message: 'must have required property kind' },
        ],
      },
    });
    const errors = wrapper.findAll('.error').map((e) => e.text());
    expect(errors).toEqual(['must match pattern', 'must have required property kind']);
    const identifiers = wrapper
      .findAll('.field')
      .find((f) => f.find('[name="identifiers"]').exists());
    expect(identifiers?.text()).toContain('must match pattern');
  });

  describe('object lists', () => {
    const profile: BodyProfile = {
      iri: 'https://curanno.example/profiles/test-list/1',
      title: 'List test',
      schema: {
        type: 'object',
        required: ['variants'],
        properties: {
          variants: {
            title: 'Variants',
            type: 'array',
            minItems: 1,
            items: {
              title: 'Variant',
              type: 'object',
              required: ['variant'],
              properties: { gene: { type: 'string' }, variant: { type: 'string' } },
            },
          },
        },
      },
    };

    it('adds, edits and removes items', async () => {
      const wrapper = mount(StructuredBodyEditor, { props: { profile, modelValue: {} } });
      await wrapper.find('button:not(.link)').trigger('click');
      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([{ variants: [{}] }]);

      await wrapper.setProps({ modelValue: { variants: [{ gene: 'MYH7' }, {}] } });
      expect(wrapper.find<HTMLTextAreaElement>('[name="variants.0.gene"]').element.value).toBe(
        'MYH7',
      );
      await wrapper.find('[name="variants.1.variant"]').setValue('c.1208G>A');
      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
        { variants: [{ gene: 'MYH7' }, { variant: 'c.1208G>A' }] },
      ]);

      await wrapper.find('button.link').trigger('click');
      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([{ variants: [{}] }]);

      await wrapper.setProps({ modelValue: { variants: [{}] } });
      await wrapper.find('button.link').trigger('click');
      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([{}]);
    });

    it('shows item errors inside the item and list errors under the list', () => {
      const wrapper = mount(StructuredBodyEditor, {
        props: {
          profile,
          modelValue: { variants: [{ gene: 'MYH7' }] },
          errors: [
            { instancePath: '/value/variants/0', message: 'must have required property variant' },
            { instancePath: '/value/variants', message: 'must NOT have fewer than 1 items' },
          ],
        },
      });
      expect(wrapper.find('fieldset.item').text()).toContain('must have required property variant');
      const list = wrapper.find('fieldset.list');
      expect(list.findAll(':scope > .error').map((e) => e.text())).toEqual([
        'must NOT have fewer than 1 items',
      ]);
      expect(wrapper.findAll('.error')).toHaveLength(2);
    });
  });

  it('builds the case-individual form with a variant list', () => {
    setActivePinia(createPinia());
    // Its phenotype field loads the ontology list.
    installFakeApi(() => json([]));
    const wrapper = mount(StructuredBodyEditor, {
      props: { profile: caseIndividualProfile, modelValue: { case: 'P1', variants: [{}] } },
    });
    expect(wrapper.find('input[name="case"]').attributes('required')).toBeDefined();
    expect(wrapper.find('textarea[name="diseaseAssertion"]').exists()).toBe(true);
    expect(wrapper.find('input[role="combobox"][name="casePresentingHpos"]').exists()).toBe(true);
    expect(wrapper.find('[name="caseHpoFreeText"]').exists()).toBe(false);
    expect(wrapper.find('input[name="variants.0.variant"]').attributes('required')).toBeDefined();
    expect(wrapper.find('input[name="variants.0.clinVarId"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Add Variant');
  });

  it('links a fact to an individual on the page and copies its label', async () => {
    setActivePinia(createPinia());
    const individual = (id: string, label: string): Annotation =>
      ({
        '@context': 'http://www.w3.org/ns/anno.jsonld',
        id,
        type: 'Annotation',
        target: {
          source: 'https://example.org/a',
          selector: { type: 'TextQuoteSelector', exact: `${label} was a boy` },
        },
        body: { type: 'StructuredBody', profile: individualProfile.iri, value: { case: label } },
      });
    const store = useAnnotationsStore();
    store.upsert(individual('https://x.example/annotations/1', 'II-1'));
    store.upsert(individual('https://x.example/annotations/2', 'II-2'));

    const wrapper = mount(StructuredBodyEditor, {
      props: { profile: caseFamilyProfile, modelValue: { familyInfo: 'Father affected.' } },
    });
    const picker = wrapper.find('select[name="individual"]');
    expect(picker.findAll('option').map((o) => o.text())).toEqual(['—', 'II-1', 'II-2']);
    expect(picker.findAll('option')[2]?.attributes('title')).toBe('II-2 was a boy');
    await picker.setValue('https://x.example/annotations/2');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      {
        familyInfo: 'Father affected.',
        individual: 'https://x.example/annotations/2',
        case: 'II-2',
      },
    ]);
  });

  it('keeps a link to an individual that is not loaded', () => {
    setActivePinia(createPinia());
    const wrapper = mount(StructuredBodyEditor, {
      props: {
        profile: caseFamilyProfile,
        modelValue: { individual: 'https://x.example/annotations/9', case: 'P9' },
      },
    });
    const picker = wrapper.find('select[name="individual"]');
    expect(picker.findAll('option').map((o) => o.text())).toEqual(['—', 'P9 (not on this page)']);
    expect((picker.element as HTMLSelectElement).value).toBe('https://x.example/annotations/9');
  });
});
