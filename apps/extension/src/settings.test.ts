import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DEFAULT_STORED,
  DEFAULT_SERVER,
  activeSettings,
  apiOrigin,
  excludedOrigins,
  isLocalServer,
  isSidebarUrl,
  mergeStored,
  sidebarLocation,
  validateSettings,
  sidebarUrlOf,
  validateStored,
  viewerUrl,
  viewerUrlFromConfig,
  type Server,
} from './settings.js';

const LOCAL_SERVER = {
  name: 'Local',
  siteUrl: 'http://localhost:3001',
  sidebarUrl: '',
  apiUrl: '',
  pdfViewerUrl: 'http://localhost:5174/pdf/',
  foundViewerUrl: '',
};

const deployedServer = {
  name: 'Production',
  siteUrl: 'https://curanno.example',
  sidebarUrl: '',
  apiUrl: '',
  pdfViewerUrl: 'https://pdf.curanno.example/pdf/',
  foundViewerUrl: '',
};
/** The server as the rest of the extension sees it while it is in use. */
const deployed = {
  ...deployedServer,
  sidebarUrl: 'https://curanno.example/sidebar/',
  publicCounts: false,
};

describe('validateSettings', () => {
  it('accepts the defaults and a deployment', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual({});
    expect(validateSettings(deployedServer)).toEqual({});
    expect(validateSettings(deployed)).toEqual({});
    expect(validateSettings({ ...deployed, apiUrl: 'https://api.example/' })).toEqual({});
  });

  it('names each unusable field', () => {
    const problems = validateSettings({
      name: ' ',
      siteUrl: 'curanno.example',
      sidebarUrl: 'javascript:alert(1)',
      apiUrl: 'https://api.example/base',
      pdfViewerUrl: 'file:///viewer.html',
      foundViewerUrl: '',
    });
    expect(Object.keys(problems).sort()).toEqual([
      'apiUrl',
      'name',
      'pdfViewerUrl',
      'sidebarUrl',
      'siteUrl',
    ]);
    expect(validateSettings({ ...deployed, sidebarUrl: 'not a url' }).sidebarUrl).toMatch(/http/);
  });
});

describe('validateStored', () => {
  it('wants each name only once', () => {
    const problems = validateStored({
      servers: [LOCAL_SERVER, deployed, { ...deployed, name: 'Local' }],
      activeServer: 'Local',
      publicCounts: false,
    });
    expect(problems.map((p) => Object.keys(p))).toEqual([[], [], ['name']]);
  });
});

describe('mergeStored', () => {
  it('starts with the default server', () => {
    expect(mergeStored({})).toEqual(DEFAULT_STORED);
    expect(activeSettings(mergeStored({}))).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.sidebarUrl).toBe('https://curanno.apps.cloudapps.unc.edu/sidebar/');
    expect(viewerUrl(DEFAULT_SERVER)).toBe('https://curanno-pdf.apps.cloudapps.unc.edu/pdf/');
  });

  it('keeps stored servers and picks the active one', () => {
    const stored = mergeStored({
      servers: [LOCAL_SERVER, deployedServer, 'junk', { name: 'no site' }],
      activeServer: 'Production',
      publicCounts: true,
    });
    expect(stored.servers).toEqual([LOCAL_SERVER, deployedServer]);
    expect(activeSettings(stored)).toEqual({ ...deployed, publicCounts: true });
  });

  it('falls back to the first server when the active one is gone', () => {
    expect(mergeStored({ servers: [deployed], activeServer: 'Local' }).activeServer).toBe(
      'Production',
    );
  });

  it('turns settings from before servers into one server', () => {
    const stored = mergeStored({ sidebarUrl: deployed.sidebarUrl, publicCounts: 'yes', extra: 1 });
    expect(stored.servers).toEqual([
      { ...LOCAL_SERVER, name: 'Default', siteUrl: 'https://curanno.example' },
    ]);
    expect(stored.publicCounts).toBe(false);
  });

  it('keeps a sidebar that is not at /sidebar/ on its site', () => {
    const sidebarUrl = 'https://curanno.example/other/sidebar.html';
    const [server] = mergeStored({ servers: [{ name: 'Odd', sidebarUrl }] }).servers;
    expect(server).toMatchObject({ siteUrl: 'https://curanno.example', sidebarUrl });
    expect(sidebarUrlOf(server as Server)).toBe(sidebarUrl);
  });
});

describe('isLocalServer', () => {
  it('tells this machine from a deployment', () => {
    expect(isLocalServer(LOCAL_SERVER)).toBe(true);
    expect(isLocalServer({ ...deployed, siteUrl: 'http://curanno.localhost' })).toBe(true);
    expect(isLocalServer(deployed)).toBe(false);
  });
});

describe('derived locations', () => {
  it('splits the sidebar URL and falls back to its origin for the API', () => {
    expect(sidebarLocation(deployed)).toEqual({
      sidebarOrigin: 'https://curanno.example',
      sidebarPath: '/sidebar/',
    });
    expect(apiOrigin(deployed)).toBe('https://curanno.example');
    expect(apiOrigin({ ...deployed, apiUrl: 'https://api.example' })).toBe('https://api.example');
  });

  it('excludes the sidebar origin, and the viewer origin when there is one', () => {
    expect(excludedOrigins(deployed)).toEqual([
      'https://curanno.example',
      'https://pdf.curanno.example',
    ]);
    expect(excludedOrigins({ ...deployed, pdfViewerUrl: '' })).toEqual(['https://curanno.example']);
  });
});

describe('the viewer', () => {
  const found = { ...deployed, pdfViewerUrl: '', foundViewerUrl: 'https://found.example/pdf/' };

  it('is the one set by hand, else the one the server named', () => {
    expect(viewerUrl(deployed)).toBe('https://pdf.curanno.example/pdf/');
    expect(viewerUrl(found)).toBe('https://found.example/pdf/');
    expect(viewerUrl({ ...found, pdfViewerUrl: deployed.pdfViewerUrl })).toBe(
      deployed.pdfViewerUrl,
    );
    expect(excludedOrigins(found)).toEqual(['https://curanno.example', 'https://found.example']);
  });

  it('is read from the sidebar configuration', () => {
    const from = (config: unknown): string => viewerUrlFromConfig(deployed.sidebarUrl, config);
    expect(from({ pdfViewerOrigin: 'https://pdf.curanno.example' })).toBe(
      'https://pdf.curanno.example/pdf/',
    );
    expect(from({ pdfViewerOrigin: '' })).toBe('https://curanno.example/pdf/');
    expect(from({ pdfViewerOrigin: 'nonsense' })).toBe('');
    expect(from({})).toBe('');
    expect(from('<!doctype html>')).toBe('');
  });
});

describe('isSidebarUrl', () => {
  it('matches the sidebar page and below it, on its origin only', () => {
    expect(isSidebarUrl(deployed, 'https://curanno.example/sidebar/')).toBe(true);
    expect(isSidebarUrl(deployed, 'https://curanno.example/sidebar/?x=1')).toBe(true);
    expect(isSidebarUrl(deployed, 'https://curanno.example/account/login')).toBe(false);
    expect(isSidebarUrl(deployed, 'https://evil.example/sidebar/')).toBe(false);
    expect(isSidebarUrl(deployed, undefined)).toBe(false);
    expect(isSidebarUrl(deployed, 'not a url')).toBe(false);
  });
});
