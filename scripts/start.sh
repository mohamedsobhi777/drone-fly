#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v uv >/dev/null || { echo 'Install uv first: https://docs.astral.sh/uv/getting-started/installation/'; exit 1; }
command -v npm >/dev/null || { echo 'Install Node.js 22.18 or newer first.'; exit 1; }
uv sync --frozen --extra dev
npm --prefix web ci
npm --prefix web run build
exec uv run --frozen drone-fly

