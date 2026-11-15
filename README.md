# EXER Client — Linux Port

Natywny port klienta i launchera EXER dla systemu Linux.

## Pakiety instalacyjne dla dystrybucji

Dostępne są gotowe paczki dla wszystkich wiodących rodzin Linuksa:

1. **Fedora / RHEL / openSUSE (`.rpm`)**:
   ```bash
   sudo dnf install ./exer-client-0.5.99-1.fc44.x86_64.rpm
   ```
2. **Arch Linux / Manjaro (`.pkg.tar.zst` oraz AUR `PKGBUILD`)**:
   ```bash
   sudo pacman -U ./exer-client-bin-0.5.99-1-x86_64.pkg.tar.zst
   ```
3. **Debian / Ubuntu / Linux Mint (`.deb`)**:
   ```bash
   sudo apt install ./exer-client_0.5.99_amd64.deb
   ```
4. **AppImage (Uniwersalny dla każdego Linuksa)**:
   ```bash
   chmod +x exer-client-0.5.99-linux-x86_64.AppImage
   ./exer-client-0.5.99-linux-x86_64.AppImage
   ```
5. **TAR.GZ (Przenośne archiwum z instalatorem)**:
   ```bash
   tar -xzf exer-client-0.5.99-linux-x64.tar.gz
   cd exer-client-0.5.99-linux-x64
   ./exer-client.sh
   ```

## Uruchamianie ze źródeł

Wymagania: Node.js (>= 20) oraz npm.

```bash
# Instalacja zależności
npm install

# Uruchomienie aplikacji
npm start
```

## Budowanie paczek

Aby automatycznie zbudować pakiety:

```bash
./scripts/package_all.sh
```

## CI/CD (GitHub Actions)

W repozytorium skonfigurowany jest plik `.github/workflows/build-and-release.yml`, który automatycznie buduje pakiety i publikuje je jako GitHub Releases po utworzeniu taga (np. `v0.5.99`).
