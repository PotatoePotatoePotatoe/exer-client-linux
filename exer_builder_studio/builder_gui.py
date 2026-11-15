#!/usr/bin/env python3
"""
EXER Linux Builder Studio — Graficzna Aplikacja Budująca Pakiety Linux
Automatycznie konwertuje instalatory Windows (.exe/.zip lub API) na natywne paczki Linux:
.deb, .rpm, .AppImage, .pkg.tar.zst oraz .tar.gz.
"""

import os
import sys
import argparse
import threading
import subprocess
from pathlib import Path

# Dołączenie silnika budującego z tego samego katalogu
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from core_builder import ExerLinuxBuilder


class ExerBuilderGUI:
    def __init__(self, root):
        self.root = root
        self.builder = ExerLinuxBuilder()
        self.is_building = False
        self.built_files = []

        self.root.title("EXER Linux Builder Studio")
        self.root.configure(bg="#1e1e2e")

        width = 750
        height = 800
        self.root.minsize(700, 720)
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

        # Ikona
        icon_path = SCRIPT_DIR / "icon.png"
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
        self._detect_initial_files()

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
        # 1. Nagłówek (Top)
        header_frame = self.tk.Frame(self.root, bg="#181825", padx=20, pady=16, highlightbackground="#313244", highlightthickness=1)
        header_frame.pack(side="top", fill="x")

        if self.icon_photo_small:
            icon_lbl = self.tk.Label(header_frame, image=self.icon_photo_small, bg="#181825")
            icon_lbl.pack(side="left", padx=(0, 16))

        title_box = self.tk.Frame(header_frame, bg="#181825")
        title_box.pack(side="left", fill="both", expand=True)

        lbl_title = self.tk.Label(
            title_box,
            text="EXER Linux Builder Studio",
            bg="#181825",
            fg="#89b4fa",
            font=("Sans", 15, "bold")
        )
        lbl_title.pack(anchor="w")

        lbl_sub = self.tk.Label(
            title_box,
            text="Automatyczna konwersja instalatorów Windows na natywne pakiety Linuksa",
            bg="#181825",
            fg="#a6adc8",
            font=("Sans", 9)
        )
        lbl_sub.pack(anchor="w", pady=(3, 0))

        # 2. Dolny pasek przycisków (Bottom) - Gwarantuje stałą widoczność!
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
            padx=18,
            pady=10,
            cursor="hand2",
            command=self.root.destroy
        )
        self.btn_close.pack(side="left")

        self.btn_open_folder = self.tk.Button(
            btn_bar,
            text="📂  Otwórz folder wyjściowy",
            bg="#313244",
            fg="#cdd6f4",
            activebackground="#45475a",
            activeforeground="#ffffff",
            font=("Sans", 10),
            relief="flat",
            bd=0,
            padx=14,
            pady=10,
            cursor="hand2",
            command=self._open_output_folder
        )
        # Początkowo ukryty do zakończenia budowania

        self.btn_build = self.tk.Button(
            btn_bar,
            text="⚡  Rozpocznij budowanie pakietów",
            bg="#89b4fa",
            fg="#11111b",
            activebackground="#b4befe",
            activeforeground="#11111b",
            font=("Sans", 11, "bold"),
            relief="flat",
            bd=0,
            padx=22,
            pady=10,
            cursor="hand2",
            command=self._start_build
        )
        self.btn_build.pack(side="right")

        # 3. Główny kontener środkowy
        main_box = self.tk.Frame(self.root, bg="#1e1e2e", padx=20, pady=12)
        main_box.pack(side="top", fill="both", expand=True)

        # Karta 1: Źródło wejściowe
        src_card = self.tk.Frame(main_box, bg="#181825", padx=16, pady=12, highlightbackground="#313244", highlightthickness=1)
        src_card.pack(fill="x", pady=(0, 10))

        self.tk.Label(
            src_card,
            text="1. Wybierz źródło instalatora Windows:",
            bg="#181825",
            fg="#89b4fa",
            font=("Sans", 10, "bold")
        ).pack(anchor="w", pady=(0, 8))

        self.source_mode_var = self.tk.StringVar(value="file")

        # Opcja A: Plik lokalny
        rb_file = self.tk.Radiobutton(
            src_card,
            text=" Plik instalacyjny Windows (.exe lub .zip):",
            variable=self.source_mode_var,
            value="file",
            bg="#181825",
            fg="#cdd6f4",
            activebackground="#181825",
            activeforeground="#89b4fa",
            selectcolor="#313244",
            font=("Sans", 9, "bold"),
            cursor="hand2",
            command=self._on_source_mode_change
        )
        rb_file.pack(anchor="w")

        file_row = self.tk.Frame(src_card, bg="#181825")
        file_row.pack(fill="x", padx=24, pady=(2, 8))

        self.input_file_var = self.tk.StringVar()
        self.input_file_entry = self.tk.Entry(
            file_row,
            textvariable=self.input_file_var,
            bg="#313244",
            fg="#cdd6f4",
            insertbackground="#89b4fa",
            highlightbackground="#45475a",
            highlightcolor="#89b4fa",
            highlightthickness=1,
            relief="flat",
            font=("Sans", 9)
        )
        self.input_file_entry.pack(side="left", fill="x", expand=True, padx=(0, 8))

        self.browse_input_btn = self.tk.Button(
            file_row,
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
            cursor="hand2",
            command=self._browse_input_file
        )
        self.browse_input_btn.pack(side="right")

        # Opcja B: Pobieranie online
        rb_online = self.tk.Radiobutton(
            src_card,
            text=" Pobierz automatycznie najnowszą wersję bezpośrednio z serwera EXER (API)",
            variable=self.source_mode_var,
            value="online",
            bg="#181825",
            fg="#cdd6f4",
            activebackground="#181825",
            activeforeground="#89b4fa",
            selectcolor="#313244",
            font=("Sans", 9),
            cursor="hand2",
            command=self._on_source_mode_change
        )
        rb_online.pack(anchor="w")

        # Karta 2: Formaty docelowe (Checkboxy)
        targets_card = self.tk.Frame(main_box, bg="#181825", padx=16, pady=12, highlightbackground="#313244", highlightthickness=1)
        targets_card.pack(fill="x", pady=(0, 10))

        self.tk.Label(
            targets_card,
            text="2. Formaty pakietów do wygenerowania:",
            bg="#181825",
            fg="#89b4fa",
            font=("Sans", 10, "bold")
        ).pack(anchor="w", pady=(0, 8))

        targets_grid = self.tk.Frame(targets_card, bg="#181825")
        targets_grid.pack(fill="x")

        self.cb_appimage_var = self.tk.BooleanVar(value=True)
        self.cb_deb_var = self.tk.BooleanVar(value=True)
        self.cb_rpm_var = self.tk.BooleanVar(value=True)
        self.cb_arch_var = self.tk.BooleanVar(value=True)
        self.cb_tar_var = self.tk.BooleanVar(value=True)

        cb1 = self.tk.Checkbutton(
            targets_grid, text=" .AppImage (Uniwersalny)", variable=self.cb_appimage_var,
            bg="#181825", fg="#a6e3a1", activebackground="#181825", activeforeground="#89b4fa",
            selectcolor="#313244", font=("Sans", 9, "bold"), cursor="hand2"
        )
        cb1.grid(row=0, column=0, sticky="w", padx=6, pady=3)

        cb2 = self.tk.Checkbutton(
            targets_grid, text=" .deb (Debian / Ubuntu / Mint)", variable=self.cb_deb_var,
            bg="#181825", fg="#cdd6f4", activebackground="#181825", activeforeground="#89b4fa",
            selectcolor="#313244", font=("Sans", 9), cursor="hand2"
        )
        cb2.grid(row=0, column=1, sticky="w", padx=6, pady=3)

        cb3 = self.tk.Checkbutton(
            targets_grid, text=" .rpm (Fedora / RHEL / openSUSE)", variable=self.cb_rpm_var,
            bg="#181825", fg="#cdd6f4", activebackground="#181825", activeforeground="#89b4fa",
            selectcolor="#313244", font=("Sans", 9), cursor="hand2"
        )
        cb3.grid(row=0, column=2, sticky="w", padx=6, pady=3)

        cb4 = self.tk.Checkbutton(
            targets_grid, text=" .pkg.tar.zst (Arch / Manjaro)", variable=self.cb_arch_var,
            bg="#181825", fg="#cdd6f4", activebackground="#181825", activeforeground="#89b4fa",
            selectcolor="#313244", font=("Sans", 9), cursor="hand2"
        )
        cb4.grid(row=1, column=0, sticky="w", padx=6, pady=3)

        cb5 = self.tk.Checkbutton(
            targets_grid, text=" .tar.gz (Wersja przenośna)", variable=self.cb_tar_var,
            bg="#181825", fg="#cdd6f4", activebackground="#181825", activeforeground="#89b4fa",
            selectcolor="#313244", font=("Sans", 9), cursor="hand2"
        )
        cb5.grid(row=1, column=1, sticky="w", padx=6, pady=3)

        # Karta 3: Katalog wyjściowy
        out_card = self.tk.Frame(main_box, bg="#181825", padx=16, pady=12, highlightbackground="#313244", highlightthickness=1)
        out_card.pack(fill="x", pady=(0, 10))

        self.tk.Label(
            out_card,
            text="3. Katalog zapisu gotowych paczek:",
            bg="#181825",
            fg="#89b4fa",
            font=("Sans", 10, "bold")
        ).pack(anchor="w", pady=(0, 6))

        out_row = self.tk.Frame(out_card, bg="#181825")
        out_row.pack(fill="x")

        self.out_dir_var = self.tk.StringVar()
        self.out_dir_entry = self.tk.Entry(
            out_row,
            textvariable=self.out_dir_var,
            bg="#313244",
            fg="#cdd6f4",
            insertbackground="#89b4fa",
            highlightbackground="#45475a",
            highlightcolor="#89b4fa",
            highlightthickness=1,
            relief="flat",
            font=("Sans", 9)
        )
        self.out_dir_entry.pack(side="left", fill="x", expand=True, padx=(0, 8))

        self.browse_out_btn = self.tk.Button(
            out_row,
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
            cursor="hand2",
            command=self._browse_out_dir
        )
        self.browse_out_btn.pack(side="right")

        # Karta 4: Pasek postępu i Konsola logów
        log_card = self.tk.Frame(main_box, bg="#1e1e2e")
        log_card.pack(fill="both", expand=True)

        self.progress_bar = self.ttk.Progressbar(log_card, orient="horizontal", mode="determinate", style="Horizontal.TProgressbar")
        self.progress_bar.pack(fill="x", pady=(0, 4))

        self.status_lbl = self.tk.Label(
            log_card,
            text="Status: Gotowy do budowania.",
            bg="#1e1e2e",
            fg="#89b4fa",
            font=("Sans", 9, "bold")
        )
        self.status_lbl.pack(anchor="w", pady=(0, 4))

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

    def _detect_initial_files(self):
        """Wyszukuje automatycznie pliki wejściowe w Downloads lub folderze projektu."""
        # Domyślny folder wyjściowy
        default_out = SCRIPT_DIR.parent / "dist"
        if not default_out.exists():
            default_out = Path.home() / "Pobrane" / "exer_linux_packages"
        self.out_dir_var.set(str(default_out))

        # Wyszukanie EXER-Client-WebSetup.exe w Pobrane
        cand_exe = [
            Path.home() / "Pobrane" / "EXER-Client-WebSetup (1).exe",
            Path.home() / "Pobrane" / "EXER-Client-WebSetup.exe",
            Path.home() / "Downloads" / "EXER-Client-WebSetup.exe",
            SCRIPT_DIR.parent / "downloads" / "EXER-Client-0.5.99-09dd09f17778.zip",
        ]
        for c in cand_exe:
            if c.exists():
                self.input_file_var.set(str(c))
                self.log(f"[AUTO] Znaleziono plik wejściowy: {c.name}")
                break

        self.log("[STUDIO] Gotowy do pracy. Wybierz źródło i kliknij 'Rozpocznij budowanie pakietów'.")

    def _on_source_mode_change(self):
        val = self.source_mode_var.get()
        if val == "file":
            self.input_file_entry.configure(state="normal", bg="#313244")
            self.browse_input_btn.configure(state="normal", bg="#313244")
        else:
            self.input_file_entry.configure(state="disabled", bg="#181825")
            self.browse_input_btn.configure(state="disabled", bg="#181825")

    def _browse_input_file(self):
        path = self.filedialog.askopenfilename(
            title="Wybierz plik instalacyjny Windows",
            filetypes=[
                ("Instalatory Windows / ZIP", "*.exe *.zip"),
                ("Wszystkie pliki", "*.*")
            ]
        )
        if path:
            self.input_file_var.set(path)

    def _browse_out_dir(self):
        path = self.filedialog.askdirectory(title="Wybierz katalog zapisu gotowych paczek")
        if path:
            self.out_dir_var.set(path)

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

    def _start_build(self):
        targets = []
        if self.cb_appimage_var.get(): targets.append("appimage")
        if self.cb_deb_var.get(): targets.append("deb")
        if self.cb_rpm_var.get(): targets.append("rpm")
        if self.cb_arch_var.get(): targets.append("arch")
        if self.cb_tar_var.get(): targets.append("tarball")

        if not targets:
            self.messagebox.showwarning("Uwaga", "Wybierz przynajmniej jeden format docelowy!")
            return

        is_online = (self.source_mode_var.get() == "online")
        input_file = self.input_file_var.get().strip()

        if not is_online:
            if not input_file or not Path(input_file).is_file():
                self.messagebox.showerror("Błąd", "Wskazany plik wejściowy nie istnieje!")
                return

        out_dir = Path(self.out_dir_var.get().strip())
        out_dir.mkdir(parents=True, exist_ok=True)

        self.btn_build.configure(state="disabled", bg="#45475a", fg="#6c7086")
        self.btn_close.configure(state="disabled")
        self.progress_bar.configure(mode="indeterminate")
        self.progress_bar.start(12)

        t = threading.Thread(
            target=self._run_build_thread,
            args=(Path(input_file) if not is_online else None, is_online, targets, out_dir),
            daemon=True
        )
        t.start()

    def _run_build_thread(self, input_file, is_online, targets, out_dir):
        success = False
        try:
            self.set_status("Budowanie pakietów w toku...")
            self.built_files = self.builder.run_pipeline(
                input_path=input_file,
                download_online=is_online,
                targets=targets,
                out_dir=out_dir,
                log_cb=self.log
            )
            success = True
        except Exception as e:
            self.log(f"\n❌ BŁĄD KRYTYCZNY: {e}")
            self.set_status(f"Błąd: {e}")
            success = False

        self.root.after(0, self._finish_build, success, out_dir)

    def _finish_build(self, success: bool, out_dir: Path):
        self.progress_bar.stop()
        self.progress_bar.configure(mode="determinate")
        self.btn_close.configure(state="normal")
        self.btn_build.configure(state="normal", bg="#89b4fa", fg="#11111b")

        if success:
            self.progress_bar["value"] = 100
            self.set_status("Wszystkie pakiety zostały pomyślnie wygenerowane!", 100)
            self.btn_open_folder.pack(side="left", padx=(10, 0))
            self.messagebox.showinfo(
                "Sukces",
                f"Budowanie pakietów zakończone sukcesem!\n\nWygenerowane pliki znajdują się w:\n{out_dir}"
            )
        else:
            self.progress_bar["value"] = 0
            self.set_status("Budowanie nie powiodło się. Sprawdź dziennik zdarzeń.")
            self.messagebox.showerror(
                "Błąd budowania",
                "Wystąpił problem podczas budowania pakietów.\nSzczegóły błędu zostały zapisane w oknie dziennika."
            )

    def _open_output_folder(self):
        out_dir = self.out_dir_var.get().strip()
        if out_dir and Path(out_dir).is_dir():
            try:
                subprocess.Popen(["xdg-open", out_dir])
            except Exception as e:
                self.messagebox.showerror("Błąd", f"Nie udało się otworzyć folderu: {e}")


