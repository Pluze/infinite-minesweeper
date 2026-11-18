#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [ -d "$PWD/.runtime/node-v22.16.0-darwin-arm64/bin" ]; then
  export PATH="$PWD/.runtime/node-v22.16.0-darwin-arm64/bin:$PATH"
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 18+ is required. Install Node.js and try again."
  read -r -p "Press Enter to exit…"
  exit 1
fi
url="http://127.0.0.1:5173"
# Reuse an existing development server rather than starting a competing one.
if page=$(curl --noproxy '*' --silent --fail --max-time 3 "$url/" 2>/dev/null); then
  if [[ "$page" == *"<title>Infinite Minesweeper · Auto Explorer</title>"* && "$page" == *"/@vite/client"* ]]; then
    echo "Infinite Minesweeper is already running: $url"
    if command -v open >/dev/null 2>&1; then open "$url"; fi
    exit 0
  fi
  echo "Port 5173 is occupied by another web server."
  echo "Close that server or free the port, then run this launcher again."
  if [ -t 0 ]; then read -r -p "Press Enter to exit…" || true; fi
  exit 1
fi
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 5173 is occupied, but the server is not responding as Infinite Minesweeper."
  echo "Wait for it to finish starting, or close the process using this port."
  if [ -t 0 ]; then read -r -p "Press Enter to exit…" || true; fi
  exit 1
fi
if [ ! -d node_modules ]; then npm ci --no-audit --no-fund; fi
echo "Infinite Minesweeper: http://127.0.0.1:5173 (Press Ctrl+C to stop the server)"
exec npm start
