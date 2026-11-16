<script setup lang="ts">
import { toProblem, type AclEntry, type Problem } from '@curanno/api-client';
import type { JsonValue, StructuredBody } from '@curanno/model';
import { computed, ref } from 'vue';
import type { AnnotationDraft } from '../api/annotations';
import { useGuest } from '../guest';
import { draftOf, useBatchesStore, type ReviewItem } from '../stores/batches';
import AnnotationEditor from './AnnotationEditor.vue';
import ProblemAlert from './ProblemAlert.vue';
import StructuredBodyView from './StructuredBodyView.vue';

const props = defineProps<{
  review: ReviewItem;
  /** Pending items this one links to, saved with it so that the link resolves. */
  needs: ReviewItem[];
  /** Grants a saved annotation starts with: read for the batch's group. */
  acl: AclEntry[];
  /** An annotation on the page that already says the same. */
  duplicate?: boolean;
}>();

const guest = useGuest();
const batches = useBatchesStore();

const editing = ref(false);
const busy = ref(false);
const problem = ref<Problem>();

const quote = computed(() => {
  const selectors = [props.review.item.selector].flat();
  const q = selectors.find((s) => s.type === 'TextQuoteSelector') as { exact?: string } | undefined;
  return q?.exact ?? '';
});
const body = computed<StructuredBody>(() => ({
  type: 'StructuredBody',
  profile: props.review.item.body.profile,
  value: props.review.item.body.value as JsonValue,
}));
const draft = computed<AnnotationDraft>(() => ({ ...draftOf(props.review), acl: props.acl }));
const state = computed(() => guest.anchoring.value.get(props.review.key));

async function run(work: () => Promise<void>): Promise<void> {
  busy.value = true;
  try {
    await work();
    problem.value = undefined;
    editing.value = false;
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    busy.value = false;
  }
}

const save = (next: AnnotationDraft) =>
  run(() =>
    batches.accept(guest, [
      ...props.needs.map((n) => ({ item: n, draft: { ...draftOf(n), acl: props.acl } })),
      { item: props.review, draft: next },
    ]),
  );
const reject = () => run(() => batches.reject(guest, props.review));
</script>

<template>
  <li
    class="suggestion"
    :aria-label="`Suggestion: ${quote}`"
    @mouseenter="guest.focus([review.key])"
    @mouseleave="guest.focus([])"
  >
    <blockquote class="quote">
      <button
        type="button"
        class="link"
        title="Show in the page"
        @click="guest.scrollTo(review.key)"
      >
        {{ quote }}
      </button>
    </blockquote>
    <p v-if="state && state !== 'anchored'" class="muted note">
      Not found on this page as it is now. Reject it, or save it and repair its anchor with a
      selection.
    </p>
    <p v-if="duplicate" class="muted note">An annotation on this page already says this.</p>
    <template v-if="!editing">
      <StructuredBodyView :body="body" />
      <div class="actions">
        <button type="button" class="primary" :disabled="busy" @click="editing = true">
          Review and save
        </button>
        <button type="button" :disabled="busy" @click="reject">Reject</button>
      </div>
      <p v-if="needs.length" class="muted note">
        Saving it also saves the suggestion{{ needs.length > 1 ? 's' : '' }} it links to.
      </p>
    </template>
    <AnnotationEditor
      v-else
      :draft="draft"
      submit-label="Save annotation"
      :busy="busy"
      :problem="problem"
      sharing
      @save="save"
      @cancel="editing = false"
    />
    <ProblemAlert v-if="!editing" :problem="problem" />
    <slot />
  </li>
</template>

<style scoped>
.suggestion {
  list-style: none;
  padding: 0.5rem 0.75rem;
  border: 1px dashed var(--accent);
  border-radius: 6px;
  margin-bottom: 0.5rem;
}

.quote {
  margin: 0 0 0.4rem;
  padding: 0.2rem 0.6rem;
  border-left: 3px dashed var(--accent);
  font-style: italic;
  overflow-wrap: anywhere;
}

.quote .link {
  color: var(--text);
  text-align: left;
  font: inherit;
  text-decoration: none;
}

.quote .link:hover {
  text-decoration: underline;
}

.note {
  font-size: 0.85em;
  margin: 0.3rem 0;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.4rem;
}
</style>
