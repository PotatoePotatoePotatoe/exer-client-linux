"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceIdentity = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const electron_1 = require("electron");
const zod_1 = require("zod");
const Ban = zod_1.z.object({ reason: zod_1.z.string().max(500), since: zod_1.z.number().finite(), expires: zod_1.z.number().finite().nullable() });
const Status = zod_1.z.object({ serverTime: zod_1.z.number().finite(), ban: Ban.nullable() });
class DeviceIdentity {
    root;
    base;
    encryption;
    request;
    hardware;
    value = null;
    constructor(root, base, encryption = electron_1.safeStorage, request = fetch, hardware = async () => ({})) {
        this.root = root;
        this.base = base;
        this.encryption = encryption;
        this.request = request;
        this.hardware = hardware;
    }
    async save() {
        if (!this.encryption.isEncryptionAvailable())
            throw Error('Systemowy magazyn kluczy EXER jest niedostępny.');
        await promises_1.default.mkdir(this.root, { recursive: true });
        const file = node_path_1.default.join(this.root, 'identity.dpapi');
        await promises_1.default.writeFile(file + '.tmp', this.encryption.encryptString(JSON.stringify(this.value)));
        await promises_1.default.rename(file + '.tmp', file);
    }
    async load() {
        if (this.value)
            return;
        if (!this.encryption.isEncryptionAvailable())
            throw Error('Systemowy magazyn kluczy EXER jest niedostępny.');
        try {
            const value = JSON.parse(this.encryption.decryptString(await promises_1.default.readFile(node_path_1.default.join(this.root, 'identity.dpapi'))));
            const publicKey = node_crypto_1.default.createPublicKey(value.privateKey).export({ type: 'spki', format: 'pem' }).toString();
            if (publicKey !== value.publicKey || node_crypto_1.default.createHash('sha256').update(publicKey).digest('hex') !== value.id)
                throw Error('Invalid identity');
            if (value.status)
                value.status = Status.parse(value.status);
            this.value = value;
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw Error('Nie można odczytać tożsamości EXER. Przywróć dane instalacji.');
            const pair = node_crypto_1.default.generateKeyPairSync('ed25519');
            const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
            this.value = { id: node_crypto_1.default.createHash('sha256').update(publicKey).digest('hex'), publicKey, privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
            await this.save();
        }
    }
    async post(endpoint, body) {
        const url = new URL(this.base());
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1'))
            throw Error('Identity requires HTTPS');
        const response = await this.request(this.base().replace(/\/$/, '') + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000), redirect: 'error' });
        if (!response.ok)
            throw Error('Usługa tożsamości EXER jest niedostępna.');
        return response.json();
    }
    /** The read token from the last proof: proves this device when the launcher asks for a game token (attest.ts). */
    async credential() { await this.load(); const v = this.value; return v.readToken && (v.expires ?? 0) > Date.now() ? { id: v.id, token: v.readToken } : null; }
    /** Proof for the cosmetics service that this device signs in an offline nick (POST /v1/cosmetics/offline-session). */
    async signOffline(name, serverId) {
        await this.load();
        const v = this.value;
        return { identity: { id: v.id, publicKey: v.publicKey }, signature: node_crypto_1.default.sign(null, Buffer.from('EXER-offline-v1:' + name + ':' + serverId), v.privateKey).toString('base64') };
    }
    async refresh(profile) {
        await this.load();
        const v = this.value;
        try {
            const challenge = zod_1.z.object({ challenge: zod_1.z.string().regex(/^[a-f0-9]{64}$/) }).parse(await this.post('/v1/identity/challenge', { id: v.id })).challenge;
            const signature = node_crypto_1.default.sign(null, Buffer.from('EXER-identity-v1:' + v.id + ':' + challenge), v.privateKey).toString('base64');
            const boundProfile = profile ? { id: profile.id.toLowerCase().replace(/-/g, ''), name: profile.name, kind: profile.kind ?? 'premium' } : undefined;
            const result = Status.extend({ id: zod_1.z.literal(v.id), readToken: zod_1.z.string().regex(/^[a-f0-9]{64}$/), expires: zod_1.z.number().finite() }).parse(await this.post('/v1/identity/proof', { id: v.id, publicKey: v.publicKey, challenge, signature, profile: boundProfile, hardware: await this.hardware().catch(() => ({})) }));
            v.status = Status.parse(result);
            v.received = Date.now();
            v.readToken = result.readToken;
            v.expires = result.expires;
            await this.save();
        }
        catch { /* Network failure retains the last validated restriction. */ }
        const now = (v.status?.serverTime ?? Date.now()) + Math.max(0, Date.now() - (v.received ?? Date.now()));
        const ban = v.status?.ban;
        return { id: v.id, ban: ban && (ban.expires === null || ban.expires > now) ? ban : null };
    }
    async prepareGame(instance, profile) {
        const result = await this.refresh(profile);
        const v = this.value, directory = node_path_1.default.join(instance, 'config', 'exer');
        await promises_1.default.mkdir(directory, { recursive: true });
        const file = node_path_1.default.join(directory, 'identity-session.json');
        // A read-only, expiring credential; the signing key never leaves this service.
        const session = { url: this.base(), id: v.id, token: v.readToken || '', expires: v.expires || 0, status: v.status || null };
        await promises_1.default.writeFile(file + '.tmp', JSON.stringify(session), { mode: 0o600 });
        await promises_1.default.rename(file + '.tmp', file);
        const cache = node_path_1.default.join(directory, 'identity-status.json');
        await promises_1.default.writeFile(cache + '.tmp', JSON.stringify({ id: v.id, received: Date.now(), serverTime: v.status?.serverTime ?? Date.now(), ban: result.ban }), { mode: 0o600 });
        await promises_1.default.rename(cache + '.tmp', cache);
        const credential = session.token && session.expires > Date.now() ? { id: session.id, token: session.token } : null;
        return { ...result, credential };
    }
}
exports.DeviceIdentity = DeviceIdentity;
