<script setup lang="ts">
/**
 * Looks a variant up in the ClinGen Allele Registry through the API (ADR 0039)
 * and offers its candidates. It never fills a field by itself: the curator
 * picks a candidate, or marks the variant unresolvable.
 */
import { type components, type Problem, toProblem, unwrap } from '@curanno/api-client';
import { computed, ref, watch } from 'vue';
import { useApi } from '../api/client';
import ProblemAlert from './ProblemAlert.vue';

type VariantResolution = components['schemas']['VariantResolution'];
type VariantCandidate = components['schemas']['VariantCandidate'];

const props = defineProps<{
  /** The variant as the article gives it. */
  variant: string | undefined;
  /** The gene of interest, for a change without a transcript. */
  gene: string | undefined;
  /** Whether the variant is already marked unresolvable. */
  unresolvable: boolean;
  /** For element ids. */
  idPrefix: string;
}>();
const emit = defineEmits<{ use: [candidate: VariantCandidate]; unresolvable: [] }>();

const result = ref<VariantResolution>();
const problem = ref<Problem>();
const busy = ref(false);

const query = computed(() => props.variant?.trim() ?? '');
const gene = computed(() => props.gene?.trim() || undefined);
const genePattern = /^[A-Za-z0-9-]{1,50}$/;

// A result is for the text it was asked about; editing the variant or gene drops it.
watch([query, gene], () => {
  result.value = undefined;
  problem.value = undefined;
});

async function lookUp(): Promise<void> {
  if (!query.value || busy.value) return;
  busy.value = true;
  problem.value = undefined;
  try {
    const g = gene.value && genePattern.test(gene.value) ? gene.value : undefined;
    result.value = unwrap(
      await useApi().GET('/x/variants/resolve', {
        params: { query: { q: query.value, ...(g ? { gene: g } : {}) } },
      }),
    );
  } catch (err) {
    result.value = undefined;
    problem.value = toProblem(err);
  } finally {
    busy.value = false;
  }
}

const label = (c: VariantCandidate) =>
  c.title ?? c.hgvs.transcript ?? c.hgvs.genomic ?? 'Unnamed allele';
</script>

<template>
  <div class="variant-lookup">
    <div class="actions">
      <button type="button" class="look-up" :disabled="!query || busy" @click="lookUp">
        {{ busy ? 'Looking up…' : 'Look up IDs' }}
      </button>
      <button
        type="button"
        class="link mark-unresolvable"
        :disabled="unresolvable"
        @click="emit('unresolvable')"
      >
        {{ unresolvable ? 'Marked unresolvable' : 'Mark unresolvable' }}
      </button>
    </div>
    <ProblemAlert :problem="problem">
      <span v-if="problem?.status === 404"> Type the IDs by hand.</span>
    </ProblemAlert>
    <div v-if="result" class="result" aria-live="polite">
      <ul v-if="result.warnings.length" class="warnings">
        <li v-for="(w, i) in result.warnings" :key="i" :data-code="w.code">{{ w.message }}</li>
      </ul>
      <p v-if="result.candidates.length === 0" class="muted">
        No allele found. Correct the variant and look it up again, or mark it unresolvable.
      </p>
      <ol class="candidates">
        <li
          v-for="(c, i) in result.candidates"
          :key="c.caid ?? i"
          class="candidate"
          :aria-labelledby="`${idPrefix}candidate-${i}`"
        >
          <strong :id="`${idPrefix}candidate-${i}`">{{ label(c) }}</strong>
          <dl>
            <dt>CAID</dt>
            <dd>
              <a
                v-if="c.caid && c.registryUrl"
                :href="c.registryUrl"
                target="_blank"
                rel="noopener"
              >
                {{ c.caid }}
              </a>
              <span v-else class="muted">not registered</span>
            </dd>
            <dt>ClinVar</dt>
            <dd>
              <template v-for="(v, j) in c.clinVar" :key="v.variationId">
                <template v-if="j > 0">, </template>
                <a :href="v.url" target="_blank" rel="noopener">{{ v.variationId }}</a>
              </template>
              <span v-if="c.clinVar.length === 0" class="muted">none</span>
            </dd>
            <template v-if="c.gnomad">
              <dt>gnomAD</dt>
              <dd>{{ c.gnomad }}</dd>
            </template>
            <template v-if="c.hgvs.genomic">
              <dt>GRCh38</dt>
              <dd>{{ c.hgvs.genomic }}</dd>
            </template>
            <template v-if="c.hgvs.protein">
              <dt>Protein</dt>
              <dd>{{ c.hgvs.protein }}</dd>
            </template>
          </dl>
          <ul v-if="c.warnings.length" class="warnings">
            <li v-for="(w, j) in c.warnings" :key="j" :data-code="w.code">{{ w.message }}</li>
          </ul>
          <button
            v-if="c.caid || c.clinVar.length"
            type="button"
            :aria-describedby="`${idPrefix}candidate-${i}`"
            @click="emit('use', c)"
          >
            Use these IDs
          </button>
          <p v-else class="muted">
            Nothing to fill in. A curator with an Allele Registry account can register it.
          </p>
        </li>
      </ol>
      <details v-if="result.steps.length" class="steps">
        <summary>What was asked</summary>
        <ol>
          <li v-for="(s, i) in result.steps" :key="i">
            {{ s.service === 'registry' ? 'Allele Registry' : 'VariantValidator' }}:
            <code>{{ s.request }}</code> — {{ s.outcome }}
          </li>
        </ol>
      </details>
    </div>
  </div>
</template>

<style scoped>
.variant-lookup {
  display: grid;
  gap: 0.4rem;
}

.actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.result {
  display: grid;
  gap: 0.4rem;
}

.candidates {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.4rem;
}

.candidate {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
  display: grid;
  gap: 0.3rem;
  overflow-wrap: anywhere;
}

.candidate > button {
  justify-self: start;
}

dl {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.1rem 0.6rem;
}

dt {
  color: var(--muted);
}

dd {
  margin: 0;
}

.warnings {
  margin: 0;
  padding-left: 1.2rem;
  font-size: 0.9em;
}

.steps {
  font-size: 0.85em;
}

.steps ol {
  margin: 0.2rem 0 0;
  padding-left: 1.2rem;
}

p {
  margin: 0;
}
</style>
