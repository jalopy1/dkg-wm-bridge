# DKG Working Memory Bridge — Agent Skill

Deposit workspace artifacts into DKG v10 Working Memory with provenance and status tags.
Works with OpenClaw, Hermes, and any agent that produces text artifacts.

## Setup

```bash
# First time: check connectivity and initialize
wm-bridge check
wm-bridge init --agent <name> --framework <openclaw|hermes|generic>
```

Config is saved to `~/.dkg/wm-bridge.json`. Auto-detects peer ID from the node.

## Commands

### `wm-bridge check`
Verify DKG node connectivity and show agent identity.

### `wm-bridge init --agent <name> --framework <framework>`
Create context graph, auto-detect peer ID, save config. Run once per agent.

### `wm-bridge ingest <file|directory>`
Ingest markdown files into Working Memory. Each file becomes a named assertion with structured RDF.

Options: `--recursive` `-r`, `--status <tag>`, `--tags <t1,t2>`, `--context-graph <id>` `-c`, `--dry-run`

### `wm-bridge ingest-text <title> <text>`
Ingest inline text (not from a file) into Working Memory.

### `wm-bridge promote <assertion-name>`
Promote an assertion from Working Memory to Shared Memory.

### `wm-bridge discard <assertion-name>`
Discard an assertion from Working Memory without promoting.

### `wm-bridge status`
List artifacts currently in Working Memory with kind, status, and date.

### `wm-bridge info <assertion-name>`
Show assertion details and lifecycle history.

## When to Use

- After writing daily memory notes — ingest them for durability and discoverability
- After completing research — ingest findings so other agents can discover them
- When curating long-term memory — ingest updates as knowledge artifacts
- When collaborating — promote artifacts to Shared Memory for other agents

## Multi-Agent Collaboration

Multiple agents can share a Context Graph:
```bash
# Agent 1 (OpenClaw)
wm-bridge init --agent Navi --framework openclaw -c team-research

# Agent 2 (Hermes)
wm-bridge init --agent Hermes --framework hermes -c team-research

# Both agents' promoted artifacts are visible to each other in Shared Memory
```

## Trust Gradient

Artifacts flow through the v10 trust gradient:
- **Working Memory** (private, per-agent) → `draft` / `reviewed` / `promote-ready`
- **Shared Memory** (team-visible, gossiped) → `promoted`
- **Verified Memory** (on-chain, Round 2) → `verified-ready`

## Environment

Requires a running DKG v10 node. Auth token from `~/.dkg/auth.token` or `DKG_AUTH_TOKEN`.
