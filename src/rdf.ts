/**
 * RDF triple generation utilities.
 *
 * Two quad generators:
 *   - provenanceQuads(): metadata, provenance, status tags (used with import pipeline)
 *   - artifactToQuads(): full quads including content blob (legacy fallback)
 *
 * Uses schema.org + PROV-O vocabulary for interoperability.
 */

import { createHash } from 'node:crypto';
import type { Quad } from './dkg-client.js';

// -- Namespace prefixes -------------------------------------------------------

const SCHEMA = 'https://schema.org/';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const PROV = 'http://www.w3.org/ns/prov#';
const DCTERMS = 'http://purl.org/dc/terms/';
const WMB = 'urn:dkg:wm-bridge:';
const WMBO = `${WMB}ontology/`;

// -- Status tags (trust gradient markers) -------------------------------------

export type ArtifactStatus = 'draft' | 'reviewed' | 'promote-ready' | 'promoted' | 'verified-ready';

// -- Sensitivity levels -------------------------------------------------------

export type SensitivityLevel = 'public' | 'shareable' | 'personal' | 'secret';

// -- Artifact metadata --------------------------------------------------------

export interface ArtifactMeta {
  /** Source file path or identifier */
  source: string;
  /** Human-readable title (derived from filename or first heading) */
  title: string;
  /** Full text content */
  content: string;
  /** Artifact type */
  kind: 'memory-daily' | 'memory-longterm' | 'research-note' | 'session-summary' | 'document' | 'knowledge-artifact';
  /** ISO timestamp of creation/modification */
  timestamp: string;
  /** Agent name or identifier */
  agent: string;
  /** Agent's DKG peer ID (if known) */
  agentPeerId?: string;
  /** Current status in the trust gradient */
  status: ArtifactStatus;
  /** Optional tags for categorization */
  tags?: string[];
  /** MIME content type (default: text/markdown) */
  contentType?: string;
  /** Agent's wallet address for on-chain identity */
  agentAddress?: string;
  /** Sensitivity level for access control (default: shareable) */
  sensitivity?: SensitivityLevel;
}

// -- Helpers ------------------------------------------------------------------

/** Hash source path + timestamp for deterministic artifact identification. */
function sourceHash(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 16);
}

function artifactUri(meta: ArtifactMeta): string {
  const hash = sourceHash(`${meta.source}:${meta.timestamp}`);
  return `${WMB}artifact/${hash}`;
}

function agentUri(meta: ArtifactMeta): string {
  return meta.agentPeerId ? `did:dkg:agent:${meta.agentPeerId}` : `${WMB}agent/${meta.agent}`;
}

function literal(value: string, datatype?: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  if (datatype) return `"${escaped}"^^<${datatype}>`;
  return `"${escaped}"`;
}

function dateLiteral(iso: string): string {
  return literal(iso, `${XSD}dateTime`);
}

// -- Provenance quads (used with import pipeline) -----------------------------

/**
 * Generate provenance + status metadata quads only.
 * Used alongside the node's import-file pipeline which handles content extraction.
 * Does NOT include the raw text content — the node's extraction pipeline does that.
 */
export function provenanceQuads(meta: ArtifactMeta): Quad[] {
  const uri = artifactUri(meta);
  const agent = agentUri(meta);
  const quads: Quad[] = [];

  const q = (s: string, p: string, o: string) => quads.push({ subject: s, predicate: p, object: o });

  // -- Type markers
  q(uri, `${RDF}type`, `${SCHEMA}DigitalDocument`);
  q(uri, `${RDF}type`, `${WMBO}AgentArtifact`);

  // -- Core metadata (no content blob)
  q(uri, `${SCHEMA}name`, literal(meta.title));
  q(uri, `${SCHEMA}dateCreated`, dateLiteral(meta.timestamp));
  q(uri, `${SCHEMA}author`, agent);
  q(uri, `${SCHEMA}encodingFormat`, literal(meta.contentType ?? 'text/markdown'));

  // -- Content integrity hash
  const contentHash = createHash('sha256').update(meta.content, 'utf-8').digest('hex');
  q(uri, `${SCHEMA}sha256`, literal(contentHash));

  // -- Provenance (PROV-O + DC Terms)
  q(uri, `${PROV}wasGeneratedBy`, agent);
  q(uri, `${PROV}generatedAtTime`, dateLiteral(meta.timestamp));
  q(uri, `${DCTERMS}source`, literal(meta.source));

  // -- WM Bridge ontology (status, kind, sensitivity)
  q(uri, `${WMBO}artifactKind`, literal(meta.kind));
  q(uri, `${WMBO}status`, literal(meta.status));
  q(uri, `${WMBO}sensitivity`, literal(meta.sensitivity ?? 'shareable'));
  q(uri, `${WMBO}sourceFile`, literal(meta.source));

  // -- Tags
  if (meta.tags?.length) {
    for (const tag of meta.tags) {
      q(uri, `${SCHEMA}keywords`, literal(tag));
    }
  }

  // -- Agent identity
  q(agent, `${RDF}type`, `${PROV}SoftwareAgent`);
  q(agent, `${SCHEMA}name`, literal(meta.agent));
  if (meta.agentAddress) {
    q(agent, `${SCHEMA}identifier`, literal(meta.agentAddress));
  }

  return quads;
}

// -- Full quads (legacy fallback) ---------------------------------------------

/**
 * Generate ALL quads including raw text content.
 * Used as fallback when the node's import pipeline is unavailable.
 */
export function artifactToQuads(meta: ArtifactMeta): Quad[] {
  const uri = artifactUri(meta);
  const quads = provenanceQuads(meta);

  // Add the raw content blob (not included in provenanceQuads)
  quads.splice(4, 0, { subject: uri, predicate: `${SCHEMA}text`, object: literal(meta.content) });

  return quads;
}

// -- Utilities ----------------------------------------------------------------

/**
 * Generate a deterministic assertion name from artifact metadata.
 */
export function assertionName(meta: ArtifactMeta): string {
  const hash = sourceHash(`${meta.source}:${meta.timestamp}`);
  return `wm-bridge-${meta.kind}-${hash}`;
}

/**
 * Extract a title from markdown content (first # heading or filename).
 */
export function extractTitle(content: string, fallbackFilename: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  return fallbackFilename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
}

/**
 * Detect artifact kind from file path.
 */
export function detectKind(filePath: string): ArtifactMeta['kind'] {
  const lower = filePath.toLowerCase();
  if (/memory\/\d{4}-\d{2}-\d{2}/.test(lower)) return 'memory-daily';
  if (lower.includes('memory.md')) return 'memory-longterm';
  if (lower.includes('research') || lower.includes('oracle')) return 'research-note';
  if (lower.includes('session') || lower.includes('summary')) return 'session-summary';
  return 'document';
}

export { artifactUri, sourceHash, WMB, WMBO, SCHEMA };
