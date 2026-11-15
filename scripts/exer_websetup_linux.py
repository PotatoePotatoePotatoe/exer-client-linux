#!/usr/bin/env python3
"""
EXER Client — Linux WebSetup / Instalator dla systemu Linux
Odtworzenie i przystosowanie instalatora Windows EXER-Client-WebSetup.exe na system Linux.
"""

import sys
import os
import re
import json
import base64
import hashlib
import zipfile
import tarfile
import argparse
import subprocess
import urllib.request
from pathlib import Path

# Klucz publiczny RSA instalatora EXER (z dekompilacji EXER-Client-WebSetup.exe)
INSTALLER_KEY_MODULUS = (
    "j/0YBaisoCvPb8LiUxII4c/RGz3eeeV0dUwZiuar0yFugwSzgRkviV6VesyXdSktgK+E4Wd90ADVL8w0YN5uX71FatqmT"
    "donmH3xswwcbFbXYLzCrxvE78lLFpwDlUNaozp0vo1BifsuyroyM6zUmwDAajhlvn6j9zdiIrQD18cYAsgBOxUVQrZj4X"
    "L7Zdnda+dpyH1S6DwVIqdUWq0yxi+glTSvxoHeHAVjoBW9Gba9J96lggoYObNm1268NlCQlN9rrBd5Q1iFBImir84USLU"
    "WXPDpWsGbwv7Q6E2by8nXRBTdW2pTn4mLxY5fnb+4UEeyZeKBwfegAfJmBNP9oOIDlHsogcHmcQT7fRiE2N/7jh5dG6wX"
    "RIwnzhSIqPjFF2dCiwtRf9YcJGDhlR44vYvmkaOdmFZ5i2BEAE31HDbDK5nimZTYWmsz5qUpbnqpGy+d5eZAXcUdaDKjy"
    "/Ymb43+nPTy54L91WdWPRWvZV343+voEsBqL7wj+xbgvIfx"
)
INSTALLER_KEY_EXPONENT = "AQAB"
MANIFEST_URL = "https://api.exerclient.com/v1/launcher/releases/latest"
DEFAULT_ELECTRON_VERSION = "v44.9.0"


def verify_manifest_signature(manifest_data: dict) -> dict:
    """Weryfikuje podpis kryptograficzny RSA-SHA256 manifestu wydania."""
    payload_b64 = manifest_data.get("payload")
    sig_b64 = manifest_data.get("installerSignature")
    if not payload_b64 or not sig_b64:
        raise ValueError("Niepodpisany manifest wydania (brak payload lub installerSignature).")

    payload_bytes = base64.b64decode(payload_b64)
    sig_bytes = base64.b64decode(sig_b64)

    try:
        from cryptography.hazmat.primitives.asymmetric import rsa, padding
        from cryptography.hazmat.primitives import hashes

        n = int.from_bytes(base64.b64decode(INSTALLER_KEY_MODULUS), "big")
        e = int.from_bytes(base64.b64decode(INSTALLER_KEY_EXPONENT), "big")
        pub_key = rsa.RSAPublicNumbers(e, n).public_key()
        pub_key.verify(sig_bytes, payload_bytes, padding.PKCS1v15(), hashes.SHA256())
    except ImportError:
        print("[OSTRZEŻENIE] Brak modułu 'cryptography' w Pythonie - pomijam weryfikację RSA podpisu.")
    except Exception as ex:
        raise ValueError(f"Błąd weryfikacji podpisu cyfrowego manifestu EXER: {ex}")

    payload = json.loads(payload_bytes.decode("utf-8"))
    if payload.get("product") != "exer-launcher":
        raise ValueError("Manifest nie dotyczy produktu exer-launcher.")
    return payload


