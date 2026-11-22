# Linked facts and suggestions from outside the sidebar: plan

**Status:** Proposed, 2026-11-15. Part 1 revises ADR 0035 and the case facts plan ([case-facets-plan.md](case-facets-plan.md)) before they are accepted, and is implemented on `feat/case-facets-plan` (see the status note at the end). Parts 2–6 are new.

The case facts work splits a case individual into small annotations, but getting them into the system takes too many steps. The curator saves individuals, then runs each fact profile separately, links each fact, and reviews everything as it arrives. Model runs are slow, and they can only run in a sidebar that is open on the document.

This plan does three things:

- It lets one fact name several individuals.
- It makes linking facts to individuals cheap when curating by hand.
- It lets a process outside Anncur run engines over many documents, for example manuscripts from PubMed Central overnight, and post the results as suggestions that a group reviews later.

## 1. Decisions taken

- **A fact names a list of individuals.** `individuals: [iri…]` replaces `individual` plus `case`. A passage about three siblings gives one annotation, not three. When one individual's facts turn out to differ, a reviewer can split that individual off into its own copy of the annotation.
- **Labels are not stored in facts.** A fact's labels come from the linked individual annotations whenever it is shown, so renaming an individual cannot leave old labels behind.
- **Suggestions are stored on the server, as batches that belong to a group.** Any member of the group can review a batch. This replaces ADR 0032's rule that suggestions live only in the sidebar's memory. The sidebar's own runs post batches too, so there is one review path.
- **Anncur only receives batches.** It does not schedule jobs, choose engines or hold document text. An engine runs wherever and whenever its operator likes, and posts results through the public API. Document text still never reaches the server: a batch holds quotes, as any annotation does.
- **A batch can link its own items.** An item has a local id (`_:i1`). A link field may name a local id or an existing annotation's IRI. Local ids become IRIs when the items are accepted. This is what lets one batch carry individuals and their facts without a review in between, and it is generic: the API knows about link fields, not about individuals.
- **Engines authenticate with personal access tokens.** Tokens are issued by the API, scoped and expiring, and work the same with the embedded issuer and with an external provider. Bulk engines use service accounts rather than a person's token.
- **The bulk engine lives in this repository but behind the API.** It imports `@anncur/model`, `@anncur/extract` and `@anncur/api-client` only. What makes it independent is the batch contract in the OpenAPI document, so an engine written in another language is just as good a client.

## 2. Part 1: facts that name several individuals

### Profiles

The five fact profiles (`case-variant/1`, `case-phenotypes/1`, `case-family/1`, `case-testing/1`, `case-disease/1`) replace `individual` and `case` with:

```json
"individuals": {
  "type": "array",
  "minItems": 1,
  "uniqueItems": true,
  "items": { "type": "string", "pattern": "<IRI pattern>" },
  "annotation": { "profile": "<individual/1 IRI>", "label": "case" }
}
```

- The `annotation` keyword may sit on a string property or on an array of strings. `label` now names only the field in the *linked* profile.
- A fact needs `individuals` and at least one other property, so `minProperties` drops from 3 to 2.
- `individual/1` keeps `case`.
- The profiles stay at `/1` and change in place: nothing outside this branch uses them yet.

### Extraction

- The model's view of a fact replaces the link with `cases: [label…]`, an array whose items are an `enum` of the saved individuals' labels.
- The pipeline maps the labels back to IRIs.
- Prompt version 3 drops the "one suggestion per individual" line and instead asks the model to list every individual the passage covers.

### Summaries

`summarizeIndividuals` groups facts by each member of `individuals`. A fact whose list includes an individual the reader cannot see is reported as partly linked: it shows the IRIs it could not resolve, and it still counts toward the individuals it can.

### Sidebar

- The link field is a picker that allows several choices, shown as chips with the individuals' labels. An IRI that does not resolve shows as "unlinked".
- **Split** on a chip copies the fact for that individual alone and removes the individual from the original. The copy's body `creator` follows ADR 0034's rule for an edited value: the original creators plus the curator.

