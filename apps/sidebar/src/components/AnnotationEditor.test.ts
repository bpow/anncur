import { PROFILE_BASE, caseIndividualProfile, evidenceExcerptProfile } from '@curanno/model';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useProfilesStore } from '../stores/profiles';
import { installFakeApi, json } from '../test/fake-api';
import type { AnnotationDraft } from '../api/annotations';
import AnnotationEditor from './AnnotationEditor.vue';

const profileIri = `${PROFILE_BASE}evidence-excerpt/1`;

describe('AnnotationEditor', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    installFakeApi(({ url }) =>
      url.pathname === '/x/profiles'
        ? json(
            [evidenceExcerptProfile, caseIndividualProfile].map((p) => ({
              ...p,
              builtin: true,
              enabled: true,
            })),
          )
        : undefined,
    );
    await useProfilesStore().load();
  });

  it('emits the draft with text and tags', async () => {
    const wrapper = mount(AnnotationEditor, { props: { draft: { text: '', tags: ['t'] } } });
    await wrapper.find('textarea[name="text"]').setValue('Hello');
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('save')).toEqual([[{ text: 'Hello', tags: ['t'] }]]);
  });

  it('validates a structured body against the profile before saving', async () => {
    const wrapper = mount(AnnotationEditor, { props: { draft: { text: '', tags: [] } } });
    await wrapper.find('select[name="profile"]').setValue(profileIri);
    await wrapper.find('select[name="kind"]').setValue('case');
    const identifiers = wrapper.find('input[name="identifiers"]');
    const addIdentifier = async (text: string) => {
      await identifiers.setValue(text);
      await identifiers.trigger('keydown', { key: 'Enter' });
      await flushPromises();
    };
    await addIdentifier('not a curie');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.emitted('save')).toBeUndefined();
    expect(wrapper.text()).toContain('must match pattern');

    await wrapper.find('.tag button').trigger('click');
    await addIdentifier('PMID:12345');
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('save')).toEqual([
      [
        {
          text: '',
          tags: [],
          structured: { profile: profileIri, value: { kind: 'case', identifiers: ['PMID:12345'] } },
        },
      ],
    ]);
  });

  it('keeps who made a structured body while it keeps its profile', async () => {
    const creator = { type: 'Software' as const, name: 'curanno-extract' };
    const draft = {
      text: '',
      tags: [],
      structured: {
        profile: profileIri,
        value: { kind: 'case' },
        creator,
        created: '2026-11-13T12:00:00Z',
      },
    };
    const wrapper = mount(AnnotationEditor, { props: { draft } });
    await wrapper.find('select[name="kind"]').setValue('functional');
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      structured: { value: { kind: 'functional' }, creator, created: '2026-11-13T12:00:00Z' },
    });
  });

  it('shows a conflict notice for a 412 and asks to reload', async () => {
    const wrapper = mount(AnnotationEditor, {
      props: {
        draft: { text: 'x', tags: [] },
        problem: { status: 412, title: 'Precondition Failed' },
      },
    });
    expect(wrapper.text()).toContain('Someone else changed this annotation');
    await wrapper.find('button.link').trigger('click');
    expect(wrapper.emitted('reload')).toHaveLength(1);
  });

  it('stages grants with the draft when sharing is offered', async () => {
    const bob = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', kind: 'user' as const, name: 'Bob' };
    installFakeApi(({ url }) => (url.pathname === '/x/principals' ? json([bob]) : undefined));
    const wrapper = mount(AnnotationEditor, {
      props: { draft: { text: '', tags: [] }, sharing: true },
    });
    await wrapper.find('textarea[name="text"]').setValue('Hello');
    await wrapper.find('input[name="principal"]').setValue('bob');
    await new Promise((r) => setTimeout(r, 250));
    await flushPromises();
    await wrapper.find('[role="option"]').trigger('click');
    await wrapper.find('input[aria-label="update for Bob"]').setValue(true);
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('save')).toEqual([
      [
        {
          text: 'Hello',
          tags: [],
          acl: [
            { principal: bob, permission: 'read' },
            { principal: bob, permission: 'update' },
          ],
        },
      ],
    ]);
  });

  it('offers no sharing controls unless asked', () => {
    const wrapper = mount(AnnotationEditor, { props: { draft: { text: '', tags: [] } } });
    expect(wrapper.find('.sharing').exists()).toBe(false);
  });

  it('offers a derived profile only to a body that already has it', () => {
    const options = (draft: AnnotationDraft) =>
      mount(AnnotationEditor, { props: { draft } })
        .find('select[name="profile"]')
        .findAll('option')
        .map((o) => o.text());
    expect(options({ text: '', tags: [] })).toEqual(['None', 'Evidence excerpt']);
    expect(
      options({
        text: '',
        tags: [],
        structured: { profile: caseIndividualProfile.iri, value: { case: 'P1' } },
      }),
    ).toEqual(['None', 'Evidence excerpt', 'Case individual']);
  });
});
