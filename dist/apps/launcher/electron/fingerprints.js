"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_FINGERPRINTS = void 0;
exports.getFingerprint = getFingerprint;
exports.setFingerprint = setFingerprint;
exports.invalidateFingerprint = invalidateFingerprint;
exports.clearFingerprints = clearFingerprints;
exports.getFingerprintCacheSize = getFingerprintCacheSize;
exports.loadFingerprints = loadFingerprints;
exports.saveFingerprints = saveFingerprints;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
exports.MAX_FINGERPRINTS = 10000;
const cache = new Map();
let currentCacheFile = null;
let dirty = false;
function normalize(file) {
    try {
        return node_path_1.default.resolve(file).toLowerCase();
    }
    catch {
        return file.toLowerCase();
    }
}
function getFingerprint(file, size, mtimeMs, algorithm = 'sha1') {
    const key = normalize(file);
    const entry = cache.get(key);
    if (!entry)
        return null;
    if (entry.size !== size || entry.mtimeMs !== mtimeMs || entry.algorithm !== algorithm) {
        cache.delete(key);
        dirty = true;
        return null;
    }
    // Refresh LRU order
    cache.delete(key);
    cache.set(key, entry);
    return entry.hash;
}
function setFingerprint(file, size, mtimeMs, hash, algorithm = 'sha1') {
    // Racy write prevention: do not cache files modified within the current millisecond tick (< 50ms)
    if (Date.now() - mtimeMs < 50)
        return;
    const key = normalize(file);
    if (cache.has(key)) {
        cache.delete(key);
    }
    else if (cache.size >= exports.MAX_FINGERPRINTS) {
        const oldest = cache.keys().next().value;
        if (oldest)
            cache.delete(oldest);
    }
    cache.set(key, {
        size,
        mtimeMs,
        hash: hash.toLowerCase(),
        algorithm,
        cachedAt: Date.now()
    });
    dirty = true;
}
function invalidateFingerprint(file) {
    const key = normalize(file);
    if (cache.delete(key)) {
        dirty = true;
    }
}
function clearFingerprints() {
    cache.clear();
    dirty = false;
    currentCacheFile = null;
}
function getFingerprintCacheSize() {
    return cache.size;
}
async function loadFingerprints(cacheFile) {
    currentCacheFile = cacheFile;
    try {
        const content = await promises_1.default.readFile(cacheFile, 'utf8');
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object') {
            cache.clear();
            let count = 0;
            for (const [key, v] of Object.entries(parsed.entries)) {
                if (count >= exports.MAX_FINGERPRINTS)
                    break;
                if (v && typeof v.s === 'number' && typeof v.m === 'number' && typeof v.h === 'string' && typeof v.a === 'string') {
                    cache.set(key, {
                        size: v.s,
                        mtimeMs: v.m,
                        hash: v.h,
                        algorithm: v.a,
                        cachedAt: v.c || Date.now()
                    });
                    count++;
                }
            }
            dirty = false;
        }
    }
    catch {
        // Missing file, corrupt JSON or read error -> safe empty cache fallback
    }
}
async function saveFingerprints(cacheFile = currentCacheFile) {
    if (!cacheFile || !dirty)
        return;
    const dir = node_path_1.default.dirname(cacheFile);
    await promises_1.default.mkdir(dir, { recursive: true });
    const entriesObj = {};
    for (const [key, val] of cache.entries()) {
        entriesObj[key] = {
            s: val.size,
            m: val.mtimeMs,
            h: val.hash,
            a: val.algorithm,
            c: val.cachedAt
        };
    }
    const payload = JSON.stringify({ v: 1, entries: entriesObj });
    const tmp = cacheFile + '.tmp';
    const bak = cacheFile + '.bak';
    await promises_1.default.writeFile(tmp, payload, 'utf8');
    try {
        await promises_1.default.rename(tmp, cacheFile);
    }
    catch (e) {
        if (['EPERM', 'EEXIST'].includes(e?.code)) {
            await promises_1.default.rm(bak, { force: true }).catch(() => { });
            await promises_1.default.rename(cacheFile, bak).catch(() => { });
            try {
                await promises_1.default.rename(tmp, cacheFile);
            }
            catch (err) {
                await promises_1.default.rename(bak, cacheFile).catch(() => { });
                throw err;
            }
            await promises_1.default.rm(bak, { force: true }).catch(() => { });
        }
        else {
            await promises_1.default.rm(tmp, { force: true }).catch(() => { });
            throw e;
        }
    }
    dirty = false;
}
