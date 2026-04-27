export { DkgClient, type ClientOptions, type Quad } from './dkg-client.js';
export {
  artifactToQuads,
  provenanceQuads,
  assertionName,
  extractTitle,
  detectKind,
  type ArtifactMeta,
  type ArtifactStatus,
  type SensitivityLevel,
} from './rdf.js';
export {
  ingestFile,
  ingestText,
  ingestDirectory,
  promoteArtifact,
  listWorkingMemory,
  ensureContextGraph,
  type IngestOptions,
  type IngestResult,
} from './ingest.js';
export {
  scanContent,
  redactContent,
  type ScanResult,
  type ScanFinding,
} from './scanner.js';
