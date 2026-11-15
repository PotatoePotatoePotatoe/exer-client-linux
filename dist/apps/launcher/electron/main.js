"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = exports.send = exports.resolveClientJar = exports.cacheRoot = exports.dataRoot = void 0;
exports.getSettings = getSettings;
const electron_1 = require("electron");
const node_url_1 = require("node:url");
const cosmetic_assets_1 = require("./cosmetic-assets");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const zod_1 = require("zod");
const spotify_1 = require("./spotify");
const storage_cleanup_1 = require("./storage-cleanup");
const adm_zip_1 = __importDefault(require("adm-zip"));
const node_fs_1 = require("node:fs");
const node_crypto_1 = require("node:crypto");
const contracts_1 = require("../../../packages/shared/src/contracts");
const hardware_1 = require("../../../packages/shared/src/hardware");
const version_manifest_1 = require("../../../packages/shared/src/version-manifest");
const versions_1 = require("./versions");
const auth_1 = require("./auth");
const cosmetics_1 = require("./cosmetics");
const main_1 = require("../../api/src/main");
const installer_1 = require("./installer");
const content_1 = require("./content");
const updates_1 = require("./updates");
const presence_1 = require("./presence");
const performance_1 = require("./performance");
const servers_1 = require("./servers");
const mc_profile_1 = require("./mc-profile");
const crash_1 = require("./crash");
const gallery_1 = require("./gallery");
const identity_1 = require("./identity");
const hardware_id_1 = require("./hardware-id");
const self_update_1 = require("./self-update");
const anticheat_1 = require("./anticheat");
const promises_2 = __importDefault(require("node:dns/promises"));
const mod_scanner_1 = require("./mod-scanner");
electron_1.app.setName('EXER Client');
// Windows remembers the name and icon of the first exe seen with an id. Dev runs of the plain
// electron.exe taught it "Electron" and the atom for pl.exer.client, so dev and release must never share one.
electron_1.app.setAppUserModelId(electron_1.app.isPackaged ? 'pl.exer.launcher' : 'pl.exer.launcher.dev');
const configuredUserData = process.env.EXER_USER_DATA || node_path_1.default.join(electron_1.app.getPath('appData'), 'EXER Client');
electron_1.app.setPath('userData', configuredUserData);
let win;
let logsWin = null;
let settings = contracts_1.SettingsSchema.parse({});
let identity;
/** the launcher really quits (not just hiding its window while the game runs) */
let quitting = false;
let accounts, installer;
let history = [];
let playedAt = {};
let content, updates, presence, auxiliary = null;
let playBusy = false;
let selfUpdate = null;
let updateInstalling = false;
let cosmetics;
let mcProfile;
let localApi = null;
let cosmeticsUrl = '';
function blacklistHost(address) {
    let host = address.trim().toLowerCase();
    if (host.startsWith('[')) {
        const end = host.indexOf(']');
        host = end >= 0 ? host.slice(1, end) : host.slice(1);
    }
    else if (host.indexOf(':') === host.lastIndexOf(':'))
        host = host.split(':', 1)[0];
    while (host.endsWith('.'))
        host = host.slice(0, -1);
    return host;
}
function activeBlacklist(entry) { return !entry.expires || Number.isNaN(Date.parse(entry.expires)) || Date.parse(entry.expires) > Date.now(); }
/** Main-process gate: every launcher path to Quick Play must pass this check. */
async function assertServerIsNotBlacklisted(address) {
    const host = blacklistHost(address);
    const list = await cosmetics.publicGet('/v1/attest/blacklist');
    const entries = Object.entries(list?.servers || {}).filter(([, entry]) => activeBlacklist(entry));
    let ips = [];
    try {
        ips = (await promises_2.default.lookup(host, { all: true })).map(result => blacklistHost(result.address));
    }
    catch { }
    const match = entries.find(([key, entry]) => {
        const blocked = [blacklistHost(key), blacklistHost(entry.host || ''), ...(entry.ips || []).map(blacklistHost)];
        return blocked.includes(host) || ips.some(ip => blocked.includes(ip));
    });
    if (match)
        throw Error('Ten serwer jest zablokowany w sieci EXER: ' + (match[1].reason || 'brak podanego powodu') + '.');
}
async function goOffline() {
    if (!cosmetics || !accounts?.list().activeAccount || !backendStatus.online)
        return;
    await cosmetics.request('POST', '/v1/social/presence', { status: 'offline', server: '', version: settings.version }).catch(() => { });
}
// Last game crash for the crash assistant, and the launcher log tail it falls back to.
let lastCrash = null;
const recentLog = [];
// System tray: the minimize button hides the window (with its taskbar icon) and leaves the EXER icon in the tray;
// a click, a double-click or "Otwórz" brings the window back, "Zakończ" quits the launcher. The tray icon exists
// only while the window is hidden, so normal use keeps the taskbar clean.
let tray = null;
function dropTray() { tray?.destroy(); tray = null; }
function ensureTray() {
    if (tray)
        return;
    try {
        tray = new electron_1.Tray(node_path_1.default.join(electron_1.app.getAppPath(), 'apps/launcher/renderer-dist/exer-logo.png'));
        tray.setToolTip('EXER Client');
        tray.setContextMenu(electron_1.Menu.buildFromTemplate([
            { label: 'Otwórz EXER Client', click: () => showWindow() },
            { type: 'separator' },
            { label: 'Zakończ', click: () => electron_1.app.quit() }
        ]));
        tray.on('click', () => showWindow());
        tray.on('double-click', () => showWindow());
    }
    catch (e) {
        (0, exports.log)('Tray niedostępny: ' + (e instanceof Error ? e.message : String(e)));
    }
}
function hideToTray() { if (!win || win.isDestroyed())
    return; ensureTray(); win.setSkipTaskbar(true); win.hide(); }
function showWindow() {
    if (!win || win.isDestroyed())
        return;
    dropTray();
    win.setSkipTaskbar(false);
    if (win.isMinimized())
        win.restore();
    win.show();
    win.focus();
}
/** Partner servers for the in-game "Serwery partnerskie" screen (config/exer/partners.json). A failure
 * keeps the previous list: the game must start without the EXER API. */
async function writeGamePartners(instance) {
    try {
        const list = await cosmetics.publicGet('/v1/servers/partners');
        if (!Array.isArray(list))
            return;
        const partners = list.filter((p) => p && typeof p.name === 'string' && typeof p.address === 'string').slice(0, 60)
            .map((p) => ({ id: String(p.id || ''), name: String(p.name).slice(0, 40), server: String(p.address).slice(0, 255), description: String(p.description || '').slice(0, 160), color: /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : '#ff8a1f', tags: Array.isArray(p.tags) ? p.tags.slice(0, 4).map(String) : [] }));
        await promises_1.default.mkdir(node_path_1.default.join(instance, 'config', 'exer'), { recursive: true });
        await promises_1.default.writeFile(node_path_1.default.join(instance, 'config', 'exer', 'partners.json'), JSON.stringify({ partners }));
    }
    catch { }
}
/** Pages the game may open in the launcher. */
const LAUNCHER_PAGES = ['Cosmetics', 'Store', 'Skins', 'Capes', 'Outfits', 'Partners', 'Friends', 'Servers', 'Discord'];
// "Join" buttons on Discord open exer://join/<server address>; the launcher asks before it starts the game.
const JOIN_LINK = /^exer:\/\/join\/([-a-zA-Z0-9.:]{3,80})\/?$/i;
let pendingJoin = '';
function joinFrom(argv) {
    const m = argv.map(a => JOIN_LINK.exec(a)).find(Boolean);
    if (!m)
        return;
    pendingJoin = m[1];
    if (win && !win.isDestroyed()) {
        if (win.isMinimized())
            win.restore();
        win.show();
        win.focus();
        (0, exports.send)('join-request', pendingJoin);
    }
}
let backendStatus = { online: false, url: '', mode: 'local' };
let backendCheckedAt = 0; // state() nie blokuje się na weryfikacji API (patrz verifyBackend)
const detectSystemLocale = () => process.env.EXER_SYSTEM_LOCALE || electron_1.app.getLocale() || Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
const userRoot = () => electron_1.app.getPath('userData');
const dataRoot = () => settings.gameDirectory || node_path_1.default.join(userRoot(), 'minecraft');
exports.dataRoot = dataRoot;
const cacheRoot = () => settings.downloadDirectory || process.env.EXER_CACHE_DIR || (process.platform === 'win32'
    ? node_path_1.default.join(process.env.LOCALAPPDATA || node_path_1.default.join(node_os_1.default.homedir(), 'AppData', 'Local'), 'EXER Client', 'cache')
    : node_path_1.default.join(process.env.XDG_CACHE_HOME || node_path_1.default.join(node_os_1.default.homedir(), '.cache'), 'exer-client'));
exports.cacheRoot = cacheRoot;
function findResource(...parts) {
    const c1 = node_path_1.default.join(process.resourcesPath, ...parts);
    if ((0, node_fs_1.existsSync)(c1)) return c1;
    const c2 = node_path_1.default.join(__dirname, '../../../../resources', ...parts);
    if ((0, node_fs_1.existsSync)(c2)) return c2;
    return c1;
}
const resolveClientJar = (versionId = settings.version) => {
    const meta = (0, version_manifest_1.getVersionManifestEntry)(versionId);
    const jarName = meta?.exerCoreJar || (versionId === '1.21.1' ? 'exer-client-0.5.99.jar' : `exer-client-0.5.99-mc${versionId}.jar`);
    return findResource('client', jarName);
};
exports.resolveClientJar = resolveClientJar;
const send = (event, value) => { if (win && !win.isDestroyed())
    win.webContents.send(event, value); };
