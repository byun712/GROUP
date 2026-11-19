#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24 or later is required: https://nodejs.org/"
  exit 1
fi
if ! node -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"; then
  echo "Please install Node.js 24 or later."
  exit 1
fi
if [ ! -f dist/index.html ]; then
  echo "App files are missing. Run: npm run build"
  exit 1
fi
export HOST=127.0.0.1 PORT="${PORT:-4174}"
echo "Open http://127.0.0.1:${PORT}/todo/ in your browser."
echo "Keep this terminal open. Press Ctrl+C to stop."
exec node scripts/serve.mjs --preview
