import type { SuggestionBatchSummary } from '@anncur/api-client';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_KEY } from '../../api/client';
import { fakeApi, json, noContent, type FakeApi } from '../../test/fake-api';
import { setRouteQuery } from '../../test/nuxt-imports';
import Suggestions from './index.vue';

const CURATORS = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Curators' };
const REVIEWERS = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Reviewers' };

const summary = (id: string, title: string): SuggestionBatchSummary => ({
  id,
  group: CURATORS.id,
  groupName: CURATORS.name,
  document: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  documentUri: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1/',
  documentTitle: title,
  engine: { name: 'anncur-suggester', version: '0.1.0', nickname: 'qwen / prompt 3' },
  creator: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  created: '2026-11-16T02:00:00Z',
  counts: { pending: 4, accepted: 1, rejected: 2 },
});

describe('the suggestions worklist', () => {
  let api: FakeApi;
  let batches: SuggestionBatchSummary[];

  beforeEach(() => {
    setRouteQuery({});
    batches = [summary('11111111-1111-4111-8111-111111111111', 'A family with cardiomyopathy')];
    api = fakeApi(({ method, url }) => {
      if (url.pathname === '/x/me') return json({ id: 'u1', groups: [CURATORS, REVIEWERS] });
      if (method === 'GET' && url.pathname === '/x/suggestion-batches') {
        const mine = url.searchParams.get('group') === CURATORS.id ? batches : [];
        return json({ total: mine.length, items: mine });
      }
      if (method === 'DELETE') {
        batches = [];
        return noContent();
      }
      return undefined;
    });
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function mountPage(): VueWrapper {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const wrapper: VueWrapper = mount(Suggestions, {
      global: { provide: { [API_KEY as symbol]: api.client } },
      attachTo: document.body,
    });
    return wrapper;
  }

  it("lists the first group's documents with pending suggestions, and switches groups", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const query = api.calls.find((c) => c.url.pathname === '/x/suggestion-batches')?.url
      .searchParams;
    expect(query?.get('group')).toBe(CURATORS.id);
    expect(query?.get('pending')).toBe('true');
    const row = wrapper.find('tbody tr');
    expect(row.find('a').text()).toBe('A family with cardiomyopathy');
    expect(row.find('a').attributes('href')).toBe('https://pmc.ncbi.nlm.nih.gov/articles/PMC1/');
    expect(row.text()).toContain('qwen / prompt 3');
    expect(row.text()).toContain('1 saved, 2 rejected');

    await wrapper.find('select[name="group"]').setValue(REVIEWERS.id);
    await flushPromises();
    expect(wrapper.text()).toContain('Nothing waits for review.');
  });

  it('discards a batch after confirmation', async () => {
    const wrapper = mountPage();
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Discard')!
      .trigger('click');
    await flushPromises();
    const dialog = document.querySelector('[role="alertdialog"]');
    [...(dialog?.querySelectorAll('button') ?? [])].at(-1)?.click();
    await flushPromises();
    expect(api.calls.find((c) => c.method === 'DELETE')?.url.pathname).toBe(
      '/x/suggestion-batches/11111111-1111-4111-8111-111111111111',
    );
    expect(wrapper.text()).toContain('Nothing waits for review.');
  });
});