### Current individual

The Individuals view can mark one or more individuals as current. While that is set:

- the composer prefills link fields with them and shows them as a chip in its header;
- accepting a suggestion with an empty link fills it the same way.

The current selection is cleared when the page changes.

### Evaluation

`eval --facts` expands each fact into one fact per individual before scoring, so its results stay comparable with the first run.

### Documents

- Revise ADR 0035 in place (it is still Proposed): the list of individuals, labels derived when shown, and the split action.
- Add a status note to the case facts plan that points here.

## 3. Part 2: suggestion batches

### Resource

`POST /x/suggestion-batches`:

```jsonc
{
  "group": "<group id>",
  "document": { "uris": ["https://doi.org/…", "https://pmc.ncbi.nlm.nih.gov/articles/PMC…/"], "title": "…" },
  "engine": { "name": "anncur-extract", "version": "0.3.0", "nickname": "qwen3.6-35b / prompt 3" },
  "key": "optional rerun key",
  "items": [
    { "id": "_:i1",
      "target": { "selector": [{ "type": "TextQuoteSelector", "exact": "…", "prefix": "…", "suffix": "…" },
                               { "type": "TextPositionSelector", "start": 1200, "end": 1260 }] },
      "body": { "profile": "<individual/1 IRI>", "value": { "case": "II-1" } } },
    { "id": "_:f1", "target": { … },
      "body": { "profile": "<case-phenotypes/1 IRI>", "value": { "individuals": ["_:i1"], "present": [ … ] } } }
  ]
}
```

- **Document.** The document is found or created by the same rules as `POST /x/documents` (ADR 0014), with one extra guard: identifiers a batch reports may create a document or add to one, but never merge two existing documents. A buggy engine must not be able to merge documents, since merging cannot be undone.
- **Validation.** Each item's value is validated against its profile on the server.
  - A link field also accepts `_:` ids.
  - Each local id must name an item in the batch whose profile is the one the link requires.
  - The links between items must not form a cycle.
- **Targets.** The quote selector is what anchors an item. A position selector is only a hint, because the engine's text (for example PMC XML) will not match the curator's page offset for offset.
- **Reruns.** A batch with the same (group, document, engine name, key) as an earlier one replaces that batch's pending items. Accepted and rejected items are kept.
- **Limits.** Configurable limits on the number of items per batch and on body size.

### Storage

- `suggestion_batches`: id, group, document, engine, key, creator, created.
- `suggestion_items`: batch, local id, target, body, status (`pending`, `accepted` or `rejected`), the annotation an accepted item became, and who decided and when.

Items are not annotations, so no annotation read path has to learn to skip them.

### Access

- Members of the group can list and read the group's batches and decide on their items.
- The batch's creator can read its own batches, to check what was received.
- Creating a batch needs either membership of the group or the new group role `suggester` (section 4).
- Every read of batches and items filters by group membership in SQL, as ADR 0006 requires for annotations. Add ACL tests for each new endpoint.

### Accepting

`POST /x/suggestion-batches/{id}/accept` takes a list of items, each optionally carrying an edited target or value, and in one transaction:

1. checks that every local id an item links to is either accepted in this call or was accepted earlier;
2. creates one annotation per item through the same code as `POST /annotations`, with the caller as the annotation's creator and the default sharing the sidebar would apply;
3. replaces local ids with the new annotation IRIs;
4. sets the body `creator`:
   - the batch's engine, as a `Software` agent (ADR 0034);
   - plus the curator as a `Person` when the value was edited;
5. marks the items as accepted.

`POST …/reject` marks items as rejected. Rejecting an individual also rejects the pending facts whose only link is that individual, and removes it from facts that name others.

### Events

Creating a batch and deciding items are sent on the event stream to the group's members, so an open sidebar shows new suggestions without a reload.

### ADRs

