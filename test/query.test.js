/**
 * Unit tests for the query command / queryArtifacts function.
 * Run with: node --test test/query.test.js
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { queryArtifacts, buildArtifactSparql } from '../dist/query.js';

// -- Mock DkgClient -----------------------------------------------------------

function cannedBindings() {
  return [
    {
      s: 'urn:dkg:wm-bridge:artifact/abc123',
      name: '"Daily Memory 2026-04-25"',
      kind: '"memory-daily"',
      status: '"draft"',
      sensitivity: '"shareable"',
      date: '"2026-04-25T12:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>',
      sha256: '"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"',
      tags: '"ai,dkg"',
      content: '"This is the content of the daily memory note for testing purposes and it goes on for a while to test truncation behavior."',
    },
    {
      s: 'urn:dkg:wm-bridge:artifact/def456',
      name: '"Research Note on DKG"',
      kind: '"research-note"',
      status: '"reviewed"',
      sensitivity: '"personal"',
      date: '"2026-04-24T10:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>',
      sha256: '"f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5"',
      tags: '"research"',
      content: '"Deep dive into DKG v10 architecture and working memory semantics."',
    },
  ];
}

function mockClient(bindings) {
  let lastSparql = null;
  let lastOpts = null;
  return {
    query: async (sparql, opts) => {
      lastSparql = sparql;
      lastOpts = opts;
      return { result: { bindings } };
    },
    getAgentAddress: async () => '0xMOCKADDRESS',
    get lastSparql() { return lastSparql; },
    get lastOpts() { return lastOpts; },
  };
}

// -- buildArtifactSparql tests ------------------------------------------------

describe('buildArtifactSparql', () => {
  it('builds SPARQL with no filters', () => {
    const sparql = buildArtifactSparql({});
    assert.ok(sparql.includes('AgentArtifact'), 'should query for AgentArtifact type');
    assert.ok(sparql.includes('schema.org/name'), 'should select name');
    assert.ok(sparql.includes('ontology/status'), 'should select status');
    assert.ok(sparql.includes('ontology/artifactKind'), 'should select kind');
    assert.ok(sparql.includes('ontology/sensitivity'), 'should select sensitivity');
    assert.ok(sparql.includes('schema.org/sha256'), 'should select sha256');
    assert.ok(sparql.includes('LIMIT 10'), 'should default to limit 10');
    // No FILTER clauses when no filters
    assert.ok(!sparql.includes('FILTER('), 'should have no FILTER when no filters given');
  });

  it('builds SPARQL with kind filter', () => {
    const sparql = buildArtifactSparql({ kind: 'memory-daily' });
    assert.ok(sparql.includes('FILTER'), 'should have a FILTER clause');
    assert.ok(sparql.includes('memory-daily'), 'should filter by kind');
  });

  it('builds SPARQL with sensitivity filter', () => {
    const sparql = buildArtifactSparql({ sensitivity: 'personal' });
    assert.ok(sparql.includes('FILTER'), 'should have a FILTER clause');
    assert.ok(sparql.includes('personal'), 'should filter by sensitivity');
  });

  it('builds SPARQL with search term', () => {
    const sparql = buildArtifactSparql({ searchTerm: 'DKG' });
    assert.ok(sparql.includes('FILTER'), 'should have a FILTER clause');
    assert.ok(sparql.includes('CONTAINS') || sparql.includes('REGEX') || sparql.includes('contains') || sparql.includes('regex'),
      'should use string matching');
    assert.ok(sparql.toLowerCase().includes('dkg'), 'should include the search term (case-insensitive)');
  });

  it('respects custom limit', () => {
    const sparql = buildArtifactSparql({ limit: 25 });
    assert.ok(sparql.includes('LIMIT 25'), 'should use custom limit');
  });

  it('combines multiple filters', () => {
    const sparql = buildArtifactSparql({ kind: 'document', sensitivity: 'public', searchTerm: 'test', limit: 5 });
    assert.ok(sparql.includes('document'), 'should include kind filter');
    assert.ok(sparql.includes('public'), 'should include sensitivity filter');
    assert.ok(sparql.toLowerCase().includes('test'), 'should include search term');
    assert.ok(sparql.includes('LIMIT 5'), 'should use limit 5');
  });
});

// -- queryArtifacts tests -----------------------------------------------------

describe('queryArtifacts', () => {
  it('returns structured results with no filters', async () => {
    const client = mockClient(cannedBindings());
    const results = await queryArtifacts(client, 'test-cg', {});
    assert.equal(results.length, 2, 'should return 2 artifacts');
    assert.equal(results[0].name, 'Daily Memory 2026-04-25');
    assert.equal(results[0].kind, 'memory-daily');
    assert.equal(results[0].status, 'draft');
    assert.equal(results[0].sensitivity, 'shareable');
    assert.ok(results[0].uri, 'should have a URI');
  });

  it('passes contextGraphId and view to client.query', async () => {
    const client = mockClient([]);
    await queryArtifacts(client, 'my-cg', {});
    assert.equal(client.lastOpts.contextGraphId, 'my-cg');
    assert.equal(client.lastOpts.view, 'working-memory');
  });

  it('cleans RDF literal values', async () => {
    const client = mockClient(cannedBindings());
    const results = await queryArtifacts(client, 'test-cg', {});
    // Values should be cleaned of RDF literal quotes and datatype suffixes
    assert.ok(!results[0].name.startsWith('"'), 'name should not start with quote');
    assert.ok(!results[0].date.includes('^^'), 'date should not contain datatype suffix');
  });

  it('returns empty array when no results', async () => {
    const client = mockClient([]);
    const results = await queryArtifacts(client, 'test-cg', {});
    assert.deepEqual(results, []);
  });

  it('includes content preview truncated to 200 chars', async () => {
    const longContent = '"' + 'A'.repeat(300) + '"';
    const client = mockClient([{
      ...cannedBindings()[0],
      content: longContent,
    }]);
    const results = await queryArtifacts(client, 'test-cg', {});
    assert.ok(results[0].contentPreview.length <= 203, 'content preview should be truncated (200 + "...")');
  });

  it('formats results as JSON when format is json', async () => {
    const client = mockClient(cannedBindings());
    const results = await queryArtifacts(client, 'test-cg', { format: 'json' });
    // Should still return structured data (JSON serializable)
    const json = JSON.stringify(results);
    assert.ok(json, 'results should be JSON serializable');
    const parsed = JSON.parse(json);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].name, 'Daily Memory 2026-04-25');
  });

  it('passes kind filter into SPARQL', async () => {
    const client = mockClient([]);
    await queryArtifacts(client, 'test-cg', { kind: 'research-note' });
    assert.ok(client.lastSparql.includes('research-note'), 'SPARQL should contain kind filter');
  });

  it('passes sensitivity filter into SPARQL', async () => {
    const client = mockClient([]);
    await queryArtifacts(client, 'test-cg', { sensitivity: 'secret' });
    assert.ok(client.lastSparql.includes('secret'), 'SPARQL should contain sensitivity filter');
  });

  it('passes search term into SPARQL', async () => {
    const client = mockClient([]);
    await queryArtifacts(client, 'test-cg', { searchTerm: 'memory' });
    assert.ok(client.lastSparql.toLowerCase().includes('memory'), 'SPARQL should contain search term');
  });

  it('passes limit into SPARQL', async () => {
    const client = mockClient([]);
    await queryArtifacts(client, 'test-cg', { limit: 3 });
    assert.ok(client.lastSparql.includes('LIMIT 3'), 'SPARQL should contain limit');
  });
});

// -- Security tests -----------------------------------------------------------

describe('SPARQL injection prevention', () => {
  it('escapes backslash-quote sequences that could break out of string literals', () => {
    // Attack: \" closes the escaped quote, leaving raw " to end the literal
    const sparql = buildArtifactSparql({ searchTerm: '\\" ) } DELETE WHERE { ?s ?p ?o } #' });
    // The backslash should be double-escaped, quote should be escaped
    // Result in SPARQL: \\\\" — which is escaped-backslash + escaped-quote, still inside the string
    assert.ok(!sparql.includes('DELETE WHERE'), 'injected SPARQL should be inside the string literal, not executable');
    // Verify the FILTER is still syntactically a single string
    const filterMatch = sparql.match(/FILTER\(CONTAINS\(LCASE\(\?name\), "([^]*)"\)\)/);
    assert.ok(filterMatch, 'FILTER should still be well-formed');
  });

  it('escapes double quotes in search terms', () => {
    const sparql = buildArtifactSparql({ searchTerm: '" } DELETE WHERE { ?s ?p ?o } #' });
    // The quote should be escaped as \"
    assert.ok(sparql.includes('\\"'), 'double quotes should be escaped');
    assert.ok(!sparql.includes('DELETE WHERE { ?s ?p ?o }'), 'injected SPARQL should not appear as raw query');
  });

  it('escapes newlines in search terms', () => {
    const sparql = buildArtifactSparql({ searchTerm: 'test\n} DELETE WHERE { ?s ?p ?o }' });
    assert.ok(!sparql.includes('\n}'), 'raw newline should not appear');
    assert.ok(sparql.includes('\\n'), 'newline should be escaped');
  });

  it('handles script injection attempts safely', () => {
    const sparql = buildArtifactSparql({ searchTerm: '<script>alert(1)</script>' });
    // Should be treated as a plain string, not break SPARQL syntax
    assert.ok(sparql.includes('CONTAINS'), 'FILTER should still be present');
    assert.ok(sparql.includes('<script>alert(1)</script>'), 'HTML should pass through as literal text');
  });

  it('handles SQL injection attempts safely', () => {
    const sparql = buildArtifactSparql({ searchTerm: "'; DROP TABLE" });
    assert.ok(sparql.includes('CONTAINS'), 'FILTER should still be present');
  });

  it('rejects invalid kind values', () => {
    assert.throws(
      () => buildArtifactSparql({ kind: '" } DELETE WHERE { ?s ?p ?o } #' }),
      /Invalid kind/,
      'should reject kind values not in allowlist',
    );
  });

  it('rejects invalid sensitivity values', () => {
    assert.throws(
      () => buildArtifactSparql({ sensitivity: '" } DELETE WHERE { ?s ?p ?o } #' }),
      /Invalid sensitivity/,
      'should reject sensitivity values not in allowlist',
    );
  });
});

describe('limit bounds checking', () => {
  it('clamps limit to minimum of 1', () => {
    const sparql = buildArtifactSparql({ limit: 0 });
    assert.ok(sparql.includes('LIMIT 1'), 'limit 0 should be clamped to 1');
  });

  it('clamps negative limit to 1', () => {
    const sparql = buildArtifactSparql({ limit: -1 });
    assert.ok(sparql.includes('LIMIT 1'), 'negative limit should be clamped to 1');
  });

  it('clamps excessively large limit to 1000', () => {
    const sparql = buildArtifactSparql({ limit: 999999999 });
    assert.ok(sparql.includes('LIMIT 1000'), 'huge limit should be clamped to 1000');
  });

  it('allows valid limits within range', () => {
    const sparql = buildArtifactSparql({ limit: 50 });
    assert.ok(sparql.includes('LIMIT 50'), 'valid limit should pass through');
  });
});
