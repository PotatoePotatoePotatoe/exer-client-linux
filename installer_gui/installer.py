#!/usr/bin/env python3
"""
EXER Client — Uniwersalny Inteligentny Instalator Graficzny dla Linuksa
Automatycznie wykrywa dystrybucję Linuksa (Fedora, Arch, Ubuntu/Debian itp.),
dobiera odpowiedni format pakietu (.rpm, .pkg.tar.zst, .deb, .AppImage, .tar.gz)
i przeprowadza instalację w nowoczesnym interfejsie graficznym (GUI Tkinter) lub tekstowym (CLI).
"""

import os
import sys
import glob
import shutil
import tarfile
import platform
import argparse
import threading
import subprocess
from pathlib import Path


# ==============================================================================
# 1. Logika wykrywania dystrybucji i środowiska
# ==============================================================================

def get_distro_info() -> dict:
    """Odczytuje szczegółowe dane o dystrybucji z /etc/os-release lub /usr/lib/os-release."""
    info = {
        "id": "linux",
        "id_like": [],
        "name": "Linux",
        "pretty_name": "Linux",
        "version": "",
        "arch": platform.machine(),
        "family": "generic"
    }

    paths = ["/etc/os-release", "/usr/lib/os-release"]
    for p in paths:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if "=" in line and not line.startswith("#"):
                            k, v = line.split("=", 1)
                            v = v.strip("\"'")
                            if k == "ID":
                                info["id"] = v.lower()
                            elif k == "ID_LIKE":
                                info["id_like"] = [x.lower() for x in v.split()]
                            elif k == "NAME":
                                info["name"] = v
                            elif k == "PRETTY_NAME":
                                info["pretty_name"] = v
                            elif k == "VERSION_ID":
                                info["version"] = v
                break
            except Exception:
                pass

    all_ids = [info["id"]] + info["id_like"]

    rpm_distros = {
        "fedora", "rhel", "centos", "almalinux", "rocky",
        "opensuse", "suse", "opensuse-leap", "opensuse-tumbleweed", "amzn", "ol"
    }
    deb_distros = {
        "debian", "ubuntu", "linuxmint", "pop", "elementary",
        "zorin", "kali", "raspbian", "deepin"
    }
    arch_distros = {
        "arch", "manjaro", "endeavouros", "garuda", "artix", "cachyos"
    }
    immutable_distros = {
        "steamos", "silverblue", "kinoite", "bazzite", "nixos", "microos"
    }

    if any(d in immutable_distros for d in all_ids):
        info["family"] = "immutable"
    elif any(d in rpm_distros for d in all_ids):
        info["family"] = "rpm"
    elif any(d in arch_distros for d in all_ids):
        info["family"] = "arch"
    elif any(d in deb_distros for d in all_ids):
        info["family"] = "deb"
    else:
        info["family"] = "generic"

    return info


def get_desktop_dir() -> Path:
    """Zwraca ścieżkę do katalogu pulpitu użytkownika (np. ~/Pulpit lub ~/Desktop)."""
    try:
        res = subprocess.run(["xdg-user-dir", "DESKTOP"], capture_output=True, text=True, check=False)
        out = res.stdout.strip()
        if out and Path(out).is_dir():
            return Path(out)
    except Exception:
        pass

    for cand in [Path.home() / "Pulpit", Path.home() / "Desktop"]:
        if cand.is_dir():
            return cand
    return None


def find_packages(base_dir: Path) -> dict:
    """Wyszukuje dostępne pakiety w standardowych katalogach dist/."""
    candidates_dirs = [
        base_dir / "dist",
        base_dir.parent / "dist",
        base_dir.parent.parent / "dist",
        base_dir,
        Path.cwd() / "dist",
        Path.cwd(),
    ]

    found = {
        "rpm": None,
        "deb": None,
        "arch": None,
        "appimage": None,
        "tarball": None,
    }

    seen = set()
    for d in candidates_dirs:
        try:
            d_res = d.resolve()
        except Exception:
            continue
        if d_res in seen or not d_res.is_dir():
            continue
        seen.add(d_res)

        for p in d_res.glob("exer-client*"):
            name = p.name.lower()
            if not found["rpm"] and name.endswith(".rpm"):
                found["rpm"] = p
            elif not found["deb"] and name.endswith(".deb"):
                found["deb"] = p
            elif not found["arch"] and (name.endswith(".pkg.tar.zst") or name.endswith(".pkg.tar.xz")):
                found["arch"] = p
            elif not found["appimage"] and name.endswith(".appimage"):
                found["appimage"] = p
            elif not found["tarball"] and name.endswith(".tar.gz") and "linux" in name:
                found["tarball"] = p

    return found


