#!/usr/bin/env bash
# Paintover of an in-game pbr frame toward docs/art-direction-pbr.md, with
# ImageMagick 6 only (free, deterministic). Not a renderer change: it shows
# the target for #157/#160 on today's frame.
#   scripts/art/paintover.sh <mode> in.png out.png
# Modes:
#   day    pale lawn -> mid green, deeper tonal range, warm highlights / cool shadows
#   mural  day + a saturation lift on the painted walls (non-green, non-sky)
#   night  deeper blacks, warm lamp pools on the ground, hot sign cores
#   hot    hot noon: saturated green lawn, deep blue sky, hard contrast, cool shadows
#   golden golden hour: orange sky and light, olive lawn, violet shadows, low-sun glare
#   soft   overcast: white-gray sky, low contrast, paint and murals pop
#   neon   neon night: near-black ground, purple sky, magenta/cyan glows, lamp pools
#   wet    wet night: storefront lights mirrored on a dark wet street
# GROUND_Y (0-1, default 0.45): the lawn mask only works below this height.
# GRASS_K (default 1.08): how much greener than red a pixel must be to count as lawn.
# SKY_FUZZ (default 22%): flood-fill tolerance for the sky.
set -euo pipefail
mode=$1 in=$2 out=$3
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
W=$(identify -format %w "$in") H=$(identify -format %h "$in")

GY=${GROUND_Y:-0.45}
# Grass mask: green-dominant, low-saturation, bright pixels (the hazy lawn).
convert "$in" -fx 'j>h*'"$GY"' && g>r*'"${GRASS_K:-1.08}"' && g>b && saturation<0.6 && saturation>0.05 && lightness>0.3 ? 1 : 0' -morphology Close Disk:3 -blur 0x1.5 "$tmp/grass.png"
# Asphalt mask: the light lilac road (blue-leaning gray, low on screen).
convert "$in" -fx 'j>h*0.55 && b>g*1.02 && b>r && saturation<0.3 && lightness>0.35 ? 1 : 0' -morphology Close Disk:2 -blur 0x1.5 "$tmp/road.png"
# Lawn recolor: multiply toward a mid green (#5f8f45) and keep the scan's texture.
convert "$in" -colorspace Gray \( +clone -fill '#6f9a52' -colorize 100 \) -compose multiply -composite -level 0,88% -modulate 100,85,100 "$tmp/lawn.png"
convert "$in" "$tmp/lawn.png" "$tmp/grass.png" -compose over -composite "$tmp/base.png"

