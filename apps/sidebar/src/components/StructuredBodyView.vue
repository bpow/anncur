<script setup lang="ts">
import type { StructuredBody } from '@curanno/model';
import { computed } from 'vue';
import { entriesOf, isObject, type Entry, type LinkLabel } from '../profiles/entries';
import { linkLabels } from '../profiles/links';
import { fieldsOf } from '../profiles/schema';
import { useAnnotationsStore } from '../stores/annotations';
import { useProfilesStore } from '../stores/profiles';

const props = defineProps<{ body: StructuredBody }>();
const profiles = useProfilesStore();
const annotations = useAnnotationsStore();

// Labels of linked annotations are read from them, not stored in the body (ADR 0035).
const linkLabelOf: LinkLabel = (field, iri) =>
  field.link && linkLabels(annotations.all, field.link).get(iri);

const profile = computed(() => profiles.byIri(props.body.profile));
const title = computed(() => profile.value?.title ?? props.body.profile);

const entries = computed<Entry[]>(() => {
  const value = props.body.value;
  if (!isObject(value)) return [{ key: 'value', label: 'value', text: JSON.stringify(value) }];
  const fields = profile.value ? fieldsOf(profile.value.schema) : [];
  return entriesOf(value, fields, { linkLabel: linkLabelOf });
});
</script>

<template>
  <dl class="structured-view">
    <dt class="profile">{{ title }}</dt>
    <template v-for="entry in entries" :key="entry.key">
      <dt>{{ entry.label }}</dt>
      <dd v-if="entry.items">
        <dl v-for="(item, i) in entry.items" :key="i" class="structured-view item">
          <template v-for="sub in item" :key="sub.key">
            <dt>{{ sub.label }}</dt>
            <dd>{{ sub.text }}</dd>
          </template>
        </dl>
      </dd>
      <dd v-else>{{ entry.text }}</dd>
    </template>
  </dl>
</template>

<style scoped>
.structured-view {
  margin: 0.3rem 0;
  padding: 0.3rem 0.6rem;
  border-left: 3px solid var(--accent);
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.1rem 0.6rem;
  font-size: 0.95em;
}

.profile {
  grid-column: 1 / -1;
  font-weight: 600;
}

.item {
  margin: 0 0 0.2rem;
}

dd {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
