# Browser extension

A Manifest V3 extension for Chromium browsers that runs the guest in every frame of a tab, in place of the bookmarklet ([ADR 0023](../../docs/adr/0023-browser-extension.md)). The guest ships inside the extension and runs in its isolated world, so it works on pages whose Content-Security-Policy blocks the bookmarklet's script or the sidebar frame.

- **Toolbar button:** turns the guest on or off in the current tab. While it is on, every page and frame that loads in the tab gets a guest, cross-origin frames included, and the top frame shows the sidebar.
- **PDFs:** a PDF opened in a tab where the guest is on, or a PDF tab where the button is pressed, goes to the PDF viewer with the PDF's address.
- **Badge:** while the guest is on, the number of annotations the sidebar has anchored in the tab. While it is off, and only if turned on in the options, the number of public annotations on the page from an anonymous search. That sends every page address to the API.
- **Options:** a list of servers, each with a name and the site's URL, and the public-counts switch. The sidebar is `/sidebar/` at the site. On save the extension asks each server's `/sidebar/config.json` where its PDF viewer is (ADR 0021) and shows the answer. **Advanced** holds a sidebar URL and a PDF viewer URL to use instead, and the API origin for public counts. Right-click the button and choose Options.
- **Switching servers:** with two or more servers saved, right-click the button and pick one. Switching turns the guest off in every tab, so no tab talks to two servers; press the button again to use the new one. The button's title names the server in use, and the badge is orange instead of blue while a local server (`localhost`, `127.0.0.1` or `*.localhost`) is on.

- **Sign-in:** the sidebar signs in through the extension, which opens the provider's page with `chrome.identity.launchWebAuthFlow` instead of a popup (ADR 0029). This works on pages whose `Cross-Origin-Opener-Policy` leaves the sidebar's own popup blank. The provider must list `https://dmlkjhnoiinndnkboiknehimngilddpp.chromiumapp.org/` as a redirect and post-logout redirect URI; the chart's `extensionIds` does that for the embedded issuer and for Zitadel.

The extension holds no token and no annotation content. The sidebar keeps the PKCE verifier and redeems the code itself (ADR 0019, 0029).

## Layout

| Path                    | Role                                                                          |
| ----------------------- | ----------------------------------------------------------------------------- |
| `src/background.ts`     | Service worker: per-tab state, injection, PDF redirect, badge                 |
| `src/content.ts`        | Content script: one guest per frame                                           |
| `src/bridge.ts`         | Content script in the sidebar's frame: relays sign-in to the service worker   |
| `src/settings.ts`       | Servers and settings, their defaults, validation and migration               |
| `src/pages.ts`          | PDF detection, viewer and search addresses, badge text                        |
| `src/options.*`         | Options page                                                                  |
| `src/manifest.json`     | Manifest; the build sets its version from `package.json`. Its public `key` fixes the extension id |
| `scripts/build.ts`      | esbuild bundle into `dist/`, with the guest and model bundled from source     |
| `scripts/icons.ts`      | Draws the toolbar icons at build time                                         |
| `test/browser/`         | Playwright tests of the built extension against the guest's fake sidebar      |

## Building and loading

```bash
pnpm --filter @anncur/extension build
```

writes the unpacked extension to `apps/extension/dist`. In Chrome open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and pick that folder. `pnpm --filter @anncur/extension dev` rebuilds on change; press the reload button on the extension's card afterwards.

A new install starts with one server, **Anncur**, at `https://curanno.apps.cloudapps.unc.edu`. For another deployment, add a server with the site URL `https://<host>`; the extension finds the viewer itself. If a deployment's viewer host changes, save the options again. Settings saved before servers existed become one server named **Default**.

For the development stack, add a server with the site URL `http://localhost:3001` (the site from `just dev`, with its sidebar at `/sidebar/`) and, under Advanced, the PDF viewer URL `http://localhost:5174/pdf/` (the viewer from `pnpm --filter @anncur/pdf-viewer dev`); the development sidebar serves no `config.json` to find the viewer in. Its `frame-ancestors` allows only `localhost` and `127.0.0.1` pages; set `VITE_FRAME_ANCESTORS` to annotate others. A deployed sidebar is framed by whatever page is open, so `FRAME_ANCESTORS` has to allow those pages: `https:` for extension users on any site.

## Tests

`pnpm test` runs the unit tests. `pnpm --filter @anncur/extension test:browser` builds the extension, loads it into Chromium (the full browser in headless mode, since the headless shell runs no extensions) and covers a page that allows no scripts, styles or frames, a cross-origin frame, navigation, the PDF redirect, both badge counts, the options page and switching servers. It needs `pnpm --filter @anncur/guest exec playwright install chromium` once.
