# 0035. Facts about a case individual are annotations that link to an individual annotation

**Status:** Proposed

**Date:** 2026-11-13

## Context

`case-individual/1` records everything about one individual in one body. Curators anchor it where the individual is first described and copy facts from the rest of the article into it. As a result, most of the values have no passage of their own, and a model reading one chunk at a time cannot quote the passages for a whole individual.

The options considered:

- **One annotation per fact, linked by the individual's label alone.** This is simple, but labels vary across an article ("the proband", "II-1", "a 12-year-old boy"), so matching facts to individuals by label becomes guesswork.
- **One annotation per fact, linked to an annotation of the individual.** Chosen. The link survives varied wording.
- **Facts as additional bodies on one annotation, each with its own target.** The W3C model does not allow a body to have its own target.

## Decision

- An individual is introduced by an `individual/1` annotation, anchored where the article first describes them, with the label the article uses (`case`).
- Each fact is its own annotation, anchored on the passage that states it, with one of these profiles: `case-variant/1`, `case-phenotypes/1`, `case-family/1`, `case-testing/1` or `case-disease/1`. Every fact body has `individuals`, a list of the IRIs of the individuals' annotations.
- A fact may cover several individuals. A passage that says the same thing about several of them is one annotation naming them all.
  - When one of them turns out to differ, a curator **splits** that individual off: the fact is copied for them alone and they are removed from the original. Both bodies then list the curator among their creators (ADR 0034).
  - A passage that says different things about different individuals ("onset at 3 and 5 years respectively") is still one annotation per individual, with the same quote.
- Facts do not store the individuals' labels. Readers show each linked individual's own label.
- A new profile keyword, `annotation`, marks a link field, on a string or an array of strings: `{"profile": "<IRI>", "label": "case"}`.
  - `profile` is the profile the linked annotation has.
  - `label` names the field of the linked profile that holds its label.
  - Like `ontology`, the keyword only annotates: validation checks that each value is an IRI, not that the annotation exists.
- A new root-level keyword, `derived: true`, marks a profile whose bodies are computed rather than written. Editors and the suggestion form do not offer it. `case-individual/1` gets it, and stays registered so that existing bodies remain valid.

## Consequences

- Each value can be traced to its own passage, and a fact can be extracted from one chunk.
- A fact depends on annotations it does not control. They can be deleted, or be ones the reader cannot see, and the server does not check the links. Clients must show such links as unresolved, and a fact none of whose individuals resolve as unlinked.
- Curators make more annotations, and the individual has to exist before its facts can link to it. Extraction becomes two passes (ADR 0036, and section 4 of the plan).
- With one annotation for several individuals, a reviewer accepts, corrects or deletes a shared fact once, and there are no copies to drift apart. The cost is that a fact that is right for some of its individuals and wrong for others needs a split before it can be corrected.
- Without stored labels, renaming an individual renames it everywhere. But a fact read on its own, outside the sidebar or an export that includes its individuals, shows only IRIs.
- Revised on 2026-11-15, while still Proposed: facts first had one `individual` and a copy of its `case` label ([docs/external-suggestions-plan.md](../external-suggestions-plan.md), section 2).

## References

- [docs/case-facets-plan.md](../case-facets-plan.md)
- [Web Annotation Data Model](https://www.w3.org/TR/annotation-model/)
- ADR 0016, ADR 0031, ADR 0032
