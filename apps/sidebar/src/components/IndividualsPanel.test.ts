import type { Annotation } from '@curanno/api-client';
import {
  caseFamilyProfile,
  caseIndividualProfile,
  caseVariantProfile,
  individualProfile,
  type JsonValue,
} from '@curanno/model';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { GUEST_KEY } from '../guest';
import { createFakeGuest, type FakeGuest } from '../guest/fake';
import { useAnnotationsStore } from '../stores/annotations';
import { useProfilesStore } from '../stores/profiles';
import { installFakeApi, json } from '../test/fake-api';
import IndividualsPanel from './IndividualsPanel.vue';

const PAGE = 'https://example.org/article';
const iri = (n: number) => `https://x.example/annotations/0000000${n}`;

function annotation(n: number, profile: string, value: JsonValue): Annotation {
  return {
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    id: iri(n),
    type: 'Annotation',
    target: { source: PAGE },
    body: { type: 'StructuredBody', profile, value },
  };
}

let guest: FakeGuest;

beforeEach(async () => {
  setActivePinia(createPinia());
  installFakeApi(({ url }) =>
    url.pathname === '/x/profiles'
      ? json(
          [caseIndividualProfile, individualProfile, caseVariantProfile, caseFamilyProfile].map(
            (p) => ({ ...p, builtin: true, enabled: true }),
          ),
        )
      : undefined,
  );
  await useProfilesStore().load();
  guest = createFakeGuest({ document: { uri: PAGE, links: [{ uri: PAGE, relation: 'self' }] } });
});

const mountPanel = () =>
  mount(IndividualsPanel, { global: { provide: { [GUEST_KEY as symbol]: guest } } });

describe('IndividualsPanel', () => {
  it('shows nothing while the page has no individuals or facts', () => {
    expect(mountPanel().find('details').exists()).toBe(false);
  });

  it('summarises each individual from its facts and finds the passages', async () => {
    const store = useAnnotationsStore();
    store.upsert(annotation(1, individualProfile.iri, { case: 'II-1' }));
    const link = { individual: iri(1), case: 'II-1' };
    store.upsert(annotation(2, caseFamilyProfile.iri, { ...link, familyInfo: 'Father affected.' }));
    store.upsert(
      annotation(3, caseFamilyProfile.iri, { individual: iri(9), case: 'P9', familyInfo: 'x' }),
    );
    const wrapper = mountPanel();
    expect(wrapper.find('summary').text()).toBe('Individuals (1)');
    const card = wrapper.find('article.individual');
    expect(card.find('h2').text()).toContain('II-1');
    expect(card.text()).toContain('FamilyInfo');
    expect(card.text()).toContain('Father affected.');
    // No variant fact yet.
    expect(card.find('.incomplete').text()).toContain("must have required property 'variants'");
    expect(wrapper.find('.unlinked').text()).toContain('Fact 1');

    await card.find('button[aria-label^="Show where FamilyInfo"]').trigger('click');
    expect(guest.log.value.at(-1)).toBe(`scroll to ${iri(2).slice(-8)}`);

    store.upsert(annotation(4, caseVariantProfile.iri, { ...link, variant: 'c.1A>G' }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.incomplete').exists()).toBe(false);
    expect(wrapper.find('.variant').text()).toContain('c.1A>G');
  });
});
