#!/bin/sh
# Runs the mechanical steps of one img2threejs build pass for the Krog Street
# Market model: generate, capture (the photo camera, a transparent turntable,
# unlit), Tier 1, turntable, multi-angle, pass check, and the comparison
# sheet. The visual review and append_review.py stay manual.
#   sh run_pass.sh <pass-id>
set -e
P="$1"
SK="$HOME/.claude/skills/img2threejs"
ROOT="$(cd ../.. && pwd)"
URL="http://localhost:5174/landmarks/krog-street-market/preview.html"
R="renders/$P"
python3 "$SK/forge/stage3_build/generate_threejs_factory.py" object-sculpt-spec.json --out src/createKrogStreetMarketModel.ts --pass-id "$P" --force > /dev/null
(cd "$ROOT" && node scripts/landmark-capture.mjs "$URL?frame=front" "landmarks/krog-street-market/$R/top" "0" 2 1170x300 > /dev/null)
(cd "$ROOT" && node scripts/landmark-capture.mjs "$URL?frame=front&unlit=1" "landmarks/krog-street-market/$R/unlit" "0" 2 1170x300 > /dev/null)
# Tier 1 reads the front on a transparent background, so the sky is not a
# color group (the gate uses at most 5 groups).
(cd "$ROOT" && node scripts/landmark-capture.mjs "$URL?frame=front&bg=none&hide=below" "landmarks/krog-street-market/$R/front-alpha" "0" 2 1170x300 > /dev/null)
(cd "$ROOT" && node scripts/landmark-capture.mjs "$URL?bg=none" "landmarks/krog-street-market/$R/alpha" "0,90,180,270" 12 768x768 > /dev/null)
(cd "$ROOT" && node scripts/landmark-capture.mjs "$URL" "landmarks/krog-street-market/$R/orbit" "0,90,180" 12 768x768 > /dev/null)
python3 "$SK/forge/stage4_review/diagnose_render.py" --reference crops/front-alpha.png --render "$R/front-alpha/az000.png" --map-stripped-render "$R/unlit/az000.png" --spec object-sculpt-spec.json --pass-id "$P" --in-place > "$R/tier1.txt" 2>&1 || { echo "tier1 FAILED"; python3 -c "import json;t=open('$R/tier1.txt').read();d=json.loads(t[t.index('{'):]);print(d.get('failures'))"; exit 1; }
python3 "$SK/forge/stage4_review/turntable_gate.py" --capture 0="$R/alpha/az000.png" --capture 90="$R/alpha/az090.png" --capture 180="$R/alpha/az180.png" --capture 270="$R/alpha/az270.png" --json > "$R/turntable.json" 2>&1 || { echo "turntable FAILED"; exit 1; }
python3 "$SK/forge/stage4_review/diagnose_render_multi_angle.py" --reference "$R/orbit/az000.png" --orbit "$R/orbit/az090.png" --orbit "$R/orbit/az180.png" > "$R/multi-angle.txt" 2>&1 || { echo "multi-angle FAILED"; exit 1; }
python3 "$SK/forge/stage3_build/orchestrate_passes.py" check object-sculpt-spec.json --pass-id "$P" > "$R/pass-check.txt" 2>&1 || { echo "pass check FAILED"; tail -3 "$R/pass-check.txt"; exit 1; }
python3 "$SK/forge/stage4_review/make_comparison_sheet.py" --reference crops/front-masked.png --render "$R/top/az000.png" --out "$R/cmp.png" --json > /dev/null
for st in build-current-pass render-capture review-contract-read tier1-diagnostics multi-angle-review pass-gate-check; do
  python3 "$SK/forge/state.py" mark "$st" --state .img2threejs/state.json --evidence "$R/tier1.txt" > /dev/null 2>&1 || true
done
echo "pass $P: gates PASS; review $R/cmp.png"
