<script setup lang="ts">
import { toProblem, type Problem } from '@curanno/api-client';
import { computed, ref, watch } from 'vue';
import { useAuthStore } from '../auth/store';
import { useGuest } from '../guest';
import { useBatchesStore } from '../stores/batches';
import BatchSection from './BatchSection.vue';
import ProblemAlert from './ProblemAlert.vue';

/** Suggestion batches of the caller's groups on the open documents (ADR 0037). */
const guest = useGuest();
const batches = useBatchesStore();
const auth = useAuthStore();
const problem = ref<Problem>();

const uris = computed(() => guest.documents.value.map((d) => d.uri));

async function load(): Promise<void> {
  try {
    batches.keepOnly(guest, uris.value);
    await batches.load(guest, uris.value);
    problem.value = undefined;
  } catch (err) {
    problem.value = toProblem(err);
  }
}

// Joined, since the guest republishes its document list (as a new array) on every anchoring
// update, highlighting included. Another account sees other groups' batches.
watch([() => uris.value.join('\n'), () => auth.subject], load, { immediate: true });
defineExpose({ load });

const sections = computed(() =>
  [...batches.byDocument].flatMap(([documentUri, list]) =>
    list.map((batch) => ({ batch, documentUri })),
  ),
);
const pendingCount = computed(() => batches.pending.length);
</script>

<template>
  <div v-if="sections.length || problem" class="batches">
    <ProblemAlert :problem="problem" />
    <details
      v-if="sections.length"
      :open="batches.shown"
      @toggle="batches.show(guest, ($event.target as HTMLDetailsElement).open)"
    >
      <summary>Suggestions ({{ pendingCount }} pending)</summary>
      <BatchSection
        v-for="s in sections"
        :key="s.batch.id"
        :batch="s.batch"
        :document-uri="s.documentUri"
      />
    </details>
  </div>
</template>

<style scoped>
summary {
  font-weight: 600;
  cursor: pointer;
  margin-bottom: 0.4rem;
}
</style>