exports.send = send;
const loggedErrors = new Map();
// Logs window (like Lunar): the launcher log and the running game's logs/latest.log, live, in a window of its own.
const GAME_LOG_TAIL = 256 * 1024;
let gameLog = { file: '', offset: 0, timer: null };
async function gameLogTail() {
    const file = node_path_1.default.join(installer.instance(), 'logs', 'latest.log');
    try {
        const stat = await promises_1.default.stat(file);
        const start = Math.max(0, stat.size - GAME_LOG_TAIL);
        const handle = await promises_1.default.open(file, 'r');
        try {
            const buffer = Buffer.alloc(stat.size - start);
            await handle.read(buffer, 0, buffer.length, start);
            gameLog = { ...gameLog, file, offset: stat.size };
            const lines = buffer.toString('utf8').split(/\r?\n/);
            if (start > 0)
                lines.shift();
            return lines.filter(Boolean).slice(-2000);
        }
        finally {
            await handle.close();
        }
    }
    catch {
        gameLog = { ...gameLog, file, offset: 0 };
        return [];
    }
}
async function pollGameLog() {
    if (!logsWin || logsWin.isDestroyed())
        return;
    const file = node_path_1.default.join(installer.instance(), 'logs', 'latest.log');
    try {
        const stat = await promises_1.default.stat(file);
        // a new game start rewrites latest.log (smaller) or another version was picked: start over
        if (file !== gameLog.file || stat.size < gameLog.offset) {
            logsWin.webContents.send('game-log', { reset: true, lines: await gameLogTail() });
            return;
        }
        if (stat.size === gameLog.offset)
            return;
        const from = Math.max(gameLog.offset, stat.size - GAME_LOG_TAIL), handle = await promises_1.default.open(file, 'r');
        try {
            const buffer = Buffer.alloc(stat.size - from);
            await handle.read(buffer, 0, buffer.length, from);
            gameLog.offset = stat.size;
            const lines = buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
            if (lines.length)
                logsWin.webContents.send('game-log', { reset: false, lines });
        }
        finally {
            await handle.close();
        }
    }
    catch { }
}
function openLogsWindow() {
    if (logsWin && !logsWin.isDestroyed()) {
        if (logsWin.isMinimized())
            logsWin.restore();
        logsWin.focus();
        return;
    }
    logsWin = new electron_1.BrowserWindow({ title: 'EXER Client · Logi', icon: node_path_1.default.join(electron_1.app.getAppPath(), 'apps/launcher/renderer-dist/exer-logo.png'), width: 980, height: 640, minWidth: 640, minHeight: 400, backgroundColor: '#0a0a0c', autoHideMenuBar: true,
        webPreferences: { preload: node_path_1.default.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    logsWin.setMenu(null);
    logsWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    logsWin.webContents.on('will-navigate', e => e.preventDefault());
    const devUrl = !electron_1.app.isPackaged && process.env.EXER_DEV_URL && /^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(process.env.EXER_DEV_URL) ? process.env.EXER_DEV_URL : '';
    void (devUrl ? logsWin.loadURL(devUrl.replace(/\/$/, '') + '/#logs') : logsWin.loadFile(node_path_1.default.join(electron_1.app.getAppPath(), 'apps/launcher/renderer-dist/index.html'), { hash: 'logs' }));
    gameLog.timer = setInterval(() => void pollGameLog(), 700);
    logsWin.on('closed', () => { if (gameLog.timer)
        clearInterval(gameLog.timer); gameLog.timer = null; logsWin = null; });
}
// Anti-cheat while the game runs: every 15 s a memory cheat tool (Cheat Engine…) running next to the game, every
// minute the game's own loaded modules / java agents. A finding restricts the account for 14 days on the API (the
// admin sees it in Ograniczenia dostępu to verify or lift); the game then shows its blacklist screen by itself.
let securityWatch = null;
function watchGameSecurity(instanceDir) {
    if (securityWatch)
        clearInterval(securityWatch);
    let ticks = 0, busy = false, done = false;
    const act = async (_pid, finding) => {
        done = true;
        if (securityWatch) {
            clearInterval(securityWatch);
            securityWatch = null;
        }
        (0, exports.log)('[EXER security] ' + finding.kind + ': ' + finding.detail);
        await cosmetics.request('POST', '/v1/attest/anticheat/restrict-self', finding).catch(error => (0, exports.log)('[EXER security] report failed: ' + String(error)));
        // no kill and no system dialog: EXER Core polls the blacklist every 5 s and shows its block screen in the game
    };
    securityWatch = setInterval(() => void (async () => {
        if (busy || done)
            return;
        busy = true;
        try {
            const pid = await (0, anticheat_1.gamePid)(instanceDir);
            if (!pid || !installer.running()) {
                if (securityWatch) {
                    clearInterval(securityWatch);
                    securityWatch = null;
                }
                return;
            }
            ticks++;
            const tool = (0, anticheat_1.findCheatTool)(await (0, anticheat_1.listRunningProcesses)());
            if (tool) {
                await act(pid, tool);
                return;
            }
            // the module scan needs a loaded game: from 45 s on, once a minute
            if (ticks >= 3 && ticks % 4 === 3) {
                const finding = await (0, anticheat_1.scanRunningGameForAttachment)(pid, instanceDir, exports.log);
                if (finding)
                    await act(pid, finding);
            }
        }
        catch (error) {
            (0, exports.log)('[EXER security] scan failed: ' + String(error));
        }
        finally {
            busy = false;
        }
    })(), 15000);
}
const log = (value) => { const clean = value.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').replace(/(access_token|refresh_token|--accessToken)([\s"=:]+)[^\s",]+/gi, '$1$2[REDACTED]'); (0, exports.send)('log', clean); if (logsWin && !logsWin.isDestroyed())
    logsWin.webContents.send('log', clean); recentLog.push(clean); if (recentLog.length > 400)
    recentLog.splice(0, recentLog.length - 400); const dir = node_path_1.default.join(userRoot(), 'logs'); void promises_1.default.mkdir(dir, { recursive: true }).then(() => promises_1.default.appendFile(node_path_1.default.join(dir, new Date().toISOString().slice(0, 10) + '.log'), clean + '\n')).catch(() => { }); };
exports.log = log;
async function writeJsonAtomic(file, data) {
    const dir = node_path_1.default.dirname(file);
    await promises_1.default.mkdir(dir, { recursive: true });
    const tmp = file + '.tmp';
    const bak = file + '.bak';
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    await promises_1.default.writeFile(tmp, content, 'utf8');
    try {
        await promises_1.default.rename(tmp, file);
    }
    catch (e) {
        if (['EPERM', 'EEXIST'].includes(e?.code)) {
            await promises_1.default.rm(bak, { force: true }).catch(() => { });
            await promises_1.default.rename(file, bak).catch(() => { });
            try {
                await promises_1.default.rename(tmp, file);
            }
            catch (err) {
                await promises_1.default.rename(bak, file).catch(() => { });
                throw err;
            }
            await promises_1.default.rm(bak, { force: true }).catch(() => { });
        }
        else {
            await promises_1.default.rm(tmp, { force: true }).catch(() => { });
            throw e;
        }
    }
}
const save = async () => { await writeJsonAtomic(node_path_1.default.join(userRoot(), 'settings.json'), settings); };
function getSettings() { return settings; }
async function verifyBackendFresh() {
    const url = cosmeticsUrl || settings.apiUrl;
    const mode = localApi ? 'local' : 'remote';
    if (!url)
        return { online: false, url: '', mode };
    const healthUrl = url.replace(/\/$/, '') + '/health';
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await fetch(healthUrl, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
            const body = await res.json().catch(() => null);
            if (res.ok && body?.status === 'ok' && body?.service === 'EXER API')
                return { online: true, url, mode };
        }
        catch { }
        if (attempt < 2)
            await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
    }
    return { online: false, url, mode };
}
async function verifyBackend() {
    const now = Date.now();
    if (now - backendCheckedAt < 20000)
        return backendStatus;
    // Nie blokuj state() na weryfikacji API: odświeżamy status w tle i zwracamy ostatni znany wynik,
    // więc launcher nie zamraża się, gdy API jest niedostępne.
    verifyBackendFresh().then(next => {
        const changed = next.online !== backendStatus.online;
        backendStatus = next;
        if (changed)
            (0, exports.send)('progress', { phase: 'Gotowy', done: 0, total: 0, busy: false });
    }).catch(() => { });
    backendCheckedAt = Date.now();
    return backendStatus;
}
// The PC as the launcher sees it (once per run): memory, cores, the graphics card Chromium uses, and the profile for it.
let hardwareInfo;
async function hardware() {
    if (hardwareInfo)
        return hardwareInfo;
    let gpu = '';
    try {
        const info = await electron_1.app.getGPUInfo('complete');
        const renderer = String(info?.auxAttributes?.glRenderer || '');
        gpu = (0, hardware_1.gpuName)(renderer);
    }
    catch { }
    const cpus = node_os_1.default.cpus();
    const base = { ram: Math.round(node_os_1.default.totalmem() / 1073741824), cores: cpus.length, cpu: (cpus[0]?.model || '').trim().slice(0, 80), gpu, integrated: (0, hardware_1.isIntegrated)(gpu) };
    const pick = (0, hardware_1.recommendProfile)(base);
    hardwareInfo = { ...base, recommended: pick.profile, reason: pick.reason };
    return hardwareInfo;
}
/** FPS of the last game session in a world (written by the EXER mod while it runs). */
async function lastSession() {
    try {
        const s = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(installer.instance(), 'config/exer/session-stats.json'), 'utf8'));
        return typeof s.avg === 'number' && typeof s.low === 'number' && typeof s.samples === 'number' ? { since: Number(s.since) || 0, updated: Number(s.updated) || 0, samples: s.samples, avg: s.avg, low: s.low, profile: String(s.profile || '') } : null;
    }
    catch {
        return null;
    }
}
async function state() {
    const sysLocale = detectSystemLocale();
    const resolvedLanguage = (0, contracts_1.resolveSystemLanguage)(settings.language, sysLocale);
    return {
        settings,
        resolvedLanguage,
        systemLocale: sysLocale,
        ...accounts.list(),
        installed: await installer.installed(),
        running: installer.running(),
        totalRam: Math.floor(node_os_1.default.totalmem() / 1073741824),
        hardware: await hardware(),
        lastSession: installer.running() ? null : await lastSession(),
        root: (0, exports.dataRoot)(),
        appDataRoot: userRoot(),
        cacheRoot: (0, exports.cacheRoot)(),
        history,
        playedAt,
        lastCrash,
        configuration: [],
        cosmeticsAdmin: cosmetics ? await cosmetics.isAdmin() : false,
        backendStatus,
        updateStatus: updates ? updates.status() : undefined
    };
}
let creatorLinks = new Set(), creatorImages = new Set();
const imageCache = new Map();
/** A partner creator's image as a small JPEG data: URL (https PNG/JPEG/WEBP up to 8 MB, scaled to 1280 px), cached
 * for the session. GIFs keep their animation and are passed through when small. */
