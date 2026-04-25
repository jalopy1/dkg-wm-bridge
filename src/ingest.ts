/**
 * Core ingestion engine.
 *
 * Two-layer approach:
 *   1. Node's import-file pipeline handles content extraction (entities,
 *      relationships, structured knowledge from markdown/PDF/DOCX)
 *   2. We add provenance metadata, status tags, and orchestration on top
 *
 * This leverages the DKG v10 node's built-in knowledge extraction rather
 * than dumping raw text as a single RDF literal.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { DkgClient } from './dkg-client.js';
import {
  provenanceQuads,
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
  /** Use legacy mode (manual RDF) instead of node import pipeline */
  legacy?: boolean;
}

export interface IngestResult {
  file: string;
  assertionName: string;
  mode: 'import-pipeline' | 'legacy-rdf';
  extractedTriples?: number;
  provenanceQuads: number;
  alreadyExists: boolean;
  skipped?: boolean;
  error?: string;
}

// -- Content type detection ---------------------------------------------------

const CONTENT_TYPES: Record<string, string> = {
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.json': 'application/json',
  '.jsonld': 'application/ld+json',
  '.nq': 'application/n-quads',
  '.nt': 'application/n-triples',
  '.ttl': 'text/turtle',
};

function detectContentType(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

// -- Content hashing for deduplication ----------------------------------------

function contentFingerprint(content: Buffer | string): string {
  const buf = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

// -- Markdown chunking --------------------------------------------------------

interface Chunk {
  title: string;
  content: string;
  index: number;
}

/**
 * Split a large markdown file into sections by top-level headings.
 * Files under the threshold are returned as a single chunk.
 */
function chunkMarkdown(content: string, maxChunkBytes = 8192): Chunk[] {
  if (Buffer.byteLength(content, 'utf-8') <= maxChunkBytes) {
    return [{ title: '', content, index: 0 }];
  }

  const lines = content.split('\n');
  const chunks: Chunk[] = [];
  let current: string[] = [];
  let currentTitle = '';
  let idx = 0;

  for (const line of lines) {
    // Split on ## headings (keep # as document title, split on ##)
    if (/^##\s+/.test(line) && current.length > 0) {
      chunks.push({ title: currentTitle, content: current.join('\n'), index: idx++ });
      current = [line];
      currentTitle = line.replace(/^##\s+/, '').trim();
    } else {
      if (/^#\s+/.test(line) && !currentTitle) {
        currentTitle = line.replace(/^#\s+/, '').trim();
      }
      current.push(line);
    }
  }
  if (current.length > 0) {
    chunks.push({ title: currentTitle, content: current.join('\n'), index: idx });
  }

  return chunks;
}

// -- Core ingestion -----------------------------------------------------------

/**
 * Ingest a single file into Working Memory using the node's import pipeline.
 *
 * Flow:
 *   1. Create assertion (idempotent)
 *   2. Import file via node's extraction pipeline (entities, relationships)
 *   3. Write provenance + status metadata as additional quads
 *   4. Optionally check extraction status
 */
export async function ingestFile(filePath: string, opts: IngestOptions): Promise<IngestResult> {
  const content = readFileSync(filePath);
  const textContent = content.toString('utf-8');
  const fileName = basename(filePath);
  const stat = statSync(filePath);
  const contentType = detectContentType(filePath);

  const meta: ArtifactMeta = {
    source: filePath,
    title: extractTitle(textContent, fileName),
    content: textContent,
    kind: detectKind(filePath),
    timestamp: stat.mtime.toISOString(),
    agent: opts.agent,
    agentPeerId: opts.agentPeerId,
    status: opts.status ?? 'draft',
    tags: opts.tags,
  };

  const name = assertionName(meta);
  const provQuads = provenanceQuads(meta);

  if (opts.dryRun) {
    return {
      file: filePath,
      assertionName: name,
      mode: 'import-pipeline',
      provenanceQuads: provQuads.length,
      alreadyExists: false,
    };
  }

  try {
    // 1. Create assertion (idempotent)
    const { alreadyExists } = await opts.client.createAssertion(opts.contextGraph, name);

    // 2. Check for large markdown files — chunk if needed
    const isMarkdown = contentType === 'text/markdown' || contentType === 'text/plain';
    const isLarge = content.byteLength > 8192;

    let extractedTriples = 0;

    if (isMarkdown && isLarge) {
      // Chunk large markdown files and import each section
      const chunks = chunkMarkdown(textContent);
      for (const chunk of chunks) {
        const chunkName = chunks.length > 1 ? `${name}-chunk-${chunk.index}` : name;
        if (chunks.length > 1) {
          await opts.client.createAssertion(opts.contextGraph, chunkName);
        }
        const chunkBuf = Buffer.from(chunk.content, 'utf-8');
        const chunkFileName = chunks.length > 1
          ? `${fileName.replace(/\.[^.]+$/, '')}-${chunk.index}${extname(fileName)}`
          : fileName;
        try {
          const importResult = await opts.client.importFile(
            opts.contextGraph, chunkName, chunkBuf, chunkFileName, contentType,
          );
          extractedTriples += (importResult.tripleCount as number) ?? 0;
        } catch (err) {
          // If import-file fails (e.g. extraction not supported), fall back to raw write
          const { written } = await opts.client.writeAssertion(opts.contextGraph, chunkName, provQuads);
          extractedTriples += written;
        }
      }
    } else {
      // Import via node's extraction pipeline
      try {
        const importResult = await opts.client.importFile(
          opts.contextGraph, name, content, fileName, contentType,
        );
        extractedTriples = (importResult.tripleCount as number) ?? 0;
      } catch (err) {
        // Fallback: if import pipeline fails, write provenance quads directly
        const { written } = await opts.client.writeAssertion(opts.contextGraph, name, provQuads);
        extractedTriples = written;
      }
    }

    // 3. Write provenance + status metadata on top of extracted content
    try {
      await opts.client.writeAssertion(opts.contextGraph, name, provQuads);
    } catch {
      // Non-fatal: provenance write failure doesn't invalidate the import
    }

    return {
      file: filePath,
      assertionName: name,
      mode: 'import-pipeline',
      extractedTriples,
      provenanceQuads: provQuads.length,
      alreadyExists,
    };
  } catch (err) {
    return {
      file: filePath,
      assertionName: name,
      mode: 'import-pipeline',
      provenanceQuads: provQuads.length,
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

  const name = assertionName(meta);
  const provQuads = provenanceQuads(meta);

  if (opts.dryRun) {
    return {
      file: `inline:${title}`,
      assertionName: name,
      mode: 'import-pipeline',
      provenanceQuads: provQuads.length,
      alreadyExists: false,
    };
  }

  try {
    const { alreadyExists } = await opts.client.createAssertion(opts.contextGraph, name);

    // Import as markdown buffer
    const buf = Buffer.from(text, 'utf-8');
    let extractedTriples = 0;
    try {
      const importResult = await opts.client.importFile(
        opts.contextGraph, name, buf, `${title}.md`, 'text/markdown',
      );
      extractedTriples = (importResult.tripleCount as number) ?? 0;
    } catch {
      // Fallback to direct quad write
      const { written } = await opts.client.writeAssertion(opts.contextGraph, name, provQuads);
      extractedTriples = written;
    }

    // Add provenance on top
    try {
      await opts.client.writeAssertion(opts.contextGraph, name, provQuads);
    } catch { /* non-fatal */ }

    return {
      file: `inline:${title}`,
      assertionName: name,
      mode: 'import-pipeline',
      extractedTriples,
      provenanceQuads: provQuads.length,
      alreadyExists,
    };
  } catch (err) {
    return {
      file: `inline:${title}`,
      assertionName: name,
      mode: 'import-pipeline',
      provenanceQuads: provQuads.length,
      alreadyExists: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Batch ingest a directory of files into Working Memory.
 * Supports markdown, text, PDF, and DOCX files.
 */
export async function ingestDirectory(
  dirPath: string,
  opts: IngestOptions & { recursive?: boolean; pattern?: RegExp },
): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  const pattern = opts.pattern ?? /\.(md|markdown|txt|pdf|docx)$/i;

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

  // Process files with light concurrency (3 at a time)
  const BATCH_SIZE = 3;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(f => ingestFile(f, opts)));
    results.push(...batchResults);
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
 */
export async function listWorkingMemory(
  client: DkgClient,
  contextGraph: string,
): Promise<any> {
  const agentAddress = await client.getAgentAddress();
  return client.query(
    `SELECT ?s ?name ?status ?kind ?date WHERE {
      ?s a <urn:dkg:wm-bridge:ontology/AgentArtifact> .
      ?s <https://schema.org/name> ?name .
      ?s <urn:dkg:wm-bridge:ontology/status> ?status .
      ?s <urn:dkg:wm-bridge:ontology/artifactKind> ?kind .
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
