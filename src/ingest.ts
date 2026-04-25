/**
 * Core ingestion engine.
 * Reads workspace artifacts, converts to RDF, writes to DKG Working Memory.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { DkgClient } from './dkg-client.js';
import {
  artifactToQuads,
  assertionName,
  extractTitle,
  detectKind,
  type ArtifactMeta,
  type ArtifactStatus,
} from './rdf.js';

export interface IngestOptions {
  /** DKG client instance */
  client: DkgClient;
  /** Context graph to write into */
  contextGraph: string;
  /** Agent name for provenance */
  agent: string;
  /** Agent's DKG peer ID */
  agentPeerId?: string;
  /** Initial status tag for ingested artifacts */
  status?: ArtifactStatus;
  /** Optional tags to apply */
  tags?: string[];
  /** Dry run — don't write, just return what would be written */
  dryRun?: boolean;
}

export interface IngestResult {
  file: string;
  assertionName: string;
  quadCount: number;
  written: number;
  alreadyExists: boolean;
  error?: string;
}

/**
 * Ingest a single markdown file into Working Memory.
 */
export async function ingestFile(filePath: string, opts: IngestOptions): Promise<IngestResult> {
  const content = readFileSync(filePath, 'utf-8');
  const fileName = basename(filePath);
  const stat = statSync(filePath);

  const meta: ArtifactMeta = {
    source: filePath,
    title: extractTitle(content, fileName),
    content,
    kind: detectKind(filePath),
    timestamp: stat.mtime.toISOString(),
    agent: opts.agent,
    agentPeerId: opts.agentPeerId,
    status: opts.status ?? 'draft',
    tags: opts.tags,
  };

  const quads = artifactToQuads(meta);
  const name = assertionName(meta);

  if (opts.dryRun) {
    return { file: filePath, assertionName: name, quadCount: quads.length, written: 0, alreadyExists: false };
  }

  try {
    // Create assertion (idempotent — swallows "already exists")
    const { alreadyExists } = await opts.client.createAssertion(opts.contextGraph, name);

    // Write quads
    const { written } = await opts.client.writeAssertion(opts.contextGraph, name, quads);

    return { file: filePath, assertionName: name, quadCount: quads.length, written, alreadyExists };
  } catch (err) {
    return {
      file: filePath,
      assertionName: name,
      quadCount: quads.length,
      written: 0,
      alreadyExists: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Ingest raw text (not from a file) into Working Memory.
 */
export async function ingestText(
  text: string,
  title: string,
  kind: ArtifactMeta['kind'],
  opts: IngestOptions,
): Promise<IngestResult> {
  const meta: ArtifactMeta = {
    source: `inline:${title}`,
    title,
    content: text,
    kind,
    timestamp: new Date().toISOString(),
    agent: opts.agent,
    agentPeerId: opts.agentPeerId,
    status: opts.status ?? 'draft',
    tags: opts.tags,
  };

  const quads = artifactToQuads(meta);
  const name = assertionName(meta);

  if (opts.dryRun) {
    return { file: `inline:${title}`, assertionName: name, quadCount: quads.length, written: 0, alreadyExists: false };
  }

  try {
    const { alreadyExists } = await opts.client.createAssertion(opts.contextGraph, name);
    const { written } = await opts.client.writeAssertion(opts.contextGraph, name, quads);
    return { file: `inline:${title}`, assertionName: name, quadCount: quads.length, written, alreadyExists };
  } catch (err) {
    return {
      file: `inline:${title}`,
      assertionName: name,
      quadCount: quads.length,
      written: 0,
      alreadyExists: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Batch ingest a directory of markdown files into Working Memory.
 */
export async function ingestDirectory(
  dirPath: string,
  opts: IngestOptions & { recursive?: boolean; pattern?: RegExp },
): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  const pattern = opts.pattern ?? /\.(md|markdown|txt)$/i;

  function collectFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && opts.recursive) {
        files.push(...collectFiles(full));
      } else if (entry.isFile() && pattern.test(entry.name)) {
        files.push(full);
      }
    }
    return files;
  }

  const files = collectFiles(dirPath);

  for (const file of files) {
    const result = await ingestFile(file, opts);
    results.push(result);
  }

  return results;
}

/**
 * Promote an assertion from Working Memory to Shared Memory.
 */
export async function promoteArtifact(
  client: DkgClient,
  contextGraph: string,
  name: string,
  entities?: string[],
): Promise<Record<string, unknown>> {
  return client.promoteAssertion(contextGraph, name, entities);
}

/**
 * List artifacts currently in Working Memory for a context graph.
 * Requires the agent's wallet address for WM-scoped SPARQL reads.
 */
export async function listWorkingMemory(
  client: DkgClient,
  contextGraph: string,
): Promise<any> {
  const agentAddress = await client.getAgentAddress();
  return client.query(
    `SELECT ?s ?name ?status ?kind ?date WHERE {
      ?s a <urn:openclaw:wm-bridge:ontology/AgentArtifact> .
      ?s <https://schema.org/name> ?name .
      ?s <urn:openclaw:wm-bridge:ontology/status> ?status .
      ?s <urn:openclaw:wm-bridge:ontology/artifactKind> ?kind .
      ?s <https://schema.org/dateCreated> ?date .
    } ORDER BY DESC(?date) LIMIT 50`,
    { contextGraphId: contextGraph, view: 'working-memory', agentAddress },
  );
}

/**
 * Ensure the target context graph exists, creating it if needed.
 */
export async function ensureContextGraph(
  client: DkgClient,
  id: string,
  name: string,
  description?: string,
): Promise<{ created: boolean }> {
  try {
    const { contextGraphs } = await client.listContextGraphs();
    if (contextGraphs.some((cg: any) => cg.id === id || cg.uri?.includes(id))) {
      return { created: false };
    }
  } catch {
    // list failed, try creating anyway
  }

  try {
    await client.createContextGraph(id, name, description);
    return { created: true };
  } catch (err) {
    if (err instanceof Error && err.message.includes('already exists')) {
      return { created: false };
    }
    throw err;
  }
}
