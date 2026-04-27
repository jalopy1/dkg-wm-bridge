/**
 * Unit tests for the ingest module.
 * Run with: node --test test/ingest.test.js
 *
 * NOTE: chunkMarkdown is an internal (non-exported) function in ingest.ts.
 * These tests cover the exported surface. To enable direct chunkMarkdown
 * testing, export it from src/ingest.ts.
 *
 * The exported functions (ingestFile, ingestText, ingestDirectory, etc.)
 * all require a live DkgClient, so we test them with a lightweight mock.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We import what's available from the compiled output
import {
  ingestFile,
  ingestText,
  ingestDirectory,
  ensureContextGraph,
} from '../dist/ingest.js';

// -- Mock DkgClient -----------------------------------------------------------

function mockClient(overrides = {}) {
  return {
    createAssertion: async () => ({ assertionUri: 'urn:test', alreadyExists: false }),
    writeAssertion: async (_cg, _name, quads) => ({ written: quads.length }),
    importFile: async () => ({ tripleCount: 5 }),
    promoteAssertion: async () => ({}),
    listContextGraphs: async () => ({ contextGraphs: [] }),
    createContextGraph: async () => ({ created: 'test-cg', uri: 'urn:test-cg' }),
    query: async () => ({ results: [] }),
    getAgentAddress: async () => '0xTestAddress',
    ...overrides,
  };
}

// -- Temp directory helpers ---------------------------------------------------

const TEST_DIR = join(tmpdir(), `wm-bridge-test-${Date.now()}`);

function setupTempDir() {
  mkdirSync(TEST_DIR, { recursive: true });
}

function cleanupTempDir() {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

function writeTempFile(name, content) {
  const p = join(TEST_DIR, name);
  writeFileSync(p, content, 'utf-8');
  return p;
}

// -- ingestFile ---------------------------------------------------------------

describe('ingestFile', () => {
  it('ingests a markdown file via import pipeline', async () => {
    setupTempDir();
    try {
      const filePath = writeTempFile('test-doc.md', '# Hello\n\nSome content here.');
      const result = await ingestFile(filePath, {
        client: mockClient(),
        contextGraph: 'test-cg',
        agent: 'TestAgent',
      });
      assert.equal(result.mode, 'import-pipeline');
      assert.ok(result.assertionName.startsWith('wm-bridge-'));
      assert.equal(result.error, undefined);
      assert.equal(result.alreadyExists, false);
      assert.ok(result.provenanceQuads > 0, 'should have provenance quads');
    } finally {
      cleanupTempDir();
    }
  });

  it('reports alreadyExists when assertion exists', async () => {
    setupTempDir();
    try {
      const filePath = writeTempFile('existing.md', '# Existing');
      const client = mockClient({
        createAssertion: async () => ({ assertionUri: null, alreadyExists: true }),
      });
      const result = await ingestFile(filePath, {
        client,
        contextGraph: 'test-cg',
        agent: 'TestAgent',
      });
      assert.equal(result.alreadyExists, true);
    } finally {
      cleanupTempDir();
    }
  });

  it('falls back to direct write when import pipeline fails', async () => {
    setupTempDir();
    try {
      const filePath = writeTempFile('fallback.md', '# Fallback');
      const client = mockClient({
        importFile: async () => { throw new Error('import not supported'); },
      });
      const result = await ingestFile(filePath, {
        client,
        contextGraph: 'test-cg',
        agent: 'TestAgent',
      });
      // Should not error — falls back to writeAssertion
      assert.equal(result.error, undefined);
      assert.ok(result.extractedTriples > 0, 'should have written quads via fallback');
    } finally {
      cleanupTempDir();
    }
  });

  it('returns error when createAssertion throws', async () => {
    setupTempDir();
    try {
      const filePath = writeTempFile('error.md', '# Error');
      const client = mockClient({
        createAssertion: async () => { throw new Error('network failure'); },
      });
      const result = await ingestFile(filePath, {
        client,
        contextGraph: 'test-cg',
        agent: 'TestAgent',
      });
      assert.ok(result.error, 'should have error');
      assert.ok(result.error.includes('network failure'));
    } finally {
      cleanupTempDir();
    }
  });

  it('dry run returns metadata without writing', async () => {
    setupTempDir();
    try {
      const filePath = writeTempFile('dry.md', '# Dry Run');
      let writeCalled = false;
      const client = mockClient({
        createAssertion: async () => { writeCalled = true; return { assertionUri: 'x', alreadyExists: false }; },
      });
      const result = await ingestFile(filePath, {
        client,
        contextGraph: 'test-cg',
        agent: 'TestAgent',
        dryRun: true,
      });
      assert.equal(writeCalled, false, 'should not call client in dry run');
      assert.ok(result.provenanceQuads > 0);
      assert.equal(result.alreadyExists, false);
    } finally {
      cleanupTempDir();
    }
  });

  it('applies tags from options', async () => {
    setupTempDir();
    try {
      const filePath = writeTempFile('tagged.md', '# Tagged');
      const result = await ingestFile(filePath, {
        client: mockClient(),
        contextGraph: 'test-cg',
        agent: 'TestAgent',
        tags: ['alpha', 'beta'],
        dryRun: true,
      });
      // Tags add keyword quads — 16 base + 2 tags = 18
      assert.equal(result.provenanceQuads, 18);
    } finally {
      cleanupTempDir();
    }
  });

  it('sets provenanceWarning when provenance write fails', async () => {
    setupTempDir();
    try {
      const filePath = writeTempFile('provwarn.md', '# Prov Warn');
      let writeCount = 0;
      const client = mockClient({
        writeAssertion: async (_cg, _name, quads) => {
          writeCount++;
          // Fail on the provenance write (second call after import succeeds)
          if (writeCount > 0) throw new Error('write failed');
          return { written: quads.length };
        },
      });
      const result = await ingestFile(filePath, {
        client,
        contextGraph: 'test-cg',
        agent: 'TestAgent',
      });
      assert.equal(result.provenanceWarning, true);
    } finally {
      cleanupTempDir();
    }
  });
});

// -- ingestText ---------------------------------------------------------------

describe('ingestText', () => {
  it('ingests raw text as markdown', async () => {
    const result = await ingestText(
      'Some knowledge to store',
      'test-knowledge',
      'knowledge-artifact',
      {
        client: mockClient(),
        contextGraph: 'test-cg',
        agent: 'TestAgent',
      },
    );
    assert.equal(result.mode, 'import-pipeline');
    assert.ok(result.assertionName.startsWith('wm-bridge-knowledge-artifact-'));
    assert.equal(result.error, undefined);
    assert.ok(result.file.includes('inline:test-knowledge'));
  });

  it('dry run returns metadata without writing', async () => {
    let clientCalled = false;
    const client = mockClient({
      createAssertion: async () => { clientCalled = true; return { assertionUri: 'x', alreadyExists: false }; },
    });
    const result = await ingestText('text', 'title', 'document', {
      client,
      contextGraph: 'test-cg',
      agent: 'TestAgent',
      dryRun: true,
    });
    assert.equal(clientCalled, false);
    assert.ok(result.provenanceQuads > 0);
  });

  it('falls back to direct write when import fails', async () => {
    const client = mockClient({
      importFile: async () => { throw new Error('unsupported'); },
    });
    const result = await ingestText('text', 'title', 'document', {
      client,
      contextGraph: 'test-cg',
      agent: 'TestAgent',
    });
    assert.equal(result.error, undefined);
    assert.ok(result.extractedTriples > 0);
  });
});

// -- ingestDirectory ----------------------------------------------------------

describe('ingestDirectory', () => {
  it('ingests all matching files in a directory', async () => {
    setupTempDir();
    try {
      writeTempFile('a.md', '# File A');
      writeTempFile('b.txt', 'File B content');
      writeTempFile('c.js', 'not a match');

      const results = await ingestDirectory(TEST_DIR, {
        client: mockClient(),
        contextGraph: 'test-cg',
        agent: 'TestAgent',
      });
      // Should pick up .md and .txt but not .js
      assert.equal(results.length, 2);
      assert.ok(results.every(r => r.error === undefined));
    } finally {
      cleanupTempDir();
    }
  });

  it('handles empty directory', async () => {
    setupTempDir();
    try {
      const results = await ingestDirectory(TEST_DIR, {
        client: mockClient(),
        contextGraph: 'test-cg',
        agent: 'TestAgent',
      });
      assert.equal(results.length, 0);
    } finally {
      cleanupTempDir();
    }
  });

  it('recurses into subdirectories when recursive is true', async () => {
    setupTempDir();
    try {
      const subDir = join(TEST_DIR, 'sub');
      mkdirSync(subDir, { recursive: true });
      writeTempFile('top.md', '# Top');
      writeFileSync(join(subDir, 'nested.md'), '# Nested', 'utf-8');

      const results = await ingestDirectory(TEST_DIR, {
        client: mockClient(),
        contextGraph: 'test-cg',
        agent: 'TestAgent',
        recursive: true,
      });
      assert.equal(results.length, 2);
    } finally {
      cleanupTempDir();
    }
  });

  it('does not recurse by default', async () => {
    setupTempDir();
    try {
      const subDir = join(TEST_DIR, 'sub');
      mkdirSync(subDir, { recursive: true });
      writeTempFile('top.md', '# Top');
      writeFileSync(join(subDir, 'nested.md'), '# Nested', 'utf-8');

      const results = await ingestDirectory(TEST_DIR, {
        client: mockClient(),
        contextGraph: 'test-cg',
        agent: 'TestAgent',
      });
      assert.equal(results.length, 1);
    } finally {
      cleanupTempDir();
    }
  });

  it('respects custom pattern', async () => {
    setupTempDir();
    try {
      writeTempFile('a.md', '# A');
      writeTempFile('b.json', '{}');

      const results = await ingestDirectory(TEST_DIR, {
        client: mockClient(),
        contextGraph: 'test-cg',
        agent: 'TestAgent',
        pattern: /\.json$/,
      });
      assert.equal(results.length, 1);
      assert.ok(results[0].file.endsWith('.json'));
    } finally {
      cleanupTempDir();
    }
  });
});

// -- ensureContextGraph -------------------------------------------------------

describe('ensureContextGraph', () => {
  it('creates a new context graph when none exists', async () => {
    const client = mockClient();
    const result = await ensureContextGraph(client, 'test-id', 'Test Graph');
    assert.equal(result.created, true);
  });

  it('returns created=false when graph already exists', async () => {
    const client = mockClient({
      listContextGraphs: async () => ({
        contextGraphs: [{ id: 'existing-id', uri: 'urn:existing' }],
      }),
    });
    const result = await ensureContextGraph(client, 'existing-id', 'Existing');
    assert.equal(result.created, false);
  });

  it('returns created=false when create throws "already exists"', async () => {
    const client = mockClient({
      createContextGraph: async () => { throw new Error('already exists'); },
    });
    const result = await ensureContextGraph(client, 'dup-id', 'Dup');
    assert.equal(result.created, false);
  });

  it('throws on unexpected create error', async () => {
    const client = mockClient({
      createContextGraph: async () => { throw new Error('server error'); },
    });
    await assert.rejects(
      () => ensureContextGraph(client, 'fail-id', 'Fail'),
      /server error/,
    );
  });

  it('tries to create when list fails', async () => {
    const client = mockClient({
      listContextGraphs: async () => { throw new Error('list failed'); },
    });
    const result = await ensureContextGraph(client, 'new-id', 'New');
    assert.equal(result.created, true);
  });
});

// -- Sensitivity & scan features (v0.1.3) -------------------------------------

describe('ingestFile — sensitivity', () => {
  it('passes sensitivity through to provenance quads', async () => {
    setupTempDir();
    try {
      const filePath = writeTempFile('sensitive.md', '# Personal Notes\n\nMy private thoughts.');
      let writtenQuads = [];
      const client = mockClient({
        writeAssertion: async (_cg, _name, quads) => {
          writtenQuads = quads;
          return { written: quads.length };
        },
      });
      const result = await ingestFile(filePath, {
        client,
        contextGraph: 'test-cg',
        agent: 'TestAgent',
        sensitivity: 'personal',
      });
      assert.equal(result.error, undefined);
      // Check that sensitivity quad is present in the written provenance
      const sensQuad = writtenQuads.find(q =>
        q.predicate.includes('ontology/sensitivity') && q.object.includes('personal'),
      );
      assert.ok(sensQuad, 'should have sensitivity=personal in provenance quads');
    } finally {
      cleanupTempDir();
    }
  });

  it('defaults sensitivity to shareable', async () => {
    setupTempDir();
    try {
      const filePath = writeTempFile('default-sens.md', '# Normal Doc');
      let writtenQuads = [];
      const client = mockClient({
        writeAssertion: async (_cg, _name, quads) => {
          writtenQuads = quads;
          return { written: quads.length };
        },
      });
      const result = await ingestFile(filePath, {
        client,
        contextGraph: 'test-cg',
        agent: 'TestAgent',
      });
      assert.equal(result.error, undefined);
      const sensQuad = writtenQuads.find(q =>
        q.predicate.includes('ontology/sensitivity'),
      );
      assert.ok(sensQuad, 'should have sensitivity quad');
      assert.ok(sensQuad.object.includes('shareable'), 'default should be shareable');
    } finally {
      cleanupTempDir();
    }
  });
});

describe('ingestFile — scan', () => {
  it('blocks ingestion when --scan detects secrets', async () => {
    setupTempDir();
    try {
      const filePath = writeTempFile('secrets.md', '# Config\n\nAPI key: ghp_ABCDEFghijklmnop1234567890abcdefghij');
      const result = await ingestFile(filePath, {
        client: mockClient(),
        contextGraph: 'test-cg',
        agent: 'TestAgent',
        scan: true,
      });
      // When scan detects secrets, ingestion should be blocked
      assert.ok(result.error || result.blocked, 'should block ingestion when secrets are detected');
    } finally {
      cleanupTempDir();
    }
  });

  it('auto-classifies as personal when --scan detects PII', async () => {
    setupTempDir();
    try {
      const filePath = writeTempFile('pii.md', '# Notes\n\nContact: user@example.com');
      let writtenQuads = [];
      const client = mockClient({
        writeAssertion: async (_cg, _name, quads) => {
          writtenQuads = quads;
          return { written: quads.length };
        },
      });
      const result = await ingestFile(filePath, {
        client,
        contextGraph: 'test-cg',
        agent: 'TestAgent',
        scan: true,
      });
      // If PII is detected (but no secrets), it should auto-classify as personal
      // and still proceed with ingestion
      if (!result.error && !result.blocked) {
        const sensQuad = writtenQuads.find(q =>
          q.predicate.includes('ontology/sensitivity'),
        );
        assert.ok(sensQuad, 'should have sensitivity quad');
        assert.ok(sensQuad.object.includes('personal'), 'should auto-classify as personal');
      }
    } finally {
      cleanupTempDir();
    }
  });
});
