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
  // Secrets — API keys and tokens
  { type: 'secret', name: 'api-key', regex: /(api[_-]?key|api[_-]?token|password|secret[_-]?key|credential)\s*[:=]\s*\S+/gi },
  { type: 'secret', name: 'env-secret', regex: /[A-Z_]*(TOKEN|KEY|SECRET|PASSWORD)\s*[:=]\s*\S{8,}/g },
  { type: 'secret', name: 'github-token', regex: /gh[ps]_[a-zA-Z0-9]{36,}/g },
  { type: 'secret', name: 'npm-token', regex: /npm_[a-zA-Z0-9]{36}/g },
  { type: 'secret', name: 'bearer-token', regex: /Bearer\s+[a-zA-Z0-9\-._~+/]{20,}/g },
  { type: 'secret', name: 'sk-token', regex: /sk-[a-zA-Z0-9]{20,}/g },
  { type: 'secret', name: 'wallet-private-key', regex: /0x[a-fA-F0-9]{64}/g },
  { type: 'secret', name: 'jwt-token', regex: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g },
  { type: 'secret', name: 'aws-access-key', regex: /AKIA[0-9A-Z]{16}/g },
  { type: 'secret', name: 'slack-webhook', regex: /https:\/\/hooks\.slack\.com\/services\/T[a-zA-Z0-9_]+\/B[a-zA-Z0-9_]+\/[a-zA-Z0-9_]+/g },
  { type: 'secret', name: 'discord-webhook', regex: /https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[a-zA-Z0-9_-]+/g },
  { type: 'secret', name: 'db-connection-string', regex: /(postgres|mysql|mongodb|redis|amqp):\/\/[^\s"']+/gi },
  { type: 'secret', name: 'stripe-key', regex: /[sr]k_(live|test)_[a-zA-Z0-9]{20,}/g },
  { type: 'secret', name: 'sendgrid-key', regex: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/g },
  { type: 'secret', name: 'twilio-key', regex: /SK[a-f0-9]{32}/g },
  { type: 'secret', name: 'heroku-key', regex: /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g },
  { type: 'secret', name: 'pgp-private-key', regex: /-----BEGIN PGP PRIVATE KEY BLOCK-----/g },
  { type: 'secret', name: 'ssh-key', regex: /-----BEGIN\s+(RSA|DSA|EC|OPENSSH)\s+PRIVATE\s+KEY-----/g },
  // PII
  { type: 'pii', name: 'ip-address', regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/g },
  { type: 'pii', name: 'email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { type: 'pii', name: 'phone-number', regex: /(?:\+\d{1,3}[\s.-])?\(?\d{2,4}\)[\s.-]\d{3,4}[\s.-]\d{3,4}\b/g },
  { type: 'pii', name: 'phone-intl', regex: /\+\d{1,3}[\s.-]\d{2,4}[\s.-]\d{3,4}[\s.-]?\d{0,4}\b/g },
  { type: 'pii', name: 'credit-card', regex: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g },
  { type: 'pii', name: 'home-dir', regex: /(?:\/home\/[a-z][a-z0-9_-]*|\/Users\/[a-zA-Z][a-zA-Z0-9_-]*|C:\\Users\\[a-zA-Z][a-zA-Z0-9_-]*)/g },
  { type: 'pii', name: 'mac-address', regex: /\b([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g },
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
