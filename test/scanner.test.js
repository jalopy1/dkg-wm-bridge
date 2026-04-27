/**
 * Unit tests for the scanner module (PII/secret detection).
 * Run with: node --test test/scanner.test.js
 *
 * Tests scanContent() for detecting secrets and PII,
 * redactContent() for replacing matches with [REDACTED],
 * and recommendedSensitivity for correct classification.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { scanContent, redactContent } from '../dist/scanner.js';

// -- Secret detection ---------------------------------------------------------

describe('scanContent — secrets', () => {
  it('detects API keys (generic key patterns)', () => {
    const result = scanContent('api_key=AKIAIOSFODNN7EXAMPLE');
    assert.ok(result.findings.length > 0, 'should detect API key');
    assert.ok(
      result.findings.some(f => f.type === 'secret'),
      'should classify as secret',
    );
  });

  it('detects GitHub tokens (ghp_...)', () => {
    const result = scanContent('token: ghp_ABCDEFghijklmnop1234567890abcdefghij');
    assert.ok(result.findings.length > 0, 'should detect GitHub token');
    assert.ok(
      result.findings.some(f => f.type === 'secret'),
      'should classify as secret',
    );
  });

  it('detects npm tokens (npm_...)', () => {
    const result = scanContent('NPM_TOKEN=npm_abcdefghijklmnopqrstuvwxyz123456');
    assert.ok(result.findings.length > 0, 'should detect npm token');
    assert.ok(
      result.findings.some(f => f.type === 'secret'),
      'should classify as secret',
    );
  });

  it('detects SSH private keys', () => {
    const content = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MhgHcTz6sE2I2yPB
-----END RSA PRIVATE KEY-----`;
    const result = scanContent(content);
    assert.ok(result.findings.length > 0, 'should detect SSH private key');
    assert.ok(
      result.findings.some(f => f.pattern === 'ssh-key'),
      'should detect ssh-key pattern',
    );
  });

  it('recommends secret sensitivity when secrets are found', () => {
    const result = scanContent('ghp_ABCDEFghijklmnop1234567890abcdefghij');
    assert.equal(result.recommendedSensitivity, 'secret');
  });
});

// -- PII detection ------------------------------------------------------------

describe('scanContent — PII', () => {
  it('detects IP addresses', () => {
    const result = scanContent('Server is at 192.168.1.100 on the local network');
    assert.ok(result.findings.length > 0, 'should detect IP address');
    assert.ok(
      result.findings.some(f => f.type === 'pii'),
      'should classify as PII',
    );
  });

  it('detects email addresses', () => {
    const result = scanContent('Contact me at user@example.com for details');
    assert.ok(result.findings.length > 0, 'should detect email');
    assert.ok(
      result.findings.some(f => f.type === 'pii'),
      'should classify as PII',
    );
  });

  it('detects home directory paths', () => {
    const result = scanContent('Config is stored at /home/user/.config/app');
    assert.ok(result.findings.length > 0, 'should detect home path');
    assert.ok(
      result.findings.some(f => f.type === 'pii'),
      'should classify as PII',
    );
  });

  it('recommends personal sensitivity when PII is found', () => {
    const result = scanContent('Email: user@example.com');
    assert.equal(result.recommendedSensitivity, 'personal');
  });
});

// -- Clean content ------------------------------------------------------------

describe('scanContent — clean content', () => {
  it('returns no findings for clean text', () => {
    const result = scanContent('The DKG v10 node supports Working Memory and Shared Memory layers.');
    assert.equal(result.findings.length, 0, 'should have no findings');
  });

  it('recommends shareable (default) sensitivity for clean text', () => {
    const result = scanContent('Just a normal research note about knowledge graphs.');
    assert.equal(result.recommendedSensitivity, 'shareable');
  });
});

// -- Mixed content ------------------------------------------------------------

describe('scanContent — mixed content', () => {
  it('detects both secrets and PII in mixed content', () => {
    const content = `
# My Notes
API key: ghp_ABCDEFghijklmnop1234567890abcdefghij
Contact: user@example.com
Server: 10.0.0.1
    `;
    const result = scanContent(content);
    const types = new Set(result.findings.map(f => f.type));
    assert.ok(types.has('secret'), 'should detect secrets');
    assert.ok(types.has('pii'), 'should detect PII');
  });

  it('recommends secret (highest) when both secrets and PII are present', () => {
    const content = 'ghp_ABCDEFghijklmnop1234567890abcdefghij and user@example.com';
    const result = scanContent(content);
    assert.equal(result.recommendedSensitivity, 'secret', 'secret should take priority over personal');
  });
});

// -- redactContent ------------------------------------------------------------

describe('redactContent', () => {
  it('replaces detected matches with [REDACTED]', () => {
    const content = 'My token is ghp_ABCDEFghijklmnop1234567890abcdefghij ok?';
    const redacted = redactContent(content);
    assert.ok(!redacted.includes('ghp_'), 'should not contain the token');
    assert.ok(redacted.includes('[REDACTED]'), 'should contain [REDACTED] placeholder');
  });

  it('replaces email addresses with [REDACTED]', () => {
    const content = 'Send to user@example.com please';
    const redacted = redactContent(content);
    assert.ok(!redacted.includes('user@example.com'), 'should not contain the email');
    assert.ok(redacted.includes('[REDACTED]'), 'should contain [REDACTED] placeholder');
  });

  it('returns clean text unchanged', () => {
    const content = 'Nothing sensitive here at all.';
    const redacted = redactContent(content);
    assert.equal(redacted, content, 'clean text should be unchanged');
  });

  it('handles multiple matches', () => {
    const content = 'Keys: ghp_ABCDEFghijklmnop1234567890abcdefghij and npm_abcdefghijklmnopqrstuvwxyz1234567890';
    const redacted = redactContent(content);
    assert.ok(!redacted.includes('ghp_'), 'should redact GitHub token');
    assert.ok(!redacted.includes('npm_'), 'should redact npm token');
    const count = (redacted.match(/\[REDACTED\]/g) || []).length;
    assert.ok(count >= 2, 'should have at least 2 redactions');
  });
});
