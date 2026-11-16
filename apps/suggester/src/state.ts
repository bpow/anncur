/**
 * What has been posted already, so that an interrupted or nightly run picks
 * up where it left off. A document is done for a given run: the same kinds,
 * model and prompt. Any change runs it again, and the server's rerun key
 * replaces the earlier batch's pending items.
 */
import { readFile, rename, writeFile } from 'node:fs/promises';

interface Entry {
  run: string;
  batch?: string;
  at: string;
}

export class State {
  private readonly path: string | undefined;
  private readonly done: Record<string, Entry>;

  private constructor(path: string | undefined, done: Record<string, Entry>) {
    this.path = path;
    this.done = done;
  }

  static async open(path: string | undefined): Promise<State> {
    if (!path) return new State(undefined, {});
    try {
      const json = JSON.parse(await readFile(path, 'utf8')) as { done?: Record<string, Entry> };
      return new State(path, json.done ?? {});
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return new State(path, {});
      throw err;
    }
  }

  isDone(id: string, run: string): boolean {
    return this.done[id]?.run === run;
  }

  async record(id: string, run: string, batch: string | undefined): Promise<void> {
    this.done[id] = { run, ...(batch ? { batch } : {}), at: new Date().toISOString() };
    if (!this.path) return;
    // Written aside and moved into place, so a run stopped mid-write leaves the last good file.
    const next = `${this.path}.tmp`;
    await writeFile(next, `${JSON.stringify({ version: 1, done: this.done }, null, 2)}\n`);
    await rename(next, this.path);
  }
}
