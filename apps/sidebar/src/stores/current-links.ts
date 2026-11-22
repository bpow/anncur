/**
 * The annotations a curator is working on, such as the individuals whose facts
 * they are recording. A new body whose profile links to annotations of that
 * profile starts out linked to them.
 */
import type { BodyProfile, JsonValue } from '@anncur/model';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { linkFieldOf } from '../profiles/links';

export const useCurrentLinksStore = defineStore('current-links', () => {
  /** By the linked annotations' profile IRI. */
  const byProfile = ref<Record<string, string[]>>({});

  function of(profile: string): string[] {
    return byProfile.value[profile] ?? [];
  }

  function toggle(profile: string, iri: string): void {
    const now = of(profile);
    byProfile.value = {
      ...byProfile.value,
      [profile]: now.includes(iri) ? now.filter((i) => i !== iri) : [...now, iri],
    };
  }

  function clear(): void {
    byProfile.value = {};
  }

  /** A new value for `profile`, linked to the current annotations if it has a link field. */
  function initialValue(profile: BodyProfile): Record<string, JsonValue> {
    const field = linkFieldOf(profile);
    const ids = field?.link ? of(field.link.profile) : [];
    if (!field || !ids.length) return {};
    return { [field.name]: field.multiple ? ids : ids[0]! };
  }

  return { byProfile, of, toggle, clear, initialValue };
});
