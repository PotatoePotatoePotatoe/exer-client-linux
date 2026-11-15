#!/usr/bin/env bash
# ==============================================================================
# EXER Linux Builder Studio — Launcher
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"

if ! command -v python3 >/dev/null 2>&1; then
    echo "[BŁĄD] Wymagany jest Python 3." >&2
    exit 1
fi

exec python3 "$SCRIPT_DIR/builder_gui.py" "$@"
