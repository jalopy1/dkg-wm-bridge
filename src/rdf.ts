/**
 * RDF triple generation utilities.
 * Uses schema.org vocabulary + custom provenance ontology.
 * All URIs are deterministic from content for idempotent writes.
 */

import { createHash } from 'node:crypto';
import type { Quad } from './dkg-client.js';

// -- Namespace prefixes -------------------------------------------------------

const SCHEMA = 'https://schema.org/';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const PROV = 'http://www.w3.org/ns/prov#';
const DCTERMS = 'http://purl.org/dc/terms/';
const WMB = 'urn:openclaw:wm-bridge:';
const WMBO = `${WMB}ontology/`;

// -- Status tags (trust gradient markers) -------------------------------------

export type ArtifactStatus = 'draft' | 'reviewed' | 'promote-ready' | 'promoted' | 'verified-ready';

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
}

// -- Helpers ------------------------------------------------------------------

function contentHash(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 16);
}

function artifactUri(meta: ArtifactMeta): string {
  const hash = contentHash(`${meta.source}:${meta.timestamp}`);
  return `${WMB}artifact/${hash}`;
}

function literal(value: string, datatype?: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  if (datatype) return `"${escaped}"^^<${datatype}>`;
  return `"${escaped}"`;
}

function dateLiteral(iso: string): string {
  return literal(iso, `${XSD}dateTime`);
}

// -- Triple generation --------------------------------------------------------

/**
 * Convert an artifact into RDF quads suitable for DKG Working Memory.
 * Uses schema.org for interoperability and PROV-O for provenance.
 */
export function artifactToQuads(meta: ArtifactMeta): Quad[] {
  const uri = artifactUri(meta);
  const agentUri = meta.agentPeerId ? `did:dkg:agent:${meta.agentPeerId}` : `${WMB}agent/${meta.agent}`;
  const quads: Quad[] = [];

  const q = (s: string, p: string, o: string) => quads.push({ subject: s, predicate: p, object: o });

  // -- Type
  q(uri, `${RDF}type`, `${SCHEMA}DigitalDocument`);
  q(uri, `${RDF}type`, `${WMBO}AgentArtifact`);

  // -- Core metadata (schema.org)
  q(uri, `${SCHEMA}name`, literal(meta.title));
  q(uri, `${SCHEMA}text`, literal(meta.content));
  q(uri, `${SCHEMA}dateCreated`, dateLiteral(meta.timestamp));
  q(uri, `${SCHEMA}author`, agentUri);
  q(uri, `${SCHEMA}encodingFormat`, literal('text/markdown'));

  // -- Provenance (PROV-O + DC Terms)
  q(uri, `${PROV}wasGeneratedBy`, agentUri);
  q(uri, `${PROV}generatedAtTime`, dateLiteral(meta.timestamp));
  q(uri, `${DCTERMS}source`, literal(meta.source));

  // -- WM Bridge ontology (status, kind, promotion readiness)
  q(uri, `${WMBO}artifactKind`, literal(meta.kind));
  q(uri, `${WMBO}status`, literal(meta.status));
  q(uri, `${WMBO}sourceFile`, literal(meta.source));

  // -- Tags
  if (meta.tags?.length) {
    for (const tag of meta.tags) {
      q(uri, `${SCHEMA}keywords`, literal(tag));
    }
  }

  // -- Agent identity
  q(agentUri, `${RDF}type`, `${PROV}SoftwareAgent`);
  q(agentUri, `${SCHEMA}name`, literal(meta.agent));

  return quads;
}

/**
 * Generate a deterministic assertion name from artifact metadata.
 * Keeps assertions organized and idempotent.
 */
export function assertionName(meta: ArtifactMeta): string {
  const hash = contentHash(`${meta.source}:${meta.timestamp}`);
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

export { artifactUri, contentHash, WMB, WMBO, SCHEMA };
