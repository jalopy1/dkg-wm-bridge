#!/usr/bin/env node

/**
 * wm-bridge — Deposit agent artifacts into DKG v10 Working Memory.
 * Works with OpenClaw, Hermes, and any agent that produces text artifacts.
 *
 * Usage:
 *   wm-bridge check                — Verify DKG node connectivity
 *   wm-bridge init [options]       — Create context graph + config
 *   wm-bridge ingest <file|dir>    — Ingest artifacts into Working Memory
 *   wm-bridge ingest-text <t> <t>  — Ingest inline text
 *   wm-bridge promote <name>       — Promote assertion WM → Shared Memory
 *   wm-bridge status               — List artifacts in Working Memory
 *   wm-bridge info <name>          — Show assertion details + history
 *   wm-bridge discard <name>       — Discard a WM assertion
 */

import { resolve, dirname } from 'node:path';
import { statSync, readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { DkgClient } from './dkg-client.js';
import {
  ingestFile,
  ingestDirectory,
  ingestText,
  promoteArtifact,
  listWorkingMemory,
  ensureContextGraph,
} from './ingest.js';
import { queryArtifacts } from './query.js';
import { WMBO, type SensitivityLevel } from './rdf.js';

// -- Config -------------------------------------------------------------------

interface BridgeConfig {
  agent: string;
  agentPeerId?: string;
  contextGraph: string;
  framework: 'openclaw' | 'hermes' | 'generic';
  dkgUrl?: string;
}

const CONFIG_PATH = resolve(homedir(), '.dkg', 'wm-bridge.json');
const AUDIT_LOG_PATH = resolve(homedir(), '.dkg', 'audit.log');

function loadConfig(): Partial<BridgeConfig> {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {};
}

function saveConfig(cfg: BridgeConfig): void {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

/** Append an entry to the audit log. */
function auditLog(action: string, name: string, sensitivity: string, result: string): void {
  const dir = dirname(AUDIT_LOG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString();
  // Sanitize inputs to prevent log injection (strip tabs, newlines, control chars)
  const clean = (s: string) => s.replace(/[\t\n\r\x00-\x1f]/g, ' ').slice(0, 200);
  appendFileSync(AUDIT_LOG_PATH, `${ts}\t${clean(action)}\t${clean(name)}\t${clean(sensitivity)}\t${clean(result)}\n`);
}

// -- CLI ----------------------------------------------------------------------

function usage(): never {
  console.log(`
wm-bridge — Deposit agent artifacts into DKG v10 Working Memory
Works with OpenClaw, Hermes, and any agent that produces text artifacts.

Commands:
  check                         Verify DKG node connectivity and show identity
  init [options]                Create context graph and save config
  ingest <file|dir> [options]   Ingest markdown files into Working Memory
  ingest-text <title> <text>    Ingest inline text into Working Memory
  promote <assertion-name>      Promote an assertion from WM to Shared Memory
  discard <assertion-name>      Discard a WM assertion (delete without promoting)
  status                        List artifacts currently in Working Memory
  query [search-term]           Search/list artifacts with detail (sensitivity, tags, sha256)
  info <assertion-name>         Show assertion details and history

Options:
  --context-graph, -c <id>      Context graph ID (default from config or "agent-artifacts")
  --agent <name>                Agent name for provenance (default from config)
  --framework <name>            Agent framework: openclaw, hermes, generic
  --status <tag>                Status tag: draft|reviewed|promote-ready (default: draft)
  --sensitivity <level>         Sensitivity level: public|shareable|personal|secret
  --derived-from <n1,n2,...>    Assertion name(s) this artifact was derived from
  --revision-of <name>          Assertion name this artifact is a revision of
  --scan                        Run PII/secret scanner before ingesting
  --kind <type>                 Artifact kind: memory-daily|research-note|document|... (default: knowledge-artifact)
  --tags <t1,t2,...>            Comma-separated tags
  --limit <n>                   Max results for query (default: 10)
  --format <fmt>                Output format for query: human|json (default: human)
  --recursive, -r               Recurse into subdirectories
  --dry-run                     Show what would be written without writing
  --help, -h                    Show this help

Environment:
  DKG_API_URL                   DKG daemon URL (default: http://127.0.0.1:9200)
  DKG_AUTH_TOKEN                Bearer token (default: reads ~/.dkg/auth.token)

Config: ~/.dkg/wm-bridge.json (created by 'init', stores agent name, peer ID, context graph)
`);
  process.exit(0);
}

function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Record<string, string | boolean> } {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let command = '';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!command && !arg.startsWith('-')) { command = arg; continue; }
    if (arg === '--help' || arg === '-h') { flags.help = true; continue; }
    if (arg === '--dry-run') { flags.dryRun = true; continue; }
    if (arg === '--recursive' || arg === '-r') { flags.recursive = true; continue; }
    if (arg === '--scan') { flags.scan = true; continue; }
    if ((arg === '--context-graph' || arg === '-c') && argv[i + 1]) { flags.contextGraph = argv[++i]; continue; }
    if (arg === '--agent' && argv[i + 1]) { flags.agent = argv[++i]; continue; }
    if (arg === '--framework' && argv[i + 1]) { flags.framework = argv[++i]; continue; }
    if (arg === '--status' && argv[i + 1]) { flags.status = argv[++i]; continue; }
    if (arg === '--sensitivity' && argv[i + 1]) { flags.sensitivity = argv[++i]; continue; }
    if (arg === '--tags' && argv[i + 1]) { flags.tags = argv[++i]; continue; }
    if (arg === '--kind' && argv[i + 1]) { flags.kind = argv[++i]; continue; }
    if (arg === '--limit' && argv[i + 1]) { flags.limit = argv[++i]; continue; }
    if (arg === '--format' && argv[i + 1]) { flags.format = argv[++i]; continue; }
    if (arg === '--derived-from' && argv[i + 1]) { flags.derivedFrom = argv[++i]; continue; }
    if (arg === '--revision-of' && argv[i + 1]) { flags.revisionOf = argv[++i]; continue; }
    if (!arg.startsWith('-')) positional.push(arg);
  }

  return { command, positional, flags };
}

