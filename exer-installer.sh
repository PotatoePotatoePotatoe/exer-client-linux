#!/usr/bin/env bash
# ==============================================================================
# EXER Client — Inteligentny Instalator Linux (GUI / CLI)
# Obsługuje uruchamianie lokalne oraz automatyczne pobieranie z GitHuba
# ==============================================================================
set -e

REPO="PotatoePotatoePotatoe/exer-client-linux"
BRANCH="main"
RAW_URL="https://raw.githubusercontent.com/$REPO/$BRANCH"

# Ścieżka skryptu (jeśli uruchomiono z pliku)
if [ -n "${BASH_SOURCE[0]}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
else
    SCRIPT_DIR=""
fi

# Sprawdzenie obecności Pythona 3
if ! command -v python3 >/dev/null 2>&1; then
    echo "[BŁĄD] Wymagany jest Python 3. Zainstaluj pakiet python3 w swoim systemie." >&2
    exit 1
fi

INSTALLER_PY=""

# 1. Sprawdzenie czy installer.py jest lokalnie
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/installer_gui/installer.py" ]; then
    INSTALLER_PY="$SCRIPT_DIR/installer_gui/installer.py"
elif [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/installer.py" ]; then
    INSTALLER_PY="$SCRIPT_DIR/installer.py"
fi

# 2. Jeśli nie ma lokalnie (np. pobrano tylko ten skrypt lub odpalamy przez curl | bash)
if [ -z "$INSTALLER_PY" ] || [ ! -f "$INSTALLER_PY" ]; then
    CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/exer_installer"
    mkdir -p "$CACHE_DIR/assets"
    INSTALLER_PY="$CACHE_DIR/installer.py"
    
    echo "Pobieranie inteligentnego instalatora z GitHuba..."
    if command -v curl >/dev/null 2>&1; then
        curl -sSL "$RAW_URL/installer_gui/installer.py" -o "$INSTALLER_PY"
        curl -sSL "$RAW_URL/installer_gui/assets/icon.png" -o "$CACHE_DIR/assets/icon.png" 2>/dev/null || true
    elif command -v wget >/dev/null 2>&1; then
        wget -qO "$INSTALLER_PY" "$RAW_URL/installer_gui/installer.py"
        wget -qO "$CACHE_DIR/assets/icon.png" "$RAW_URL/installer_gui/assets/icon.png" 2>/dev/null || true
    else
        echo "[BŁĄD] Wymagany jest program curl lub wget do pobrania instalatora." >&2
        exit 1
    fi
fi

exec python3 "$INSTALLER_PY" "$@"