- A new ADR: suggestions are stored on the server as group-owned batches with links between their items. It amends ADR 0032.
- ADR 0034 gains the batch's engine as the source of the `Software` agent.

## 4. Part 3: tokens and service accounts

### Tokens

- Table `access_tokens`: id, user, name, scopes, SHA-256 of the secret, created, expires (required, at most one year), last used, revoked.
- A token has the form `cat_<id>_<secret>`, where the secret is 32 random bytes in base64url. The prefix lets secret scanners find leaked tokens, and the auth plugin uses it to tell a token from a JWT.
- The secret is shown only once, when the token is created.
- `installAuth` checks a `cat_` bearer before the JWT path. The caller it gets carries the token's scopes, and every route declares the scope it accepts. The only scope at first is `suggestions:write`: create batches and read one's own. Every other route refuses a token with 403.
- The site's **/me** page lists, creates and revokes a person's own tokens.

### Service accounts

- A user of kind `service` has no sign-in, cannot be given `is_admin`, and is managed by administrators on the site's users page, including its tokens.
- A group admin adds a service account to the group with the role `suggester`. That role can create batches for the group and nothing else: it gives no read access to the group's annotations.

### Logs

Authorization headers are already redacted. Also record the token id, but not the token itself, with each request.

### ADR

A new ADR: access tokens issued by the API, and service accounts. It records that a token is a long-lived credential, which is why tokens expire and carry narrow scopes.

## 5. Part 4: review in the sidebar

- When a document opens, the sidebar loads the pending batches of the caller's groups for that document.
- The **Suggestions** list groups items under the entities they link to, with each individual and its facts together:
  - **Accept all** on an individual accepts it with its facts in one call;
  - each item can still be edited, accepted or rejected on its own.
- The guest anchors items by quote. Items that do not anchor are listed under "Not found on this page", with their quote, to be rejected or anchored by hand on a selection.
- A pending item whose value and quote equal an annotation already on the page is shown as a duplicate and can be rejected in one click. The server does not check for this, since the duplicate may be one the engine cannot see.
- The Suggest panel's own runs post a batch for the chosen review group. A run with the individuals profile and the fact profiles together becomes one batch with links between its items, so there is no review in the middle. Pending suggestions survive a page reload.

## 6. Part 5: the bulk engine

`apps/suggester`, a Node CLI. A lint rule keeps it from importing `apps/*`.

```sh
suggester run --group <id> --endpoint URL --model NAME [--api-key-env VAR] \
  --pmcid PMC123 --pmcid PMC456 | --list ids.txt
```

1. **Fetch** each article's open-access text from PMC (the BioC JSON or JATS XML), with its DOI, PMCID and URLs.
2. **Normalize** the text with `packages/model`'s rules (ADR 0013), so that quotes match the curator's page as often as possible.
3. **Extract** in one process:
   - run the individuals profile;
   - give each individual a local id;
   - run the fact profiles with the individuals' labels as the `cases` enum.

   This is the pipeline `eval.ts` already runs in Node.
4. **Post** one batch per document, keyed by engine version and prompt version, so a rerun replaces it.

Further details:

- **State.** A local state file records the documents already posted at the current key, so an interrupted run can resume and a cron job can run nightly.
- **Scheduling.** Off-peak scheduling is the operator's choice (cron or a Kubernetes CronJob). The CLI has no scheduler.
- **Endpoints.** An endpoint key from an environment variable covers hosted models (extraction plan, section 7). The sidebar's no-credential rule is unchanged, because the key never reaches a browser.
- **Evaluation.** A new metric: of the quotes taken from PMC text, the share that anchor in the guest's text of the PMC page and of the publisher's PDF. Below about 90%, the matching rules need work before bulk runs are worth reviewing.

## 7. Part 6: worklist on the site

- A **Suggestions** page for each group lists the documents with pending items: counts by profile, engine, date, and a link that opens the document in the viewer or extension.
- From there a member can also reject a whole batch, for example a bad engine run.

