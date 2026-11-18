<script setup lang="ts">
import { type Annotation, toProblem, type Problem } from '@curanno/api-client';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  ToolbarButton,
  ToolbarRoot,
} from 'reka-ui';
import { computed, ref } from 'vue';
import {
  anchoringOf,
  annotationUuid,
  commentOf,
  creatorOf,
  linkedIris,
  quoteOf,
  structuredBodies,
  tagsOf,
} from '@curanno/model';
import {
  buildInput,
  can,
  draftOf,
  isEdited,
  rebuildInput,
  repairInput,
  splitInputs,
  withEditor,
  type AnnotationDraft,
} from '../api/annotations';
import { useAuthStore } from '../auth/store';
import { currentUserIri } from '../current-user';
import { useGuest } from '../guest';
import { linkFieldOf, linkLabels } from '../profiles/links';
import { useAnnotationsStore } from '../stores/annotations';
import { useProfilesStore } from '../stores/profiles';
import { renderMarkdown } from '../util/markdown';
import { formatTime } from '../util/time';
import AnchoringBadge from './AnchoringBadge.vue';
import AnnotationEditor from './AnnotationEditor.vue';
import AppIcon from './AppIcon.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import HintTooltip from './HintTooltip.vue';
import ProblemAlert from './ProblemAlert.vue';
import SharingPanel from './SharingPanel.vue';
import StructuredBodyView from './StructuredBodyView.vue';

const props = defineProps<{ annotation: Annotation; reply?: boolean }>();

const store = useAnnotationsStore();
const profiles = useProfilesStore();
const auth = useAuthStore();
const guest = useGuest();

type Mode = 'view' | 'edit' | 'reply' | 'share';
const mode = ref<Mode>('view');
const busy = ref(false);
const problem = ref<Problem>();
const etag = ref<string>();
const editDraft = ref<AnnotationDraft>(draftOf(props.annotation));
const replyDraft = ref<AnnotationDraft>({ text: '', tags: [] });

const quote = computed(() => quoteOf(props.annotation));
const creator = computed(() => creatorOf(props.annotation));
const comment = computed(() => commentOf(props.annotation));
const commentHtml = computed(() => (comment.value ? renderMarkdown(comment.value) : ''));
const tags = computed(() => tagsOf(props.annotation));
const structured = computed(() => structuredBodies(props.annotation));
const anchoring = computed(
  () => guest.anchoring.value.get(props.annotation.id) ?? anchoringOf(props.annotation),
);
const hovered = computed(() => guest.hovered.value.includes(props.annotation.id));
/** Made on another site and not sent to this page (ADR 0025). */
const withheld = computed(() => guest.withheld.value.get(props.annotation.id));
const repairable = computed(
  () =>
    !props.reply &&
    !withheld.value &&
    (anchoring.value === 'orphaned' || anchoring.value === 'ambiguous') &&
    can(props.annotation, 'update') &&
    guest.selection.value !== undefined,
);

/** A fact that names several linked annotations can have one of them split off (ADR 0035). */
const splittable = computed(() => {
  if (props.reply || !can(props.annotation, 'update') || !can(props.annotation, 'share')) return;
  for (const body of structured.value) {
    const profile = profiles.byIri(body.profile);
    const field = profile && linkFieldOf(profile);
    if (!field?.link || !field.multiple) continue;
    const value = body.value;
    const ids = linkedIris(
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value[field.name]
        : undefined,
    );
    if (ids.length < 2) continue;
    const labels = linkLabels(store.all, field.link);
    return {
      field: field.name,
      choices: ids.map((id) => ({ id, label: labels.get(id) ?? 'one not on this page' })),
    };
  }
  return undefined;
});

/**
 * The copy is made and shared like the original before the original changes, so a failure
 * part way leaves the individual named twice rather than not at all.
 */
