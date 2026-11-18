import type { Annotation } from '@curanno/api-client';
import { caseFamilyProfile, individualProfile } from '@curanno/model';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { TooltipProvider } from 'reka-ui';
import { beforeEach, describe, expect, it } from 'vitest';
import { h } from 'vue';
import { setUserManagerFactory, useAuthStore } from '../auth/store';
import { forgetCurrentUser } from '../current-user';
import { GUEST_KEY } from '../guest';
import { createFakeGuest } from '../guest/fake';
import { useAnnotationsStore } from '../stores/annotations';
import { useProfilesStore } from '../stores/profiles';
import { installFakeApi, json, type FakeApi } from '../test/fake-api';
import { fakeUser, stubUserManager } from '../test/stub-user-manager';
import AnnotationCard from './AnnotationCard.vue';

const PAGE = 'https://example.org/article';
const BASE = 'https://annotations.test/annotations/';
const iri = (n: number) => `${BASE}0000000${n}-0000-4000-8000-000000000000`;
const ME = 'https://annotations.test/x/users/7';
const model = { type: 'Software' as const, name: 'curanno-extract' };

function annotation(
  n: number,
  body: NonNullable<Annotation['body']>,
  extra: Partial<Annotation> = {},
): Annotation {
  return {
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    id: iri(n),
    type: 'Annotation',
    target: { source: PAGE, selector: { type: 'TextQuoteSelector', exact: `passage ${n}` } },
    body,
    ...extra,
  };
}

const individual = (n: number, label: string) =>
  annotation(n, { type: 'StructuredBody', profile: individualProfile.iri, value: { case: label } });

const fact = annotation(
  9,
  {
    type: 'StructuredBody',
    profile: caseFamilyProfile.iri,
    value: { individuals: [iri(1), iri(2)], familyInfo: 'Parents are cousins.' },
    creator: model,
  },
  { permissions: ['read', 'update', 'delete', 'share'] },
);

// Cards live inside the App's tooltip provider.
const mountCard = (options: { attachTo?: HTMLElement; annotation?: Annotation } = {}) =>
  mount(
    () => h(TooltipProvider, () => h(AnnotationCard, { annotation: options.annotation ?? fact })),
    {
      global: { provide: { [GUEST_KEY as symbol]: createFakeGuest() } },
      ...options,
    },
  );

describe('AnnotationCard', () => {
  let api: FakeApi;
  beforeEach(async () => {
    setActivePinia(createPinia());
    forgetCurrentUser();
    setUserManagerFactory(() => stubUserManager(fakeUser({ sub: 'alice' })));
    const acl = [{ principal: { id: 'group:g1', type: 'group' }, permission: 'read' }];
    api = installFakeApi(({ method, url, body }) => {
      const path = url.pathname;
      if (path === '/x/profiles') {
        return json(
          [individualProfile, caseFamilyProfile].map((p) => ({
            ...p,
            builtin: true,
            enabled: true,
          })),
        );
      }
      if (path === '/x/me') return json({ iri: ME });
      if (path === `/annotations/${iri(9).slice(BASE.length)}` && method === 'GET') {
        return json(fact, { headers: { etag: '"1"' } });
      }
      if (path === `/annotations/${iri(9).slice(BASE.length)}` && method === 'PUT') {
        return json({ ...fact, ...(body as object) }, { headers: { etag: '"2"' } });
      }
      if (path === '/annotations/' && method === 'POST') {
        return json({ ...(body as object), id: iri(8) }, { status: 201, headers: { etag: '"1"' } });
      }
      if (path.endsWith('/acl') && method === 'GET') return json(acl);
      if (path.endsWith('/acl') && method === 'PUT') return json(acl);
      if (path === `/annotations/${iri(8).slice(BASE.length)}`) return json({ id: iri(8) });
      return undefined;
    });
    await useAuthStore().init();
    await useProfilesStore().load();
    const store = useAnnotationsStore();
    store.upsert(individual(1, 'II-1'), PAGE);
    store.upsert(individual(2, 'II-2'), PAGE);
    store.upsert(fact, PAGE);
  });

  it('renders the comment as Markdown, escaping raw HTML', () => {
    const note = annotation(7, {
      type: 'TextualBody',
      value: '**Proband** has <b>no</b> [notes](https://example.org/n)',
      purpose: 'commenting',
    });
    const comment = mountCard({ annotation: note }).find('.comment');
    expect(comment.find('strong').text()).toBe('Proband');
    expect(comment.find('b').exists()).toBe(false);
    expect(comment.text()).toContain('<b>no</b>');
    expect(comment.find('a').attributes()).toMatchObject({
      href: 'https://example.org/n',
      target: '_blank',
    });
  });

  it('shows the linked individuals by their labels', () => {
    const wrapper = mountCard();
    expect(wrapper.find('.structured-view').text()).toContain('II-1, II-2');
  });

  it('splits one individual off into a copy shared like the original', async () => {
    const wrapper = mountCard({ attachTo: document.body });
    const trigger = wrapper.find('button.link');
    expect(trigger.text()).toBe('Split…');
    await trigger.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    const items = [...document.querySelectorAll('.dropdown-menu-item')] as HTMLElement[];
    expect(items.map((i) => i.textContent?.trim())).toEqual(['Split off II-1', 'Split off II-2']);
    items[1]!.click();
    await flushPromises();

    const calls = api.calls.map((c) => `${c.method} ${c.url.pathname.replace(BASE, '')}`);
    const posted = api.calls.find((c) => c.method === 'POST' && c.url.pathname === '/annotations/');
    expect(posted?.body).toMatchObject({
      target: fact.target,
      body: {
        value: { individuals: [iri(2)], familyInfo: 'Parents are cousins.' },
        creator: [model, { type: 'Person', id: ME }],
      },
    });
    const shared = api.calls.find((c) => c.method === 'PUT' && c.url.pathname.endsWith('/acl'));
    expect(shared?.url.pathname).toContain(iri(8).slice(BASE.length));
    expect(shared?.body).toEqual([{ principal: 'group:g1', permission: 'read' }]);
    const replaced = api.calls.find(
      (c) => c.method === 'PUT' && c.url.pathname === `/annotations/${iri(9).slice(BASE.length)}`,
    );
    expect(replaced?.headers.get('if-match')).toBe('"1"');
    expect(replaced?.body).toMatchObject({ body: { value: { individuals: [iri(1)] } } });
    // The copy exists before the original changes.
    expect(calls.indexOf('POST /annotations/')).toBeLessThan(
      calls.findIndex((c) => c.startsWith('PUT /annotations/0000000')),
    );
    wrapper.unmount();
  });
});