function creatorImage(url) {
    if (!imageCache.has(url))
        imageCache.set(url, (async () => {
            if (!url.startsWith('https://'))
                return undefined;
            const r = await fetch(url, { signal: AbortSignal.timeout(20000) }).catch(() => null);
            const type = (r?.headers.get('content-type') || '').split(';')[0];
            if (!r?.ok || !/^image\/(png|jpeg|webp|gif)$/.test(type)) {
                imageCache.delete(url);
                return undefined;
            }
            const buf = Buffer.from(await r.arrayBuffer());
            if (buf.length > 8 * 1024 * 1024)
                return undefined;
            if (type === 'image/gif')
                return buf.length <= 2 * 1024 * 1024 ? `data:image/gif;base64,${buf.toString('base64')}` : undefined;
            let img = electron_1.nativeImage.createFromBuffer(buf);
            if (img.isEmpty())
                return undefined;
            if (img.getSize().width > 1280)
                img = img.resize({ width: 1280, quality: 'best' });
            return `data:image/jpeg;base64,${img.toJPEG(84).toString('base64')}`;
        })());
    return imageCache.get(url);
}
/** Puts the launcher's picture of your character into a game instance (its EXER loading screen shows it). */
async function copyPlayerCard(instance) {
    const source = node_path_1.default.join(userRoot(), 'player-card.png'), target = node_path_1.default.join(instance, 'config', 'exer', 'player-card.png');
    await promises_1.default.mkdir(node_path_1.default.dirname(target), { recursive: true });
    await promises_1.default.copyFile(source, target);
}
const READ_ONLY_COMMANDS = new Set([
    'state', 'cancel', 'window', 'logs', 'set-language', 'server-ping', 'modrinth-search', 'catalog-page', 'catalog-project', 'modpack-info',
    'cosmetics', 'cosmetic-starter', 'global-chat-mentions', 'notify-outside', 'player-card', 'global-chat-get', 'chat-moderation-get', 'friends-get', 'messages-get', 'player-profile', 'player-skin', 'partners', 'creators', 'creators-settings', 'creator-image', 'discord-news', 'discord-link',
    'discord-status', 'ranking', 'quests', 'admin-data', 'admin-groups', 'admin-banners', 'admin-banner-image', 'versions', 'mc-profile', 'skin-library', 'gallery', 'gallery-image', 'files', 'launcher-update-status', 'public-stats'
]);
const profileLauncher = zod_1.z.enum(['dawn', 'lunar', 'curseforge', 'modrinth', 'feather', 'minecraft', 'prism', 'custom']);
const launcherScan = zod_1.z.object({ launcher: profileLauncher, folder: zod_1.z.string().max(32767).refine(node_path_1.default.isAbsolute).optional() });
const dawnHudModules = [
    ['fps', 'fps', .004, .008], ['ping', 'ping', .95, .008], ['cps', 'cps', .004, .1],
    ['comboDisplay', 'combo', .004, .19], ['coordinates', 'coordinates', .004, .28],
    ['blockIndicator', 'blockIndicator', .45, .008], ['armorStatus', 'armorStatus', .004, .4],
    ['keystrokes', 'keystrokes', .004, .6], ['potionStatus', 'potionStatus', .85, .3],
    ['reachDisplay', 'reachDisplay', .004, .24], ['playtime', 'playTime', .004, .7],
    ['serverAddress', 'serverAddress', .004, .75], ['time', 'time', .004, .8], ['direction', 'direction', .34, .07],
    ['jumpreset', 'jumpReset', .45, .62], ['tps', 'tps', .004, .3],
];
async function readDawnHud(profile, group) {
    const roots = [node_path_1.default.join(profile, 'private-game-content', 'feather'), node_path_1.default.join(profile, 'feather')];
    if (group && /^[a-z0-9_-]+$/i.test(group)) {
        roots.push(node_path_1.default.join(electron_1.app.getPath('appData'), '.dawn', 'auto-sync', 'groups', group, 'feather'));
    }
    for (const root of roots) {
        const configuration = node_path_1.default.join(root, 'configuration');
        const active = (await promises_1.default.readFile(node_path_1.default.join(configuration, 'current.profile'), 'utf8').catch(() => '')).trim();
        if (!/^[a-z0-9_-]{1,100}$/i.test(active))
            continue;
        const configFile = node_path_1.default.join(configuration, 'profiles', active + '.json');
        const config = await promises_1.default.stat(configFile).then(stat => stat.isFile() && stat.size <= 8 * 1024 * 1024
            ? promises_1.default.readFile(configFile, 'utf8').then(raw => JSON.parse(raw)) : null).catch(() => null);
        if (!config || typeof config !== 'object')
            continue;
        const video = (await promises_1.default.readFile(node_path_1.default.join(root, 'mc_options_v2.txt'), 'utf8').catch(() => '')) + '\n' +
            (await promises_1.default.readFile(node_path_1.default.join(profile, 'private-game-content', 'options.txt'), 'utf8').catch(() => ''));
        const setting = (key) => Number(video.split(/\r?\n/).find(line => line.startsWith(key + ':'))?.split(':')[1]);
        const guiScale = setting('guiScale');
        const width = setting('overrideWidth') / guiScale;
        const height = setting('overrideHeight') / guiScale;
        const number = (value) => typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
        return dawnHudModules.flatMap(([source, id, x, y]) => {
            const module = config[source];
            if (!module || typeof module !== 'object')
                return [];
            const patch = {};
            if ([true, false, 'true', 'false'].includes(module.enabled))
                patch.enabled = module.enabled === true || module.enabled === 'true';
            const scale = number(module.hudScale);
            if (Number.isFinite(scale) && scale > 0)
                patch.scale = clamp(scale, .5, 3);
            const anchor = typeof module.hudAnchor === 'string' ? module.hudAnchor.toLowerCase() : '';
            const dx = number(module.hudRelativeX), dy = number(module.hudRelativeY);
            if (guiScale > 0 && width >= 320 && height >= 240) {
                if (Number.isFinite(dx))
                    patch.x = clamp((anchor.endsWith('right') ? 1 : anchor.endsWith('center') ? .5 : !anchor && dx < 0 ? 1 : 0) + dx / width, 0, .95);
                if (Number.isFinite(dy))
                    patch.y = clamp((anchor.startsWith('bottom') ? 1 : /^(center|middle)/.test(anchor) ? .5 : !anchor && dy < 0 ? 1 : 0) + dy / height, 0, .95);
            }
            return Object.keys(patch).length ? [{ id, x, y, patch }] : [];
        });
    }
    return [];
}
function writeImportedProfile(target, contents, existing) {
    if (contents === existing)
        return;
    const id = (0, node_crypto_1.randomUUID)();
    const temp = target + '.' + id + '.tmp';
    (0, node_fs_1.mkdirSync)(node_path_1.default.dirname(target), { recursive: true });
    try {
        (0, node_fs_1.writeFileSync)(temp, contents, { flag: 'wx' });
        if (existing !== undefined)
            (0, node_fs_1.copyFileSync)(target, target + '.before-import-' + id + '.bak');
        (0, node_fs_1.renameSync)(temp, target);
    }
    finally {
        (0, node_fs_1.rmSync)(temp, { force: true });
    }
}
async function scanLauncherProfiles({ launcher, folder }) {
    const home = electron_1.app.getPath('home');
    const appData = electron_1.app.getPath('appData');
    const roots = {
        dawn: [node_path_1.default.join(appData, '.dawn', 'profiles')],
        lunar: [node_path_1.default.join(home, '.lunarclient', 'profiles'), node_path_1.default.join(home, '.lunarclient', 'offline', 'multiver')],
        curseforge: [node_path_1.default.join(home, 'curseforge', 'minecraft', 'Instances'), node_path_1.default.join(appData, 'CurseForge', 'minecraft', 'Instances')],
        modrinth: [node_path_1.default.join(appData, 'com.modrinth.theseus', 'profiles'), node_path_1.default.join(appData, 'ModrinthApp', 'profiles')],
        feather: [node_path_1.default.join(appData, '.feather', 'profiles')],
        minecraft: [node_path_1.default.join(appData, '.minecraft')],
        prism: [node_path_1.default.join(appData, 'PrismLauncher', 'instances')],
        custom: [],
    }[launcher];
    const profiles = new Map();
    let found = false;
    for (const root of folder ? [folder] : roots) {
        const dirs = await promises_1.default.readdir(root, { withFileTypes: true }).catch(() => null);
        if (!dirs)
            continue;
        found = true;
        for (const profile of [root, ...dirs.filter(entry => entry.isDirectory()).map(entry => node_path_1.default.join(root, entry.name))]) {
            for (const candidate of ['', 'private-game-content', '.minecraft', 'minecraft']) {
                const file = node_path_1.default.join(profile, candidate, 'options.txt');
                const stat = await promises_1.default.lstat(file).catch(() => null);
                if (!stat?.isFile() || stat.size > 1024 * 1024)
                    continue;
                const metadata = launcher === 'dawn' || candidate === 'private-game-content'
                    ? await promises_1.default.readFile(node_path_1.default.join(profile, 'profile.json'), 'utf8').then(raw => JSON.parse(raw)).catch(() => null)
                    : null;
                const group = metadata?.profile?.settings?.autoSyncMembership?.groupId;
                const hud = metadata ? await readDawnHud(profile, typeof group === 'string' ? group : undefined) : undefined;
                profiles.set(file, { file, hud, name: typeof metadata?.profile?.name === 'string' ? metadata.profile.name.slice(0, 120) : node_path_1.default.basename(profile),
                    version: typeof metadata?.profile?.minecraftVersion === 'string' ? metadata.profile.minecraftVersion : undefined });
                break;
            }
        }
    }
    return { found, profiles: [...profiles.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}
const spotifyInput = zod_1.z.union([
    zod_1.z.enum(['open', 'status', 'volume', 'previous', 'next', 'toggle']),
    zod_1.z.object({ volume: zod_1.z.number().int().min(0).max(100) }).strict(),
]);
async function spotifyCommand(action) {
    if (typeof action === 'object')
        return (0, spotify_1.spotify)('volume', action.volume);
    if (action === 'open') {
        await (0, spotify_1.openSpotify)(url => electron_1.shell.openExternal(url));
        return true;
    }
    return (0, spotify_1.spotify)(action);
}
async function command(name, payload) {
    if (auxiliary && !READ_ONLY_COMMANDS.has(name))
        throw Error('Zaczekaj na zakończenie operacji.');
    if (playBusy && !READ_ONLY_COMMANDS.has(name))
        throw Error('Trwa przygotowanie uruchomienia gry.');
    switch (name) {
        case 'state':
            await verifyBackend();
            return state();
        case 'set-language': {
            const lang = contracts_1.LanguagePreferenceSchema.parse(payload);
            settings = { ...settings, language: lang };
            await save();
            await (0, performance_1.configureInstancePerformance)(installer.instance(), settings, detectSystemLocale()).catch(() => { });
            return state();
        }
        case 'cosmetics': {
            const data = await cosmetics.request('GET', '/v1/cosmetics/me');
            void cosmetics.syncGameLoadout(installer.instance(), data).catch(() => { });
            return data;
        }
        case 'cosmetic-starter': {
            const res = await cosmetics.ensureStarterPack();
            await cosmetics.syncGameLoadout(installer.instance());
            return res;
        }
        case 'cosmetic-equip': {
            const parsed = zod_1.z.object({ id: zod_1.z.string().max(40), equipped: zod_1.z.boolean() }).parse(payload);
            const res = await cosmetics.request('POST', '/v1/cosmetics/equip', parsed);
            await cosmetics.syncGameLoadout(installer.instance());
            return res;
        }
        case 'cosmetic-outfit': {
            // One change of the outfit (single item or a whole set): buy what is listed in claim (EXER Coins, the player confirmed
            // the price in the store), take off, put on, then return the new state. Putting on never buys anything by itself.
            // The game files are synced once, in the background.
            const parsed = zod_1.z.object({ equip: zod_1.z.array(zod_1.z.string().max(40)).max(30), unequip: zod_1.z.array(zod_1.z.string().max(40)).max(60), claim: zod_1.z.array(zod_1.z.string().max(40)).max(60).default([]) }).parse(payload);
            const before = await cosmetics.request('GET', '/v1/cosmetics/me');
            // claim: add to the collection without putting on (store "Claim collection").
            for (const id of parsed.claim)
                if (!(before.grants || []).includes(id))
                    await cosmetics.request('POST', '/v1/cosmetics/buy', { id });
            for (const id of parsed.unequip)
                await cosmetics.request('POST', '/v1/cosmetics/equip', { id, equipped: false });
            const owned = new Set([...(before.grants || []), ...parsed.claim]);
            // Admins have effective access to the complete catalog without every item
            // being copied into their persisted grants. Do not silently skip those IDs.
            for (const id of parsed.equip)
                if (before.admin || owned.has(id))
                    await cosmetics.request('POST', '/v1/cosmetics/equip', { id, equipped: true });
            const after = await cosmetics.request('GET', '/v1/cosmetics/me');
            // the game picks this file up within a quarter second; the full sync (service config, attestation) follows in the background
            await cosmetics.writeGameCache(installer.instance(), after).catch(() => { });
            void cosmetics.syncGameLoadout(installer.instance()).catch(() => { });
            return after;
        }
        case 'cosmetic-buy': {
            const parsed = zod_1.z.object({ id: zod_1.z.string().max(40) }).parse(payload);
            const res = await cosmetics.request('POST', '/v1/cosmetics/buy', parsed);
            await cosmetics.syncGameLoadout(installer.instance());
            return res;
        }
        // Friends and chat live on the EXER API (same Minecraft-verified session as cosmetics).
        case 'global-chat-mentions': {
            const q = zod_1.z.object({ room: zod_1.z.enum(['global', 'pl', 'en']).default('global'), after: zod_1.z.number().int().min(0).optional() }).parse(payload);
            return cosmetics.request('GET', `/v1/chat/mentions?room=${q.room}${q.after === undefined ? '' : `&after=${q.after}`}`);
        }
        case 'player-card': {
            // Your character as the launcher shows it: the game's EXER loading screen draws it (config/exer/player-card.png).
            const p = zod_1.z.object({ png: zod_1.z.string().startsWith('data:image/png;base64,').max(4_000_000) }).parse(payload);
            const bytes = Buffer.from(p.png.slice(p.png.indexOf(',') + 1), 'base64');
            if (bytes.length < 64 || bytes.readUInt32BE(0) !== 0x89504e47)
                throw Error('Bad image.');
            {
                const target = node_path_1.default.join(userRoot(), 'player-card.png');
                await promises_1.default.writeFile(target + '.tmp', bytes);
                await promises_1.default.rename(target + '.tmp', target);
            }
            await copyPlayerCard(installer.instance()).catch(() => { });
            return true;
        }
        case 'notify-outside': {
            const p = zod_1.z.object({ title: zod_1.z.string().max(120), text: zod_1.z.string().max(240), kind: zod_1.z.enum(['message', 'friend', 'party', 'mention', 'reward']).optional() }).parse(payload);
            // In game the mod shows it; otherwise Windows does, only when the launcher is not in front.
            if (installer.running()) {
                if (p.kind === 'message')
                    return true;
                const file = node_path_1.default.join(installer.instance(), 'config', 'exer', 'launcher-notice.json');
                await promises_1.default.mkdir(node_path_1.default.dirname(file), { recursive: true });
                await promises_1.default.writeFile(file + '.tmp', JSON.stringify({ id: Date.now(), title: p.title, text: p.text, kind: p.kind || '' }));
                await promises_1.default.rename(file + '.tmp', file);
            }
            else if (win && !win.isDestroyed() && (!win.isVisible() || !win.isFocused()) && electron_1.Notification.isSupported()) {
                const notice = new electron_1.Notification({ title: p.title, body: p.text });
                notice.on('click', showWindow);
                notice.show();
            }
            return true;
        }
        case 'global-chat-get': {
            const q = zod_1.z.object({ room: zod_1.z.enum(['global', 'pl', 'en']).default('global'), after: zod_1.z.number().int().min(0) }).parse(payload);
            return cosmetics.request('GET', `/v1/chat/global?room=${q.room}&after=${q.after}`);
        }
        case 'global-chat-translate': {
            const q = zod_1.z.object({ seqs: zod_1.z.array(zod_1.z.number().int()).max(30), to: zod_1.z.enum(['pl', 'en', 'de', 'es', 'fr', 'uk', 'ru', 'cs']) }).parse(payload);
            return cosmetics.request('POST', '/v1/chat/translate', q);
        }
        case 'chat-moderation-get': return cosmetics.request('GET', '/v1/chat/moderation');
        case 'global-chat': {
            const uuid = zod_1.z.string().regex(/^[0-9a-f]{32}$/), room = zod_1.z.enum(['global', 'pl', 'en']).default('global');
            const p = zod_1.z.discriminatedUnion('action', [
                zod_1.z.object({ action: zod_1.z.literal('send'), room, text: zod_1.z.string().max(400) }),
                zod_1.z.object({ action: zod_1.z.literal('block'), id: uuid, on: zod_1.z.boolean() }),
                zod_1.z.object({ action: zod_1.z.literal('report'), room: room.optional(), seq: zod_1.z.number().int().optional(), id: uuid.optional(), name: zod_1.z.string().max(16).optional(), reason: zod_1.z.string().max(120) }),
                zod_1.z.object({ action: zod_1.z.literal('delete'), room, seq: zod_1.z.number().int() }),
                zod_1.z.object({ action: zod_1.z.literal('mute'), id: uuid, name: zod_1.z.string().max(16), minutes: zod_1.z.number().int().nullable() }),
                zod_1.z.object({ action: zod_1.z.literal('unmute'), id: uuid }),
                zod_1.z.object({ action: zod_1.z.literal('resolve'), id: zod_1.z.string().uuid() })
            ]).parse(payload);
            const { action, ...body } = p;
            const paths = { send: '/v1/chat/global', block: '/v1/chat/block', report: '/v1/chat/report', delete: '/v1/chat/moderation/delete', mute: '/v1/chat/moderation/mute', unmute: '/v1/chat/moderation/unmute', resolve: '/v1/chat/moderation/resolve' };
            return cosmetics.request('POST', paths[action], body);
        }
        case 'voice-ticket': return { ...await cosmetics.request('POST', '/v1/voice/launcher-ticket', {}), url: cosmeticsUrl };
        case 'friends-get': return cosmetics.request('GET', '/v1/social/state');
        case 'friends-add': {
            const name = zod_1.z.string().regex(/^[A-Za-z0-9_]{3,16}$/).parse(payload);
            return cosmetics.request('POST', '/v1/social/request', { name });
        }
        case 'friends-respond': {
            const o = zod_1.z.object({ id: zod_1.z.string().regex(/^[a-f0-9]{32}$/), accept: zod_1.z.boolean() }).parse(payload);
            return cosmetics.request('POST', '/v1/social/respond', o);
        }
        case 'friends-note': return cosmetics.request('POST', '/v1/social/note', { text: zod_1.z.string().max(500).parse(payload) });
        case 'friends-cancel': return cosmetics.request('POST', '/v1/social/cancel', { id: zod_1.z.string().regex(/^[a-f0-9]{32}$/).parse(payload) });
        case 'friends-remove': return cosmetics.request('DELETE', '/v1/social/friends/' + zod_1.z.string().regex(/^[a-f0-9]{32}$/).parse(payload));
        case 'messages-get': return cosmetics.request('GET', '/v1/social/messages/' + zod_1.z.string().regex(/^[a-f0-9]{32}$/).parse(payload));
        // Between friends: gifts, coins, the profile with its skin, the gift notices
        case 'gift-cosmetic': {
            const o = zod_1.z.object({ to: zod_1.z.string().regex(/^[a-f0-9]{32}$/), id: zod_1.z.string().max(40) }).parse(payload);
            return cosmetics.request('POST', '/v1/gifts/cosmetic', o);
        }
        case 'gift-coins': {
            const o = zod_1.z.object({ to: zod_1.z.string().regex(/^[a-f0-9]{32}$/), amount: zod_1.z.number().int().min(1).max(100000) }).parse(payload);
            return cosmetics.request('POST', '/v1/gifts/coins', o);
        }
        case 'player-profile': return cosmetics.request('GET', '/v1/players/' + zod_1.z.string().regex(/^[a-f0-9]{32}$/).parse(payload) + '/profile');
        case 'player-skin': return cosmetics.request('GET', '/v1/players/' + zod_1.z.string().regex(/^[a-f0-9]{32}$/).parse(payload) + '/skin');
        case 'inbox-seen': return cosmetics.request('POST', '/v1/inbox/seen', {});
        case 'messages-send': {
            const o = zod_1.z.object({ id: zod_1.z.string().regex(/^[a-f0-9]{32}$/), text: zod_1.z.string().trim().min(1).max(500) }).parse(payload);
            return cosmetics.request('POST', '/v1/social/messages/' + o.id, { text: o.text });
        }
        case 'partners': return cosmetics.publicGet('/v1/servers/partners');
        // Partner creators: banners are fetched here and handed over as data: URLs (the renderer's CSP blocks other hosts),
        // and only a link from the current list can be opened.
        case 'creators': {
            const list = await cosmetics.publicGet('/v1/creators');
            if (!Array.isArray(list))
                return [];
            const https = (u) => typeof u === 'string' && u.startsWith('https://');
            creatorLinks = new Set(list.flatMap((c) => [c.website, c.discord]).filter(https));
            creatorImages = new Set(list.flatMap((c) => [c.banner, c.avatar, ...(Array.isArray(c.gallery) ? c.gallery : [])]).filter(https));
            // the banner (and avatar) come inline; gallery images are loaded one by one with creator-image
            return Promise.all(list.map(async (c) => ({ ...c, bannerUrl: c.banner, avatarUrl: c.avatar, banner: c.banner ? await creatorImage(c.banner) : undefined, avatar: c.avatar ? await creatorImage(c.avatar) : undefined })));
        }
        case 'creator-image': {
            const url = zod_1.z.string().url().parse(payload);
            if (!creatorImages.has(url))
                throw Error('Nieznany obrazek partnera.');
            return creatorImage(url);
        }
        case 'creator-open': {
            const url = zod_1.z.string().url().parse(payload);
            if (!creatorLinks.has(url))
                throw Error('Nieznany link partnera.');
            await electron_1.shell.openExternal(url);
            return true;
        }
        case 'creators-settings': return cosmetics.publicGet('/v1/creators/settings').catch(() => ({ rotate: 8 }));
        case 'admin-creators-settings': return cosmetics.request('POST', '/v1/admin/creators/settings', payload);
        case 'admin-creator-save': return cosmetics.request('POST', '/v1/admin/creators', payload);
        case 'admin-creator-delete': return cosmetics.request('DELETE', '/v1/admin/creators/' + zod_1.z.string().regex(/^[a-z0-9-]{2,32}$/).parse(payload));
        // Discord: a one-time code for /link on the EXER Discord server.
        case 'discord-code': return cosmetics.request('POST', '/v1/discord/code');
        case 'discord-settings': return cosmetics.request('POST', '/v1/discord/settings', zod_1.z.object({ dm: zod_1.z.boolean() }).parse(payload));
        case 'discord-news': return cosmetics.publicGet('/v1/public/news');
        case 'news-open': {
            await electron_1.shell.openExternal(zod_1.z.string().regex(/^https:\/\/(discord\.com|exerclient\.com)\/[-\w/.?=&]{0,200}$/).parse(payload));
            return true;
        }
        // the address of a Discord "Join" link that arrived before the window was ready
        case 'join-pending': {
            const a = pendingJoin;
            pendingJoin = '';
            return a;
        }
        // Weekly ranking (Rewards page), "share your look" (locker): to Discord, the clipboard or a PNG file
        case 'ranking': return cosmetics.request('GET', '/v1/ranking');
        case 'discord-look': {
            const o = zod_1.z.object({ image: zod_1.z.string().max(6 * 1024 * 1024), caption: zod_1.z.string().trim().max(200).default('') }).parse(payload);
            return cosmetics.request('POST', '/v1/discord/look', o);
        }
        case 'image-copy': {
            const png = Buffer.from(zod_1.z.string().max(12 * 1024 * 1024).parse(payload), 'base64');
            await electron_1.clipboard.write([new electron_1.ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
            return true;
        }
        case 'image-save': {
            const o = zod_1.z.object({ image: zod_1.z.string().max(12 * 1024 * 1024), name: zod_1.z.string().regex(/^[\w .-]{1,60}$/) }).parse(payload);
            const target = await electron_1.dialog.showSaveDialog(win, { defaultPath: node_path_1.default.join(electron_1.app.getPath('pictures'), o.name + '.png'), filters: [{ name: 'PNG', extensions: ['png'] }] });
            if (target.canceled || !target.filePath)
                return false;
            await promises_1.default.writeFile(target.filePath, Buffer.from(o.image, 'base64'));
            return true;
        }
        case 'admin-card-save': return cosmetics.request('POST', '/v1/admin/cards', payload);
        case 'admin-card-delete': return cosmetics.request('DELETE', '/v1/admin/cards/' + zod_1.z.string().regex(/^[a-z0-9-]{1,40}$/).parse(payload));
        case 'gallery-share': {
            const o = zod_1.z.object({ id: zod_1.z.string().max(200), caption: zod_1.z.string().trim().max(200).default('') }).parse(payload);
            const shot = await new gallery_1.Gallery(exports.dataRoot).forShare(o.id);
            return cosmetics.request('POST', '/v1/discord/share', { image: shot.image, caption: o.caption, version: shot.version });
        }
        case 'crash-report': {
            if (!lastCrash)
                throw Error('Nie ma zgłoszenia awarii do wysłania.');
            const c = lastCrash;
            return cosmetics.request('POST', '/v1/discord/crash', { version: c.version, cause: c.cause, detail: c.detail.slice(0, 500), excerpt: c.excerpt.slice(-8000), mods: c.mods });
        }
        case 'discord-link': return cosmetics.request('GET', '/v1/discord/link');
        case 'discord-unlink': {
            const res = await cosmetics.request('POST', '/v1/discord/unlink');
            await cosmetics.syncGameLoadout(installer.instance()).catch(() => { });
            return res;
        }
        case 'discord-open': {
            await electron_1.shell.openExternal('https://discord.gg/exerclient');
            return true;
        }
        case 'blacklist': return cosmetics.publicGet('/v1/attest/blacklist');
        case 'admin-blacklist-amnesty': return cosmetics.request('POST', '/v1/admin/blacklist/amnesty', payload);
        case 'admin-blacklist-player': return cosmetics.request('POST', '/v1/attest/blacklist/player', payload);
        case 'admin-unblacklist-player': return cosmetics.request('DELETE', '/v1/attest/blacklist/player/' + zod_1.z.string().parse(payload));
        case 'admin-blacklist-server': return cosmetics.request('POST', '/v1/attest/blacklist/server', payload);
        case 'admin-unblacklist-server': return cosmetics.request('DELETE', '/v1/attest/blacklist/server/' + zod_1.z.string().parse(payload));
        case 'admin-partner-save': return cosmetics.request('POST', '/v1/admin/partners', payload);
        case 'admin-banners': return cosmetics.request('GET', '/v1/admin/banners');
        case 'admin-banner-image': return cosmetics.asset(zod_1.z.string().regex(/^\/assets\/banners\/[a-z0-9-]{1,80}\.png$/).parse(payload));
        case 'admin-banner-create': return cosmetics.request('POST', '/v1/admin/banners', payload);
        case 'admin-banner-edit': {
            const v = zod_1.z.object({ id: zod_1.z.string().regex(/^[a-f0-9]{12}$/), data: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()) }).parse(payload);
            return cosmetics.request('POST', '/v1/admin/banners/' + v.id + '/edit', v.data);
        }
        case 'admin-banner-review': {
            const v = zod_1.z.object({ id: zod_1.z.string().regex(/^[a-f0-9]{12}$/), action: zod_1.z.enum(['accept', 'reject', 'changes']), reason: zod_1.z.string().max(300).default('') }).parse(payload);
            return cosmetics.request('POST', '/v1/admin/banners/' + v.id + '/review', { action: v.action, reason: v.reason });
        }
        case 'admin-banner-verify': return cosmetics.request('POST', '/v1/admin/banners/' + zod_1.z.string().regex(/^[a-f0-9]{12}$/).parse(payload) + '/verify', {});
        case 'admin-banner-delete': return cosmetics.request('DELETE', '/v1/admin/banners/' + zod_1.z.string().regex(/^[a-f0-9]{12}$/).parse(payload));
        case 'admin-partner-delete': return cosmetics.request('DELETE', '/v1/admin/partners/' + zod_1.z.string().regex(/^[a-z0-9-]{2,32}$/).parse(payload));
        case 'admin-data': return cosmetics.request('GET', '/v1/admin/cosmetics');
        case 'identity-status': return identity.refresh();
        case 'admin-identities': return cosmetics.request('GET', '/v1/admin/identities');
        case 'admin-identity-ban': return cosmetics.request('POST', '/v1/admin/identity/ban', zod_1.z.object({ id: zod_1.z.string().regex(/^[a-f0-9]{64}$/), reason: zod_1.z.string().min(1).max(500), expires: zod_1.z.number().int().positive().nullable() }).strict().parse(payload));
        case 'admin-identity-revoke': return cosmetics.request('POST', '/v1/admin/identity/revoke', zod_1.z.object({ id: zod_1.z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(payload));
        case 'admin-resolve': return cosmetics.request('GET', '/v1/admin/resolve/' + zod_1.z.string().regex(/^[A-Za-z0-9_]{3,16}$/).parse(payload));
        case 'admin-grant': {
            const res = await cosmetics.request('POST', '/v1/admin/grants', payload);
            await cosmetics.syncGameLoadout(installer.instance());
            return res;
        }
        case 'admin-coins': return cosmetics.request('POST', '/v1/admin/coins', payload);
        // Rewards page: tasks and the season pass (a pass level can give a cape: the game files follow in the background)
        case 'quests': return cosmetics.request('GET', '/v1/quests');
        case 'quest-claim': return cosmetics.request('POST', '/v1/quests/claim', zod_1.z.object({ id: zod_1.z.string().max(40) }).parse(payload));
        case 'pass-claim': {
            const res = await cosmetics.request('POST', '/v1/pass/claim', {});
            void cosmetics.syncGameLoadout(installer.instance()).catch(() => { });
            return res;
        }
        case 'admin-event-save': return cosmetics.request('POST', '/v1/admin/events', payload);
        case 'admin-event-delete': return cosmetics.request('DELETE', '/v1/admin/events/' + zod_1.z.string().regex(/^[a-z0-9-]{1,40}$/).parse(payload));
        case 'admin-role': return cosmetics.request('POST', '/v1/admin/admins', payload);
        case 'admin-groups': return cosmetics.request('GET', '/v1/admin/groups');
        case 'admin-group-save': return cosmetics.request('POST', '/v1/admin/groups', payload);
        case 'admin-group-delete': return cosmetics.request('DELETE', '/v1/admin/groups/' + zod_1.z.string().regex(/^[a-z0-9-]{2,32}$/).parse(payload));
        case 'admin-group-assign': return cosmetics.request('POST', '/v1/admin/groups/assign', payload);
        case 'admin-save-cosmetic': return cosmetics.request('POST', '/v1/admin/cosmetics', payload);
        case 'admin-delete-cosmetic': return cosmetics.request('DELETE', '/v1/admin/cosmetics/' + zod_1.z.string().regex(/^[a-z0-9_-]{1,40}$/).parse(payload));
        case 'versions': return (0, versions_1.versions)({ dataRoot: (0, exports.dataRoot)(), resolveClientJar: exports.resolveClientJar });
        case 'complete-onboarding': {
            settings = { ...settings, onboardingCompleted: true };
            await save();
            return state();
        }
        case 'apply-performance-profile': {
            if (installer.busy() || installer.running() || auxiliary || playBusy)
                throw Error('Zamknij grę przed zmianą profilu wydajności.');
            const profile = contracts_1.PerformanceProfileSchema.parse(payload);
            settings = (0, performance_1.applyPresetToSettings)(profile, settings);
            await save();
            await (0, performance_1.configureInstancePerformance)(installer.instance(), settings, detectSystemLocale());
            (0, exports.log)(`Zastosowano profil wydajności EXER: ${profile.toUpperCase()}`);
            return state();
        }
        case 'servers-sync': {
            const list = zod_1.z.array(zod_1.z.object({ name: zod_1.z.string().min(1).max(80), address: zod_1.z.string().regex(/^[-a-zA-Z0-9.:[\]]{1,255}$/) })).max(50).parse(payload);
            const exerDir = node_path_1.default.join(installer.instance(), 'config', 'exer');
            await promises_1.default.mkdir(exerDir, { recursive: true });
            await promises_1.default.writeFile(node_path_1.default.join(exerDir, 'servers.json'), JSON.stringify({ servers: list }, null, 2));
            return { ok: true };
        }
        case 'server-ping': {
            const addresses = zod_1.z.array(zod_1.z.string().min(1).max(255)).max(30).parse(payload);
            return (0, servers_1.pingMinecraftServers)(addresses);
        }
        case 'settings': {
            if (installer.busy() || installer.running() || auxiliary || playBusy)
                throw Error('Zamknij grę i zakończ instalację przed zmianą ustawień.');
            const next = contracts_1.SettingsSchema.parse(payload);
            if (next.updateChannel === 'beta')
                next.updateChannel = 'stable';
            if (next.updateChannel === 'dev') {
                if (next.version !== '1.21.1')
                    throw Error('DEV klienta Minecraft obsługuje obecnie wyłącznie 1.21.1.');
                await cosmetics.updateToken();
            }
            const channelChanged = next.updateChannel !== settings.updateChannel;
            if (next.version !== settings.version && !(await (0, versions_1.versions)({ dataRoot: (0, exports.dataRoot)(), resolveClientJar: exports.resolveClientJar })).some((v) => v.id === next.version))
                throw Error('Wersja nie jest dostępna w oficjalnym katalogu Minecraft.');
            if (next.ram > Math.floor(node_os_1.default.totalmem() / 1073741824) - 1)
                throw Error('Pozostaw co najmniej 1 GB pamięci dla systemu.');
            for (const p of [next.javaPath, next.gameDirectory, next.downloadDirectory])
                if (p && !node_path_1.default.isAbsolute(p))
                    throw Error('Wymagana jest pełna ścieżka.');
            if (next.javaPath)
                await (0, installer_1.validateJavaPath)(next.javaPath);
            next.apiUrl = settings.apiUrl;
            next.clientId = settings.clientId;
            next.discordClientId = settings.discordClientId;
            settings = next;
            await save();
            await (0, performance_1.configureInstancePerformance)(installer.instance(), settings, detectSystemLocale());
            updates.reset();
            await installer.restore();
            await updates.recover();
            if (channelChanged) {
                selfUpdate?.reset();
                void selfUpdate?.check();
                void updates.check().catch(() => { });
            }
            return state();
        }
        case 'choose-profile-file': {
            const selection = await electron_1.dialog.showOpenDialog(win, {
                properties: ['openFile'], filters: [{ name: 'Minecraft profile', extensions: ['dawnpack', 'mrpack', 'lcpack', 'icpack'] }],
            });
            return selection.canceled ? null : selection.filePaths[0];
        }
        case 'scan-launcher-profiles': return scanLauncherProfiles(launcherScan.parse(payload));
        case 'import-profile': {
            const request = zod_1.z.union([
                launcherScan.extend({ profile: zod_1.z.string().max(32767) }),
                zod_1.z.object({ file: zod_1.z.string().max(32767).refine(file => node_path_1.default.isAbsolute(file) && /\.(dawnpack|mrpack|lcpack|icpack)$/i.test(file)) }),
            ]).parse(payload);
            const pl = (0, contracts_1.resolveSystemLanguage)(settings.language, detectSystemLocale()) === 'pl';
            const locked = () => installer.running() || installer.busy() || auxiliary || playBusy;
            const busyMessage = pl ? 'Zamknij grę i zakończ instalację przed importem.' : 'Close the game and finish installation before importing.';
            if (locked())
                throw Error(busyMessage);
            const channel = settings.updateChannel;
            const root = (0, exports.dataRoot)();
            const targets = version_manifest_1.EXER_VERSION_MANIFEST.filter(version => channel !== 'dev' || version.id === '1.21.1');
            const noOptions = pl ? 'Nie znaleziono ustawień Minecrafta do importu.' : 'No Minecraft settings were found to import.';
            let options;
            let sourceVersion;
            let hud = [];
            if ('file' in request) {
                const file = request.file;
                const zip = new adm_zip_1.default(file);
                if (node_path_1.default.extname(file).toLowerCase() === '.mrpack') {
                    const entry = zip.getEntry('modrinth.index.json');
                    if (!entry || entry.header.size > 4 * 1024 * 1024)
                        throw Error(pl ? 'Nieprawidłowy plik .mrpack.' : 'Invalid .mrpack file.');
                    const index = JSON.parse(entry.getData().toString('utf8'));
                    const mcVersion = targets.find(v => v.id === index.dependencies?.minecraft && v.loaderFamily !== 'legacy-fabric')?.id;
                    if (index.game !== 'minecraft' || !mcVersion || !index.dependencies?.['fabric-loader']) {
                        throw Error(pl ? 'Paczka musi używać Fabric i wersji Minecrafta obsługiwanej w tym kanale.' : 'The pack must use Fabric and a Minecraft version supported by this channel.');
                    }
                    const title = node_path_1.default.basename(file, node_path_1.default.extname(file));
                    const confirmation = await electron_1.dialog.showMessageBox(win, {
                        type: 'question', title: pl ? 'Importuj paczkę modów' : 'Import modpack',
                        message: `${title} → EXER ${mcVersion}`,
                        detail: pl ? 'EXER pobierze mody i zapisze kopię zapasową istniejących modów i konfiguracji.' : 'EXER will download mods and back up existing mods and configuration.',
                        buttons: pl ? ['Anuluj', 'Importuj'] : ['Cancel', 'Import'], cancelId: 0, defaultId: 0,
                    });
                    if (confirmation.response !== 1)
                        return null;
                    if (locked() || root !== (0, exports.dataRoot)() || channel !== settings.updateChannel)
                        throw Error(busyMessage);
                    const slug = title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'local-pack';
                    const plan = { id: slug, slug, title, versionId: 'local', versionNumber: String(index.versionId ?? 'local'), mcVersion };
                    playBusy = true;
                    auxiliary = new AbortController();
                    try {
                        if (settings.version !== mcVersion) {
                            settings = { ...settings, version: mcVersion };
                            await save();
                        }
                        const result = await content.installModpack(plan, auxiliary.signal, (phase, done, total) => (0, exports.send)('progress', { phase, done, total, busy: true }), zip);
                        return { packVersion: mcVersion, skipped: result.skipped.length };
                    }
                    finally {
                        playBusy = false;
                        auxiliary = null;
                        (0, exports.send)('progress', { phase: 'Gotowy', done: 0, total: 0, busy: false });
                    }
                }
                const entry = zip.getEntries().find(item => !item.isDirectory &&
                    /^(?:(?:private-game-content|overrides|client-overrides|minecraft|\.minecraft)\/)?options\.txt$/.test(item.entryName));
                if (!entry || entry.header.size > 1024 * 1024)
                    throw Error(noOptions);
                options = entry.getData().toString('utf8');
            }
            else {
                const { profiles } = await scanLauncherProfiles(request);
                const picked = profiles.find(profile => profile.file === request.profile);
                if (!picked)
                    throw Error(noOptions);
                options = await promises_1.default.readFile(picked.file, 'utf8');
                sourceVersion = picked.version;
                hud = picked.hud ?? [];
            }
            if (locked())
                throw Error(busyMessage);
            if (root !== (0, exports.dataRoot)() || channel !== settings.updateChannel) {
                throw Error(pl ? 'Zmieniono katalog gry lub kanał. Ponów import.' : 'The game directory or channel changed. Retry the import.');
            }
            const windowOptions = new Set(['fullscreen', 'overrideWidth', 'overrideHeight', 'pauseOnLostFocus']);
            const modernOptions = new Set([...windowOptions, 'mouseSensitivity', 'invertYMouse', 'autoJump', 'toggleSneak', 'toggleSprint', 'fov', 'gamma']);
            const sourceLines = options.split(/\r?\n/);
            const failed = [];
            let count = 0;
            for (const version of targets) {
                const instance = node_path_1.default.join(root, 'exer-' + version.id + (channel === 'dev' ? '-dev' : ''));
                const target = node_path_1.default.join(instance, 'options.txt');
                try {
                    let existing;
                    try {
                        existing = (0, node_fs_1.readFileSync)(target, 'utf8');
                    }
                    catch (error) {
                        if (error.code !== 'ENOENT')
                            throw error;
                    }
                    const merged = new Map();
                    for (const line of (existing ?? '').split(/\r?\n/)) {
                        const separator = line.indexOf(':');
                        if (separator > 0)
                            merged.set(line.slice(0, separator), line.slice(separator + 1));
                    }
                    const legacy = version.loaderFamily === 'legacy-fabric';
                    const sameVersion = version.id === sourceVersion && !legacy;
                    let compatible = false;
                    for (const line of sourceLines) {
                        const separator = line.indexOf(':');
                        if (separator <= 0)
                            continue;
                        const key = line.slice(0, separator);
                        const value = line.slice(separator + 1);
                        if ((sameVersion && key !== 'version') || windowOptions.has(key) || (!legacy && (modernOptions.has(key) || (/^key_key\.[^.]+$/.test(key) && /^key\.(keyboard|mouse)\./.test(value)) ||
                            /^soundCategory_[a-z]+$/.test(key)))) {
                            merged.set(key, value);
                            compatible = true;
                        }
                    }
                    if (hud.length) {
                        const hudTarget = node_path_1.default.join(instance, 'config', 'exer', 'default.json');
                        let existingHud;
                        try {
                            existingHud = (0, node_fs_1.readFileSync)(hudTarget, 'utf8');
                        }
                        catch (error) {
                            if (error.code !== 'ENOENT')
                                throw error;
                        }
                        const config = existingHud === undefined ? {} : JSON.parse(existingHud);
                        if (!config || typeof config !== 'object' || Array.isArray(config))
                            throw Error('Invalid EXER HUD configuration');
                        config.modules ??= {};
                        for (const { id, x, y, patch } of hud) {
                            if (version.loaderFamily === 'legacy-fabric' && id === 'tps')
                                continue;
                            config.modules[id] = { x, y, enabled: ['fps', 'ping', 'armorStatus'].includes(id), ...config.modules[id], ...patch };
                        }
                        writeImportedProfile(hudTarget, JSON.stringify(config, null, 2) + '\n', existingHud);
                    }
                    if (compatible) {
                        const contents = [...merged].map(([key, value]) => key + ':' + value).join('\n') + '\n';
                        writeImportedProfile(target, contents, existing);
                    }
                    if (compatible || hud.length)
                        count++;
                }
                catch (error) {
                    failed.push(version.id);
                    (0, exports.log)(`Dawn import (${version.id}): ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            if (!count && !failed.length)
                throw Error(noOptions);
            return { count, failed };
        }
        case 'spotify': return spotifyCommand(spotifyInput.parse(payload));
        case 'choose-java': {
            const result = await electron_1.dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Java', extensions: ['exe'] }] });
            return result.canceled ? null : result.filePaths[0];
        }
        case 'choose-directory': {
            const result = await electron_1.dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
            return result.canceled ? null : result.filePaths[0];
        }
        case 'window': {
            const action = zod_1.z.enum(['minimize', 'maximize', 'close']).parse(payload);
            if (action === 'minimize')
                hideToTray();
            if (action === 'maximize')
                win.isMaximized() ? win.unmaximize() : win.maximize();
            if (action === 'close')
                win.close();
            return null;
        }
        case 'login': {
            const offline = zod_1.z.object({ offline: zod_1.z.string() }).safeParse(payload);
            if (offline.success) {
                await cosmetics.disconnect();
                return accounts.addOffline(offline.data.offline);
            }
            await cosmetics.disconnect();
            // EXER's own Azure app (settings, else distribution.json microsoftClientId): sign-in in the player's browser;
            // without one, Microsoft's page opens in a launcher window (the Minecraft Launcher's app id allows nothing else)
            const microsoftClientId = settings.clientId || String((await readDistribution()).microsoftClientId || '');
            const acc = await accounts.login(win, microsoftClientId);
            await cosmetics.ensureStarterPack();
            await cosmetics.syncGameLoadout(installer.instance());
            return acc;
        }
        case 'mc-profile': return mcProfile.get();
        case 'skin-library': return mcProfile.library();
        case 'skin-import': {
            const variant = zod_1.z.enum(['classic', 'slim']).default('classic').parse(payload ?? undefined);
            const result = await electron_1.dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'PNG', extensions: ['png'] }] });
            if (result.canceled || !result.filePaths[0])
                return mcProfile.library();
            const file = result.filePaths[0];
            if ((await promises_1.default.stat(file)).size > 256 * 1024)
                throw Error('Plik skina jest za duży.');
            return mcProfile.add(await promises_1.default.readFile(file), node_path_1.default.basename(file, node_path_1.default.extname(file)), variant);
        }
        case 'skin-save': {
            // The account's current skin (from textures.minecraft.net) saved into the library.
            const o = zod_1.z.object({ url: zod_1.z.string().url(), name: zod_1.z.string().max(32), variant: zod_1.z.enum(['classic', 'slim']) }).parse(payload);
            if (new URL(o.url).hostname !== 'textures.minecraft.net')
                throw Error('Nieprawidłowe źródło skina.');
            const r = await fetch(o.url, { signal: AbortSignal.timeout(20000) });
            if (!r.ok)
                throw Error('Nie udało się pobrać skina.');
            return mcProfile.add(Buffer.from(await r.arrayBuffer()), o.name, o.variant);
        }
        case 'skin-edit': {
            const o = zod_1.z.object({ id: zod_1.z.string().regex(/^[0-9a-f]{40}$/), name: zod_1.z.string().max(32), variant: zod_1.z.enum(['classic', 'slim']) }).parse(payload);
            return mcProfile.update(o.id, o.name, o.variant);
        }
        case 'skin-remove': return mcProfile.remove(zod_1.z.string().regex(/^[0-9a-f]{40}$/).parse(payload));
        case 'skin-apply': {
            if (installer.running())
                throw Error('Zamknij grę przed zmianą skina.');
            const o = zod_1.z.object({ id: zod_1.z.string().regex(/^[0-9a-f]{40}$/), variant: zod_1.z.enum(['classic', 'slim']) }).parse(payload);
            const profile = await mcProfile.setSkin(await mcProfile.file(o.id), o.variant);
            const active = profile.skins.find(s => s.active);
            if (active)
                await accounts.setActiveSkin(active.url);
            return profile;
        }
        case 'cape-set': {
            if (installer.running())
                throw Error('Zamknij grę przed zmianą peleryny.');
            return mcProfile.setCape(zod_1.z.string().max(64).nullable().parse(payload));
        }
        case 'logout':
            await cosmetics.disconnect();
            return accounts.logout(zod_1.z.string().regex(/^[a-f0-9]{32}$/i).parse(payload));
        case 'account': {
            await cosmetics.disconnect();
            await accounts.select(zod_1.z.string().regex(/^[a-f0-9]{32}$/i).parse(payload));
            await cosmetics.ensureStarterPack();
            await cosmetics.syncGameLoadout(installer.instance());
            return null;
        }
        case 'install':
            await (0, performance_1.configureInstancePerformance)(installer.instance(), settings, detectSystemLocale());
            return installer.install();
        case 'repair':
            await installer.install();
            if (settings.version === '1.21.1')
                await updates.repair();
            return null;
        case 'cancel':
            installer.cancel();
            auxiliary?.abort();
            return null;
        case 'stop':
            installer.stop();
            return null;
        case 'gallery': {
            const o = zod_1.z.object({ offset: zod_1.z.number().int().min(0).max(100000).default(0), limit: zod_1.z.number().int().min(1).max(96).default(48), version: zod_1.z.string().regex(/^(all|[0-9a-z.]{1,20})$/i).default('all') }).parse(payload || {});
            return new gallery_1.Gallery(exports.dataRoot).list(o.offset, o.limit, o.version);
        }
        case 'gallery-image': return new gallery_1.Gallery(exports.dataRoot).image(zod_1.z.string().max(200).parse(payload));
        case 'gallery-action': {
            const o = zod_1.z.object({ id: zod_1.z.string().max(200), action: zod_1.z.enum(['reveal', 'copy', 'delete', 'open']) }).parse(payload);
            return new gallery_1.Gallery(exports.dataRoot).action(o.id, o.action);
        }
        case 'discord-status': {
            await presence.update().catch(() => { });
            return presence.status();
        }
        case 'launcher-update-status': return selfUpdate?.get() || { state: 'unsupported', current: electron_1.app.getVersion() };
        case 'public-stats': return cosmetics.publicGet('/v1/public/stats?full=1');
        case 'launcher-update-check': return selfUpdate ? selfUpdate.check() : { state: 'unsupported', current: electron_1.app.getVersion() };
        case 'launcher-update-install': {
            if (!selfUpdate)
                throw Error('Aktualizacja nie jest jeszcze pobrana.');
            if (installer.running() || installer.busy())
                throw Error('Zamknij grę przed aktualizacją launchera.');
            updateInstalling = true;
            try {
                await selfUpdate.install(true);
            }
            catch (e) {
                updateInstalling = false;
                throw e;
            }
            setTimeout(() => electron_1.app.quit(), 300);
            return null;
        }
        case 'crash-dismiss':
            lastCrash = null;
            return null;
        case 'crash-fix': {
            if (installer.running() || installer.busy())
                throw Error('Zamknij grę lub instalator.');
            const o = zod_1.z.object({ fix: zod_1.z.enum(['more-ram', 'disable-mods', 'disable-shaders', 'update-drivers']), mods: zod_1.z.array(zod_1.z.string().regex(/^[a-z0-9_.-]{2,64}$/)).max(20).default([]) }).parse(payload);
            if (o.fix === 'more-ram') {
                const max = Math.max(2, Math.floor(node_os_1.default.totalmem() / 1073741824) - 2);
                if (settings.ram >= max)
                    throw Error('Gra ma już najwięcej pamięci, ile można bezpiecznie dać.');
                settings = { ...settings, ram: Math.min(max, settings.ram + 2) };
                await save();
                return { ram: settings.ram };
            }
            if (o.fix === 'disable-mods')
                return { disabled: await content.disableMods(o.mods) };
            if (o.fix === 'disable-shaders') {
                await content.disableShaders();
                return { shaders: false };
            }
            await electron_1.shell.openExternal('ms-settings:windowsupdate');
            return null;
        }
        case 'play':
        case 'play-server': {
            if (settings.updateChannel === 'dev') {
                if (settings.version !== '1.21.1')
                    throw Error('DEV klienta Minecraft obsługuje obecnie wyłącznie 1.21.1.');
                await cosmetics.updateToken();
            }
            if (playBusy || installer.running() || installer.busy())
                throw Error('Gra lub instalator już działa.');
            playBusy = true;
            try {
                let quickPlayServer;
                if (name === 'play-server') {
                    const parsed = zod_1.z.object({ address: zod_1.z.string().regex(/^[-a-zA-Z0-9.:[\]]{1,255}$/), version: zod_1.z.string().optional() }).parse(payload);
                    quickPlayServer = parsed.address;
                    await assertServerIsNotBlacklisted(quickPlayServer);
                    if (parsed.version && parsed.version !== settings.version) {
                        settings = contracts_1.SettingsSchema.parse({ ...settings, version: parsed.version });
                        await save();
                    }
                }
                if (settings.updateChannel === 'dev' && settings.version !== '1.21.1')
                    throw Error('DEV klienta Minecraft obsługuje obecnie wyłącznie 1.21.1.');
                const launchAuthorization = await accounts.authorization();
                const preparedIdentity = await identity.prepareGame(installer.instance(), launchAuthorization.account);
                if (!await installer.installed())
                    await installer.install();
                if (settings.updateChannel === 'dev') {
                    const result = await updates.check();
                    if (result.error)
                        throw Error(result.error);
                    if (result.available)
                        await updates.apply();
                }
                else if (settings.autoUpdates && settings.version === '1.21.1') {
                    try {
                        const result = await updates.check();
                        if (result.available)
                            await updates.apply();
                    }
                    catch { }
                }
                if (settings.version === '1.21.1') {
                    await updates.verifyActive();
                }
                await content.checkLaunch();
                await (0, performance_1.configureInstancePerformance)(installer.instance(), settings, detectSystemLocale());
                await copyPlayerCard(installer.instance()).catch(() => { });
                await cosmetics.ensureStarterPack();
                const anticheat = await (0, anticheat_1.runAnticheatScan)();
                if (anticheat.warnings && anticheat.warnings.length > 0) {
                    for (const w of anticheat.warnings) {
                        (0, exports.log)('[Antycheat] Ostrzeżenie: ' + w);
                    }
                }
                // No account is restricted before Java starts: only an attachment to the
                // running EXER process is evidence strong enough for the 14-day restriction.
                // Signatures the backend added come on top of the built-in ones; without the API only the built-in ones apply.
                const signatures = (0, mod_scanner_1.mergeSignatures)(await cosmetics.publicGet('/v1/anticheat/signatures').then((r) => r?.mods).catch(() => null));
                const modScan = await (0, mod_scanner_1.runModScan)(installer.instance(), signatures);
                for (const d of modScan.suspicious)
                    (0, exports.log)('[Antycheat] Podejrzany mod / Suspicious mod: ' + node_path_1.default.basename(d.file) + ' — ' + d.reason);
                if (modScan.confirmed.length > 0) {
                    // Evidence goes to the backend for review: no automatic restriction, and nothing is deleted from the mods folder.
                    const evidence = await (0, mod_scanner_1.buildModScanEvidence)(modScan);
                    await cosmetics.request('POST', '/v1/anticheat/mod-report', evidence).catch(() => { });
                    const names = modScan.confirmed.map(d => node_path_1.default.basename(d.file) + ' (' + d.reason + ')').join(', ');
                    throw Error('Wykryto potwierdzone mody cheatujące: ' + names + '. Usuń je z folderu mods (pliki nie zostały usunięte) i uruchom grę ponownie. / Confirmed cheat mods detected: ' + names + '. Remove them from the mods folder (nothing was deleted) and start the game again.');
                }
                try {
                    // a fresh attestation token for every launch: a saved one may have been dropped by the API in the meantime
                    await cosmetics.syncGameLoadout(installer.instance(), undefined, true);
                }
                catch (e) {
                    if (e.blacklisted) {
                        // A blacklisted account must still reach the game so EXER Core can show
                        // the blocking screen and disconnect any server session. Seed the same
                        // validated cache the mod reads; the server remains authoritative and
                        // the attestation token was already removed by attestGame().
                        const account = accounts.list().accounts.find(a => a.id === accounts.list().activeAccount);
                        if (account) {
                            const file = node_path_1.default.join(installer.instance(), 'config', 'exer', 'blacklist.json');
                            let cached = { players: {}, servers: {} };
                            try {
                                cached = JSON.parse(await promises_1.default.readFile(file, 'utf8'));
                            }
                            catch { }
                            cached.players = typeof cached.players === 'object' && cached.players ? cached.players : {};
                            cached.servers = typeof cached.servers === 'object' && cached.servers ? cached.servers : {};
                            cached.players[String(account.id).toLowerCase().replace(/-/g, '')] = { uuid: String(account.id).toLowerCase().replace(/-/g, ''), name: account.name, reason: String(e.reason || 'Konto zablokowane w sieci EXER'), since: new Date().toISOString(), expires: e.expires || null, bannedBy: 'EXER API' };
                            await writeJsonAtomic(file, cached);
                        }
                        (0, exports.log)('Konto jest zablokowane — uruchamiam grę, aby EXER Core wyświetlił ekran blokady.');
                    }
                    else
                        throw e;
                }
                await writeGamePartners(installer.instance());
                await installer.launch(launchAuthorization, quickPlayServer);
                const identityInstance = installer.instance();
                const bindEmotes = async ({ credential }) => {
                    if (credential && launchAuthorization.account)
                        await cosmetics.request('POST', '/v1/identity/emotes/bind', {
                            ...credential, player: launchAuthorization.account.id.toLowerCase().replace(/-/g, ''),
                        });
                };
                void bindEmotes(preparedIdentity).catch(() => { });
                const identityRefresh = setInterval(() => {
                    if (!installer.running()) {
                        clearInterval(identityRefresh);
                        return;
                    }
                    void identity.prepareGame(identityInstance, launchAuthorization.account).then(bindEmotes).catch(() => { });
                }, 10 * 60 * 1000);
                identityRefresh.unref();
                // Java now exists: only an actual attachment to its process can trigger the
                // self-restriction. A standalone Cheat Engine process remains a warning.
                // The scan needs the loaded modules of the real game process, so it runs once the game has finished loading and
                // again later (an injector may arrive after start). Only a finding tied to that process restricts the account.
                const instanceDir = installer.instance();
                watchGameSecurity(instanceDir);
                history = [settings.version, ...history.filter(v => v !== settings.version)].slice(0, 10);
                await writeJsonAtomic(node_path_1.default.join(userRoot(), 'history.json'), history);
                playedAt = { ...playedAt, [settings.version]: new Date().toISOString() };
                await writeJsonAtomic(node_path_1.default.join(userRoot(), 'played-at.json'), playedAt);
                return null;
            }
            finally {
                playBusy = false;
            }
        }
        case 'storage-cleanup': {
            if (installer.running() || installer.busy() || updateInstalling)
                throw Error('Zakończ bieżącą operację lub grę.');
            auxiliary = new AbortController();
            try {
                const result = await (0, storage_cleanup_1.cleanStorage)(userRoot(), (0, exports.dataRoot)());
                try {
                    const session = win.webContents.session;
                    const before = await session.getCacheSize();
                    await session.clearCache();
                    result.bytes += Math.max(0, before - await session.getCacheSize());
                }
                catch {
                    result.skipped++;
                }
                return result;
            }
            finally {
                auxiliary = null;
            }
        }
        case 'logs-window':
            openLogsWindow();
            return null;
        case 'logs-snapshot': return { launcher: recentLog.slice(-400), game: await gameLogTail(), version: settings.version, running: installer.running() };
        case 'folder': {
            const kind = zod_1.z.enum(['mods', 'resourcepacks', 'shaderpacks', 'config', 'logs', 'game-logs', 'crash-reports', 'screenshots']).parse(payload);
            if (kind === 'mods')
                await content.sweepHiddenExerJar();
            const folder = kind === 'logs' ? node_path_1.default.join(userRoot(), 'logs') : kind === 'game-logs' ? node_path_1.default.join(installer.instance(), 'logs') : node_path_1.default.join(installer.instance(), kind);
            await promises_1.default.mkdir(folder, { recursive: true });
            const error = await electron_1.shell.openPath(folder);
            if (error)
                throw Error(error);
            return null;
        }
        case 'files': return content.list(zod_1.z.enum(['mods', 'resourcepacks', 'shaderpacks']).parse(payload));
        case 'import': return content.import(zod_1.z.enum(['mods', 'resourcepacks', 'shaderpacks']).parse(payload), win);
        // OptiFine on 1.8.9: the player brings the official jar; "site" only opens optifine.net (EXER never downloads it)
        case 'optifine': {
            const action = zod_1.z.enum(['status', 'import', 'remove', 'site']).parse(payload);
            if (action === 'status')
                return content.optifineStatus();
            if (action === 'site') {
                await electron_1.shell.openExternal('https://optifine.net/downloads');
                return true;
            }
            if (installer.running() || installer.busy())
                throw Error('Zamknij grę lub instalator.');
            if (action === 'remove')
                return content.optifineRemove();
            auxiliary = new AbortController();
            (0, exports.send)('progress', { phase: 'Trwa dodawanie OptiFine…', done: 0, total: 0, busy: true });
            try {
                return await content.optifineImport(win, auxiliary.signal);
            }
            finally {
                auxiliary = null;
                (0, exports.send)('progress', { phase: 'Gotowy', done: 0, total: 0, busy: false });
            }
        }
        case 'toggle-file':
        case 'remove-file': {
            const { kind, name: file } = zod_1.z.object({ kind: zod_1.z.enum(['mods', 'resourcepacks', 'shaderpacks']), name: zod_1.z.string().min(1).max(240) }).parse(payload);
            return name === 'toggle-file' ? content.toggle(kind, file) : content.remove(kind, file);
        }
        case 'optimizations': return content.catalog();
        case 'modrinth-search': {
            const parsed = zod_1.z.object({
                query: zod_1.z.string().max(120).optional(),
                sort: zod_1.z.enum(['relevance', 'downloads', 'updated']).optional(),
                source: zod_1.z.enum(['all', 'modrinth', 'curseforge']).optional(),
                kind: zod_1.z.enum(['mods', 'resourcepacks', 'shaderpacks']).optional(),
                category: zod_1.z.string().max(40).optional()
            }).optional().parse(payload);
            return content.searchModrinth(parsed?.query || '', parsed?.sort || 'relevance', {
                source: parsed?.source || 'all',
                kind: parsed?.kind || 'mods',
                category: parsed?.category || 'all'
            });
        }
        case 'catalog-page': {
            const o = zod_1.z.object({
                query: zod_1.z.string().max(120).default(''),
                sort: zod_1.z.enum(['relevance', 'downloads', 'updated', 'follows']).default('relevance'),
                kind: zod_1.z.enum(['mods', 'resourcepacks', 'shaderpacks', 'modpacks']).default('mods'),
                category: zod_1.z.string().regex(/^[a-z0-9-]{1,40}$/).default('all'),
                environment: zod_1.z.enum(['all', 'client', 'server']).default('all'),
                openSource: zod_1.z.boolean().default(false),
                source: zod_1.z.enum(['all', 'modrinth', 'curseforge']).default('all'),
                offset: zod_1.z.number().int().min(0).max(10000).default(0),
                limit: zod_1.z.number().int().min(1).max(50).default(20)
            }).parse(payload || {});
            return content.searchPage({ ...o, versions: version_manifest_1.EXER_VERSION_MANIFEST.map(v => v.id) });
        }
        case 'catalog-project': {
            const o = zod_1.z.object({ id: zod_1.z.string().regex(/^[a-zA-Z0-9_-]{2,64}$/), kind: zod_1.z.enum(['mods', 'resourcepacks', 'shaderpacks', 'modpacks']) }).parse(payload);
            return content.project(o.id, o.kind, version_manifest_1.EXER_VERSION_MANIFEST.map(v => v.id));
        }
        case 'open-modrinth': {
            // Only the project's own Modrinth page, built here from a checked slug.
            const o = zod_1.z.object({ slug: zod_1.z.string().regex(/^[a-zA-Z0-9_-]{2,64}$/), kind: zod_1.z.enum(['mods', 'resourcepacks', 'shaderpacks', 'modpacks']) }).parse(payload);
            const type = { mods: 'mod', resourcepacks: 'resourcepack', shaderpacks: 'shader', modpacks: 'modpack' }[o.kind];
            await electron_1.shell.openExternal(`https://modrinth.com/${type}/${o.slug}`);
            return null;
        }
        case 'addons-updates': {
            const kind = zod_1.z.enum(['mods', 'resourcepacks', 'shaderpacks']).parse(payload);
            return content.updates(kind);
        }
        case 'addons-update': {
            if (installer.running() || installer.busy())
                throw Error('Zamknij grę lub instalator.');
            const o = zod_1.z.object({ kind: zod_1.z.enum(['mods', 'resourcepacks', 'shaderpacks']), names: zod_1.z.array(zod_1.z.string().max(255)).max(200) }).parse(payload);
            auxiliary = new AbortController();
            (0, exports.send)('progress', { phase: 'Aktualizowanie dodatków…', done: 0, total: o.names.length, busy: true });
            try {
                return await content.applyUpdates(o.kind, o.names, auxiliary.signal);
            }
            finally {
                auxiliary = null;
                (0, exports.send)('progress', { phase: 'Gotowy', done: 0, total: 0, busy: false });
            }
        }
        case 'modpack-install': {
            if (installer.running() || installer.busy())
                throw Error('Zamknij grę lub instalator.');
            const id = zod_1.z.string().regex(/^[a-zA-Z0-9_-]{2,64}$/).parse(payload);
            const plan = await content.modpackPlan(id, version_manifest_1.EXER_VERSION_MANIFEST.map(v => v.id), settings.version);
            // A modpack lives in the instance of its game version: switch to that version first.
            if (settings.version !== plan.mcVersion) {
                settings = { ...settings, version: plan.mcVersion };
                await save();
            }
            auxiliary = new AbortController();
            try {
                return await content.installModpack(plan, auxiliary.signal, (phase, done, total) => (0, exports.send)('progress', { phase, done, total, busy: true }));
            }
            finally {
                auxiliary = null;
                (0, exports.send)('progress', { phase: 'Gotowy', done: 0, total: 0, busy: false });
            }
        }
        case 'modpack-info': return content.modpackInfo();
        case 'modpack-restore': {
            if (installer.running() || installer.busy())
                throw Error('Zamknij grę lub instalator.');
            return content.restoreModpack();
        }
        case 'install-modrinth':
        case 'install-optimization': {
            if (installer.running() || installer.busy())
                throw Error('Zamknij grę lub instalator.');
            const parsed = zod_1.z.union([
                zod_1.z.string().max(64),
                zod_1.z.object({ slug: zod_1.z.string().max(64), kind: zod_1.z.enum(['mods', 'resourcepacks', 'shaderpacks']).optional(), source: zod_1.z.string().max(32).optional() })
            ]).parse(payload);
            auxiliary = new AbortController();
            (0, exports.send)('progress', { phase: 'Pobieranie moda i zależności…', done: 0, total: 0, busy: true });
            try {
                return await content.installOptimization(parsed, auxiliary.signal);
            }
            finally {
                auxiliary = null;
                (0, exports.send)('progress', { phase: 'Gotowy', done: 0, total: 0, busy: false });
            }
        }
        case 'update-check':
            if (settings.version !== '1.21.1')
                return { available: false, channel: settings.updateChannel, version: '0.4.0', downloaded: false, message: `EXER Core 0.4.0 (${settings.version}) jest aktualny i zsynchronizowany z manifestem wersji.` };
            return updates.check();
        case 'update-download': {
            if (settings.version !== '1.21.1')
                throw Error('Aktualizacje EXER Core dotyczą profilu 1.21.1.');
            if (installer.running() || installer.busy())
                throw Error('Zamknij grę lub instalator.');
            auxiliary = new AbortController();
            (0, exports.send)('progress', { phase: 'Trwa pobieranie aktualizacji w tle…', done: 0, total: 0, busy: true });
            try {
                return await updates.downloadInBackground(auxiliary.signal);
            }
            finally {
                auxiliary = null;
                (0, exports.send)('progress', { phase: 'Gotowy', done: 0, total: 0, busy: false });
            }
        }
        case 'update-apply': {
            if (settings.version !== '1.21.1')
                throw Error('Aktualizacje moda EXER dotyczą profilu 1.21.1.');
            if (installer.running() || installer.busy())
                throw Error('Zamknij grę lub instalator.');
            auxiliary = new AbortController();
            (0, exports.send)('progress', { phase: 'Weryfikowanie i instalowanie aktualizacji…', done: 0, total: 0, busy: true });
            try {
                return await updates.apply(auxiliary.signal);
            }
            finally {
                auxiliary = null;
                (0, exports.send)('progress', { phase: 'Gotowy', done: 0, total: 0, busy: false });
            }
        }
        case 'update-restart': {
            electron_1.app.relaunch();
            electron_1.app.exit(0);
            return null;
        }
        default: throw Error('Ta funkcja nie jest jeszcze dostępna w bieżącym etapie.');
    }
}
// Publisher defaults from distribution.json (apiUrl, discordClientId).
let distributionDiscordId = '';
async function readDistribution() {
    const file = findResource('distribution.json');
    try {
        return JSON.parse(await promises_1.default.readFile(file, 'utf8'));
    }
    catch {
        return {};
    }
}
async function distributionApiUrl() {
    const file = findResource('distribution.json');
    try {
        const url = String(JSON.parse(await promises_1.default.readFile(file, 'utf8')).apiUrl || '');
        return url.startsWith('https://') ? url : '';
    }
    catch {
        return '';
    }
}
async function start() {
    const cosmeticsJar = findResource('client', `exer-cosmetics-${contracts_1.BUILD}.jar`);
    if ((0, node_fs_1.existsSync)(cosmeticsJar)) {
        // Cosmetic meshes, textures and capes come from the game's exer-cosmetics jar (see cosmetic-assets.ts).
        const readCosmetic = (0, cosmetic_assets_1.cosmeticJarReader)(cosmeticsJar);
        electron_1.protocol.handle('file', request => {
            try {
                const hit = readCosmetic((0, node_url_1.fileURLToPath)(request.url));
                if (hit)
                    return new Response(new Uint8Array(hit.body), { headers: { 'content-type': hit.type } });
            }
            catch { }
            return electron_1.net.fetch(request, { bypassCustomProtocolHandlers: true });
        });
    }
    const settingsFile = node_path_1.default.join(userRoot(), 'settings.json');
    await promises_1.default.mkdir(userRoot(), { recursive: true });
    const [rawSettings] = await Promise.all([
        promises_1.default.readFile(settingsFile, 'utf8').catch(async (e) => { if (e?.code !== 'ENOENT')
            return promises_1.default.readFile(settingsFile + '.bak', 'utf8'); throw e; }).catch(() => ''),
        promises_1.default.mkdir(node_path_1.default.join(userRoot(), 'logs'), { recursive: true }),
        promises_1.default.mkdir((0, exports.dataRoot)(), { recursive: true }),
        promises_1.default.mkdir((0, exports.cacheRoot)(), { recursive: true })
    ]);
    try {
        settings = contracts_1.SettingsSchema.parse(JSON.parse(rawSettings));
        // Once: Rich Presence used to be off by default, so almost nobody showed the EXER badge on Discord.
        if (!settings.discordDefaultOn) {
            settings = { ...settings, discord: true, discordDefaultOn: true };
            await save();
        }
    }
    catch {
        await save();
    }
    accounts = new auth_1.Accounts(userRoot());
    identity = new identity_1.DeviceIdentity(userRoot(), () => cosmeticsUrl, undefined, undefined, hardware_id_1.readHardware);
    const distFile = findResource('distribution.json');
    const [distData] = await Promise.all([
        promises_1.default.readFile(distFile, 'utf8').then(data => JSON.parse(data)).catch(() => ({})),
        accounts.load(),
        promises_1.default.readFile(node_path_1.default.join(userRoot(), 'history.json'), 'utf8').then(data => { history = zod_1.z.array(zod_1.z.string().max(30)).max(10).parse(JSON.parse(data)); }).catch(() => { }),
        promises_1.default.readFile(node_path_1.default.join(userRoot(), 'played-at.json'), 'utf8').then(data => { playedAt = zod_1.z.record(zod_1.z.string().max(30), zod_1.z.string().datetime()).parse(JSON.parse(data)); }).catch(() => { })
    ]);
    // Publisher default (packages/manifests/distribution.json): the shared EXER API that
    // servers requiring EXER Client trust. A player's own apiUrl setting takes precedence.
    // npm run dev -- --local (development only): the API built from this source runs inside the launcher, with its own
    // data in <user data>/backend, so features not on the production API yet can be tried.
    const localDev = !electron_1.app.isPackaged && process.env.EXER_LOCAL_API === '1';
    const distApiUrl = String(distData?.apiUrl || '');
    cosmeticsUrl = localDev ? '' : settings.apiUrl || (distApiUrl.startsWith('https://') ? distApiUrl : '');
    if (localDev)
        console.log('[dev] local EXER API (this source), data in ' + node_path_1.default.join(userRoot(), 'backend'));
    distributionDiscordId = /^\d{15,25}$/.test(String(distData?.discordClientId || '')) ? String(distData.discordClientId) : '';
    const releaseKey = async () => { const file = findResource('release-public.pem'); try {
        return await promises_1.default.readFile(file, 'utf8');
    }
    catch {
        return '';
    } };
    if (!cosmeticsUrl) {
        const root = node_path_1.default.join(userRoot(), 'backend');
        await promises_1.default.mkdir(node_path_1.default.join(root, 'artifacts'), { recursive: true });
        localApi = await (0, main_1.createApi)(root, await releaseKey());
        cosmeticsUrl = await localApi.listen({ port: 0, host: '127.0.0.1' });
    }
    backendStatus = await verifyBackendFresh();
    cosmetics = new cosmetics_1.CosmeticsService(accounts, () => cosmeticsUrl, undefined, async (name, serverId) => { await identity.refresh(); return identity.signOffline(name, serverId); }, async () => await identity.credential() ?? (await identity.refresh(), identity.credential()));
    mcProfile = new mc_profile_1.McProfile(async () => (await accounts.authorization()).access, userRoot);
    installer = new installer_1.Installer(getSettings, exports.dataRoot, exports.cacheRoot, exports.resolveClientJar, p => (0, exports.send)('progress', p), exports.log);
    if (accounts.list().activeAccount) {
        void cosmetics.ensureStarterPack().then(() => cosmetics.syncGameLoadout(installer.instance())).catch(() => { });
    }
    installer.onExit = async ({ code, startedAt, stopped }) => {
        void heartbeat();
        void presence?.update().catch(() => { });
        // A crash: non-zero exit that the player did not ask for (a game closed by the launcher's Stop sets stopped).
        // Exit code 0 is a normal quit. The crash assistant brings the window back, even from the tray.
        if (stopped || code === 0)
            return;
        lastCrash = await (0, crash_1.collectCrash)(installer.instance(), settings.version, code, startedAt, recentLog.slice(-300).join('\n'));
        // AMD access violations commonly leave no readable hs_err file and are
        // triggered by an enabled shader pipeline. Put the next launch in a safe
        // graphics state automatically; the player can re-enable shaders later.
        if (lastCrash.cause === 'graphics' || lastCrash.cause === 'shaders') {
            await content.disableShaders().catch(error => (0, exports.log)('[crash] nie udało się wyłączyć shaderów: ' + String(error)));
            (0, exports.log)('[crash] graphics/shader crash detected; shaders disabled for the next launch');
        }
        (0, exports.log)('Asystent awarii: ' + lastCrash.cause + (lastCrash.reportFile ? ' (' + lastCrash.reportFile + ')' : ''));
        showWindow();
    };
    await installer.restore();
    // a game that kept running while the launcher was closed is watched again
    if (installer.running())
        watchGameSecurity(installer.instance());
    await (0, performance_1.configureInstancePerformance)(installer.instance(), settings, detectSystemLocale()).catch(() => { });
    content = new content_1.Content(() => installer.instance(), () => installer.busy() || installer.running(), () => settings.version);
    const fallbackChannel = () => { settings.updateChannel = 'stable'; updates?.reset(); selfUpdate?.reset(); void save(); };
    const updateToken = async () => { try {
        return await cosmetics.updateToken();
    }
    catch (e) {
        fallbackChannel();
        throw e;
    } };
    if (settings.updateChannel === 'beta')
        settings.updateChannel = 'stable';
    if (settings.updateChannel === 'dev')
        await updateToken().catch(() => { });
    updates = new updates_1.Updates(() => installer.instance(), () => settings.apiUrl || cosmeticsUrl, releaseKey, () => settings.updateChannel, p => (0, exports.send)('progress', p), updateToken, fallbackChannel);
    await updates.recover();
    if (settings.autoUpdates && settings.version === '1.21.1') {
        void updates.check().catch(() => { });
    }
    // Launcher self-update: checks the signed manifest on start and every 5 minutes.
    selfUpdate = new self_update_1.SelfUpdate(electron_1.app.getVersion(), node_path_1.default.dirname(process.execPath), electron_1.app.isPackaged, () => cosmeticsUrl, releaseKey, exports.cacheRoot, s => (0, exports.send)('launcher-update', s), exports.log, () => settings.updateChannel, updateToken, fallbackChannel);
    if (process.argv.includes('--update-failed'))
        (0, exports.log)('Aktualizacja launchera nie powiodła się — uruchomiono poprzednią wersję.');
    selfUpdate.start(Math.max(10000, Number(process.env.EXER_UPDATE_INTERVAL_MS) || 5 * 60 * 1000));
    presence = new presence_1.Presence(getSettings, () => installer.instance(), () => installer.running(), () => (0, contracts_1.resolveSystemLanguage)(settings.language, detectSystemLocale()), () => distributionDiscordId);
    // Online status for friends: every 30 s while signed in (in game: version and, unless hidden, the server).
    const heartbeat = async () => {
        if (settings.updateChannel === 'dev')
            await updateToken().catch(() => { });
        if (!accounts.list().activeAccount || !backendStatus.online)
            return;
        let server = '';
        if (installer.running() && !settings.hideServer) {
            try {
                const p = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(installer.instance(), 'config/exer/presence.json'), 'utf8'));
                if (p.state === 'multiplayer' && typeof p.server === 'string' && /^[-a-zA-Z0-9.:]{1,80}$/.test(p.server))
                    server = p.server;
            }
            catch { }
        }
        await cosmetics.request('POST', '/v1/social/presence', { status: installer.running() ? 'in-game' : 'online', server, version: settings.version }).catch(() => { });
    };
    setInterval(() => void heartbeat(), 30000);
    void heartbeat();
    win = new electron_1.BrowserWindow({
        title: 'EXER Client',
        icon: node_path_1.default.join(electron_1.app.getAppPath(), 'apps/launcher/renderer-dist/exer-logo.png'),
        width: 1320, height: 840, minWidth: 1024, minHeight: 700, frame: false, backgroundColor: '#0c0d10',
        webPreferences: { preload: node_path_1.default.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    // Closing the window (X) quits the launcher for real, also while Minecraft runs: the game was spawned detached
    // (installer.ts) and survives its parent; before-quit never kills the game process. A restarted launcher re-attaches
    // to it through process.json (Installer.restore()) and refuses to kill it (Installer.stop() throws instead).
    // The window button "minimize" goes to the tray instead (case 'window' → hideToTray()).
    win.on('close', () => {
        if (quitting || !installer.running())
            return;
        (0, exports.log)('Zamknięcie launchera podczas gry: gra działa dalej jako odłączony proces.');
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', e => e.preventDefault());
    electron_1.ipcMain.handle('exer', async (event, name, payload) => {
        const fromLogs = logsWin && !logsWin.isDestroyed() && event.sender === logsWin.webContents && event.senderFrame === logsWin.webContents.mainFrame;
        if (fromLogs) {
            if (!['logs-snapshot', 'folder'].includes(String(name)))
                throw Error('Niedozwolony nadawca IPC.');
        }
        else if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
            throw Error('Niedozwolony nadawca IPC.');
        try {
            return await command(zod_1.z.string().max(40).parse(name), payload);
        }
        catch (e) {
            if (e && typeof e === 'object' && 'blacklisted' in e && e.blacklisted) {
                throw e;
            }
            const message = e instanceof zod_1.z.ZodError ? `Nieprawidłowe dane wejściowe: ${e.issues.map(i => i.path.join('.') || i.code).join(', ')}` : e instanceof Error ? e.message : 'Operacja nie powiodła się.';
            // the same error from a polling page (cosmetics, friends) is logged once a minute, not on every retry
            const now = Date.now();
            if (loggedErrors.get(message) !== undefined && now - loggedErrors.get(message) < 60000) {
                throw Error(message);
            }
            loggedErrors.set(message, now);
            if (loggedErrors.size > 50)
                loggedErrors.delete(loggedErrors.keys().next().value);
            (0, exports.log)(message);
            throw Error(message);
        }
    });
    // npm run dev (scripts/dev.cjs): the page comes from the Vite dev server, so renderer changes show at once.
    const devUrl = !electron_1.app.isPackaged && process.env.EXER_DEV_URL && /^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(process.env.EXER_DEV_URL) ? process.env.EXER_DEV_URL : '';
    if (devUrl)
        await win.loadURL(devUrl);
    else
        await win.loadFile(node_path_1.default.join(electron_1.app.getAppPath(), 'apps/launcher/renderer-dist/index.html'));
    void cosmetics.request('POST', '/v1/public/launch', {}).catch(() => { });
    // The EXER mod asks for a launcher page (Cosmetics, Store...) by writing config/exer/launcher-request.json;
    // the launcher comes to the front on that page.
    let lastRequest = Date.now();
    let wasRunning = false;
    setInterval(async () => {
        const running = installer.running();
        if (wasRunning && !running) {
            (0, exports.send)('progress', { phase: 'Minecraft zakończony', done: 0, total: 0, busy: false, running: false });
        }
        wasRunning = running;
        if (!running || !win || win.isDestroyed())
            return;
        const file = node_path_1.default.join(installer.instance(), 'config/exer/launcher-request.json');
        let request;
        try {
            request = JSON.parse(await promises_1.default.readFile(file, 'utf8'));
        }
        catch {
            return;
        }
        await promises_1.default.rm(file, { force: true }).catch(() => { });
        if (!request || typeof request.at !== 'number' || request.at <= lastRequest || request.at < Date.now() - 15000)
            return;
        lastRequest = request.at;
        const page = LAUNCHER_PAGES.includes(request.page) ? request.page : 'Cosmetics';
        showWindow();
        win.setAlwaysOnTop(true);
        win.focus();
        win.setAlwaysOnTop(false);
        (0, exports.send)('navigate', page);
    }, 1000);
    let spotifyBusy = false, spotifyRequestAt = Date.now(), spotifyStatusAt = 0;
    setInterval(async () => {
        if (spotifyBusy || !installer.running())
            return;
        spotifyBusy = true;
        const folder = node_path_1.default.join(installer.instance(), 'config', 'exer');
        try {
            const request = await promises_1.default.readFile(node_path_1.default.join(folder, 'spotify-request.json'), 'utf8').then(raw => zod_1.z.object({ at: zod_1.z.number(), action: spotifyInput }).parse(JSON.parse(raw))).catch(() => null);
            const now = Date.now();
            if (request && request.at > spotifyRequestAt && Math.abs(now - request.at) < 15000) {
                spotifyRequestAt = request.at;
                const command = spotifyCommand(request.action).catch(() => null);
                // Windows can stall opening an external application. Keep publishing the in-game track.
                if (request.action !== 'open')
                    await command;
                spotifyStatusAt = 0;
            }
            if (now - spotifyStatusAt < 1000)
                return;
            spotifyStatusAt = now;
            const track = await (0, spotify_1.spotify)('status').catch(() => null);
            const volume = track ? await (0, spotify_1.spotify)('volume').catch(() => -1) : -1;
            const file = node_path_1.default.join(folder, 'spotify-state.json');
            const temp = file + '.tmp';
            await promises_1.default.writeFile(temp, JSON.stringify({ at: Date.now(), title: track?.title, artist: track?.artist, art: track?.art, playing: track?.playing,
                previous: track?.previous, next: track?.next, toggle: track?.toggle, position: track?.position, duration: track?.duration, volume }));
            await promises_1.default.rename(temp, file);
        }
        catch { }
        finally {
            spotifyBusy = false;
        }
    }, 1000).unref();
    if (process.env.EXER_SMOKE_TEST === '1') {
        await verifyBackend();
        const smokeState = await state();
        await promises_1.default.writeFile(node_path_1.default.join(userRoot(), 'smoke-ready.json'), JSON.stringify({
            ok: true,
            language: smokeState.settings.language,
            resolvedLanguage: smokeState.resolvedLanguage,
            systemLocale: smokeState.systemLocale,
            appDataRoot: smokeState.appDataRoot,
            minecraftRoot: smokeState.root,
            cacheRoot: smokeState.cacheRoot,
            backendStatus: smokeState.backendStatus,
            version: smokeState.settings.version
        }, null, 2));
        setTimeout(() => electron_1.app.quit(), 800);
    }
}
try {
    const saved = JSON.parse(require('node:fs').readFileSync(node_path_1.default.join(electron_1.app.getPath('userData'), 'settings.json'), 'utf8'));
    if (saved.hardwareAcceleration === false)
        electron_1.app.disableHardwareAcceleration();
}
catch { }
if (!electron_1.app.requestSingleInstanceLock())
    electron_1.app.quit();
else
    electron_1.app.whenReady().then(start).catch(e => { electron_1.dialog.showErrorBox('EXER Client — błąd startu', e.message); electron_1.app.quit(); });
electron_1.app.on('second-instance', (_event, argv) => { showWindow(); joinFrom(argv); });
// exer:// links (Discord "Join" buttons) open the installed launcher; a development run does not take them over.
if (electron_1.app.isPackaged)
    electron_1.app.setAsDefaultProtocolClient('exer');
joinFrom(process.argv);
electron_1.app.on('window-all-closed', () => electron_1.app.quit());
electron_1.app.on('before-quit', event => {
    quitting = true;
    dropTray();
    // A downloaded update installs when the launcher closes, even without clicking Restart.
    // Quitting waits until the helper is started, then continues.
    if (selfUpdate?.get().state === 'ready' && !updateInstalling && !installer?.running()) {
        updateInstalling = true;
        event.preventDefault();
        void selfUpdate.install(false).catch(() => { }).finally(() => electron_1.app.quit());
        return;
    }
    void goOffline();
    installer?.cancel();
    auxiliary?.abort();
    presence?.close();
    void localApi?.close();
});
