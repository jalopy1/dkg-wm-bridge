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
import { statSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
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

// -- Config -------------------------------------------------------------------

interface BridgeConfig {
  agent: string;
  agentPeerId?: string;
  contextGraph: string;
  framework: 'openclaw' | 'hermes' | 'generic';
  dkgUrl?: string;
}

const CONFIG_PATH = resolve(homedir(), '.dkg', 'wm-bridge.json');

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
  info <assertion-name>         Show assertion details and history

Options:
  --context-graph, -c <id>      Context graph ID (default from config or "agent-artifacts")
  --agent <name>                Agent name for provenance (default from config)
  --framework <name>            Agent framework: openclaw, hermes, generic
  --status <tag>                Status tag: draft|reviewed|promote-ready (default: draft)
  --tags <t1,t2,...>            Comma-separated tags
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
    if ((arg === '--context-graph' || arg === '-c') && argv[i + 1]) { flags.contextGraph = argv[++i]; continue; }
    if (arg === '--agent' && argv[i + 1]) { flags.agent = argv[++i]; continue; }
    if (arg === '--framework' && argv[i + 1]) { flags.framework = argv[++i]; continue; }
    if (arg === '--status' && argv[i + 1]) { flags.status = argv[++i]; continue; }
    if (arg === '--tags' && argv[i + 1]) { flags.tags = argv[++i]; continue; }
    if (arg === '--kind' && argv[i + 1]) { flags.kind = argv[++i]; continue; }
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
      const stat = statSync(target);
      const opts = {
        client,
        contextGraph: cg,
        agent,
        agentPeerId: config.agentPeerId,
        status: (flags.status as any) || 'draft',
        tags,
        dryRun: !!flags.dryRun,
      };

      if (stat.isDirectory()) {
        const results = await ingestDirectory(target, { ...opts, recursive: !!flags.recursive });
        let ok = 0, fail = 0;
        for (const r of results) {
          if (r.error) {
            console.log(`❌ ${r.file} — ${r.error}`);
            fail++;
          } else {
            console.log(`✅ ${r.file} → ${r.assertionName} (${r.quadCount} quads)`);
            ok++;
          }
        }
        console.log(`\n${flags.dryRun ? 'Would ingest' : 'Ingested'}: ${ok} files${fail ? `, ${fail} errors` : ''}`);
      } else {
        const result = await ingestFile(target, opts);
        if (result.error) {
          console.error(`❌ ${result.file} — ${result.error}`);
          process.exit(1);
        }
        console.log(`✅ ${result.file} → ${result.assertionName} (${result.quadCount} quads)`);
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
      const kind = (flags.kind as any) || 'knowledge-artifact';
      const result = await ingestText(text, title, kind, {
        client,
        contextGraph: cg,
        agent,
        agentPeerId: config.agentPeerId,
        status: (flags.status as any) || 'draft',
        tags,
        dryRun: !!flags.dryRun,
      });
      if (result.error) {
        console.error(`❌ ${result.error}`);
        process.exit(1);
      }
      console.log(`✅ "${title}" → ${result.assertionName} (${result.quadCount} quads)`);
      break;
    }

    // -- promote --------------------------------------------------------------
    case 'promote': {
      if (!positional[0]) {
        console.error('Usage: wm-bridge promote <assertion-name>');
        process.exit(1);
      }
      const result = await promoteArtifact(client, cg, positional[0]);
      const count = (result as any).promotedCount ?? '?';
      console.log(`✅ Promoted "${positional[0]}" → Shared Memory (${count} quads)`);
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
