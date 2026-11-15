# Instrukcja instalacji EXER Client dla systemu Linux

Niniejszy przewodnik opisuje krok po kroku instalację programu **EXER Client** na wszystkich wiodących dystrybucjach Linuksa. Wszystkie pakiety instalacyjne znajdują się w folderze `dist/`.

---

## 1. Fedora / RHEL / AlmaLinux / Rocky Linux / openSUSE (`.rpm`)

Pakiet: `exer-client-0.5.99-1.fc44.x86_64.rpm`

### Metoda A: Terminal (zalecana)
Otwórz terminal w katalogu z plikiem `.rpm` i wykonaj:

```bash
# Fedora (DNF 5 / DNF):
sudo dnf install ./exer-client-0.5.99-1.fc44.x86_64.rpm

# RHEL / CentOS / AlmaLinux / Rocky:
sudo dnf localinstall ./exer-client-0.5.99-1.fc44.x86_64.rpm

# openSUSE (Zypper):
sudo zypper install ./exer-client-0.5.99-1.fc44.x86_64.rpm
```

### Metoda B: Interfejs graficzny (GUI)
1. Otwórz menedżer plików i przejdź do folderu `dist/`.
2. Kliknij dwukrotnie plik `exer-client-0.5.99-1.fc44.x86_64.rpm`.
3. Otworzy się aplikacja **Oprogramowanie** (GNOME Software) lub **Discover**.
4. Kliknij przycisk **Zainstaluj** i podaj hasło użytkownika.

### Deinstalacja:
```bash
sudo dnf remove exer-client
```

---

## 2. Arch Linux / Manjaro / EndeavourOS (`.pkg.tar.zst` lub AUR)

Pakiet: `exer-client-bin-0.5.99-1-x86_64.pkg.tar.zst`

### Metoda A: Bezpośrednia instalacja paczki Pacmanem
Otwórz terminal w katalogu z plikiem `.pkg.tar.zst`:

```bash
sudo pacman -U ./exer-client-bin-0.5.99-1-x86_64.pkg.tar.zst
```

### Metoda B: Kompilacja z pliku PKGBUILD (standard AUR)
Jeśli preferujesz budowanie przez `makepkg` (lub chcesz wrzucić paczkę do AUR):

```bash
cd packaging/arch
makepkg -si
```

### Metoda C: Interfejs graficzny (Pamac / Manjaro)
1. Kliknij dwukrotnie na plik `exer-client-bin-0.5.99-1-x86_64.pkg.tar.zst`.
2. Pamac wyświetli szczegóły paczki i zależności.
3. Kliknij **Zastosuj** (Apply).

### Deinstalacja:
```bash
sudo pacman -R exer-client-bin
```

---

## 3. Ubuntu / Debian / Linux Mint / Pop!_OS (`.deb`)

Pakiet: `exer-client_0.5.99_amd64.deb`

### Metoda A: Terminal (zalecana z automatycznym dociągnięciem zależności)
Otwórz terminal w katalogu z plikiem `.deb`:

```bash
sudo apt install ./exer-client_0.5.99_amd64.deb
```
*(Uwaga: Użyj `./` przed nazwą pliku, aby APT wiedział, że instaluje plik lokalny, a nie z repozytorium sieciowego).*

Alternatywnie klasyczny `dpkg`:
```bash
sudo dpkg -i exer-client_0.5.99_amd64.deb
sudo apt install -f   # w razie brakujących bibliotek systemowych
```

### Metoda B: Interfejs graficzny (GUI)
1. Kliknij dwukrotnie plik `exer-client_0.5.99_amd64.deb`.
2. Otworzy się **Centrum Oprogramowania Ubuntu**, **Grybi** (Gdebi) lub **Instalator pakietów Minta**.
3. Kliknij **Zainstaluj pakiet** i podaj hasło.

### Deinstalacja:
```bash
sudo apt remove exer-client
```

---

## 4. AppImage (Dowolna dystrybucja Linuksa — bez uprawnień roota)

Pakiet: `exer-client-0.5.99-linux-x86_64.AppImage`

Format ten nie wymaga uprawnień administratora (`sudo`) ani instalacji w systemie. Działa na każdej współczesnej dystrybucji.

### Uruchomienie:
1. Nadaj uprawnienia wykonywania:
   ```bash
   chmod +x exer-client-0.5.99-linux-x86_64.AppImage
   ```
2. Uruchom program:
   ```bash
   ./exer-client-0.5.99-linux-x86_64.AppImage
   ```

*(Wskazówka: W systemie Ubuntu 22.04+ jeśli AppImage się nie uruchamia, upewnij się, że masz zainstalowany pakiet `libfuse2`: `sudo apt install libfuse2`).*

---

## 5. Przenośne archiwum TAR.GZ / Skrypt instalatora

Pakiet: `exer-client-0.5.99-linux-x64.tar.gz`

Idealne, gdy chcesz zainstalować klienta tylko dla swojego użytkownika (w katalogu domowym `~/.local/share/exer-client`):

```bash
# 1. Wypakowanie:
tar -xzf exer-client-0.5.99-linux-x64.tar.gz
cd exer-client-0.5.99-linux-x64

# 2. Bezpośrednie uruchomienie portable:
./exer-client.sh

# 3. Lub instalacja skrótów systemowych i polecenia w terminalu:
./install.sh
```

---

## Jak uruchamiać EXER Client po instalacji?

Niezależnie od wybranej dystrybucji (RPM, DEB, Arch, skrypt instalacyjny):

1. **Z menu aplikacji**: Wyszukaj w launcherze systemowym (Super / Windows key) po prostu: **EXER Client**.
2. **Z terminala**: Wpisz polecenie:
   ```bash
   exer-client
   ```
3. **Z przeglądarki i Discorda**: Launcher automatycznie rejestruje protokół `exer://`, dzięki czemu kliknięcie przycisków dołączenia do serwera (np. `exer://join/adres-serwera`) automatycznie uruchamia launcher.

---

## Wymagania dotyczące środowiska Java

EXER Client posiada **wbudowane inteligentne zarządzanie środowiskiem Java**:
- Jeśli w systemie zainstalowany jest pakiet `java` (np. OpenJDK 21 / 25), launcher wykrywa go automatycznie.
- Jeśli brakuje odpowiedniej wersji dla wybranego profilu Minecrafta (np. Minecraft 1.8.9 wymaga Java 8, a 1.21 wymaga Java 21), **launcher samoczynnie pobierze odpowiednie linuksowe środowisko Adoptium JRE** do swojej pamięci podręcznej i uruchomi grę bez ingerencji użytkownika.
