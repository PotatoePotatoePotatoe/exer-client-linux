#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${HOME}/.local/share/exer-client"
BIN_DIR="${HOME}/.local/bin"
DESKTOP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/256x256/apps"

echo "========================================================"
echo "          Instalacja EXER Client dla Linuksa            "
echo "========================================================"

mkdir -p "$TARGET_DIR" "$BIN_DIR" "$DESKTOP_DIR" "$ICON_DIR"

echo "-> Kopiowanie plików klienta do $TARGET_DIR..."
cp -a "$SCRIPT_DIR/exer-client-linux-x64/." "$TARGET_DIR/"

echo "-> Ustawianie uprawnień wykonywania..."
chmod +x "$TARGET_DIR/exer-client" "$TARGET_DIR/exer-client.sh" "$TARGET_DIR/chrome_crashpad_handler"

echo "-> Tworzenie dowiązania symbolicznego w $BIN_DIR/exer-client..."
ln -sf "$TARGET_DIR/exer-client.sh" "$BIN_DIR/exer-client"

echo "-> Kopiowanie ikony aplikacji..."
cp "$TARGET_DIR/exer-client.png" "$ICON_DIR/exer-client.png"

echo "-> Tworzenie skrótu w menu aplikacji ($DESKTOP_DIR/exer-client.desktop)..."
cat > "$DESKTOP_DIR/exer-client.desktop" <<EOF
[Desktop Entry]
Name=EXER Client
GenericName=Minecraft Client & Launcher
Comment=Niezależny klient Minecraft Java Edition (Fabric + Sodium + Kosmetyki 3D)
Exec=$TARGET_DIR/exer-client.sh %u
Icon=exer-client
Terminal=false
Type=Application
Categories=Game;
MimeType=x-scheme-handler/exer;
StartupWMClass=EXER Client
EOF
chmod +x "$DESKTOP_DIR/exer-client.desktop"

# Rejestracja protokołu exer://
if command -v xdg-mime >/dev/null 2>&1; then
    xdg-mime default exer-client.desktop x-scheme-handler/exer 2>/dev/null || true
fi

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
fi

echo "========================================================"
echo " INSTALACJA ZAKOŃCZONA POMYŚLNIE!"
echo " Możesz teraz uruchomić EXER Client za pomocą:"
echo "   1) Skrótu w menu aplikacji / pulpicie"
echo "   2) Wpisując w terminalu: exer-client"
echo "   3) Bezpośrednio: $TARGET_DIR/exer-client.sh"
echo "========================================================"
