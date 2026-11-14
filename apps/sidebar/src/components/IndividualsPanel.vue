<script setup lang="ts">
import { caseIndividualProfile, summarizeIndividuals } from '@curanno/model';
import { computed } from 'vue';
import { useGuest } from '../guest';
import { entriesOf } from '../profiles/entries';
import { fieldsOf } from '../profiles/schema';
import { useAnnotationsStore } from '../stores/annotations';
import { useProfilesStore } from '../stores/profiles';

const store = useAnnotationsStore();
const profiles = useProfilesStore();
const guest = useGuest();

const fields = fieldsOf(caseIndividualProfile.schema);
// Without the profile loaded there is nothing to check a summary against.
const summaries = computed(() =>
  summarizeIndividuals(
    store.all,
    profiles.byIri(caseIndividualProfile.iri) ? (body) => profiles.validate(body) : undefined,
  ),
);
const individuals = computed(() =>
  summaries.value.individuals.map((s) => ({
    ...s,
    label: typeof s.value['case'] === 'string' ? s.value['case'] : 'Unnamed individual',
    entries: entriesOf(s.value, fields),
  })),
);
const shown = computed(() => individuals.value.length > 0 || summaries.value.unlinked.length > 0);
</script>

<template>
  <details v-if="shown" class="individuals">
    <summary>
      Individuals <span class="muted">({{ individuals.length }})</span>
    </summary>
    <p class="muted hint">Computed from the facts on this page; nothing here is saved.</p>
    <article
      v-for="individual in individuals"
      :key="individual.individual"
      class="individual"
      :aria-label="individual.label"
    >
      <h2>
        <button
          type="button"
          class="link"
          title="Show in the page"
          @click="guest.scrollTo(individual.individual)"
        >
          {{ individual.label }}
        </button>
        <span class="muted">
          {{ individual.facts.length }} fact{{ individual.facts.length === 1 ? '' : 's' }}
        </span>
      </h2>
      <p v-if="individual.errors.length" class="incomplete">
        Incomplete: {{ individual.errors.map((e) => e.message).join('; ') }}
      </p>
      <dl>
        <template v-for="entry in individual.entries" :key="entry.key">
          <dt>{{ entry.label }}</dt>
          <dd v-if="entry.items">
            <div v-for="(item, i) in entry.items" :key="i" class="variant">
              {{ item.map((sub) => sub.text).join(' · ') }}
              <button
                v-if="individual.sources[entry.key]?.[i]"
                type="button"
                class="link source"
                :aria-label="`Show where ${entry.label} ${i + 1} is stated`"
                @click="guest.scrollTo(individual.sources[entry.key]![i]!)"
              >
                show
              </button>
            </div>
          </dd>
          <dd v-else>
            {{ entry.text }}
            <button
              v-for="(source, i) in individual.sources[entry.key] ?? []"
              :key="source"
              type="button"
              class="link source"
              :aria-label="`Show where ${entry.label} is stated, passage ${i + 1}`"
              @click="guest.scrollTo(source)"
            >
              {{ (individual.sources[entry.key]?.length ?? 0) > 1 ? i + 1 : 'show' }}
            </button>
          </dd>
        </template>
      </dl>
    </article>
    <section v-if="summaries.unlinked.length" class="unlinked">
      <h2>Facts without an individual on this page</h2>
      <ul>
        <li v-for="(id, i) in summaries.unlinked" :key="id">
          <button type="button" class="link" @click="guest.scrollTo(id)">Fact {{ i + 1 }}</button>
        </li>
      </ul>
    </section>
  </details>
</template>

<style scoped>
.individuals {
  margin: 0.5rem 0;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}

summary {
  font-weight: 600;
  cursor: pointer;
}

.hint {
  margin: 0.3rem 0;
  font-size: 0.85em;
}

.individual {
  margin: 0.5rem 0;
  padding-left: 0.6rem;
  border-left: 3px solid var(--accent);
}

h2 {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
  margin: 0;
  font-size: 1em;
}

.incomplete {
  margin: 0.2rem 0;
  color: var(--danger);
  font-size: 0.9em;
}

dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.1rem 0.6rem;
  margin: 0.3rem 0;
  font-size: 0.95em;
}

dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.source {
  margin-left: 0.3rem;
  font-size: 0.85em;
}

.unlinked ul {
  margin: 0.2rem 0;
  padding-left: 1.2rem;
}
</style>
