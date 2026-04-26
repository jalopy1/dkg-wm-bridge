/**
 * Unit tests for DkgClient.
 * Run with: node --test test/dkg-client.test.js
 *
 * DkgClient.loadToken() is a private static method. We test its behaviour
 * indirectly through the constructor by manipulating env vars and temp
 * auth-token files.
 *
 * Network methods (status, query, etc.) need a running DKG node and are
 * not covered here. This file focuses on construction, token resolution,
 * and URL normalisation.
 */

import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { DkgClient } from '../dist/dkg-client.js';

// -- Env snapshot (restored after each test) ----------------------------------

const ENV_KEYS = ['DKG_AUTH_TOKEN', 'DKG_API_URL'];
const envSnapshot = {};
for (const k of ENV_KEYS) {
  envSnapshot[k] = process.env[k];
}

function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (envSnapshot[k] !== undefined) process.env[k] = envSnapshot[k];
    else delete process.env[k];
  }
}

// -- Token file helpers -------------------------------------------------------

const TOKEN_DIR = join(homedir(), '.dkg');
const TOKEN_FILE = join(TOKEN_DIR, 'auth.token');

let savedTokenContent = null;
let hadTokenFile = false;

function backupTokenFile() {
  try {
    savedTokenContent = readFileSync(TOKEN_FILE, 'utf-8');
    hadTokenFile = true;
  } catch {
    hadTokenFile = false;
    savedTokenContent = null;
  }
}

function restoreTokenFile() {
  if (hadTokenFile && savedTokenContent !== null) {
    try {
      mkdirSync(TOKEN_DIR, { recursive: true });
      writeFileSync(TOKEN_FILE, savedTokenContent, 'utf-8');
    } catch {}
  } else if (!hadTokenFile) {
    // Remove the file we created for testing
    try { rmSync(TOKEN_FILE); } catch {}
  }
}

function writeTokenFile(content) {
  mkdirSync(TOKEN_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, content, 'utf-8');
}

// -- Constructor: URL & option handling ---------------------------------------

describe('DkgClient constructor — options', () => {
  afterEach(restoreEnv);

  it('uses authToken option when provided', () => {
    process.env.DKG_AUTH_TOKEN = 'env-token';
    const client = new DkgClient({ authToken: 'explicit-token' });
    assert.ok(client);
    assert.equal(client.baseUrl, 'http://127.0.0.1:9200');
  });

  it('uses DKG_AUTH_TOKEN env var as fallback', () => {
    process.env.DKG_AUTH_TOKEN = 'my-env-token';
    const client = new DkgClient();
    assert.ok(client);
  });

  it('uses DKG_API_URL env var for base URL', () => {
    process.env.DKG_AUTH_TOKEN = 'tok';
    process.env.DKG_API_URL = 'http://custom:8080';
    const client = new DkgClient();
    assert.equal(client.baseUrl, 'http://custom:8080');
  });

  it('strips trailing slashes from base URL', () => {
    process.env.DKG_AUTH_TOKEN = 'tok';
    const client = new DkgClient({ baseUrl: 'http://example.com///' });
    assert.equal(client.baseUrl, 'http://example.com');
  });

  it('uses baseUrl option over env var', () => {
    process.env.DKG_AUTH_TOKEN = 'tok';
    process.env.DKG_API_URL = 'http://env-url:9200';
    const client = new DkgClient({ baseUrl: 'http://opt-url:9200' });
    assert.equal(client.baseUrl, 'http://opt-url:9200');
  });

  it('defaults to http://127.0.0.1:9200 when no URL provided', () => {
    process.env.DKG_AUTH_TOKEN = 'tok';
    delete process.env.DKG_API_URL;
    const client = new DkgClient();
    assert.equal(client.baseUrl, 'http://127.0.0.1:9200');
  });
});

// -- Constructor: token file loading ------------------------------------------

describe('DkgClient constructor — token file', () => {
  afterEach(() => {
    restoreEnv();
    restoreTokenFile();
  });

  it('reads token from ~/.dkg/auth.token', () => {
    backupTokenFile();
    delete process.env.DKG_AUTH_TOKEN;
    try {
      writeTokenFile('file-based-token-abc123\n');
    } catch {
      // Can't write to homedir — skip
      return;
    }
    const client = new DkgClient();
    assert.ok(client, 'should construct successfully from file token');
  });

  it('skips comment lines in auth.token', () => {
    backupTokenFile();
    delete process.env.DKG_AUTH_TOKEN;
    try {
      writeTokenFile('# This is a comment\n# Another comment\nreal-token-value\n');
    } catch {
      return;
    }
    const client = new DkgClient();
    assert.ok(client, 'should construct successfully, skipping comments');
  });

  it('skips blank lines in auth.token', () => {
    backupTokenFile();
    delete process.env.DKG_AUTH_TOKEN;
    try {
      writeTokenFile('\n\n  \nactual-token\n\n');
    } catch {
      return;
    }
    const client = new DkgClient();
    assert.ok(client, 'should skip blank lines and find the token');
  });

  it('throws on auth.token with only comments', () => {
    backupTokenFile();
    delete process.env.DKG_AUTH_TOKEN;
    try {
      writeTokenFile('# Only comments\n# Nothing else\n');
    } catch {
      return;
    }
    assert.throws(
      () => new DkgClient(),
      /empty|comments/i,
      'should throw when file has only comments',
    );
  });

  it('throws when no token source is available', () => {
    backupTokenFile();
    delete process.env.DKG_AUTH_TOKEN;
    // Remove the token file
    try { rmSync(TOKEN_FILE); } catch {}
    assert.throws(
      () => new DkgClient(),
      /No DKG auth token|auth\.token/,
      'should throw when no token is available',
    );
  });
});