# ==============================================================================
# 2. Silniki instalacyjne
# ==============================================================================

def install_system_package(pkg_path: Path, family: str, log_cb) -> bool:
    """Instaluje pakiet natywny przez dnf/apt/pacman z podniesieniem uprawnień (pkexec/sudo)."""
    log_cb(f"Rozpoczynanie instalacji pakietu systemowego: {pkg_path.name}")

    has_pkexec = shutil.which("pkexec") is not None
    cmd = []

    if family == "rpm":
        if shutil.which("dnf"):
            cmd = ["dnf", "install", "-y", "--nogpgcheck", str(pkg_path)]
        elif shutil.which("zypper"):
            cmd = ["zypper", "--no-gpg-checks", "install", "-y", str(pkg_path)]
        else:
            cmd = ["rpm", "-Uvh", "--replacepkgs", str(pkg_path)]
    elif family == "deb":
        if shutil.which("apt"):
            cmd = ["apt", "install", "-y", str(pkg_path)]
        else:
            cmd = ["dpkg", "-i", str(pkg_path)]
    elif family == "arch":
        cmd = ["pacman", "-U", "--noconfirm", str(pkg_path)]
    else:
        raise ValueError(f"Nieznana rodzina pakietów: {family}")

    if os.geteuid() == 0:
        exec_cmd = cmd
    elif has_pkexec:
        exec_cmd = ["pkexec"] + cmd
    elif shutil.which("sudo"):
        exec_cmd = ["sudo"] + cmd
    else:
        raise RuntimeError("Brak narzędzia do podniesienia uprawnień (pkexec lub sudo). Uruchom instalator jako root.")

    log_cb(f"Polecenie: {' '.join(exec_cmd)}")
    proc = subprocess.Popen(
        exec_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )

    for line in proc.stdout:
        log_cb(line.rstrip())

    proc.wait()
    if proc.returncode == 0:
        log_cb("✅ Pakiet systemowy został zainstalowany pomyślnie!")
        desktop_src = Path("/usr/share/applications/exer-client.desktop")
        desktop_dir = get_desktop_dir()
        if desktop_src.exists() and desktop_dir:
            try:
                dest = desktop_dir / "exer-client.desktop"
                shutil.copy2(desktop_src, dest)
                dest.chmod(0o755)
                log_cb(f"Utworzono skrót na pulpicie: {dest}")
            except Exception:
                pass
        return True
    elif proc.returncode in (126, 127):
        log_cb("❌ Uwierzytelnianie zostało anulowane przez użytkownika.")
        return False
    else:
        log_cb(f"❌ Instalacja zakończyła się kodem błędu: {proc.returncode}")
        return False


def install_appimage_package(appimage_path: Path, log_cb) -> bool:
    """Instaluje wersję AppImage dla bieżącego użytkownika (bez uprawnień root)."""
    home = Path.home()
    bin_dir = home / ".local" / "bin"
    apps_dir = home / ".local" / "share" / "applications"
    icons_dir = home / ".local" / "share" / "icons" / "hicolor" / "256x256" / "apps"

    bin_dir.mkdir(parents=True, exist_ok=True)
    apps_dir.mkdir(parents=True, exist_ok=True)
    icons_dir.mkdir(parents=True, exist_ok=True)

    target_appimage = bin_dir / "exer-client.AppImage"
    log_cb(f"Kopiowanie AppImage do: {target_appimage}...")
    shutil.copy2(appimage_path, target_appimage)
    target_appimage.chmod(0o755)

    # Dowiązanie symboliczne ~/.local/bin/exer-client
    symlink_path = bin_dir / "exer-client"
    if symlink_path.is_symlink() or symlink_path.exists():
        try:
            symlink_path.unlink()
        except Exception:
            pass
    try:
        symlink_path.symlink_to(target_appimage)
    except Exception:
        pass

    # Kopiowanie ikony aplikacji
    icon_dest = icons_dir / "exer-client.png"
    script_dir = Path(__file__).resolve().parent
    local_icon = script_dir / "assets" / "icon.png"
    repo_icon = script_dir.parent / "resources" / "exer-client.png"

    if local_icon.is_file():
        shutil.copy2(local_icon, icon_dest)
        log_cb(f"Zainstalowano ikonę: {icon_dest}")
    elif repo_icon.is_file():
        shutil.copy2(repo_icon, icon_dest)
        log_cb(f"Zainstalowano ikonę: {icon_dest}")

    # Tworzenie pliku .desktop
    desktop_file = apps_dir / "exer-client.desktop"
    log_cb(f"Tworzenie skrótu w menu: {desktop_file}...")
    desktop_content = f"""[Desktop Entry]
Name=EXER Client
GenericName=Minecraft Client & Launcher
Comment=Niezależny klient Minecraft Java Edition (Fabric + Sodium + Kosmetyki 3D)
Exec={target_appimage} %u
Icon=exer-client
Terminal=false
Type=Application
Categories=Game;
MimeType=x-scheme-handler/exer;
StartupWMClass=EXER Client
"""
    with open(desktop_file, "w", encoding="utf-8") as f:
        f.write(desktop_content)
    desktop_file.chmod(0o755)

    # Skrót na pulpicie
    desktop_dir = get_desktop_dir()
    if desktop_dir:
        try:
            pulpit_shortcut = desktop_dir / "exer-client.desktop"
            shutil.copy2(desktop_file, pulpit_shortcut)
            pulpit_shortcut.chmod(0o755)
            log_cb(f"Utworzono skrót na pulpicie: {pulpit_shortcut}")
        except Exception:
            pass

    # Rejestracja exer://
    try:
        subprocess.run(["xdg-mime", "default", "exer-client.desktop", "x-scheme-handler/exer"], check=False)
        subprocess.run(["update-desktop-database", str(apps_dir)], check=False)
    except Exception:
        pass

    log_cb("✅ Wersja AppImage została zainstalowana w katalogu domowym!")
    log_cb(f"Plik wykonywalny: {target_appimage}")
    return True


