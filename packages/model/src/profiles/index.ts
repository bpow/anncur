/**
 * Body profile registry: JSON Schemas registered against profile IRIs and
 * purposes, used to validate structured bodies (docs/body-profiles.md).
 */
export {
  PROFILE_BASE,
  builtinProfiles,
  caseDiseaseProfile,
  caseFamilyProfile,
  caseIndividualProfile,
  casePhenotypesProfile,
  caseTestingProfile,
  caseVariantProfile,
  evidenceExcerptProfile,
  individualProfile,
} from './builtin.js';
export {
  addProfileKeywords,
  isDerived,
  linkedIris,
  type AnnotationLink,
  type KeywordRegistry,
  type OntologyLookup,
} from './keywords.js';
export {
  ProfileRegistry,
  type BodyProfile,
  type CompiledSchema,
  type SchemaCompiler,
  type ValidationError,
  type ValidationResult,
} from './registry.js';
export { summarizeIndividuals, type IndividualSummary, type Summaries } from './summary.js';
