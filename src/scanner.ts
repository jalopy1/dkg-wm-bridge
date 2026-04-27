/**
 * PII and secret detection scanner.
 *
 * Scans text content for sensitive patterns (API keys, tokens, private keys,
 * email addresses, IP addresses, etc.) and recommends a sensitivity level.
 */

import type { SensitivityLevel } from './rdf.js';

export interface ScanFinding {
  type: 'secret' | 'pii';
  pattern: string;
  match: string; // redacted version of what was found
  line?: number;
}

export interface ScanResult {
  hasPII: boolean;
  hasSecrets: boolean;
  findings: ScanFinding[];
  recommendedSensitivity: SensitivityLevel;
}

// -- Pattern definitions ------------------------------------------------------

interface PatternDef {
  type: 'secret' | 'pii';
  name: string;
  regex: RegExp;
}

const PATTERNS: PatternDef[] = [
  // Secrets
  { type: 'secret', name: 'api-key', regex: /(api[_-]?key|api[_-]?token|password|secret[_-]?key|credential)\s*[:=]\s*\S+/gi },
  { type: 'secret', name: 'env-secret', regex: /[A-Z_]*(TOKEN|KEY|SECRET|PASSWORD)\s*[:=]\s*\S{8,}/g },
  { type: 'secret', name: 'github-token', regex: /ghp_[a-zA-Z0-9]{36}/g },
  { type: 'secret', name: 'npm-token', regex: /npm_[a-zA-Z0-9]{36}/g },
  { type: 'secret', name: 'bearer-token', regex: /Bearer\s+[a-zA-Z0-9\-._~+/]{20,}/g },
  { type: 'secret', name: 'sk-token', regex: /sk-[a-zA-Z0-9]{20,}/g },
  { type: 'secret', name: 'wallet-private-key', regex: /0x[a-fA-F0-9]{64}/g },
  // PII
  { type: 'pii', name: 'ip-address', regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/g },
  { type: 'pii', name: 'email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { type: 'pii', name: 'home-dir', regex: /\/home\/[a-z][a-z0-9_-]*/g },
  { type: 'pii', name: 'ssh-key', regex: /-----BEGIN\s+(RSA|DSA|EC|OPENSSH)\s+PRIVATE\s+KEY-----/g },
];

// -- Helpers ------------------------------------------------------------------

/** Build a line-number lookup from text. */
function lineIndex(text: string): (offset: number) => number {
  const breaks: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') breaks.push(i + 1);
  }
  return (offset: number) => {
    let lo = 0, hi = breaks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (breaks[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1; // 1-based
  };
}

/** Redact a matched string, keeping first 4 and last 2 chars visible. */
function redactMatch(m: string): string {
  if (m.length <= 8) return '[REDACTED]';
  return m.slice(0, 4) + '…' + m.slice(-2) + ' [REDACTED]';
}

// -- Public API ---------------------------------------------------------------

/**
 * Scan text for PII and secrets.
 */
export function scanContent(text: string): ScanResult {
  const findings: ScanFinding[] = [];
  const getLine = lineIndex(text);

  for (const pat of PATTERNS) {
    // Reset regex state for each scan
    const re = new RegExp(pat.regex.source, pat.regex.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // For wallet-private-key, skip 40-char addresses (only flag 64-char keys)
      // The regex already requires exactly 64 hex chars, so no extra check needed.
      findings.push({
        type: pat.type,
        pattern: pat.name,
        match: redactMatch(m[0]),
        line: getLine(m.index),
      });
    }
  }

  const hasSecrets = findings.some(f => f.type === 'secret');
  const hasPII = findings.some(f => f.type === 'pii');

  let recommendedSensitivity: SensitivityLevel = 'shareable';
  if (hasSecrets) recommendedSensitivity = 'secret';
  else if (hasPII) recommendedSensitivity = 'personal';

  return { hasPII, hasSecrets, findings, recommendedSensitivity };
}

/**
 * Redact all detected PII and secrets from text, replacing with [REDACTED].
 */
export function redactContent(text: string): string {
  let result = text;
  for (const pat of PATTERNS) {
    const re = new RegExp(pat.regex.source, pat.regex.flags);
    result = result.replace(re, '[REDACTED]');
  }
  return result;
}
