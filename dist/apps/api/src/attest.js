"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeUuid = exports.blacklistHost = exports.BAN_WINDOW = exports.BAN_ALERT = exports.attestMessage = exports.ATTEST_VERSION = void 0;
exports.blacklistAddress = blacklistAddress;
exports.blacklistKey = blacklistKey;
exports.parseBlacklistDuration = parseBlacklistDuration;
exports.loadAttestationKey = loadAttestationKey;
exports.registerAttestation = registerAttestation;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const zod_1 = require("zod");
const promises_2 = __importDefault(require("node:dns/promises"));
const voice_ticket_1 = require("../../../packages/shared/src/voice-ticket");
// EXER client attestation. The proxy (plugins/velocity-attest) sends a random
// challenge during login; only the EXER mod knows to forward it here, together
// with the game token the launcher obtained for the verified Microsoft account.
// The signed statement binds the account UUID to that one challenge, so it
// cannot be replayed and the proxy only needs the public key.
exports.ATTEST_VERSION = 1;
const attestMessage = (uuid, nonce, expires) => `EXER-ATTEST|${exports.ATTEST_VERSION}|${uuid}|${nonce}|${expires}`;
exports.attestMessage = attestMessage;
const GAME_TOKEN_TTL = 12 * 3600_000;
const SIGNATURE_TTL = 60_000;
/** A non-owner who restricts this many players/servers within BAN_WINDOW is reported; twice as many and further bans are refused. */
exports.BAN_ALERT = 5, exports.BAN_WINDOW = 10 * 60000;
const DEFAULT_PORT = 25565;
const stripDots = (host) => { while (host.endsWith('.'))
    host = host.slice(0, -1); return host; };
/** Splits a Minecraft address into a lower-case host and an explicit port (null = default 25565 or none). IPv6 literals keep their colons. */
function blacklistAddress(value) {
    let host = value.trim().toLowerCase();
    let port = null;
    if (host.startsWith('[')) {
        const end = host.indexOf(']');
        const rest = end >= 0 ? host.slice(end + 1) : '';
        host = end >= 0 ? host.slice(1, end) : host.slice(1);
        if (rest.startsWith(':'))
            port = Number(rest.slice(1));
    }
    else if (host.indexOf(':') === host.lastIndexOf(':') && host.includes(':')) {
        const at = host.indexOf(':');
        port = Number(host.slice(at + 1));
        host = host.slice(0, at);
    }
    host = stripDots(host);
    if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535 || port === DEFAULT_PORT))
        port = null;
    return { host, port };
}
/** Host without the port: a ban stored for a host applies to every port of it. */
const blacklistHost = (value) => blacklistAddress(value).host;
exports.blacklistHost = blacklistHost;
/** Key of a ban entry: `host` (all ports) or `host:port` / `[v6]:port` (that port only). */
function blacklistKey(host, port) {
    if (port === null)
        return host;
    return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}
