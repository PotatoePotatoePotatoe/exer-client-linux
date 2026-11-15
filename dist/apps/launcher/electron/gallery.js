"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Gallery = void 0;
exports.clearGalleryThumbCache = clearGalleryThumbCache;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const electron_1 = require("electron");
const ID = /^exer-[0-9a-z.]{1,20}\/screenshots\/[^/\\]{1,120}\.png$/i;
const thumbCache = new Map();
function clearGalleryThumbCache(id) {
    if (id)
        thumbCache.delete(id);
    else
        thumbCache.clear();
}
/** Quickly extracts PNG width and height from the 24-byte IHDR header without decoding pixels. */
async function readPngDimensions(filePath) {
    let fh = null;
    try {
        fh = await promises_1.default.open(filePath, 'r');
        const buf = Buffer.alloc(24);
        const { bytesRead } = await fh.read(buf, 0, 24, 0);
        if (bytesRead >= 24 &&
            buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
            buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a &&
            buf.toString('ascii', 12, 16) === 'IHDR') {
            const width = buf.readUInt32BE(16);
            const height = buf.readUInt32BE(20);
            if (width > 0 && height > 0)
                return { width, height };
        }
    }
    catch {
    }
    finally {
        await fh?.close().catch(() => { });
    }
    return null;
}
/** Asynchronously creates a JPEG thumbnail without blocking the main event loop. */
async function createThumbnailAsync(filePath, dims) {
    if (typeof electron_1.nativeImage.createThumbnailFromPath === 'function') {
        try {
            const thumbNative = await electron_1.nativeImage.createThumbnailFromPath(filePath, { width: 360, height: 360 });
            if (thumbNative && !thumbNative.isEmpty()) {
                const thumbSize = thumbNative.getSize();
                const width = dims?.width || thumbSize.width;
                const height = dims?.height || thumbSize.height;
                const thumb = 'data:image/jpeg;base64,' + thumbNative.toJPEG(78).toString('base64');
                return { thumb, width, height };
            }
        }
        catch { }
    }
    await new Promise(resolve => setImmediate(resolve));
    try {
        const img = electron_1.nativeImage.createFromPath(filePath);
        if (img.isEmpty())
            return null;
        const size = img.getSize();
        const width = dims?.width || size.width;
        const height = dims?.height || size.height;
        const thumb = 'data:image/jpeg;base64,' + img.resize({ width: 360, quality: 'good' }).toJPEG(78).toString('base64');
        return { thumb, width, height };
    }
    catch {
        return null;
    }
}
class Gallery {
    root;
    constructor(root) {
        this.root = root;
    }
    file(id) {
        if (!ID.test(id) || id.includes('..'))
            throw Error('Nie ma takiego zrzutu ekranu.');
        return node_path_1.default.join(this.root(), ...id.split('/'));
    }
    async list(offset = 0, limit = 48, version = 'all') {
        const all = [];
        const versions = [];
        for (const dir of await promises_1.default.readdir(this.root()).catch(() => [])) {
            const m = /^exer-([0-9a-z.]{1,20})$/i.exec(dir);
            if (!m)
                continue;
            const shots = node_path_1.default.join(this.root(), dir, 'screenshots');
            const names = (await promises_1.default.readdir(shots).catch(() => [])).filter(n => /\.png$/i.test(n));
            if (names.length)
                versions.push(m[1]);
            if (version !== 'all' && version !== m[1])
                continue;
            for (const name of names) {
                try {
                    const st = await promises_1.default.stat(node_path_1.default.join(shots, name));
                    all.push({ id: `${dir}/screenshots/${name}`, name, version: m[1], mtime: st.mtimeMs, size: st.size });
                }
                catch { }
            }
        }
        all.sort((a, b) => b.mtime - a.mtime);
        const items = [];
        for (const s of all.slice(offset, offset + limit)) {
            const cached = thumbCache.get(s.id);
            if (cached && cached.mtime === s.mtime && cached.size === s.size) {
                items.push({
                    id: s.id,
                    name: s.name,
                    version: s.version,
                    taken: new Date(s.mtime).toISOString(),
                    size: s.size,
                    width: cached.width,
                    height: cached.height,
                    thumb: cached.thumb
                });
                continue;
            }
            const filePath = this.file(s.id);
            const dims = await readPngDimensions(filePath);
            const generated = await createThumbnailAsync(filePath, dims);
            if (!generated)
                continue;
            thumbCache.set(s.id, {
                mtime: s.mtime,
                size: s.size,
                width: generated.width,
                height: generated.height,
                thumb: generated.thumb
            });
            if (thumbCache.size > 1000) {
                const oldestKey = thumbCache.keys().next().value;
                if (oldestKey !== undefined)
                    thumbCache.delete(oldestKey);
            }
            items.push({
                id: s.id,
                name: s.name,
                version: s.version,
                taken: new Date(s.mtime).toISOString(),
                size: s.size,
                width: generated.width,
                height: generated.height,
                thumb: generated.thumb
            });
        }
        return { items, total: all.length, versions: versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true })) };
    }
    /** A screenshot for Discord: JPEG, at most 1920 px wide, base64 (the API takes up to 4 MB). */
    async forShare(id) {
        let img = electron_1.nativeImage.createFromPath(this.file(id));
        if (img.isEmpty())
            throw Error('Nie ma takiego zrzutu ekranu.');
        if (img.getSize().width > 1920)
            img = img.resize({ width: 1920, quality: 'best' });
        let jpeg = img.toJPEG(88);
        if (jpeg.length > 3.5 * 1024 * 1024)
            jpeg = img.resize({ width: 1280, quality: 'best' }).toJPEG(80);
        return { image: jpeg.toString('base64'), version: /^exer-([0-9a-z.]{1,20})\//i.exec(id)?.[1] || '' };
    }
    async image(id) {
        const img = electron_1.nativeImage.createFromPath(this.file(id));
        if (img.isEmpty())
            throw Error('Nie ma takiego zrzutu ekranu.');
        return 'data:image/jpeg;base64,' + img.toJPEG(90).toString('base64');
    }
    async action(id, action) {
        const file = this.file(id);
        await promises_1.default.access(file);
        if (action === 'reveal')
            electron_1.shell.showItemInFolder(file);
        else if (action === 'open')
            await electron_1.shell.openPath(file);
        else if (action === 'copy')
            await electron_1.clipboard.write([new electron_1.ClipboardItem({ 'image/png': new Blob([new Uint8Array(await promises_1.default.readFile(file))], { type: 'image/png' }) })]);
        else {
            thumbCache.delete(id);
            await electron_1.shell.trashItem(file);
        }
        return null;
    }
}
exports.Gallery = Gallery;
