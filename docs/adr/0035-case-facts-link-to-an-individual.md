# 0035. Facts about a case individual are annotations that link to an individual annotation

**Status:** Proposed

**Date:** 2026-11-13

## Context

`case-individual/1` records everything about one individual in one body. Curators anchor it where the individual is first described and copy facts from the rest of the article into it. As a result, most of the values have no passage of their own, and a model reading one chunk at a time cannot quote the passages for a whole individual.

The options considered:

- **One annotation per fact, linked by the individual's label alone.** This is simple, but labels vary across an article ("the proband", "II-1", "a 12-year-old boy"), so matching facts to individuals by label becomes guesswork.
- **One annotation per fact, linked to an annotation of the individual.** Chosen. The link survives varied wording, and the label is repeated beside it so that a reviewer can read a fact on its own.
- **Facts as additional bodies on one annotation, each with its own target.** The W3C model does not allow a body to have its own target.

## Decision

- An individual is introduced by an `individual/1` annotation, anchored where the article first describes them, with the label the article uses (`case`).
- Each fact is its own annotation, anchored on the passage that states it, with one of these profiles: `case-variant/1`, `case-phenotypes/1`, `case-family/1`, `case-testing/1` or `case-disease/1`. Every fact body has:
  - `individual`, the IRI of the individual's annotation;
  - `case`, the individual's label.
- A fact covers one individual. A passage about several individuals gets one annotation per individual, all with the same quote.
- A new profile keyword, `annotation`, marks a link field: `{"profile": "<IRI>", "label": "case"}`.
  - `profile` is the profile the linked annotation has.
  - `label` names the field that holds the label, both in this profile and in the linked one.
  - Like `ontology`, the keyword only annotates: validation checks that the value is an IRI, not that the annotation exists.
- A new root-level keyword, `derived: true`, marks a profile whose bodies are computed rather than written. Editors and the suggestion form do not offer it. `case-individual/1` gets it, and stays registered so that existing bodies remain valid.

## Consequences

- Each value can be traced to its own passage, and a fact can be extracted from one chunk.
- A fact depends on an annotation it does not control. That annotation can be deleted, or be one the reader cannot see, and the server does not check the link. Clients must show such a fact as unlinked.
- Curators make more annotations, and the individual has to exist before its facts can link to it. Extraction becomes two passes (ADR 0036, and section 4 of the plan).
- Repeating the label means that renaming an individual leaves old labels in its facts. The link is what counts, and the label is there for reading.

## References

- [docs/case-facets-plan.md](../case-facets-plan.md)
- [Web Annotation Data Model](https://www.w3.org/TR/annotation-model/)
- ADR 0016, ADR 0031, ADR 0032
