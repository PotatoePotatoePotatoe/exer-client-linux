#!/usr/bin/env bash
# ==============================================================================
# EXER Client — Inteligentny Instalator i Aktualizator Linux (GUI / CLI)
# Obsługuje automatyczne pobieranie z GitHuba:
# https://github.com/PotatoePotatoePotatoe/exer-client-linux
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

# Konfiguracja katalogu pamięci podręcznej i instalacja lokalnego updater CLI
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/exer_installer"
mkdir -p "$CACHE_DIR/assets"
BIN_DIR="${HOME}/.local/bin"
mkdir -p "$BIN_DIR"

# Instalacja / aktualizacja narzędzia CLI exer-update
UPDATER_SH="$BIN_DIR/exer-update"
cat << 'EOF' > "$UPDATER_SH"
#!/usr/bin/env bash
# ==============================================================================
# EXER Client — Automatyczny Aktualizator (CLI / GUI)
# ==============================================================================
set -e
REPO="PotatoePotatoePotatoe/exer-client-linux"
RAW_URL="https://raw.githubusercontent.com/$REPO/main"

run_update() {
    echo "========================================================"
    echo "       EXER Client — Sprawdzanie i Aktualizacja"
    echo "       Repozytorium: $REPO"
    echo "========================================================"
    curl -sSL "$RAW_URL/exer-installer.sh" | bash -s -- --auto "$@"
}

if [ ! -t 0 ] && [ -n "$DISPLAY$WAYLAND_DISPLAY" ]; then
    for term in ptyxis foot konsole gnome-terminal xfce4-terminal kitty alacritty xterm; do
        if command -v "$term" >/dev/null 2>&1; then
            exec "$term" -e bash -c "echo '=== EXER Client — Aktualizator ==='; \"$0\" \"$@\"; echo ''; read -p 'Naciśnij [Enter], aby zamknąć to okno...' dummy"
        fi
    done
fi

run_update "$@"
EOF
chmod +x "$UPDATER_SH"

# Utworzenie skrótu .desktop dla aktualizatora w menu aplikacji
DESKTOP_DIR="${HOME}/.local/share/applications"
mkdir -p "$DESKTOP_DIR"
cat << EOF > "$DESKTOP_DIR/exer-updater.desktop"
[Desktop Entry]
Name=EXER Client — Aktualizator
GenericName=Aktualizacja EXER Client
Comment=Pobierz najnowszą wersję EXER Client z GitHuba
Exec=$UPDATER_SH
Icon=exer-client
Terminal=false
Type=Application
Categories=Game;Utility;
EOF
chmod +x "$DESKTOP_DIR/exer-updater.desktop"

INSTALLER_PY=""

# 1. Sprawdzenie czy installer.py jest lokalnie lub w pamięci podręcznej
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/installer_gui/installer.py" ]; then
    INSTALLER_PY="$SCRIPT_DIR/installer_gui/installer.py"
elif [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/installer.py" ]; then
    INSTALLER_PY="$SCRIPT_DIR/installer.py"
elif [ -f "$CACHE_DIR/installer.py" ]; then
    INSTALLER_PY="$CACHE_DIR/installer.py"
fi

# 2. Jeśli nie ma lokalnie (np. uruchomiono przez curl | bash po raz pierwszy)
if [ -z "$INSTALLER_PY" ] || [ ! -f "$INSTALLER_PY" ]; then
    INSTALLER_PY="$CACHE_DIR/installer.py"
    echo "Pobieranie inteligentnego instalatora z GitHuba ($REPO)..."
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
