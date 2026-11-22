#!/usr/bin/env bash
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION=$(node -p "require('$REPO_ROOT/package.json').version || '0.5.99'")
ELECTRON_VERSION="v44.9.0"

DIST_DIR="$REPO_ROOT/dist-packages"
BUILD_DIR="$REPO_ROOT/.build"
CACHE_DIR="$REPO_ROOT/.cache"

mkdir -p "$DIST_DIR" "$BUILD_DIR" "$CACHE_DIR"

echo "=========================================================="
echo " Budowanie pakietów EXER Client dla Linuksa (v$VERSION)    "
echo " Format: AppImage, DEB, TAR.GZ                           "
echo "=========================================================="

# 1. Pobierz Electron Linux jeśli nie ma w cache
ELECTRON_ZIP="$CACHE_DIR/electron-$ELECTRON_VERSION-linux-x64.zip"
if [ ! -f "$ELECTRON_ZIP" ]; then
    echo "-> Pobieranie Electron $ELECTRON_VERSION dla Linux x64..."
    curl -L -o "$ELECTRON_ZIP" "https://github.com/electron/electron/releases/download/$ELECTRON_VERSION/electron-$ELECTRON_VERSION-linux-x64.zip"
fi

# 2. Przygotuj strukturę binarki
APP_ROOT="$BUILD_DIR/app-root"
rm -rf "$APP_ROOT"
mkdir -p "$APP_ROOT"
unzip -q -o "$ELECTRON_ZIP" -d "$APP_ROOT"
rm -f "$APP_ROOT/resources/default_app.asar"
mv "$APP_ROOT/electron" "$APP_ROOT/exer-client"
chmod +x "$APP_ROOT/exer-client" "$APP_ROOT/chrome_crashpad_handler"

# 3. Kopiuj zasoby (client jars, distribution.json itp.)
mkdir -p "$APP_ROOT/resources/client"
if [ -d "$REPO_ROOT/resources/client" ] && [ "$(ls -A "$REPO_ROOT/resources/client" 2>/dev/null)" ]; then
    cp -a "$REPO_ROOT/resources/client/." "$APP_ROOT/resources/client/"
else
    echo "-> Pobieranie brakujących zasobów przez fetch_artifacts.py..."
    python3 "$REPO_ROOT/scripts/fetch_artifacts.py"
    cp -a "$REPO_ROOT/resources/client/." "$APP_ROOT/resources/client/"
fi

cp "$REPO_ROOT/resources/distribution.json" "$APP_ROOT/resources/"
cp "$REPO_ROOT/resources/release-public.pem" "$APP_ROOT/resources/"
cp "$REPO_ROOT/resources/exer-client.png" "$APP_ROOT/exer-client.png"
cp "$REPO_ROOT/exer-update" "$APP_ROOT/exer-update"
cp "$REPO_ROOT/update.sh" "$APP_ROOT/update.sh" 2>/dev/null || true
chmod +x "$APP_ROOT/exer-update" "$APP_ROOT/update.sh" 2>/dev/null || true

# 4. Spakuj app.asar
echo "-> Pakowanie app.asar..."
APP_SRC_STAGE="$BUILD_DIR/app_src"
rm -rf "$APP_SRC_STAGE"
mkdir -p "$APP_SRC_STAGE"
cp -a "$REPO_ROOT/dist" "$APP_SRC_STAGE/"
cp -a "$REPO_ROOT/apps" "$APP_SRC_STAGE/"
cp "$REPO_ROOT/package.json" "$APP_SRC_STAGE/"

# Kopiuj zależności node_modules
if [ -d "$REPO_ROOT/node_modules" ]; then
    cp -a "$REPO_ROOT/node_modules" "$APP_SRC_STAGE/"
fi

npx --yes @electron/asar pack "$APP_SRC_STAGE" "$APP_ROOT/resources/app.asar"
rm -rf "$APP_SRC_STAGE"

# Skrypt uruchomieniowy
cat > "$APP_ROOT/exer-client.sh" <<'EOF'
#!/usr/bin/env bash
REAL_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
DIR="$(cd "$(dirname "$REAL_PATH")" && pwd)"
unset ELECTRON_RUN_AS_NODE
export ELECTRON_OZONE_PLATFORM_HINT="${ELECTRON_OZONE_PLATFORM_HINT:-auto}"

