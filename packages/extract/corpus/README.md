# Evaluation corpus

Cases for `pnpm --filter @curanno/extract eval` (`scripts/eval.ts`). Each case is a pair of files with the same name:

- `<name>.html`: the document. Its body is the scope, normalized by the text model with the markup rules (no computed styles), so block starts come from element names.
- `<name>.json`: `{ "profile": "<profile IRI>", "expected": [{ "quote": "...", "value": { ... } }] }`. Each `quote` must occur in the document. `value` holds the fields a curator would record; the CLI compares only the fields given here.

The cases here are synthetic: the documents were written for this corpus and describe no real individuals. They exercise the case-individual profile and are a starting point. Real open-access case reports, annotated by a curator, should replace or join them before results are compared between models (plan, section 3.3).

With `--facts`, the case-individual cases are run as facts instead (ADR 0035, 0036): one run for `individual/1`, one per fact profile with the individuals found, and the summaries computed from all suggestions are compared with `expected` by the individual's label (`case`) instead of by quote.
