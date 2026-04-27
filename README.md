# dkg-wm-bridge

Agent-plugin that deposits workspace artifacts into DKG v10 Working Memory with structured provenance, status tags, and a promotion path to Shared and Verified Memory.

Works with OpenClaw, Hermes, and any agent that produces text artifacts.

## What It Does

Takes the knowledge artifacts an agent produces — daily memory logs, long-term memory, research notes, session summaries — and writes them into DKG v10 Working Memory as structured RDF with:

- **schema.org vocabulary** for interoperability
- **PROV-O provenance** (author, timestamp, source, agent identity via DKG peer ID)
- **Status tags** tracking position in the trust gradient (`draft` → `reviewed` → `promote-ready` → `promoted` → `verified-ready`)
- **Deterministic URIs** that remain stable through WM → SWM → VM promotion

## Security & Privacy

The bridge includes a data classification protocol to prevent accidental exposure of sensitive content through the DKG trust gradient.

### Sensitivity Levels

Every artifact is assigned a sensitivity level at ingestion time:

| Level | Description | Promotable? |
|-------|-------------|-------------|
| `public` | Safe for anyone to see | Yes |
| `shareable` | OK for team/collaborators (default) | Yes |
| `personal` | Contains PII or personal context | No — promotion blocked |
| `secret` | Contains credentials, API keys, etc. | No — promotion blocked |

Use `--sensitivity` to classify manually:

```bash
wm-bridge ingest notes.md --sensitivity personal
```

### Automatic Scanning

Use `--scan` to run PII and secret detection before ingesting. The scanner checks for API keys, tokens, email addresses, IP addresses, home directory paths, and SSH private keys.

```bash
wm-bridge ingest research.md --scan
```

If secrets are found, ingestion is blocked. If PII is found, the artifact is automatically classified as `personal` (unless a stricter level is set).

### Promotion Guards

The `promote` command refuses to promote artifacts classified as `personal` or `secret`. This ensures sensitive content stays in Working Memory on the operator's own node and never reaches Shared Memory or the broader network.

### Audit Logging

All ingest and promote operations are logged to `~/.dkg/audit.log` with timestamps, sensitivity levels, and scan results for compliance and traceability.

## Quick Start

```bash
npm install -g dkg-wm-bridge

# Verify DKG node connectivity
wm-bridge check

# Initialize for your agent (OpenClaw, Hermes, or generic)
wm-bridge init --agent MyAgent --framework openclaw
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
| `--sensitivity <level>` | Sensitivity: `public\|shareable\|personal\|secret` |
| `--scan` | Run PII/secret detection before ingesting |
| `--dry-run` | Preview without writing |

## Multi-Agent Support

The bridge is agent-agnostic. Run `init` once per agent to configure identity and context graph:

```bash
# OpenClaw agent
wm-bridge init --agent MyAgent --framework openclaw -c my-artifacts

# Hermes agent on the same node
wm-bridge init --agent Hermes --framework hermes -c hermes-artifacts
```

Config is stored at `~/.dkg/wm-bridge.json`. Each agent can use its own context graph or share one for collaboration.

## Programmatic API

```typescript
import { DkgClient, ingestFile, ensureContextGraph } from 'dkg-wm-bridge';

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

1. Reads a file from the agent's workspace
2. Detects artifact kind from path (daily memory, long-term memory, research note, etc.)
3. Extracts title from first heading or filename
4. Imports the file via the DKG node's extraction pipeline (entities, relationships, structured knowledge)
5. Layers provenance + status metadata on top (schema.org + PROV-O)
6. Large files (>8KB) are chunked by `##` headings before import

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
