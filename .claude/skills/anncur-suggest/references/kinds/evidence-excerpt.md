# evidence-excerpt

A passage that is evidence of a kind, not tied to an individual: functional assays, population data, computational predictions, or segregation analysed across families. ClinGen tags variant-level experimental work `ExperimentalAssay`.

- **`kind`** (required): a short word or phrase for the kind of evidence, for example `functional` (assays, models), `population` (frequencies, cohorts), `computational` (in-silico predictions) or `segregation`.
- **`identifiers`**: CURIEs for what it concerns, as the article states them, for example "HGNC:7577" or "PMID:12345678". The gene's HGNC id may be added if the article gives it.
- **`summary`**: one or two sentences on what the passage shows.
- **`confidence`**: leave it out unless the authors state how strong the evidence is.
