#!/bin/sh
# Runs the mechanical steps of one img2threejs build pass for the Ponce City
# Market model: generate, patch, capture (lit, transparent, unlit, sign),
# Tier 1, turntable, multi-angle, pass check, and the comparison sheet.
# The visual review and append_review.py stay manual.
#   sh run_pass.sh <pass-id>
set -e
P="$1"
SK="$HOME/.claude/skills/img2threejs"
ROOT="$(cd ../.. && pwd)"
URL="http://localhost:5174/landmarks/ponce-city-market/preview.html"
R="renders/$P"
python3 "$SK/forge/stage3_build/generate_threejs_factory.py" object-sculpt-spec.json --out src/createPonceCityMarketModel.ts --pass-id "$P" --force > /dev/null
python3 post_generate.py
(cd "$ROOT" && node scripts/landmark-capture.mjs "$URL?part=tower&frame=top" "landmarks/ponce-city-market/$R/top" "20,110,200,290" 12 600x765 > /dev/null)
(cd "$ROOT" && node scripts/landmark-capture.mjs "$URL?part=tower&frame=top&bg=none" "landmarks/ponce-city-market/$R/alpha" "20,110,200,290" 12 600x765 > /dev/null)
(cd "$ROOT" && node scripts/landmark-capture.mjs "$URL?part=tower&frame=top&unlit=1" "landmarks/ponce-city-market/$R/unlit" "20" 12 600x765 > /dev/null)
python3 "$SK/forge/stage4_review/diagnose_render.py" --reference crops/tower-masked.png --render "$R/top/az020.png" --map-stripped-render "$R/unlit/az020.png" --spec object-sculpt-spec.json --pass-id "$P" --in-place > "$R/tier1.txt" 2>&1 || { echo "tier1 FAILED"; tail -5 "$R/tier1.txt"; exit 1; }
python3 "$SK/forge/stage4_review/turntable_gate.py" --capture 0="$R/alpha/az020.png" --capture 90="$R/alpha/az110.png" --capture 180="$R/alpha/az200.png" --capture 270="$R/alpha/az290.png" --json > "$R/turntable.json" 2>&1 || { echo "turntable FAILED"; exit 1; }
python3 "$SK/forge/stage4_review/diagnose_render_multi_angle.py" --reference "$R/top/az020.png" --orbit "$R/top/az110.png" --orbit "$R/top/az200.png" > "$R/multi-angle.txt" 2>&1 || { echo "multi-angle FAILED"; exit 1; }
python3 "$SK/forge/stage3_build/orchestrate_passes.py" check object-sculpt-spec.json --pass-id "$P" > "$R/pass-check.txt" 2>&1 || { echo "pass check FAILED"; tail -3 "$R/pass-check.txt"; exit 1; }
python3 "$SK/forge/stage4_review/make_comparison_sheet.py" --reference crops/tower-masked.png --render "$R/top/az020.png" --out "$R/cmp.png" --json > /dev/null
for st in build-current-pass render-capture review-contract-read tier1-diagnostics multi-angle-review pass-gate-check; do
  python3 "$SK/forge/state.py" mark "$st" --state .img2threejs/state.json --evidence "$R/tier1.txt" > /dev/null 2>&1 || true
done
grep -o "triangles\": [0-9]*" "$R/top/../../../$R/top/az020.png" 2>/dev/null || true
echo "pass $P: gates PASS; review $R/cmp.png"
