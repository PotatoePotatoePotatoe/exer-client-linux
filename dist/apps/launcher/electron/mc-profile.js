"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.McProfile = void 0;
exports.skinSize = skinSize;
exports.checkSkin = checkSkin;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
// The player's Minecraft profile (skins and capes) through api.minecraftservices.com, plus a local
// library of skin files the player imported. Only textures.minecraft.net URLs are passed to the UI.
const PROFILE_API = 'https://api.minecraftservices.com/minecraft/profile';
const texture = (u) => {
    if (typeof u !== 'string')
        return '';
    try {
        const url = new URL(u.replace(/^http:/, 'https:'));
        return url.hostname === 'textures.minecraft.net' ? url.href : '';
    }
    catch {
        return '';
    }
};
// Width and height from the PNG header; Minecraft accepts 64x64 and the legacy 64x32.
function skinSize(png) {
    const signature = '89504e470d0a1a0a';
    if (png.length < 24 || png.subarray(0, 8).toString('hex') !== signature || png.subarray(12, 16).toString('ascii') !== 'IHDR')
        throw Error('To nie jest plik PNG.');
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
function checkSkin(png) {
    if (png.length > 256 * 1024)
        throw Error('Plik skina jest za duży.');
    const { width, height } = skinSize(png);
    if (width !== 64 || (height !== 64 && height !== 32))
        throw Error(`Skin musi mieć 64×64 lub 64×32 piksele (ten ma ${width}×${height}).`);
}
class McProfile {
    token;
    root;
    base;
    fetchImpl;
    constructor(token, root, base = PROFILE_API, fetchImpl = fetch) {
        this.token = token;
        this.root = root;
        this.base = base;
        this.fetchImpl = fetchImpl;
    }
    async request(method, suffix, body, headers = {}) {
        const response = await this.fetchImpl(this.base + suffix, { method, headers: { Authorization: 'Bearer ' + await this.token(), ...headers }, body, signal: AbortSignal.timeout(30000) });
        if (response.status === 401)
            throw Error('Sesja Microsoft wygasła. Zaloguj się ponownie.');
        if (response.status === 429)
            throw Error('Minecraft ogranicza liczbę zmian. Spróbuj za minutę.');
        if (!response.ok)
            throw Error(`Minecraft odrzucił zmianę (HTTP ${response.status}).`);
        const text = await response.text();
        return text ? JSON.parse(text) : null;
    }
    map(raw) {
        return {
            name: String(raw?.name || ''),
            skins: (Array.isArray(raw?.skins) ? raw.skins : []).map((s) => ({ id: String(s.id), url: texture(s.url), variant: String(s.variant).toLowerCase() === 'slim' ? 'slim' : 'classic', active: s.state === 'ACTIVE' })).filter((s) => s.url),
            capes: (Array.isArray(raw?.capes) ? raw.capes : []).map((c) => ({ id: String(c.id), alias: String(c.alias || 'Cape'), url: texture(c.url), active: c.state === 'ACTIVE' })).filter((c) => c.url)
        };
    }
    async get() { return this.map(await this.request('GET', '')); }
    // Uploads a skin file as the account's active skin.
    async setSkin(png, variant) {
        checkSkin(png);
        const form = new FormData();
        form.append('variant', variant);
        form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'skin.png');
        return this.map(await this.request('POST', '/skins', form));
    }
    // Shows one of the owned capes, or hides the cape (null).
    async setCape(id) {
        if (id === null)
            return this.map(await this.request('DELETE', '/capes/active'));
        if (!/^[0-9a-f-]{8,64}$/i.test(id))
            throw Error('Nieprawidłowa peleryna.');
        return this.map(await this.request('PUT', '/capes/active', JSON.stringify({ capeId: id }), { 'Content-Type': 'application/json' }));
    }
    // Local skin library: imported PNG files in <userData>/skins, with names and arm type in skins.json.
    dir() { return node_path_1.default.join(this.root(), 'skins'); }
    async index() {
        try {
            const v = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(this.dir(), 'skins.json'), 'utf8'));
            return Array.isArray(v) ? v.filter(x => /^[0-9a-f]{40}$/.test(x?.id)) : [];
        }
        catch {
            return [];
        }
    }
    async writeIndex(list) {
        await promises_1.default.mkdir(this.dir(), { recursive: true });
        await promises_1.default.writeFile(node_path_1.default.join(this.dir(), 'skins.json'), JSON.stringify(list, null, 2));
    }
    async library() {
        const out = [];
        for (const s of await this.index()) {
            try {
                out.push({ ...s, dataUrl: 'data:image/png;base64,' + (await promises_1.default.readFile(node_path_1.default.join(this.dir(), s.id + '.png'))).toString('base64') });
            }
            catch { }
        }
        return out;
    }
    async add(png, name, variant) {
        checkSkin(png);
        const id = node_crypto_1.default.createHash('sha1').update(png).digest('hex');
        await promises_1.default.mkdir(this.dir(), { recursive: true });
        await promises_1.default.writeFile(node_path_1.default.join(this.dir(), id + '.png'), png);
        const list = (await this.index()).filter(s => s.id !== id);
        list.unshift({ id, name: name.slice(0, 32) || 'Skin', variant, added: new Date().toISOString() });
        await this.writeIndex(list.slice(0, 60));
        return this.library();
    }
    async update(id, name, variant) {
        const list = await this.index();
        const item = list.find(s => s.id === id);
        if (!item)
            throw Error('Nie ma takiego skina w bibliotece.');
        item.name = name.slice(0, 32) || item.name;
        item.variant = variant;
        await this.writeIndex(list);
        return this.library();
    }
    async remove(id) {
        if (!/^[0-9a-f]{40}$/.test(id))
            throw Error('Nie ma takiego skina w bibliotece.');
        await this.writeIndex((await this.index()).filter(s => s.id !== id));
        await promises_1.default.rm(node_path_1.default.join(this.dir(), id + '.png'), { force: true });
        return this.library();
    }
    async file(id) {
        if (!/^[0-9a-f]{40}$/.test(id))
            throw Error('Nie ma takiego skina w bibliotece.');
        return promises_1.default.readFile(node_path_1.default.join(this.dir(), id + '.png'));
    }
}
exports.McProfile = McProfile;
