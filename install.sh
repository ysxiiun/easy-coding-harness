#!/usr/bin/env bash
set -euo pipefail

npm install
npm run build
npm link

echo "easy-coding installed. Run: easy-coding --help"