def install_tarball_package(tar_path: Path, log_cb) -> bool:
    """Rozpakowuje wersję przenośną .tar.gz do ~/.local/share/exer-client."""
    home = Path.home()
    target_dir = home / ".local" / "share" / "exer-client"
    bin_dir = home / ".local" / "bin"
    apps_dir = home / ".local" / "share" / "applications"
    icons_dir = home / ".local" / "share" / "icons" / "hicolor" / "256x256" / "apps"

    bin_dir.mkdir(parents=True, exist_ok=True)
    apps_dir.mkdir(parents=True, exist_ok=True)
    icons_dir.mkdir(parents=True, exist_ok=True)

    if target_dir.exists():
        log_cb(f"Usuwanie poprzedniej instalacji w {target_dir}...")
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    log_cb(f"Wypakowywanie {tar_path.name} do {target_dir}...")
    with tarfile.open(tar_path, "r:gz") as tar:
        tar.extractall(target_dir)

    launcher = target_dir / "exer-client.sh"
    binary = target_dir / "exer-client"
    if launcher.exists():
        launcher.chmod(0o755)
    if binary.exists():
        binary.chmod(0o755)

    symlink_path = bin_dir / "exer-client"
    if symlink_path.is_symlink() or symlink_path.exists():
        try:
            symlink_path.unlink()
        except Exception:
            pass
    try:
        symlink_path.symlink_to(launcher if launcher.exists() else binary)
    except Exception:
        pass

    icon_src = target_dir / "exer-client.png"
    icon_dest = icons_dir / "exer-client.png"
    if icon_src.is_file():
        shutil.copy2(icon_src, icon_dest)

    desktop_file = apps_dir / "exer-client.desktop"
    desktop_content = f"""[Desktop Entry]
Name=EXER Client
GenericName=Minecraft Client & Launcher
Comment=Niezależny klient Minecraft Java Edition (Fabric + Sodium + Kosmetyki 3D)
Exec={launcher if launcher.exists() else binary} %u
Icon=exer-client
Terminal=false
Type=Application
Categories=Game;
MimeType=x-scheme-handler/exer;
StartupWMClass=EXER Client
"""
    with open(desktop_file, "w", encoding="utf-8") as f:
        f.write(desktop_content)
    desktop_file.chmod(0o755)

    desktop_dir = get_desktop_dir()
    if desktop_dir:
        try:
            pulpit_shortcut = desktop_dir / "exer-client.desktop"
            shutil.copy2(desktop_file, pulpit_shortcut)
            pulpit_shortcut.chmod(0o755)
            log_cb(f"Utworzono skrót na pulpicie: {pulpit_shortcut}")
        except Exception:
            pass

    try:
        subprocess.run(["xdg-mime", "default", "exer-client.desktop", "x-scheme-handler/exer"], check=False)
        subprocess.run(["update-desktop-database", str(apps_dir)], check=False)
    except Exception:
        pass

    log_cb("✅ Wersja przenośna została pomyślnie zainstalowana!")
    return True


# ==============================================================================
# 3. Nowoczesny Interfejs Graficzny Tkinter
# ==============================================================================

