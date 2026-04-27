# DKG Working Memory Bridge — Design Brief

## 1. Problem

AI agents (OpenClaw, Hermes, and comparable frameworks) produce a continuous stream of knowledge artifacts — daily memory logs, long-term memory files, research notes, session summaries, and structured outputs. Today these artifacts live as flat files in the agent's workspace directory. They are:

- **Invisible to other agents.** A second OpenClaw agent, a Hermes research agent, or a Claude Code sub-agent cannot discover or build on artifacts produced by the first.
- **Without provenance.** There is no machine-readable record of who produced an artifact, when, from what source, or at what confidence level.
- **Without a promotion path.** An artifact that starts as a rough draft has no structured way to mature toward team-shared or verified status.

The DKG v10 memory model solves all three problems — but only if artifacts actually flow into it. The existing `adapter-openclaw` handles low-level chat turn persistence and memory slot reads. What's missing is the higher-level pipeline that takes *workspace artifacts* and deposits them into Working Memory with structured provenance, status tags, and a clear path toward Shared and Verified Memory.

## 2. Target User

- **Primary:** Agent operators (OpenClaw, Hermes, or comparable frameworks) running a DKG v10 edge node who want their agent's knowledge output to be durable, discoverable, and promotable through the v10 trust gradient.
- **Secondary:** Multi-agent teams where multiple agents collaborate on a shared Context Graph, using Shared Memory as a team scratchpad.

## 3. Memory Layers Touched

| Layer | How |
|-------|-----|
| **Working Memory** | Primary target. Every ingested artifact becomes a per-agent assertion in a Context Graph. Assertions carry schema.org metadata, PROV-O provenance, and status tags. |
| **Shared Memory** | Promotion target. The `promote` command moves reviewed artifacts from WM to SWM, making them visible to other agents on the same Context Graph via GossipSub. |

## 4. V10 Primitives Used

- **Context Graph** — Each project/workspace gets a dedicated Context Graph that organizes its artifacts.
- **Assertion** — Each artifact maps to a named assertion in Working Memory. Assertions are created via `POST /api/assertion/create` and written via `POST /api/assertion/:name/write`.
- **Entity** — Artifacts are typed as `schema:DigitalDocument` + `wmbo:AgentArtifact` entities with structured properties.
- **UAL** — Artifact URIs are deterministic (`urn:dkg:wm-bridge:artifact/<hash>`), enabling stable references across the trust gradient.

## 5. LLM-Wiki / Autoresearch Fit

This integration directly advances the LLM-Wiki vision:

- **Agent-native knowledge substrate.** Artifacts are stored as RDF with schema.org vocabulary — natively legible to language models and interoperable with the broader semantic web.
- **Continuous curation.** The agent's daily memory cycle (write daily notes → curate into long-term memory → publish significant findings) maps directly onto the WM → SWM → VM trust gradient.
- **Collaborative knowledge.** When promoted to Shared Memory, artifacts become readable by any agent subscribed to the Context Graph — enabling the "team scratchpad" pattern described in the bounty call.
- **Retrieval + writing + verification in one loop.** The agent can query its own Working Memory via SPARQL, write new artifacts based on what it finds, and promote mature artifacts — all through the same DKG interface.

## 6. Architecture