async function splitOff(iri: string): Promise<void> {
  const target = splittable.value;
  if (!target) return;
  busy.value = true;
  try {
    const current = await store.fetch(props.annotation.id);
    if (!current.etag) throw new Error('the server sent no ETag');
    const { kept, split } = splitInputs(
      current.annotation,
      target.field,
      iri,
      await currentUserIri(),
    );
    const acl = await store.aclOf(props.annotation.id);
    const created = await store.create(split, store.documentOf.get(props.annotation.id));
    await store.share(created.annotation.id, acl);
    await store.update(props.annotation.id, kept, current.etag);
    problem.value = undefined;
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    busy.value = false;
  }
}

/** Focus leaving the card altogether un-emphasises its highlight. */
function onFocusOut(event: FocusEvent): void {
  const card = event.currentTarget as HTMLElement;
  if (!(event.relatedTarget instanceof Node) || !card.contains(event.relatedTarget)) {
    guest.focus([]);
  }
}

function setMode(next: Mode): void {
  mode.value = mode.value === next ? 'view' : next;
  problem.value = undefined;
}

async function beginEdit(): Promise<void> {
  if (mode.value === 'edit') return setMode('view');
  await reloadForEdit();
  mode.value = 'edit';
}

async function reloadForEdit(): Promise<void> {
  busy.value = true;
  try {
    const current = await store.fetch(props.annotation.id);
    etag.value = current.etag;
    editDraft.value = draftOf(current.annotation);
    problem.value = undefined;
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    busy.value = false;
  }
}

async function saveEdit(draft: AnnotationDraft): Promise<void> {
  if (!etag.value) return;
  busy.value = true;
  try {
    const structuredPurpose = draft.structured
      ? profiles.purposeOf(draft.structured.profile)
      : undefined;
    const structured =
      draft.structured &&
      (await withEditor(draftOf(props.annotation).structured, draft.structured, currentUserIri));
    const input = rebuildInput(
      props.annotation,
      { ...draft, ...(structured ? { structured } : {}) },
      {
        ...(structuredPurpose ? { structuredPurpose } : {}),
      },
    );
    await store.update(props.annotation.id, input, etag.value);
    mode.value = 'view';
    problem.value = undefined;
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    busy.value = false;
  }
}

async function saveReply(draft: AnnotationDraft): Promise<void> {
  busy.value = true;
  try {
    const structuredPurpose = draft.structured
      ? profiles.purposeOf(draft.structured.profile)
      : undefined;
    const created = await store.create(
      buildInput(draft, props.annotation.id, {
        reply: true,
        ...(structuredPurpose ? { structuredPurpose } : {}),
      }),
    );
    replyDraft.value = { text: '', tags: [] };
    // Back to view before sharing so that a failed share cannot be retried as a second reply.
    mode.value = 'view';
    problem.value = undefined;
    if (draft.acl) await store.share(created.annotation.id, draft.acl);
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    busy.value = false;
  }
}

async function remove(): Promise<void> {
  busy.value = true;
  try {
    const current = await store.fetch(props.annotation.id);
    if (!current.etag) throw new Error('the server sent no ETag');
    await store.destroy(props.annotation.id, current.etag);
    guest.unanchor([props.annotation.id]);
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    busy.value = false;
  }
}

