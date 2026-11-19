# Variant IDs: lookup plan

**Status:** In progress. Steps 1–4 are prototyped on `claude/external-variant-id-lookup-wpqvc0` (section 8).

How CurAnno helps curators find the ClinGen Allele Registry ID (CAID), the ClinVar Variation ID and the gnomAD ID for a variant an article reports. The decisions are recorded in [ADR 0039](adr/0039-variant-lookup-through-the-api.md).

## 1. Goals

- A curator who has recorded a variant as the article gives it can look it up from the case-variant editor, see one or more candidates with what the Allele Registry knows about them, and fill `caid`, `clinVarId` and `gnomad` with one click.
- The lookup says what it had to assume, and points out what looks wrong in the article's description: a reference base that does not match the reference sequence, a protein change that does not follow from the cDNA change, a variant in a gene other than the gene of interest.
- A variant that cannot be resolved, such as a large deletion described only by its exons, can be marked `unresolvable`. It then stops showing up as missing an ID.
- The suggester can run the same lookup and put the IDs into a suggestion batch as looked up, not stated, for the curator to accept.
- Resolved IDs stay in each fact. Nothing is shared between facts except the API's cache.

### Not in this plan

- **Registering variants in the Allele Registry.** Curators have no Allele Registry accounts, and CurAnno does not register variants. A candidate the registry does not know gets a link to the registry's own page, where a curator with an account can register it.
- **A per-gene variant catalog** that would fill new facts from earlier ones.
- **Structural variants and copy-number changes.** Neither the registry nor this lookup handles them well. Curators mark them `unresolvable`.
- **Guessing HGVS from legacy names** (`IVS4+1G>A`, "exon 13 deletion") with a language model. Section 7 records how this could work.

## 2. Why the lookup is hard

The IDs are easy to find once the variant is written as valid HGVS against a reference sequence the registry knows. Articles rarely write it that way:

| The article gives | Example | What the lookup does |
| --- | --- | --- |
| HGVS on a current transcript | `NM_000257.4:c.1208G>A` | Asks the registry directly |
| The ClinVar-style name | `NM_000257.4(MYH7):c.1208G>A (p.Arg403Gln)` | Separates the gene and the protein change, then as above |
| A transcript without a version | `NM_000257:c.1208G>A` | Uses the MANE Select version if the accession is the gene's MANE transcript, and says so |
| An old transcript version | `NM_000257.2:c.1208G>A` | The registry does not know it. VariantValidator maps it to GRCh38 genomic HGVS, which the registry knows. When the two versions number the position differently (`NM_000256.2:c.772G>A` is `NM_000256.3:c.780G>A`), the same change on the current version is offered too, because articles often number against the current version but name an older one |
| A cDNA change with no transcript | `c.1208G>A` | Needs the gene. Uses its MANE Select transcript and says so |
| A protein change only | `p.Arg403Gln`, `R403Q` | Needs the gene. Asks the registry for the protein change on the MANE protein, which lists every registered cDNA change that produces it. Several candidates are possible |
| Genomic HGVS | `NC_000014.9:g.23429278C>T` | Asks the registry directly |
| A reference base that is wrong | `NM_000257.4:c.1208C>A` | No candidate. Reports the mismatch, which is worth a curator's note in itself |
| Anything else | `IVS4+1G>A`, "exon 3–5 deletion" | No candidate. Reports that the description was not understood |

## 3. Sources

All three were checked against live responses on 2026-11-19. Test fixtures in `apps/api/src/variants/fixtures/` are trimmed copies of those responses.

- **ClinGen Allele Registry** (`https://reg.genome.network`). `GET /allele?hgvs=` with no account. A known allele answers with its CAID (`@id`), its genomic and transcript alleles, the MANE Select consequence, and `externalRecords` linking ClinVar Variation IDs, ClinVar allele IDs, gnomAD v4 and dbSNP. A valid allele that nobody has registered answers with the blank id `_:CA`. A reference base mismatch is a 400 with `errorType: IncorrectReferenceAllele`, and a reference sequence it does not know is a 500 with the message "Unknown reference". `GET /gene?HGNC.symbol=` gives a gene's MANE Select RefSeq and Ensembl transcripts and proteins. A protein allele (`NP_…:p.`) answers with a `PA` id and `matchingRegisteredTranscripts`. The registry is the hub: one request answers all three fields.
- **VariantValidator** (`https://rest.variantvalidator.org`), only when the registry does not know the reference sequence. It maps an old transcript version to GRCh38 genomic HGVS and reports its own warnings.
- **ClinVar E-utilities** are not used. A search by HGVS matches words, not alleles: `NM_000257.4:c.1208G>A` finds three variations, two of them different alleles. The registry's ClinVar link is exact.

## 4. The resolver

A module in the API, `apps/api/src/variants/`, with the HTTP calls behind an injected `fetch` so that tests replay fixtures.

1. **Parse** (`parse.ts`, pure). Trim, and normalise arrows and `&gt;` to `>`. Take a gene from `NM_…(GENE):` and a protein change from a trailing `(p.…)`. Classify the rest as transcript HGVS, genomic HGVS, bare cDNA, protein change, or not understood. Turn one-letter amino acids into three-letter ones.
2. **Fill in the transcript.** For bare cDNA, a missing version or a protein change, get the gene's MANE Select transcript from the registry. The gene comes from the request, or else from the description.
3. **Ask the registry.** If it does not know the reference sequence, ask VariantValidator for GRCh38 genomic HGVS, then ask the registry again. For a protein change, fetch each matching registered allele.
4. **Build candidates.** Each has the CAID (absent if unregistered), the registry's title, the GRCh38 and MANE HGVS and protein change, the ClinVar Variation IDs, the gnomAD v4 ID and the dbSNP rs number.
5. **Check.** For each candidate, compare its gene with the gene of interest, and the protein change the article stated with the MANE protein change. Warn if it is unregistered, has no ClinVar record, or has more than one ClinVar variation.
6. **Cache** whole results in memory by request, for a day, up to a few thousand entries. Error results are not cached.