/** Strip RDF literal quotes and datatype suffixes from SPARQL binding values. */
function cleanLiteral(v: string | undefined): string {
  if (!v) return '—';
  return v.replace(/^"(.*)"(\^\^<[^>]+>)?$/, '$1');
}

/** Truncate a date string to just the date portion. */
function shortDate(v: string | undefined): string {
  const cleaned = cleanLiteral(v);
  if (cleaned === '—') return cleaned;
  return cleaned.slice(0, 10);
}

async function main() {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));
  if (flags.help || !command) usage();

  const config = loadConfig();
  const client = new DkgClient({ baseUrl: config.dkgUrl });

  // Resolve settings: CLI flags > config > defaults
  const agent = (flags.agent as string) || config.agent || 'Agent';
  const cg = (flags.contextGraph as string) || config.contextGraph || 'agent-artifacts';
  const framework = (flags.framework as string) || config.framework || 'generic';
  const tags = flags.tags ? (flags.tags as string).split(',').map(t => t.trim()) : undefined;

  // Validate flag values
  const validStatuses = ['draft', 'reviewed', 'promote-ready', 'promoted', 'verified-ready'];
  const validFrameworks = ['openclaw', 'hermes', 'generic'];
  if (flags.status && !validStatuses.includes(flags.status as string)) {
    console.error(`Invalid --status "${flags.status}". Must be one of: ${validStatuses.join(', ')}`);
    process.exit(1);
  }
  if (flags.framework && !validFrameworks.includes(flags.framework as string)) {
    console.error(`Invalid --framework "${flags.framework}". Must be one of: ${validFrameworks.join(', ')}`);
    process.exit(1);
  }
  const validSensitivities: SensitivityLevel[] = ['public', 'shareable', 'personal', 'secret'];
  if (flags.sensitivity && !validSensitivities.includes(flags.sensitivity as SensitivityLevel)) {
    console.error(`Invalid --sensitivity "${flags.sensitivity}". Must be one of: ${validSensitivities.join(', ')}`);
    process.exit(1);
  }

  switch (command) {
    // -- check ----------------------------------------------------------------
    case 'check': {
      const s = await client.status();
      if (!s.ok) {
        console.error(`❌ DKG node unreachable: ${s.error}`);
        process.exit(1);
      }
      const addr = await client.getAgentAddress();
      console.log(`✅ DKG v10 node reachable`);
      console.log(`   Peer ID: ${s.peerId}`);
      console.log(`   Wallet:  ${addr}`);
      if (config.agent) {
        console.log(`   Agent:   ${config.agent} (${config.framework ?? 'generic'})`);
        console.log(`   CG:      ${config.contextGraph ?? 'agent-artifacts'}`);
      } else {
        console.log(`   ℹ️  Run 'wm-bridge init' to configure your agent identity`);
      }
      break;
    }

    // -- init -----------------------------------------------------------------
    case 'init': {
      // Auto-detect peer ID and wallet from the node
      const s = await client.status();
      if (!s.ok) {
        console.error(`❌ DKG node unreachable: ${s.error}`);
        process.exit(1);
      }

      const newConfig: BridgeConfig = {
        agent,
        agentPeerId: s.peerId,
        contextGraph: cg,
        framework: framework as BridgeConfig['framework'],
        dkgUrl: client.baseUrl,
      };

      // Create context graph
      const desc = `Working Memory context graph for ${agent} (${framework}) — agent artifacts, memory files, research notes.`;
      const { created } = await ensureContextGraph(client, cg, `${agent} Artifacts`, desc);

      // Save config
      saveConfig(newConfig);

      console.log(`✅ Initialized wm-bridge for ${agent} (${framework})`);
      console.log(`   Context graph: ${cg} ${created ? '(created)' : '(exists)'}`);
      console.log(`   Peer ID: ${s.peerId}`);
      console.log(`   Config saved: ${CONFIG_PATH}`);
      break;
    }

    // -- ingest ---------------------------------------------------------------
    case 'ingest': {
      if (!positional[0]) {
        console.error('Usage: wm-bridge ingest <file|directory>');
        process.exit(1);
      }
      const target = resolve(positional[0]);
      let stat;
      try {
        stat = statSync(target);
      } catch {
        console.error(`❌ File not found: ${target}`);
        process.exit(1);
      }
      if (stat.isFile() && stat.size === 0) {
        console.error('❌ File is empty. Nothing to ingest.');
        process.exit(1);
      }
      if (!stat.isFile() && !stat.isDirectory()) {
        console.error('❌ Not a regular file or directory.');
        process.exit(1);
      }
      const opts = {
        client,
        contextGraph: cg,
        agent,
        agentPeerId: config.agentPeerId,
        status: (flags.status as any) || 'draft',
        tags,
        dryRun: !!flags.dryRun,
        sensitivity: flags.sensitivity as SensitivityLevel | undefined,
        scan: !!flags.scan,
        derivedFrom: flags.derivedFrom ? (flags.derivedFrom as string).split(',').map(s => s.trim()).filter(s => s) : undefined,
        revisionOf: flags.revisionOf as string | undefined,
      };

      if (stat.isDirectory()) {
        const results = await ingestDirectory(target, { ...opts, recursive: !!flags.recursive });
        let ok = 0, fail = 0;
        for (const r of results) {
          if (r.error) {
            console.log(`❌ ${r.file} — ${r.error}`);
            auditLog('ingest', r.assertionName || r.file, flags.sensitivity as string ?? 'shareable', `error: ${r.error}`);
            fail++;
          } else {
            const triples = r.extractedTriples ? ` + ${r.extractedTriples} extracted` : '';
            const warn = r.provenanceWarning ? ' ⚠️ provenance write failed' : '';
            const scanInfo = r.scanResult?.findings.length ? ` [scan: ${r.scanResult.findings.length} finding(s)]` : '';
            console.log(`✅ ${r.file} → ${r.assertionName} (${r.provenanceQuads} provenance${triples})${warn}${scanInfo}`);
            auditLog('ingest', r.assertionName, flags.sensitivity as string ?? r.scanResult?.recommendedSensitivity ?? 'shareable', 'ok');
            ok++;
          }
        }
        console.log(`\n${flags.dryRun ? 'Would ingest' : 'Ingested'}: ${ok} files${fail ? `, ${fail} errors` : ''}`);
      } else {
        const result = await ingestFile(target, opts);
        if (result.error) {
          console.error(`❌ ${result.file} — ${result.error}`);
          auditLog('ingest', result.assertionName || result.file, flags.sensitivity as string ?? 'shareable', `error: ${result.error}`);
          process.exit(1);
        }
        const triples = result.extractedTriples ? ` + ${result.extractedTriples} extracted` : '';
        const warn = result.provenanceWarning ? ' ⚠️ provenance write failed' : '';
        const scanInfo = result.scanResult?.findings.length ? ` [scan: ${result.scanResult.findings.length} finding(s)]` : '';
        console.log(`✅ ${result.file} → ${result.assertionName} (${result.provenanceQuads} provenance${triples})${warn}${scanInfo}`);
        auditLog('ingest', result.assertionName, flags.sensitivity as string ?? result.scanResult?.recommendedSensitivity ?? 'shareable', 'ok');
      }
      break;
    }

    // -- ingest-text ----------------------------------------------------------
    case 'ingest-text': {
      if (positional.length < 2) {
        console.error('Usage: wm-bridge ingest-text <title> <text>');
        process.exit(1);
      }
      const [title, ...rest] = positional;
      const text = rest.join(' ');
      if (!title.trim() || !text.trim()) {
        console.error('❌ Title and text must not be empty.');
        process.exit(1);
      }
      const kind = (flags.kind as any) || 'knowledge-artifact';
      const result = await ingestText(text, title, kind, {
        client,
        contextGraph: cg,
        agent,
        agentPeerId: config.agentPeerId,
        status: (flags.status as any) || 'draft',
        tags,
        dryRun: !!flags.dryRun,
        sensitivity: flags.sensitivity as SensitivityLevel | undefined,
        scan: !!flags.scan,
        derivedFrom: flags.derivedFrom ? (flags.derivedFrom as string).split(',').map(s => s.trim()).filter(s => s) : undefined,
        revisionOf: flags.revisionOf as string | undefined,
      });
      if (result.error) {
        console.error(`❌ ${result.error}`);
        auditLog('ingest-text', result.assertionName || title, flags.sensitivity as string ?? 'shareable', `error: ${result.error}`);
        process.exit(1);
      }
      const triples = result.extractedTriples ? ` + ${result.extractedTriples} extracted` : '';
      const warn = result.provenanceWarning ? ' ⚠️ provenance write failed' : '';
      const scanInfo = result.scanResult?.findings.length ? ` [scan: ${result.scanResult.findings.length} finding(s)]` : '';
      console.log(`✅ "${title}" → ${result.assertionName} (${result.provenanceQuads} provenance${triples})${warn}${scanInfo}`);
      auditLog('ingest-text', result.assertionName, flags.sensitivity as string ?? result.scanResult?.recommendedSensitivity ?? 'shareable', 'ok');
      break;
    }

    // -- promote --------------------------------------------------------------
    case 'promote': {
      if (!positional[0]) {
        console.error('Usage: wm-bridge promote <assertion-name>');
        process.exit(1);
      }

      // Check sensitivity before promoting
      try {
        const { quads: checkQuads } = await client.queryAssertion(cg, positional[0]);
        const sensitivityPred = `${WMBO}sensitivity`;
        const sensitivityQuad = (checkQuads as any[])?.find(
          (q: any) => q.predicate === sensitivityPred,
        );
        if (sensitivityQuad) {
          const sensValue = cleanLiteral(sensitivityQuad.object);
          if (sensValue === 'personal' || sensValue === 'secret') {
            const msg = `🚫 Cannot promote "${positional[0]}" — sensitivity is "${sensValue}". Only "public" or "shareable" artifacts can be promoted to Shared Memory.`;
            console.error(msg);
            auditLog('promote', positional[0], sensValue, 'blocked');
            process.exit(1);
          }
        }
      } catch {
        console.warn('⚠️  Could not verify sensitivity tag — proceeding with caution');
        auditLog('promote', positional[0], 'unknown', 'sensitivity-check-failed');
      }

      const result = await promoteArtifact(client, cg, positional[0]);
      const count = (result as any).promotedCount ?? '?';

      // Update the assertion's status tag to "promoted"
      try {
        const { quads: existingQuads } = await client.queryAssertion(cg, positional[0]);
        const statusPred = `${WMBO}status`;
        const artifactSubject = (existingQuads as any[])?.find(
          (q: any) => q.predicate === statusPred,
        )?.subject;
        if (artifactSubject) {
          await client.writeAssertion(cg, positional[0], [{
            subject: artifactSubject,
            predicate: statusPred,
            object: `"promoted"`,
          }]);
        }
      } catch {
        // Status update is best-effort; promotion itself already succeeded
      }

      console.log(`✅ Promoted "${positional[0]}" → Shared Memory (${count} quads)`);
      auditLog('promote', positional[0], 'shareable', 'ok');
      break;
    }

    // -- discard --------------------------------------------------------------
    case 'discard': {
      if (!positional[0]) {
        console.error('Usage: wm-bridge discard <assertion-name>');
        process.exit(1);
      }
      const result = await client.discardAssertion(cg, positional[0]);
      console.log(result.discarded
        ? `✅ Discarded "${positional[0]}" from Working Memory`
        : `⚠️  Could not discard "${positional[0]}"`);
      break;
    }

    // -- status ---------------------------------------------------------------
    case 'status': {
      const result = await listWorkingMemory(client, cg);
      const bindings = result?.result?.bindings ?? result?.results?.bindings ?? [];
      if (!bindings.length) {
        console.log('No artifacts found in Working Memory.');
        break;
      }
      console.log(`Artifacts in Working Memory (${bindings.length}):\n`);
      for (const row of bindings) {
        const name = cleanLiteral(row.name);
        const kind = cleanLiteral(row.kind);
        const status = cleanLiteral(row.status);
        const date = shortDate(row.date);
        const uri = row.s ?? '—';
        console.log(`  📄 ${name}`);
        console.log(`     ${kind} | ${status} | ${date} | ${uri}\n`);
      }
      break;
    }

    // -- query ----------------------------------------------------------------
    case 'query': {
      const searchTerm = positional[0] || undefined;
      const rawLimit = flags.limit ? parseInt(flags.limit as string, 10) : 10;
      if (flags.limit && (isNaN(rawLimit) || rawLimit < 1)) {
        console.error(`Invalid --limit "${flags.limit}". Must be a positive integer.`);
        process.exit(1);
      }
      const queryLimit = Math.max(1, Math.min(rawLimit, 1000));
      const queryFormat = (flags.format as string) === 'json' ? 'json' as const : (flags.format as string) === 'human' || !flags.format ? 'human' as const : null;
      if (!queryFormat) {
        console.error('❌ Invalid format. Must be: human or json');
        process.exit(1);
      }

      // Validate --kind for query (same allowlist as buildArtifactSparql)
      const validQueryKinds = [
        'memory-daily', 'memory-longterm', 'research-note',
        'session-summary', 'document', 'knowledge-artifact',
      ];
      if (flags.kind && !validQueryKinds.includes(flags.kind as string)) {
        console.error(`Invalid --kind "${flags.kind}". Must be one of: ${validQueryKinds.join(', ')}`);
        process.exit(1);
      }

      const results = await queryArtifacts(client, cg, {
        searchTerm,
        kind: flags.kind as string | undefined,
        sensitivity: flags.sensitivity as SensitivityLevel | undefined,
        limit: queryLimit,
        format: queryFormat,
      });

      if (!results.length) {
        console.log('No artifacts found.');
        break;
      }

      if (queryFormat === 'json') {
        console.log(JSON.stringify(results, null, 2));
      } else {
        console.log(`Artifacts in Working Memory (${results.length}):\n`);
        for (const r of results) {
          console.log(`  📄 ${r.name}`);
          console.log(`     Kind: ${r.kind} | Status: ${r.status} | Sensitivity: ${r.sensitivity}`);
          console.log(`     Date: ${r.date} | SHA256: ${r.sha256 || '—'}`);
          console.log(`     Tags: ${r.tags || '—'} | URI: ${r.uri}`);
          if (r.contentPreview) {
            console.log(`     Preview: ${r.contentPreview}`);
          }
          console.log();
        }
      }
      break;
    }

    // -- info -----------------------------------------------------------------
    case 'info': {
      if (!positional[0]) {
        console.error('Usage: wm-bridge info <assertion-name>');
        process.exit(1);
      }
      try {
        const history = await client.getAssertionHistory(cg, positional[0]);
        console.log(`Assertion: ${positional[0]}\n`);
        console.log(JSON.stringify(history, null, 2));
      } catch (err) {
        console.error(`❌ ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      usage();
  }
}

main().catch(err => {
  console.error('Fatal:', err.message ?? err);
  process.exit(1);
});
