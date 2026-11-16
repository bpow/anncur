<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NuxtLink } from '#components';
import { definePageMeta, navigateTo, useRoute } from '#imports';
import { useApi } from '../../api/client';
import ResultPager from '../../components/ResultPager.vue';
import ProblemAlert from '../../components/ProblemAlert.vue';
import { useAction, useRequest } from '../../composables/request';
import { formatDate } from '../../util/time';

definePageMeta({ middleware: 'admin' });

const LIMIT = 50;
const api = useApi();
const route = useRoute();
const q = computed(() => (typeof route.query['q'] === 'string' ? route.query['q'] : ''));
const offset = computed(() => Number(route.query['offset'] ?? 0) || 0);
const draft = ref(q.value);
watch(q, (value) => (draft.value = value));

const users = useRequest(
  () =>
    api.GET('/x/users', {
      params: { query: { ...(q.value ? { q: q.value } : {}), limit: LIMIT, offset: offset.value } },
    }),
  [q, offset],
);

const make = useAction();
const serviceName = ref('');
async function createService(): Promise<void> {
  const created = await make.perform(() =>
    api.POST('/x/users', { body: { displayName: serviceName.value.trim() } }),
  );
  if (created) await navigateTo(`/users/${created.id}`);
}

const search = () =>
  navigateTo({ path: '/users', query: draft.value.trim() ? { q: draft.value.trim() } : {} });
const page = (next: number) =>
  navigateTo({ path: '/users', query: { ...(q.value ? { q: q.value } : {}), offset: next } });
</script>

<template>
  <section>
    <h1>Users</h1>
    <form class="inline" @submit.prevent="search">
      <label class="field">
        Name or email
        <input v-model="draft" type="search" />
      </label>
      <button type="submit">Search</button>
    </form>
    <ProblemAlert :problem="users.problem.value" />
    <template v-if="users.data.value">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Groups</th>
            <th>Since</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users.data.value.items" :key="user.id">
            <td>
              <NuxtLink :to="`/users/${user.id}`">{{ user.displayName ?? user.id }}</NuxtLink>
            </td>
            <td>{{ user.email ?? '' }}</td>
            <td>
              <span v-if="user.isAdmin" class="badge">admin</span>
              <span v-if="user.service" class="badge">service</span>
            </td>
            <td class="muted">{{ (user.groups ?? []).map((g) => g.name).join(', ') }}</td>
            <td class="muted">{{ formatDate(user.created) }}</td>
          </tr>
          <tr v-if="users.data.value.items.length === 0">
            <td colspan="5" class="muted">No users match.</td>
          </tr>
        </tbody>
      </table>
      <ResultPager :total="users.data.value.total" :offset="offset" :limit="LIMIT" @change="page" />
    </template>
    <p v-else-if="users.pending.value" class="muted">Loading…</p>

    <h2>New service account</h2>
    <p class="muted">
      For a program that posts suggested annotations. It cannot sign in; make it an access token on
      its page, and make it a group's suggester.
    </p>
    <form class="inline" @submit.prevent="createService">
      <label class="field">
        Name
        <input v-model="serviceName" type="text" name="service-name" required maxlength="200" />
      </label>
      <button type="submit" class="primary" :disabled="make.busy.value">Create</button>
    </form>
    <ProblemAlert :problem="make.problem.value" />
  </section>
</template>
