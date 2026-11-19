/**
 * Finds the Allele Registry, ClinVar and gnomAD IDs for a variant as an article
 * gives it (docs/variant-ids-plan.md, ADR 0039). It asks the ClinGen Allele
 * Registry, and VariantValidator only when the registry does not know the
 * reference sequence. It returns candidates and never chooses for the curator.
 */
import { formatHgvs, parseVariant, normalizeProteinChange, type ParsedVariant } from './parse.js';

export type WarningCode =
  | 'not-understood'
  | 'gene-needed'
  | 'gene-unknown'
  | 'transcript-assumed'
  | 'version-assumed'
  | 'version-needed'
  | 'mapped'
  | 'not-mapped'
  | 'reference-mismatch'
  | 'protein-only'
  | 'several-candidates'
  | 'not-registered'
  | 'no-clinvar'
  | 'several-clinvar'
  | 'gene-differs'
  | 'protein-differs';

export interface LookupWarning {
  code: WarningCode;
  message: string;
}

export interface LookupStep {
  service: 'registry' | 'variantvalidator';
  request: string;
  outcome: string;
}

export interface VariantCandidate {
  /** Absent when the registry knows the allele but nobody has registered it. */
  caid?: string;
  title?: string;
  registryUrl?: string;
  geneSymbol?: string;
  hgvs: { genomic?: string; transcript?: string; protein?: string };
  clinVar: { variationId: string; url: string }[];
  gnomad?: string;
  dbSnp?: string;
  warnings: LookupWarning[];
}

export interface VariantResolution {
  query: string;
  gene?: string;
  candidates: VariantCandidate[];
  warnings: LookupWarning[];
  steps: LookupStep[];
}

export interface VariantResolverOptions {
  registryUrl: string;
  variantValidatorUrl: string;
  timeoutMs: number;
  fetch?: typeof fetch;
  /** How long a result is reused; one day by default. */
  cacheMs?: number;
  cacheSize?: number;
  now?: () => number;
}

/** The registry or VariantValidator could not be reached, or answered in a way we cannot read. */
export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}

/** The registry's page for an allele, for people rather than programs. */
const REGISTRY_PAGE =
  'https://reg.clinicalgenome.org/redmine/projects/registry/genboree_registry/by_caid?caid=';

/** Candidates fetched for a protein change, at most. */
const MAX_PROTEIN_CANDIDATES = 5;

interface RegistryAllele {
  '@id'?: string;
  communityStandardTitle?: string[];
  genomicAlleles?: { referenceGenome?: string; hgvs?: string[] }[];
  transcriptAlleles?: {
    geneSymbol?: string;
    hgvs?: string[];
    proteinEffect?: { hgvs?: string };
    MANE?: {
      maneStatus?: string;
      nucleotide?: { RefSeq?: { hgvs?: string } };
      protein?: { RefSeq?: { hgvs?: string } };
    };
  }[];
  aminoAcidAlleles?: {
    geneSymbol?: string;
    hgvs?: string[];
    matchingRegisteredTranscripts?: { '@id'?: string; hgvs?: string }[];
  }[];
  externalRecords?: {
    ClinVarVariations?: { variationId?: number | string }[];
    gnomAD_4?: { id?: string }[];
    dbSNP?: { rs?: number | string }[];
  };
}

interface RegistryError {
  errorType?: string;
  message?: string;
  description?: string;
}

interface RegistryGene {
  externalRecords?: {
    HGNC?: { symbol?: string };
    MANE?: {
      maneStatus?: string;
      nucleotide?: { RefSeq?: { id?: string } };
      protein?: { RefSeq?: { id?: string } };
    }[];
  };
}

interface ManeSelect {
  transcript: string;
  protein: string;
}

type Answer<T> = { ok: true; body: T } | { ok: false; status: number; error: RegistryError };

export class VariantResolver {
  private readonly fetch: typeof fetch;
  private readonly cache = new Map<string, { at: number; value: VariantResolution }>();
  private readonly cacheMs: number;
  private readonly cacheSize: number;
  private readonly now: () => number;

