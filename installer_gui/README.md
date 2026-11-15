# EXER Client — Inteligentny Instalator Graficzny dla Linuksa

Uniwersalny instalator aplikacji **EXER Client** dla systemu Linux z interfejsem graficznym (GUI Tkinter) oraz pełną obsługą trybu tekstowego (CLI).

---

## 🚀 Jak działa instalator?

1. **Automatyczna detekcja dystrybucji**:
   - Analizuje pliki systemowe `/etc/os-release` oraz `/usr/lib/os-release`.
   - Identyfikuje rodzinę systemu użytkownika:
     - **Fedora / Red Hat / CentOS / AlmaLinux / Rocky / openSUSE** $\rightarrow$ rekomenduje pakiet `.rpm`
     - **Arch Linux / Manjaro / EndeavourOS / Garuda / Artix** $\rightarrow$ rekomenduje pakiet `.pkg.tar.zst`
     - **Ubuntu / Debian / Linux Mint / Pop!_OS / Zorin** $\rightarrow$ rekomenduje pakiet `.deb`
     - **Dystrybucje niemodyfikowalne (SteamOS, Silverblue, Bazzite, NixOS)** $\rightarrow$ rekomenduje `.AppImage`
     - **Pozostałe dystrybucje** $\rightarrow$ rekomenduje `.AppImage` lub wersję przenośną `.tar.gz`

2. **Automatyczne wyszukiwanie gotowych pakietów**:
   - Skrypt samoczynnie przeszukuje katalogi `dist/`, podkatalogi oraz bieżący folder w poszukiwaniu odpowiednich plików binarnych.
   - Użytkownik ma też możliwość ręcznego wskazania dowolnego pliku instalacyjnego przyciskiem *Przeglądaj...*.

3. **Wybór trybu instalacji**:
   - **Natywny pakiet systemowy** (instalacja w `/opt/EXER Client`, rejestracja w menedżerze pakietów `dnf` / `apt` / `pacman`, wymaga uprawnień administratora `pkexec` lub `sudo`).
   - **Uniwersalny AppImage** (instalacja do `~/.local/bin/`, **nie wymaga hasła administratora / uprawnień root**).
   - **Wersja przenośna Portable** (wypakowanie `.tar.gz` do `~/.local/share/exer-client/`, **nie wymaga roota**).

4. **Integracja ze środowiskiem graficznym (KDE, GNOME, XFCE itp.)**:
   - Tworzy skrót `.desktop` w menu aplikacji (`~/.local/share/applications/exer-client.desktop`).
   - Umieszcza skrót na pulpicie użytkownika (`~/Pulpit` lub `~/Desktop`).
   - Instaluje ikonę w wysokiej rozdzielczości (256x256).
   - Rejestruje protokół internetowy `exer://` (`xdg-mime`), umożliwiając logowanie i interakcję z przeglądarką.

---

## 💻 Uruchamianie instalatora

### Tryb graficzny (GUI):
Kliknij dwukrotnie plik `exer-installer.sh` w menedżerze plików lub wpisz w terminalu:
```bash
./exer-installer.sh
```
*(lub `python3 installer_gui/installer.py`)*

### Tryb konsolowy (CLI):
Przydatny przy instalacji na serwerze, przez SSH lub gdy nie ma aktywnego środowiska graficznego:
```bash
./exer-installer.sh --cli
```
