# Case individuals as facts where they appear: plan

**Status:** Proposed, 2026-11-13.

Curators have recorded each case individual as one `case-individual/1` annotation, anchored where the individual first appears, holding everything found anywhere in the article. This plan splits that into small annotations, each anchored on the passage that states one kind of fact about one individual, and computes the whole-individual record from them.

## 1. Decisions taken

- **Facts link to an individual annotation.** Each individual gets an `individual/1` annotation where the article first introduces them. Every fact annotation names that annotation's IRI and repeats the individual's label (`case`, for example "II-1") so that a reviewer can read it without following the link.
- **One annotation per individual.** A passage about several individuals ("all three siblings had cardiomyopathy") gets one fact annotation per individual, each with the same quote.
- **The summary is computed, not stored.** The whole-individual record is derived from the saved facts whenever it is shown or exported, so it cannot drift from them. Its shape is the existing `case-individual/1`.
- Suggested facts become annotations only after review, as now (ADR 0032), so the summary is built from reviewed or hand-made facts only.

## 2. Profiles

Each fact profile has two required fields, `individual` (an annotation IRI) and `case` (the label), plus its own fields:

| Profile | Fields | Summary fields filled |
| --- | --- | --- |
| `individual/1` | `case`, `previouslyPublished`, `supplementalData` (no link) | the same |
| `case-variant/1` | `geneName`, `variant`, `clinVarId`, `caid`, `gnomad`, `variantEvidence` | one item of `variants` |
| `case-phenotypes/1` | `present`, `absent` (HPO lists), `course` (onset and progression) | `casePresentingHpos`, `caseNotHpos` |
| `case-family/1` | `familyInfo` | `familyInfo` |
| `case-testing/1` | `casePreviousTesting`, `genotypingMethod` | the same |
| `case-disease/1` | `diseaseAssertion` | `diseaseAssertion` |

The link field uses a new profile keyword, `annotation: { profile: "<individual/1 IRI>" }`, which validates as an IRI. In the sidebar it tells the editor to offer a picker of the document's `individual/1` annotations. Picking one fills `case` from it, and the label can still be edited.

`case-individual/1` stays registered so that existing annotations remain valid and readable. It is no longer offered for new annotations or for suggestions: a profile flag such as `derived: true` hides it from the pickers.

## 3. The computed summary

A function in `packages/model`, `summarizeIndividuals(annotations)`, takes the annotations a reader can see on a document. It groups the fact annotations by `individual` and returns one summary per individual:

- a `case-individual/1` value, built as follows:
  - `case` comes from the individual annotation.
  - List fields are the union of the facts' lists.
  - Each `case-variant/1` fact adds one item to `variants`.
  - When several facts fill the same text field, their distinct values are joined, and the field is marked as coming from several sources.
- a source annotation IRI for each field, so that the sidebar can scroll from a summary field to the passage it came from.
- the result of validating the summary against `case-individual/1`. An individual with no variant fact fails `minItems`, which is a useful way to say that it is incomplete.

Serialised for export, a summary is an annotation whose targets are the individual annotation and the fact annotations (the W3C model allows an annotation to be a target). Its body is the `case-individual/1` value, and the body's `creator` is a `Software` agent named `curanno-summary`.

The sidebar gets an **Individuals** view listing the summaries. A fact whose individual is missing, because it was deleted or the reader cannot see it, is listed as unlinked.

Because a summary is computed from what the reader can see, two readers can see different summaries of the same individual. That follows from computing it, and an export inherits it.

## 4. Extraction

The extraction runs in two passes:

1. **Individuals.** A run with `individual/1` works as runs do today. The curator reviews and saves the individuals.
2. **Facts.** A run with a fact profile requires at least one saved individual on the document.
   - The pipeline puts the individuals' labels in the prompt and makes `case` an `enum` of those labels in the response schema, so the model can only name a known individual.
   - It leaves the `individual` field out of what the model sees, and the sidebar fills it from the label after the answer arrives.
   - A passage about several individuals comes back as one suggestion per individual. The existing de-duplication keeps them apart because their values differ.

Each fact profile is a separate run for now. One run that returns facts of several profiles, using `anyOf` over the fact schemas, would cut the number of requests per chunk, and can follow once the separate runs work.

## 5. Steps

0. Write two ADRs: fact annotations linked to an individual annotation, and summaries that are computed and not stored.
1. Profiles and the `annotation` keyword in `packages/model`, with tests. The `derived` flag hides `case-individual/1` from the pickers.
2. The editor's individual picker, which fills `case` from the chosen individual.
3. `summarizeIndividuals` and the sidebar's Individuals view.
4. Extraction support: the individuals' labels as a `case` enum, filling `individual` from the label, and requiring saved individuals for a fact run.
5. Evaluation:
   - score each fact profile against curated facts;
   - compare the computed summaries with the curators' existing whole-individual annotations, which double as a reference set.

## 6. Open

- `variantEvidence` and `gnomad` describe the variant, not the individual. They sit in `case-variant/1` for now. A variant-level annotation that several individuals' facts refer to could replace them later.
- `course` (onset and progression) has no field in `case-individual/1`, so it appears only in the fact itself. If that is not enough, it needs a `case-individual/2` summary shape.
- Many small annotations make for a long sidebar. Grouping the facts under their individual in the list may be needed.
