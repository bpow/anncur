import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DEFAULT_STORED,
  LOCAL_SERVER,
  activeSettings,
  apiOrigin,
  excludedOrigins,
  isLocalServer,
  isSidebarUrl,
  mergeStored,
  sidebarLocation,
  validateSettings,
  validateStored,
} from './settings.js';

const deployed = {
  name: 'Production',
  sidebarUrl: 'https://curanno.example/sidebar/',
  apiUrl: '',
  pdfViewerUrl: 'https://pdf.curanno.example/pdf/',
  publicCounts: false,
};

describe('validateSettings', () => {
  it('accepts the defaults and a deployment', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual({});
    expect(validateSettings(deployed)).toEqual({});
    expect(validateSettings({ ...deployed, apiUrl: 'https://api.example/' })).toEqual({});
  });

  it('names each unusable field', () => {
    const problems = validateSettings({
      name: ' ',
      sidebarUrl: 'javascript:alert(1)',
      apiUrl: 'https://api.example/base',
      pdfViewerUrl: 'file:///viewer.html',
    });
    expect(Object.keys(problems).sort()).toEqual(['apiUrl', 'name', 'pdfViewerUrl', 'sidebarUrl']);
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
  it('starts with the local server', () => {
    expect(mergeStored({})).toEqual(DEFAULT_STORED);
    expect(activeSettings(mergeStored({}))).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps stored servers and picks the active one', () => {
    const stored = mergeStored({
      servers: [LOCAL_SERVER, deployed, 'junk', { name: 'no sidebar' }],
      activeServer: 'Production',
      publicCounts: true,
    });
    expect(stored.servers).toEqual([
      LOCAL_SERVER,
      {
        name: deployed.name,
        sidebarUrl: deployed.sidebarUrl,
        apiUrl: '',
        pdfViewerUrl: deployed.pdfViewerUrl,
      },
    ]);
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
      { ...LOCAL_SERVER, name: 'Default', sidebarUrl: deployed.sidebarUrl },
    ]);
    expect(stored.publicCounts).toBe(false);
  });
});

describe('isLocalServer', () => {
  it('tells this machine from a deployment', () => {
    expect(isLocalServer(LOCAL_SERVER)).toBe(true);
    expect(isLocalServer({ ...deployed, sidebarUrl: 'http://curanno.localhost/sidebar/' })).toBe(
      true,
    );
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
