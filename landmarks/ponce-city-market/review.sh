#!/bin/sh
# Records one img2threejs review for run v2 and advances the local state.
#   sh review.sh <pass-id> <fidelity> <action> <summary> <layer-json> <feature-json>
set -e
SK="$HOME/.claude/skills/img2threejs"
P="$1"; F="$2"; A="$3"; SUM="$4"; L="$5"; FE="$6"
R="renders/v2-$P"
echo "$FE" > "$R/features.json"
python3 "$SK/forge/stage4_review/append_review.py" object-sculpt-spec.json --pass-id "$P" --fidelity "$F" --action "$A" --summary "$SUM" \
  --render-screenshot "$R/top/az020.png" --map-stripped-render "$R/unlit/az020.png" --comparison-image "$R/cmp.png" \
  --ai-vision-score "$F" --layer-scores-json "$L" --feature-reviews-json "$R/features.json" --in-place > "$R/review.txt" 2>&1 || { tail -3 "$R/review.txt"; exit 1; }
python3 "$SK/forge/state.py" mark ai-review-recorded --state .img2threejs/state.json --evidence "$R/cmp.png" > /dev/null 2>&1 || true
python3 "$SK/forge/stage3_build/orchestrate_passes.py" sync object-sculpt-spec.json --in-place > /dev/null 2>&1
python3 "$SK/forge/state.py" mark pipeline-sync --state .img2threejs/state.json --evidence object-sculpt-spec.json > /dev/null 2>&1 || true
python3 "$SK/forge/next.py" --state .img2threejs/state.json object-sculpt-spec.json 2>&1 | grep LOCAL_STATE