class ExerInstallerGUI:
    def __init__(self, root, distro_info: dict, packages: dict):
        self.root = root
        self.distro = distro_info
        self.packages = packages
        self.installed_success = False

        self.root.title("EXER Client — Instalator Linux")
        self.root.configure(bg="#1e1e2e")

        # Rozmiar i wyśrodkowanie okna
        width = 720
        height = 760
        self.root.minsize(660, 700)
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        x = max(0, (sw - width) // 2)
        y = max(0, (sh - height) // 2)
        self.root.geometry(f"{width}x{height}+{x}+{y}")

        import tkinter as tk
        from tkinter import ttk, messagebox, filedialog

        self.tk = tk
        self.ttk = ttk
        self.messagebox = messagebox
        self.filedialog = filedialog

        # Ikona okna
        script_dir = Path(__file__).resolve().parent
        icon_path = script_dir / "assets" / "icon.png"
        if icon_path.exists():
            try:
                self.icon_photo_full = self.tk.PhotoImage(file=str(icon_path))
                self.root.iconphoto(True, self.icon_photo_full)
                self.icon_photo_small = self.icon_photo_full.subsample(4, 4)
            except Exception:
                self.icon_photo_small = None
        else:
            self.icon_photo_small = None

        self._init_ttk_styles()
        self._build_ui()
        self._select_default_choice()
        self._init_log_messages()

    def _init_ttk_styles(self):
        style = self.ttk.Style()
        style.theme_use("clam")

        style.configure(".", background="#1e1e2e", foreground="#cdd6f4")
        style.configure("Horizontal.TProgressbar",
            background="#89b4fa",
            troughcolor="#313244",
            bordercolor="#1e1e2e",
            lightcolor="#89b4fa",
            darkcolor="#89b4fa"
        )
        style.configure("Vertical.TScrollbar",
            background="#313244",
            troughcolor="#11111b",
            bordercolor="#11111b",
            arrowcolor="#cdd6f4"
        )

    def _build_ui(self):
        # -------------------------------------------------------------
        # 1. Górny nagłówek (Header) - pack top
        # -------------------------------------------------------------
        header_frame = self.tk.Frame(self.root, bg="#181825", padx=20, pady=16, highlightbackground="#313244", highlightthickness=1)
        header_frame.pack(side="top", fill="x")

        if self.icon_photo_small:
            icon_lbl = self.tk.Label(header_frame, image=self.icon_photo_small, bg="#181825")
            icon_lbl.pack(side="left", padx=(0, 16))

        title_box = self.tk.Frame(header_frame, bg="#181825")
        title_box.pack(side="left", fill="both", expand=True)

        lbl_title = self.tk.Label(
            title_box,
            text="EXER Client — Instalator Linux",
            bg="#181825",
            fg="#89b4fa",
            font=("Sans", 15, "bold")
        )
        lbl_title.pack(anchor="w")

        lbl_sub = self.tk.Label(
            title_box,
            text="Inteligentny instalator z automatyczną detekcją Twojej dystrybucji",
            bg="#181825",
            fg="#a6adc8",
            font=("Sans", 9)
        )
        lbl_sub.pack(anchor="w", pady=(3, 0))

        # -------------------------------------------------------------
        # 2. Dolny pasek przycisków (Bottom Bar) - pack bottom
        # Gwarantuje, że przyciski NIGDY nie zostaną ucięte ani zasłonięte!
        # -------------------------------------------------------------
        btn_bar = self.tk.Frame(self.root, bg="#181825", padx=20, pady=14, highlightbackground="#313244", highlightthickness=1)
        btn_bar.pack(side="bottom", fill="x")

        self.btn_close = self.tk.Button(
            btn_bar,
            text="❌  Zamknij",
            bg="#313244",
            fg="#cdd6f4",
            activebackground="#45475a",
            activeforeground="#ffffff",
            font=("Sans", 10, "bold"),
            relief="flat",
            bd=0,
            padx=20,
            pady=10,
            cursor="hand2",
            command=self.root.destroy
        )
        self.btn_close.pack(side="left")

        # Przycisk uruchomienia (początkowo ukryty)
        self.btn_launch = self.tk.Button(
            btn_bar,
            text="🚀  Uruchom EXER Client",
            bg="#a6e3a1",
            fg="#11111b",
            activebackground="#94e2d5",
            activeforeground="#11111b",
            font=("Sans", 11, "bold"),
            relief="flat",
            bd=0,
            padx=24,
            pady=10,
            cursor="hand2",
            command=self._launch_app
        )

        # Główny przycisk instalacji
        self.btn_install = self.tk.Button(
            btn_bar,
            text="⚡  Zainstaluj teraz",
            bg="#89b4fa",
            fg="#11111b",
            activebackground="#b4befe",
            activeforeground="#11111b",
            font=("Sans", 11, "bold"),
            relief="flat",
            bd=0,
            padx=24,
            pady=10,
            cursor="hand2",
            command=self._start_install
        )
        self.btn_install.pack(side="right")

        # -------------------------------------------------------------
        # 3. Główny kontener środkowy (Middle Container) - pack fill both
        # -------------------------------------------------------------
        main_box = self.tk.Frame(self.root, bg="#1e1e2e", padx=20, pady=12)
        main_box.pack(side="top", fill="both", expand=True)

        # Karta: Wykryta dystrybucja
        distro_card = self.tk.Frame(main_box, bg="#181825", padx=16, pady=12, highlightbackground="#313244", highlightthickness=1)
        distro_card.pack(fill="x", pady=(0, 12))

        d_text = f"🖥️  Wykryty system: {self.distro['pretty_name']} [{self.distro['arch']}]"
        self.tk.Label(distro_card, text=d_text, bg="#181825", fg="#a6e3a1", font=("Sans", 10, "bold")).pack(anchor="w")

        family_names = {
            "rpm": "RPM (natywny format dla Fedora / RHEL / CentOS / openSUSE)",
            "deb": "DEB (natywny format dla Debian / Ubuntu / Linux Mint / Pop!_OS)",
            "arch": "Pacman PKG (natywny format dla Arch Linux / Manjaro)",
            "immutable": "AppImage (zalecane dla dystrybucji z niemodyfikowalnym systemem)",
            "generic": "Uniwersalny AppImage / Wersja przenośna",
        }
        recom_text = f"🎯  Rekomendacja: {family_names.get(self.distro['family'], 'AppImage')}"
        self.tk.Label(distro_card, text=recom_text, bg="#181825", fg="#89b4fa", font=("Sans", 9)).pack(anchor="w", pady=(4, 0))

        # Karta: Opcje instalacji
        options_card = self.tk.Frame(main_box, bg="#181825", padx=16, pady=12, highlightbackground="#313244", highlightthickness=1)
        options_card.pack(fill="x", pady=(0, 12))

        self.tk.Label(
            options_card,
            text="Wybierz metodę instalacji:",
            bg="#181825",
            fg="#cdd6f4",
            font=("Sans", 10, "bold")
        ).pack(anchor="w", pady=(0, 8))

        self.method_var = self.tk.StringVar(value="system")

        # 1. Pakiet systemowy
        self.rb_system = self.tk.Radiobutton(
            options_card,
            text=" [Zalecana] Natywny pakiet systemowy dla Twojej dystrybucji",
            variable=self.method_var,
            value="system",
            bg="#181825",
            fg="#cdd6f4",
            activebackground="#181825",
            activeforeground="#89b4fa",
            selectcolor="#313244",
            font=("Sans", 10, "bold"),
            cursor="hand2",
            command=self._on_method_change
        )
        self.rb_system.pack(anchor="w")
        self.lbl_system_desc = self.tk.Label(
            options_card,
            text="Pełna integracja z menedżerem pakietów (/opt/EXER Client). Wymaga hasła administratora (pkexec/sudo).",
            bg="#181825",
            fg="#a6adc8",
            font=("Sans", 8)
        )
        self.lbl_system_desc.pack(anchor="w", padx=26, pady=(0, 6))

        # 2. AppImage
        self.rb_appimage = self.tk.Radiobutton(
            options_card,
            text=" Uniwersalny AppImage (Bez hasła root / instalacja w ~/.local/bin/)",
            variable=self.method_var,
            value="appimage",
            bg="#181825",
            fg="#cdd6f4",
            activebackground="#181825",
            activeforeground="#89b4fa",
            selectcolor="#313244",
            font=("Sans", 10, "bold"),
            cursor="hand2",
            command=self._on_method_change
        )
        self.rb_appimage.pack(anchor="w")
        self.lbl_appimage_desc = self.tk.Label(
            options_card,
            text="Samodzielny plik wykonywalny ze skrótem w menu aplikacji i na pulpicie. Bezpieczny dla systemu.",
            bg="#181825",
            fg="#a6adc8",
            font=("Sans", 8)
        )
        self.lbl_appimage_desc.pack(anchor="w", padx=26, pady=(0, 6))

        # 3. Wersja przenośna .tar.gz
        self.rb_tar = self.tk.Radiobutton(
            options_card,
            text=" Wersja przenośna (.tar.gz do ~/.local/share/exer-client/)",
            variable=self.method_var,
            value="tarball",
            bg="#181825",
            fg="#cdd6f4",
            activebackground="#181825",
            activeforeground="#89b4fa",
            selectcolor="#313244",
            font=("Sans", 10),
            cursor="hand2",
            command=self._on_method_change
        )
        self.rb_tar.pack(anchor="w", pady=(0, 6))

        # 4. Ręczny wybór
        custom_frame = self.tk.Frame(options_card, bg="#181825")
        custom_frame.pack(fill="x", pady=(2, 0))

        self.rb_custom = self.tk.Radiobutton(
            custom_frame,
            text=" Wskaż inny pakiet ręcznie: ",
            variable=self.method_var,
            value="custom",
            bg="#181825",
            fg="#cdd6f4",
            activebackground="#181825",
            activeforeground="#89b4fa",
            selectcolor="#313244",
            font=("Sans", 10),
            cursor="hand2",
            command=self._on_method_change
        )
        self.rb_custom.pack(side="left")

        self.custom_path_var = self.tk.StringVar()
        self.custom_entry = self.tk.Entry(
            custom_frame,
            textvariable=self.custom_path_var,
            bg="#313244",
            fg="#cdd6f4",
            insertbackground="#89b4fa",
            highlightbackground="#45475a",
            highlightcolor="#89b4fa",
            highlightthickness=1,
            relief="flat",
            font=("Sans", 9),
            state="disabled"
        )
        self.custom_entry.pack(side="left", fill="x", expand=True, padx=6)

        self.browse_btn = self.tk.Button(
            custom_frame,
            text="Przeglądaj...",
            bg="#313244",
            fg="#cdd6f4",
            activebackground="#45475a",
            activeforeground="#ffffff",
            font=("Sans", 9),
            relief="flat",
            bd=0,
            padx=10,
            pady=4,
            state="disabled",
            cursor="hand2",
            command=self._browse_custom_pkg
        )
        self.browse_btn.pack(side="right")

        # Karta: Status, Pasek postępu i Logi
        log_card = self.tk.Frame(main_box, bg="#1e1e2e")
        log_card.pack(fill="both", expand=True)

        self.progress_bar = self.ttk.Progressbar(log_card, orient="horizontal", mode="determinate", style="Horizontal.TProgressbar")
        self.progress_bar.pack(fill="x", pady=(0, 6))

        self.status_lbl = self.tk.Label(
            log_card,
            text="Status: Gotowy do instalacji.",
            bg="#1e1e2e",
            fg="#89b4fa",
            font=("Sans", 9, "bold")
        )
        self.status_lbl.pack(anchor="w", pady=(0, 4))

        # Kontener na pole tekstowe z paskiem przewijania
        log_container = self.tk.Frame(log_card, bg="#11111b", highlightbackground="#313244", highlightthickness=1)
        log_container.pack(fill="both", expand=True)

        self.log_text = self.tk.Text(
            log_container,
            height=7,
            bg="#11111b",
            fg="#a6adc8",
            insertbackground="#cdd6f4",
            font=("DejaVu Sans Mono", 8),
            relief="flat",
            padx=8,
            pady=8
        )
        log_scroll = self.ttk.Scrollbar(log_container, orient="vertical", command=self.log_text.yview, style="Vertical.TScrollbar")
        self.log_text.configure(yscrollcommand=log_scroll.set)

        self.log_text.pack(side="left", fill="both", expand=True)
        log_scroll.pack(side="right", fill="y")

    def _init_log_messages(self):
        """Wypisuje powitalne informacje diagnostyczne w konsoli."""
        self.log(f"[INFO] Wykryto dystrybucję: {self.distro['pretty_name']} [{self.distro['arch']}]")
        self.log(f"[INFO] Rodzina pakietów: {self.distro['family'].upper()}")
        for k, p in self.packages.items():
            if p:
                self.log(f"[PAKIET] Znaleziono {k.upper()}: {p.name}")
        self.log("[STATUS] Wybierz metodę instalacji i kliknij 'Zainstaluj teraz'.")

    def _select_default_choice(self):
        fam = self.distro["family"]
        if fam == "rpm" and self.packages["rpm"]:
            self.method_var.set("system")
            self.rb_system.configure(text=f" [Zalecana] Natywny pakiet RPM ({self.packages['rpm'].name})")
        elif fam == "deb" and self.packages["deb"]:
            self.method_var.set("system")
            self.rb_system.configure(text=f" [Zalecana] Natywny pakiet DEB ({self.packages['deb'].name})")
        elif fam == "arch" and self.packages["arch"]:
            self.method_var.set("system")
            self.rb_system.configure(text=f" [Zalecana] Natywny pakiet Arch ({self.packages['arch'].name})")
        elif self.packages["appimage"]:
            self.method_var.set("appimage")
            if fam == "system":
                self.rb_system.configure(state="disabled")
        else:
            self.method_var.set("appimage")

        if self.packages["appimage"]:
            self.rb_appimage.configure(text=f" Uniwersalny AppImage ({self.packages['appimage'].name})")
        if self.packages["tarball"]:
            self.rb_tar.configure(text=f" Wersja przenośna .tar.gz ({self.packages['tarball'].name})")

    def _on_method_change(self):
        val = self.method_var.get()
        if val == "custom":
            self.custom_entry.configure(state="normal", bg="#313244")
            self.browse_btn.configure(state="normal", bg="#45475a")
        else:
            self.custom_entry.configure(state="disabled", bg="#1e1e2e")
            self.browse_btn.configure(state="disabled", bg="#313244")

    def _browse_custom_pkg(self):
        path = self.filedialog.askopenfilename(
            title="Wybierz pakiet instalacyjny EXER Client",
            filetypes=[
                ("Pakiety Linux", "*.rpm *.deb *.pkg.tar.zst *.pkg.tar.xz *.AppImage *.tar.gz"),
                ("Wszystkie pliki", "*.*")
            ]
        )
        if path:
            self.custom_path_var.set(path)

    def log(self, text: str):
        self.root.after(0, self._append_log, text)

    def _append_log(self, text: str):
        self.log_text.insert("end", text + "\n")
        self.log_text.see("end")

    def set_status(self, text: str, progress: int = None):
        def _update():
            self.status_lbl.configure(text=f"Status: {text}")
            if progress is not None:
                self.progress_bar["value"] = progress
        self.root.after(0, _update)

    def _start_install(self):
        self.btn_install.configure(state="disabled", bg="#45475a", fg="#6c7086")
        self.btn_close.configure(state="disabled")
        self.progress_bar.configure(mode="indeterminate")
        self.progress_bar.start(12)

        t = threading.Thread(target=self._run_install_thread, daemon=True)
        t.start()

    def _run_install_thread(self):
        choice = self.method_var.get()
        success = False

        try:
            if choice == "system":
                fam = self.distro["family"]
                pkg = self.packages.get(fam)
                if not pkg or not pkg.exists():
                    raise FileNotFoundError(f"Nie znaleziono pakietu dla rodziny {fam} w katalogu dist/.")
                self.set_status(f"Instalowanie pakietu systemowego {pkg.name}...")
                success = install_system_package(pkg, fam, self.log)

            elif choice == "appimage":
                pkg = self.packages.get("appimage")
                if not pkg or not pkg.exists():
                    raise FileNotFoundError("Nie znaleziono pliku .AppImage w katalogu dist/.")
                self.set_status(f"Kopiowanie i konfiguracja AppImage...")
                success = install_appimage_package(pkg, self.log)

            elif choice == "tarball":
                pkg = self.packages.get("tarball")
                if not pkg or not pkg.exists():
                    raise FileNotFoundError("Nie znaleziono pliku .tar.gz w katalogu dist/.")
                self.set_status(f"Wypakowywanie wersji przenośnej...")
                success = install_tarball_package(pkg, self.log)

            elif choice == "custom":
                custom_file = Path(self.custom_path_var.get().strip())
                if not custom_file.is_file():
                    raise FileNotFoundError("Wskazany plik nie istnieje!")
                name = custom_file.name.lower()
                if name.endswith(".rpm"):
                    success = install_system_package(custom_file, "rpm", self.log)
                elif name.endswith(".deb"):
                    success = install_system_package(custom_file, "deb", self.log)
                elif name.endswith(".pkg.tar.zst") or name.endswith(".pkg.tar.xz"):
                    success = install_system_package(custom_file, "arch", self.log)
                elif name.endswith(".appimage"):
                    success = install_appimage_package(custom_file, self.log)
                elif name.endswith(".tar.gz"):
                    success = install_tarball_package(custom_file, self.log)
                else:
                    raise ValueError("Nierozpoznany format pliku. Obsługiwane: .rpm, .deb, .pkg.tar.zst, .AppImage, .tar.gz")

        except Exception as e:
            self.log(f"BŁĄD: {e}")
            self.set_status(f"Błąd: {e}")
            success = False

        self.root.after(0, self._finish_install, success)

    def _finish_install(self, success: bool):
        self.progress_bar.stop()
        self.progress_bar.configure(mode="determinate")
        self.btn_close.configure(state="normal")

        if success:
            self.installed_success = True
            self.progress_bar["value"] = 100
            self.set_status("Instalacja zakończona sukcesem!", 100)
            self.btn_install.pack_forget()
            self.btn_launch.pack(side="right")
            self.messagebox.showinfo("Sukces", "EXER Client został pomyślnie zainstalowany!\nMożesz go uruchomić z menu programów lub klikając przycisk poniżej.")
        else:
            self.progress_bar["value"] = 0
            self.btn_install.configure(state="normal", bg="#89b4fa", fg="#11111b")
            self.set_status("Instalacja nie powiodła się. Sprawdź dziennik zdarzeń.")
            self.messagebox.showerror("Błąd instalacji", "Instalacja nie powiodła się.\nSzczegóły błędu zostały zapisane w oknie dziennika.")

    def _launch_app(self):
        """Uruchamia zainstalowanego klienta."""
        candidates = [
            Path.home() / ".local" / "bin" / "exer-client",
            Path.home() / ".local" / "bin" / "exer-client.AppImage",
            Path("/usr/bin/exer-client"),
            Path.home() / ".local" / "share" / "exer-client" / "exer-client.sh"
        ]
        for c in candidates:
            if c.exists() and os.access(c, os.X_OK):
                try:
                    subprocess.Popen([str(c)], start_new_session=True)
                    self.root.destroy()
                    return
                except Exception as ex:
                    self.messagebox.showerror("Błąd uruchamiania", f"Nie udało się uruchomić: {ex}")
                    return

        self.messagebox.showwarning("Uwaga", "Nie znaleziono pliku wykonywalnego w standardowych ścieżkach.")


# ==============================================================================
# 4. Tryb CLI (tekstowy)
# ==============================================================================

def run_cli_installer(distro: dict, packages: dict):
    print("=" * 64)
    print("         EXER Client — Inteligentny Instalator Linux")
    print("=" * 64)
    print(f"🖥️  Wykryty system: {distro['pretty_name']} [{distro['arch']}]")
    print(f"🎯 Rodzina dystrybucji: {distro['family'].upper()}")
    print("-" * 64)

    options = []
    fam = distro["family"]

    if fam in ("rpm", "deb", "arch") and packages.get(fam):
        pkg = packages[fam]
        options.append(("system", f"Pakiet systemowy ({pkg.name}) [Wymaga root/sudo]", pkg, fam))

    if packages.get("appimage"):
        options.append(("appimage", f"Uniwersalny AppImage ({packages['appimage'].name}) [Zalecane bez root]", packages["appimage"], "appimage"))

    if packages.get("tarball"):
        options.append(("tarball", f"Wersja przenośna (.tar.gz) ({packages['tarball'].name}) [Bez root]", packages["tarball"], "tarball"))

    if not options:
        print("Nie znaleziono gotowych pakietów w katalogu dist/.")
        sys.exit(1)

    print("Wybierz metodę instalacji:")
    for i, opt in enumerate(options, 1):
        print(f"  {i}) {opt[1]}")
    print(f"  {len(options) + 1}) Wyjdź")

    choice = input(f"\nWybór [1-{len(options)+1}]: ").strip()
    try:
        idx = int(choice) - 1
        if idx == len(options):
            print("Instalacja anulowana.")
            return
        selected = options[idx]
    except Exception:
        print("Nieprawidłowy wybór.")
        return

    def log(msg):
        print(f"  {msg}")

    print(f"\nRozpoczynanie instalacji: {selected[1]}...")
    mode = selected[0]
    pkg_path = selected[2]

    if mode == "system":
        res = install_system_package(pkg_path, selected[3], log)
    elif mode == "appimage":
        res = install_appimage_package(pkg_path, log)
    elif mode == "tarball":
        res = install_tarball_package(pkg_path, log)

    if res:
        print("\n✅ Instalacja zakończona pomyślnie!")
        print("Możesz teraz uruchomić aplikację wpisując: exer-client")
    else:
        print("\n❌ Instalacja zakończyła się błędem.")


# ==============================================================================
# 5. Punkt wejścia
# ==============================================================================

def main():
    parser = argparse.ArgumentParser(description="Instalator EXER Client dla systemu Linux")
    parser.add_argument("--cli", action="store_true", help="Wymuś tryb tekstowy (CLI)")
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    distro = get_distro_info()
    packages = find_packages(script_dir)

    use_gui = not args.cli
    if use_gui:
        has_display = bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))
        if not has_display:
            use_gui = False

    if use_gui:
        try:
            import tkinter as tk
            root = tk.Tk()
            app = ExerInstallerGUI(root, distro, packages)
            root.mainloop()
            return
        except Exception as e:
            print(f"[OSTRZEŻENIE] Nie udało się otworzyć interfejsu graficznego: {e}")
            print("Przełączanie do trybu tekstowego (CLI)...\n")

    run_cli_installer(distro, packages)


if __name__ == "__main__":
    main()
