# 0039. Variant IDs are looked up through the API in the ClinGen Allele Registry

**Status:** Proposed

**Date:** 2026-11-19

## Context

ClinGen's case template asks for a ClinVar Variation ID or an Allele Registry ID (CAID) for each variant. Articles rarely give either, and they describe variants in many forms: HGVS on an old transcript, a cDNA change with no transcript, a protein change only. Curators look IDs up by hand in several sites. The suggester skill is told never to fill these fields, so that a model does not invent IDs (docs/claude-skills-plan.md, section 8).

Unlike HPO (ADR 0031), the data cannot reasonably be imported: the registry holds billions of alleles, and mapping between transcripts and genome builds needs reference sequences. So the lookup has to call an outside service.

The options considered for where the call is made:

- **From the browser.** The sidebar's `connect-src` would have to allow the registry, and the suggester would need its own copy of the logic.
- **Through the API.** One implementation for the sidebar and the suggester, one cache for all curators, and a single place where a deployment turns it off.

For the source:

- **ClinVar E-utilities.** Search by HGVS matches words, not alleles, and returns other variants at the same position.
- **The ClinGen Allele Registry.** Allele lookup needs no account, it normalises HGVS, and each allele links its ClinVar Variation, gnomAD and dbSNP records. It does not know old transcript versions.
- **VariantValidator.** It maps old transcript versions to the genome, but does not give IDs.

For recording a variant with no IDs to find, the case-variant profile could gain `/2`, or add an optional field to `/1`.

## Decision

- The API serves `GET /x/variants/resolve?q=&gene=` to authenticated callers. It asks the Allele Registry, and VariantValidator only when the registry does not know the reference sequence. It returns candidates with their warnings and the requests it made. It never chooses for the curator.
- Results are cached in memory for a day. A deployment can turn the lookup off with `VARIANT_LOOKUP=off`.
- CurAnno does not register alleles. An unregistered candidate links to the registry.
- `case-variant/1` gains an optional `idSource` field (`stated`, `looked up`, `unresolvable`). The change is made to `/1` because it is additive: every stored body still validates, and a reader that ignores the field reads the IDs as before. The rule in docs/body-profiles.md is against incompatible changes, and this is not one. A reader that validates new bodies against an old copy of the schema would reject the field. No such reader is known.

## Consequences

- Variant descriptions, which are public, and the gene of interest go to reg.genome.network and rest.variantvalidator.org. Document text and annotations do not. Operators must allow these hosts, or turn the lookup off.
- The lookup depends on services we do not run. When they are down, the editor says so and curators type IDs by hand as before.
- Each API replica has its own cache. That is enough while one replica serves the API.
- Facts can now say where their IDs came from, and that a variant has none, so that later lists of variants without IDs leave out the ones curators have given up on.

## References

- [docs/variant-ids-plan.md](../variant-ids-plan.md)
- [ClinGen Allele Registry](https://reg.clinicalgenome.org)
- [VariantValidator REST API](https://rest.variantvalidator.org)
- ADR 0016, ADR 0031