# Auto-bridge Discord RPC socket dla Flatpak (Vesktop / Discord) i Snap
if [ -n "$XDG_RUNTIME_DIR" ] && [ -d "$XDG_RUNTIME_DIR" ]; then
    for i in 0 1 2 3 4 5 6 7 8 9; do
        target="$XDG_RUNTIME_DIR/discord-ipc-$i"
        if [ ! -S "$target" ]; then
            for cand in \
                "$XDG_RUNTIME_DIR/.flatpak/dev.vencord.Vesktop/xdg-run/discord-ipc-$i" \
                "$XDG_RUNTIME_DIR/app/dev.vencord.Vesktop/discord-ipc-$i" \
                "$XDG_RUNTIME_DIR/app/com.discordapp.Discord/discord-ipc-$i" \
                "$XDG_RUNTIME_DIR/app/com.discordapp.DiscordCanary/discord-ipc-$i" \
                "$XDG_RUNTIME_DIR/app/com.discordapp.DiscordPTB/discord-ipc-$i" \
                "$XDG_RUNTIME_DIR/snap.discord/discord-ipc-$i" \
                "$XDG_RUNTIME_DIR/snap.discord-canary/discord-ipc-$i" \
                "$HOME/.var/app/dev.vencord.Vesktop/sandbox/run/user/$(id -u)/discord-ipc-$i" \
                "$HOME/.var/app/com.discordapp.Discord/sandbox/run/user/$(id -u)/discord-ipc-$i"
            do
                if [ -S "$cand" ]; then
                    rm -f "$target" 2>/dev/null || true
                    ln -sf "$cand" "$target" 2>/dev/null || true
                    break
                fi
            done
        fi
    done
fi

exec "$DIR/exer-client" "$@"
EOF
chmod +x "$APP_ROOT/exer-client.sh"

# ----------------------------------------------------
# 5. Generowanie TAR.GZ
# ----------------------------------------------------
echo "-> [1/3] Tworzenie archiwum TAR.GZ..."
TAR_NAME="exer-client-${VERSION}-linux-x64.tar.gz"
tar -czf "$DIST_DIR/$TAR_NAME" --transform "s,^app-root,exer-client-${VERSION}-linux-x64," -C "$BUILD_DIR" app-root
echo "   Utworzono: $DIST_DIR/$TAR_NAME"

# ----------------------------------------------------
# 6. Generowanie DEB
# ----------------------------------------------------
echo "-> [2/3] Tworzenie pakietu DEB..."
DEB_STAGE="$BUILD_DIR/deb-stage"
rm -rf "$DEB_STAGE"
mkdir -p "$DEB_STAGE/DEBIAN"
mkdir -p "$DEB_STAGE/opt/exer-client"
mkdir -p "$DEB_STAGE/usr/bin"
mkdir -p "$DEB_STAGE/usr/share/applications"
mkdir -p "$DEB_STAGE/usr/share/icons/hicolor/256x256/apps"

cp -a "$APP_ROOT/." "$DEB_STAGE/opt/exer-client/"
ln -s "/opt/exer-client/exer-client.sh" "$DEB_STAGE/usr/bin/exer-client"
ln -s "/opt/exer-client/exer-update" "$DEB_STAGE/usr/bin/exer-update"
cp "$REPO_ROOT/resources/exer-client.png" "$DEB_STAGE/usr/share/icons/hicolor/256x256/apps/exer-client.png"

cat > "$DEB_STAGE/usr/share/applications/exer-updater.desktop" <<EOF
[Desktop Entry]
Name=EXER Client — Aktualizator
GenericName=Aktualizacja EXER Client
Comment=Pobierz najnowszą wersję EXER Client z GitHuba
Exec=/usr/bin/exer-update
Icon=exer-client
Terminal=true
Type=Application
Categories=Game;Utility;
EOF
chmod 755 "$DEB_STAGE/usr/share/applications/exer-updater.desktop"

cat > "$DEB_STAGE/usr/share/applications/exer-client.desktop" <<EOF
[Desktop Entry]
Name=EXER Client
GenericName=Minecraft Client & Launcher
Comment=Niezależny klient Minecraft Java Edition (Fabric + Sodium + Kosmetyki 3D)
Exec=/usr/bin/exer-client %u
Icon=exer-client
Terminal=false
Type=Application
Categories=Game;
MimeType=x-scheme-handler/exer;
StartupWMClass=EXER Client
EOF
chmod 755 "$DEB_STAGE/usr/share/applications/exer-client.desktop"

