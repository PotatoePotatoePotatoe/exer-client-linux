#!/usr/bin/env python3
"""
Pobiera zasoby gry EXER (client/*.jar, distribution.json, release-public.pem)
z oficjalnego API EXER i umieszcza je w katalogu resources/
"""

import sys
import os
import json
import base64
import zipfile
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
RESOURCES_DIR = REPO_ROOT / "resources"
CLIENT_DIR = RESOURCES_DIR / "client"
MANIFEST_URL = "https://api.exerclient.com/v1/launcher/releases/latest"

def main():
    print("Sprawdzanie najnowszego wydania EXER…")
    req = urllib.request.Request(MANIFEST_URL, headers={"User-Agent": "EXER-Client-Setup/linux"})
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())

    payload = json.loads(base64.b64decode(data["payload"]).decode())
    version = payload.get("version")
    url = payload.get("url")
    print(f"Najnowsza wersja: {version}")
    print(f"Adres paczki: {url}")

    cache_dir = REPO_ROOT / ".cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    zip_path = cache_dir / f"EXER-Client-{version}.zip"

    if not zip_path.exists():
        print("Pobieranie paczki głównej EXER (może to zająć chwilę)…")
        urllib.request.urlretrieve(url, zip_path)
    else:
        print("Paczka ZIP jest już w pamięci podręcznej.")

    print("Wypakowywanie zasobów do resources/…")
    CLIENT_DIR.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as z:
        for item in z.infolist():
            if item.filename.startswith("resources/client/") and not item.filename.endswith("/"):
                target = CLIENT_DIR / Path(item.filename).name
                target.write_bytes(z.read(item))
                print(f"  -> {target.name}")
            elif item.filename in ("resources/distribution.json", "resources/release-public.pem"):
                target = RESOURCES_DIR / Path(item.filename).name
                target.write_bytes(z.read(item))
                print(f"  -> {target.name}")

    print("Pobieranie zasobów zakończone sukcesem!")

if __name__ == "__main__":
    main()
