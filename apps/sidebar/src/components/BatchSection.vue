<script setup lang="ts">
import { stableStringify } from '@anncur/model';
import { toProblem, type AclEntry, type Problem, type SuggestionBatch } from '@anncur/api-client';
import { linkFieldsOf, quoteOf, structuredBodies } from '@anncur/model';
import { computed, provide, ref } from 'vue';
import { useGuest } from '../guest';
import { EXTRA_LINKS, linkCandidates, type ExtraLink } from '../profiles/links';
import { groupForReview, localLinksOf } from '../profiles/review-groups';
import { useAnnotationsStore } from '../stores/annotations';
import { draftOf, useBatchesStore, type ReviewItem } from '../stores/batches';
import { useProfilesStore } from '../stores/profiles';
import { formatTime } from '../util/time';
import BatchItemCard from './BatchItemCard.vue';
import ProblemAlert from './ProblemAlert.vue';

const props = defineProps<{ batch: SuggestionBatch; documentUri: string }>();

const guest = useGuest();
const batches = useBatchesStore();
const annotations = useAnnotationsStore();
const profiles = useProfilesStore();
const busy = ref(false);
const problem = ref<Problem>();

const profileOf = (iri: string) => profiles.byIri(iri);
const reviews = computed(() => batches.pending.filter((r) => r.batch.id === props.batch.id));
const byLocal = computed(() => new Map(reviews.value.map((r) => [r.item.id, r])));
const groups = computed(() => groupForReview(reviews.value, profileOf));

// The batch's items, so that link fields can show and offer them by local id.
provide(
  EXTRA_LINKS,
  computed<ExtraLink[]>(() =>
    props.batch.items.map((i) => {
      const quote = quoteOf({ target: { source: props.documentUri, selector: i.selector } });
      return { id: i.id, profile: i.body.profile, value: i.body.value, quote: quote ?? '' };
    }),
  ),
);

/** Saved annotations start out readable by the batch's group, whose suggestions they were. */
const acl = computed<AclEntry[]>(() => [
  {
    principal: { id: props.batch.group, kind: 'group', name: props.batch.groupName },
    permission: 'read',
  },
]);

/** The pending items `review` links to, which have to be saved with it. */
const needs = (review: ReviewItem): ReviewItem[] =>
  localLinksOf(review.item, profileOf).flatMap((id) => byLocal.value.get(id) ?? []);

const saved = computed(() =>
  annotations
    .rootsOf(props.documentUri)
    .flatMap((a) => structuredBodies(a).map((b) => `${b.profile}\n${stableStringify(b.value)}`)),
);
const isDuplicate = (review: ReviewItem): boolean =>
  localLinksOf(review.item, profileOf).length === 0 &&
  saved.value.includes(`${review.item.body.profile}\n${stableStringify(review.item.body.value)}`);

/** Saved annotations a head item might be the same as: those of its profile on the page. */
function sameAs(head: ReviewItem) {
  const label = profiles.profiles
    .flatMap((p) => linkFieldsOf(p.schema))
    .find((f) => f.link.profile === head.item.body.profile)?.link.label;
  return linkCandidates(annotations.rootsOf(props.documentUri), {
    profile: head.item.body.profile,
    ...(label ? { label } : {}),
  });
}

async function run(work: () => Promise<void>): Promise<void> {
  busy.value = true;
  try {
    await work();
    problem.value = undefined;
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    busy.value = false;
  }
}

/** The head and its members; the store resolves every draft's dependencies. */
const saveGroup = (head: ReviewItem, members: ReviewItem[]) =>
  run(() =>
    batches.accept(guest, [
      { item: head, draft: { ...draftOf(head), acl: acl.value } },
      ...members.map((m) => ({ item: m, draft: { ...draftOf(m), acl: acl.value } })),
    ]),
  );

const useExisting = (head: ReviewItem, iri: string) =>
  run(() => batches.accept(guest, [{ item: head, existing: iri }]));

const discard = () => run(() => batches.discardBatch(guest, props.batch, props.documentUri));
</script>

<template>
  <section
    class="batch"
    :aria-label="`Suggestions from ${batch.engine.nickname ?? batch.engine.name}`"
  >
    <header>
      <strong>{{ batch.engine.nickname ?? batch.engine.name }}</strong>
      <span class="muted">for {{ batch.groupName }}, {{ formatTime(batch.created) }}</span>
      <span class="muted">· {{ batch.counts.pending }} to review</span>
      <button type="button" class="link" :disabled="busy" @click="discard">Discard all</button>
    </header>
    <ProblemAlert :problem="problem" />
    <template v-for="(group, g) in groups" :key="group.head?.key ?? `rest-${g}`">
      <ul v-if="group.head" class="group">
        <BatchItemCard
          :review="group.head"
          :needs="needs(group.head)"
          :acl="acl"
          :duplicate="isDuplicate(group.head)"
        >
          <div class="actions">
            <button
              v-if="group.members.length"
              type="button"
              :disabled="busy"
              @click="saveGroup(group.head, group.members)"
            >
              Save with its {{ group.members.length }} suggestion{{
                group.members.length > 1 ? 's' : ''
              }}
            </button>
            <label v-if="sameAs(group.head).length" class="same">
              Same as
              <select
                :disabled="busy"
                @change="useExisting(group.head, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">an annotation on this page…</option>
                <option v-for="c in sameAs(group.head)" :key="c.id" :value="c.id">
                  {{ c.label }}
                </option>
              </select>
            </label>
          </div>
        </BatchItemCard>
        <ul class="members">
          <BatchItemCard
            v-for="member in group.members"
            :key="member.key"
            :review="member"
            :needs="needs(member)"
            :acl="acl"
          />
        </ul>
      </ul>
      <ul v-else class="group">
        <BatchItemCard
          v-for="member in group.members"
          :key="member.key"
          :review="member"
          :needs="needs(member)"
          :acl="acl"
          :duplicate="isDuplicate(member)"
        />
      </ul>
    </template>
  </section>
</template>

<style scoped>
.batch {
  padding: 0.5rem 0.75rem;
  border: 1px dashed var(--accent);
  border-radius: 6px;
  margin-bottom: 0.75rem;
}

header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: baseline;
  margin-bottom: 0.4rem;
}

header .link {
  margin-left: auto;
}

.group,
.members {
  margin: 0;
  padding: 0;
}

.members {
  margin-left: 1rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin-top: 0.4rem;
}

.same {
  display: flex;
  gap: 0.3rem;
  align-items: center;
  font-size: 0.9em;
}
</style>