cat > "$DEB_STAGE/DEBIAN/control" <<EOF
Package: exer-client
Version: $VERSION
Section: games
Priority: optional
Architecture: amd64
Maintainer: EXER Client Community Port
Depends: libc6, libgtk-3-0, libnss3, libasound2
Description: EXER Client for Minecraft Java Edition
 Independent Minecraft Java Edition Client with EXER Core,
 Fabric, Sodium and 3D Cosmetics.
EOF

cat > "$DEB_STAGE/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database -q /usr/share/applications || true; fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true; fi
if command -v xdg-mime >/dev/null 2>&1; then xdg-mime default exer-client.desktop x-scheme-handler/exer || true; fi
EOF

cat > "$DEB_STAGE/DEBIAN/postrm" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
    if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database -q /usr/share/applications || true; fi
    if command -v gtk-update-icon-cache >/dev/null 2>&1; then gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true; fi
fi
EOF

chmod 755 "$DEB_STAGE/DEBIAN/postinst" "$DEB_STAGE/DEBIAN/postrm"
DEB_NAME="exer-client_${VERSION}_amd64.deb"
dpkg-deb --build "$DEB_STAGE" "$DIST_DIR/$DEB_NAME" >/dev/null
rm -rf "$DEB_STAGE"
echo "   Utworzono: $DIST_DIR/$DEB_NAME"

# ----------------------------------------------------
# 7. Generowanie AppImage
# ----------------------------------------------------
echo "-> [3/3] Tworzenie AppImage..."
APPDIR_STAGE="$BUILD_DIR/appdir-stage"
rm -rf "$APPDIR_STAGE"
mkdir -p "$APPDIR_STAGE"
cp -a "$APP_ROOT/." "$APPDIR_STAGE/"

cat > "$APPDIR_STAGE/AppRun" <<'EOF'
#!/usr/bin/env bash
HERE="$(dirname "$(readlink -f "${0}")")"
unset ELECTRON_RUN_AS_NODE
export ELECTRON_OZONE_PLATFORM_HINT="${ELECTRON_OZONE_PLATFORM_HINT:-auto}"
export PATH="${HERE}:${PATH}"

# Auto-bridge Discord RPC socket dla Flatpak (Vesktop / Discord) i Snap
if [ -n "$XDG_RUNTIME_DIR" ] && [ -d "$XDG_RUNTIME_DIR" ]; then
    for i in 0 1 2 3 4 5 6 7 8 9; do
        target="$XDG_RUNTIME_DIR/discord-ipc-$i"
        if [ ! -S "$target" ]; then
            for cand in \
                "$XDG_RUNTIME_DIR/.flatpak/dev.vencord.Vesktop/xdg-run/discord-ipc-$i" \
                "$XDG_RUNTIME_DIR/app/dev.vencord.Vesktop/discord-ipc-$i" \
                "$XDG_RUNTIME_DIR/app/com.discordapp.Discord/discord-ipc-$i" \
                "$XDG_RUNTIME_DIR/app/com.discordapp.DiscordCanary/discord-ipc-$i" \
                "$XDG_RUNTIME_DIR/app/com.discordapp.DiscordPTB/discord-ipc-$i" \
                "$XDG_RUNTIME_DIR/snap.discord/discord-ipc-$i" \
                "$XDG_RUNTIME_DIR/snap.discord-canary/discord-ipc-$i" \
                "$HOME/.var/app/dev.vencord.Vesktop/sandbox/run/user/$(id -u)/discord-ipc-$i" \
                "$HOME/.var/app/com.discordapp.Discord/sandbox/run/user/$(id -u)/discord-ipc-$i"
            do
                if [ -S "$cand" ]; then
                    rm -f "$target" 2>/dev/null || true
                    ln -sf "$cand" "$target" 2>/dev/null || true
                    break
                fi
            done
        fi
    done
fi

exec "${HERE}/exer-client" "$@"
EOF
chmod +x "$APPDIR_STAGE/AppRun"

