"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SelfUpdate = void 0;
exports.asarVersion = asarVersion;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const adm_zip_1 = __importDefault(require("adm-zip"));
const verify_1 = require("../../../packages/manifests/src/verify");
const io_1 = require("./io");
const launcher_objects_1 = require("./launcher-objects");
const EXE = 'EXER Client.exe';
/** The version in package.json inside an app.asar (read from the archive header, no Electron asar support needed). */
async function asarVersion(file) {
    const b = await promises_1.default.readFile(file);
    const headerSize = b.readUInt32LE(12), header = JSON.parse(b.subarray(16, 16 + headerSize).toString('utf8'));
    const entry = header.files?.['package.json'];
    if (!entry)
        throw Error('app.asar has no package.json');
    const start = 8 + b.readUInt32LE(4) + Number(entry.offset);
    return String(JSON.parse(b.subarray(start, start + entry.size).toString('utf8')).version);
}
class SelfUpdate {
    current;
    installRoot;
    packaged;
    api;
    key;
    cacheDir;
    notify;
    log;
    channel;
    token;
    onUnauthorizedChannel;
    status;
    manifest = null;
    busy = false;
    generation = 0;
    abort = new AbortController();
    reset() { this.generation++; this.abort.abort(); this.abort = new AbortController(); this.manifest = null; this.set({ state: this.packaged ? 'idle' : 'unsupported', version: undefined, notes: undefined, error: undefined }); }
    timer = null;
    constructor(current, installRoot, packaged, api, key, cacheDir, notify, log, channel = () => 'stable', token = async () => '', onUnauthorizedChannel) {
        this.current = current;
        this.installRoot = installRoot;
        this.packaged = packaged;
        this.api = api;
        this.key = key;
        this.cacheDir = cacheDir;
        this.notify = notify;
        this.log = log;
        this.channel = channel;
        this.token = token;
        this.onUnauthorizedChannel = onUnauthorizedChannel;
        this.status = { state: packaged ? 'idle' : 'unsupported', current };
    }
    get() { return this.status; }
    set(next) { this.status = { ...this.status, ...next }; this.notify(this.status); }
    stage(version = this.status.version || 'pending') {
        const safe = String(version).replace(/[^0-9A-Za-z._-]/g, '_');
        // Keep staging outside the installed app directory. Windows Defender and
        // Electron can briefly lock files below the install root after extraction.
        return node_path_1.default.join(this.cacheDir(), 'launcher-updates', `stage-${this.channel()}-${safe}`);
    }
    start(intervalMs = 5 * 60 * 1000) {
        if (!this.packaged)
            return;
        setTimeout(() => void this.check().catch(() => { }), 4000);
        this.timer = setInterval(() => void this.check().catch(() => { }), intervalMs);
    }
    stop() { if (this.timer)
        clearInterval(this.timer); this.timer = null; }
    async check() {
        if (!this.packaged || this.busy || this.status.state === 'ready')
            return this.status;

        if (process.platform === 'linux') {
            this.busy = true;
            const generation = this.generation;
            try {
                this.set({ checkedAt: new Date().toISOString() });
                const ghUrl = 'https://api.github.com/repos/PotatoePotatoePotatoe/exer-client-linux/releases/latest';
                const res = await (0, io_1.getJSON)(ghUrl, {
                    headers: { 'User-Agent': 'EXER-Client-Linux' }
                });
                const tag = (res.tag_name || '').replace(/^v/, '');
                if (tag && (0, verify_1.newerVersion)(tag, this.current)) {
                    this.log(`Wykryto nową wersję EXER Client na GitHubie: v${tag} (aktualna: v${this.current})`);
                    this.manifest = {
                        version: tag,
                        channel: 'stable',
                        notes: { pl: [res.body || 'Nowa wersja na GitHubie'], en: [res.body || 'New version on GitHub'] },
                        assets: res.assets || []
                    };
                    await this.downloadLinux(this.manifest, generation);
                } else {
                    if (this.status.state !== 'downloading')
                        this.set({ state: 'idle', error: undefined });
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.log('Sprawdzanie aktualizacji GitHub: ' + msg);
            } finally {
                this.busy = false;
            }
            return this.status;
        }

        const api = this.api();
        if (!api)
            return this.status;
        this.busy = true;
        const ch = this.channel(), generation = this.generation;
        try {
            const query = ch === 'dev' ? '?channel=dev' : (ch === 'beta' ? '?channel=beta' : '');
            const headers = {};
            if (ch === 'dev')
                headers['Authorization'] = 'Bearer ' + await this.token();
            const envelope = await (0, io_1.getJSON)(api.replace(/\/$/, '') + '/v1/launcher/releases/latest' + query, { headers });
            const m = (0, verify_1.verifyLauncherManifest)(envelope, await this.key());
            if (m.channel !== ch)
                throw Error('Niezgodny kanał podpisanego manifestu.');
            if (generation !== this.generation)
                return this.status;
            this.set({ checkedAt: new Date().toISOString() });
            const installedChannel = await promises_1.default.readFile(node_path_1.default.join(this.installRoot, 'installed-channel.txt'), 'utf8').catch(() => 'stable');
            const isDowngradeReturn = installedChannel.trim() !== ch;
            if (!(0, verify_1.newerVersion)(m.version, this.current) && !isDowngradeReturn) {
                if (this.status.state !== 'downloading')
                    this.set({ state: 'idle', error: undefined });
                return this.status;
            }
            this.manifest = m;
            await this.download(m, generation);
        }
        catch (e) {
            if (generation !== this.generation)
                return this.status;
            const msg = e instanceof Error ? e.message : String(e);
            if (ch === 'dev' && /403|401|Brak uprawnień/.test(msg)) {
                this.log('Brak uprawnień administratora do kanału DEV. Przełączono na kanał Stable.');
                this.onUnauthorizedChannel?.('stable');
                this.set({ state: 'idle', error: 'Brak uprawnień do kanału DEV. Przywrócono kanał Stable.' });
                return this.status;
            }
            // 503 = nothing published yet; that is not an error for the player.
            if (!/HTTP 503|HTTP 404/.test(msg)) {
                this.log('Aktualizacja launchera: ' + msg);
                this.set({ state: 'error', error: msg });
            }
        }
        finally {
            this.busy = false;
            if (generation !== this.generation)
                queueMicrotask(() => void this.check().catch(() => { }));
        }
        return this.status;
    }
    async download(m, generation) {
        this.set({ state: 'downloading', version: m.version, notes: m.notes, percent: 0, error: undefined });
        const dir = node_path_1.default.join(this.cacheDir(), 'launcher-updates');
        await promises_1.default.mkdir(dir, { recursive: true });
        const zip = node_path_1.default.join(dir, `EXER-Client-${m.version}-${m.sha256.slice(0, 12)}.zip`);
        const stage = this.stage(m.version);
        if (!await this.stageFromObjects(m, stage, dir, generation))
            await this.stageFromZip(m, zip, stage, generation);
        const noAsar = process.noAsar;
        process.noAsar = true;
        try {
            // A package whose app is another version would install, restart as the old version and download again forever.
            // An object update leaves app.asar out only when the installed one already is this version.
            const asar = node_path_1.default.join(stage, 'resources', 'app.asar');
            const unchanged = m.version === this.current && !await promises_1.default.access(asar).then(() => true, () => false);
            const inside = unchanged ? m.version : await asarVersion(asar).catch(() => '?');
            if (inside !== m.version) {
                await promises_1.default.rm(stage, { recursive: true, force: true }).catch(() => { });
                throw Error(`Paczka aktualizacji ${m.version} zawiera wersję ${inside}. Aktualizacja wstrzymana.`);
            }
            await promises_1.default.writeFile(node_path_1.default.join(stage, 'installed.txt'), m.version);
            await promises_1.default.writeFile(node_path_1.default.join(stage, 'installed-channel.txt'), m.channel);
        }
        finally {
            process.noAsar = noAsar;
        }
        // Old downloads are not needed any more.
        await promises_1.default.rm(node_path_1.default.join(dir, 'objects'), { recursive: true, force: true }).catch(() => { });
        for (const f of await promises_1.default.readdir(dir))
            if (f !== node_path_1.default.basename(zip))
                await promises_1.default.rm(node_path_1.default.join(dir, f), { force: true }).catch(() => { });
        this.log(`Aktualizacja launchera ${m.version} pobrana i gotowa do instalacji.`);
        if (generation !== this.generation)
            throw Error('Zmieniono kanał aktualizacji.');
        this.set({ state: 'ready', percent: 100 });
    }
    // Downloads only what differs from the installed files; false means "use the full zip instead".
    async stageFromObjects(m, stage, dir, generation) {
        if (!m.objects || this.channel() !== 'stable')
            return false;
        let last = 0;
        try {
            await promises_1.default.rm(stage, { recursive: true, force: true, maxRetries: 12, retryDelay: 500 });
            const result = await (0, launcher_objects_1.stageObjects)({ files: m.objects.files, base: m.objects.base, root: this.installRoot, stage, cache: node_path_1.default.join(dir, 'objects'), signal: this.abort.signal, progress: (done, total) => {
                    const pct = Math.floor(done * 100 / Math.max(1, total));
                    if (pct !== last) {
                        last = pct;
                        this.set({ percent: Math.min(99, pct) });
                    }
                } });
            if (generation !== this.generation)
                throw Error('Zmieniono kanał aktualizacji.');
            this.log(`Aktualizacja launchera ${m.version}: ${result.changed} plików, pobrano ${(result.downloaded / 1048576).toFixed(1)} MB.`);
            return true;
        }
        catch (e) {
            if (generation !== this.generation || this.abort.signal.aborted)
                throw e;
            this.log('Aktualizacja różnicowa nie powiodła się, pobieram pełną paczkę: ' + (e instanceof Error ? e.message : String(e)));
            await promises_1.default.rm(stage, { recursive: true, force: true }).catch(() => { });
            this.set({ percent: 0 });
            return false;
        }
    }
    async stageFromZip(m, zip, stage, generation) {
        let last = 0;
        const ch = this.channel();
        const headers = {};
        if (ch === 'dev')
            headers['Authorization'] = 'Bearer ' + await this.token();
        if (ch === 'dev' && new URL(m.url).origin !== new URL(this.api()).origin)
            throw Error('Prywatny plik wymaga adresu EXER API.');
        await (0, io_1.download)(m.url, zip, { signal: this.abort.signal, hash: m.sha256, algorithm: 'sha256', size: m.size, headers, progress: (done, total) => {
                const pct = Math.floor(done * 100 / Math.max(1, total || m.size));
                if (pct !== last) {
                    last = pct;
                    this.set({ percent: Math.min(99, pct) });
                }
            } });
        // Unpack next to the install folder. Electron treats *.asar paths as archives, so switch that off.
        if (generation !== this.generation)
            throw Error('Zmieniono kanał aktualizacji.');
        await promises_1.default.rm(stage, { recursive: true, force: true, maxRetries: 12, retryDelay: 500 });
        const noAsar = process.noAsar;
        process.noAsar = true;
        try {
            new adm_zip_1.default(zip).extractAllTo(stage, true);
            await promises_1.default.access(node_path_1.default.join(stage, EXE));
            await promises_1.default.access(node_path_1.default.join(stage, 'resources', 'app.asar'));
        }
        catch (e) {
            await promises_1.default.rm(stage, { recursive: true, force: true }).catch(() => { });
            throw Error('Pobrana aktualizacja jest niekompletna.');
        }
        finally {
            process.noAsar = noAsar;
        }
    }
    async downloadLinux(m, generation) {
        this.set({ state: 'downloading', version: m.version, notes: m.notes, percent: 0, error: undefined });
        const dir = node_path_1.default.join(this.cacheDir(), 'launcher-updates');
        await promises_1.default.mkdir(dir, { recursive: true });

        const isAppImage = Boolean(process.env.APPIMAGE);
        let targetAsset = null;

        if (isAppImage) {
            targetAsset = m.assets.find(a => a.name.toLowerCase().endsWith('.appimage'));
        } else {
            const hasFedora = await promises_1.default.access('/etc/fedora-release').then(() => true, () => false);
            const hasDebian = await promises_1.default.access('/etc/debian_version').then(() => true, () => false);
            const hasArch = await promises_1.default.access('/etc/arch-release').then(() => true, () => false);

            if (hasFedora) {
                targetAsset = m.assets.find(a => a.name.endsWith('.rpm'));
            } else if (hasDebian) {
                targetAsset = m.assets.find(a => a.name.endsWith('.deb'));
            } else if (hasArch) {
                targetAsset = m.assets.find(a => a.name.includes('.pkg.tar.'));
            }
            if (!targetAsset) {
                targetAsset = m.assets.find(a => a.name.toLowerCase().endsWith('.appimage')) ||
                              m.assets.find(a => a.name.endsWith('.tar.gz'));
            }
        }

        if (!targetAsset) {
            throw Error('Nie znaleziono odpowiedniego pakietu dla Linuksa w najnowszym wydaniu GitHub.');
        }

        const destFile = node_path_1.default.join(dir, targetAsset.name);
        this.log(`Pobieranie aktualizacji Linux: ${targetAsset.name} (${(targetAsset.size / 1048576).toFixed(1)} MB)...`);

        let last = 0;
        await (0, io_1.download)(targetAsset.browser_download_url, destFile, {
            signal: this.abort.signal,
            size: targetAsset.size,
            headers: { 'User-Agent': 'EXER-Client-Linux' },
            progress: (done, total) => {
                const pct = Math.floor(done * 100 / Math.max(1, total || targetAsset.size));
                if (pct !== last) {
                    last = pct;
                    this.set({ percent: Math.min(99, pct) });
                }
            }
        });

        this.downloadedLinuxFile = destFile;
        this.log(`Aktualizacja ${m.version} została pobrana i jest gotowa do zainstalowania.`);
        if (generation !== this.generation)
            throw Error('Zmieniono stan aktualizacji.');
        this.set({ state: 'ready', percent: 100 });
    }
    // Starts the helper that installs the staged files after this process exits.
    async install(relaunch) {
        if (process.platform === 'linux') {
            if (this.status.state !== 'ready')
                throw Error('Aktualizacja nie jest jeszcze pobrana.');

            const downloaded = this.downloadedLinuxFile;
            if (!downloaded || !await promises_1.default.access(downloaded).then(() => true, () => false)) {
                throw Error('Plik aktualizacji nie został odnaleziony.');
            }

            this.log(`Instalowanie aktualizacji launchera ${this.status.version}...`);

            if (process.env.APPIMAGE) {
                const runningAppImage = process.env.APPIMAGE;
                await promises_1.default.chmod(downloaded, 0o755);

                const helperScript = node_path_1.default.join(this.cacheDir(), 'launcher-updates', 'apply-update.sh');
                const scriptContent = `#!/usr/bin/env bash
sleep 1
mv -f "${downloaded}" "${runningAppImage}"
chmod +x "${runningAppImage}"
if [ "${relaunch ? '1' : '0'}" = "1" ]; then
    "${runningAppImage}" &
fi
`;
                await promises_1.default.writeFile(helperScript, scriptContent, { mode: 0o755 });
                const sub = (0, node_child_process_1.spawn)('bash', [helperScript], { detached: true, stdio: 'ignore' });
                sub.unref();
                return true;
            }

            let installCmd = '';
            if (downloaded.endsWith('.rpm')) {
                installCmd = `dnf install -y --nogpgcheck "${downloaded}" || rpm -Uvh --replacepkgs "${downloaded}"`;
            } else if (downloaded.endsWith('.deb')) {
                installCmd = `apt install -y "${downloaded}" || dpkg -i "${downloaded}"`;
            } else if (downloaded.includes('.pkg.tar.')) {
                installCmd = `pacman -U --noconfirm "${downloaded}"`;
            }

            if (installCmd) {
                const helperScript = node_path_1.default.join(this.cacheDir(), 'launcher-updates', 'apply-pkg.sh');
                const scriptContent = `#!/usr/bin/env bash
sleep 1
pkexec bash -c '${installCmd}' || sudo bash -c '${installCmd}'
if [ "${relaunch ? '1' : '0'}" = "1" ]; then
    exer-client &
fi
`;
                await promises_1.default.writeFile(helperScript, scriptContent, { mode: 0o755 });
                const sub = (0, node_child_process_1.spawn)('bash', [helperScript], { detached: true, stdio: 'ignore' });
                sub.unref();
                return true;
            }

            return true;
        }
        if (this.status.state !== 'ready')
            throw Error('Aktualizacja nie jest jeszcze pobrana.');
        if (this.manifest?.channel !== this.channel())
            throw Error('Zmieniono kanał aktualizacji.');
        if (this.channel() === 'dev')
            await this.token();
        const stage = this.stage(), root = this.installRoot;
        const q = (s) => "'" + s.replace(/'/g, "''") + "'";
        const obsolete = this.manifest.objects ? await (0, launcher_objects_1.obsoleteFiles)(root, this.manifest.objects.files) : [];
        const logFile = node_path_1.default.join(this.cacheDir(), 'launcher-updates', 'install-update.log');
        const script = [
            '$ErrorActionPreference = "SilentlyContinue"',
            `$log = ${q(logFile)}`,
            'function Log($m) { Add-Content -LiteralPath $log -Value ("{0:u} {1}" -f (Get-Date), $m) }',
            'Log "helper started"',
            `Wait-Process -Id ${process.pid} -Timeout 60`,
            `$stage = ${q(stage)}; $root = ${q(root)}`,
            // Electron's helper processes (GPU, renderer) can outlive the main one and still hold files
            // and the single-instance lock: wait until nothing from the install folder runs (max 30 s).
            'function Running { @(Get-Process -Name "EXER Client" -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) }).Count }',
            'for ($i = 0; $i -lt 60 -and (Running) -gt 0; $i++) { Start-Sleep -Milliseconds 500 }',
            'Log ("still running before copy: " + (Running))',
            '$root = [IO.Path]::GetFullPath($root); $stage = [IO.Path]::GetFullPath($stage)',
            `$allowedStage = ${q(node_path_1.default.resolve(this.cacheDir(), 'launcher-updates') + node_path_1.default.sep)}`,
            'if (-not $stage.StartsWith($allowedStage, [StringComparison]::OrdinalIgnoreCase) -or $root -eq [IO.Path]::GetPathRoot($root)) { Log "unsafe update paths"; exit 1 }',
            '$backup = [IO.Path]::GetFullPath($root + ".update-backup")',
            'if ([IO.Path]::GetDirectoryName($backup) -ne [IO.Path]::GetDirectoryName($root)) { Log "unsafe backup path"; exit 1 }',
            'if (Test-Path -LiteralPath $backup) { Log "previous backup needs inspection"; exit 1 }',
            'robocopy $root $backup /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null',
            'if ($LASTEXITCODE -ge 8) { Log "backup failed"; exit 1 }',
            'robocopy $stage $root /E /R:20 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null',
            '$code = $LASTEXITCODE',
            'Log "robocopy exit code $code"',
            'if ($code -ge 8) { robocopy $backup $root /MIR /R:20 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null; if ($LASTEXITCODE -ge 8) { Log "rollback failed; backup preserved"; exit 1 }; Log "restored previous installation" }',
            'if ($code -lt 8) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue }',
            // Files of older releases: robocopy only adds, so old version jars would pile up forever.
            ...obsolete.map(name => `if ($code -lt 8) { Remove-Item -LiteralPath (Join-Path $root ${q(name)}) -Force -ErrorAction SilentlyContinue }`),
            // The taskbar resolves the icon through the shortcut and Explorer's cache, which outlives a changed exe.
            'if ($code -lt 8) { Start-Process -FilePath "ie4uinit.exe" -ArgumentList "-show" -WindowStyle Hidden }',
            ...(relaunch ? [
                `$exe = Join-Path $root ${q(EXE)}`,
                '$args0 = @(); if ($code -ge 8) { $args0 = @("--update-failed") }',
                // Start it and make sure it stays up; retry if it closed right away.
                'for ($try = 1; $try -le 3; $try++) { if ($args0.Count) { Start-Process -FilePath $exe -ArgumentList $args0 } else { Start-Process -FilePath $exe }; Start-Sleep -Seconds 6; if ((Running) -gt 0) { Log "relaunched (try $try)"; break } ; Log "launcher not running after try $try" }'
            ] : []),
        ].join('\r\n');
        const file = node_path_1.default.join(this.cacheDir(), 'launcher-updates', 'install-update.ps1');
        await promises_1.default.mkdir(node_path_1.default.dirname(file), { recursive: true });
        // PowerShell must receive a real UTF-8 BOM; keep it as a code point in the
        // generated helper instead of relying on a copied encoding artifact.
        await promises_1.default.writeFile(file, '\ufeff' + script, 'utf8');
        // A child of the launcher dies with it (Electron's process job), even when detached: 0.5.20 restarted
        // without ever running the helper. Windows' own WMI service starts it outside that job; the helper's first
        // log line confirms it runs before the launcher is allowed to exit.
        await promises_1.default.rm(logFile, { force: true }).catch(() => { });
        const started = async (ms) => {
            for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 150)))
                if ((await promises_1.default.readFile(logFile, 'utf8').catch(() => '')).includes('helper started'))
                    return true;
            return false;
        };
        const command = `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${file}"`;
        (0, node_child_process_1.spawn)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=${q(command)}} | Out-Null`], { stdio: 'ignore', windowsHide: true });
        if (!await started(8000)) {
            // last resort: started directly, it survives only when no job kills it
            (0, node_child_process_1.spawn)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', file], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
            if (!await started(5000))
                throw Error('Nie udało się uruchomić instalatora aktualizacji. Pobierz launcher ze strony exerclient.com.');
        }
        this.log(`Instalowanie aktualizacji launchera ${this.status.version}…`);
        return true;
    }
}
exports.SelfUpdate = SelfUpdate;
