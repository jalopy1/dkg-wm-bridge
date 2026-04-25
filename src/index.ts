export { DkgClient, type ClientOptions, type Quad } from './dkg-client.js';
export {
  artifactToQuads,
  assertionName,
  extractTitle,
  detectKind,
  type ArtifactMeta,
  type ArtifactStatus,
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