async function repair(): Promise<void> {
  const selection = guest.selection.value;
  if (!selection?.target.selector) return;
  busy.value = true;
  try {
    const current = await store.fetch(props.annotation.id);
    if (!current.etag) throw new Error('the server sent no ETag');
    const updated = await store.update(
      props.annotation.id,
      repairInput(current.annotation, selection.target.selector),
      current.etag,
    );
    guest.clearSelection();
    guest.anchor(
      [
        {
          id: updated.annotation.id,
          target: updated.annotation.target,
          public: updated.annotation.public === true,
        },
      ],
      store.documentOf.get(props.annotation.id),
    );
    problem.value = undefined;
  } catch (err) {
    problem.value = toProblem(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <article
    :id="`annotation-${annotationUuid(annotation.id)}`"
    class="card"
    :class="{ reply, hovered }"
    tabindex="-1"
    :aria-label="`Annotation by ${creator.name}`"
    @mouseenter="guest.focus([annotation.id])"
    @mouseleave="guest.focus([])"
    @focusin="guest.focus([annotation.id])"
    @focusout="onFocusOut"
  >
    <header>
      <span class="creator">{{ creator.name }}</span>
      <time :datetime="annotation.created" class="muted">{{ formatTime(annotation.created) }}</time>
      <HintTooltip v-if="isEdited(annotation)" :text="`Edited ${formatTime(annotation.modified)}`">
        <span class="muted" tabindex="0">(edited)</span>
      </HintTooltip>
      <HintTooltip
        v-if="!reply && withheld"
        :text="`Made on ${withheld.source}; not highlighted on this page`"
      >
        <span class="badge elsewhere" tabindex="0">from {{ withheld.source }}</span>
      </HintTooltip>
      <AnchoringBadge v-else-if="!reply" :state="anchoring" />
    </header>

    <blockquote v-if="quote && !reply" class="quote">
      <HintTooltip text="Show in the page">
        <button type="button" class="quote-button" @click="guest.scrollTo(annotation.id)">
          {{ quote }}
        </button>
      </HintTooltip>
    </blockquote>

    <template v-if="mode === 'edit'">
      <AnnotationEditor
        :draft="editDraft"
        :busy="busy"
        :problem="problem"
        @save="saveEdit"
        @cancel="setMode('view')"
        @reload="reloadForEdit"
      />
    </template>
    <template v-else>
      <!-- eslint-disable-next-line vue/no-v-html -- markdown-it escapes raw HTML (util/markdown.ts) -->
      <div v-if="comment" class="comment" v-html="commentHtml"></div>
      <StructuredBodyView v-for="(body, i) in structured" :key="i" :body="body" />
      <ul v-if="tags.length" class="tags" aria-label="Tags">
        <li v-for="tag in tags" :key="tag">{{ tag }}</li>
      </ul>
      <ProblemAlert v-if="problem" :problem="problem" />
    </template>

    <ToolbarRoot
      v-if="auth.status === 'authenticated' && mode !== 'edit'"
      class="actions"
      aria-label="Actions"
    >
      <HintTooltip text="Reply">
        <ToolbarButton
          class="icon"
          aria-label="Reply"
          :disabled="busy"
          :aria-expanded="mode === 'reply'"
          @click="setMode('reply')"
        >
          <AppIcon name="reply" />
        </ToolbarButton>
      </HintTooltip>
      <HintTooltip v-if="can(annotation, 'update')" text="Edit">
        <ToolbarButton class="icon" aria-label="Edit" :disabled="busy" @click="beginEdit">
          <AppIcon name="edit" />
        </ToolbarButton>
      </HintTooltip>
      <HintTooltip v-if="can(annotation, 'share')" text="Share">
        <ToolbarButton
          class="icon"
          aria-label="Share"
          :disabled="busy"
          :aria-expanded="mode === 'share'"
          @click="setMode('share')"
        >
          <AppIcon name="share" />
        </ToolbarButton>
      </HintTooltip>
      <ConfirmDialog
        v-if="can(annotation, 'delete')"
        title="Delete this annotation?"
        description="This cannot be undone."
        action="Delete"
        @confirm="remove"
      >
        <HintTooltip text="Delete">
          <ToolbarButton class="icon danger" aria-label="Delete" :disabled="busy">
            <AppIcon name="delete" />
          </ToolbarButton>
        </HintTooltip>
      </ConfirmDialog>
      <DropdownMenuRoot v-if="splittable">
        <HintTooltip text="Split off one of the linked annotations">
          <DropdownMenuTrigger as-child>
            <ToolbarButton class="link" :disabled="busy">Split…</ToolbarButton>
          </DropdownMenuTrigger>
        </HintTooltip>
        <DropdownMenuPortal>
          <DropdownMenuContent class="dropdown-menu" align="start">
            <DropdownMenuItem
              v-for="choice in splittable.choices"
              :key="choice.id"
              class="dropdown-menu-item"
              @select="splitOff(choice.id)"
            >
              Split off {{ choice.label }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
      <ToolbarButton v-if="repairable" class="link" :disabled="busy" @click="repair">
        Repair with selection
      </ToolbarButton>
    </ToolbarRoot>

    <AnnotationEditor
      v-if="mode === 'reply'"
      :draft="replyDraft"
      submit-label="Reply"
      placeholder="Write a reply"
      :busy="busy"
      sharing
      :problem="problem"
      @save="saveReply"
      @cancel="setMode('view')"
    />
    <SharingPanel
      v-if="mode === 'share'"
      :annotation-id="annotationUuid(annotation.id)"
      :creator-id="creator.userId"
    />
  </article>
</template>

<style scoped>
.card {
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}

.card.hovered {
  border-color: var(--accent);
}

.card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.card.reply {
  border-color: transparent;
  border-left: 2px solid var(--border);
  border-radius: 0;
  padding: 0.4rem 0.75rem;
}

.badge.elsewhere {
  font-size: 0.75em;
  padding: 0 0.4em;
  border-radius: 999px;
  border: 1px solid currentColor;
  color: var(--muted);
}

header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: baseline;
  font-size: 0.9em;
}

.creator {
  font-weight: 600;
}

.quote {
  margin: 0.4rem 0;
  padding: 0;
  border-left: 3px solid light-dark(#c99a00, #d4a72c);
}

.quote-button {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  border-radius: 0;
  background: none;
  padding: 0.2rem 0.6rem;
  color: var(--text);
  font-style: italic;
  overflow-wrap: anywhere;
}

.quote-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.comment {
  margin: 0.3rem 0;
  overflow-wrap: anywhere;
}

.comment :deep(> :first-child) {
  margin-top: 0;
}

.comment :deep(> :last-child) {
  margin-bottom: 0;
}

.comment :deep(:is(p, ul, ol, pre, blockquote, table, h1, h2, h3, h4, h5, h6)) {
  margin: 0.4rem 0;
}

.comment :deep(:is(h1, h2, h3, h4, h5, h6)) {
  font-size: 1em;
  font-weight: 600;
}

.comment :deep(:is(ul, ol)) {
  padding-left: 1.4rem;
}

.comment :deep(li.task-item) {
  list-style: none;
}

.comment :deep(input.task) {
  margin: 0 0.3rem 0 -1.2rem;
  vertical-align: middle;
}

.comment :deep(code) {
  font-family: ui-monospace, monospace;
  font-size: 0.9em;
  background: var(--surface-2);
  border-radius: 3px;
  padding: 0.05rem 0.25rem;
}

.comment :deep(pre) {
  background: var(--surface-2);
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
  overflow-x: auto;
}

.comment :deep(pre code) {
  background: none;
  padding: 0;
}

.comment :deep(blockquote) {
  border-left: 3px solid var(--border);
  padding-left: 0.6rem;
  color: var(--muted);
}

.comment :deep(table) {
  display: block;
  overflow-x: auto;
  border-collapse: collapse;
}

.comment :deep(:is(th, td)) {
  border: 1px solid var(--border);
  padding: 0.15rem 0.4rem;
}

.comment :deep(a) {
  color: var(--accent);
}

.tags {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin: 0.3rem 0;
  padding: 0;
}

.tags li {
  background: var(--tag-bg);
  color: var(--tag-text);
  border: 1px solid var(--tag-border);
  border-radius: 999px;
  padding: 0.05rem 0.55rem;
  font-size: 0.85em;
  font-weight: 500;
}

.actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.4rem;
}

/* Quiet until pointed at, so a long list is not a wall of boxes. */
.actions .icon {
  border-color: transparent;
  background: none;
  color: var(--muted);
}

.actions .icon:hover:not(:disabled),
.actions .icon[aria-expanded='true'] {
  border-color: var(--control-border);
  background: var(--surface-2);
  color: var(--text);
}

.actions .icon.danger:hover:not(:disabled) {
  border-color: var(--danger);
  color: var(--danger);
}

.actions .link {
  margin-left: 0.4rem;
  font-size: 0.9em;
}
</style>
