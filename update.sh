#!/usr/bin/env bash
# ==============================================================================
# EXER Client — Automatyczny Aktualizator (CLI / GUI)
# Pobiera najnowszą wersję bezpośrednio z oficjalnego repozytorium GitHub:
# https://github.com/PotatoePotatoePotatoe/exer-client-linux
# ==============================================================================
set -e

REPO="PotatoePotatoePotatoe/exer-client-linux"
RAW_URL="https://raw.githubusercontent.com/$REPO/main"
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"

echo "========================================================"
echo "       EXER Client — Sprawdzanie i Pobieranie Aktualizacji"
echo "       Repozytorium: $REPO"
echo "========================================================"

# Jeśli w bieżącym katalogu istnieje exer-installer.sh, uruchom go lokalnie
if [ -f "$SCRIPT_DIR/exer-installer.sh" ]; then
    exec "$SCRIPT_DIR/exer-installer.sh" --auto "$@"
elif [ -f "$SCRIPT_DIR/installer_gui/exer-installer.sh" ]; then
    exec "$SCRIPT_DIR/installer_gui/exer-installer.sh" --auto "$@"
elif command -v exer-installer.sh >/dev/null 2>&1; then
    exec exer-installer.sh --auto "$@"
else
    # W przeciwnym razie pobierz i uruchom w locie najnowszy instalator/updater z GitHuba
    curl -sSL "$RAW_URL/exer-installer.sh" | bash -s -- --auto "$@"
fi