## 5. API

`GET /x/variants/resolve?q=&gene=` answers authenticated callers only, so that the API is not an open proxy to the registry. A deployment turns it off with `VARIANT_LOOKUP=off` (404). When the registry cannot be reached, the API answers 502.

```json
{
  "query": "c.1208G>A",
  "gene": "MYH7",
  "candidates": [
    {
      "caid": "CA010365",
      "title": "NM_000257.4(MYH7):c.1208G>A (p.Arg403Gln)",
      "registryUrl": "https://reg.genome.network/allele/CA010365",
      "geneSymbol": "MYH7",
      "hgvs": {
        "genomic": "NC_000014.9:g.23429278C>T",
        "transcript": "NM_000257.4:c.1208G>A",
        "protein": "NP_000248.2:p.Arg403Gln"
      },
      "clinVar": [{ "variationId": "14087", "url": "https://www.ncbi.nlm.nih.gov/clinvar/variation/14087/" }],
      "gnomad": "14-23429278-C-T",
      "dbSnp": "rs121913624",
      "warnings": []
    }
  ],
  "warnings": [
    { "code": "transcript-assumed", "message": "No transcript was given, so the MANE Select transcript NM_000257.4 of MYH7 was used." }
  ],
  "steps": [
    { "service": "registry", "request": "NM_000257.4:c.1208G>A", "outcome": "found CA010365" }
  ]
}
```

Warning codes are part of the contract, and messages are for people: `not-understood`, `gene-needed`, `gene-unknown`, `transcript-assumed`, `version-assumed`, `version-needed`, `mapped`, `numbering-differs`, `not-mapped`, `reference-mismatch`, `protein-only`, `several-candidates`, `not-registered`, `no-clinvar`, `several-clinvar`, `gene-differs`, `protein-differs`. `steps` lists each request to an outside service, so a curator can see why the lookup chose what it chose.

## 6. Profile and interface

- `case-variant/1`, and the variants of `case-individual/1`, gain an optional `idSource` field: `stated` (the article gives the IDs), `looked up` (from this lookup, checked by a curator) or `unresolvable` (there are no IDs to find). The field is optional, so every stored body stays valid. ADR 0039 explains why this is an addition to `/1` rather than a `/2`. An unresolvable variant should have no `caid` or `clinVarId`. The editor clears them, but the schema does not say so: the suggester's projection for constrained decoders (`packages/extract/src/schema.ts`) refuses conditionals such as `if`.
- **Sidebar.** The case-variant editor gets a **Look up IDs** button under `variant`, where the profile marks the field with the `variantLookup` keyword (which names the sibling fields it reads and fills). It sends the variant and the fact's `geneName` (the sidebar has no document-level gene yet) and shows the candidates as cards, with warnings first. **Use** on a card fills `caid`, `clinVarId`, `gnomad` and `idSource: looked up`, and leaves `variant` as the article gave it. A **Mark unresolvable** button next to it clears `caid` and `clinVarId` and sets `idSource: unresolvable`. A candidate with no CAID and no ClinVar record has nothing to fill; the card says a curator with a registry account can register it. `clinVarId` is filled only when ClinVar has exactly one variation for the allele.
- **Suggester.** `variants DRAFT` calls the endpoint for each draft case-variant that has no IDs and is not marked unresolvable, with the fact's `geneName` or else the draft's gene. It fills `caid`, `clinVarId` (when ClinVar has one variation), `gnomad` and `idSource: looked up` only when there is a single registered candidate, the lookup assumed at most the MANE Select transcript or version, and the candidate has no warning but `no-clinvar`. Otherwise it fills nothing and adds a `notInBatch` line, starting "Variant lookup", with the candidates and the warnings, which a rerun replaces. Batch items have no note field, so `notInBatch` is where the curator reads this. The skill's rule is now: record IDs the article states with `idSource: stated`, and leave lookup to `variants`. The `suggestions:write` token scope allows the lookup.
- **Management site.** A group page lists the case-variant facts without IDs and not marked unresolvable, grouped by variant text, so that a curator works through the same variant in several articles at once.

## 7. Later

- **Legacy names.** A language model, through the skill, could rewrite `IVS4+1G>A` or an exon-numbered description as candidate HGVS, using the transcript the article names in its methods. Every candidate would go through the resolver, and only the resolver's answer could fill an ID.
- **A shared cache in Postgres**, if several API replicas make the in-memory cache miss too often.
- **Re-checking** variants that had no ClinVar record, after each ClinVar release.

## 8. Steps

1. This plan and ADR 0039.
2. The resolver, its fixtures and tests, `GET /x/variants/resolve`, configuration and the contract test. The `idSource` field.
3. The sidebar's Look up and Mark unresolvable.
4. The suggester's `variants` subcommand and the skill change.
5. The management site's list of variants without IDs.
6. Documentation: the user guide, the operator guide (the outside hosts the API now reaches) and the suggester README.
