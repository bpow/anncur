# 0038. The API issues scoped access tokens, and service accounts post suggestions for groups

**Status:** Proposed

**Date:** 2026-11-15

## Context

Engines that run outside the sidebar post suggestion batches (ADR 0037). They run unattended, often on a schedule, so they cannot sign in through a browser. They should be able to do that and nothing else: an engine's credential sits in a cron job's environment, and a leaked one should not read a group's annotations.

The options considered:

- **The identity provider's machine credentials** (Zitadel service users, the client credentials grant). This reuses the provider. But the embedded issuer (ADR 0028) has no such thing, so it would be built twice. The provider also knows nothing of our scopes.
- **The OIDC device flow for a command-line engine acting as a person.** This suits a person running a tool now and then, not a nightly job. It also needs support in both issuers.
- **Tokens the API issues itself.** Chosen. They work the same with every issuer.

## Decision

- **Tokens.** An access token belongs to a user and has a name, a list of scopes and an expiry of at most a year.
  - It has the form `cat_<id>_<secret>`: the id is 32 hex digits, and the secret is 32 random bytes in base64url.
  - Only the SHA-256 of the secret is stored, and the secret is shown once, when the token is made.
  - The prefix lets secret scanners recognise a leaked token, and lets the API tell a token from a JWT without trying to verify it.
- **Checks on every request.** A token is checked against the database each time. Revoking it, or disabling its user, takes effect at once.
- **Scopes.** A request made with a token may reach only the operations its scopes allow; anything else is 403. The only scope at first is `suggestions:write`. It allows `GET /x/me`, the public reads an engine needs (profiles and ontology term search), and posting, listing and reading suggestion batches. Later, `annotations:read` allows reading, searching and following the event stream of what the token's user may see, and `annotations:write` adds creating, editing, sharing and deleting annotations as that user. A migration from Hypothesis can use it; what it posts is recorded as the token's user's, made at the time of the migration, not as the original author's.
- **Who manages tokens.** People make and revoke their own tokens. Administrators make tokens for service accounts, and may list and revoke anyone's.
- **Service accounts** are users that administrators create, with no way to sign in: no identity, password or linked provider. They can never be administrators.
- **The `suggester` group role.** A group administrator gives it to a service account or a person.
  - A suggester may post batches for the group and read the batches they posted.
  - It is not membership: the group is not among the suggester's principals, so its annotations, members and other batches stay out of reach. They also cannot decide on items.

## Consequences

- One engine credential works with the embedded issuer and with any external provider.
- A token is a long-lived secret held outside the browser, which is why tokens expire, carry narrow scopes and are checked on every request.
- Each request with a token costs a database lookup, which is fine for an engine posting a batch per document.
- Each new scope must list its operations in the API's code, and a new operation is unreachable by tokens until a scope names it.
- A suggester learns the group's id and name, which it needs in order to post, and nothing else about the group.

## References

- [docs/external-suggestions-plan.md](../external-suggestions-plan.md), section 4
- ADR 0006, ADR 0026, ADR 0028, ADR 0037
