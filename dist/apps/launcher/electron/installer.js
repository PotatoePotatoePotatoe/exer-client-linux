"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Installer = void 0;
exports.requiredJavaMajor = requiredJavaMajor;
exports.gameJavaExecutable = gameJavaExecutable;
exports.isJavaProcess = isJavaProcess;
exports.unhidePathOnWindows = unhidePathOnWindows;
exports.hidePathOnWindows = hidePathOnWindows;
exports.validateJavaPath = validateJavaPath;
exports.ensureHiddenExerCoreJar = ensureHiddenExerCoreJar;
const content_1 = require("./content");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const node_crypto_1 = require("node:crypto");
const contracts_1 = require("../../../packages/shared/src/contracts");
const version_manifest_1 = require("../../../packages/shared/src/version-manifest");
const optimization_mods_json_1 = __importDefault(require("../../../packages/shared/src/optimization-mods.json"));
const OPTIMIZATION_MODS = optimization_mods_json_1.default.mods;
const io_1 = require("./io");
const fingerprints_1 = require("./fingerprints");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
const javaVersionCache = new Map();
/** Mojang's older version files omit javaVersion; use the same profile fallback at install and launch. */
function requiredJavaMajor(versionId, metadata) {
    return metadata.javaVersion?.majorVersion || (0, version_manifest_1.getVersionManifestEntry)(versionId)?.javaMajor || 21;
}
/** javaw avoids a console window without hiding the game's first native window. */
async function gameJavaExecutable(java, platform = process.platform) {
    if (platform !== 'win32' || node_path_1.default.basename(java).toLowerCase() !== 'java.exe')
        return java;
    const javaw = node_path_1.default.join(node_path_1.default.dirname(java), 'javaw.exe');
    return await (0, io_1.validFile)(javaw) ? javaw : java;
}
/** True when the PID is a running java/javaw process (Windows: tasklist; elsewhere the signal check is all there is). */
async function isJavaProcess(pid) {
    if (process.platform !== 'win32')
        return true;
    try {
        const { stdout } = await execFileAsync('tasklist', ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000 });
        return /^"javaw?\.exe"/im.test(stdout.trim());
    }
    catch {
        // tasklist unavailable or too slow: keep the old behaviour (the signal check already passed) rather than orphan a real game
        return true;
    }
}
async function unhidePathOnWindows(targetPath) {
    if (process.platform !== 'win32')
        return;
    try {
        await execFileAsync('attrib', ['-h', '-s', '-r', targetPath], { windowsHide: true, timeout: 5000 });
    }
    catch { }
}
async function hidePathOnWindows(targetPath) {
    if (process.platform !== 'win32')
        return;
    try {
        await execFileAsync('attrib', ['-h', '-s', '-r', targetPath], { windowsHide: true, timeout: 5000 });
    }
    catch { }
}
/** Validate a user-selected runtime before it is ever passed to execFile/spawn. */
async function validateJavaPath(value) {
    const file = value.trim();
    const isWin = process.platform === 'win32';
    const isAbs = isWin ? node_path_1.default.win32.isAbsolute(file) : node_path_1.default.isAbsolute(file);
    const expected = isWin ? 'java.exe' : 'java';
    if (file !== value || !file || !isAbs || (isWin && file.startsWith('\\\\')) ||
        /[\x00-\x1f"<>|?*]/.test(file) || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(file) ||
        (isWin ? node_path_1.default.win32.basename(file).toLowerCase() !== 'java.exe' : !node_path_1.default.basename(file).toLowerCase().startsWith('java')))
        throw Error(isWin ? 'Wskaż bezpośrednią, lokalną ścieżkę do pliku java.exe.' : 'Wskaż bezpośrednią ścieżkę do pliku java.');
    let stat;
    try {
        stat = await promises_1.default.stat(file);
    }
    catch {
        throw Error(`Wskazany plik ${expected} nie istnieje lub nie jest dostępny.`);
    }
    if (!stat.isFile())
        throw Error(`Wskaż plik ${expected}, a nie folder lub inny typ pliku.`);
    return file;
}
async function ensureHiddenExerCoreJar(root, sourceJar) {
    const coreDir = node_path_1.default.join(root, '.exer-core');
    const hiddenJar = node_path_1.default.join(coreDir, 'exer-client.jar');
    const legacyModsJar = node_path_1.default.join(root, 'mods', 'exer-client.jar');
    const activeRelease = node_path_1.default.join(root, 'active-release.json');
    await promises_1.default.mkdir(coreDir, { recursive: true });
    await unhidePathOnWindows(coreDir);
    // An OTA release older than this launcher's EXER Core (e.g. the old 0.4.0 stable channel) is dropped, so the bundled
    // jar is used: otherwise the old jar would stay in .exer-core forever and miss newer protection (blacklist, identity).
    let hasActiveOta = await (0, io_1.validFile)(activeRelease);
    if (hasActiveOta) {
        try {
            const ota = JSON.parse(Buffer.from(JSON.parse(await promises_1.default.readFile(activeRelease, 'utf8')).payload, 'base64').toString('utf8'));
            if (typeof ota?.clientBuild !== 'string' || (0, contracts_1.olderBuild)(ota.clientBuild, contracts_1.BUILD)) {
                await promises_1.default.rm(activeRelease, { force: true });
                hasActiveOta = false;
            }
        }
        catch {
            await promises_1.default.rm(activeRelease, { force: true });
            hasActiveOta = false;
        }
    }
    if (await (0, io_1.validFile)(legacyModsJar)) {
        // The jar in mods/ (a fresh OTA update or an old install) becomes the hidden core jar. It is copied next to the
        // target first and only removed from mods/ once the copy is really in place: a failed copy must not lose the jar.
        await unhidePathOnWindows(hiddenJar);
        const staging = hiddenJar + '.tmp';
        try {
            await promises_1.default.copyFile(legacyModsJar, staging);
            await promises_1.default.rm(hiddenJar, { force: true }).catch(() => { });
            await promises_1.default.rename(staging, hiddenJar);
        }
        catch {
            await promises_1.default.rm(staging, { force: true }).catch(() => { });
        }
        if (await (0, io_1.validFile)(hiddenJar)) {
            await unhidePathOnWindows(legacyModsJar);
            await promises_1.default.rm(legacyModsJar, { force: true }).catch(() => { });
        }
    }
    if (await (0, io_1.validFile)(sourceJar) && !hasActiveOta) {
        let needsCopy = !await (0, io_1.validFile)(hiddenJar);
        if (!needsCopy) {
            try {
                const [srcHash, dstHash] = await Promise.all([(0, io_1.hashFile)(sourceJar), (0, io_1.hashFile)(hiddenJar)]);
                needsCopy = srcHash !== dstHash;
            }
            catch {
                needsCopy = true;
            }
        }
        if (needsCopy) {
            await unhidePathOnWindows(hiddenJar);
            await promises_1.default.rm(hiddenJar, { force: true }).catch(() => { });
            try {
                await promises_1.default.copyFile(sourceJar, hiddenJar);
            }
            catch {
                try {
                    const data = await promises_1.default.readFile(sourceJar);
                    await promises_1.default.writeFile(hiddenJar, data);
                }
                catch (err) {
                    if (!await (0, io_1.validFile)(hiddenJar))
                        throw err;
                }
            }
        }
    }
    await unhidePathOnWindows(hiddenJar);
    return hiddenJar;
}
class Installer {
    settings;
    root;
    cache;
    clientJar;
    progress;
    log;
    controller = null;
    child = null;
    // Called when the game process ends; stopped=true when the player pressed Stop in the launcher.
    onExit = null;
    stopRequested = false;
    startedAt = 0;
    lastEvent = 0;
    externalPid = null;
    phaseName = '';
    phaseStartAt = 0;
    phaseStartDone = 0;
    constructor(settings, root, cache, clientJar, progress, log) {
        this.settings = settings;
        this.root = root;
        this.cache = cache;
        this.clientJar = clientJar;
        this.progress = progress;
        this.log = log;
        void (0, fingerprints_1.loadFingerprints)(node_path_1.default.join(this.cache(), 'fingerprints.json')).catch(() => { });
    }
    instance() { return node_path_1.default.join(this.root(), 'exer-' + this.settings().version + (this.settings().updateChannel === 'dev' ? '-dev' : '')); }
    busy() { return !!this.controller; }
    running() {
        if (this.externalPid) {
            try {
                process.kill(this.externalPid, 0);
                return true;
            }
            catch {
                this.externalPid = null;
                void promises_1.default.rm(node_path_1.default.join(this.instance(), 'process.json'), { force: true });
            }
        }
        return !!this.child;
    }
    async restore() {
        try {
            const value = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(this.instance(), 'process.json'), 'utf8'));
            if (Number.isInteger(value.pid) && value.pid > 0) {
                process.kill(value.pid, 0);
                // process.json can be stale after a reboot and the PID recycled by an unrelated program: it must be Java
                if (!await isJavaProcess(value.pid))
                    throw Error('PID does not belong to a Java process');
                this.externalPid = value.pid;
                return;
            }
        }
        catch {
            this.externalPid = null;
            void promises_1.default.rm(node_path_1.default.join(this.instance(), 'process.json'), { force: true });
        }
    }
    async installed() {
        try {
            const root = this.instance();
            const info = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(root, 'installed.json'), 'utf8'));
            if (info.build !== contracts_1.BUILD)
                return false;
            const sourceJar = this.clientJar(this.settings().version);
            const hasCore = (await (0, io_1.validFile)(node_path_1.default.join(root, '.exer-core', 'exer-client.jar'))) || (await (0, io_1.validFile)(sourceJar));
            return hasCore;
        }
        catch {
            return false;
        }
    }
    emit(phase, done = 0, total = 0, force = false, stage = 'install', isBytes = false) {
        const now = Date.now();
        if (phase !== this.phaseName) {
            this.phaseName = phase;
            this.phaseStartAt = now;
            this.phaseStartDone = done;
        }
        if (force || now - this.lastEvent > 100) {
            this.lastEvent = now;
            const elapsedSec = Math.max(0.15, (now - this.phaseStartAt) / 1000);
            const delta = Math.max(0, done - this.phaseStartDone);
            const estUnitBytes = isBytes ? 1 : 48 * 1024;
            const downloadedBytes = isBytes ? done : done * estUnitBytes;
            const totalBytes = isBytes ? total : total * estUnitBytes;
            const speedBps = delta > 0 ? Math.round((delta * estUnitBytes) / elapsedSec) : 0;
            const remainingBytes = Math.max(0, totalBytes - downloadedBytes);
            const etaSeconds = speedBps > 0 && remainingBytes > 0 ? Math.max(1, Math.round(remainingBytes / speedBps)) : null;
            const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
            this.progress({
                phase,
                done,
                total,
                busy: true,
                percent,
                downloadedBytes,
                totalBytes,
                speedBps,
                etaSeconds,
                stage,
                component: phase
            });
        }
    }
    cancel() { this.controller?.abort(Error('Pobieranie anulowane.')); }
    stop() {
        if (this.externalPid)
            throw Error('Zamknij okno gry uruchomionej w poprzedniej sesji launchera.');
        if (this.child) {
            this.stopRequested = true;
            this.child.kill();
        }
    }
    async runtime(signal, major) {
        if (this.settings().javaPath) {
            const java = await validateJavaPath(this.settings().javaPath);
            await this.checkJava(java, major);
            return java;
        }
        if (process.platform !== 'win32') {
            const sysCandidates = ['/usr/bin/java', '/usr/lib/jvm/java-' + major + '-openjdk/bin/java', 'java'];
            for (const candidate of sysCandidates) {
                try {
                    await this.checkJava(candidate, major);
                    return candidate;
                } catch {}
            }
        }
        const directory = node_path_1.default.join(this.cache(), 'java' + major);
        const marker = node_path_1.default.join(directory, 'runtime.json');
        try {
            const data = JSON.parse(await promises_1.default.readFile(marker, 'utf8'));
            const java = (0, io_1.safePath)(directory, data.path);
            if (await (0, io_1.hashFile)(java) === data.sha256) {
                await this.checkJava(java, major);
                return java;
            }
        }
        catch { }
        this.emit('Pobieranie Java ' + major + '…', 0, 0, true, 'java', true);
        const osParam = process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'mac' : 'linux');
        const releases = await (0, io_1.getJSON)(`https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=x64&image_type=jre&os=${osParam}`, signal);
        const p = releases[0]?.binary?.package;
        if (!p || !/^[a-f0-9]{64}$/.test(p.checksum))
            throw Error('Nieprawidłowe metadane Java.');
        const isTarGz = p.name.endsWith('.tar.gz') || p.name.endsWith('.tgz');
        const archiveExt = isTarGz ? '.tar.gz' : '.zip';
        const archiveFile = node_path_1.default.join(this.cache(), 'java' + major + archiveExt);
        await (0, io_1.download)(p.link, archiveFile, { hash: p.checksum, algorithm: 'sha256', size: p.size, signal, progress: (d, t) => this.emit('Java ' + major, d, t, false, 'java', true) });
        signal.throwIfAborted();
        await promises_1.default.mkdir(directory, { recursive: true });
        if (isTarGz) {
            await execFileAsync('tar', ['-xzf', archiveFile, '-C', directory]);
        } else {
            await (0, io_1.extractZip)(archiveFile, directory);
        }
        const binName = process.platform === 'win32' ? 'java.exe' : 'java';
        const candidates = await promises_1.default.readdir(directory, { withFileTypes: true });
        for (const entry of candidates.filter(x => x.isDirectory())) {
            const relative = entry.name + '/bin/' + binName, java = (0, io_1.safePath)(directory, relative);
            if (await (0, io_1.validFile)(java)) {
                if (process.platform !== 'win32') {
                    await promises_1.default.chmod(java, 0o755).catch(() => {});
                }
                await this.checkJava(java, major);
                await promises_1.default.writeFile(marker, JSON.stringify({ path: relative, sha256: await (0, io_1.hashFile)(java) }));
                return java;
            }
        }
        throw Error(`Archiwum Java nie zawiera ${binName}.`);
    }
    async checkJava(file, major) {
        try {
            const stat = await promises_1.default.stat(file);
            const cached = javaVersionCache.get(file);
            if (cached && cached.mtimeMs === stat.mtimeMs) {
                if (cached.major !== major)
                    throw Error('version');
                return;
            }
            const { stderr, stdout } = await execFileAsync(file, ['-version'], { windowsHide: true, timeout: 15000 });
            const m = (stderr + stdout).match(/version "(?:1\.)?(\d+)/);
            const detected = m ? +m[1] : 0;
            if (!m || detected !== major)
                throw Error('version');
            javaVersionCache.set(file, { mtimeMs: stat.mtimeMs, major: detected });
        }
        catch {
            throw Error(`Minecraft ${this.settings().version} wymaga Java ${major}. Wskaż java albo wybierz Auto.`);
        }
    }
    async install() {
        if (this.busy() || this.running())
            throw Error('Zakończ bieżącą operację lub grę.');
        this.controller = new AbortController();
        const signal = this.controller.signal;
        const root = this.instance(), MC_VERSION = this.settings().version;
        const versionMeta = (0, version_manifest_1.getVersionManifestEntry)(MC_VERSION);
        const sourceExerJar = this.clientJar(MC_VERSION);
        if (!await (0, io_1.validFile)(sourceExerJar)) {
            this.controller = null;
            throw Error(`Brak zbudowanego modułu EXER Core (${node_path_1.default.basename(sourceExerJar)}) dla Minecraft ${MC_VERSION}.`);
        }
        try {
            await promises_1.default.mkdir(root, { recursive: true });
            await (0, fingerprints_1.loadFingerprints)(node_path_1.default.join(this.cache(), 'fingerprints.json')).catch(() => { });
            this.emit('Sprawdzanie manifestu Minecraft…', 0, 0, true, 'manifest', false);
            const manifest = await (0, io_1.getJSON)('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', signal);
            const release = manifest.versions.find((v) => v.id === MC_VERSION);
            if (!release)
                throw Error('Wersja Minecraft niedostępna.');
            const versionFile = node_path_1.default.join(root, 'versions', MC_VERSION, MC_VERSION + '.json');
            await (0, io_1.download)(release.url, versionFile, { hash: release.sha1, signal });
            const version = JSON.parse(await promises_1.default.readFile(versionFile, 'utf8'));
            const java = await this.runtime(signal, requiredJavaMajor(MC_VERSION, version));
            this.emit('Minecraft ' + MC_VERSION, 0, 0, true, 'client', true);
            const game = version.downloads.client;
            const jar = node_path_1.default.join(root, 'versions', MC_VERSION, MC_VERSION + '.jar');
            await (0, io_1.download)(game.url, jar, { hash: game.sha1, size: game.size, signal, progress: (d, t) => this.emit('Klient Minecraft', d, t, false, 'client', true) });
            // 1.8.9 uses Legacy Fabric (its own intermediary and LWJGL 2 build) with the loader EXER Core was built and tested with.
            const legacy = versionMeta?.loaderFamily === 'legacy-fabric';
            const meta = legacy ? 'https://meta.legacyfabric.net' : 'https://meta.fabricmc.net';
            const loader = legacy ? versionMeta.fabricLoader : (await (0, io_1.getJSON)(`${meta}/v2/versions/loader/${MC_VERSION}`, signal)).find((v) => v.loader.stable)?.loader.version || versionMeta?.fabricLoader;
            if (!loader)
                throw Error('Brak stabilnego Fabric Loader dla ' + MC_VERSION);
            const fabric = await (0, io_1.getJSON)(`${meta}/v2/versions/loader/${MC_VERSION}/${loader}/profile/json`, signal);
            await promises_1.default.writeFile(node_path_1.default.join(root, 'fabric.json'), JSON.stringify(fabric));
            const libraries = new Map();
            for (const lib of [...version.libraries, ...fabric.libraries]) {
                if ((0, io_1.allowedRules)(lib.rules))
                    libraries.set(lib.name.split(':').slice(0, 2).join(':') + (lib.name.split(':')[3] || ''), lib);
            }
            const classpath = [];
            const natives = node_path_1.default.join(root, 'natives');
            let count = 0;
            for (const lib of libraries.values()) {
                signal.throwIfAborted();
                this.emit('Biblioteki i Fabric', count++, libraries.size, false, 'libraries', false);
                const osKey = process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'osx' : 'linux');
                const nativePattern = process.platform === 'win32' ? /:natives-windows/ : (process.platform === 'darwin' ? /:natives-osx/ : /:natives-linux/);
                // Old versions list natives as classifiers of a library without a main jar (LWJGL 2, JInput);
                // Legacy Fabric's LWJGL 2 build gives only the Maven coordinates. They are extracted, not put on the classpath.
                if (lib.natives && !lib.downloads?.artifact) {
                    const nativeKey = lib.natives[osKey]?.replace('${arch}', '64');
                    if (!nativeKey)
                        continue;
                    let native = lib.downloads?.classifiers?.[nativeKey];
                    if (!native) {
                        const [group, name, v] = lib.name.split(':');
                        const relative = `${group.replaceAll('.', '/')}/${name}/${v}/${name}-${v}-${nativeKey}.jar`;
                        const url = (lib.url || 'https://libraries.minecraft.net/') + relative;
                        const response = await fetch(url + '.sha1', { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
                        if (!response.ok)
                            throw Error('Brak sumy kontrolnej biblioteki ' + name);
                        const hash = (await response.text()).trim().split(/\s/)[0];
                        if (!/^[a-fA-F0-9]{40}$/.test(hash))
                            throw Error('Nieprawidłowy hash biblioteki.');
                        native = { path: relative, url, sha1: hash };
                    }
                    const dest = (0, io_1.safePath)(node_path_1.default.join(root, 'libraries'), native.path);
                    await (0, io_1.download)(native.url, dest, { hash: native.sha1, size: native.size, signal });
                    await (0, io_1.extractZip)(dest, natives, n => !n.startsWith('META-INF/'));
                    continue;
                }
                let artifact = lib.downloads?.artifact;
                if (!artifact) {
                    const [group, name, v, classifier] = lib.name.split(':');
                    const relative = `${group.replaceAll('.', '/')}/${name}/${v}/${name}-${v}${classifier ? '-' + classifier : ''}.jar`;
                    const url = (lib.url || 'https://libraries.minecraft.net/') + relative;
                    const response = await fetch(url + '.sha1', { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
                    if (!response.ok)
                        throw Error('Brak sumy kontrolnej biblioteki ' + name);
                    const hash = (await response.text()).trim().split(/\s/)[0];
                    if (!/^[a-fA-F0-9]{40}$/.test(hash))
                        throw Error('Nieprawidłowy hash biblioteki.');
                    artifact = { path: relative, url, sha1: hash };
                }
                const destination = (0, io_1.safePath)(node_path_1.default.join(root, 'libraries'), artifact.path);
                await (0, io_1.download)(artifact.url, destination, { hash: artifact.sha1, size: artifact.size, signal });
                classpath.push(destination);
                if (nativePattern.test(lib.name))
                    await (0, io_1.extractZip)(destination, natives, n => !n.startsWith('META-INF/'));
                const nativeKey = lib.natives?.[osKey]?.replace('${arch}', '64');
                const native = nativeKey ? lib.downloads?.classifiers?.[nativeKey] : null;
                if (native) {
                    const dest = (0, io_1.safePath)(node_path_1.default.join(root, 'libraries'), native.path);
                    await (0, io_1.download)(native.url, dest, { hash: native.sha1, size: native.size, signal });
                    await (0, io_1.extractZip)(dest, natives, n => !n.startsWith('META-INF/'));
                }
            }
            const index = version.assetIndex, indexPath = node_path_1.default.join(root, 'assets', 'indexes', index.id + '.json');
            await (0, io_1.download)(index.url, indexPath, { hash: index.sha1, size: index.size, signal });
            const assets = [...new Map(Object.values(JSON.parse(await promises_1.default.readFile(indexPath, 'utf8')).objects).map(a => [a.hash, a])).values()];
            let cursor = 0, finished = 0;
            await Promise.all(Array.from({ length: 6 }, async () => {
                while (cursor < assets.length) {
                    signal.throwIfAborted();
                    const asset = assets[cursor++];
                    if (!/^[a-f0-9]{40}$/.test(asset.hash))
                        throw Error('Nieprawidłowy hash assetu.');
                    await (0, io_1.download)(`https://resources.download.minecraft.net/${asset.hash.slice(0, 2)}/${asset.hash}`, node_path_1.default.join(root, 'assets', 'objects', asset.hash.slice(0, 2), asset.hash), { hash: asset.hash, size: asset.size, signal });
                    this.emit('Zasoby gry', ++finished, assets.length, false, 'assets', false);
                }
            }));
            // Mojang's logging config for old versions (Log4j 2.0-beta9) turns off message lookups (Log4Shell).
            let loggingConfig = '';
            const logging = version.logging?.client;
            if (legacy && logging?.file?.url && /^[a-f0-9]{40}$/.test(logging.file.sha1) && /^[\w.-]+$/.test(logging.file.id)) {
                loggingConfig = node_path_1.default.join(root, 'assets', 'log_configs', logging.file.id);
                await (0, io_1.download)(logging.file.url, loggingConfig, { hash: logging.file.sha1, size: logging.file.size, signal });
            }
            if (!legacy) {
                const apiVersion = versionMeta?.fabricApiVersion || '0.116.17+1.21.1';
                const apiURL = `https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/${apiVersion}/fabric-api-${apiVersion}.jar`;
                const apiResponse = await fetch(apiURL + '.sha1', { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
                if (!apiResponse.ok)
                    throw Error(`Brak sumy kontrolnej Fabric API ${apiVersion} (HTTP ${apiResponse.status}).`);
                const apiHash = (await apiResponse.text()).trim().split(/\s/)[0];
                if (!/^[a-f0-9]{40}$/i.test(apiHash))
                    throw Error('Nieprawidłowa suma Fabric API.');
                await (0, io_1.download)(apiURL, node_path_1.default.join(root, 'mods', 'fabric-api.jar'), { hash: apiHash, signal, progress: (d, t) => this.emit('Fabric API', d, t, false, 'fabric-api', true) });
            }
            this.emit('Instalowanie EXER Core…', 1, 1, true, 'exer-core', false);
            await ensureHiddenExerCoreJar(root, sourceExerJar);
            signal.throwIfAborted();
            classpath.push(jar);
            await promises_1.default.writeFile(node_path_1.default.join(root, 'launch.json'), JSON.stringify({ java, classpath, version, fabric, legacy, loggingConfig }));
            if (!legacy) {
                this.emit('Instalowanie Sodium…', 0, 1, true, 'sodium', false);
                try {
                    await new content_1.Content(() => root, () => false, () => MC_VERSION).installOptimization('sodium', signal);
                }
                catch (e) {
                    await promises_1.default.rm(node_path_1.default.join(root, 'installed.json'), { force: true });
                    throw e;
                }
                // Optional performance mods (packages/shared/src/optimization-mods.json): only builds made for this version;
                // a missing build or a failed download is logged and the game installs without that mod.
                const content = new content_1.Content(() => root, () => false, () => MC_VERSION);
                for (const mod of OPTIMIZATION_MODS) {
                    signal.throwIfAborted();
                    this.emit('Instalowanie ' + mod.name + '…', 0, 1, true, 'sodium', false);
                    try {
                        await content.installOptimization(mod.slug, signal);
                    }
                    catch (e) {
                        signal.throwIfAborted();
                        this.log(`Pominięto ${mod.name} dla Minecraft ${MC_VERSION}: ` + (e instanceof Error ? e.message : String(e)));
                    }
                }
            }
            else {
                // Sodium has no 1.8.9 build; Phosphor (lighting engine) is the optimization mod made for Legacy Fabric.
                // It is optional: the game runs without it, so a failed download does not fail the install.
                this.emit('Instalowanie Phosphor…', 0, 1, true, 'phosphor', false);
                try {
                    await new content_1.Content(() => root, () => false, () => MC_VERSION).installOptimization('phosphor-legacy', signal);
                }
                catch (e) {
                    signal.throwIfAborted();
                    this.log('Nie udało się pobrać Phosphor dla 1.8.9: ' + (e instanceof Error ? e.message : String(e)));
                }
            }
            await promises_1.default.writeFile(node_path_1.default.join(root, 'installed.json'), JSON.stringify({
                build: contracts_1.BUILD,
                minecraft: MC_VERSION,
                loader,
                exerCore: versionMeta?.exerCoreVersion || contracts_1.BUILD,
                installedAt: new Date().toISOString()
            }));
            this.log(legacy ? `Instalacja EXER Core ${contracts_1.BUILD} i Legacy Fabric ${loader} dla Minecraft ${MC_VERSION} zakończona.` : `Instalacja EXER Core ${contracts_1.BUILD}, Fabric ${loader} i Sodium dla Minecraft ${MC_VERSION} zakończona.`);
            await (0, fingerprints_1.saveFingerprints)(node_path_1.default.join(this.cache(), 'fingerprints.json')).catch(() => { });
            this.progress({ phase: 'Gotowy', done: 0, total: 0, busy: false, percent: 100, stage: 'ready' });
        }
        catch (e) {
            this.controller?.abort();
            const msg = e instanceof Error ? e.message : 'Błąd instalacji';
            // The error event is the last one on purpose: a "Gotowy" after it would wipe the error from the UI.
            this.progress({ phase: 'Błąd instalacji', done: 0, total: 0, busy: false, error: msg, stage: 'error' });
            throw e;
        }
        finally {
            this.controller = null;
        }
    }
    async launch(auth, quickPlayServer) {
        if (this.running() || this.busy())
            throw Error('Gra lub instalator już działa.');
        const s = this.settings(), MC_VERSION = s.version;
        const sourceJar = this.clientJar(MC_VERSION);
        if (!await (0, io_1.validFile)(sourceJar)) {
            throw Error(`Wersja Minecraft ${MC_VERSION} nie posiada gotowego modułu EXER Core (${node_path_1.default.basename(sourceJar)}). Uruchomienie zablokowane.`);
        }
        if (!await this.installed())
            await this.install();
        const root = this.instance();
        const hiddenExerJar = await ensureHiddenExerCoreJar(root, sourceJar);
        if (!await (0, io_1.validFile)(hiddenExerJar)) {
            throw Error(`Brak zweryfikowanego pliku EXER Core dla wersji ${MC_VERSION}. Uruchom naprawę instalacji.`);
        }
        const { java, classpath, version, fabric, loggingConfig } = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(root, 'launch.json'), 'utf8'));
        // Versions before 1.13 have one minecraftArguments string and no JVM arguments in their version file.
        const legacy = !version.arguments && typeof version.minecraftArguments === 'string';
        await this.checkJava(java, requiredJavaMajor(MC_VERSION, version));
        const gameJava = await gameJavaExecutable(java);
        // Cosmetics (models, textures, catalog) ship once for every version in
        // exer-cosmetics-<build>.jar next to the per-version client jars.
        const cosmeticsJar = node_path_1.default.join(node_path_1.default.dirname(sourceJar), `exer-cosmetics-${contracts_1.BUILD}.jar`);
        const exerMods = [hiddenExerJar];
        // The UI, emotes and translations live there too: the mod cannot run without it.
        if (!await (0, io_1.validFile)(cosmeticsJar))
            throw Error(`Brak pliku zasobów EXER (${cosmeticsJar}). Uruchom naprawę instalacji launchera.`);
        exerMods.push(cosmeticsJar);
        const effectiveClasspath = [...classpath, ...exerMods];
        const values = {
            natives_directory: node_path_1.default.join(root, 'natives'),
            launcher_name: 'EXER',
            launcher_version: contracts_1.BUILD,
            classpath: effectiveClasspath.join(node_path_1.default.delimiter),
            classpath_separator: node_path_1.default.delimiter,
            library_directory: node_path_1.default.join(root, 'libraries'),
            auth_player_name: auth.account.name,
            version_name: `EXER-${MC_VERSION}`,
            game_directory: root,
            assets_root: node_path_1.default.join(root, 'assets'),
            assets_index_name: version.assetIndex.id,
            auth_uuid: auth.account.id,
            auth_access_token: auth.access,
            clientid: (0, node_crypto_1.randomUUID)(),
            auth_xuid: auth.xuid || '0',
            user_type: legacy || auth.account.kind === 'offline' ? 'mojang' : 'msa',
            user_properties: '{}',
            version_type: 'release',
            resolution_width: String(s.width),
            resolution_height: String(s.height)
        };
        const replace = (v) => v.replace(/\${([^}]+)}/g, (_, key) => { if (!(key in values))
            throw Error('Nieobsługiwany parametr wersji: ' + key); return values[key]; });
        const expand = (args, features) => args.flatMap(v => typeof v === 'string' ? [replace(v)] : (0, io_1.allowedRules)(v.rules, features) ? (Array.isArray(v.value) ? v.value : [v.value]).map(replace) : []);
        const jvm = legacy
            ? [`-Djava.library.path=${values.natives_directory}`, ...(loggingConfig && await (0, io_1.validFile)(loggingConfig) ? [`-Dlog4j.configurationFile=${loggingConfig}`] : []), '-cp', values.classpath]
            : expand([...(version.arguments.jvm || []), ...(fabric.arguments?.jvm || [])], {}).map(v => typeof v === 'string' ? v.trim() : v).filter(Boolean);
        jvm.push(`-Dfabric.addMods=${exerMods.join(node_path_1.default.delimiter)}`);
        const game = legacy
            ? [...String(version.minecraftArguments).split(/\s+/).filter(Boolean).map(replace), '--width', values.resolution_width, '--height', values.resolution_height]
            : expand(version.arguments.game, { has_custom_resolution: true });
        if (s.fullscreen)
            game.push('--fullscreen');
        if (quickPlayServer && /^[-a-zA-Z0-9.:[\]]{1,255}$/.test(quickPlayServer.trim())) {
            const target = quickPlayServer.trim();
            if (legacy) {
                // No Quick Play before 1.20: --server/--port connect after the title screen.
                const m = target.match(/^(\[[^\]]+\]|[^:]+)(?::(\d{1,5}))?$/);
                if (m)
                    game.push('--server', m[1].replace(/^\[|\]$/g, ''), '--port', m[2] || '25565');
            }
            else
                game.push('--quickPlayMultiplayer', target);
        }
        const args = [`-Xmx${s.ram}G`, '-Xms1G', ...s.javaArgs, ...jvm, fabric.mainClass, ...game];
        // A detached game must not retain stdout/stderr pipes owned by Electron: a closed parent would otherwise leave
        // Java writing into broken pipes. Inherit an append-only file instead, then release the parent's descriptor.
        const gameLogDir = node_path_1.default.join(root, 'logs');
        await promises_1.default.mkdir(gameLogDir, { recursive: true });
        const gameLog = await promises_1.default.open(node_path_1.default.join(gameLogDir, 'exer-launcher-game.log'), 'a');
        await gameLog.appendFile(`\n--- EXER launch ${new Date().toISOString()} ---\n`);
        let child;
        try {
            child = (0, node_child_process_1.spawn)(gameJava, args, { cwd: root, windowsHide: false, detached: true, stdio: ['ignore', gameLog.fd, gameLog.fd] });
        }
        catch (e) {
            await gameLog.close();
            throw e;
        }
        this.child = child;
        this.stopRequested = false;
        this.startedAt = Date.now();
        // 'close' also follows a failed spawn (observed: error ENOENT, then close with -4058). A game that never started
        // is not a crash: no crash assistant and no "Minecraft zakończony" that would hide the real error.
        let spawned = false;
        child.once('spawn', () => { spawned = true; });
        child.once('error', e => {
            this.child = null;
            this.log('Błąd uruchamiania: ' + e.message);
            this.progress({ phase: 'Błąd procesu gry', done: 0, total: 0, busy: false, running: false, error: e.message });
        });
        child.once('close', async (code) => {
            this.child = null;
            if (!spawned)
                return;
            void promises_1.default.rm(node_path_1.default.join(root, 'process.json'), { force: true });
            this.log('Minecraft zakończony, kod: ' + code);
            try {
                await this.onExit?.({ code, startedAt: this.startedAt, stopped: this.stopRequested });
            }
            catch { }
            this.progress({ phase: 'Minecraft zakończony', done: 0, total: 0, busy: false, running: false });
        });
        try {
            await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
        }
        finally {
            await gameLog.close();
        }
        child.unref();
        await promises_1.default.writeFile(node_path_1.default.join(root, 'process.json'), JSON.stringify({ pid: child.pid, started: Date.now() }));
        this.progress({ phase: 'Minecraft uruchomiony', done: 0, total: 0, busy: false, running: true });
    }
}
exports.Installer = Installer;
