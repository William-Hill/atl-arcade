#!/usr/bin/env bash
# Paintover of an in-game pbr frame toward docs/art-direction-pbr.md, with
# ImageMagick 6 only (free, deterministic). Not a renderer change: it shows
# the target for #157/#160 on today's frame.
#   scripts/art/paintover.sh <mode> in.png out.png
# Modes:
#   day    pale lawn -> mid green, deeper tonal range, warm highlights / cool shadows
#   mural  day + a saturation lift on the painted walls (non-green, non-sky)
#   night  deeper blacks, warm lamp pools on the ground, hot sign cores
set -euo pipefail
mode=$1 in=$2 out=$3
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
W=$(identify -format %w "$in") H=$(identify -format %h "$in")

# Grass mask: green-dominant, low-saturation, bright pixels (the hazy lawn).
convert "$in" -fx 'g>r*1.08 && g>b && saturation<0.6 && saturation>0.05 && lightness>0.3 ? 1 : 0' -blur 0x1.5 "$tmp/grass.png"
# Lawn recolor: multiply toward a mid green (#5f8f45) and keep the scan's texture.
convert "$in" -colorspace Gray \( +clone -fill '#6f9a52' -colorize 100 \) -compose multiply -composite -level 0,88% -modulate 100,85,100 "$tmp/lawn.png"
convert "$in" "$tmp/lawn.png" "$tmp/grass.png" -compose over -composite "$tmp/base.png"

grade() { # in out contrast warm
  convert "$1" -sigmoidal-contrast "$3"x48% -level 2%,99% \
    \( +clone -colorspace Gray -level 40%,100% \) \
    \( -clone 0 -channel R -evaluate multiply "1.0$4" -channel B -evaluate multiply 0.96 +channel \) \
    \( -clone 0 -channel B -evaluate multiply 1.03 -channel R -evaluate multiply 0.98 +channel \) \
    -delete 0 -reverse -compose over -composite "$2"
}

case $mode in
  day)
    grade "$tmp/base.png" "$out" 3.5 4 ;;
  mural)
    # Murals keep their own pale colors: no lawn recolor in this mode.
    cp "$in" "$tmp/base.png"
    convert "$tmp/base.png" -fx 'saturation>0.25 && !(g>r && g>b) && !(b>r && b>g && lightness>0.6) ? 1 : 0' -blur 0x1 "$tmp/paint.png"
    convert "$tmp/base.png" -modulate 100,135,100 "$tmp/sat.png"
    convert "$tmp/base.png" "$tmp/sat.png" "$tmp/paint.png" -compose over -composite "$tmp/m.png"
    grade "$tmp/m.png" "$out" 3.5 4 ;;
  night)
    convert "$in" -level 6%,92% -gamma 0.85 "$tmp/n.png"
    # Hot cores: lift what is already bright and warm (signs, windows).
    convert "$tmp/n.png" -fx 'lightness>0.55 ? 1 : 0' -blur 0x6 -evaluate multiply 0.6 "$tmp/hot.png"
    convert "$tmp/n.png" \( "$tmp/hot.png" -fill '#ffd9a0' -colorize 0 \) -compose screen -composite "$tmp/n2.png"
    # Warm 4000 K lamp pools on the ground at the lamp positions (x fractions).
    convert -size "${W}x${H}" xc:black \
      -fill '#ffc488' -draw "ellipse $((W*20/100)),$((H*69/100)) $((W/10)),$((H/18)) 0,360" \
      -draw "ellipse $((W*55/100)),$((H*68/100)) $((W/9)),$((H/16)) 0,360" \
      -draw "ellipse $((W*88/100)),$((H*70/100)) $((W/10)),$((H/18)) 0,360" \
      -blur 0x40 -evaluate multiply 0.55 "$tmp/pools.png"
    convert "$tmp/n2.png" "$tmp/pools.png" -compose screen -composite "$out" ;;
  *) echo "unknown mode $mode" >&2; exit 1 ;;
esac
