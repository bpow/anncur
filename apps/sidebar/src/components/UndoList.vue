<script setup lang="ts">
import { useUndoStore } from '../stores/undo';
import ProblemAlert from './ProblemAlert.vue';

const undo = useUndoStore();
</script>

<template>
  <section v-if="undo.offers.length > 0" class="undo" aria-label="Recent deletions">
    <p v-for="o in undo.offers" :key="o.key" class="offer" role="status">
      <span>{{ o.message }}</span>
      <button type="button" class="link" :disabled="undo.busy" @click="undo.run(o.key)">
        Undo
      </button>
      <button
        type="button"
        class="link"
        aria-label="Dismiss"
        :disabled="undo.busy"
        @click="undo.dismiss(o.key)"
      >
        ×
      </button>
    </p>
    <ProblemAlert :problem="undo.problem" />
  </section>
</template>

<style scoped>
.undo {
  display: grid;
  gap: 0.3rem;
  margin: 0 0 0.5rem;
}

.offer {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  font-size: 0.9em;
}

.offer span {
  flex: 1;
}
</style>
