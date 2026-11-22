import type { AccessToken } from '@anncur/api-client';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_KEY } from '../api/client';
import { fakeApi, json, noContent, type FakeApi } from '../test/fake-api';
import AccessTokens from './AccessTokens.vue';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SECRET = `cat_${'0'.repeat(32)}_${'s'.repeat(43)}`;
const later = new Date(Date.now() + 86_400_000).toISOString();

describe('AccessTokens', () => {
  let tokens: AccessToken[];
  let api: FakeApi;

  beforeEach(() => {
    tokens = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'old job',
        scopes: ['suggestions:write'],
        created: '2026-11-01T00:00:00Z',
        expires: later,
      },
    ];
    api = fakeApi(({ method, url, body }) => {
      const path = url.pathname;
      if (path === `/x/users/${USER}/tokens` && method === 'GET') return json(tokens);
      if (path === `/x/users/${USER}/tokens` && method === 'POST') {
        const input = body as { name: string; scopes: AccessToken['scopes'] };
        const token = {
          ...input,
          id: '22222222-2222-4222-8222-222222222222',
          created: later,
          expires: later,
        };
        tokens = [token, ...tokens];
        return json({ ...token, token: SECRET }, { status: 201 });
      }
      const revoked = new RegExp(`^/x/users/${USER}/tokens/([^/]+)$`).exec(path)?.[1];
      if (method === 'DELETE' && revoked) {
        tokens = tokens.map((t) => (t.id === revoked ? { ...t, revoked: later } : t));
        return noContent();
      }
      return undefined;
    });
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const mountTokens = () =>
    mount(AccessTokens, {
      props: { userId: USER },
      global: { provide: { [API_KEY as symbol]: api.client } },
      attachTo: document.body,
    });

  it('makes a token and shows its secret once', async () => {
    const wrapper = mountTokens();
    await flushPromises();
    expect(wrapper.text()).toContain('old job');

    await wrapper.find('input[name="token-name"]').setValue('nightly run');
    await wrapper.find('input[value="annotations:read"]').setValue(true);
    await wrapper.find('select[name="token-days"]').setValue('30');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'nightly run',
      scopes: ['suggestions:write', 'annotations:read'],
      expiresInDays: 30,
    });
    expect(wrapper.find('.secret').text()).toBe(SECRET);
    expect(wrapper.text()).toContain('nightly run');

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Done')!
      .trigger('click');
    expect(wrapper.find('.secret').exists()).toBe(false);
  });

  it('revokes a token after confirmation', async () => {
    const wrapper = mountTokens();
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Revoke')!
      .trigger('click');
    await flushPromises();
    const dialog = document.querySelector('[role="alertdialog"]');
    [...(dialog?.querySelectorAll('button') ?? [])].at(-1)?.click();
    await flushPromises();
    expect(api.calls.some((c) => c.method === 'DELETE')).toBe(true);
    expect(wrapper.text()).toContain('revoked');
    expect(wrapper.findAll('button').some((b) => b.text() === 'Revoke')).toBe(false);
  });
});
