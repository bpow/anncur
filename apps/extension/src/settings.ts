/**
 * The extension's settings, kept in `chrome.storage.sync` and edited on the
 * options page. They list the deployments the extension can talk to and say
 * which is in use; nothing in them is a credential, since sign-in stays in
 * each sidebar's origin (ADR 0019, 0023).
 */
import { validateSidebar } from '@curanno/guest';

/** One deployment the extension can talk to. */
export interface Server {
  /** Shown in the toolbar button's menu and title. */
  name: string;
  /** The sidebar page; its origin is the only one the guest talks to. */
  sidebarUrl: string;
  /** Origin of the API for public counts; empty means the sidebar's origin. */
  apiUrl: string;
  /** The PDF viewer page; empty turns the PDF redirect off. */
  pdfViewerUrl: string;
}

/** What is kept in storage: the servers, which one is in use, and global choices. */
export interface StoredSettings {
  servers: Server[];
  activeServer: string;
  /** Look up public annotation counts for every page while the guest is off. */
  publicCounts: boolean;
}

/** The server in use, flattened with the global choices. */
export interface Settings extends Server {
  publicCounts: boolean;
}

/** The toolbar button's menu holds at most this many items besides Options. */
export const MAX_SERVERS = 6;

/** The development stack's addresses (README.md). */
export const LOCAL_SERVER: Server = {
  name: 'Local',
  sidebarUrl: 'http://localhost:3001/sidebar/',
  apiUrl: '',
  pdfViewerUrl: 'http://localhost:5174/pdf/',
};

export const DEFAULT_STORED: StoredSettings = {
  servers: [LOCAL_SERVER],
  activeServer: LOCAL_SERVER.name,
  publicCounts: false,
};

export const DEFAULT_SETTINGS: Settings = { ...LOCAL_SERVER, publicCounts: false };

export type SettingsProblems = Partial<Record<keyof Server, string>>;

function httpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** What is wrong with each field, empty when the server is usable. */
export function validateSettings(settings: Server): SettingsProblems {
  const problems: SettingsProblems = {};
  if (!settings.name.trim()) problems.name = 'Enter a name.';
  const sidebar = httpUrl(settings.sidebarUrl);
  if (!sidebar) {
    problems.sidebarUrl = 'Enter an http or https URL.';
  } else {
    const problem = validateSidebar(sidebar.origin, sidebar.pathname + sidebar.search);
    if (problem) problems.sidebarUrl = problem;
  }
  if (settings.apiUrl) {
    const api = httpUrl(settings.apiUrl);
    if (!api) problems.apiUrl = 'Enter an http or https origin, or leave it empty.';
    else if (api.origin !== settings.apiUrl.replace(/\/$/, '')) {
      problems.apiUrl = 'Enter an origin without a path, such as https://curanno.example.';
    }
  }
  if (settings.pdfViewerUrl && !httpUrl(settings.pdfViewerUrl)) {
    problems.pdfViewerUrl = 'Enter an http or https URL, or leave it empty.';
  }
  return problems;
}

/** Problems for each server in turn, with names that must be unique. */
export function validateStored(stored: StoredSettings): SettingsProblems[] {
  const seen = new Set<string>();
  return stored.servers.map((server) => {
    const problems = validateSettings(server);
    const name = server.name.trim();
    if (name && seen.has(name)) problems.name = 'Another server has this name.';
    seen.add(name);
    return problems;
  });
}

const SERVER_FIELDS = ['name', 'sidebarUrl', 'apiUrl', 'pdfViewerUrl'] as const;

function readServer(value: unknown): Server | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const server = { ...LOCAL_SERVER };
  for (const key of SERVER_FIELDS) {
    if (typeof record[key] === 'string') server[key] = record[key];
  }
  return typeof record['name'] === 'string' && typeof record['sidebarUrl'] === 'string'
    ? server
    : undefined;
}

/**
 * Stored values over the defaults, ignoring anything of the wrong type.
 * Settings saved before there were several servers become one server.
 */
export function mergeStored(stored: Record<string, unknown>): StoredSettings {
  let servers = Array.isArray(stored['servers'])
    ? stored['servers'].map(readServer).filter((s): s is Server => s !== undefined)
    : [];
  if (servers.length === 0) {
    const legacy = readServer({ ...LOCAL_SERVER, ...stored, name: 'Default' });
    servers =
      legacy && typeof stored['sidebarUrl'] === 'string' ? [legacy] : DEFAULT_STORED.servers;
  }
  const active = stored['activeServer'];
  return {
    servers,
    activeServer:
      typeof active === 'string' && servers.some((s) => s.name === active)
        ? active
        : (servers[0] as Server).name,
    publicCounts:
      typeof stored['publicCounts'] === 'boolean'
        ? stored['publicCounts']
        : DEFAULT_STORED.publicCounts,
  };
}

export function activeSettings(stored: StoredSettings): Settings {
  const server =
    stored.servers.find((s) => s.name === stored.activeServer) ?? stored.servers[0] ?? LOCAL_SERVER;
  return { ...server, publicCounts: stored.publicCounts };
}

export async function loadStored(): Promise<StoredSettings> {
  return mergeStored(await chrome.storage.sync.get(null));
}

export async function loadSettings(): Promise<Settings> {
  return activeSettings(await loadStored());
}

export async function saveStored(stored: StoredSettings): Promise<void> {
  await chrome.storage.sync.set(stored);
  await chrome.storage.sync.remove(['sidebarUrl', 'apiUrl', 'pdfViewerUrl']);
}

/** A server on this machine, which the toolbar button marks so it is not mistaken for production. */
export function isLocalServer(server: Server): boolean {
  try {
    const host = new URL(server.sidebarUrl).hostname;
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '[::1]' ||
      host.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}

export interface SidebarLocation {
  sidebarOrigin: string;
  sidebarPath: string;
}

export function sidebarLocation(settings: Settings): SidebarLocation {
  const url = new URL(settings.sidebarUrl);
  return { sidebarOrigin: url.origin, sidebarPath: url.pathname + url.search };
}

/** The API base for search; the sidebar's origin when none is set. */
export function apiOrigin(settings: Settings): string {
  return settings.apiUrl ? new URL(settings.apiUrl).origin : new URL(settings.sidebarUrl).origin;
}

/** Origins whose frames never get the content script: the sidebar's and the viewer's. */
export function excludedOrigins(settings: Settings): string[] {
  const origins = [new URL(settings.sidebarUrl).origin];
  if (settings.pdfViewerUrl) origins.push(new URL(settings.pdfViewerUrl).origin);
  return origins;
}

/** Whether a frame's URL is the sidebar page, which gets the sign-in bridge (ADR 0029). */
export function isSidebarUrl(settings: Settings, frameUrl: string | undefined): boolean {
  if (!frameUrl) return false;
  try {
    const sidebar = new URL(settings.sidebarUrl);
    const frame = new URL(frameUrl);
    return frame.origin === sidebar.origin && frame.pathname.startsWith(sidebar.pathname);
  } catch {
    return false;
  }
}
