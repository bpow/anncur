<script setup lang="ts">
import type { AccessToken, NewAccessToken } from '@curanno/api-client';
import { ref } from 'vue';
import { useApi } from '../api/client';
import { useAction, useRequest } from '../composables/request';
import { formatDate } from '../util/time';
import ConfirmDialog from './ConfirmDialog.vue';
import ProblemAlert from './ProblemAlert.vue';

/** A user's access tokens (ADR 0038): their own, or a service account's for an administrator. */
const props = defineProps<{ userId: string }>();

const api = useApi();
const tokens = useRequest(
  () => api.GET('/x/users/{id}/tokens', { params: { path: { id: props.userId } } }),
  [() => props.userId],
);
const action = useAction();

type Scope = AccessToken['scopes'][number];
const SCOPES: { scope: Scope; label: string }[] = [
  { scope: 'suggestions:write', label: 'Post suggestions for a group to review' },
  { scope: 'annotations:read', label: 'Read the annotations you can see' },
  { scope: 'annotations:write', label: 'Read, make, edit, share and delete annotations as you' },
];

const name = ref('');
const scopes = ref<Scope[]>(['suggestions:write']);
const days = ref(90);
/** Shown once, straight after it is made; the API keeps only its hash. */
const made = ref<NewAccessToken>();

async function create(): Promise<void> {
  const token = await action.perform(() =>
    api.POST('/x/users/{id}/tokens', {
      params: { path: { id: props.userId } },
      body: { name: name.value.trim(), scopes: scopes.value, expiresInDays: days.value },
    }),
  );
  if (!token) return;
  made.value = token;
  name.value = '';
  await tokens.run();
}

async function revoke(token: AccessToken): Promise<void> {
  await action.perform(() =>
    api.DELETE('/x/users/{id}/tokens/{tokenId}', {
      params: { path: { id: props.userId, tokenId: token.id } },
    }),
  );
  if (!action.problem.value) await tokens.run();
}

const state = (token: AccessToken): string => {
  if (token.revoked) return `revoked ${formatDate(token.revoked)}`;
  if (new Date(token.expires).getTime() <= Date.now()) return 'expired';
  return `expires ${formatDate(token.expires)}`;
};
const live = (token: AccessToken): boolean =>
  !token.revoked && new Date(token.expires).getTime() > Date.now();
</script>

<template>
  <section class="tokens">
    <h2>Access tokens</h2>
    <p class="muted">
      For programs that act for you without signing in, such as a nightly run that posts
      suggestions, or a script that migrates annotations. A token can do only what its scopes allow,
      and never administration.
    </p>
    <ProblemAlert :problem="tokens.problem.value ?? action.problem.value" />
    <div v-if="made" class="notice" role="status">
      <p>
        Copy the token for <strong>{{ made.name }}</strong> now. It will not be shown again.
      </p>
      <pre class="secret">{{ made.token }}</pre>
      <button type="button" @click="made = undefined">Done</button>
    </div>
    <table v-if="tokens.data.value && tokens.data.value.length > 0">
      <thead>
        <tr>
          <th>Name</th>
          <th>Scopes</th>
          <th>Made</th>
          <th>Last used</th>
          <th>State</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="token in tokens.data.value" :key="token.id">
          <td>{{ token.name }}</td>
          <td class="muted">{{ token.scopes.join(', ') }}</td>
          <td class="muted">{{ formatDate(token.created) }}</td>
          <td class="muted">{{ token.lastUsed ? formatDate(token.lastUsed) : 'never' }}</td>
          <td class="muted">{{ state(token) }}</td>
          <td>
            <ConfirmDialog
              v-if="live(token)"
              :title="`Revoke ${token.name}?`"
              description="Programs using it stop working at once."
              action="Revoke"
              @confirm="revoke(token)"
            >
              <button type="button" class="link danger" :disabled="action.busy.value">
                Revoke
              </button>
            </ConfirmDialog>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="tokens.data.value" class="muted">No tokens.</p>
    <form class="inline" @submit.prevent="create">
      <label class="field">
        What it is for
        <input v-model="name" type="text" name="token-name" required maxlength="200" />
      </label>
      <fieldset class="scopes">
        <legend>What it may do</legend>
        <label v-for="option in SCOPES" :key="option.scope">
          <input v-model="scopes" type="checkbox" name="token-scopes" :value="option.scope" />
          {{ option.label }}
        </label>
      </fieldset>
      <label class="field">
        Expires after
        <select v-model.number="days" name="token-days">
          <option :value="30">30 days</option>
          <option :value="90">90 days</option>
          <option :value="365">a year</option>
        </select>
      </label>
      <button type="submit" class="primary" :disabled="action.busy.value || scopes.length === 0">
        Make a token
      </button>
    </form>
  </section>
</template>

<style scoped>
.scopes {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin: 0;
  padding: 0;
  border: 0;
  font-size: 0.85rem;
}
.scopes legend {
  color: var(--muted);
  padding: 0;
  margin-bottom: 0.2rem;
}
.secret {
  user-select: all;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
