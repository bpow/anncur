# 0039. Against clickjacking, deletions can be undone and the sign-in return page is never framed

**Status:** Proposed

**Date:** 2026-11-18

## Context

The sidebar is framed by the pages being annotated (ADR 0007). Its `frame-ancestors` policy is the first clickjacking defence, but a curator annotates articles on any publisher's site, so in practice the list becomes `https:`, which lets any page frame a signed-in sidebar. Such a page can cover the frame, fade it, or move it under the pointer, and turn a click on its own bait into a click on Delete, a sharing checkbox, "Highlight on <site>" (which sends quoted text to that page, ADR 0025), or accepting a suggestion.

The defences considered were moving sensitive actions to top-level pages, checking the control's visibility, arming controls only after a delay, making destructive actions hard to aim at (confirmation in an unpredictable place, hold-to-confirm), and making them undoable. Account, group and token management are already top-level pages on the management site, which sends `frame-ancestors 'none'`. Sharing stays in the sidebar, where curators use it.

## Decision

- **Top-level only where possible.** The sidebar pages that are never framed (the sign-in popup's return, `popup-callback.html`) are served with `frame-ancestors 'none'`, by the API and by the sidebar's dev and preview servers. `silent-renew.html` is framed by the sidebar, so it keeps the sidebar's ancestors.
- **No visibility checks.** Dropping clicks on controls that Intersection Observer v2 (`trackVisibility`) does not report as unobscured was built and withdrawn. Chromium judges a cross-origin frame as a whole: anything painted over any part of the iframe marks every control in it as obscured. The guest's own resize handle and the shadow of its toggle tab were enough to block Post and Save on every page, and a publisher's overlay or another extension's element would do the same, with no way through for the curator. Only Chromium implements it, and the headless shell the e2e suites run in reports such a frame as visible, so the suites could not see the failure.
- **Undo.** Deleting an annotation can be undone (`POST /x/annotations/{id}/restore`, the `delete` permission). The offer stays at the top of the sidebar until it is used or dismissed, or the identity changes, not on a timer: a click forced while the sidebar was hidden is only noticed when the sidebar is next seen.

## Consequences

- Deleting is the only action a forced click cannot make stick. A page that can frame the sidebar can still force single clicks on a sharing checkbox, "Highlight on <site>", accepting or rejecting a suggestion, and discarding a batch, none of which is confirmed or undoable. Confirmation or undo for those is the next step, since it works in every browser and no overlay breaks it.
- Restoring makes a deleted annotation readable again, with a new ETag. Event streams report it as `created`. Rejecting a suggestion and discarding a batch are not yet undoable: discarding deletes the batch's pending items.
