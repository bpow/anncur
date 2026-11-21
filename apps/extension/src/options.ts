/** The options page: edits the servers and choices in `chrome.storage.sync`. */
import {
  MAX_SERVERS,
  findViewerUrl,
  loadStored,
  saveStored,
  sidebarUrlOf,
  validateStored,
  viewerUrl,
  type Server,
  type StoredSettings,
} from './settings.js';

const form = document.getElementById('settings') as HTMLFormElement;
const list = document.getElementById('servers') as HTMLElement;
const add = document.getElementById('add') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLElement;
const template = document.getElementById('server-template') as HTMLTemplateElement;
const publicCounts = document.getElementById('publicCounts') as HTMLInputElement;
const FIELDS = ['name', 'siteUrl', 'sidebarUrl', 'pdfViewerUrl', 'apiUrl'] as const;

function fieldsets(): HTMLFieldSetElement[] {
  return Array.from(list.querySelectorAll<HTMLFieldSetElement>('fieldset.server'));
}

function field(fieldset: Element, name: string): HTMLInputElement {
  return fieldset.querySelector(`[data-field="${name}"]`) as HTMLInputElement;
}

function read(): StoredSettings {
  const servers: Server[] = [];
  let activeServer = '';
  for (const fieldset of fieldsets()) {
    const server = Object.fromEntries(
      FIELDS.map((name) => [name, field(fieldset, name).value.trim()]),
    ) as unknown as Server;
    server.foundViewerUrl = fieldset.dataset['foundViewerUrl'] ?? '';
    servers.push(server);
    if (fieldset.querySelector<HTMLInputElement>('input[name=activeServer]')?.checked) {
      activeServer = server.name;
    }
  }
  return { servers, activeServer, publicCounts: publicCounts.checked };
}

function viewerNote(server: Server): string {
  const viewer = viewerUrl(server);
  if (viewer) return `PDFs open in ${viewer}`;
  return server.siteUrl
    ? 'This server names no PDF viewer, so PDFs stay where they are. Set one under Advanced.'
    : '';
}

function render(stored: StoredSettings): void {
  list.replaceChildren();
  stored.servers.forEach((server, i) => {
    const fieldset = (template.content.cloneNode(true) as DocumentFragment)
      .firstElementChild as HTMLFieldSetElement;
    fieldset.dataset['foundViewerUrl'] = server.foundViewerUrl;
    fieldset.querySelector('[data-viewer]')!.textContent = viewerNote(server);
    fieldset.querySelector('details')!.open = Boolean(
      server.sidebarUrl || server.pdfViewerUrl || server.apiUrl,
    );
    for (const name of FIELDS) {
      const id = `${name}-${i}`;
      const input = field(fieldset, name);
      input.id = id;
      input.value = server[name];
      input.setAttribute('aria-describedby', `${id}-error`);
      fieldset.querySelector(`[data-for="${name}"]`)!.setAttribute('for', id);
      fieldset.querySelector(`[data-error="${name}"]`)!.id = `${id}-error`;
    }
    const radio = fieldset.querySelector<HTMLInputElement>('input[name=activeServer]')!;
    radio.id = `active-${i}`;
    radio.checked = server.name === stored.activeServer;
    const remove = fieldset.querySelector<HTMLButtonElement>('button.remove')!;
    remove.id = `remove-${i}`;
    remove.hidden = stored.servers.length === 1;
    remove.addEventListener('click', () => {
      const current = read();
      current.servers.splice(i, 1);
      if (!current.servers.some((s) => s.name === current.activeServer)) {
        current.activeServer = current.servers[0]?.name ?? '';
      }
      render(current);
    });
    list.append(fieldset);
  });
  add.hidden = stored.servers.length >= MAX_SERVERS;
  publicCounts.checked = stored.publicCounts;
}

add.addEventListener('click', () => {
  const current = read();
  current.servers.push({
    name: '',
    siteUrl: '',
    sidebarUrl: '',
    apiUrl: '',
    pdfViewerUrl: '',
    foundViewerUrl: '',
  });
  render(current);
  field(fieldsets().at(-1)!, 'name').focus();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const stored = read();
  const problems = validateStored(stored);
  let first: HTMLInputElement | undefined;
  fieldsets().forEach((fieldset, i) => {
    for (const name of FIELDS) {
      const problem = problems[i]?.[name] ?? '';
      const input = field(fieldset, name);
      document.getElementById(`${input.id}-error`)!.textContent = problem;
      input.setAttribute('aria-invalid', problem ? 'true' : 'false');
      if (problem) {
        first ??= input;
        const details = input.closest('details');
        if (details) details.open = true;
      }
    }
  });
  if (first) {
    first.focus();
    status.textContent = '';
    return;
  }
  status.textContent = 'Asking each server for its PDF viewer…';
  void (async () => {
    await Promise.all(
      stored.servers.map(async (server) => {
        server.foundViewerUrl = server.pdfViewerUrl
          ? ''
          : await findViewerUrl(sidebarUrlOf(server));
      }),
    );
    await saveStored(stored);
    render(stored);
    status.textContent = 'Saved. If the server in use changed, the guest is now off in every tab.';
  })();
});

void loadStored().then(render);