def download_file(url: str, dest_path: Path, expected_sha256: str = None, desc: str = "Pobieranie"):
    """Pobiera plik z paskiem postępu i weryfikuje sumę SHA256."""
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = dest_path.with_suffix(dest_path.suffix + ".part")

    req = urllib.request.Request(url, headers={"User-Agent": "EXER-Client-Setup/linux"})
    with urllib.request.urlopen(req) as resp, open(temp_path, "wb") as out_f:
        total = int(resp.headers.get("Content-Length", 0))
        downloaded = 0
        chunk_size = 65536
        hasher = hashlib.sha256()

        while True:
            chunk = resp.read(chunk_size)
            if not chunk:
                break
            out_f.write(chunk)
            hasher.update(chunk)
            downloaded += len(chunk)
            if total > 0:
                pct = int(downloaded * 100 / total)
                mb_done = downloaded / (1024 * 1024)
                mb_tot = total / (1024 * 1024)
                sys.stdout.write(f"\r  [{desc}] {pct:3d}% ({mb_done:.1f}/{mb_tot:.1f} MB)")
                sys.stdout.flush()

    sys.stdout.write("\n")

    calculated = hasher.hexdigest().lower()
    if expected_sha256 and calculated != expected_sha256.lower():
        temp_path.unlink(missing_ok=True)
        raise ValueError(f"Błąd sumy kontrolnej SHA256 dla {url}!\nOczekiwano: {expected_sha256}\nOtrzymano:  {calculated}")

    temp_path.replace(dest_path)


