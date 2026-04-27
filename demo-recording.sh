#!/bin/bash
# Demo recording script for dkg-wm-bridge
# Designed for asciinema recording — includes pauses for readability
set -e
cd /home/openclaw/.openclaw/workspace/projects/openclaw-wm-bridge

echo "╔══════════════════════════════════════════════════╗"
echo "║  dkg-wm-bridge — DKG v10 Working Memory Bridge  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
sleep 2

echo "▸ Step 1: Check DKG v10 node connectivity"
echo "$ wm-bridge check"
sleep 1
node dist/cli.js check
echo ""
sleep 2

echo "▸ Step 2: Initialize for an agent"
echo "$ wm-bridge init --agent ResearchBot --framework openclaw -c demo-recording"
sleep 1
node dist/cli.js init --agent ResearchBot --framework openclaw -c demo-recording
echo ""
sleep 2

echo "▸ Step 3: Create sample research artifacts"
sleep 1

cat > /tmp/demo-research.md << 'EOF'
# Decentralized AI Memory Systems

## Overview
Multi-agent AI systems need shared, verifiable memory. The DKG v10 memory model
provides three layers: Working Memory (private), Shared Memory (team), and
Verified Memory (on-chain).

## Key Insight
Agent-produced knowledge benefits from structured provenance — who created it,
when, from what source, and at what confidence level. This enables trust gradients
where artifacts mature from draft to verified status.

## Technologies
- OriginTrail DKG v10 for decentralized knowledge storage
- Schema.org vocabulary for interoperability
- PROV-O for provenance tracking
- GossipSub for Shared Memory replication
EOF

cat > /tmp/demo-daily.md << 'EOF'
# Daily Log — April 26, 2026

## Research Progress
- Investigated DKG v10 Working Memory APIs
- Built ingestion pipeline with node extraction
- Tested multi-agent collaboration via Shared Memory

## Next Steps
- Promote reviewed artifacts to Shared Memory
- Begin Context Oracle integration for Round 2
EOF

echo "Created: demo-research.md (research note)"
echo "Created: demo-daily.md (daily memory log)"
echo ""
sleep 2

echo "▸ Step 4: Ingest a research note into Working Memory"
echo "$ wm-bridge ingest /tmp/demo-research.md -c demo-recording --tags research,dkg,memory"
sleep 1
node dist/cli.js ingest /tmp/demo-research.md -c demo-recording --tags research,dkg,memory
echo ""
echo "  → The node's extraction pipeline parsed the markdown and extracted"
echo "    structured knowledge (entities + relationships). We layered"
echo "    PROV-O provenance and status tags on top."
echo ""
sleep 3

echo "▸ Step 5: Ingest a daily memory log"
echo "$ wm-bridge ingest /tmp/demo-daily.md -c demo-recording --tags daily,memory"
sleep 1
node dist/cli.js ingest /tmp/demo-daily.md -c demo-recording --tags daily,memory
echo ""
sleep 2

echo "▸ Step 6: Ingest inline text (agent-generated knowledge)"
echo '$ wm-bridge ingest-text "Agent Observation" "Multi-agent memory requires..."'
sleep 1
node dist/cli.js ingest-text "Agent Observation" "Multi-agent memory requires a shared substrate with provenance, trust gradients, and eventual verification. The DKG v10 memory model provides exactly this." -c demo-recording --tags observation
echo ""
sleep 2

echo "▸ Step 7: Check Working Memory status"
echo "$ wm-bridge status -c demo-recording"
sleep 1
node dist/cli.js status -c demo-recording
echo ""
sleep 3

echo "▸ Step 8: Promote a reviewed artifact to Shared Memory"
echo "  This moves the artifact from private Working Memory to team-visible"
echo "  Shared Memory via GossipSub — other agents can now discover it."
echo ""
ASSERTION=$(node dist/cli.js status -c demo-recording 2>&1 | grep "research-note" | awk '{print $NF}' | sed 's|urn:dkg:wm-bridge:artifact/|wm-bridge-research-note-|')
echo "$ wm-bridge promote $ASSERTION -c demo-recording"
sleep 1
node dist/cli.js promote "$ASSERTION" -c demo-recording
echo ""
sleep 2

echo "▸ Step 9: Verify promotion — artifact removed from Working Memory"
echo "$ wm-bridge status -c demo-recording"
sleep 1
node dist/cli.js status -c demo-recording
echo ""
sleep 2

echo "╔══════════════════════════════════════════════════╗"
echo "║  Demo complete                                   ║"
echo "║                                                  ║"
echo "║  • Node extraction pipeline: ✅                  ║"
echo "║  • Provenance + status tags: ✅                  ║"
echo "║  • Working Memory ingestion: ✅                  ║"
echo "║  • Shared Memory promotion:  ✅                  ║"
echo "║  • Trust gradient in action: ✅                  ║"
echo "║                                                  ║"
echo "║  npm: dkg-wm-bridge@0.1.0                       ║"
echo "║  github.com/jalopy1/dkg-wm-bridge               ║"
echo "╚══════════════════════════════════════════════════╝"
sleep 3

# Cleanup
rm -f /tmp/demo-research.md /tmp/demo-daily.md
