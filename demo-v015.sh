#!/bin/bash
# dkg-wm-bridge v0.1.5 Demo
# Showcasing: query, sensitivity, scan, relationships, promotion guards

set -e

echo "╔══════════════════════════════════════════════╗"
echo "║  dkg-wm-bridge v0.1.5 — Live Demo           ║"
echo "║  Working Memory Bridge for DKG v10           ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
sleep 2

echo "━━━ 1. Check DKG node connection ━━━"
sleep 1
wm-bridge check
echo ""
sleep 2

echo "━━━ 2. Initialize a context graph ━━━"
sleep 1
wm-bridge init --agent DemoAgent --framework openclaw -c demo-v015
echo ""
sleep 2

echo "━━━ 3. Ingest a clean document ━━━"
sleep 1
cat > /tmp/demo-research.md << 'EOF'
# SPARQL Query Patterns for Knowledge Graphs

SPARQL is the W3C standard query language for RDF data.
It supports SELECT, CONSTRUCT, ASK, and DESCRIBE query forms.

## Common Patterns

- Triple pattern matching: `?s ?p ?o`
- FILTER for conditional matching
- OPTIONAL for left joins
- UNION for combining patterns
EOF
wm-bridge ingest /tmp/demo-research.md -c demo-v015 --sensitivity shareable --tags "sparql,rdf,research"
echo ""
sleep 2

echo "━━━ 4. Ingest with --scan (PII detection) ━━━"
sleep 1
wm-bridge ingest-text "Meeting notes: discussed with team at 192.168.1.50 about the new API" "Team Meeting" -c demo-v015 --scan
echo ""
sleep 2

echo "━━━ 5. Ingest with --scan (secret detection — should REFUSE) ━━━"
sleep 1
wm-bridge ingest-text "Config: api_key = sk-test1234567890abcdefghijklmnop" "API Config" -c demo-v015 --scan || true
echo ""
sleep 2

echo "━━━ 6. Ingest with --derived-from (inter-artifact relationship) ━━━"
sleep 1
wm-bridge ingest-text "SPARQL CONSTRUCT queries can generate new RDF graphs from existing data, enabling powerful data transformation pipelines" "SPARQL Advanced" -c demo-v015 --sensitivity shareable --derived-from wm-bridge-document-demo-research
echo ""
sleep 2

echo "━━━ 7. Ingest personal data (sensitivity: personal) ━━━"
sleep 1
wm-bridge ingest-text "Preferred working hours: 9am-5pm, timezone UTC+11" "Work Preferences" -c demo-v015 --sensitivity personal
echo ""
sleep 2

echo "━━━ 8. Query — list all artifacts ━━━"
sleep 1
wm-bridge query -c demo-v015
echo ""
sleep 2

echo "━━━ 9. Query — search with filter ━━━"
sleep 1
wm-bridge query "SPARQL" --sensitivity shareable -c demo-v015
echo ""
sleep 2

echo "━━━ 10. Query — JSON format ━━━"
sleep 1
wm-bridge query --format json --limit 3 -c demo-v015
echo ""
sleep 2

echo "━━━ 11. Promote shareable artifact (should SUCCEED) ━━━"
sleep 1
wm-bridge promote wm-bridge-knowledge-artifact-sparql-advanced -c demo-v015 || true
echo ""
sleep 2

echo "━━━ 12. Promote personal artifact (should be BLOCKED) ━━━"
sleep 1
wm-bridge promote wm-bridge-knowledge-artifact-work-preferences -c demo-v015 || true
echo ""
sleep 2

echo "━━━ 13. Status overview ━━━"
sleep 1
wm-bridge status -c demo-v015
echo ""
sleep 2

echo "━━━ 14. Audit log ━━━"
sleep 1
echo "Last 5 audit entries:"
tail -5 ~/.dkg/audit.log
echo ""
sleep 2

echo "━━━ Cleanup ━━━"
sleep 1
wm-bridge discard wm-bridge-document-demo-research -c demo-v015 2>/dev/null || true
wm-bridge discard wm-bridge-knowledge-artifact-sparql-advanced -c demo-v015 2>/dev/null || true
wm-bridge discard wm-bridge-knowledge-artifact-work-preferences -c demo-v015 2>/dev/null || true
wm-bridge discard wm-bridge-knowledge-artifact-team-meeting -c demo-v015 2>/dev/null || true
rm -f /tmp/demo-research.md
echo "✅ Demo artifacts cleaned up"
echo ""

echo "╔══════════════════════════════════════════════╗"
echo "║  Demo complete — dkg-wm-bridge v0.1.5       ║"
echo "║  npm: npmjs.com/package/dkg-wm-bridge       ║"
echo "║  repo: github.com/jalopy1/dkg-wm-bridge     ║"
echo "╚══════════════════════════════════════════════╝"