  constructor(private readonly options: VariantResolverOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.cacheMs = options.cacheMs ?? 24 * 60 * 60 * 1000;
    this.cacheSize = options.cacheSize ?? 5000;
    this.now = options.now ?? Date.now;
  }

  async resolve(query: string, gene?: string): Promise<VariantResolution> {
    const geneOfInterest = gene?.trim().toUpperCase() || undefined;
    const key = `${geneOfInterest ?? ''}\u0000${query}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.cacheMs) {
      // Refresh the entry's place, so the cache drops the least recently used first.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit.value;
    }
    const value = await new Lookup(this, query, geneOfInterest).run();
    this.cache.set(key, { at: this.now(), value });
    while (this.cache.size > this.cacheSize) {
      this.cache.delete(this.cache.keys().next().value!);
    }
    return value;
  }

  /** @internal */
  async get<T>(service: LookupStep['service'], url: string): Promise<Answer<T>> {
    let res: Response;
    try {
      res = await this.fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (err) {
      throw new UpstreamError(
        `${serviceName(service)} could not be reached: ${(err as Error).message}`,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new UpstreamError(`${serviceName(service)} answered ${res.status} without JSON`);
    }
    if (res.ok) return { ok: true, body: body as T };
    return { ok: false, status: res.status, error: body ?? {} };
  }

  /** @internal */
  registry(path: string): string {
    return `${this.options.registryUrl.replace(/\/$/, '')}${path}`;
  }

  /** @internal */
  variantValidator(hgvs: string): string {
    const base = this.options.variantValidatorUrl.replace(/\/$/, '');
    return `${base}/VariantValidator/variantvalidator/GRCh38/${encodeURIComponent(hgvs)}/mane_select?content-type=application%2Fjson`;
  }
}

function serviceName(service: LookupStep['service']): string {
  return service === 'registry' ? 'The Allele Registry' : 'VariantValidator';
}

/** One resolution: the warnings and steps it collects as it goes. */
class Lookup {
  private readonly warnings: LookupWarning[] = [];
  private readonly steps: LookupStep[] = [];
  private readonly genes = new Map<string, ManeSelect | undefined>();

  constructor(
    private readonly resolver: VariantResolver,
    private readonly query: string,
    private readonly geneOfInterest: string | undefined,
  ) {}

  async run(): Promise<VariantResolution> {
    const candidates = await this.find();
    return {
      query: this.query,
      ...(this.geneOfInterest ? { gene: this.geneOfInterest } : {}),
      candidates,
      warnings: this.warnings,
      steps: this.steps,
    };
  }

  private warn(code: WarningCode, message: string): void {
    this.warnings.push({ code, message });
  }

  private async find(): Promise<VariantCandidate[]> {
    const parsed = parseVariant(this.query);
    if (!parsed.ok) {
      this.warn('not-understood', parsed.reason);
      return [];
    }
    const variant = parsed.variant;
    if (variant.coordinate === 'p') return this.findProtein(variant);

    const hgvs = await this.nucleotideHgvs(variant);
    if (!hgvs) return [];
    let allele = await this.allele(hgvs);
    if (allele === 'unknown-reference') {
      const genomic = await this.mapToGenome(hgvs);
      if (!genomic) return [];
      allele = await this.allele(genomic);
      if (allele === 'unknown-reference') return [];
    }
    if (!allele) return [];
    return [this.check(candidateFrom(allele), variant.statedProtein)];
  }

  /** The variant as HGVS on a reference sequence the registry may know. */
  private async nucleotideHgvs(variant: ParsedVariant): Promise<string | undefined> {
    const { reference } = variant;
    if (reference?.version) return formatHgvs(reference, variant.change);

    const gene = this.geneOfInterest ?? variant.gene;
    if (!reference) {
      if (variant.coordinate !== 'c') {
        this.warn('not-understood', `${variant.change} needs a reference sequence.`);
        return undefined;
      }
      if (!gene) {
        this.warn(
          'gene-needed',
          'No transcript was given. Give the gene of interest to use its MANE Select transcript.',
        );
        return undefined;
      }
      const mane = await this.maneSelect(gene);
      if (!mane) return undefined;
      this.warn(
        'transcript-assumed',
        `No transcript was given, so the MANE Select transcript ${mane.transcript} of ${gene} was used.`,
      );
      return `${mane.transcript}:${variant.change}`;
    }

    // An accession without a version: only the MANE Select version can be assumed.
    const mane = gene ? await this.maneSelect(gene) : undefined;
    if (mane && mane.transcript.split('.')[0] === reference.accession) {
      this.warn(
        'version-assumed',
        `${reference.accession} has no version, so the MANE Select version ${mane.transcript} was used.`,
      );
      return `${mane.transcript}:${variant.change}`;
    }
    this.warn(
      'version-needed',
      `${reference.accession} has no version${gene ? ` and is not the MANE Select transcript of ${gene}` : ''}. Give its version.`,
    );
    return undefined;
  }

  private async findProtein(variant: ParsedVariant): Promise<VariantCandidate[]> {
    let protein: string;
    if (variant.reference?.version) {
      protein = formatHgvs(variant.reference, variant.change);
    } else {
      const gene = this.geneOfInterest ?? variant.gene;
      if (!gene) {
        this.warn(
          'gene-needed',
          'Only a protein change was given. Give the gene of interest to look it up on its MANE Select protein.',
        );
        return [];
      }
      const mane = await this.maneSelect(gene);
      if (!mane) return [];
      protein = `${mane.protein}:${variant.change}`;
    }
    this.warn(
      'protein-only',
      `Only a protein change was given. These are the registered cDNA changes that produce ${protein}; check which one the article means.`,
    );
    const allele = await this.allele(protein);
    if (!allele || allele === 'unknown-reference') return [];
    const ids = [
      ...new Set(
        (allele.aminoAcidAlleles ?? [])
          .flatMap((a) => a.matchingRegisteredTranscripts ?? [])
          .map((t) => caidOf(t['@id']))
          .filter((id): id is string => id !== undefined),
      ),
    ];
    if (ids.length === 0) {
      this.warn('not-registered', `No registered cDNA change produces ${protein}.`);
      return [];
    }
    if (ids.length > 1) {
      this.warn(
        'several-candidates',
        `${ids.length} registered cDNA changes produce ${protein}${ids.length > MAX_PROTEIN_CANDIDATES ? `; the first ${MAX_PROTEIN_CANDIDATES} are shown` : ''}.`,
      );
    }
    const alleles = await Promise.all(
      ids.slice(0, MAX_PROTEIN_CANDIDATES).map((id) => this.alleleById(id)),
    );
    return alleles
      .filter((a): a is RegistryAllele => a !== undefined)
      .map((a) => this.check(candidateFrom(a), variant.change));
  }

  /** The registry's allele for an HGVS expression, `unknown-reference`, or undefined after a warning. */
  private async allele(hgvs: string): Promise<RegistryAllele | 'unknown-reference' | undefined> {
    const answer = await this.resolver.get<RegistryAllele>(
      'registry',
      this.resolver.registry(`/allele?hgvs=${encodeURIComponent(hgvs)}`),
    );
    if (answer.ok) {
      const caid = caidOf(answer.body['@id']);
      this.step('registry', hgvs, caid ? `found ${caid}` : 'valid, not registered');
      return answer.body;
    }
    const { errorType, message, description } = answer.error;
    if (errorType === 'IncorrectReferenceAllele') {
      this.step('registry', hgvs, 'reference mismatch');
      this.warn(
        'reference-mismatch',
        `${hgvs}: ${message ?? description ?? 'the reference allele does not match the reference sequence'}`,
      );
      return undefined;
    }
    if (/unknown reference/i.test(message ?? '')) {
      this.step('registry', hgvs, 'reference sequence not known');
      return 'unknown-reference';
    }
    if (answer.status >= 400 && answer.status < 500) {
      this.step('registry', hgvs, errorType ?? `error ${answer.status}`);
      this.warn(
        'not-understood',
        `The Allele Registry could not read ${hgvs}: ${message ?? description ?? errorType}`,
      );
      return undefined;
    }
    throw new UpstreamError(
      `The Allele Registry answered ${answer.status}: ${message ?? description ?? errorType}`,
    );
  }

  private async alleleById(caid: string): Promise<RegistryAllele | undefined> {
    const answer = await this.resolver.get<RegistryAllele>(
      'registry',
      this.resolver.registry(`/allele/${caid}`),
    );
    if (answer.ok) {
      this.step('registry', caid, 'found');
      return answer.body;
    }
    if (answer.status >= 500)
      throw new UpstreamError(`The Allele Registry answered ${answer.status} for ${caid}`);
    this.step('registry', caid, answer.error.errorType ?? `error ${answer.status}`);
    return undefined;
  }

  private async maneSelect(gene: string): Promise<ManeSelect | undefined> {
    if (this.genes.has(gene)) return this.genes.get(gene);
    const answer = await this.resolver.get<RegistryGene>(
      'registry',
      this.resolver.registry(`/gene?HGNC.symbol=${encodeURIComponent(gene)}`),
    );
    let mane: ManeSelect | undefined;
    if (answer.ok) {
      const record = answer.body.externalRecords?.MANE?.find((m) => m.maneStatus === 'MANE Select');
      const transcript = record?.nucleotide?.RefSeq?.id;
      const protein = record?.protein?.RefSeq?.id;
      if (transcript && protein) mane = { transcript, protein };
      this.step(
        'registry',
        `gene ${gene}`,
        mane ? `MANE Select ${transcript}` : 'no MANE Select transcript',
      );
      if (!mane)
        this.warn('gene-unknown', `${gene} has no MANE Select transcript in the Allele Registry.`);
    } else if (answer.status === 404) {
      this.step('registry', `gene ${gene}`, 'not found');
      this.warn('gene-unknown', `The Allele Registry has no gene with the HGNC symbol ${gene}.`);
    } else {
      throw new UpstreamError(`The Allele Registry answered ${answer.status} for gene ${gene}`);
    }
    this.genes.set(gene, mane);
    return mane;
  }

  /** GRCh38 genomic HGVS from VariantValidator, for a reference sequence the registry does not know. */
  private async mapToGenome(hgvs: string): Promise<string | undefined> {
    let answer: Answer<Record<string, unknown>>;
    try {
      answer = await this.resolver.get<Record<string, unknown>>(
        'variantvalidator',
        this.resolver.variantValidator(hgvs),
      );
    } catch (err) {
      this.step('variantvalidator', hgvs, 'not reached');
      this.warn(
        'not-mapped',
        `The Allele Registry does not know the reference sequence of ${hgvs}, and ${(err as Error).message}.`,
      );
      return undefined;
    }
    const body = answer.ok ? answer.body : {};
    const results = Object.entries(body).filter(
      ([key, value]) =>
        key !== 'flag' && key !== 'metadata' && typeof value === 'object' && value !== null,
    ) as [string, VariantValidatorResult][];
    const genomic = results
      .map(([, value]) => value.primary_assembly_loci?.grch38?.hgvs_genomic_description)
      .find((g): g is string => typeof g === 'string' && g.length > 0);
    if (body['flag'] === 'gene_variant' && genomic) {
      this.step('variantvalidator', hgvs, `mapped to ${genomic}`);
      this.warn(
        'mapped',
        `The Allele Registry does not know the reference sequence of ${hgvs}, so VariantValidator mapped it to ${genomic}.`,
      );
      return genomic;
    }
    const problem = results
      .flatMap(([, value]) => value.validation_warnings ?? [])
      .find((w) => !w.startsWith('Lovd'));
    this.step('variantvalidator', hgvs, problem ? 'not valid' : 'not mapped');
    if (problem && /ReferenceMismatch/i.test(problem)) {
      this.warn(
        'reference-mismatch',
        `${hgvs}: ${problem.replace(/^ReferenceMismatchError:\s*/, '')}`,
      );
    } else {
      this.warn(
        'not-mapped',
        `The Allele Registry does not know the reference sequence of ${hgvs}, and VariantValidator could not map it${problem ? `: ${problem}` : '.'}`,
      );
    }
    return undefined;
  }

  private step(service: LookupStep['service'], request: string, outcome: string): void {
    this.steps.push({ service, request, outcome });
  }

  /** Adds the warnings a curator should see on this candidate. */
  private check(candidate: VariantCandidate, statedProtein: string | undefined): VariantCandidate {
    const warnings = candidate.warnings;
    if (!candidate.caid) {
      warnings.push({
        code: 'not-registered',
        message:
          'The Allele Registry knows this allele, but nobody has registered it, so it has no CAID.',
      });
    }
    if (candidate.clinVar.length === 0) {
      warnings.push({ code: 'no-clinvar', message: 'ClinVar has no record of this allele.' });
    } else if (candidate.clinVar.length > 1) {
      warnings.push({
        code: 'several-clinvar',
        message: `ClinVar has ${candidate.clinVar.length} variations with this allele; check which one is meant.`,
      });
    }
    if (
      this.geneOfInterest &&
      candidate.geneSymbol &&
      candidate.geneSymbol.toUpperCase() !== this.geneOfInterest
    ) {
      warnings.push({
        code: 'gene-differs',
        message: `This allele is in ${candidate.geneSymbol}, not ${this.geneOfInterest}.`,
      });
    }
    const protein = candidate.hgvs.protein?.split(':')[1];
    if (
      statedProtein &&
      protein &&
      normalizeProteinChange(protein) !== normalizeProteinChange(statedProtein)
    ) {
      warnings.push({
        code: 'protein-differs',
        message: `The article gives ${statedProtein}, but on the MANE Select transcript this change is ${protein}.`,
      });
    }
    return candidate;
  }
}

interface VariantValidatorResult {
  primary_assembly_loci?: { grch38?: { hgvs_genomic_description?: string } };
  validation_warnings?: string[];
}

function caidOf(id: string | undefined): string | undefined {
  return id ? /\/(CA\d+)$/.exec(id)?.[1] : undefined;
}

function candidateFrom(allele: RegistryAllele): VariantCandidate {
  const caid = caidOf(allele['@id']);
  const genomic = allele.genomicAlleles
    ?.find((g) => g.referenceGenome === 'GRCh38')
    ?.hgvs?.find((h) => h.startsWith('NC_'));
  const transcripts = allele.transcriptAlleles ?? [];
  const mane = transcripts.find((t) => t.MANE?.maneStatus === 'MANE Select');
  const transcript = mane?.MANE?.nucleotide?.RefSeq?.hgvs;
  const protein = mane?.MANE?.protein?.RefSeq?.hgvs;
  const geneSymbol = mane?.geneSymbol ?? transcripts.find((t) => t.geneSymbol)?.geneSymbol;
  const records = allele.externalRecords ?? {};
  const clinVar = [
    ...new Set(
      (records.ClinVarVariations ?? [])
        .map((v) => v.variationId)
        .filter((v) => v !== undefined)
        .map(String),
    ),
  ].map((variationId) => ({
    variationId,
    url: `https://www.ncbi.nlm.nih.gov/clinvar/variation/${variationId}/`,
  }));
  const gnomad = records.gnomAD_4?.[0]?.id;
  const rs = records.dbSNP?.[0]?.rs;
  const title = allele.communityStandardTitle?.[0];
  return {
    ...(caid ? { caid, registryUrl: `${REGISTRY_PAGE}${caid}` } : {}),
    ...(title ? { title } : {}),
    ...(geneSymbol ? { geneSymbol } : {}),
    hgvs: {
      ...(genomic ? { genomic } : {}),
      ...(transcript ? { transcript } : {}),
      ...(protein ? { protein } : {}),
    },
    clinVar,
    ...(gnomad ? { gnomad } : {}),
    ...(rs !== undefined ? { dbSnp: `rs${rs}` } : {}),
    warnings: [],
  };
}