cat > "$APPDIR_STAGE/exer-client.desktop" <<EOF
[Desktop Entry]
Name=EXER Client
GenericName=Minecraft Client & Launcher
Comment=Niezależny klient Minecraft Java Edition (Fabric + Sodium + Kosmetyki 3D)
Exec=exer-client %u
Icon=exer-client
Terminal=false
Type=Application
Categories=Game;
MimeType=x-scheme-handler/exer;
StartupWMClass=EXER Client
EOF
chmod 755 "$APPDIR_STAGE/exer-client.desktop"
cp "$REPO_ROOT/resources/exer-client.png" "$APPDIR_STAGE/exer-client.png"
ln -sf "exer-client.png" "$APPDIR_STAGE/.DirIcon"

APPIMAGETOOL="$CACHE_DIR/appimagetool"
if [ ! -f "$APPIMAGETOOL" ]; then
    echo "   Pobieranie appimagetool..."
    curl -L -o "$APPIMAGETOOL" "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"
    chmod +x "$APPIMAGETOOL"
fi

APPIMAGE_NAME="exer-client-${VERSION}-linux-x86_64.AppImage"
ARCH=x86_64 "$APPIMAGETOOL" --appimage-extract-and-run "$APPDIR_STAGE" "$DIST_DIR/$APPIMAGE_NAME" >/dev/null
rm -rf "$APPDIR_STAGE"
echo "   Utworzono: $DIST_DIR/$APPIMAGE_NAME"

# ----------------------------------------------------
# 8. Generowanie RPM (jeśli dostępne narzędzie rpmbuild)
# ----------------------------------------------------
if command -v rpmbuild >/dev/null 2>&1; then
    echo "-> [4/4] Tworzenie pakietu RPM..."
    RPM_TOPDIR="$BUILD_DIR/rpmbuild"
    rm -rf "$RPM_TOPDIR"
    mkdir -p "$RPM_TOPDIR"/{BUILD,RPMS,SOURCES,SPECS,SRPMS}
    cp "$REPO_ROOT/packaging/fedora/exer-client.spec" "$RPM_TOPDIR/SPECS/"
    mkdir -p "$RPM_TOPDIR/SOURCES/exer-client-linux-x64"
    cp -a "$APP_ROOT/." "$RPM_TOPDIR/SOURCES/exer-client-linux-x64/"
    cp "$REPO_ROOT/resources/exer-client.png" "$RPM_TOPDIR/SOURCES/"
    cat > "$RPM_TOPDIR/SOURCES/exer-client.desktop" <<EOF
[Desktop Entry]
Name=EXER Client
GenericName=Minecraft Client & Launcher
Comment=Niezależny klient Minecraft Java Edition (Fabric + Sodium + Kosmetyki 3D)
Exec=/usr/bin/exer-client %u
Icon=exer-client
Terminal=false
Type=Application
Categories=Game;
MimeType=x-scheme-handler/exer;
StartupWMClass=EXER Client
EOF
    sed -i "s/^Version:.*/Version:        $VERSION/" "$RPM_TOPDIR/SPECS/exer-client.spec"
    rpmbuild --define "_topdir $RPM_TOPDIR" -bb "$RPM_TOPDIR/SPECS/exer-client.spec" >/dev/null 2>&1 || true
    find "$RPM_TOPDIR/RPMS" -name "*.rpm" -exec cp {} "$DIST_DIR/" \; || true
    rm -rf "$RPM_TOPDIR"
fi

# ----------------------------------------------------
# 9. Kopiowanie skryptów instalatora i updatere
# ----------------------------------------------------
echo "-> Kopiowanie skryptów instalatora i updatere..."
cp -f "$REPO_ROOT/exer-installer.sh" "$DIST_DIR/" 2>/dev/null || true
cp -f "$REPO_ROOT/exer-update" "$DIST_DIR/" 2>/dev/null || true
cp -f "$REPO_ROOT/update.sh" "$DIST_DIR/" 2>/dev/null || true
chmod +x "$DIST_DIR/exer-installer.sh" "$DIST_DIR/exer-update" "$DIST_DIR/update.sh" 2>/dev/null || true

# ----------------------------------------------------
# 10. Sumy kontrolne SHA256
# ----------------------------------------------------
echo "-> Generowanie pliku SHA256SUMS.txt..."
cd "$DIST_DIR"
rm -f SHA256SUMS.txt
sha256sum * > SHA256SUMS.txt

echo "=========================================================="
echo " SUKCES! Pakiety zostały wygenerowane w $DIST_DIR"
cat SHA256SUMS.txt
echo "=========================================================="
