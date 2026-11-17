#!/usr/bin/env bash
# Shortens every frozen stretch longer than 6s in docs/demo.gif to 1.5s.
# Those are the registry lookup and the install; typing and the reading
# pauses in docs/demo.tape stay under 6s and are kept as recorded.
# Usage: vhs docs/demo.tape && bash scripts/trim-demo.sh
set -euo pipefail

gif=docs/demo.gif
min=6
keep=1.5

cuts=$(ffmpeg -hide_banner -i "$gif" -vf "freezedetect=n=0.001:d=$min" -map 0:v -f null - 2>&1 |
  awk -v keep="$keep" '
    /freeze_start/ { s = $NF }
    /freeze_end/   { printf "%sbetween(t,%.2f,%.2f)", sep, s + keep, $NF - 0.05; sep = "+" }')

if [ -z "$cuts" ]; then
  echo "No freeze over ${min}s; $gif unchanged."
  exit 0
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
ffmpeg -loglevel error -i "$gif" -filter_complex \
  "fps=25,select='not($cuts)',setpts=N/25/TB,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none" \
  -y "$tmp/demo.gif"
mv "$tmp/demo.gif" "$gif"
echo "Cut: $cuts"
