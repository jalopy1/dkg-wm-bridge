/**
 * Unit tests for RDF triple generation.
 * Run with: node --test test/rdf.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { artifactToQuads, assertionName, extractTitle, detectKind } from '../dist/rdf.js';

describe('extractTitle', () => {
  it('extracts first heading from markdown', () => {
    assert.equal(extractTitle('# My Title\n\nSome content', 'file.md'), 'My Title');
  });

  it('falls back to filename when no heading', () => {
    assert.equal(extractTitle('Just some text', 'my-research-note.md'), 'my research note');
  });

  it('handles ## headings (should not match)', () => {
    assert.equal(extractTitle('## Sub heading\ntext', 'fallback.md'), 'fallback');
  });
});

describe('detectKind', () => {
  it('detects daily memory files', () => {
    assert.equal(detectKind('memory/2026-04-25.md'), 'memory-daily');
  });

  it('detects long-term memory', () => {
    assert.equal(detectKind('MEMORY.md'), 'memory-longterm');
  });

  it('detects research notes', () => {
    assert.equal(detectKind('projects/context-oracle/notes.md'), 'research-note');
  });

  it('defaults to document', () => {
    assert.equal(detectKind('random-file.md'), 'document');
  });
});

describe('assertionName', () => {
  it('generates deterministic names', () => {
    const meta = {
      source: 'memory/2026-04-25.md',
      title: 'Daily Log',
      content: 'test',
      kind: 'memory-daily',
      timestamp: '2026-04-25T00:00:00Z',
      agent: 'Navi',
      status: 'draft',
    };
    const name1 = assertionName(meta);
    const name2 = assertionName(meta);
    assert.equal(name1, name2);
    assert.ok(name1.startsWith('wm-bridge-memory-daily-'));
  });

  it('produces different names for different sources', () => {
    const base = { title: 'Test', content: 'x', kind: 'document', timestamp: '2026-04-25T00:00:00Z', agent: 'Navi', status: 'draft' };
    const n1 = assertionName({ ...base, source: 'a.md' });
    const n2 = assertionName({ ...base, source: 'b.md' });
    assert.notEqual(n1, n2);
  });
});

describe('artifactToQuads', () => {
  it('generates expected quad count', () => {
    const meta = {
      source: 'test.md',
      title: 'Test Doc',
      content: 'Hello world',
      kind: 'document',
      timestamp: '2026-04-25T12:00:00Z',
      agent: 'Navi',
      status: 'draft',
      tags: ['test', 'demo'],
    };
    const quads = artifactToQuads(meta);
    // 2 types + 5 schema + 3 prov + 3 wmbo + 2 tags + 2 agent = 17
    assert.equal(quads.length, 17);
  });

  it('includes schema.org type', () => {
    const meta = {
      source: 'test.md', title: 'T', content: 'C', kind: 'document',
      timestamp: '2026-04-25T00:00:00Z', agent: 'Navi', status: 'draft',
    };
    const quads = artifactToQuads(meta);
    const typeQuad = quads.find(q => q.predicate.includes('rdf-syntax-ns#type') && q.object.includes('schema.org'));
    assert.ok(typeQuad, 'should have schema.org type');
  });

  it('includes provenance', () => {
    const meta = {
      source: 'test.md', title: 'T', content: 'C', kind: 'document',
      timestamp: '2026-04-25T00:00:00Z', agent: 'Navi', status: 'draft',
    };
    const quads = artifactToQuads(meta);
    const provQuad = quads.find(q => q.predicate.includes('prov#wasGeneratedBy'));
    assert.ok(provQuad, 'should have PROV-O provenance');
  });

  it('uses DKG peer ID when provided', () => {
    const meta = {
      source: 'test.md', title: 'T', content: 'C', kind: 'document',
      timestamp: '2026-04-25T00:00:00Z', agent: 'Navi', agentPeerId: '12D3KooWTest', status: 'draft',
    };
    const quads = artifactToQuads(meta);
    const agentQuad = quads.find(q => q.object.includes('did:dkg:agent:12D3KooWTest'));
    assert.ok(agentQuad, 'should use DKG peer ID in agent URI');
  });
});
