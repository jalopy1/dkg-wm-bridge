# dkg-wm-bridge

Agent-plugin that deposits workspace artifacts into DKG v10 Working Memory with structured provenance, status tags, and a promotion path to Shared and Verified Memory.

Works with OpenClaw, Hermes, and any agent that produces text artifacts.

## What It Does

Takes the knowledge artifacts an agent produces — daily memory logs, long-term memory, research notes, session summaries — and writes them into DKG v10 Working Memory as structured RDF with:

- **schema.org vocabulary** for interoperability
- **PROV-O provenance** (author, timestamp, source, agent identity via DKG peer ID)
- **Status tags** tracking position in the trust gradient (`draft` → `reviewed` → `promote-ready` → `promoted` → `verified-ready`)
- **Deterministic URIs** that remain stable through WM → SWM → VM promotion

## Quick Start

```bash
npm install -g @navi-agent/dkg-wm-bridge

# Verify DKG node connectivity
wm-bridge check

# Initialize for your agent (OpenClaw, Hermes, or generic)
wm-bridge init --agent Navi --framework openclaw
wm-bridge init --agent Hermes --framework hermes

# Ingest a single file
wm-bridge ingest ./memory/2026-04-25.md

# Ingest an entire directory
wm-bridge ingest ./memory/ --recursive

# Check what's in Working Memory
wm-bridge status

# Promote a reviewed artifact to Shared Memory
wm-bridge promote wm-bridge-memory-daily-a1b2c3d4

# Discard an artifact from Working Memory
wm-bridge discard wm-bridge-memory-daily-a1b2c3d4

# Show assertion details and history
wm-bridge info wm-bridge-memory-daily-a1b2c3d4
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `check` | Verify DKG node connectivity and show agent identity |
| `init` | Create context graph, auto-detect peer ID, save config |
| `ingest <file\|dir>` | Ingest markdown files into Working Memory |
| `ingest-text <title> <text>` | Ingest inline text into Working Memory |
| `promote <name>` | Promote an assertion from WM to Shared Memory |
| `discard <name>` | Discard an assertion from Working Memory |
| `status` | List artifacts currently in Working Memory |
| `info <name>` | Show assertion details and history |

## Options

| Flag | Description |
|------|-------------|
| `--context-graph, -c <id>` | Context graph ID (default from config) |
| `--agent <name>` | Agent name for provenance |
| `--framework <name>` | Agent framework: `openclaw`, `hermes`, `generic` |
| `--status <tag>` | Status tag: `draft\|reviewed\|promote-ready` |
| `--tags <t1,t2>` | Comma-separated tags |
| `--recursive, -r` | Recurse into subdirectories |
| `--dry-run` | Preview without writing |

## Multi-Agent Support

The bridge is agent-agnostic. Run `init` once per agent to configure identity and context graph:

```bash
# OpenClaw agent
wm-bridge init --agent Navi --framework openclaw -c navi-artifacts

# Hermes agent on the same node
wm-bridge init --agent Hermes --framework hermes -c hermes-artifacts
```

Config is stored at `~/.dkg/wm-bridge.json`. Each agent can use its own context graph or share one for collaboration.

## Programmatic API

```typescript
import { DkgClient, ingestFile, ensureContextGraph } from '@navi-agent/dkg-wm-bridge';

const client = new DkgClient();
await ensureContextGraph(client, 'my-project', 'My Project');

const result = await ingestFile('./notes/research.md', {
  client,
  contextGraph: 'my-project',
  agent: 'MyAgent',
  agentPeerId: '12D3KooW...',
  status: 'draft',
  tags: ['research', 'ai'],
});
```

## How It Works

1. Reads a markdown file from the agent's workspace
2. Detects artifact kind from path (daily memory, long-term memory, research note, etc.)
3. Extracts title from first heading or filename
4. Generates RDF quads using schema.org + PROV-O vocabulary
5. Creates a named assertion in the target Context Graph's Working Memory
6. Writes the quads to the assertion with the agent's DKG peer ID as provenance

Artifacts can then be promoted to Shared Memory (visible to other agents on the Context Graph) and eventually to Verified Memory (on-chain, Round 2).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DKG_API_URL` | `http://127.0.0.1:9200` | DKG daemon URL |
| `DKG_AUTH_TOKEN` | reads `~/.dkg/auth.token` | Bearer token |

## Requirements

- Node.js ≥ 18
- DKG v10 node running locally (or accessible via network)
- Valid DKG auth token

## License

Apache-2.0
