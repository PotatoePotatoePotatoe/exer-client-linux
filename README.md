# EXER Client — Linux Port

Natywny port klienta i launchera EXER dla systemu Linux.

## Pakiety instalacyjne

W folderze wyjściowym dostępne są gotowe paczki:
- **AppImage**: samodzielny plik wykonywalny, działa na większości dystrybucji Linuksa.
- **DEB**: dedykowana paczka dla systemów Debian, Ubuntu, Linux Mint itp.
- **TAR.GZ**: przenośne archiwum z plikami aplikacji i skryptem instalacyjnym.

## Uruchamianie ze źródeł

Wymagania: Node.js (>= 20) oraz npm.

```bash
# Instalacja zależności
npm install

# Uruchomienie aplikacji w trybie deweloperskim
npm start
```

## Budowanie paczek

Aby automatycznie zbudować wersje AppImage, DEB oraz TAR.GZ:

```bash
./scripts/package_all.sh
```

Gotowe pakiety zostaną zapisane w katalogu `dist-packages/` wraz z sumami kontrolnymi `SHA256SUMS.txt`.

## CI/CD (GitHub Actions)

W repozytorium skonfigurowany jest plik `.github/workflows/build-and-release.yml`, który automatycznie buduje pakiety i publikuje je jako GitHub Releases po utworzeniu taga (np. `v0.5.99`).
