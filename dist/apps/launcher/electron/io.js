"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IDLE_MS = void 0;
exports.safePath = safePath;
exports.hashFile = hashFile;
exports.validFile = validFile;
exports.getJSON = getJSON;
exports.download = download;
exports.extractZip = extractZip;
exports.allowedRules = allowedRules;
exports.postJSON = postJSON;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_stream_1 = require("node:stream");
const promises_2 = require("node:stream/promises");
const adm_zip_1 = __importDefault(require("adm-zip"));
const fingerprints_1 = require("./fingerprints");
function safePath(root, relative) { if (!relative || node_path_1.default.isAbsolute(relative) || /[\x00-\x1f:]/.test(relative) || relative.includes('\\') || relative.split('/').some(p => p === '..' || p === '.' || !p || /[. ]$/.test(p) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p)))
    throw Error('Niebezpieczna ścieżka pliku.'); const target = node_path_1.default.resolve(root, relative); if (!target.toLowerCase().startsWith(node_path_1.default.resolve(root).toLowerCase() + node_path_1.default.sep))
    throw Error('Ścieżka poza instancją.'); return target; }
async function hashFile(file, algorithm = 'sha256') { const h = node_crypto_1.default.createHash(algorithm); for await (const chunk of (0, node_fs_1.createReadStream)(file))
    h.update(chunk); return h.digest('hex'); }
