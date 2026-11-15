"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stageObjects = stageObjects;
exports.obsoleteFiles = obsoleteFiles;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_path_1 = __importDefault(require("node:path"));
const node_zlib_1 = __importDefault(require("node:zlib"));
const promises_1 = require("node:stream/promises");
const node_stream_1 = require("node:stream");
const io_1 = require("./io");
// Electron's patched fs treats *.asar as folders; the update must read and write them as plain files.
const nativeFs = process.versions.electron ? require('original-fs') : require('node:fs');
async function sha256File(file) {
    const hash = node_crypto_1.default.createHash('sha256');
    await (0, promises_1.pipeline)(nativeFs.createReadStream(file), hash);
    return hash.digest('hex');
}
async function listInstalled(root, prefix = '') {
    const entries = await nativeFs.promises.readdir(node_path_1.default.join(root, prefix), { withFileTypes: true });
    const nested = await Promise.all(entries.map(e => {
        const relative = prefix ? `${prefix}/${e.name}` : e.name;
        return e.isDirectory() ? (relative === '_update-stale-backup' ? Promise.resolve([]) : listInstalled(root, relative)) : Promise.resolve([relative]);
    }));
    return nested.flat();
}
async function inflateTo(object, target, file) {
    await nativeFs.promises.mkdir(node_path_1.default.dirname(target), { recursive: true });
    const hash = node_crypto_1.default.createHash('sha256');
    let written = 0;
    const check = new node_stream_1.Transform({ transform(chunk, _, done) {
            written += chunk.length;
            if (written > file.size)
                return done(Error(`Obiekt aktualizacji jest większy niż zapowiedziany: ${file.path}`));
            hash.update(chunk);
            done(null, chunk);
        } });
    await (0, promises_1.pipeline)(nativeFs.createReadStream(object), node_zlib_1.default.createInflateRaw(), check, nativeFs.createWriteStream(target));
    if (written !== file.size || hash.digest('hex') !== file.sha256)
        throw Error(`Niezgodna suma pliku aktualizacji: ${file.path}`);
}
/**
 * Puts into stage only what differs from the installed files: content already on disk under another
 * name is copied, the rest comes from <base><sha256>. The caller installs the stage over root.
 */
async function stageObjects(options) {
    const { files, base, root, stage, cache, signal, progress } = options;
    const wanted = new Set(files.map(f => f.sha256));
    const onDisk = new Map(), installedHash = new Map();
    for (const name of await listInstalled(root)) {
        const hash = await sha256File(node_path_1.default.join(root, name));
        installedHash.set(name.toLowerCase(), hash);
        if (wanted.has(hash) && !onDisk.has(hash))
            onDisk.set(hash, name);
    }
    const changed = files.filter(f => installedHash.get(f.path.toLowerCase()) !== f.sha256);
    const toFetch = changed.filter(f => !onDisk.has(f.sha256));
    const total = toFetch.reduce((sum, f) => sum + f.packed, 0);
    let finished = 0;
    await nativeFs.promises.mkdir(stage, { recursive: true });
    for (const file of changed) {
        signal?.throwIfAborted();
        const target = node_path_1.default.join(stage, ...file.path.split('/'));
        const local = onDisk.get(file.sha256);
        if (local) {
            await nativeFs.promises.mkdir(node_path_1.default.dirname(target), { recursive: true });
            await nativeFs.promises.copyFile(node_path_1.default.join(root, local), target);
            continue;
        }
        const object = node_path_1.default.join(cache, file.sha256);
        await (0, io_1.download)(base + file.sha256, object, { hash: file.packedSha256, algorithm: 'sha256', size: file.packed, signal, progress: done => progress?.(finished + done, total) });
        await inflateTo(object, target, file);
        finished += file.packed;
        progress?.(finished, total);
    }
    return { changed: changed.length, downloaded: total };
}
/** Files of an older release that the update must delete: nothing else ever removes them. */
async function obsoleteFiles(root, files) {
    const keep = new Set(files.map(f => f.path.toLowerCase()));
    const client = await nativeFs.promises.readdir(node_path_1.default.join(root, 'resources', 'client')).catch(() => []);
    const candidates = [...client.map(name => `resources/client/${name}`), 'dxcompiler.dll', 'dxil.dll'];
    const present = await Promise.all(candidates.map(name => nativeFs.promises.access(node_path_1.default.join(root, name)).then(() => name, () => '')));
    return present.filter(name => name && !keep.has(name.toLowerCase()));
}
