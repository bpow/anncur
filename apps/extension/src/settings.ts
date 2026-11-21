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
  /** The deployment's site; the sidebar is at `/sidebar/` on its origin. */
  siteUrl: string;
  /** The sidebar page, when set by hand; empty means `/sidebar/` at the site. */
  sidebarUrl: string;
  /** Origin of the API for public counts; empty means the sidebar's origin. */
  apiUrl: string;
  /** The PDF viewer page, when set by hand; empty means the one the server names. */
  pdfViewerUrl: string;
  /** The PDF viewer page the server named when the options were last saved. */
  foundViewerUrl: string;
}

/** What is kept in storage: the servers, which one is in use, and global choices. */
export interface StoredSettings {
  servers: Server[];
  activeServer: string;
  /** Look up public annotation counts for every page while the guest is off. */
  publicCounts: boolean;
}

/**
 * The server in use, flattened with the global choices. Its `sidebarUrl` is
 * always the sidebar page, whose origin is the only one the guest talks to.
 */
export interface Settings extends Server {
  publicCounts: boolean;
}

/** The toolbar button's menu holds at most this many items besides Options. */
export const MAX_SERVERS = 6;

/**
 * The server a new install starts with. Its viewer is the one the site named
 * when this was written; saving the options asks again.
 */
export const DEFAULT_SERVER: Server = {
  name: 'CurAnno',
  siteUrl: 'https://curanno.apps.cloudapps.unc.edu',
  sidebarUrl: '',
  apiUrl: '',
  pdfViewerUrl: '',
  foundViewerUrl: 'https://curanno-pdf.apps.cloudapps.unc.edu/pdf/',
};

/** The viewer that settings from before servers used when they named none. */
const LEGACY_VIEWER_URL = 'http://localhost:5174/pdf/';

export const DEFAULT_STORED: StoredSettings = {
  servers: [DEFAULT_SERVER],
  activeServer: DEFAULT_SERVER.name,
  publicCounts: false,
};

const SIDEBAR_PATH = '/sidebar/';

/** The sidebar page of a server; empty when its site URL is unusable. */
export function sidebarUrlOf(server: Server): string {
  if (server.sidebarUrl) return server.sidebarUrl;
  try {
    return new URL(SIDEBAR_PATH, server.siteUrl).href;
  } catch {
    return '';
  }
}

export const DEFAULT_SETTINGS: Settings = {
  ...DEFAULT_SERVER,
  sidebarUrl: sidebarUrlOf(DEFAULT_SERVER),
  publicCounts: false,
};

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
  if (!httpUrl(settings.siteUrl)) {
    problems.siteUrl = 'Enter an http or https URL, such as https://curanno.example.';
  }
  if (settings.sidebarUrl) {
    const sidebar = httpUrl(settings.sidebarUrl);
    if (!sidebar) {
      problems.sidebarUrl = 'Enter an http or https URL, or leave it empty.';
    } else {
      const problem = validateSidebar(sidebar.origin, sidebar.pathname + sidebar.search);
      if (problem) problems.sidebarUrl = problem;
    }
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

const SERVER_FIELDS = [
  'name',
  'siteUrl',
  'sidebarUrl',
  'apiUrl',
  'pdfViewerUrl',
  'foundViewerUrl',
] as const;

/** A server saved with only a sidebar URL gets the site that URL is on. */
function siteFromSidebar(server: Server): void {
  const sidebar = httpUrl(server.sidebarUrl);
  if (!sidebar) return;
  server.siteUrl = sidebar.origin;
  if (sidebar.pathname === SIDEBAR_PATH && !sidebar.search) server.sidebarUrl = '';
}

function readServer(value: unknown): Server | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const server: Server = {
    name: '',
    siteUrl: '',
    sidebarUrl: '',
    apiUrl: '',
    pdfViewerUrl: '',
    foundViewerUrl: '',
  };
  for (const key of SERVER_FIELDS) {
    if (typeof record[key] === 'string') server[key] = record[key];
  }
  if (typeof record['name'] !== 'string') return undefined;
  if (!server.siteUrl) siteFromSidebar(server);
  return server.siteUrl || server.sidebarUrl ? server : undefined;
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
    const legacy = readServer({
      pdfViewerUrl: LEGACY_VIEWER_URL,
      ...stored,
      name: 'Default',
    });
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
    stored.servers.find((s) => s.name === stored.activeServer) ??
    stored.servers[0] ??
    DEFAULT_SERVER;
  return { ...server, sidebarUrl: sidebarUrlOf(server), publicCounts: stored.publicCounts };
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
    const host = new URL(server.siteUrl).hostname;
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

/** The PDF viewer page in use; empty when there is none and PDFs stay where they are. */
export function viewerUrl(server: Server): string {
  return server.pdfViewerUrl || server.foundViewerUrl;
}

/**
 * The viewer page a sidebar's `config.json` names (ADR 0021): `/pdf/` on the
 * viewer's origin, or on the sidebar's own when the deployment has one host.
 */
export function viewerUrlFromConfig(sidebarUrl: string, config: unknown): string {
  if (typeof config !== 'object' || config === null) return '';
  const origin = (config as Record<string, unknown>)['pdfViewerOrigin'];
  if (typeof origin !== 'string') return '';
  try {
    return new URL('/pdf/', origin || sidebarUrl).href;
  } catch {
    return '';
  }
}

/** Asks the server where its viewer is; empty when it does not say. */
export async function findViewerUrl(sidebarUrl: string): Promise<string> {
  try {
    const response = await fetch(new URL('config.json', sidebarUrl), {
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return '';
    const found = viewerUrlFromConfig(sidebarUrl, await response.json());
    return httpUrl(found) ? found : '';
  } catch {
    return '';
  }
}

/** Origins whose frames never get the content script: the sidebar's and the viewer's. */
export function excludedOrigins(settings: Settings): string[] {
  const origins = [new URL(settings.sidebarUrl).origin];
  const viewer = viewerUrl(settings);
  if (viewer) origins.push(new URL(viewer).origin);
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