def main():
    parser = argparse.ArgumentParser(description="EXER Linux Builder Studio (Generator paczek Linux z plików Windows)")
    parser.add_argument("--cli", action="store_true", help="Uruchom w trybie konsolowym CLI")
    parser.add_argument("--input", type=str, default="", help="Ścieżka do pliku .exe lub .zip")
    parser.add_argument("--online", action="store_true", help="Pobierz najnowszą wersję z serwera API")
    parser.add_argument("--out", type=str, default="", help="Katalog zapisu gotowych paczek")
    parser.add_argument("--targets", type=str, default="appimage,deb,rpm,arch,tarball", help="Formaty (oddzielone przecinkami)")
    args = parser.parse_args()

    use_gui = not args.cli
    if use_gui:
        has_disp = bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))
        if not has_disp:
            use_gui = False

    if use_gui:
        try:
            import tkinter as tk
            root = tk.Tk()
            app = ExerBuilderGUI(root)
            root.mainloop()
            return
        except Exception as e:
            print(f"[OSTRZEŻENIE] Nie udało się otworzyć GUI: {e}")
            print("Przełączanie na tryb tekstowy CLI...\n")

    # Tryb CLI
    builder = ExerLinuxBuilder()
    out_dir = Path(args.out).resolve() if args.out else (Path.cwd() / "dist")
    targets = [t.strip().lower() for t in args.targets.split(",") if t.strip()]

    inp = Path(args.input).resolve() if args.input else None
    builder.run_pipeline(
        input_path=inp,
        download_online=args.online or (not inp),
        targets=targets,
        out_dir=out_dir
    )


if __name__ == "__main__":
    main()
