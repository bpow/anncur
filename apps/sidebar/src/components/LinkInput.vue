<script setup lang="ts">
import { computed } from 'vue';
import type { LinkCandidate } from '../profiles/links';

const props = defineProps<{
  modelValue: string[];
  candidates: LinkCandidate[];
  multiple: boolean;
  inputId: string;
  name: string;
  /** What one linked annotation is called, for the add menu ("individual"). */
  noun: string;
  required?: boolean | undefined;
}>();
const emit = defineEmits<{ 'update:modelValue': [ids: string[]] }>();

const byId = computed(() => new Map(props.candidates.map((c) => [c.id, c])));
// A link to an annotation that is not loaded, or that the reader cannot see, is kept as it is.
const chosen = computed(() =>
  props.modelValue.map(
    (id) => byId.value.get(id) ?? { id, label: 'Not on this page', quote: id, missing: true },
  ),
);
const options = computed(() => [
  ...chosen.value.filter((c) => 'missing' in c),
  ...props.candidates,
]);
const remaining = computed(() => props.candidates.filter((c) => !props.modelValue.includes(c.id)));

function add(event: Event): void {
  const select = event.target as HTMLSelectElement;
  const id = select.value;
  select.value = '';
  if (id) emit('update:modelValue', [...props.modelValue, id]);
}

function remove(id: string): void {
  emit(
    'update:modelValue',
    props.modelValue.filter((v) => v !== id),
  );
}
</script>

<template>
  <select
    v-if="!multiple"
    :id="inputId"
    :name="name"
    :required="required"
    :value="modelValue[0] ?? ''"
    @change="
      emit('update:modelValue', [($event.target as HTMLSelectElement).value].filter(Boolean))
    "
  >
    <option value="">—</option>
    <option v-for="c in options" :key="c.id" :value="c.id" :title="c.quote">
      {{ c.label }}
    </option>
  </select>
  <div v-else class="links">
    <ul v-if="chosen.length" class="chosen" :aria-label="`Chosen ${noun}s`">
      <li
        v-for="c in chosen"
        :key="c.id"
        class="chip"
        :class="{ missing: 'missing' in c }"
        :title="c.quote"
      >
        {{ c.label }}
        <button
          type="button"
          class="remove"
          :aria-label="`Remove ${c.label}`"
          @click="remove(c.id)"
        >
          ×
        </button>
      </li>
    </ul>
    <select
      :id="inputId"
      :name="name"
      :required="required && modelValue.length === 0"
      :aria-required="required || undefined"
      :disabled="remaining.length === 0"
      @change="add"
    >
      <option value="">{{ remaining.length ? `Add ${noun}…` : `No other ${noun}s` }}</option>
      <option v-for="c in remaining" :key="c.id" :value="c.id" :title="c.quote">
        {{ c.label }}
      </option>
    </select>
  </div>
</template>

<style scoped>
.links {
  display: grid;
  gap: 0.3rem;
}

.chosen {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.chip {
  background: var(--tag-bg);
  color: var(--tag-text);
  border: 1px solid var(--tag-border);
  border-radius: 999px;
  padding: 0 0.3rem 0 0.6rem;
  font-size: 0.9em;
}

.chip.missing {
  border-style: dashed;
  font-style: italic;
}

.remove {
  border: 0;
  background: none;
  padding: 0 0.2rem;
  color: inherit;
}
</style>