## 8. Steps

On `feat/case-facets-plan`, before it merges:

1. Profiles with `individuals`, the keyword on arrays, `summarizeIndividuals`, and their tests.
2. Extraction with the `cases` enum and prompt 3, plus the expanded scoring in `eval --facts`.
3. The picker that allows several choices, labels derived when shown, the split action, and the current individual.
4. Revise ADR 0035 and add a status note to the case facts plan.

Then on separate branches:

5. `feat/suggestion-batches`:
   - the batch ADR;
   - migrations, routes and OpenAPI;
   - validation with local ids, accept and reject, events, ACL tests;
   - the regenerated API client, in a separate commit.
6. `feat/batch-review`: the sidebar review grouped by individual, and the Suggest panel posting batches.
7. `feat/access-tokens`: the ADR, tokens, scopes, service accounts, the `suggester` role, and the pages on /me and the users page.
8. `feat/suggester`: the CLI, PMC fetching, state and the anchoring metric.
9. `feat/suggestion-worklist`: the site page.

Steps 5 and 7 are independent. Step 6 needs 5, and step 8 needs 5 and 7.

## 9. Open

- **Export of facts.** With labels no longer stored, an exported fact has only IRIs. The export could add each individual's label, or include the individual annotations alongside.
- **Recording the batch on the annotation.** An accepted annotation could name the batch item it came from, as `prov:wasDerivedFrom` in the extension context. That would make it possible to audit which engine runs led to which annotations.
- **Entities beyond individuals.** Variant-level facts (`variantEvidence`, `gnomad`; case facts plan, section 6) are the next candidate for an entity that other facts link to. Batches already handle it.
- **Engine confidence.** Should items carry a score that the review list can sort by? Not until an engine produces one that means something.
- **Retention.** How long rejected items, and batches whose items are all decided, are kept.

## 10. Status note (2026-11-15)

Part 1 (steps 1–4) is done. What differs from section 2:

- **No `cases` field.** The model's view keeps the field name `individuals`, with labels from the `enum` in place of IRIs, and the pipeline swaps the labels for IRIs. A label that names no saved individual is dropped; a suggestion left with none fails validation.
- **No "partly linked" report.** `summarizeIndividuals` counts a fact toward every individual it names that the reader can see, and lists it as unlinked only when it names none. Unresolved links show in the fact itself, as "not on this page".
- **Split is on the card.** A saved fact naming several individuals has a **Split…** menu on its card, not on the editor's chips. The copy is shared like the original, and is made before the original changes.
- **Current individuals.** A **Current** checkbox on each individual in the Individuals view. Choosing a fact profile in the editor starts the value linked to them. There is no chip in the composer header; the editor's Individuals field shows them. Suggestions always arrive linked, so nothing fills them on acceptance.
- **Evaluation needs no change.** `eval --facts` scores the computed summaries, which already group facts by individual.

## 11. Status note (2026-11-15): Part 2

Step 5 is done on `feat/suggestion-batches`, in ADR 0037 (Proposed). What differs from section 3:

- **Items carry a `selector`, not a `target`.** The source is the batch's document, so an item holds only a selector or a list of them.
- **The client builds the accepted annotation.** `POST …/accept` takes, for each item, the annotation the client wants, or `existing`, the IRI of a saved annotation the item stands for, such as an individual already on the page. The server replaces local ids, creates the annotations and records the decisions in one transaction. Purpose, motivation and the body's `creator` therefore stay with the sidebar's rules (ADR 0034) and are not duplicated on the server. The server does not set the engine as creator.
- **No new document guard.** `POST /x/documents` already never merges documents (its links that name another document are logged, not merged), and batches use the same code.
- **Access is by group membership only.** The `suggester` role and reading one's own batches without membership come with Part 3.
- **No events yet.** The sidebar finds batches when it loads a document (`GET /x/suggestion-batches?uri=…&pending=true`).
- **Rejection cascades only through required link fields.** An item left with an empty required link field is rejected too; one whose link field is optional keeps its other values.
- **Limits:** 2000 items per batch and 500 per accept call, in the OpenAPI document. `DELETE /x/suggestion-batches/{id}` removes a batch; annotations made from it stay.

