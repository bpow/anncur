# 0040. The sidebar registers a page's identifiers when it loads, not only when annotating

**Status:** Proposed

**Date:** 2026-11-23

## Context

The sidebar finds a page's annotations with `GET /x/search?uri=<page URL>`. That URL resolves to a document only if some earlier `POST /x/documents` recorded it. Until now the sidebar posted a page's identifiers (canonical link, DOI, Dublin Core identifier, and so on; ADR 0014) only just before creating an annotation. So a page opened at a URL nobody had annotated from found nothing, even when it carried the DOI of an annotated document. Annotations imported through the API, or made on an old publisher URL that now redirects, never appeared on the article's current page.

Options considered:

- **Search by every identifier.** `/x/search` and `/x/events` would accept several URIs and return the union of their documents. Anonymous readers would benefit too. But both operations would change, and a page whose identifiers point at two unmerged documents would show both, which section 5 of `docs/document-identity.md` deliberately avoids.
- **Register on load.** Before searching, the sidebar sends the page's metadata, as it already does before creating an annotation. The server's existing lookup attaches the page URL to the document its identifiers name, so the search by page URL that follows finds it, and later searches by anyone, anonymous readers included, find it as well.

## Decision

- When the user is signed in, the sidebar sends `POST /x/documents` for each guest document before searching for its annotations. It does this only when the document reports an identifier other than its own URL. A page with only its own URL gains nothing from registering.
- A failed registration does not stop the search. The page then finds what its URL alone finds, as before.
- Anonymous sidebars do not register, because `POST /x/documents` needs a user. They benefit once a signed-in user has opened the page.

## Consequences

- Annotations follow a document to every URL whose page reports one of its identifiers, from the first visit by a signed-in user, with no change to the API.
- The server now stores the identifiers of article pages that signed-in users open without annotating, intranet URLs among them. Before, it learned of these URLs only through searches, which it does not store. `document_uris` grows with browsing as well as with annotating.
- Registering adds one request, before the search, to the first load of each page.
- Pages whose identifiers name two unmerged documents still log a conflict per visit (docs/document-identity.md, section 6), more often than before.

## References

- [ADR 0014](0014-document-identity.md), on document identity
- [docs/document-identity.md](../document-identity.md), sections 4, 5 and 8
