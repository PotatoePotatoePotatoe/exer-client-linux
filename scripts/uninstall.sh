#!/usr/bin/env bash
set -e

TARGET_DIR="${HOME}/.local/share/exer-client"
BIN_DIR="${HOME}/.local/bin"
DESKTOP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/256x256/apps"

echo "Usuwanie EXER Client z systemu Linux..."

rm -rf "$TARGET_DIR"
rm -f "$BIN_DIR/exer-client"
rm -f "$DESKTOP_DIR/exer-client.desktop"
rm -f "$ICON_DIR/exer-client.png"

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
fi

echo "EXER Client został pomyślnie odinstalowany."
echo "Dane gry (%APPDATA%/EXER Client -> ~/.config/EXER Client) pozostały nienaruszone."