```
┌─────────────────────────────────────────────────┐
│  Agent (OpenClaw / Hermes / generic)            │
│                                                 │
│  Workspace:                                     │
│    memory/2026-04-25.md                         │
│    projects/research/notes.md                   │
│    session-outputs/...                          │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │  wm-bridge CLI / programmatic API         │  │
│  │                                           │  │
│  │  1. Read file → detect kind + metadata    │  │
│  │  2. Import via node extraction pipeline   │  │
│  │  3. Node extracts entities + structure    │  │
│  │  4. Layer provenance + status quads       │  │
│  │  5. Large files chunked by ## headings    │  │
│  └─────────────┬─────────────────────────────┘  │
│                │ HTTP API (bearer token)         │
└────────────────┼────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│  DKG v10 Node (localhost:9200)                  │
│                                                 │
│  Context Graph: "agent-artifacts"               │
│  ┌────────────────────────────────────────────┐ │
│  │ Working Memory                             │ │
│  │   assertion: wm-bridge-memory-daily-a1b2   │ │
│  │     → node-extracted entities + relations  │ │
│  │     → provenance (PROV-O) + status tags    │ │
│  └──────────────┬─────────────────────────────┘ │
│                 │ promote                        │
│  ┌──────────────▼─────────────────────────────┐ │
│  │ Shared Memory (GossipSub)                  │ │
│  │   → visible to subscribed agents           │ │
│  └──────────────┬─────────────────────────────┘ │
│                 │ publish (future: Round 2)      │
│  ┌──────────────▼─────────────────────────────┐ │
│  │ Verified Memory (on-chain)                 │ │
│  │   → self-attested → endorsed → consensus   │ │
│  └────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

## 7. Promotion Path (Forward-Compatibility)

This integration is designed so that artifacts maturing through the trust gradient become usable as oracle inputs without a rewrite:

1. **Working Memory (Round 1):** Artifacts enter as `draft` status assertions with full provenance (author, timestamp, source file, agent identity via PROV-O). The RDF structure uses schema.org vocabulary for maximum interoperability.

2. **Shared Memory (Round 1):** The `promote` command moves reviewed artifacts to SWM. Status transitions: `draft` → `reviewed` → `promote-ready` → `promoted`. Other agents on the Context Graph can discover and build on promoted artifacts.

3. **Verified Memory (Round 2):** Artifacts carry deterministic URIs (`urn:dkg:wm-bridge:artifact/<hash>`) that remain stable through promotion. The `verified-ready` status tag signals artifacts that have been reviewed and are candidates for on-chain anchoring. The schema.org + PROV-O metadata structure is already compatible with ClaimReview (the standard used by context oracles for claim verification).

4. **Context Oracle consumption (Round 2):** The structured provenance (who created it, when, from what source) and status tags (trust gradient position) are exactly the inputs a context oracle needs to assess claim credibility. Our existing Context Oracle project (built for Round 2) will consume these artifacts directly.

## 8. Terminology

All v10 vocabulary is used as defined:

| Term | Usage |
|------|-------|
| Context Graph | Organizational container for project artifacts |
| Assertion | Per-agent Working Memory document containing artifact quads |
| Entity | Typed artifact instance (schema:DigitalDocument + wmbo:AgentArtifact) |
| Working Memory | Private per-agent storage layer (pre-promotion) |
| Shared Memory | Team-visible gossiped layer (post-promotion) |
| Verified Memory | Chain-anchored layer (future, Round 2) |
| Curator | Context Graph owner who controls PUBLISH/SHARE authority |
| UAL | Deterministic artifact URI for stable cross-layer references |

No terminology deviations.

## 9. Data Classification Protocol

The bridge enforces a "classify at ingestion, guard at promotion" principle to prevent accidental exposure of sensitive content through the trust gradient.

### Sensitivity Levels

Every artifact carries a `wmbo:sensitivity` triple in its provenance quads:

| Level | Description | Promotable? |
|-------|-------------|-------------|
| `public` | Safe for anyone | Yes |
| `shareable` | OK for team (default) | Yes |
| `personal` | Contains PII | No |
| `secret` | Contains credentials/keys | No |

### Automatic PII/Secret Scanning

The `--scan` flag invokes `src/scanner.ts` before ingestion:

- **Secrets detected** (API keys, tokens, SSH keys) → ingestion blocked entirely
- **PII detected** (emails, IPs, home paths) → auto-classified as `personal`
- **Clean content** → proceeds with the specified or default sensitivity

The scanner provides `scanContent()` for detection and `redactContent()` for replacing matches with `[REDACTED]`.

### Promotion Guards

The `promote` command checks `wmbo:sensitivity` before proceeding:

- `public` or `shareable` → promotion allowed
- `personal` or `secret` → promotion refused with an error explaining why

This ensures sensitive content stays in Working Memory on the operator's own node and never reaches Shared Memory or the broader network.

### Audit Logging

All ingest and promote operations are logged to `~/.dkg/audit.log` with:

- Timestamp
- Operation (ingest/promote/discard)
- Artifact name and sensitivity level
- Scan results (if `--scan` was used)
- Success/failure status

### Trust Gradient with Sensitivity

```
  ┌─────────────────────────────────────────────────────────┐
  │  Working Memory (private, per-agent)                    │
  │    sensitivity: public | shareable | personal | secret  │
  │    status: draft → reviewed → promote-ready             │
  └──────────────┬──────────────────────────────────────────┘
                 │ promote (blocked if personal/secret)
  ┌──────────────▼──────────────────────────────────────────┐
  │  Shared Memory (GossipSub, team-visible)                │
  │    sensitivity: public | shareable only                 │
  │    status: promoted                                     │
  └──────────────┬──────────────────────────────────────────┘
                 │ publish (future: Round 2)
  ┌──────────────▼──────────────────────────────────────────┐
  │  Verified Memory (on-chain)                             │
  │    sensitivity: public | shareable only                 │
  │    status: verified-ready → verified                    │
  └─────────────────────────────────────────────────────────┘
```

## 10. Security Considerations (updated in 0.1.5)

- **Network egress:** None beyond the local DKG node (`127.0.0.1:9200`).
- **Write authority:** `POST /api/assertion/create`, `POST /api/assertion/:name/write`, `POST /api/assertion/:name/promote`. No Curator-authority operations (PUBLISH/SHARE to chain) in Round 1.
- **Credentials:** DKG auth token only (read from `~/.dkg/auth.token` or `DKG_AUTH_TOKEN` env var). No third-party credentials.
- **No install scripts.** Zero postinstall/preinstall behavior.
- **No dynamic code loading.** No eval, no remote module fetch.
- **Content sensitivity:** Artifacts may contain agent memory (personal context). All storage is local Working Memory on the operator's own node — nothing leaves the machine unless explicitly promoted to Shared Memory.

## 11. Maintenance

- **Maintainer:** @jalopy1
- **Support window:** 6 months post-acceptance, with intent to extend through Rounds 2 and 3
- **Update path:** Registry entry bumps via small PRs (new commit SHA + version)
