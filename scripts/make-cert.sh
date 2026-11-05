#!/usr/bin/env bash
# A self-signed HTTPS certificate for the server, so phones on the local
# network can use the camera and GPS (browsers allow them only over HTTPS).
#   ./scripts/make-cert.sh 192.168.1.20
# Then in server/.env:  HTTPS_CERT=var/cert.pem  HTTPS_KEY=var/key.pem
set -euo pipefail
IP="${1:?Serverning lokal tarmoqdagi IP manzilini bering, masalan 192.168.1.20}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/server/var"
mkdir -p "$OUT"
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout "$OUT/key.pem" -out "$OUT/cert.pem" \
  -subj "/CN=trainee.local" \
  -addext "subjectAltName=IP:${IP},IP:127.0.0.1,DNS:localhost"
echo "Yaratildi: $OUT/cert.pem va $OUT/key.pem"
