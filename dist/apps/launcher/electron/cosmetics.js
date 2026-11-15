"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CosmeticsService = void 0;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
/** What the game does when joining a server: tells Mojang this player joins serverId. Only Mojang sees the token. */
async function mojangJoin(accessToken, selectedProfile, serverId) {
    const r = await fetch('https://sessionserver.mojang.com/session/minecraft/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken, selectedProfile, serverId }), signal: AbortSignal.timeout(15000) });
    if (r.status !== 204 && r.status !== 200)
        throw Object.assign(Error('Mojang nie potwierdził logowania (' + r.status + ').'), { status: r.status, retryAfter: r.headers.get('retry-after') });
}
class CosmeticsService {
    accounts;
    base;
    join;
    offlineProof;
    device;
    session = null;
    pending = null;
    failedAt = 0;
    mojangRetryAt = 0;
    /** the reason of the last failed sign-in (offline nick limit, restriction...), repeated while retries are paused */
    failure = null;
    cacheState = new Map();
    attestExpires = new Map();
    loadoutSyncs = new Map();
    /** offlineProof: the device key signs offline sign-ins (DeviceIdentity.signOffline); without it offline accounts have no cosmetics. */
    constructor(accounts, base, join = mojangJoin, offlineProof, device) {
        this.accounts = accounts;
        this.base = base;
        this.join = join;
        this.offlineProof = offlineProof;
        this.device = device;
    }
    async disconnect() { const token = this.session?.token; this.session = null; this.failedAt = 0; if (token)
        await this.raw('DELETE', '/v1/cosmetics/session', undefined, token).catch(() => { }); }
    async raw(method, endpoint, body, token) {
        const base = this.base();
        if (!base)
            throw Error('Usługa kosmetyków jest niedostępna.');
        const url = new URL(base);
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1'))
            throw Error('Kosmetyki wymagają HTTPS.');
        const response = await fetch(base.replace(/\/$/, '') + endpoint, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(20000) });
        let value = null;
        try {
            value = await response.json();
        }
        catch { }
        if (!response.ok) {
            const errorMsg = value?.error || value?.message || `Usługa kosmetyków: HTTP ${response.status}`;
            const error = Object.assign(Error(errorMsg), { status: response.status });
            // A blacklist reply keeps its details so the launch flow can still start the game on the block screen.
            if (value?.blacklisted === true)
                Object.assign(error, { blacklisted: true, reason: value.reason, expires: value.expires ?? null });
            throw error;
        }
        return value;
    }
    async connect() { const id = this.accounts.list().activeAccount; if (!id) {
        await this.disconnect();
        return;
    } if (this.session?.profile.id === id && this.session.expires > Date.now() + 30000)
        return; if (this.pending)
        return this.pending; if (this.failedAt > Date.now() - 10000)
        throw this.failure ?? Error('Usługa kosmetyków jest chwilowo niedostępna.'); this.pending = (async () => { try {
        const auth = await this.accounts.authorization();
        const session = await this.signIn(auth);
        if (session.profile?.id !== auth.account.id)
            throw Error('Niezgodne konto usługi kosmetyków.');
        this.session = session;
    }
    catch (e) {
        this.session = null;
        this.failedAt = Date.now();
        this.failure = e instanceof Error ? e : null;
        throw e;
    }
    finally {
        this.pending = null;
    } })(); return this.pending; }
    async joinWithRateLimit(access, id, serverId) {
        try {
            await this.join(access, id.replace(/-/g, ''), serverId);
        }
        catch (error) {
            const status = error?.status;
            if (status === 429) {
                const header = error.retryAfter;
                const delay = header ? (Number.isFinite(Number(header)) ? Number(header) * 1000 : Date.parse(header) - Date.now()) : NaN;
                this.mojangRetryAt = Date.now() + (Number.isFinite(delay) ? Math.max(10000, delay) : 300000);
            }
            throw error;
        }
    }
    /** The Minecraft token never leaves this PC: EXER gives a one-time code, the launcher tells Mojang it joins it (as the game
     * does when joining a server), and EXER asks Mojang who joined. */
    async signIn(auth) {
        const offline = auth.account.kind === 'offline';
        if (offline && !this.offlineProof)
            throw Error('Ta usługa wymaga konta Microsoft / Premium.');
        if (!offline && Date.now() < this.mojangRetryAt)
            throw Error('Mojang ogranicza logowanie. Odczekaj ' + Math.ceil((this.mojangRetryAt - Date.now()) / 1000) + ' s i spróbuj ponownie.');
        const challenge = await this.raw('POST', '/v1/cosmetics/challenge', {});
        const serverId = typeof challenge?.serverId === 'string' ? challenge.serverId.trim() : '';
        if (!/^[a-f0-9]{40}$/i.test(serverId)) {
            throw Error('Usługa kosmetyków nie zwróciła prawidłowego wyzwania uwierzytelnienia.');
        }
        if (offline)
            return this.raw('POST', '/v1/cosmetics/offline-session', { name: auth.account.name, serverId, ...await this.offlineProof(auth.account.name, serverId) });
        try {
            await this.joinWithRateLimit(auth.access, auth.account.id, serverId);
        }
        catch (error) {
            const status = error?.status;
            if (status !== 401 && status !== 403) {
                throw Error(status ? 'Usługa logowania Mojang jest chwilowo niedostępna (HTTP ' + status + ').' : 'Nie udało się połączyć z usługą logowania Mojang.');
            }
            const renewed = await this.accounts.authorization(true);
            if (renewed.account.id !== auth.account.id)
                throw Error('Konto zmieniło się podczas logowania.');
            await this.joinWithRateLimit(renewed.access, renewed.account.id, serverId);
        }
        return this.raw('POST', '/v1/cosmetics/session', { name: auth.account.name, serverId });
    }
    async updateToken() {
        const rights = await this.request('GET', '/v1/updates/channels');
        if (!Array.isArray(rights.channels) || !rights.channels.includes('dev'))
            throw Error('HTTP 403: Brak uprawnień do DEV.');
        if (!this.session || this.session.expires <= Date.now())
            throw Error('HTTP 401: Sesja wygasła.');
        return this.session.token;
    }
    async isAdmin() { try {
        await this.connect();
        return this.session?.admin === true;
    }
    catch {
        return false;
    } }
    async request(method, endpoint, body) { await this.connect(); if (!this.session)
        throw Error('Zaloguj się przez Microsoft.'); try {
        return await this.raw(method, endpoint, body, this.session.token);
    }
    catch (e) {
        if (e.status === 401)
            this.session = null;
        throw e;
    } }
    // Public endpoints (no session), e.g. the partner server list.
    async publicGet(endpoint) { return this.raw('GET', endpoint); }
    /** A PNG served by the EXER API (server banners) as a data URL for the renderer. */
    async asset(endpoint) { const base = this.base(); if (!base)
        throw Error('Usługa kosmetyków jest niedostępna.'); const r = await fetch(base.replace(/\/$/, '') + endpoint, { redirect: 'error', signal: AbortSignal.timeout(20000) }); if (!r.ok)
        throw Error('HTTP ' + r.status); return 'data:image/png;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64'); }
    async ensureStarterPack() { try {
        return await this.request('POST', '/v1/cosmetics/starter', {});
    }
    catch {
        return null;
    } }
    async configureGame(root) {
        const directory = node_path_1.default.join(root, 'config', 'exer');
        const file = node_path_1.default.join(directory, 'cosmetics-service.json');
        const content = JSON.stringify({ url: this.base() });
        await promises_1.default.mkdir(directory, { recursive: true });
        try {
            if (await promises_1.default.readFile(file, 'utf8') === content)
                return;
        }
        catch { }
        await promises_1.default.writeFile(file, content);
    }
    // Game token for EXER client attestation (servers that require EXER Client).
    // Without a backend session the old token is removed so the mod reports it clearly.
    // fresh: always a new token (a game launch); otherwise a saved token that is still valid is kept.
    async attestGame(root, fresh = false) {
        const file = node_path_1.default.join(root, 'config', 'exer', 'attest.json');
        const now = Date.now();
        let expires = fresh ? 0 : this.attestExpires.get(root) || 0;
        if (!fresh && expires <= now + 60000)
            try {
                const saved = JSON.parse(await promises_1.default.readFile(file, 'utf8'));
                if (saved?.url === this.base() && typeof saved.token === 'string' && typeof saved.expires === 'number')
                    expires = saved.expires;
            }
            catch { }
        if (expires > now + 60000) {
            this.attestExpires.set(root, expires);
            return;
        }
        try {
            const result = await this.request('POST', '/v1/attest/token', { device: await this.device?.() ?? undefined });
            await promises_1.default.writeFile(file, JSON.stringify({ url: this.base(), token: result.token, expires: result.expires }), { mode: 0o600 });
            if (typeof result.expires === 'number')
                this.attestExpires.set(root, result.expires);
        }
        catch (e) {
            this.attestExpires.delete(root);
            await promises_1.default.rm(file, { force: true });
            throw e;
        }
    }
    /** freshAttest: a game launch, which always gets a new attestation token (after any sync already running). */
    async syncGameLoadout(root, me, freshAttest = false) {
        const previous = this.loadoutSyncs.get(root);
        if (previous) {
            if (!freshAttest)
                return previous;
            await previous.catch(() => { });
            return this.syncGameLoadout(root, me, true);
        }
        const sync = (async () => {
            await this.configureGame(root);
            const selected = this.accounts.list();
            if ((selected.accounts || []).find(a => a.id === selected.activeAccount)?.kind === 'offline') {
                this.attestExpires.delete(root);
                this.cacheState.delete(node_path_1.default.join(root, 'config', 'exer', 'cosmetics-cache.json'));
                for (const name of ['attest.json', 'cosmetics-cache.json'])
                    await promises_1.default.rm(node_path_1.default.join(root, 'config', 'exer', name), { force: true });
                return;
            }
            await this.attestGame(root, freshAttest);
            try {
                await this.writeGameCache(root, me || await this.request('GET', '/v1/cosmetics/me'));
            }
            catch { }
        })();
        this.loadoutSyncs.set(root, sync);
        try {
            await sync;
        }
        finally {
            this.loadoutSyncs.delete(root);
        }
    }
    /** The equipped list the running game reads (it checks the file date 4 times a second). Called right after an
     * outfit change with the state the API returned, so the game shows the change without waiting for a full sync. */
    async writeGameCache(root, me) {
        if (!me?.profile?.id)
            return;
        const directory = node_path_1.default.join(root, 'config', 'exer');
        await promises_1.default.mkdir(directory, { recursive: true });
        const items = (me.equipped || []).map((cid) => me.catalog?.find((c) => c.id === cid)).filter(Boolean);
        const file = node_path_1.default.join(directory, 'cosmetics-cache.json');
        // written next to it and renamed, so the game never reads a half-written file
        const state = {
            playerId: String(me.profile.id).toLowerCase(),
            playerName: me.profile.name,
            equipped: items,
            catalog: me.catalog || [],
            grants: me.grants || []
        };
        const serialized = JSON.stringify(state);
        if (this.cacheState.get(file) === serialized)
            return;
        await promises_1.default.writeFile(file + '.tmp', JSON.stringify({ ...state, updatedAt: Date.now() }, null, 2));
        await promises_1.default.rename(file + '.tmp', file);
        this.cacheState.set(file, serialized);
    }
}
exports.CosmeticsService = CosmeticsService;
