# Individuals and facts

Anncur records a case as several small annotations, each anchored on the passage that states it (ADR 0035):

- **One `individual`** per person, quoted where the article first describes them, with `case` as their label.
- **Facts** about them, each one quoted where the article states it, and naming its individuals in `individuals` by their local ids:
  - `case-variant`
  - `case-phenotypes`
  - `case-family`
  - `case-testing`
  - `case-disease`

Anncur then computes the whole-individual record, ClinGen's Case-Individuals template, from the facts. You never write that record yourself, because the `case-individual` kind is computed.

## Rules

- **Facts belong to individuals.** Every fact names at least one individual of the same draft.
- **One fact per statement.** A sentence that says the same thing about several individuals is one fact naming them all: "All three siblings had cardiomyopathy" is one `case-phenotypes` fact naming three individuals. Split it only where what is said differs: "onset at 3 and 5 years respectively" makes two facts with the same quote.
- **One kind per fact.** A passage that states a phenotype and a family history gives one fact of each kind, which may share the quote.
- **Anchor on the evidence.** Quote the sentence that states the fact, not the individual's first mention, unless that is where the fact is stated.
- **Keep facts small.** Several facts of a kind for one individual are fine, and Anncur combines them. A variant fact holds one variant.
- **Relatives without the variant are not individuals.** They belong in a family history fact about the proband.

## A worked example

Passages:

> 4 · Patient 1, a 14-year-old boy, presented with exertional dyspnea and syncope during sport.
> 5 · Exome sequencing identified a heterozygous MYH7 variant, NM_000257.4:c.1208G>A (p.Arg403Gln), also carried by his affected father.
> 6 · His 11-year-old sister, Patient 2, had palpitations; she carried the same variant.

Draft items:

```json
[
  { "id": "_:i1", "kind": "individual", "passage": 4,
    "quote": "Patient 1, a 14-year-old boy, presented with exertional dyspnea and syncope during sport.",
    "value": { "case": "Patient 1, male, 14 years" } },
  { "id": "_:i2", "kind": "individual", "passage": 6,
    "quote": "His 11-year-old sister, Patient 2, had palpitations; she carried the same variant.",
    "value": { "case": "Patient 2, female, 11 years" } },
  { "id": "_:p1", "kind": "case-phenotypes", "passage": 4,
    "quote": "Patient 1, a 14-year-old boy, presented with exertional dyspnea and syncope during sport.",
    "value": { "individuals": ["_:i1"], "casePresentingHpos": ["Exertional dyspnea", "Syncope"] } },
  { "id": "_:v1", "kind": "case-variant", "passage": 5,
    "quote": "Exome sequencing identified a heterozygous MYH7 variant, NM_000257.4:c.1208G>A (p.Arg403Gln), also carried by his affected father.",
    "value": { "individuals": ["_:i1"], "geneName": "MYH7",
               "variant": "NM_000257.4:c.1208G>A (p.Arg403Gln)", "variantEvidence": "Heterozygous." } },
  { "id": "_:v2", "kind": "case-variant", "passage": 6,
    "quote": "His 11-year-old sister, Patient 2, had palpitations; she carried the same variant.",
    "value": { "individuals": ["_:i2"], "geneName": "MYH7",
               "variant": "NM_000257.4:c.1208G>A (p.Arg403Gln)" } },
  { "id": "_:t1", "kind": "case-testing", "passage": 5,
    "quote": "Exome sequencing identified a heterozygous MYH7 variant, NM_000257.4:c.1208G>A (p.Arg403Gln), also carried by his affected father.",
    "value": { "individuals": ["_:i1"], "genotypingMethod": "Exome sequencing" } },
  { "id": "_:f1", "kind": "case-family", "passage": 5,
    "quote": "Exome sequencing identified a heterozygous MYH7 variant, NM_000257.4:c.1208G>A (p.Arg403Gln), also carried by his affected father.",
    "value": { "individuals": ["_:i1"], "familyInfo": "Affected father carries the same variant." } },
  { "id": "_:p2", "kind": "case-phenotypes", "passage": 6,
    "quote": "His 11-year-old sister, Patient 2, had palpitations; she carried the same variant.",
    "value": { "individuals": ["_:i2"], "casePresentingHpos": ["Palpitations"] } }
]
```

Patient 2's variant is a fact of its own on passage 6, which is where the article states it. Passage 5 is about Patient 1 alone, so a fact anchored there may not name Patient 2. The father is not an individual here: the article reports his variant, but nothing else that the case template records. If it described him as a case of his own, he would be one.
