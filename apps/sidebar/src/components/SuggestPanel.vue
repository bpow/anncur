<script setup lang="ts">
import { unwrap, type GroupRef } from '@anncur/api-client';
import { outputSchema } from '@anncur/extract';
import { computed, ref, watch } from 'vue';
import { useApi } from '../api/client';
import { config } from '../config';
import { useGuest } from '../guest';
import { linkCandidates, linkOf } from '../profiles/links';
import { writable } from '../profiles/schema';
import { useAnnotationsStore } from '../stores/annotations';
import { useBatchesStore } from '../stores/batches';
import { useProfilesStore } from '../stores/profiles';
import { useSuggestionsStore } from '../stores/suggestions';

const guest = useGuest();
const profiles = useProfilesStore();
const suggestions = useSuggestionsStore();
const annotations = useAnnotationsStore();
const batches = useBatchesStore();

const CHOICE_KEY = 'anncur.suggest';

interface Choice {
  endpoint?: string;
  model?: string;
  profiles?: string[];
  group?: string;
}

// A per-browser convenience only; nothing depends on it being there.
function remembered(): Choice {
  try {
    return JSON.parse(localStorage.getItem(CHOICE_KEY) ?? '{}') as Choice;
  } catch {
    return {};
  }
}

function remember(choice: Choice): void {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    // Storage blocked: the next visit starts from the defaults.
  }
}

const endpoints = computed(() => config.extractEndpoints);
const documents = computed(() =>
  guest.documents.value.filter((d) => guest.textDocuments.value.has(d.uri)),
);
/** Profiles the model can fill: those whose schema projects to an output schema. */
const usable = computed(() =>
  writable(profiles.profiles).filter((p) => {
    try {
      outputSchema(p);
      return true;
    } catch {
      return false;
    }
  }),
);
const available = computed(
  () => endpoints.value.length > 0 && documents.value.length > 0 && usable.value.length > 0,
);

const saved = remembered();
const open = ref(false);
const documentUri = ref<string>();
const endpointUrl = ref(saved.endpoint ?? '');
const model = ref(saved.model ?? '');
const chosen = ref<string[]>(saved.profiles ?? []);
const groupId = ref(saved.group ?? '');
const groups = ref<GroupRef[]>();
const instructions = ref('');

const endpoint = computed(
  () => endpoints.value.find((e) => e.url === endpointUrl.value) ?? endpoints.value[0],
);
const selectedDocument = computed(
  () => documents.value.find((d) => d.uri === documentUri.value) ?? documents.value[0],
);
const selected = computed(() => usable.value.filter((p) => chosen.value.includes(p.iri)));
const group = computed(
  () => groups.value?.find((g) => g.id === groupId.value) ?? groups.value?.[0],
);
/**
 * Chosen kinds that link to annotations (ADR 0035) with none to link to:
 * none saved on the page, and their kind not chosen to be suggested first.
 */
const unlinkable = computed(() => {
  const doc = selectedDocument.value;
  if (!doc) return [];
  return selected.value.flatMap((p) => {
    const link = linkOf(p);
    if (!link || chosen.value.includes(link.profile)) return [];
    if (linkCandidates(annotations.rootsOf(doc.uri), link).length) return [];
    return [{ kind: p.title, needs: profiles.byIri(link.profile)?.title ?? link.profile }];
  });
});
const host = computed(() => {
  try {
    return endpoint.value ? new URL(endpoint.value.url).host : '';
  } catch {
    return endpoint.value?.url ?? '';
  }
});
const running = computed(() => suggestions.status === 'reading' || suggestions.status === 'asking');
const ready = computed(
  () =>
    selected.value.length > 0 &&
    !!group.value &&
    !!model.value.trim() &&
    unlinkable.value.length < selected.value.length,
);

// A model the endpoint does not list is replaced by its first one.
watch(
  endpoint,
  (next) => {
    if (next?.models.length && !next.models.includes(model.value)) model.value = next.models[0]!;
  },
  { immediate: true },
);

// A run still under way belongs to the page it was started on.
watch(
  () => guest.documents.value.map((d) => d.uri),
  (uris) => {
    if (suggestions.documentUri && !uris.includes(suggestions.documentUri)) suggestions.clear();
  },
);

// The groups a batch can be posted for: the caller's own.
watch(open, async (now) => {
  if (!now || groups.value) return;
  try {
    groups.value = unwrap(await useApi().GET('/x/me')).groups ?? [];
  } catch {
    groups.value = [];
  }
});

async function start(): Promise<void> {
  const doc = selectedDocument.value;
  if (!doc || !endpoint.value || !group.value || !ready.value) return;
  remember({
    endpoint: endpoint.value.url,
    model: model.value,
    profiles: chosen.value,
    group: group.value.id,
  });
  open.value = false;
  await suggestions.run(guest, {
    document: doc,
    profiles: selected.value,
    group: group.value.id,
    endpoint: endpoint.value,
    model: model.value.trim(),
    instructions: instructions.value,
  });
  if (suggestions.posted) await batches.load(guest, [doc.uri]);
}
</script>

