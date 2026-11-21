/**
 * The service worker (ADR 0023). It turns the guest on and off per tab,
 * injects the content script into every frame that loads in a tab where
 * the guest is on, sends PDFs opened in such a tab to the viewer, and keeps
 * the badge, runs sign-in for the sidebar's bridge (ADR 0029), and switches
 * between servers from the button's menu. Its state lives in
 * `chrome.storage.session`, because the browser stops the worker whenever it
 * is idle.
 */
import { isAnchorCountMessage, isWebAuthRequest, type WebAuthResult } from './messages.js';
import {
  ICON_SIZES,
  badgeText,
  isPdfResponse,
  isWebPage,
  publicCountUrl,
  viewerUrlFor,
} from './pages.js';
import {
  activeSettings,
  apiOrigin,
  isLocalServer,
  isSidebarUrl,
  loadSettings,
  loadStored,
  mergeStored,
  saveStored,
  viewerUrl,
} from './settings.js';

const session = chrome.storage.session;
const onKey = (tabId: number): string => `on:${tabId}`;
const pdfKey = (tabId: number): string => `pdf:${tabId}`;
const countPrefix = (tabId: number): string => `count:${tabId}:`;

function icons(on: boolean): Record<string, string> {
  return Object.fromEntries(ICON_SIZES.map((s) => [s, `icons/${on ? 'on' : 'off'}-${s}.png`]));
}

async function isOn(tabId: number): Promise<boolean> {
  return (await session.get(onKey(tabId)))[onKey(tabId)] === true;
}

async function countKeys(tabId: number, frameId?: number): Promise<string[]> {
  const prefix = countPrefix(tabId);
  const all = await session.get(null);
  return Object.keys(all).filter((k) =>
    frameId === undefined ? k.startsWith(prefix) : k === `${prefix}${frameId}`,
  );
}

async function anchorCount(tabId: number): Promise<number> {
  const prefix = countPrefix(tabId);
  const all = await session.get(null);
  let total = 0;
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(prefix) && typeof value === 'number') total += value;
  }
  return total;
}

async function publicCount(tabId: number): Promise<number | undefined> {
  const settings = await loadSettings();
  if (!settings.publicCounts) return undefined;
  const tab = await chrome.tabs.get(tabId);
  if (!isWebPage(tab.url)) return undefined;
  try {
    const response = await fetch(publicCountUrl(apiOrigin(settings), tab.url), {
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { total?: unknown };
    return typeof body.total === 'number' ? body.total : undefined;
  } catch {
    return undefined;
  }
}

// Local servers get their own colour so a development tab is not mistaken for production.
function badgeColor(on: boolean, local: boolean): string {
  if (!on) return '#5f6368';
  return local ? '#b7410e' : '#2b6cb0';
}

async function refresh(tabId: number): Promise<void> {
  try {
    const on = await isOn(tabId);
    const server = await loadSettings();
    const count = on ? await anchorCount(tabId) : await publicCount(tabId);
    await chrome.action.setIcon({ tabId, path: icons(on) });
    await chrome.action.setTitle({
      tabId,
      title: `CurAnno: ${on ? 'on' : 'off'} (${server.name})`,
    });
    await chrome.action.setBadgeBackgroundColor({
      tabId,
      color: badgeColor(on, isLocalServer(server)),
    });
    await chrome.action.setBadgeText({ tabId, text: badgeText(count) });
  } catch {
    // The tab closed meanwhile.
  }
}

async function inject(tabId: number, frameIds?: number[], file = 'content.js'): Promise<void> {
  await chrome.scripting.executeScript({
    target: frameIds ? { tabId, frameIds } : { tabId, allFrames: true },
    files: [file],
  });
}

async function turnOn(tab: chrome.tabs.Tab): Promise<void> {
  const tabId = tab.id as number;
  const settings = await loadSettings();
  const pdf = (await session.get(pdfKey(tabId)))[pdfKey(tabId)] as string | undefined;
  await session.set({ [onKey(tabId)]: true });
  const viewer = viewerUrl(settings);
  if (viewer && pdf && pdf === tab.url) {
    await chrome.tabs.update(tabId, { url: viewerUrlFor(viewer, pdf) });
    return;
  }
  try {
    await inject(tabId);
  } catch (err) {
    // A page extensions may not touch, such as the Web Store or a browser page.
    await session.remove(onKey(tabId));
    console.warn('[curanno extension] cannot run on this page:', err);
  }
}

async function turnOff(tabId: number): Promise<void> {
  await session.remove([onKey(tabId), ...(await countKeys(tabId))]);
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => window.__curannoExtension?.stop(),
    });
  } catch {
    // Nothing was injected, or the page has gone.
  }
}

