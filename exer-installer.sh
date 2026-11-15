#!/usr/bin/env bash
# ==============================================================================
# EXER Client — Inteligentny Instalator Graficzny Linux
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
exec "$SCRIPT_DIR/installer_gui/exer-installer.sh" "$@"
