<script setup lang="ts">
import type { components } from '@curanno/api-client';

type VariantResolution = components['schemas']['VariantResolution'];
type VariantCandidate = components['schemas']['VariantCandidate'];

/** What the Allele Registry lookup found for one variant (ADR 0039). The curator picks. */
defineProps<{ result: VariantResolution; action: string; busy: boolean }>();
const emit = defineEmits<{ use: [candidate: VariantCandidate] }>();

const label = (c: VariantCandidate) =>
  c.title ?? c.hgvs.transcript ?? c.hgvs.genomic ?? 'Unnamed allele';
</script>

<template>
  <div class="lookup">
    <ul v-if="result.warnings.length" class="warnings">
      <li v-for="(w, i) in result.warnings" :key="i" :data-code="w.code">{{ w.message }}</li>
    </ul>
    <p v-if="result.candidates.length === 0" class="muted">
      No allele found. Mark the variant unresolvable, or correct it in the annotations.
    </p>
    <ol class="candidates">
      <li v-for="(c, i) in result.candidates" :key="c.caid ?? i" class="candidate">
        <strong>{{ label(c) }}</strong>
        <dl>
          <dt>CAID</dt>
          <dd>
            <a v-if="c.caid && c.registryUrl" :href="c.registryUrl" target="_blank" rel="noopener">
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
        <div v-if="c.caid || c.clinVar.length">
          <button type="button" :disabled="busy" @click="emit('use', c)">{{ action }}</button>
        </div>
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
</template>

<style scoped>
.lookup,
.candidate {
  display: grid;
  gap: 0.4rem;
}

.candidates {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}

.candidate {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.5rem 0.75rem;
  overflow-wrap: anywhere;
}

dl {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.1rem 0.75rem;
}

dt {
  color: var(--muted);
}

dd,
p {
  margin: 0;
}

.warnings {
  margin: 0;
  padding-left: 1.2rem;
}

.steps {
  font-size: 0.9em;
}
</style>
