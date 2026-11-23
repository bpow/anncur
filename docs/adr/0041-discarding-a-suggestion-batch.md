# 0041. Members of a group may discard a whole suggestion batch

**Status:** Accepted

**Date:** 2026-11-23

## Context

ADR 0037 lets members accept or reject the items of a suggestion batch, and lets a rerun with the same `key` replace earlier pending items. It does not say how a batch goes away otherwise. In practice a curator sometimes wants none of a batch: a run against the wrong gene, a model that misread the article, or a batch made obsolete by one from a better engine that has no shared `key`. Rejecting every item one by one is slow, and leaves the batch in the sidebar with nothing in it to review.

The options considered:

- **Reject all.** Mark every pending item rejected. This keeps a record of the decision, but the batch stays listed, and a batch whose items are all decided is clutter.
- **Delete the batch.** Remove the batch and its items. The record of which items were accepted or rejected goes with it, but the annotations made from accepted items do not.

## Decision

- `DELETE /x/suggestion-batches/{id}` removes a batch and all its items, whatever their status.
- Only members of the batch's group may delete it, checked in SQL against the caller's group principals, as for reads (ADR 0006, ADR 0037). A suggester, who is not a member (ADR 0038), cannot. Neither can a request made with an access token, because no scope names the operation.
- Annotations made from accepted items stay. They are ordinary annotations, and the items only pointed at them.
- The sidebar offers this as "Discard all" on a batch.

## Consequences

- A curator clears an unwanted batch in one step.
- Deleting a batch loses which of its items were accepted or rejected, and by whom. An annotation made from an item still names the model in its body's `creator` (ADR 0034), so provenance of accepted content survives.
- An engine cannot clean up after itself except by rerunning with a `key`, which only touches pending items. That is deliberate: discarding is a curator's call.
- If engines later need to withdraw batches, that is a new scope and an amendment to this decision, not an extension of `suggestions:write` by default.

## References

- ADR 0006, ADR 0034, ADR 0037, ADR 0038
- `apps/api/openapi.yaml` (`deleteSuggestionBatch`), `apps/api/src/suggestions/store.ts`
