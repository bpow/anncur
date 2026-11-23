# 0036. Whole-individual summaries are computed from the facts, not stored

**Status:** Accepted (2026-11-23)

**Date:** 2026-11-13

## Context

With facts annotated where they appear (ADR 0035), curators and downstream tools still need one record per individual in the shape of `case-individual/1`.

The options considered:

- **Store a summary annotation that a curator writes or approves.** It could record judgments that the facts do not make, such as which disease assertion wins. But it drifts whenever a fact is added, edited or deleted, and it needs a rule for keeping it current.
- **Compute the summary from the facts whenever it is needed.** Chosen.

## Decision

- `summarizeIndividuals` in `packages/model` takes the annotations a reader can see. It returns one summary per `individual/1` annotation:
  - a `case-individual/1` value;
  - the facts that contributed to each field;
  - the result of validating the value against `case-individual/1`, which reports, for example, an individual with no variant.
- How fields are combined:
  - Text fields filled by several facts join their distinct values.
  - Phenotype lists are combined into one list.
  - Each `case-variant/1` fact adds one item to `variants`.
- Facts whose individual is not among the annotations are returned as unlinked.
- The summary is not stored. When serialised, it is an annotation whose targets are the individual annotation and its facts, with a `case-individual/1` body whose `creator` is the `Software` agent `anncur-summary`.

## Consequences

- A summary always agrees with the facts it was computed from.
- Two readers who can see different facts see different summaries. An export made by one reader has the same property.
- A judgment that belongs to the individual as a whole has nowhere to go except a fact. If one turns out to be needed, it is a new fact profile, not a stored summary.
- The rules for combining fields are code in the model package, and any client that shows summaries uses them.

## References

- [docs/case-facets-plan.md](../case-facets-plan.md)
- ADR 0035
