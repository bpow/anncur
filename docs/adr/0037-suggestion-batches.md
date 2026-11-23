# 0037. Suggestions are stored as batches that belong to a group, and their items may link to each other

**Status:** Accepted (2026-11-23)

**Date:** 2026-11-15

## Context

Suggestions must survive a reload and support engines that run outside the sidebar: a bulk run over PubMed Central articles overnight, another language, or a hosted model with credentials. An engine run over a case report suggests individuals and the facts that link to them (ADR 0035) together, before anyone has reviewed the individuals, so the facts cannot name annotation IRIs yet.

The options considered for where suggestions live:

- **Ordinary annotations marked pending and readable only by the requester.** This reuses ACLs, anchoring and events. But every reader of annotations (search, summaries, export, other clients) would have to learn to skip pending ones, and a missed check shows unreviewed model output as curated.
- **A separate resource that holds draft annotations, outside the annotation tables.** Chosen.

The options considered for who owns a batch:

- **The person who asked for it.** A bulk run has no such person.
- **A group.** Chosen. Any member can review, and an engine posts for a group.

## Decision

- `/x/suggestion-batches` holds batches. A batch has a group, a document, an engine (`name`, `version`, optional `nickname`), an optional rerun `key`, and items.
- An item has a local id (`_:` followed by up to 64 letters, digits, `-` or `_`), a target, which is a selector or a list of selectors, and one structured body. It is `pending`, `accepted` or `rejected`.
- **Links inside a batch.** A link field (the `annotation` keyword) in an item's value may name a local id instead of an IRI. The server checks four things:
  - each local id names an item of the same batch;
  - that item has the profile the link asks for;
  - the links between items form no cycle;
  - with local ids replaced by placeholder IRIs, each value validates against its profile, which must be registered.
- **The document** is found or created from the batch's `DocumentMetadata`, the same way `POST /x/documents` does it. That never merges documents, so an engine cannot fold two documents into one.
- **Reruns.** A batch with a `key` removes the pending items of earlier batches that share its group, document, engine name and key. An earlier batch left with no items goes too. Decided items stay.
- **Access.** Members of the group create, read and decide on its batches. Reads filter by the caller's group principals in SQL, as for annotations (ADR 0006).
- **Accepting.** The client sends, for each item, the annotation it wants created, built the way it builds any annotation; the curator may have edited it. Alternatively, it sends the IRI of an existing annotation the item stands for, for example an individual already saved.
  - The server replaces local ids in link fields with the IRIs of items already accepted, creates the annotations as the caller, and marks the items as accepted, all in one transaction.
  - An item that links to a pending or rejected item cannot be accepted.
  - The body's `creator` stays the client's claim (ADR 0034).
- **Rejecting** marks items as rejected and removes them from the link lists of pending items. A pending item left with no link in a required link field is rejected as well.
- Accepted annotations are ordinary annotations, with the caller's default ACL. Sharing them is a separate request, as for any new annotation. The sidebar reflects committed decisions immediately, continues finishing other items after a loading or sharing failure, and offers a retry that does not accept the item again.

## Consequences

- An engine needs only the API: it never sees annotations or document text it was not given. The batch holds quotes, as any annotation does, so ADR 0032's guarantee that the API never receives a document's text still holds.
- Nothing about individuals is built in. Any profile pair joined by a link field works the same way.
- Suggestions survive a reload and can be reviewed by someone other than whoever asked for them.
- Building the annotation stays in the client, so the sidebar's purpose, motivation and provenance rules are not duplicated on the server. The cost is that a client can accept an item as anything at all. The record of the decision is the item's link to the annotation it became, not a check of its content.
- Pending items are not on the event stream yet. A sidebar learns of new batches when it loads a document.
- Who may post batches without being a member (service accounts) is a later ADR, with access tokens.

## References

- [docs/external-suggestions-plan.md](../external-suggestions-plan.md), section 3
- ADR 0006, ADR 0014, ADR 0016, ADR 0032, ADR 0034, ADR 0035
