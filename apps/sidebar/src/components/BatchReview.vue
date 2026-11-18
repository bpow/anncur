<script setup lang="ts">
import { toProblem, type Problem } from '@curanno/api-client';
import { computed, ref, watch } from 'vue';
import { useAuthStore } from '../auth/store';
import { useGuest } from '../guest';
import { useBatchesStore, type SaveFailure } from '../stores/batches';
import BatchSection from './BatchSection.vue';
import ProblemAlert from './ProblemAlert.vue';

/** Suggestion batches of the caller's groups on the open documents (ADR 0037). */
const guest = useGuest();
const batches = useBatchesStore();
const auth = useAuthStore();
const problem = ref<Problem>();
const retrying = ref(false);

async function retry(failure: SaveFailure): Promise<void> {
  retrying.value = true;
  try {
    await batches.retrySave(failure);
  } finally {
    retrying.value = false;
  }
}

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
  <div v-if="sections.length || problem || batches.saveFailures.length" class="batches">
    <ProblemAlert :problem="problem" />
    <section
      v-for="failure in batches.saveFailures"
      :key="failure.annotation"
      aria-label="Saved annotation needs attention"
    >
      <p>The annotation is saved. Its loading or sharing needs another attempt.</p>
      <ProblemAlert :problem="failure.problem" />
      <button type="button" :disabled="retrying" @click="retry(failure)">
        Retry loading and sharing
      </button>
    </section>
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
