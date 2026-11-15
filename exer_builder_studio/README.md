# EXER Linux Builder Studio

Kompletna aplikacja graficzna (GUI) oraz konsolowa (CLI) automatyzująca cały proces portowania i budowania pakietów **EXER Client** dla systemu Linux z oryginalnych plików instalatora Windows (`.exe` / `.zip`) lub bezpośrednio z oficjalnego API.

---

## 🎯 Co robi ta aplikacja?

Aplikacja wykonuje automatycznie całą procedurę portowania z systemu Windows na Linux:

1. **Pozyskiwanie ładunku (Payload Extraction)**:
   - Wczytuje wskazany plik `.exe` (np. `EXER-Client-WebSetup.exe`), dekomponuje go lub pobiera powiązany pakiet z serwera.
   - Może również automatycznie połączyć się z oficjalnym API EXER (`api.exerclient.com`), zweryfikować podpis kryptograficzny RSA-SHA256 i pobrać najnowszy pakiet.
   - Obsługuje również bezpośrednie archiwum `.zip`.

2. **Dekompresja i automatyczne łatkowanie kodu (Patch Engine)**:
   - Rozpakowuje `app.asar` za pomocą narzędzia `@electron/asar`.
   - Wstrzykuje poprawki kompatybilności z Linuksem:
     - Odblokowuje system `linux` w regułach uruchamiania launchera (`io.js`).
     - Przekierowuje pobieranie bibliotek natywnych z `natives-windows` (`.dll`) na `natives-linux` (`.so`) w `installer.js`.
     - Dostosowuje pobieranie środowiska Java JRE dla Linuksa (Adoptium Linux `.tar.gz`) oraz obsługę systemowego `/usr/bin/java`.
     - Rozszerza walidator ścieżki Javy (`contracts.js`) o ścieżki uniksowe `/`.
     - Omija wywołania specyficzne dla Windowsa (`powershell`, `tasklist`) w module anticheat.
     - Zapewnia prawidłowe odnajdywanie zasobów `distribution.json`, kluczy publicznych i plików `.jar`.
   - Składa i kompresuje załatany kod z powrotem do `app.asar`.

3. **Integracja z natywnym środowiskiem Electron**:
   - Wykorzystuje oficjalne środowisko uruchomieniowe Electron dla architektury Linux x64 (cache'owane lokalnie).
   - Tworzy zoptymalizowany skrypt uruchomieniowy `exer-client.sh` obsługujący Wayland i X11.

4. **Multi-Format Linux Packaging**:
   - Kompiluje kompletny zestaw gotowych paczek instalacyjnych:
     - 🚀 **`.AppImage`** — jednoplikowa uniwersalna paczka działająca na każdej dystrybucji (zbudowana za pomocą `appimagetool`).
     - 📦 **`.deb`** — natywna paczka dla Debian, Ubuntu, Linux Mint, Pop!_OS (zbudowana z `dpkg-deb`).
     - 🔴 **`.rpm`** — natywna paczka dla Fedora, RHEL, CentOS, openSUSE (zbudowana z `rpmbuild`).
     - 🏹 **`.pkg.tar.zst`** — natywna paczka dla Arch Linux, Manjaro, EndeavourOS (zbudowana z `zstd`).
     - 📁 **`.tar.gz`** — uniwersalna wersja przenośna.
   - Generuje plik sum kontrolnych **`SHA256SUMS.txt`**.

---

## 💻 Uruchamianie aplikacji

### Tryb Graficzny (GUI):
Uruchom skrypt w terminalu lub kliknij go dwukrotnie w menedżerze plików:
```bash
./exer-builder.sh
```
*(lub `python3 exer_builder_studio/builder_gui.py`)*

W oknie graficznym możesz:
1. Wybrać plik wejściowy `.exe` / `.zip` lub zaznaczyć opcję pobrania z API.
2. Zaznaczyć formaty paczek, które chcesz wygenerować (DEB, RPM, AppImage, Arch, TAR.GZ).
3. Wskazać katalog docelowy.
4. Kliknąć **⚡ Rozpocznij budowanie pakietów**.
5. Po zakończeniu kliknąć **📂 Otwórz folder wyjściowy**, aby natychmiast zobaczyć gotowe pliki.

### Tryb Konsolowy (CLI):
Przydatny w skryptach automatyzacji, budowania CI/CD lub na serwerach:
```bash
# Budowanie wszystkich paczek z lokalnego pliku EXE do folderu ./dist
./exer-builder.sh --cli --input "/home/mati/Pobrane/EXER-Client-WebSetup (1).exe" --out ./dist

# Automatyczne pobranie najnowszego wydania z serwera i zbudowanie tylko AppImage i RPM
./exer-builder.sh --cli --online --targets appimage,rpm --out ./dist
```