async function validFile(file, hash, algorithm = 'sha1', size) { try {
    const stat = await promises_1.default.stat(file);
    if (!stat.isFile())
        return false;
    if (size !== undefined && stat.size !== size) {
        (0, fingerprints_1.invalidateFingerprint)(file);
        return false;
    }
    if (!hash)
        return true;
    const lower = hash.toLowerCase();
    const cached = (0, fingerprints_1.getFingerprint)(file, stat.size, stat.mtimeMs, algorithm);
    if (cached)
        return cached === lower;
    const actual = await hashFile(file, algorithm);
    if (actual === lower) {
        (0, fingerprints_1.setFingerprint)(file, stat.size, stat.mtimeMs, actual, algorithm);
        return true;
    }
    (0, fingerprints_1.invalidateFingerprint)(file);
    return false;
}
catch {
    return false;
} }
async function getJSON(url, options) {
    const signal = options instanceof AbortSignal ? options : options?.signal;
    const headers = (options && !(options instanceof AbortSignal)) ? options.headers : undefined;
    const r = await fetch(url, { headers, redirect: headers?.Authorization ? 'error' : 'follow', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    if (!r.ok)
        throw Error(`HTTP ${r.status}: ${new URL(url).hostname}`);
    return r.json();
}
/** No data for this long (connecting or mid-file) ends an attempt. There is no limit on the whole file: a large update
 * on a slow connection takes as long as it takes. */
exports.IDLE_MS = 60000;
/** Downloads to <file>.part and renames after the size/hash check. A broken attempt keeps the part file and the next one
 * resumes it with a Range request (servers without ranges send the whole file again). */
async function download(url, file, options = {}) {
    if (await validFile(file, options.hash, options.algorithm, options.size))
        return;
    if (!(new URL(url).protocol === 'https:' || (new URL(url).protocol === 'http:' && new URL(url).hostname === '127.0.0.1')))
        throw Error('Pobieranie wymaga HTTPS.');
    await promises_1.default.mkdir(node_path_1.default.dirname(file), { recursive: true });
    const tmp = file + '.part', idleMs = options.idleMs ?? exports.IDLE_MS;
    let last, stalled = 0;
    for (let attempt = 0; attempt < 8 && stalled < 3; attempt++) {
        options.signal?.throwIfAborted();
        let start = await promises_1.default.stat(tmp).then(s => s.size).catch(() => 0);
        if (options.size !== undefined && start > options.size) {
            await promises_1.default.rm(tmp, { force: true });
            start = 0;
        }
        const before = start;
        // aborts when nothing arrives for idleMs; every received chunk resets the timer
        const idle = new AbortController();
        let timer;
        const poke = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(Error('Pobieranie stoi: brak danych od ' + Math.round(idleMs / 1000) + ' s.')), idleMs); };
        const signal = options.signal ? AbortSignal.any([options.signal, idle.signal]) : idle.signal;
        let done = start;
        try {
            poke();
            let current = url, response;
            for (let redirect = 0; redirect < 8; redirect++) {
                const reqHeaders = { ...(options.headers || {}) };
                if (start > 0)
                    reqHeaders['range'] = `bytes=${start}-`;
                response = await fetch(current, { redirect: 'manual', signal, headers: reqHeaders });
                if ([301, 302, 303, 307, 308].includes(response.status)) {
                    if (options.headers?.Authorization)
                        throw Error('Przekierowanie prywatnego pobierania jest niedozwolone.');
                    current = new URL(response.headers.get('location') || '', current).href;
                    if (!(new URL(current).protocol === 'https:' || (new URL(current).protocol === 'http:' && new URL(current).hostname === '127.0.0.1')))
                        throw Error('Niezabezpieczone przekierowanie.');
                    await response.body?.cancel();
                    continue;
                }
                break;
            }
            if (start > 0 && response?.status === 416) {
                await response.body?.cancel();
                await promises_1.default.rm(tmp, { force: true });
                throw Error('Nieprawidłowy fragment pobierania.');
            }
            if (!response?.ok || !response.body)
                throw Error(`Pobieranie nie powiodło się: ${new URL(url).hostname}`);
            // 200 instead of 206: the server sends the whole file, start the part file again
            if (start > 0 && response.status !== 206) {
                start = 0;
                done = 0;
            }
            const total = options.size || (start + Number(response.headers.get('content-length'))) || 0;
            const meter = new node_stream_1.Transform({ transform(chunk, _, callback) { poke(); done += chunk.length; if (options.size !== undefined && done > options.size) {
                    callback(Error('Plik większy od manifestu.'));
                    return;
                } options.progress?.(done, total); callback(null, chunk); } });
            await (0, promises_2.pipeline)(node_stream_1.Readable.fromWeb(response.body), meter, (0, node_fs_1.createWriteStream)(tmp, { flags: start > 0 ? 'a' : 'w' }), { signal });
            clearTimeout(timer);
            if (!await validFile(tmp, options.hash, options.algorithm, options.size)) {
                await promises_1.default.rm(tmp, { force: true });
                throw Error('Nieprawidłowa suma kontrolna pobranego pliku.');
            }
            await promises_1.default.rename(tmp, file);
            if (options.hash) {
                try {
                    const stat = await promises_1.default.stat(file);
                    (0, fingerprints_1.setFingerprint)(file, stat.size, stat.mtimeMs, options.hash.toLowerCase(), options.algorithm || 'sha1');
                }
                catch { }
            }
            return;
        }
        catch (e) {
            clearTimeout(timer);
            last = idle.signal.aborted ? idle.signal.reason : e;
            if (options.signal?.aborted)
                throw e;
            // attempts that got nothing count towards giving up; progress keeps it going
            const now = await promises_1.default.stat(tmp).then(s => s.size).catch(() => 0);
            stalled = now > before ? 0 : stalled + 1;
            await new Promise(r => setTimeout(r, 350 * (stalled + 1)));
        }
    }
    throw last;
}
async function extractZip(file, destination, filter = () => true) { const zip = new adm_zip_1.default(file); let total = 0; for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !filter(entry.entryName))
        continue;
    const mode = (entry.attr >>> 16) & 0xf000;
    if (mode === 0xa000)
        throw Error('Linki symboliczne w archiwum są niedozwolone.');
    total += entry.header.size;
    if (total > 2 * 1024 ** 3)
        throw Error('Archiwum przekracza limit.');
    const target = safePath(destination, entry.entryName);
    await promises_1.default.mkdir(node_path_1.default.dirname(target), { recursive: true });
    await promises_1.default.writeFile(target, entry.getData());
} }
function allowedRules(rules, features = {}) { if (!rules)
    return true; let result = false;
    const currentOs = process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'osx' : 'linux');
    for (const rule of rules) {
    if (rule.os?.name && rule.os.name !== currentOs)
        continue;
    if (rule.os?.arch && rule.os.arch !== 'x86_64' && rule.os.arch !== 'amd64' && rule.os.arch !== 'x64')
        continue;
    if (rule.os?.version && !new RegExp(rule.os.version).test(require('node:os').release()))
        continue;
    if (rule.features && Object.entries(rule.features).some(([key, value]) => (features[key] || false) !== value))
        continue;
    result = rule.action === 'allow';
} return result; }
async function postJSON(url, body, signal) { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) }); if (!r.ok)
    throw Error(`HTTP ${r.status}: ${new URL(url).hostname}`); return r.json(); }