<template>
  <section v-if="available" class="suggest" aria-label="Suggested annotations">
    <div v-if="!open && !running" class="start">
      <button type="button" @click="open = true">Suggest annotations…</button>
    </div>

    <form v-if="open" class="form" @submit.prevent="start">
      <label v-if="documents.length > 1">
        Document
        <select v-model="documentUri" name="document">
          <option v-for="d in documents" :key="d.uri" :value="d.uri">{{ d.title ?? d.uri }}</option>
        </select>
      </label>
      <fieldset class="kinds">
        <legend>Kinds of annotation</legend>
        <label v-for="p in usable" :key="p.iri" class="kind">
          <input v-model="chosen" type="checkbox" name="profile" :value="p.iri" />
          {{ p.title }}
        </label>
      </fieldset>
      <p v-for="u in unlinkable" :key="u.kind" class="note" role="status">
        {{ u.kind }} links each suggestion to a {{ u.needs }}: choose {{ u.needs }} too, or save one
        on this page first.
      </p>
      <label>
        For the group
        <select v-if="groups?.length" v-model="groupId" name="group">
          <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
        </select>
        <span v-else-if="groups" class="note">
          You are in no group. Suggestions are saved for a group to review; ask an administrator to
          add you to one.
        </span>
      </label>
      <label v-if="endpoints.length > 1">
        Model server
        <select v-model="endpointUrl" name="endpoint">
          <option v-for="e in endpoints" :key="e.url" :value="e.url">{{ e.label }}</option>
        </select>
      </label>
      <label>
        Model
        <select v-if="endpoint?.models.length" v-model="model" name="model">
          <option v-for="m in endpoint.models" :key="m" :value="m">{{ m }}</option>
        </select>
        <input v-else v-model="model" name="model" required placeholder="for example llama3.1:8b" />
      </label>
      <label>
        Guidance for the model (optional)
        <textarea
          v-model="instructions"
          name="instructions"
          rows="2"
          placeholder="for example: only individuals with a variant in MYH7"
        ></textarea>
      </label>
      <p class="muted note">
        The text of {{ selectedDocument?.title ?? 'this page' }} is sent to
        <strong>{{ host }}</strong> ({{ endpoint?.label }}). What comes back is saved for
        {{ group?.name ?? 'your group' }} to review; nothing becomes an annotation until someone
        saves it.
      </p>
      <div class="actions">
        <button type="submit" class="primary" :disabled="!ready">Suggest</button>
        <button type="button" @click="open = false">Cancel</button>
      </div>
    </form>

    <p v-if="running" role="status" class="status">
      <template v-if="suggestions.status === 'reading'">Reading the page…</template>
      <template v-else-if="suggestions.progress">
        {{ suggestions.progress.kind }}
        <template v-if="suggestions.progress.steps > 1">
          ({{ suggestions.progress.step }} of {{ suggestions.progress.steps }})</template
        >: {{ suggestions.progress.done }} of {{ suggestions.progress.total }} parts read…
      </template>
      <template v-else>Asking the model…</template>
      <button type="button" @click="suggestions.cancel()">Stop</button>
    </p>
    <p v-else-if="suggestions.status === 'failed'" class="alert" role="alert">
      {{ suggestions.error }}
    </p>
    <p v-else-if="suggestions.status === 'cancelled'" role="status" class="muted status">
      Stopped; nothing was saved.
    </p>
    <p v-else-if="suggestions.status === 'done'" role="status" class="muted status">
      <template v-if="suggestions.posted">
        {{ suggestions.posted === 1 ? '1 suggestion' : `${suggestions.posted} suggestions` }}
        saved for review below</template
      ><template v-else>No suggestions</template
      ><template v-if="suggestions.rejected">
        ; {{ suggestions.rejected }} set aside because their quote was not in the page or their
        value did not fit the profile</template
      ><template v-if="suggestions.skipped.length">
        ; not asked about {{ suggestions.skipped.join(', ') }}, which had nothing to link
        to</template
      >.
    </p>
  </section>
</template>

<style scoped>
.suggest {
  padding: 0.5rem 0.75rem;
  border: 1px dashed var(--accent);
  border-radius: 6px;
  margin-bottom: 0.75rem;
}

.start,
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.form {
  display: grid;
  gap: 0.5rem;
}

.form > label {
  display: grid;
  gap: 0.2rem;
}

.kinds {
  display: grid;
  gap: 0.2rem;
  margin: 0;
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 4px;
}

.kind {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}

.kind input {
  width: auto;
}

.note,
.status {
  font-size: 0.9em;
  margin: 0.4rem 0 0;
}

.status button {
  margin-left: 0.5rem;
}
</style>
