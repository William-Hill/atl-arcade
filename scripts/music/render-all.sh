#!/usr/bin/env bash
# Render takes for every track id and seed given: render-all.sh OUT "id:seed id:seed ..."
set -u
out=$1; shift
for job in $1; do
  id=${job%%:*}; seed=${job##*:}
  [ -f "$out/$id-s$seed.wav" ] && continue
  ~/tools/ACE-Step-1.5/.venv-cpu/bin/python "$(dirname "$0")/ace_render.py" --spec "$(dirname "$0")/tracks.spec.json" --id "$id" --seed "$seed" --out "$out" > "$out/$id-s$seed.log" 2>&1
  echo "$job exit $?"
done
