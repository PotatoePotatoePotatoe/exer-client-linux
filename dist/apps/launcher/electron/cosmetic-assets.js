"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cosmeticJarReader = cosmeticJarReader;
// The installed launcher no longer carries its own copy of the cosmetic meshes,
// textures and capes: they are read from exer-cosmetics-<build>.jar, the same file
// the game loads. The renderer keeps asking for ./cosmetics/... next to its
// index.html; this maps those file:// requests onto the jar's assets/exer/cosmetics/.
const adm_zip_1 = __importDefault(require("adm-zip"));
const node_path_1 = __importDefault(require("node:path"));
const SHARED = /[\\/]renderer-dist[\\/]cosmetics[\\/]((?:meshes|items|capes)[\\/][^?#]+)$/;
const TYPES = { '.json': 'application/json', '.png': 'image/png', '.mcmeta': 'application/json' };
function cosmeticJarReader(jarFile) {
    let zip = null;
    const cache = new Map();
    // file path of a renderer request -> bytes from the jar, or null when it is not a shared cosmetic
    return (filePath) => {
        const match = SHARED.exec(filePath);
        if (!match)
            return null;
        const relative = match[1].split(/[\\/]/).join('/');
        if (relative.split('/').some(part => part === '..' || part === '.' || part === ''))
            return null;
        const entry = 'assets/exer/cosmetics/' + relative;
        let body = cache.get(entry);
        if (!body) {
            zip ??= new adm_zip_1.default(jarFile);
            const found = zip.getEntry(entry);
            if (!found || found.isDirectory)
                return null;
            body = found.getData();
            cache.set(entry, body);
        }
        return { body, type: TYPES[node_path_1.default.extname(entry).toLowerCase()] || 'application/octet-stream' };
    };
}