# Sky mask: flood fill from the top edge (the sky is one connected region).
skymask() {
  convert "$in" -fuzz "${SKY_FUZZ:-22%}" -fill '#ff00ff' \
    -draw "color $((W/2)),1 floodfill" -draw "color $((W/4)),1 floodfill" -draw "color $((W*3/4)),1 floodfill" \
    -fill white +opaque '#ff00ff' -fill black -opaque '#ff00ff' -negate "$tmp/fill.png"
  # Only blue pixels count as sky, so pale tree trunks and canopy stay.
  convert "$in" -fx 'b>r*1.1 && b>=g*0.98 ? 1 : 0' "$tmp/blue.png"
  convert "$tmp/fill.png" "$tmp/blue.png" -compose multiply -composite -blur 0x1.2 "$tmp/sky.png"
}
# Replace the sky with a vertical gradient (top, horizon).
newsky() { # in out top horizon
  skymask
  convert -size "${W}x$((H*6/10))" gradient:"$3"-"$4" -background "$4" -gravity north -extent "${W}x${H}" "$tmp/grad.png"
  convert "$1" "$tmp/grad.png" "$tmp/sky.png" -compose over -composite "$2"
}
# Recolor the lawn to a color (keeps the scan's texture).
road() { # in out: lilac asphalt -> dark warm gray, below the sidewalk
  convert "$1" \( +clone -colorspace Gray -level 0,170% -fill '#4a4642' -tint 100 -modulate 70 \) "$tmp/road.png" -compose over -composite "$2"
}
lawn() { # in out color
  convert "$in" -colorspace Gray \( +clone -fill "$3" -colorize 100 \) -compose multiply -composite -level 0,80% "$tmp/l2.png"
  convert "$1" "$tmp/l2.png" "$tmp/grass.png" -compose over -composite "$2"
}

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
  hot)
    lawn "$in" "$tmp/a.png" '#5a9a38'
    road "$tmp/a.png" "$tmp/a.png"
    newsky "$tmp/a.png" "$tmp/b.png" '#1f5fc8' '#8cc8f2'
    convert "$tmp/b.png" -sigmoidal-contrast 6x45% -modulate 102,130,100 \
      \( +clone -colorspace Gray -negate -level 55%,100% -fill '#2040a0' -tint 100 \) -compose soft-light -composite "$out" ;;
  golden)
    lawn "$in" "$tmp/a.png" '#6a8a30'
    road "$tmp/a.png" "$tmp/a.png"
    newsky "$tmp/a.png" "$tmp/b.png" '#5a6fc0' '#ffb060'
    convert "$tmp/b.png" \( +clone -fill '#ff9a40' -colorize 100 -evaluate multiply 0.6 \) -compose soft-light -composite \
      \( +clone -colorspace Gray -negate -level 68%,100% \) \( -clone 0 -fill '#5a3a90' -colorize 100 \) \
      +swap -compose over -composite -sigmoidal-contrast 4x50% -modulate 100,120,100 "$tmp/c.png"
    convert -size "$((W*2))x$((H*2))" radial-gradient:'#ffc070'-black -crop "${W}x${H}+$((W/10))+$((H*55/100))" +repage \
      -evaluate multiply 0.3 "$tmp/glare.png"
    convert "$tmp/c.png" "$tmp/glare.png" -compose screen -composite "$out" ;;
  soft)
    lawn "$in" "$tmp/a.png" '#4a7a36'
    road "$tmp/a.png" "$tmp/a.png"
    newsky "$tmp/a.png" "$tmp/b.png" '#c9cfd8' '#eef0f2'
    convert "$tmp/b.png" -sigmoidal-contrast 2x50% +sigmoidal-contrast 1.5x50% -modulate 97,145,100 \
      -channel B -evaluate multiply 1.03 +channel "$out" ;;
  neon)
    newsky "$in" "$tmp/a.png" '#0a0628' '#3a1a5a'
    convert "$tmp/a.png" -level 8%,95% -gamma 0.85 "$tmp/n.png"
    convert "$in" -fx 'lightness>0.5 ? 1 : 0' -blur 0x10 "$tmp/hot.png"
    convert "$tmp/hot.png" -fill '#ff2fb0' -tint 100 -evaluate multiply 0.6 "$tmp/mag.png"
    convert "$tmp/hot.png" -roll +0+$((H/40)) -fill '#20e0ff' -tint 100 -evaluate multiply 0.6 "$tmp/cyan.png"
    convert -size "${W}x${H}" xc:black -fill '#ffb070' \
      -draw "ellipse $((W*20/100)),$((H*70/100)) $((W/9)),$((H/16)) 0,360" \
      -draw "ellipse $((W*55/100)),$((H*69/100)) $((W/8)),$((H/14)) 0,360" \
      -draw "ellipse $((W*88/100)),$((H*71/100)) $((W/9)),$((H/16)) 0,360" -blur 0x35 -evaluate multiply 0.7 "$tmp/pools.png"
    convert "$tmp/n.png" "$tmp/mag.png" -compose screen -composite "$tmp/cyan.png" -compose screen -composite \
      "$tmp/pools.png" -compose screen -composite "$out" ;;
  wet)
    convert "$in" -level 8%,95% -gamma 0.8 "$tmp/n.png"
    # Mirror the lit band (signs and windows) onto the street, streaked and faded.
    R=$((H*62/100))
    convert "$tmp/n.png" -crop "${W}x$((H-R))+0+$((R-(H-R)))" +repage -flip -motion-blur 0x18+90 \
      -modulate 110,140,100 "$tmp/refl.png"
    convert -size "${W}x$((H-R))" gradient:white-black -evaluate multiply 0.75 "$tmp/fade.png"
    convert "$tmp/refl.png" "$tmp/fade.png" -compose multiply -composite "$tmp/rf.png"
    convert "$tmp/n.png" \( -clone 0 -crop "${W}x$((H-R))+0+$R" +repage -evaluate multiply 0.45 \) \
      -geometry +0+$R -compose over -composite "$tmp/d.png"
    convert "$tmp/d.png" "$tmp/rf.png" -geometry +0+$R -compose screen -composite -modulate 100,120,100 "$out" ;;
  *) echo "unknown mode $mode" >&2; exit 1 ;;
esac
