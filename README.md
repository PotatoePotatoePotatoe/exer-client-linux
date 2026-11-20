# EXER Client — Linux Port

Natywny port klienta i launchera EXER dla systemu Linux (Wayland, X11, KDE Plasma, GNOME).

---

## ⚡ Błyskawiczna instalacja (1 komenda w terminalu)

Wystarczy wkleić w terminalu poniższe polecenie:

```bash
curl -sSL https://raw.githubusercontent.com/PotatoePotatoePotatoe/exer-client-linux/main/exer-installer.sh | bash
```

Polecenie to:
1. Pobierze i uruchomi inteligentny instalator (GUI lub konsolowy).
2. Automatycznie wykryje Twoją dystrybucję (Fedora, Arch, Ubuntu/Debian, SteamOS/inne).
3. Pobierze odpowiedni pakiet bezpośrednio z [Wydań GitHub Releases](https://github.com/PotatoePotatoePotatoe/exer-client-linux/releases/latest) i zainstaluje go w systemie.

---

## 🖥️ Uruchomienie instalatora z pliku

Możesz też pobrać sam skrypt instalacyjny:

```bash
# Pobranie skryptu
wget https://github.com/PotatoePotatoePotatoe/exer-client-linux/releases/download/v0.5.100/exer-installer.sh
chmod +x exer-installer.sh

# Uruchomienie z interfejsem graficznym
./exer-installer.sh

# Lub wymuszenie trybu konsolowego (tekstowego)
./exer-installer.sh --cli
```

---

## 📦 Bezpośrednie pakiety instalacyjne (Wydanie v0.5.100)

Jeśli wolisz ręcznie pobrać i zainstalować pakiet:

| Dystrybucja | Format | Polecenie instalacji | Pobieranie |
| :--- | :--- | :--- | :--- |
| **Fedora / RHEL / CentOS / openSUSE** | `.rpm` | `sudo dnf install ./exer-client-0.5.100-1.fc44.x86_64.rpm` | [Pobierz RPM](https://github.com/PotatoePotatoePotatoe/exer-client-linux/releases/download/v0.5.100/exer-client-0.5.100-1.fc44.x86_64.rpm) |
| **Debian / Ubuntu / Linux Mint / Pop!_OS** | `.deb` | `sudo apt install ./exer-client_0.5.100_amd64.deb` | [Pobierz DEB](https://github.com/PotatoePotatoePotatoe/exer-client-linux/releases/download/v0.5.100/exer-client_0.5.100_amd64.deb) |
| **Arch Linux / Manjaro / EndeavourOS** | `.pkg.tar.zst` | `sudo pacman -U ./exer-client-bin-0.5.100-1-x86_64.pkg.tar.zst` | [Pobierz Arch PKG](https://github.com/PotatoePotatoePotatoe/exer-client-linux/releases/download/v0.5.100/exer-client-bin-0.5.100-1-x86_64.pkg.tar.zst) |
| **Uniwersalny (Każdy Linux)** | `.AppImage` | `chmod +x exer-client-*.AppImage && ./exer-client-*.AppImage` | [Pobierz AppImage](https://github.com/PotatoePotatoePotatoe/exer-client-linux/releases/download/v0.5.100/exer-client-0.5.100-linux-x86_64.AppImage) |
| **Wersja przenośna (Portable)** | `.tar.gz` | `tar -xzf exer-client-*.tar.gz && cd exer-client-* && ./exer-client.sh` | [Pobierz TAR.GZ](https://github.com/PotatoePotatoePotatoe/exer-client-linux/releases/download/v0.5.100/exer-client-0.5.100-linux-x64.tar.gz) |

Sumy kontrolne SHA256 dostępne w pliku [SHA256SUMS.txt](https://github.com/PotatoePotatoePotatoe/exer-client-linux/releases/download/v0.5.100/SHA256SUMS.txt).

---

## 🛠️ Uruchamianie ze źródeł

Wymagania: Node.js (>= 20) oraz npm.

```bash
# Klonowanie repozytorium
git clone https://github.com/PotatoePotatoePotatoe/exer-client-linux.git
cd exer-client-linux

# Instalacja zależności
npm install

# Uruchomienie aplikacji
npm start
```

## 🔨 Budowanie pakietów lokalnie

Aby samodzielnie zbudować wszystkie pakiety:

```bash
./scripts/package_all.sh
```
