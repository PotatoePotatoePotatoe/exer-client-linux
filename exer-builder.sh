#!/usr/bin/env bash
# ==============================================================================
# EXER Linux Builder Studio — Launcher
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
exec "$SCRIPT_DIR/exer_builder_studio/exer-builder.sh" "$@"