async function toggle(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  if (await isOn(tab.id)) await turnOff(tab.id);
  else await turnOn(tab);
  await refresh(tab.id);
}

chrome.action.onClicked.addListener((tab) => void toggle(tab));

chrome.webNavigation.onCommitted.addListener((details) => {
  void (async () => {
    const frameId = details.frameId === 0 ? undefined : details.frameId;
    await session.remove(await countKeys(details.tabId, frameId));
    if (frameId === undefined) await refresh(details.tabId);
  })();
});

chrome.webNavigation.onDOMContentLoaded.addListener((details) => {
  void (async () => {
    if (!(await isOn(details.tabId))) return;
    const sidebar = details.frameId !== 0 && isSidebarUrl(await loadSettings(), details.url);
    try {
      await inject(details.tabId, [details.frameId], sidebar ? 'bridge.js' : 'content.js');
    } catch {
      // A frame extensions may not script, or one that has navigated again.
    }
  })();
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0) void refresh(details.tabId);
});

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const tabId = details.tabId;
    if (!isPdfResponse(details.responseHeaders)) {
      void session.remove(pdfKey(tabId));
      return;
    }
    void (async () => {
      await session.set({ [pdfKey(tabId)]: details.url });
      const viewer = viewerUrl(await loadSettings());
      if (viewer && (await isOn(tabId))) {
        await chrome.tabs.update(tabId, { url: viewerUrlFor(viewer, details.url) });
      }
    })();
  },
  { urls: ['<all_urls>'], types: ['main_frame'] },
  ['responseHeaders'],
);

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined || sender.frameId === undefined || !isAnchorCountMessage(message)) {
    return;
  }
  void (async () => {
    if (!(await isOn(tabId))) return;
    await session.set({ [`${countPrefix(tabId)}${sender.frameId}`]: message.count });
    await refresh(tabId);
  })();
});

async function webAuth(url: string): Promise<WebAuthResult> {
  const target = new URL(url);
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return { error: 'Not a web address' };
  }
  try {
    const ended = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
    return ended?.startsWith(chrome.identity.getRedirectURL())
      ? { url: ended }
      : { error: 'The sign-in window ended somewhere unexpected' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// Only the bridge in a sidebar frame may ask; its URL is the browser's word, not the page's.
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isWebAuthRequest(message) || sender.tab === undefined || sender.frameId === 0) return;
  void (async () => {
    if (!isSidebarUrl(await loadSettings(), sender.url)) {
      sendResponse({ error: 'Not the sidebar' } satisfies WebAuthResult);
      return;
    }
    sendResponse(await webAuth(message.url));
  })();
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    await session.remove([onKey(tabId), pdfKey(tabId), ...(await countKeys(tabId))]);
  })();
});

const SERVER_MENU_PREFIX = 'server:';

// Rebuilds are chained so that two storage changes in a row cannot interleave.
let menus = Promise.resolve();
function rebuildMenus(): void {
  menus = menus.then(async () => {
    await chrome.contextMenus.removeAll();
    const stored = await loadStored();
    if (stored.servers.length < 2) return;
    for (const server of stored.servers) {
      chrome.contextMenus.create({
        id: `${SERVER_MENU_PREFIX}${server.name}`,
        title: server.name,
        type: 'radio',
        checked: server.name === stored.activeServer,
        contexts: ['action'],
      });
    }
  });
}

chrome.runtime.onInstalled.addListener(rebuildMenus);
chrome.runtime.onStartup.addListener(rebuildMenus);

chrome.contextMenus.onClicked.addListener((info) => {
  const id = String(info.menuItemId);
  if (!id.startsWith(SERVER_MENU_PREFIX)) return;
  void (async () => {
    const stored = await loadStored();
    await saveStored({ ...stored, activeServer: id.slice(SERVER_MENU_PREFIX.length) });
  })();
});

/** Turns the guest off wherever it is on, so that no tab talks to two servers. */
async function turnAllOff(): Promise<void> {
  const all = await session.get(null);
  for (const key of Object.keys(all)) {
    if (key.startsWith('on:')) await turnOff(Number(key.slice(3)));
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  rebuildMenus();
  void (async () => {
    const raw = await chrome.storage.sync.get(null);
    const before = { ...raw };
    for (const [key, change] of Object.entries(changes)) {
      if (change.oldValue === undefined) delete before[key];
      else before[key] = change.oldValue;
    }
    const was = activeSettings(mergeStored(before));
    const now = activeSettings(mergeStored(raw));
    if (was.sidebarUrl !== now.sidebarUrl || viewerUrl(was) !== viewerUrl(now)) {
      await turnAllOff();
    }
    for (const tab of await chrome.tabs.query({})) {
      if (tab.id !== undefined) await refresh(tab.id);
    }
  })();
});
