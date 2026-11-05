#!/usr/bin/env bash
# Prepares OpenStreetMap data for the local OSRM server (walking/running profile).
#
#   ./osrm/prepare.sh                         Uzbekistan from Geofabrik
#   ./osrm/prepare.sh path/to/region.osm.pbf  a file you already have
#   ./osrm/prepare.sh https://.../x.osm.pbf   any other extract
#
# Then: docker compose up -d osrm
set -euo pipefail

cd "$(dirname "$0")"
# Git Bash on Windows: do not rewrite the /data paths given to docker.
export MSYS_NO_PATHCONV=1
SRC="${1:-https://download.geofabrik.de/asia/uzbekistan-latest.osm.pbf}"
IMAGE="${OSRM_IMAGE:-osrm/osrm-backend:latest}"
PROFILE="${OSRM_PROFILE_LUA:-/opt/foot.lua}"
DATA="$PWD/data"

mkdir -p "$DATA"
if [[ "$SRC" =~ ^https?:// ]]; then
  echo "Yuklanmoqda: $SRC"
  curl -L --fail --progress-bar -o "$DATA/map.osm.pbf.part" "$SRC"
  mv "$DATA/map.osm.pbf.part" "$DATA/map.osm.pbf"
else
  cp "$SRC" "$DATA/map.osm.pbf"
fi

# Old results of another map must not mix with the new ones.
find "$DATA" -name 'map.osrm*' -delete

# Docker on Windows wants C:/... rather than Git Bash's /c/... (pwd -W gives that).
HOST_DATA="$(cd "$DATA" && (pwd -W 2>/dev/null || pwd))"
run() { docker run --rm -v "$HOST_DATA:/data" "$IMAGE" "$@"; }
echo "1/3 osrm-extract ($PROFILE)"
run osrm-extract -p "$PROFILE" /data/map.osm.pbf
echo "2/3 osrm-partition"
run osrm-partition /data/map.osrm
echo "3/3 osrm-customize"
run osrm-customize /data/map.osrm

echo "Tayyor. Endi: docker compose up -d osrm"
