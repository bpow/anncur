/**
 * Destructive actions the curator can take back. Offers stay until undone
 * or dismissed rather than timing out: a click forced while the page hid the
 * sidebar (clickjacking) is only noticed when the sidebar is next seen.
 */
import { toProblem, type Problem } from '@curanno/api-client';
import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface UndoOffer {
  key: number;
  message: string;
  undo: () => Promise<void>;
}

const KEEP = 5;

export const useUndoStore = defineStore('undo', () => {
  const offers = ref<UndoOffer[]>([]);
  const problem = ref<Problem>();
  const busy = ref(false);
  let next = 0;

  function offer(message: string, undo: () => Promise<void>): void {
    offers.value = [{ key: next++, message, undo }, ...offers.value].slice(0, KEEP);
  }

  function dismiss(key: number): void {
    offers.value = offers.value.filter((o) => o.key !== key);
  }

  async function run(key: number): Promise<void> {
    const found = offers.value.find((o) => o.key === key);
    if (!found || busy.value) return;
    busy.value = true;
    try {
      await found.undo();
      dismiss(key);
      problem.value = undefined;
    } catch (err) {
      problem.value = toProblem(err);
    } finally {
      busy.value = false;
    }
  }

  function clear(): void {
    offers.value = [];
    problem.value = undefined;
  }

  return { offers, problem, busy, offer, dismiss, run, clear };
});