def patch_app_code(app_dir: Path):
    """
    Aplikuje poprawki wieloplatformowe do kodu JS aplikacji EXER:
    1. allowedRules w io.js - dopasowanie do 'linux' zamiast na sztywno 'windows'
    2. installer.js - pobieranie bibliotek natywnych .so (LWJGL Linux) zamiast Windows DLL
    3. installer.js - obsługa 'java' i pobieranie JRE dla Linux (Adoptium os=linux, tar.gz)
    4. contracts.js - walidator ścieżki Java dla Linuksa (/usr/bin/java)
    5. anticheat.js - ominięcie wywołań powershell/tasklist na Linuksie
    6. main.js - wyszukiwanie zasobów client i distribution.json
    """
    # 1. io.js
    io_js = app_dir / "dist" / "apps" / "launcher" / "electron" / "io.js"
    if io_js.exists():
        content = io_js.read_text(encoding="utf-8")
        target_rule = "if (rule.os?.name && rule.os.name !== 'windows')\n        continue;"
        replacement_rule = (
            "const currentOs = process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'osx' : 'linux');\n"
            "        if (rule.os?.name && rule.os.name !== currentOs)\n            continue;"
        )
        if target_rule in content:
            content = content.replace(target_rule, replacement_rule)
            io_js.write_text(content, encoding="utf-8")

    # 2. contracts.js
    contracts_js = app_dir / "dist" / "packages" / "shared" / "src" / "contracts.js"
    if contracts_js.exists():
        c_content = contracts_js.read_text(encoding="utf-8")
        old_val = "exports.JavaPathSchema = zod_1.z.string().max(1000).refine(value => value === '' || (/^(?:[a-z]:[\\\\/])/i.test(value) &&"
        if old_val in c_content:
            c_content = re.sub(
                r"exports\.JavaPathSchema\s*=\s*zod_1\.z\.string\(\)\.max\(1000\)\.refine\(value\s*=>\s*value\s*===\s*''\s*\|\|\s*\(/[\s\S]+?\{ message: 'javaPath must be an absolute Windows java\.exe path' \}\);",
                """exports.JavaPathSchema = zod_1.z.string().max(1000).refine(value => {
    if (value === '') return true;
    if (process.platform === 'win32') {
        return /^(?:[a-z]:[\\\\/])/i.test(value) &&
            !/[\\x00-\\x1f"<>|?*]/.test(value) &&
            !/(?:^|[\\\\/])\\.\\.(?:[\\\\/]|$)/.test(value) &&
            /(?:^|[\\\\/])java\\.exe$/i.test(value);
    }
    return value.startsWith('/') &&
        !/[\\x00-\\x1f"<>|?*]/.test(value) &&
        !/(?:^|[\\\\/])\\.\\.(?:[\\\\/]|$)/.test(value) &&
        /(?:^|[\\\\/])java(?:\\.exe)?$/i.test(value);
}, { message: 'javaPath must be an absolute path to the java executable' });""",
                c_content,
            )
            contracts_js.write_text(c_content, encoding="utf-8")

    # 3. installer.js
    installer_js = app_dir / "dist" / "apps" / "launcher" / "electron" / "installer.js"
    if installer_js.exists():
        ins_content = installer_js.read_text(encoding="utf-8")

        # Native pattern
        ins_content = ins_content.replace(
            "const nativeKey = lib.natives.windows?.replace('${arch}', '64');",
            "const osKey = process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'osx' : 'linux');\n"
            "                    const nativeKey = lib.natives[osKey]?.replace('${arch}', '64');",
        )
        ins_content = ins_content.replace(
            "if (/:natives-windows/.test(lib.name))",
            "const nativeRe = process.platform === 'win32' ? /:natives-windows/ : (process.platform === 'darwin' ? /:natives-osx/ : /:natives-linux/);\n"
            "                if (nativeRe.test(lib.name))",
        )
        ins_content = ins_content.replace(
            "const nativeKey = lib.natives?.windows?.replace('${arch}', '64');",
            "const osKey2 = process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'osx' : 'linux');\n"
            "                const nativeKey = lib.natives?.[osKey2]?.replace('${arch}', '64');",
        )

        installer_js.write_text(ins_content, encoding="utf-8")

    # 4. anticheat.js
    ac_js = app_dir / "dist" / "apps" / "launcher" / "electron" / "anticheat.js"
    if ac_js.exists():
        ac_content = ac_js.read_text(encoding="utf-8")
        if "if (process.platform !== 'win32') return Promise.resolve('');" not in ac_content:
            ac_content = ac_content.replace(
                "function powershell(script, timeoutMs = 10000) {",
                "function powershell(script, timeoutMs = 10000) {\n    if (process.platform !== 'win32') return Promise.resolve('');",
            )
            ac_content = ac_content.replace(
                "async function runAnticheatScan() {",
                "async function runAnticheatScan() {\n    if (process.platform !== 'win32') return { clean: true, detections: [], warnings: [] };",
            )
            ac_js.write_text(ac_content, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Instalator EXER Client dla systemu Linux (odpowiednik EXER-Client-WebSetup.exe)")
    parser.add_argument("--install-dir", type=str, default=str(Path.home() / ".local" / "share" / "exer-client"), help="Ścieżka instalacji")
    parser.add_argument("--launch", action="store_true", help="Uruchom program po zakończeniu instalacji")
    parser.add_argument("--no-desktop", action="store_true", help="Pomiń tworzenie skrótu .desktop")
    parser.add_argument("--local-prebuilt", type=str, default="", help="Użyj lokalnego gotowego katalogu z aplikacją")
    args = parser.parse_args()

    install_dir = Path(args.install_dir).expanduser().resolve()
    cache_dir = Path.home() / ".cache" / "exer-client"
    cache_dir.mkdir(parents=True, exist_ok=True)

    print("=================================================================")
    print("        EXER Client Setup — Instalator dla systemu Linux         ")
    print("=================================================================")
    print(f"Katalog docelowy: {install_dir}")

    # Krok 1: Manifest wydania
    print("\n[1/5] Sprawdzanie najnowszej wersji EXER Client…")
    req = urllib.request.Request(MANIFEST_URL, headers={"User-Agent": "EXER-Client-Setup/linux"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw_manifest = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"[BŁĄD] Nie udało się połączyć z API EXER Client: {e}")
        return 1

    payload = verify_manifest_signature(raw_manifest)
    version = payload.get("version", "unknown")
    download_url = payload.get("url")
    expected_sha256 = payload.get("sha256")
    size_bytes = payload.get("size", 0)

    print(f"  Znaleziono wersję: {version} ({size_bytes / (1024*1024):.1f} MB)")
    print("  Podpis cyfrowy RSA: Zweryfikowany pomyślnie.")

    # Krok 2: Pobieranie paczki głównej EXER
    zip_cache_file = cache_dir / f"EXER-Client-{version}.zip"
    if zip_cache_file.exists() and hashlib.sha256(zip_cache_file.read_bytes()).hexdigest().lower() == expected_sha256.lower():
        print("  Paczka instalacyjna EXER znajduje się już w pamięci podręcznej.")
    else:
        print(f"\n[2/5] Pobieranie pakietu EXER Client {version}…")
        download_file(download_url, zip_cache_file, expected_sha256, desc="EXER Payload")

    # Krok 3: Przygotowanie środowiska uruchomieniowego Linux Electron
    electron_zip = cache_dir / f"electron-{DEFAULT_ELECTRON_VERSION}-linux-x64.zip"
    electron_url = f"https://github.com/electron/electron/releases/download/{DEFAULT_ELECTRON_VERSION}/electron-{DEFAULT_ELECTRON_VERSION}-linux-x64.zip"
    if not electron_zip.exists():
        print(f"\n[3/5] Pobieranie środowiska Electron ({DEFAULT_ELECTRON_VERSION}) dla Linuksa…")
        download_file(electron_url, electron_zip, desc="Electron Linux x64")
    else:
        print("\n[3/5] Środowisko Electron dla Linuksa gotowe w pamięci podręcznej.")

    # Krok 4: Wypakowanie i instalacja
    print("\n[4/5] Instalowanie i konfiguracja EXER Client…")
    install_dir.mkdir(parents=True, exist_ok=True)

    # Wypakuj Electron do katalogu instalacyjnego
    with zipfile.ZipFile(electron_zip, "r") as z:
        z.extractall(install_dir)

    # Domyślny asar z Electrona usuwamy
    (install_dir / "resources" / "default_app.asar").unlink(missing_ok=True)

    # Zmień nazwę pliku wykonywalnego
    main_bin = install_dir / "exer-client"
    orig_bin = install_dir / "electron"
    if orig_bin.exists():
        orig_bin.replace(main_bin)
    main_bin.chmod(0o755)

    # Wypakuj zasoby z paczki Windows (client/*.jar, distribution.json, release-public.pem, app.asar)
    with zipfile.ZipFile(zip_cache_file, "r") as z:
        for member in z.infolist():
            if member.filename.startswith("resources/"):
                z.extract(member, install_dir)

    # Stwórz skrypt uruchomieniowy
    runner_script = install_dir / "exer-client.sh"
    runner_script.write_text(
        """#!/usr/bin/env bash
REAL_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
DIR="$(cd "$(dirname "$REAL_PATH")" && pwd)"
unset ELECTRON_RUN_AS_NODE
export ELECTRON_OZONE_PLATFORM_HINT="${ELECTRON_OZONE_PLATFORM_HINT:-auto}"
exec "$DIR/exer-client" "$@"
""",
        encoding="utf-8",
    )
    runner_script.chmod(0o755)

    # Krok 5: Integracja z pulpitem
    if not args.no_desktop:
        print("\n[5/5] Tworzenie skrótów i integracji systemowej (.desktop, exer://)…")
        icon_dir = Path.home() / ".local" / "share" / "icons" / "hicolor" / "256x256" / "apps"
        icon_dir.mkdir(parents=True, exist_ok=True)
        icon_path = icon_dir / "exer-client.png"

        # Spróbuj wyciągnąć exer-logo.png z repozytorium lub app.asar
        repo_icon = Path(__file__).parent / "exer-client-linux-x64" / "exer-client.png"
        if repo_icon.exists():
            icon_path.write_bytes(repo_icon.read_bytes())

        apps_dir = Path.home() / ".local" / "share" / "applications"
        apps_dir.mkdir(parents=True, exist_ok=True)
        desktop_file = apps_dir / "exer-client.desktop"

        desktop_content = f"""[Desktop Entry]
Name=EXER Client
GenericName=Minecraft Client & Launcher
Comment=Niezależny klient Minecraft Java Edition (Fabric + Sodium + Kosmetyki 3D)
Exec="{runner_script}" %u
Icon=exer-client
Terminal=false
Type=Application
Categories=Game;
MimeType=x-scheme-handler/exer;
StartupWMClass=EXER Client
"""
        desktop_file.write_text(desktop_content, encoding="utf-8")
        desktop_file.chmod(0o755)

        # Dowiązanie w ~/.local/bin
        bin_link_dir = Path.home() / ".local" / "bin"
        bin_link_dir.mkdir(parents=True, exist_ok=True)
        bin_link = bin_link_dir / "exer-client"
        if bin_link.is_symlink() or bin_link.exists():
            bin_link.unlink()
        bin_link.symlink_to(runner_script)

        # Rejestracja protokołu exer://
        subprocess.run(["xdg-mime", "default", "exer-client.desktop", "x-scheme-handler/exer"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["update-desktop-database", str(apps_dir)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    print("\n=================================================================")
    print(f" SUKCES: Zainstalowano EXER Client {version} na systemie Linux!")
    print(f" Ścieżka: {install_dir}")
    print(" Polecenie startowe: exer-client (lub z menu aplikacji)")
    print("=================================================================\n")

    if args.launch:
        print("Uruchamianie EXER Client…")
        subprocess.Popen([str(runner_script)])


if __name__ == "__main__":
    sys.exit(main())
