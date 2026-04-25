#!/bin/bash
# Demo script for DKG Working Memory Bridge
# Shows end-to-end flow: check → init → ingest → status → promote
set -e

echo "=== DKG Working Memory Bridge Demo ==="
echo ""

# 1. Check connectivity
echo "--- Step 1: Check DKG node connectivity ---"
node dist/cli.js check
echo ""

# 2. Initialize (idempotent)
echo "--- Step 2: Initialize for demo agent (OpenClaw) ---"
node dist/cli.js init --agent DemoAgent --framework openclaw -c demo-artifacts
echo ""

# 3. Create a sample artifact
SAMPLE_FILE=$(mktemp /tmp/wm-bridge-demo-XXXX.md)
cat > "$SAMPLE_FILE" << 'EOF'
# Demo Research Note

This is a sample artifact demonstrating the DKG Working Memory Bridge.

## Key Findings

- The bridge converts markdown files to structured RDF with schema.org vocabulary
- Each artifact gets PROV-O provenance (author, timestamp, source, agent identity)
- Status tags track position in the trust gradient: draft → reviewed → promoted
- Deterministic URIs remain stable through WM → SWM → VM promotion

## Conclusion

Agent-produced knowledge artifacts can now flow into the DKG v10 memory model
with full provenance, enabling multi-agent collaboration and eventual verification.
EOF
echo "--- Step 3: Created sample artifact at $SAMPLE_FILE ---"
cat "$SAMPLE_FILE"
echo ""

# 4. Dry run first
echo "--- Step 4: Dry run (preview without writing) ---"
node dist/cli.js ingest "$SAMPLE_FILE" --status draft --tags demo,research --dry-run
echo ""

# 5. Real ingest
echo "--- Step 5: Ingest into Working Memory ---"
node dist/cli.js ingest "$SAMPLE_FILE" --status draft --tags demo,research -c demo-artifacts
echo ""

# 6. Check status
echo "--- Step 6: List artifacts in Working Memory ---"
node dist/cli.js status -c demo-artifacts
echo ""

# 7. Promote (optional — uncomment to test)
# echo "--- Step 7: Promote to Shared Memory ---"
# ASSERTION_NAME=$(node dist/cli.js status -c demo-artifacts 2>&1 | grep "wm-bridge" | head -1 | awk '{print $NF}')
# node dist/cli.js promote "$ASSERTION_NAME" -c demo-artifacts

# Cleanup
rm -f "$SAMPLE_FILE"
echo "=== Demo complete ==="
