/**
 * Query engine for Working Memory artifacts.
 *
 * Builds SPARQL queries to search and filter AgentArtifacts stored in
 * a context graph's Working Memory, and returns structured results.
 */

import type { DkgClient } from './dkg-client.js';
import type { SensitivityLevel } from './rdf.js';

// -- Namespace constants (must match rdf.ts) ----------------------------------

const SCHEMA = 'https://schema.org/';
const WMBO = 'urn:dkg:wm-bridge:ontology/';

// -- Types --------------------------------------------------------------------

export interface QueryOptions {
  /** Free-text search term — filters by name (case-insensitive) */
  searchTerm?: string;
  /** Filter by artifact kind */
  kind?: string;
  /** Filter by sensitivity level */
  sensitivity?: SensitivityLevel;
  /** Max results (default 10) */
  limit?: number;
  /** Output format hint — 'json' for machine-readable */
  format?: 'human' | 'json';
}

export interface ArtifactResult {
  uri: string;
  name: string;
  kind: string;
  status: string;
  sensitivity: string;
  date: string;
  sha256: string;
  tags: string;
  contentPreview: string;
}

// -- Helpers ------------------------------------------------------------------

/** Strip RDF literal quotes and datatype suffixes. */
function cleanLiteral(v: string | undefined): string {
  if (!v) return '';
  return v.replace(/^"(.*)"(\^\^<[^>]+>)?$/, '$1');
}

/**
 * Escape a string for safe interpolation into a SPARQL string literal.
 * Handles backslashes, quotes, newlines, carriage returns, and tabs
 * to prevent SPARQL injection attacks.
 */
function escapeSparqlLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')   // backslashes first (before other escapes add more)
    .replace(/"/g, '\\"')      // double quotes
    .replace(/\n/g, '\\n')     // newlines
    .replace(/\r/g, '\\r')     // carriage returns
    .replace(/\t/g, '\\t');    // tabs
}

/** Maximum allowed SPARQL LIMIT value to prevent DoS. */
const MAX_QUERY_LIMIT = 1000;

/** Allowed artifact kind values for query filtering. */
const VALID_QUERY_KINDS = [
  'memory-daily', 'memory-longterm', 'research-note',
  'session-summary', 'document', 'knowledge-artifact',
];

// -- SPARQL builder -----------------------------------------------------------

/**
 * Build a SPARQL SELECT query for AgentArtifacts with optional filters.
 * All user-supplied values are sanitized before interpolation into SPARQL.
 * Exported for testability.
 */
export function buildArtifactSparql(opts: QueryOptions): string {
  // Clamp limit to safe range
  const rawLimit = opts.limit ?? 10;
  const limit = Math.max(1, Math.min(rawLimit, MAX_QUERY_LIMIT));
  const filters: string[] = [];

  if (opts.kind) {
    // Validate kind against allowlist to prevent injection
    if (!VALID_QUERY_KINDS.includes(opts.kind)) {
      throw new Error(`Invalid kind "${opts.kind}". Must be one of: ${VALID_QUERY_KINDS.join(', ')}`);
    }
    filters.push(`FILTER(?kind = "${escapeSparqlLiteral(opts.kind)}")`);
  }
  if (opts.sensitivity) {
    // sensitivity is typed as SensitivityLevel, but validate defensively
    const validSens = ['public', 'shareable', 'personal', 'secret'];
    if (!validSens.includes(opts.sensitivity)) {
      throw new Error(`Invalid sensitivity "${opts.sensitivity}". Must be one of: ${validSens.join(', ')}`);
    }
    filters.push(`FILTER(?sensitivity = "${escapeSparqlLiteral(opts.sensitivity)}")`);
  }
  if (opts.searchTerm) {
    // Properly escape all SPARQL-significant characters
    const escaped = escapeSparqlLiteral(opts.searchTerm.toLowerCase());
    filters.push(`FILTER(CONTAINS(LCASE(?name), "${escaped}"))`);
  }

  const filterBlock = filters.length > 0 ? '\n    ' + filters.join('\n    ') : '';

  return `SELECT ?s ?name ?kind ?status ?sensitivity ?date ?sha256 ?tags ?content WHERE {
    ?s a <${WMBO}AgentArtifact> .
    ?s <${SCHEMA}name> ?name .
    ?s <${WMBO}artifactKind> ?kind .
    ?s <${WMBO}status> ?status .
    ?s <${WMBO}sensitivity> ?sensitivity .
    ?s <${SCHEMA}dateCreated> ?date .
    OPTIONAL { ?s <${SCHEMA}sha256> ?sha256 . }
    OPTIONAL { ?s <${SCHEMA}keywords> ?tags . }
    OPTIONAL { ?s <${SCHEMA}text> ?content . }${filterBlock}
  } ORDER BY DESC(?date) LIMIT ${limit}`;
}

// -- Query executor -----------------------------------------------------------

/**
 * Query Working Memory for AgentArtifacts matching the given filters.
 * Returns structured, cleaned results ready for display or JSON output.
 */
export async function queryArtifacts(
  client: Pick<DkgClient, 'query' | 'getAgentAddress'>,
  contextGraph: string,
  opts: QueryOptions,
): Promise<ArtifactResult[]> {
  const sparql = buildArtifactSparql(opts);
  const agentAddress = await client.getAgentAddress();

  const raw = await client.query(sparql, {
    contextGraphId: contextGraph,
    view: 'working-memory',
    agentAddress,
  });

  const bindings: Record<string, string>[] = raw?.result?.bindings ?? raw?.results?.bindings ?? [];

  return bindings.map((row) => {
    const content = cleanLiteral(row.content);
    const preview = content.length > 200 ? content.slice(0, 200) + '...' : content;

    return {
      uri: row.s ?? '',
      name: cleanLiteral(row.name),
      kind: cleanLiteral(row.kind),
      status: cleanLiteral(row.status),
      sensitivity: cleanLiteral(row.sensitivity),
      date: cleanLiteral(row.date),
      sha256: cleanLiteral(row.sha256),
      tags: cleanLiteral(row.tags),
      contentPreview: preview,
    };
  });
}
