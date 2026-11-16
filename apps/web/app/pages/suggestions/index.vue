<script setup lang="ts">
import type { SuggestionBatchSummary } from '@curanno/api-client';
import { computed } from 'vue';
import { definePageMeta, navigateTo, useRoute } from '#imports';
import { useApi } from '../../api/client';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import ProblemAlert from '../../components/ProblemAlert.vue';
import ResultPager from '../../components/ResultPager.vue';
import { useAction, useRequest } from '../../composables/request';
import { formatDate } from '../../util/time';

/** The documents with suggestions waiting for a group's review (ADR 0037). */
definePageMeta({ middleware: 'auth' });

const LIMIT = 50;
const api = useApi();
const route = useRoute();
const me = useRequest(() => api.GET('/x/me'));
const groups = computed(() => me.data.value?.groups ?? []);
const group = computed(() =>
  typeof route.query['group'] === 'string' ? route.query['group'] : groups.value[0]?.id,
);
const offset = computed(() => Number(route.query['offset'] ?? 0) || 0);

const batches = useRequest(
  async () =>
    group.value
      ? api.GET('/x/suggestion-batches', {
          params: {
            query: { group: group.value, pending: true, limit: LIMIT, offset: offset.value },
          },
        })
      : { data: { total: 0, items: [] }, response: new Response() },
  [group, offset],
);

const choose = (id: string) => navigateTo({ path: '/suggestions', query: { group: id } });
const page = (next: number) =>
  navigateTo({
    path: '/suggestions',
    query: { ...(group.value ? { group: group.value } : {}), offset: next },
  });

const discard = useAction();
async function remove(batch: SuggestionBatchSummary): Promise<void> {
  await discard.perform(() =>
    api.DELETE('/x/suggestion-batches/{id}', { params: { path: { id: batch.id } } }),
  );
  if (!discard.problem.value) await batches.run();
}
</script>

<template>
  <section>
    <h1>Suggestions to review</h1>
    <p class="muted">
      Suggested annotations posted for a group, by the sidebar or by a program. Open a document with
      the sidebar or the extension to review its suggestions there.
    </p>
    <ProblemAlert :problem="me.problem.value ?? batches.problem.value ?? discard.problem.value" />
    <p v-if="me.data.value && groups.length === 0" class="muted">
      You are in no group, so there are no suggestions for you to review.
    </p>
    <form v-else-if="groups.length > 1" class="inline" @submit.prevent>
      <label class="field">
        Group
        <select
          name="group"
          :value="group"
          @change="choose(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
        </select>
      </label>
    </form>
    <template v-if="batches.data.value && group">
      <table>
        <thead>
          <tr>
            <th>Document</th>
            <th>Suggested by</th>
            <th>Posted</th>
            <th>To review</th>
            <th>Decided</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="batch in batches.data.value.items" :key="batch.id">
            <td>
              <a :href="batch.documentUri" target="_blank" rel="noopener">
                {{ batch.documentTitle ?? batch.documentUri }}
              </a>
            </td>
            <td>{{ batch.engine.nickname ?? batch.engine.name }}</td>
            <td class="muted">{{ formatDate(batch.created) }}</td>
            <td>{{ batch.counts.pending }}</td>
            <td class="muted">
              {{ batch.counts.accepted }} saved, {{ batch.counts.rejected }} rejected
            </td>
            <td>
              <ConfirmDialog
                :title="`Discard the suggestions for ${batch.documentTitle ?? batch.documentUri}?`"
                description="Its pending suggestions go. Annotations saved from it stay."
                action="Discard"
                @confirm="remove(batch)"
              >
                <button type="button" class="link danger" :disabled="discard.busy.value">
                  Discard
                </button>
              </ConfirmDialog>
            </td>
          </tr>
          <tr v-if="batches.data.value.items.length === 0">
            <td colspan="6" class="muted">Nothing waits for review.</td>
          </tr>
        </tbody>
      </table>
      <ResultPager
        :total="batches.data.value.total"
        :offset="offset"
        :limit="LIMIT"
        @change="page"
      />
    </template>
    <p v-else-if="batches.pending.value || me.pending.value" class="muted">Loading…</p>
  </section>
</template>