const normalizeUuid = (value) => value.trim().toLowerCase().replace(/-/g, '');
exports.normalizeUuid = normalizeUuid;
const blacklistActive = (entry, now = Date.now()) => !entry.expires || Number.isNaN(Date.parse(entry.expires)) || Date.parse(entry.expires) > now;
/** "perm" or none = never expires; "14d", "6h", "30m", "45s" = from now; anything else is an error (never a silent permanent ban). */
function parseBlacklistDuration(duration, now = Date.now()) {
    if (!duration || duration.toLowerCase() === 'perm')
        return { ok: true, expires: null };
    const m = duration.trim().match(/^(\d{1,6})([dhms])$/i);
    if (!m || Number(m[1]) < 1)
        return { ok: false };
    const unit = m[2].toLowerCase();
    const ms = Number(m[1]) * (unit === 'd' ? 86400000 : unit === 'h' ? 3600000 : unit === 'm' ? 60000 : 1000);
    return { ok: true, expires: new Date(now + ms).toISOString() };
}
async function loadAttestationKey(root) {
    const file = node_path_1.default.join(root, 'attestation-key.pem');
    let pem;
    try {
        pem = await promises_1.default.readFile(file, 'utf8');
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
        pem = node_crypto_1.default.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
        await promises_1.default.mkdir(root, { recursive: true });
        await promises_1.default.writeFile(file, pem, { mode: 0o600 });
    }
    const privateKey = node_crypto_1.default.createPrivateKey(pem);
    const publicDer = node_crypto_1.default.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
    return { privateKey, publicKey: publicDer.toString('base64') };
}
const DeviceCredential = zod_1.z.object({ id: zod_1.z.string().regex(/^[a-f0-9]{64}$/), token: zod_1.z.string().regex(/^[a-f0-9]{64}$/) }).strict();
/** devices: once set (production), every game token is tied to a device and the proxy signature is refused for a restricted device. */
async function registerAttestation(app, root, profileOf, botKey, staff, devices = () => undefined, voiceAccess = () => ({ friends: [], blocked: [], chat: false })) {
    const key = await loadAttestationKey(root);
    const digest = (s) => node_crypto_1.default.createHash('sha256').update(s).digest('hex');
    const tokens = new Map();
    const prune = () => { const now = Date.now(); for (const [k, v] of tokens)
        if (v.expires < now)
            tokens.delete(k); };
    // Game tokens outlive an API restart (every deploy): a game started before it can still join EXER Attest servers.
    // Only the SHA-256 digests are stored, never the tokens themselves.
    const tokensFile = node_path_1.default.join(root, 'attest-tokens.json');
    try {
        const saved = JSON.parse(await promises_1.default.readFile(tokensFile, 'utf8'));
        for (const [k, v] of Object.entries(saved && typeof saved === 'object' ? saved : {}))
            if (/^[a-f0-9]{64}$/.test(k) && v && typeof v.expires === 'number' && v.expires > Date.now() && v.profile?.id)
                tokens.set(k, { profile: v.profile, expires: v.expires, signs: [], ...(v.device ? { device: v.device } : {}) });
    }
    catch (e) {
        if (e.code !== 'ENOENT' && !(e instanceof SyntaxError))
            throw e;
    }
    let tokensQueue = Promise.resolve();
    const saveTokens = () => {
        prune();
        const data = Object.fromEntries([...tokens].map(([k, v]) => [k, { profile: v.profile, expires: v.expires, ...(v.device ? { device: v.device } : {}) }]));
        tokensQueue = tokensQueue.then(async () => { await promises_1.default.writeFile(tokensFile + '.tmp', JSON.stringify(data)); await promises_1.default.rename(tokensFile + '.tmp', tokensFile); }).catch(() => { });
        return tokensQueue;
    };
    const blacklistFile = node_path_1.default.join(root, 'blacklist.json');
    let blacklist = { players: {}, servers: {} };
    /** Bumps on every change so clients and tests can tell a new list from the old one. */
    let blRevision = 0;
    let blEvents = [];
    try {
        const loaded = JSON.parse(await promises_1.default.readFile(blacklistFile, 'utf8'));
        blacklist = { players: loaded.players || {}, servers: loaded.servers || {} };
        blRevision = Number(loaded.revision) || 0;
        blEvents = Array.isArray(loaded.events) ? loaded.events : [];
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
    let blQueue = Promise.resolve();
    let previousBlacklist = structuredClone(blacklist);
    async function saveBlacklist() {
        blQueue = blQueue.then(async () => {
            blRevision++;
            for (const kind of ['players', 'servers']) {
                for (const [key, e] of Object.entries(blacklist[kind])) {
                    const old = previousBlacklist[kind][key];
                    if (JSON.stringify(old) === JSON.stringify(e))
                        continue;
                    blEvents.push({ id: (blEvents.at(-1)?.id || 0) + 1, kind: kind === 'players' ? 'player' : 'server', target: 'name' in e ? e.name : e.host + (e.port ? ':' + e.port : ''), reason: e.reason, bannedBy: e.bannedBy, since: e.since, expires: e.expires });
                }
            }
            blEvents = blEvents.slice(-1000);
            await promises_1.default.writeFile(blacklistFile + '.tmp', JSON.stringify({ ...blacklist, revision: blRevision, events: blEvents }, null, 2));
            await promises_1.default.rename(blacklistFile + '.tmp', blacklistFile);
            previousBlacklist = structuredClone(blacklist);
        }).catch(() => { });
        await blQueue;
    }
    const authHostsFile = node_path_1.default.join(root, 'authorized-hosts.json');
    let authHosts = [
        { id: 'exer-local', ip: '127.0.0.1', domain: 'localhost', name: 'EXER Internal Test Proxy', addedAt: new Date().toISOString(), addedBy: 'system', enabled: true },
    ];
    try {
        const loaded = JSON.parse(await promises_1.default.readFile(authHostsFile, 'utf8'));
        if (Array.isArray(loaded))
            authHosts = loaded;
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
    let ahQueue = Promise.resolve();
    async function resolveHost(host) {
        try {
            const addrs = await promises_2.default.lookup(host, { all: true });
            return addrs.map(a => (0, exports.blacklistHost)(a.address));
        }
        catch {
            return [];
        }
    }
    async function saveAuthHosts() {
        ahQueue = ahQueue.then(async () => {
            await promises_1.default.writeFile(authHostsFile + '.tmp', JSON.stringify(authHosts, null, 2));
            await promises_1.default.rename(authHostsFile + '.tmp', authHostsFile);
        }).catch(() => { });
        await ahQueue;
    }
    /** The Discord bot (its own staff checks) or a launcher account with players.ban; null = refused (reply sent). */
    function requireAuth(req, reply) {
        if (botKey) {
            const h = req.headers['authorization'];
            if (h === 'Bot ' + botKey)
                return { id: 'bot', name: 'Discord', bot: true };
        }
        const actor = staff?.actor(req);
        if (actor)
            return actor;
        reply.code(403).send({ error: 'Brak uprawnień administratora.' });
        return null;
    }
    const rankOf = (id) => !id || id === 'bot' ? 0 : staff ? staff.rank(id) : 0;
    /** The owner restricts anyone; others never the owner, staff only players ranked below them, the bot only players without a rank. */
    const mayRestrict = (actor, target) => actor.id === staff?.owner || target !== staff?.owner && rankOf(target) < (actor.bot ? 1 : rankOf(actor.id));
    /** An entry made by someone ranked above you stays until they (or the owner) lift it. */
    const mayLift = (actor, entry) => !entry?.bannedById || actor.id === staff?.owner || actor.id === entry.bannedById || rankOf(entry.bannedById) < rankOf(actor.id);
    // recent restrictions per non-owner staff member: a burst is reported to the staff log, a bigger one is stopped
    const recent = new Map();
    function burst(actor, kind, target, reply) {
        if (!staff || actor.id === staff.owner)
            return true;
        const now = Date.now(), list = (recent.get(actor.id) || []).filter(t => now - t < exports.BAN_WINDOW);
        if (list.length >= exports.BAN_ALERT * 2) {
            reply.code(429).send({ error: 'Zbyt wiele blokad w krótkim czasie. Właściciel dostał powiadomienie.' });
            staff.alert({ type: 'ban-blocked', actor: actor.name, actorId: actor.id, count: list.length, kind, target });
            return false;
        }
        list.push(now);
        recent.set(actor.id, list);
        if (list.length === exports.BAN_ALERT || list.length > exports.BAN_ALERT && list.length % exports.BAN_ALERT === 0)
            staff.alert({ type: 'ban-burst', actor: actor.name, actorId: actor.id, count: list.length, minutes: exports.BAN_WINDOW / 60000, kind, target });
        return true;
    }
    app.get('/v1/attest/public-key', async () => ({ version: exports.ATTEST_VERSION, algorithm: 'Ed25519', publicKey: key.publicKey }));
    app.get('/v1/attest/authorized-hosts', async () => {
        const active = authHosts.filter(h => h.enabled);
        const hosts = new Set(['127.0.0.1', 'localhost', '::1']);
        for (const h of active) {
            if (h.ip)
                hosts.add(h.ip.toLowerCase().trim());
            if (h.domain)
                hosts.add(h.domain.toLowerCase().trim());
        }
        return {
            version: exports.ATTEST_VERSION,
            hosts: Array.from(hosts),
            partners: active.map(h => ({ id: h.id, name: h.name, ip: h.ip, domain: h.domain })),
        };
    });
    app.post('/v1/attest/authorized-hosts', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const parsed = zod_1.z.object({
            ip: zod_1.z.string().default(''),
            domain: zod_1.z.string().default(''),
            name: zod_1.z.string().min(1).max(100),
            addedBy: zod_1.z.string().default('Admin'),
        }).safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Nieprawidłowe dane.' });
        const id = node_crypto_1.default.randomBytes(8).toString('hex');
        const entry = {
            id,
            ip: parsed.data.ip.toLowerCase().trim(),
            domain: parsed.data.domain.toLowerCase().trim(),
            name: parsed.data.name,
            addedAt: new Date().toISOString(),
            addedBy: parsed.data.addedBy,
            enabled: true,
        };
        authHosts = [entry, ...authHosts.filter(h => h.id !== id)];
        await saveAuthHosts();
        return { ok: true, host: entry };
    });
    app.delete('/v1/attest/authorized-hosts/:id', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const id = String(req.params.id || '').toLowerCase();
        authHosts = authHosts.filter(h => h.id !== id && h.ip !== id && h.domain !== id);
        await saveAuthHosts();
        return { ok: true };
    });
    // The list is public by design (the website shows it). Clients poll it every few seconds: ETag + 304 keep that cheap.
    const publicBlacklist = () => ({
        version: exports.ATTEST_VERSION,
        revision: blRevision,
        events: blEvents,
        serverTime: new Date().toISOString(),
        players: Object.fromEntries(Object.entries(blacklist.players).filter(([, entry]) => blacklistActive(entry))),
        servers: Object.fromEntries(Object.entries(blacklist.servers).filter(([, entry]) => blacklistActive(entry))),
    });
    app.get('/v1/attest/blacklist', async (req, reply) => {
        const body = publicBlacklist();
        const tag = '"' + digest(JSON.stringify({ players: body.players, servers: body.servers, events: body.events })).slice(0, 32) + '"';
        reply.header('Cache-Control', 'no-cache').header('ETag', tag);
        if (req.headers['if-none-match'] === tag)
            return reply.code(304).send();
        return body;
    });
    // The signed-in account asks about itself: the authenticated UUID is the only identity that counts.
    app.get('/v1/attest/blacklist/me', async (req, reply) => {
        const profile = profileOf(req);
        const entry = blacklist.players[(0, exports.normalizeUuid)(profile.id)];
        reply.header('Cache-Control', 'no-store');
        const active = entry && blacklistActive(entry);
        return { version: exports.ATTEST_VERSION, revision: blRevision, serverTime: new Date().toISOString(), state: active ? 'banned' : 'clear',
            entry: active ? { reason: entry.reason, since: entry.since, expires: entry.expires } : null };
    });
    app.post('/v1/attest/blacklist/player', async (req, reply) => {
        const actor = requireAuth(req, reply);
        if (!actor)
            return;
        const parsed = zod_1.z.object({
            uuid: zod_1.z.string().transform(exports.normalizeUuid).refine(s => /^[a-f0-9]{32}$/.test(s)),
            name: zod_1.z.string().min(1).max(30),
            reason: zod_1.z.string().min(1).max(300),
            duration: zod_1.z.string().optional(),
            bannedBy: zod_1.z.string().max(60).default('Admin')
        }).safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Nieprawidłowe dane.' });
        const { uuid, name, reason, duration } = parsed.data;
        const until = parseBlacklistDuration(duration);
        if (!until.ok)
            return reply.code(400).send({ error: 'Nieprawidłowy czas blokady (np. 14d, 6h, 30m albo perm).' });
        if (!mayRestrict(actor, uuid))
            return reply.code(403).send({ error: 'Nie możesz zablokować gracza z rangą równą lub wyższą od swojej.' });
        if (!mayLift(actor, blacklist.players[uuid]))
            return reply.code(403).send({ error: 'Tę blokadę nałożył ktoś z wyższą rangą.' });
        if (!burst(actor, 'player', name, reply))
            return;
        // the name shown is the account's own nick, so a staff member cannot sign a ban with someone else's name
        const bannedBy = actor.bot ? parsed.data.bannedBy : actor.name;
        const entry = { uuid, name, reason, since: new Date().toISOString(), expires: until.expires, bannedBy, ...(actor.bot ? {} : { bannedById: actor.id }) };
        blacklist.players[uuid] = entry;
        await saveBlacklist();
        for (const [k, v] of tokens) {
            if ((0, exports.normalizeUuid)(v.profile.id) === uuid)
                tokens.delete(k);
        }
        await saveTokens();
        return { ok: true, player: entry };
    });
    app.delete('/v1/attest/blacklist/player/:id', async (req, reply) => {
        const actor = requireAuth(req, reply);
        if (!actor)
            return;
        const id = (0, exports.normalizeUuid)(String(req.params.id || ''));
        if (!mayLift(actor, blacklist.players[id]))
            return reply.code(403).send({ error: 'Tę blokadę nałożył ktoś z wyższą rangą.' });
        delete blacklist.players[id];
        await saveBlacklist();
        return { ok: true };
    });
    // A server entry is a domain or an IP, optionally with one port. It matches that address only. The addresses a domain
    // resolves to are not banned with it (a shared host would lock out unrelated servers) unless includeIps is set.
    app.post('/v1/attest/blacklist/server', async (req, reply) => {
        const actor = requireAuth(req, reply);
        if (!actor)
            return;
        const parsed = zod_1.z.object({
            host: zod_1.z.string().min(3).max(120),
            reason: zod_1.z.string().min(1).max(300),
            duration: zod_1.z.string().optional(),
            includeIps: zod_1.z.boolean().default(false),
            bannedBy: zod_1.z.string().max(60).default('Admin')
        }).safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Nieprawidłowe dane.' });
        const { reason, duration, includeIps } = parsed.data;
        const bannedBy = actor.bot ? parsed.data.bannedBy : actor.name;
        const address = blacklistAddress(parsed.data.host);
        if (!address.host || /[\s/]/.test(address.host))
            return reply.code(400).send({ error: 'Nieprawidłowy adres serwera.' });
        const until = parseBlacklistDuration(duration);
        if (!until.ok)
            return reply.code(400).send({ error: 'Nieprawidłowy czas blokady (np. 14d, 6h, 30m albo perm).' });
        if (!mayLift(actor, blacklist.servers[blacklistKey(address.host, address.port)]))
            return reply.code(403).send({ error: 'Tę blokadę nałożył ktoś z wyższą rangą.' });
        if (!burst(actor, 'server', address.host, reply))
            return;
        const ips = includeIps ? [...new Set((await resolveHost(address.host)).map(exports.blacklistHost))] : [];
        const entry = { host: address.host, port: address.port, ips, reason, since: new Date().toISOString(), expires: until.expires, bannedBy, ...(actor.bot ? {} : { bannedById: actor.id }) };
        blacklist.servers[blacklistKey(address.host, address.port)] = entry;
        await saveBlacklist();
        return { ok: true, server: entry };
    });
    app.delete('/v1/attest/blacklist/server/:host', async (req, reply) => {
        const actor = requireAuth(req, reply);
        if (!actor)
            return;
        const address = blacklistAddress(String(req.params.host || ''));
        if (!mayLift(actor, blacklist.servers[blacklistKey(address.host, address.port)]))
            return reply.code(403).send({ error: 'Tę blokadę nałożył ktoś z wyższą rangą.' });
        delete blacklist.servers[blacklistKey(address.host, address.port)];
        await saveBlacklist();
        return { ok: true };
    });
    // "Second chance": the owner lifts every player restriction (and optionally every server one) at once; the Discord bot
    // announces it. Anti-cheat self-restrictions are lifted too: everybody starts again.
    app.post('/v1/admin/blacklist/amnesty', async (req, reply) => {
        const actor = requireAuth(req, reply);
        if (!actor)
            return;
        if (actor.id !== staff?.owner)
            return reply.code(403).send({ error: 'Tylko właściciel może zdjąć wszystkie blokady.' });
        const v = zod_1.z.object({ players: zod_1.z.boolean().default(true), servers: zod_1.z.boolean().default(false), message: zod_1.z.string().trim().max(300).default('') }).safeParse(req.body ?? {});
        if (!v.success)
            return reply.code(400).send({ error: 'Nieprawidłowe dane.' });
        const players = v.data.players ? Object.keys(blacklist.players).length : 0, servers = v.data.servers ? Object.keys(blacklist.servers).length : 0;
        if (v.data.players)
            blacklist.players = {};
        if (v.data.servers)
            blacklist.servers = {};
        await saveBlacklist();
        staff.amnesty({ players, servers, message: v.data.message, by: actor.name });
        return { ok: true, players, servers };
    });
    // The launcher may restrict only its own verified account after a high-confidence
    // attachment finding. It cannot choose a UUID or create a restriction for anybody else.
    app.post('/v1/attest/anticheat/restrict-self', async (req, reply) => {
        const profile = profileOf(req);
        const parsed = zod_1.z.object({ kind: zod_1.z.enum(['cheat-engine-attached', 'injector-attached', 'untrusted-java-agent', 'cheat-tool-running']), detail: zod_1.z.string().min(1).max(240) }).safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Invalid anti-cheat report.' });
        const uuid = profile.id.toLowerCase().replace(/-/g, '');
        const existing = blacklist.players[uuid];
        if (existing && blacklistActive(existing))
            return { ok: true, player: existing, alreadyRestricted: true };
        const labels = {
            'cheat-engine-attached': 'Cheat Engine was attached to the EXER Minecraft process',
            'injector-attached': 'An untrusted injector was attached to the EXER Minecraft process',
            'untrusted-java-agent': 'An untrusted Java agent was loaded into the EXER Minecraft process',
            'cheat-tool-running': 'A memory cheat tool was running during EXER Minecraft',
        };
        const entry = { uuid, name: profile.name, reason: `EXER security: ${labels[parsed.data.kind]} (${parsed.data.detail.slice(0, 80)}).`, since: new Date().toISOString(), expires: new Date(Date.now() + 14 * 86400000).toISOString(), bannedBy: 'EXER security' };
        blacklist.players[uuid] = entry;
        // evidence for the admin who verifies the automatic restriction (Ograniczenia dostępu → Gracze shows the entry)
        reports = [{ id: node_crypto_1.default.randomBytes(6).toString('hex'), uuid, name: profile.name, at: new Date().toISOString(), scanned: 0, detections: [{ level: 'confirmed', fileName: parsed.data.kind, hash: '0'.repeat(64), reason: parsed.data.detail }] }, ...reports].slice(0, 1000);
        await saveAnticheat();
        for (const [key, value] of tokens)
            if (value.profile.id.toLowerCase().replace(/-/g, '') === uuid)
                tokens.delete(key);
        await saveTokens();
        await saveBlacklist();
        return { ok: true, player: entry };
    });
    // ---- Cheat mod signatures (extra to the ones built into the launcher) and evidence reports ----
    // Reports are evidence for a human review. They never restrict an account by themselves.
    const signaturesFile = node_path_1.default.join(root, 'anticheat-signatures.json');
    const reportsFile = node_path_1.default.join(root, 'anticheat-reports.json');
    let signatures = [];
    let reports = [];
    try {
        signatures = JSON.parse(await promises_1.default.readFile(signaturesFile, 'utf8'));
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
    try {
        reports = JSON.parse(await promises_1.default.readFile(reportsFile, 'utf8'));
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
    let acQueue = Promise.resolve();
    const saveAnticheat = () => {
        acQueue = acQueue.then(async () => {
            await promises_1.default.writeFile(signaturesFile + '.tmp', JSON.stringify(signatures, null, 2));
            await promises_1.default.rename(signaturesFile + '.tmp', signaturesFile);
            await promises_1.default.writeFile(reportsFile + '.tmp', JSON.stringify(reports, null, 2));
            await promises_1.default.rename(reportsFile + '.tmp', reportsFile);
        }).catch(() => { });
        return acQueue;
    };
    const reportTimes = new Map();
    app.get('/v1/anticheat/signatures', async (_req, reply) => {
        reply.header('Cache-Control', 'no-cache');
        return { version: 1, mods: signatures.map(({ name, modIds, packages, sha256, level }) => ({ name, modIds, packages, sha256, level })) };
    });
    app.post('/v1/anticheat/signatures', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const parsed = zod_1.z.object({
            name: zod_1.z.string().min(1).max(60),
            modIds: zod_1.z.array(zod_1.z.string().regex(/^[a-z0-9_.-]{2,64}$/)).max(20).default([]),
            packages: zod_1.z.array(zod_1.z.string().regex(/^[A-Za-z0-9_$/.-]{6,120}\/$/)).max(20).default([]),
            sha256: zod_1.z.array(zod_1.z.string().regex(/^[a-f0-9]{64}$/)).max(50).default([]),
            level: zod_1.z.enum(['confirmed', 'suspicious']).default('confirmed'),
            addedBy: zod_1.z.string().max(60).default('Admin'),
        }).safeParse(req.body);
        if (!parsed.success || (!parsed.data.modIds.length && !parsed.data.packages.length && !parsed.data.sha256.length))
            return reply.code(400).send({ error: 'Nieprawidłowa sygnatura.' });
        const entry = { id: node_crypto_1.default.randomBytes(6).toString('hex'), ...parsed.data, addedAt: new Date().toISOString() };
        signatures = [entry, ...signatures].slice(0, 500);
        await saveAnticheat();
        return { ok: true, signature: entry };
    });
    app.delete('/v1/anticheat/signatures/:id', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        const id = String(req.params.id || '');
        signatures = signatures.filter(sig => sig.id !== id);
        await saveAnticheat();
        return { ok: true };
    });
    // The launcher reports a confirmed finding for the signed-in account only (the UUID comes from the session).
    app.post('/v1/anticheat/mod-report', async (req, reply) => {
        const profile = profileOf(req);
        const parsed = zod_1.z.object({
            scanned: zod_1.z.number().int().min(0).max(5000).default(0),
            detections: zod_1.z.array(zod_1.z.object({ level: zod_1.z.enum(['suspicious', 'confirmed']), fileName: zod_1.z.string().max(160), hash: zod_1.z.string().regex(/^[a-f0-9]{64}$/), reason: zod_1.z.string().max(200) })).min(1).max(20),
        }).safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Invalid report.' });
        const uuid = (0, exports.normalizeUuid)(profile.id);
        const now = Date.now();
        const recent = (reportTimes.get(uuid) || []).filter(t => t > now - 3600_000);
        if (recent.length >= 5)
            return reply.code(429).send({ error: 'Too many reports.' });
        reportTimes.set(uuid, [...recent, now]);
        reports = [{ id: node_crypto_1.default.randomBytes(6).toString('hex'), uuid, name: profile.name, at: new Date(now).toISOString(), scanned: parsed.data.scanned, detections: parsed.data.detections }, ...reports].slice(0, 1000);
        await saveAnticheat();
        return { ok: true };
    });
    app.get('/v1/anticheat/reports', async (req, reply) => {
        if (!requireAuth(req, reply))
            return;
        return { reports: reports.slice(0, 200) };
    });
    // Launcher: one game token per launch, for the account of the cosmetics session.
    app.post('/v1/attest/token', async (req, reply) => {
        const profile = profileOf(req);
        const b = blacklist.players[profile.id.toLowerCase()];
        if (b && (!b.expires || Date.parse(b.expires) > Date.now())) {
            return reply.code(403).send({ error: 'Konto jest zablokowane w sieci EXER: ' + b.reason, blacklisted: true, reason: b.reason, expires: b.expires });
        }
        // the device that runs the game: a restricted PC gets no token, whatever account it uses
        let device;
        const check = devices();
        if (check) {
            const credential = DeviceCredential.safeParse(req.body?.device);
            const ban = credential.success ? await check.verify(credential.data.id, credential.data.token) : false;
            if (ban === false)
                return reply.code(401).send({ error: 'Uruchom ponownie EXER Launcher: urządzenie nie zostało potwierdzone.' });
            if (ban)
                return reply.code(403).send({ error: 'Konto jest zablokowane w sieci EXER: ' + ban.reason, blacklisted: true, reason: ban.reason, expires: ban.expires === null ? null : new Date(ban.expires).toISOString() });
            device = credential.data.id;
        }
        prune();
        const own = [...tokens.entries()].filter(([, v]) => v.profile.id === profile.id).sort((a, b) => a[1].expires - b[1].expires);
        while (own.length >= 5)
            tokens.delete(own.shift()[0]);
        if (tokens.size > 20000)
            return reply.code(429).send({ error: 'Spróbuj ponownie później.' });
        const token = node_crypto_1.default.randomBytes(32).toString('base64url');
        const expires = Date.now() + GAME_TOKEN_TTL;
        tokens.set(digest(token), { profile, expires, signs: [], device });
        await saveTokens();
        reply.header('Cache-Control', 'no-store');
        return { token, expires };
    });
    const voiceTicket = (profile, exp, secret, control) => {
        const clean = (id) => id.replace(/-/g, '').toLowerCase(), access = voiceAccess(profile.id);
        return (0, voice_ticket_1.signVoiceTicket)({ id: clean(profile.id), name: profile.name, exp, friends: access.friends.map(clean), blocked: access.blocked.map(clean), chat: access.chat, control }, secret);
    };
    // The game's token entry when its account and device may play; otherwise the refusal has been sent and it returns null.
    async function gameAccess(token, reply) {
        const entry = tokens.get(digest(token));
        if (!entry || entry.expires < Date.now()) {
            reply.code(401).send({ error: 'Uruchom grę ponownie z EXER Launchera.' });
            return null;
        }
        const b = blacklist.players[entry.profile.id.toLowerCase()];
        if (b && (!b.expires || Date.parse(b.expires) > Date.now())) {
            reply.code(403).send({ error: 'Konto jest zablokowane w sieci EXER: ' + b.reason, blacklisted: true, reason: b.reason, expires: b.expires });
            return null;
        }
        // a device banned after the token was issued (or another install on its PC) is refused at the next server join
        const check = devices();
        const deviceBan = check && entry.device ? await check.restriction(entry.device) : null;
        if (deviceBan) {
            reply.code(403).send({ error: 'Konto jest zablokowane w sieci EXER: ' + deviceBan.reason, blacklisted: true, reason: deviceBan.reason, expires: deviceBan.expires === null ? null : new Date(deviceBan.expires).toISOString() });
            return null;
        }
        const now = Date.now();
        entry.signs = entry.signs.filter(t => t > now - 60_000);
        if (entry.signs.length >= 20) {
            reply.code(429).send({ error: 'Zbyt wiele połączeń, spróbuj za chwilę.' });
            return null;
        }
        entry.signs.push(now);
        return entry;
    }
    // Mod: sign the proxy's challenge for the token's account.
    app.post('/v1/attest/sign', async (req, reply) => {
        const input = zod_1.z.object({ token: zod_1.z.string().min(20).max(200), nonce: zod_1.z.string().regex(/^[A-Za-z0-9_-]{22,88}$/) }).safeParse(req.body);
        if (!input.success)
            return reply.code(400).send({ error: 'Nieprawidłowe żądanie.' });
        const entry = await gameAccess(input.data.token, reply);
        if (!entry)
            return reply;
        const now = Date.now();
        const expires = now + SIGNATURE_TTL;
        const signature = node_crypto_1.default.sign(null, Buffer.from((0, exports.attestMessage)(entry.profile.id, input.data.nonce, expires)), key.privateKey).toString('base64');
        reply.header('Cache-Control', 'no-store');
        return { version: exports.ATTEST_VERSION, uuid: entry.profile.id, name: entry.profile.name, expires, signature };
    });
    // Mod: pass into the voice service for the token's account (banned players get none).
    app.post('/v1/voice/ticket', async (req, reply) => {
        const secret = process.env.EXER_VOICE_SECRET || '';
        if (!secret)
            return reply.code(503).send({ error: 'Czat głosowy jest niedostępny.' });
        const input = zod_1.z.object({ token: zod_1.z.string().min(20).max(200) }).safeParse(req.body);
        if (!input.success)
            return reply.code(400).send({ error: 'Nieprawidłowe żądanie.' });
        const entry = await gameAccess(input.data.token, reply);
        if (!entry)
            return reply;
        const exp = Date.now() + voice_ticket_1.VOICE_TICKET_TTL_MS;
        reply.header('Cache-Control', 'no-store');
        return { ticket: voiceTicket(entry.profile, exp, secret, false), expires: exp };
    });
    // Launcher: a pass that manages the voice party; it carries no audio.
    app.post('/v1/voice/launcher-ticket', async (req, reply) => {
        const secret = process.env.EXER_VOICE_SECRET || '';
        if (!secret)
            return reply.code(503).send({ error: 'Czat głosowy jest niedostępny.' });
        const profile = profileOf(req);
        const ban = blacklist.players[profile.id.toLowerCase()];
        if (ban && (!ban.expires || Date.parse(ban.expires) > Date.now()))
            return reply.code(403).send({ error: 'Konto jest zablokowane w sieci EXER: ' + ban.reason });
        const exp = Date.now() + voice_ticket_1.VOICE_TICKET_TTL_MS;
        reply.header('Cache-Control', 'no-store');
        return { ticket: voiceTicket(profile, exp, secret, true), expires: exp };
    });
    return {
        banned: (id) => { const b = blacklist.players[id.toLowerCase()]; return !!b && (!b.expires || Date.parse(b.expires) > Date.now()); },
        /** True when this server address (any port, or this exact port) is on the EXER blacklist. */
        serverBlocked: (address) => {
            const a = blacklistAddress(address);
            const hit = (key) => { const e = blacklist.servers[key]; return !!e && blacklistActive(e); };
            return hit(a.host) || (a.port !== null && hit(blacklistKey(a.host, a.port)));
        },
        /** The account of a live game token, for the few requests the game makes itself; null when unknown, expired or banned. */
        gameProfile: (token) => {
            const entry = tokens.get(digest(token));
            if (!entry || entry.expires < Date.now())
                return null;
            const b = blacklist.players[entry.profile.id.toLowerCase()];
            return b && (!b.expires || Date.parse(b.expires) > Date.now()) ? null : entry.profile;
        }
    };
}
