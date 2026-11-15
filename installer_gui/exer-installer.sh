#!/usr/bin/env bash
# ==============================================================================
# EXER Client — Inteligentny Instalator Linux (GUI / CLI)
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"

# Sprawdzenie obecności Pythona 3
if ! command -v python3 >/dev/null 2>&1; then
    echo "[BŁĄD] Wymagany jest Python 3. Zainstaluj go w swoim systemie." >&2
    exit 1
fi

# Uruchomienie instalatora
exec python3 "$SCRIPT_DIR/installer.py" "$@"