## 12. Status note (2026-11-15): Part 3

Step 7 is done on `feat/access-tokens`, in ADR 0038 (Proposed). What differs from section 4:

- **Token routes are under the user:** `/x/users/{id}/tokens`. People manage their own tokens there and on **/me**. Administrators list and revoke anyone's, and make tokens only for service accounts.
- **A token never carries administration,** whoever owns it, and its scope's operations are listed in `apps/api/src/auth/tokens.ts`. `suggestions:write` allows `GET /x/me`, and posting, listing and reading suggestion batches.
- **Service accounts** are users with `is_service`, recorded with an issuer that is not a URL (`urn:x-anncur:service-account`), so no token can sign them in. `POST /x/users` creates one.
- **Suggesters.** `suggester` is a third group role. It is left out of the caller's principals, so it grants nothing that membership does. A suggester cannot see the group's page or members, and sees only the batches it posted.
- **Merging accounts** moves tokens a person made for others, drops the loser's own tokens, and ranks roles as suggester, member, admin.

## 13. Status note (2026-11-15): Part 4

Step 6 is done on `feat/batch-review`. What differs from section 5:

- **Grouping.** Each item that others link to heads a group. An item linking to several heads goes under the first. Items linking to nothing in the batch are listed together after the groups.
- **"Same as"** on a head accepts it as an individual already saved on the page (`existing`), so a rerun's individuals can be joined to earlier ones.
- **Saving one item** also saves the pending items it links to, so a fact never fails for want of its individual.
- **Not found on this page** is a note on the item's card, not a separate section.
- **Duplicates** are only items with no local links whose profile and value equal a saved annotation's. They get a note; rejecting them is still a click.
- **Sharing.** Saved suggestions start out readable by the batch's group; the review form can change that. The API now names the group in a batch summary (`groupName`).
- **The Suggest panel** ticks several kinds, puts the kinds others link to first, links facts to the run's own individuals by local id, and posts one batch for a chosen group. The sidebar uses the same persistent batch review for suggestions from every engine.
- **Events.** New batches still do not arrive on the event stream. The review reloads when the page or the account changes, and after the panel posts.

## 14. Status note (2026-11-16): Parts 5 and 6

Step 8 is done on `feat/suggester`, and step 9 on `feat/suggestion-worklist`. What differs from sections 6 and 7:

- **Shared batch building.** The run order, local ids and links between kinds moved from the sidebar into `@anncur/extract` (`extractBatch`). The sidebar and the suggester build batches with the same code.
- **The suggester** is `apps/suggester`, run with `pnpm --filter @anncur/suggester suggest`.
  - It reads PMC's BioC JSON, by id from the BioC service or from a file, one block per passage, leaving out the references.
  - It posts only a quote selector per item, with no offsets.
  - Profiles are named by IRI or by its end (`individual`, `case-family/1`), and computed profiles are refused.
  - A lint rule keeps it to `@anncur/model`, `@anncur/extract` and `@anncur/api-client`.
- **The token scope** also allows `GET /x/profiles` and ontology term search. Both are public reads, which the engine needs to fill and resolve values.
- **Endpoint keys.** An endpoint may carry an API key, sent as a bearer token. The sidebar never sets one.
- **The anchoring metric** (the share of PMC quotes that anchor on the PMC page and in the publisher's PDF) is not built. Run the suggester on a few articles and open them in the sidebar to see how many items show "Not found on this page".
- **The worklist** is the site's **Suggestions** page. For each of the caller's groups it lists the documents with pending items, linked to the document's own URL, with who suggested them, the counts, and **Discard**. Batch summaries now carry `documentUri` and `documentTitle`. Counts by profile are not shown.
