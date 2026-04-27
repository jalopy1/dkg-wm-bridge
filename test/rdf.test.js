/**
 * Unit tests for RDF triple generation.
 * Run with: node --test test/rdf.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  artifactToQuads,
  assertionName,
  extractTitle,
  detectKind,
  provenanceQuads,
  artifactUri,
  sourceHash,
  SCHEMA,
  WMBO,
} from '../dist/rdf.js';

// -- Helpers ------------------------------------------------------------------

function baseMeta(overrides = {}) {
  return {
    source: 'test.md',
    title: 'Test Doc',
    content: 'Hello world',
    kind: 'document',
    timestamp: '2026-04-25T12:00:00Z',
    agent: 'TestAgent',
    status: 'draft',
    ...overrides,
  };
}

function findQuad(quads, pred, objFragment) {
  return quads.find(q =>
    (pred === undefined || q.predicate.includes(pred)) &&
    (objFragment === undefined || q.object.includes(objFragment)),
  );
}

function findAllQuads(quads, pred) {
  return quads.filter(q => q.predicate.includes(pred));
}

// -- extractTitle -------------------------------------------------------------

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

// -- detectKind ---------------------------------------------------------------

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

// -- assertionName ------------------------------------------------------------

describe('assertionName', () => {
  it('generates deterministic names', () => {
    const meta = baseMeta({ source: 'memory/2026-04-25.md', kind: 'memory-daily' });
    const name1 = assertionName(meta);
    const name2 = assertionName(meta);
    assert.equal(name1, name2);
    assert.ok(name1.startsWith('wm-bridge-memory-daily-'));
  });

  it('produces different names for different sources', () => {
    const n1 = assertionName(baseMeta({ source: 'a.md' }));
    const n2 = assertionName(baseMeta({ source: 'b.md' }));
    assert.notEqual(n1, n2);
  });
});

// -- artifactToQuads ----------------------------------------------------------

describe('artifactToQuads', () => {
  it('generates expected quad count', () => {
    const quads = artifactToQuads(baseMeta({ tags: ['test', 'demo'] }));
    // 2 types + 6 schema (name,dateCreated,author,encodingFormat,sha256,text) + 3 prov + 3 wmbo + 1 sensitivity + 2 tags + 2 agent = 19
    assert.equal(quads.length, 19);
  });

  it('includes schema.org type', () => {
    const quads = artifactToQuads(baseMeta());
    const typeQuad = findQuad(quads, 'rdf-syntax-ns#type', 'schema.org');
    assert.ok(typeQuad, 'should have schema.org type');
  });

  it('includes provenance', () => {
    const quads = artifactToQuads(baseMeta());
    const provQuad = findQuad(quads, 'prov#wasGeneratedBy');
    assert.ok(provQuad, 'should have PROV-O provenance');
  });

  it('uses DKG peer ID when provided', () => {
    const quads = artifactToQuads(baseMeta({ agentPeerId: '12D3KooWTest' }));
    const agentQuad = findQuad(quads, undefined, 'did:dkg:agent:12D3KooWTest');
    assert.ok(agentQuad, 'should use DKG peer ID in agent URI');
  });
});

// -- provenanceQuads ----------------------------------------------------------

describe('provenanceQuads', () => {
  it('generates correct number of quads without tags', () => {
    const quads = provenanceQuads(baseMeta());
    // 2 types + 5 schema (name,dateCreated,author,encodingFormat,sha256) + 3 prov + 3 wmbo + 1 sensitivity + 2 agent = 16
    assert.equal(quads.length, 16);
  });

  it('generates correct number of quads with tags', () => {
    const quads = provenanceQuads(baseMeta({ tags: ['alpha', 'beta', 'gamma'] }));
    // 16 base + 3 tags = 19
    assert.equal(quads.length, 19);
  });

  // -- RDF type triples
  it('includes DigitalDocument type', () => {
    const quads = provenanceQuads(baseMeta());
    const typeQuad = findQuad(quads, 'rdf-syntax-ns#type', 'schema.org/DigitalDocument');
    assert.ok(typeQuad, 'should have DigitalDocument type');
  });

  it('includes AgentArtifact type', () => {
    const quads = provenanceQuads(baseMeta());
    const typeQuad = findQuad(quads, 'rdf-syntax-ns#type', 'AgentArtifact');
    assert.ok(typeQuad, 'should have AgentArtifact type');
  });

  // -- PROV-O triples
  it('includes prov:wasGeneratedBy', () => {
    const quads = provenanceQuads(baseMeta());
    const q = findQuad(quads, 'prov#wasGeneratedBy');
    assert.ok(q, 'should have wasGeneratedBy');
    assert.ok(q.object.includes('wm-bridge:agent/TestAgent'), 'object should be agent URI');
  });

  it('includes prov:generatedAtTime', () => {
    const quads = provenanceQuads(baseMeta());
    const q = findQuad(quads, 'prov#generatedAtTime');
    assert.ok(q, 'should have generatedAtTime');
    assert.ok(q.object.includes('2026-04-25T12:00:00Z'), 'should contain the timestamp');
  });

  it('includes dcterms:source', () => {
    const quads = provenanceQuads(baseMeta());
    const q = findQuad(quads, 'dc/terms/source');
    assert.ok(q, 'should have dcterms:source');
    assert.ok(q.object.includes('test.md'), 'should contain source path');
  });

  // -- schema.org triples
  it('includes schema:name', () => {
    const quads = provenanceQuads(baseMeta());
    const q = findQuad(quads, 'schema.org/name', 'Test Doc');
    assert.ok(q, 'should have schema:name with title');
  });

  it('includes schema:dateCreated', () => {
    const quads = provenanceQuads(baseMeta());
    const q = findQuad(quads, 'schema.org/dateCreated');
    assert.ok(q, 'should have schema:dateCreated');
    assert.ok(q.object.includes('2026-04-25T12:00:00Z'), 'should contain timestamp');
  });

  it('includes schema:author pointing to agent', () => {
    const quads = provenanceQuads(baseMeta());
    const q = findQuad(quads, 'schema.org/author');
    assert.ok(q, 'should have schema:author');
    assert.ok(q.object.includes('agent/TestAgent'), 'should point to agent URI');
  });

  it('includes schema:encodingFormat', () => {
    const quads = provenanceQuads(baseMeta());
    const q = findQuad(quads, 'schema.org/encodingFormat');
    assert.ok(q, 'should have encodingFormat');
    assert.ok(q.object.includes('text/markdown'), 'should be text/markdown');
  });

  // -- Tags → keywords
  it('generates keywords triples for tags', () => {
    const quads = provenanceQuads(baseMeta({ tags: ['ai', 'dkg'] }));
    const kwQuads = findAllQuads(quads, 'schema.org/keywords');
    assert.equal(kwQuads.length, 2, 'should have 2 keyword quads');
    const values = kwQuads.map(q => q.object);
    assert.ok(values.some(v => v.includes('ai')), 'should include "ai" tag');
    assert.ok(values.some(v => v.includes('dkg')), 'should include "dkg" tag');
  });

  it('generates no keywords when tags are empty', () => {
    const quads = provenanceQuads(baseMeta({ tags: [] }));
    const kwQuads = findAllQuads(quads, 'schema.org/keywords');
    assert.equal(kwQuads.length, 0, 'should have no keyword quads');
  });

  it('generates no keywords when tags are undefined', () => {
    const quads = provenanceQuads(baseMeta());
    const kwQuads = findAllQuads(quads, 'schema.org/keywords');
    assert.equal(kwQuads.length, 0, 'should have no keyword quads');
  });

  // -- Agent peer ID → DID URI
  it('uses DID-based agent URI when agentPeerId is provided', () => {
    const quads = provenanceQuads(baseMeta({ agentPeerId: '12D3KooWAbcDef' }));
    const authorQ = findQuad(quads, 'schema.org/author');
    assert.ok(authorQ, 'should have author quad');
    assert.equal(authorQ.object, 'did:dkg:agent:12D3KooWAbcDef', 'author should be DID URI');

    const provQ = findQuad(quads, 'prov#wasGeneratedBy');
    assert.equal(provQ.object, 'did:dkg:agent:12D3KooWAbcDef', 'wasGeneratedBy should be DID URI');

    // Agent type triple should also use DID URI as subject
    const agentTypeQ = quads.find(
      q => q.subject === 'did:dkg:agent:12D3KooWAbcDef' && q.predicate.includes('rdf-syntax-ns#type'),
    );
    assert.ok(agentTypeQ, 'agent type triple should use DID URI as subject');
    assert.ok(agentTypeQ.object.includes('SoftwareAgent'), 'agent should be typed as SoftwareAgent');
  });

  it('uses fallback agent URI when agentPeerId is absent', () => {
    const quads = provenanceQuads(baseMeta());
    const authorQ = findQuad(quads, 'schema.org/author');
    assert.ok(authorQ.object.includes('wm-bridge:agent/TestAgent'), 'should use fallback agent URI');
  });

  // -- WM Bridge ontology triples
  it('includes artifactKind', () => {
    const quads = provenanceQuads(baseMeta({ kind: 'research-note' }));
    const q = findQuad(quads, 'ontology/artifactKind');
    assert.ok(q, 'should have artifactKind');
    assert.ok(q.object.includes('research-note'), 'should contain the kind value');
  });

  it('includes status', () => {
    const quads = provenanceQuads(baseMeta({ status: 'reviewed' }));
    const q = findQuad(quads, 'ontology/status');
    assert.ok(q, 'should have status');
    assert.ok(q.object.includes('reviewed'), 'should contain the status value');
  });

  it('includes sourceFile', () => {
    const quads = provenanceQuads(baseMeta({ source: '/path/to/file.md' }));
    const q = findQuad(quads, 'ontology/sourceFile');
    assert.ok(q, 'should have sourceFile');
    assert.ok(q.object.includes('/path/to/file.md'), 'should contain the source path');
  });

  // -- Agent identity triples
  it('marks agent as prov:SoftwareAgent', () => {
    const quads = provenanceQuads(baseMeta());
    const agentTypeQ = quads.find(
      q => q.subject.includes('agent/TestAgent') && q.predicate.includes('rdf-syntax-ns#type'),
    );
    assert.ok(agentTypeQ, 'should have agent type triple');
    assert.ok(agentTypeQ.object.includes('SoftwareAgent'), 'should be SoftwareAgent');
  });

  it('includes agent schema:name', () => {
    const quads = provenanceQuads(baseMeta());
    const agentNameQ = quads.find(
      q => q.subject.includes('agent/TestAgent') && q.predicate.includes('schema.org/name'),
    );
    assert.ok(agentNameQ, 'should have agent name triple');
    assert.ok(agentNameQ.object.includes('TestAgent'), 'should contain agent name');
  });

  // -- Sensitivity triple (wmbo:sensitivity)
  it('includes wmbo:sensitivity with default value shareable', () => {
    const quads = provenanceQuads(baseMeta());
    const sensQ = findQuad(quads, 'ontology/sensitivity');
    assert.ok(sensQ, 'should have wmbo:sensitivity quad');
    assert.ok(sensQ.object.includes('shareable'), 'default sensitivity should be shareable');
  });

  it('sets custom sensitivity value when provided', () => {
    const quads = provenanceQuads(baseMeta({ sensitivity: 'personal' }));
    const sensQ = findQuad(quads, 'ontology/sensitivity');
    assert.ok(sensQ, 'should have wmbo:sensitivity quad');
    assert.ok(sensQ.object.includes('personal'), 'sensitivity should be personal');
  });

  it('sets sensitivity to secret when provided', () => {
    const quads = provenanceQuads(baseMeta({ sensitivity: 'secret' }));
    const sensQ = findQuad(quads, 'ontology/sensitivity');
    assert.ok(sensQ, 'should have wmbo:sensitivity quad');
    assert.ok(sensQ.object.includes('secret'), 'sensitivity should be secret');
  });

  it('sets sensitivity to public when provided', () => {
    const quads = provenanceQuads(baseMeta({ sensitivity: 'public' }));
    const sensQ = findQuad(quads, 'ontology/sensitivity');
    assert.ok(sensQ, 'should have wmbo:sensitivity quad');
    assert.ok(sensQ.object.includes('public'), 'sensitivity should be public');
  });

  // -- Does NOT include raw content (unlike artifactToQuads)
  it('does not include schema:text content blob', () => {
    const quads = provenanceQuads(baseMeta());
    const textQ = findQuad(quads, 'schema.org/text');
    assert.equal(textQ, undefined, 'provenanceQuads should NOT include text content');
  });

  // -- Content integrity hash
  it('includes schema:sha256 content hash', () => {
    const quads = provenanceQuads(baseMeta());
    const shaQ = findQuad(quads, 'schema.org/sha256');
    assert.ok(shaQ, 'should have sha256 quad');
    const hash = shaQ.object.replace(/^"|"$/g, '');
    assert.strictEqual(hash.length, 64, 'sha256 should be 64 hex chars');
  });

  // -- Literal escaping (tested indirectly via quad objects)
  it('escapes double quotes in title', () => {
    const quads = provenanceQuads(baseMeta({ title: 'He said "hello"' }));
    const nameQ = findQuad(quads, 'schema.org/name');
    assert.ok(nameQ, 'should have name quad');
    // The literal() function wraps in quotes and escapes inner quotes:
    // Input: He said "hello"  →  Output: "He said \"hello\""
    assert.ok(nameQ.object.includes('\\"hello\\"'), 'inner quotes should be escaped with backslash');
  });

  it('escapes backslashes in title', () => {
    const quads = provenanceQuads(baseMeta({ title: 'path\\to\\file' }));
    const nameQ = findQuad(quads, 'schema.org/name');
    assert.ok(nameQ.object.includes('path\\\\to\\\\file'), 'backslashes should be double-escaped');
  });

  it('escapes newlines in source path', () => {
    const quads = provenanceQuads(baseMeta({ source: 'line1\nline2' }));
    const srcQ = findQuad(quads, 'ontology/sourceFile');
    assert.ok(srcQ, 'should have sourceFile quad');
    assert.ok(srcQ.object.includes('\\n'), 'newline should be escaped');
    assert.ok(!srcQ.object.includes('\n'), 'should not contain raw newline');
  });

  it('escapes tabs in tags', () => {
    const quads = provenanceQuads(baseMeta({ tags: ['tab\there'] }));
    const kwQ = findQuad(quads, 'schema.org/keywords');
    assert.ok(kwQ.object.includes('\\t'), 'tab should be escaped');
  });

  it('escapes carriage returns', () => {
    const quads = provenanceQuads(baseMeta({ title: 'cr\rhere' }));
    const nameQ = findQuad(quads, 'schema.org/name');
    assert.ok(nameQ.object.includes('\\r'), 'carriage return should be escaped');
  });
});

// -- artifactUri & sourceHash -------------------------------------------------

describe('artifactUri', () => {
  it('generates deterministic URIs', () => {
    const meta = baseMeta();
    const uri1 = artifactUri(meta);
    const uri2 = artifactUri(meta);
    assert.equal(uri1, uri2);
  });

  it('starts with the WMB namespace', () => {
    const uri = artifactUri(baseMeta());
    assert.ok(uri.startsWith('urn:dkg:wm-bridge:artifact/'), 'should start with WMB artifact prefix');
  });

  it('differs for different source+timestamp combos', () => {
    const uri1 = artifactUri(baseMeta({ source: 'a.md' }));
    const uri2 = artifactUri(baseMeta({ source: 'b.md' }));
    assert.notEqual(uri1, uri2);
  });
});

describe('sourceHash', () => {
  it('returns a 16-char hex string', () => {
    const hash = sourceHash('test input');
    assert.equal(hash.length, 16);
    assert.match(hash, /^[0-9a-f]{16}$/);
  });

  it('is deterministic', () => {
    assert.equal(sourceHash('same'), sourceHash('same'));
  });

  it('differs for different inputs', () => {
    assert.notEqual(sourceHash('a'), sourceHash('b'));
  });
});
