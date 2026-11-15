"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.samePc = exports.sameHardware = exports.HARDWARE_MATCH = exports.HARDWARE_PARTS = void 0;
exports.subnet = subnet;
exports.registerIdentity = registerIdentity;
const node_crypto_1 = __importDefault(require("node:crypto"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const zod_1 = require("zod");
const emote_durations_json_1 = __importDefault(require("../../../packages/shared/src/emote-durations.json"));
const Id = zod_1.z.string().regex(/^[a-f0-9]{64}$/);
const Profile = zod_1.z.object({ id: zod_1.z.string().regex(/^[a-f0-9]{32}$/), name: zod_1.z.string().regex(/^[A-Za-z0-9_]{3,16}$/), kind: zod_1.z.enum(['premium', 'offline']) }).strict();
/** Salted hashes of hardware parts (launcher hardware-id.ts); no raw serial numbers reach the API. */
exports.HARDWARE_PARTS = ['machine', 'board', 'disk', 'bios'];
/** Two installs that share this many hardware parts are the same PC (a Windows reinstall keeps board, disk and BIOS). */
exports.HARDWARE_MATCH = 2;
const Hardware = zod_1.z.object(Object.fromEntries(exports.HARDWARE_PARTS.map(k => [k, Id.optional()]))).strict();
const Proof = zod_1.z.object({ id: Id, publicKey: zod_1.z.string().max(160), challenge: zod_1.z.string().regex(/^[a-f0-9]{64}$/), signature: zod_1.z.string().max(100), profile: Profile.optional(), hardware: Hardware.optional() }).strict();
/** The network an address belongs to: IPv4 /24, IPv6 /64. Only a soft signal for admins (shared homes, schools, mobile NAT). */
function subnet(ip) {
    const v4 = /^(?:::ffff:)?(\d+\.\d+\.\d+)\.\d+$/.exec(ip);
    if (v4)
        return v4[1] + '.0/24';
    if (ip.includes(':'))
        return ip.toLowerCase().split(':').slice(0, 4).join(':') + '::/64';
    return '';
}
const sameHardware = (a, b) => exports.HARDWARE_PARTS.filter(k => a?.[k] && a[k] === b?.[k]).length >= exports.HARDWARE_MATCH;
exports.sameHardware = sameHardware;
/** Every hardware set an install ever reported (the latest plus history), so sending other hashes later cannot unlink a banned PC. */
const hardwareSets = (e) => [...(e.hardware ? [e.hardware] : []), ...(e.hardwareSeen || [])];
const samePc = (a, b) => hardwareSets(a).some(x => hardwareSets(b).some(y => (0, exports.sameHardware)(x, y)));
exports.samePc = samePc;
/** Hardware sets kept per install; new installs one IP may create a day (a script making keys cannot flood the registry). */
const HARDWARE_HISTORY = 6, NEW_PER_IP_DAY = 10;
const digest = (value) => node_crypto_1.default.createHash('sha256').update(value).digest('hex');
async function registerIdentity(app, directory, admin, authenticatePlayer) {
    const file = node_path_1.default.join(directory, 'identities.json');
    let identities = {};
    try {
        identities = JSON.parse(await promises_1.default.readFile(file, 'utf8'));
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
    let writes = Promise.resolve();
    const mutate = (operation) => {
        const work = writes.then(async () => {
            const previous = structuredClone(identities);
            try {
                const result = operation();
                await promises_1.default.mkdir(directory, { recursive: true });
                await promises_1.default.writeFile(file + '.tmp', JSON.stringify(identities), { mode: 0o600 });
                await promises_1.default.rename(file + '.tmp', file);
                return result;
            }
            catch (error) {
                identities = previous;
                throw error;
            }
        });
        writes = work.then(() => { }, () => { });
        return work;
    };
    const challenges = new Map();
    const created = new Map();
    const players = async () => { try {
        return Object.values(JSON.parse(await promises_1.default.readFile(node_path_1.default.join(directory, 'blacklist.json'), 'utf8')).players || {});
    }
    catch {
        return [];
    } };
    /** The restriction of this install alone: its own device ban, else a player blacklist entry of any profile that played on it. */
    const ownBan = (entry, list, now) => {
        if (entry.ban && (entry.ban.expires === null || entry.ban.expires > now))
            return { ban: entry.ban, source: 'device' };
        const profiles = Object.entries(entry.profiles || {});
        const inherited = list.find(raw => {
            const expires = raw?.expires ? Date.parse(raw.expires) : null;
            if (expires !== null && (!Number.isFinite(expires) || expires <= now))
                return false;
            return profiles.some(([id, p]) => id === String(raw.uuid || '').toLowerCase().replace(/-/g, '') || p.kind === 'offline' && p.name.toLowerCase() === String(raw.name || '').toLowerCase());
        });
        return inherited ? { ban: { reason: String(inherited.reason), since: Date.parse(inherited.since) || now, expires: inherited.expires ? Date.parse(inherited.expires) : null }, source: 'player' } : null;
    };
    /** ownBan, else the ban of another install on the same PC (a new identity.dpapi, a new nick or a reinstalled Windows). */
    const restriction = async (id, entry) => {
        const now = Date.now(), list = await players();
        const own = ownBan(entry, list, now);
        if (own)
            return { ...own, from: id };
        for (const [other, e] of Object.entries(identities)) {
            if (other === id || !(0, exports.samePc)(entry, e))
                continue;
            const linked = ownBan(e, list, now);
            if (linked)
                return { ban: linked.ban, source: 'hardware', from: other };
        }
        return null;
    };
    const status = async (id, entry) => ({ serverTime: Date.now(), ban: (await restriction(id, entry))?.ban ?? null });
    app.post('/v1/identity/challenge', async (req, reply) => {
        const input = zod_1.z.object({ id: Id }).strict().safeParse(req.body);
        if (!input.success)
            return reply.code(400).send({ error: 'Invalid identity' });
        for (const [nonce, value] of challenges)
            if (value.expires <= Date.now())
                challenges.delete(nonce);
        if (challenges.size >= 2000)
            return reply.code(429).send({ error: 'Try later' });
        const challenge = node_crypto_1.default.randomBytes(32).toString('hex');
        challenges.set(challenge, { id: input.data.id, expires: Date.now() + 60000 });
        return { challenge };
    });
    app.post('/v1/identity/proof', async (req, reply) => {
        const input = Proof.safeParse(req.body);
        if (!input.success)
            return reply.code(400).send({ error: 'Invalid proof' });
        const v = input.data, challenge = challenges.get(v.challenge);
        challenges.delete(v.challenge);
        if (!challenge || challenge.id !== v.id || challenge.expires <= Date.now())
            return reply.code(401).send({ error: 'Expired challenge' });
        try {
            const key = node_crypto_1.default.createPublicKey(v.publicKey);
            if (key.asymmetricKeyType !== 'ed25519' || digest(v.publicKey) !== v.id || !node_crypto_1.default.verify(null, Buffer.from('EXER-identity-v1:' + v.id + ':' + v.challenge), key, Buffer.from(v.signature, 'base64')))
                throw Error();
        }
        catch {
            return reply.code(401).send({ error: 'Invalid proof' });
        }
        const readToken = node_crypto_1.default.randomBytes(32).toString('hex'), expires = Date.now() + 24 * 60 * 60 * 1000;
        if (!identities[v.id]) {
            const day = Date.now() - 86400000, recent = (created.get(req.ip) || []).filter(t => t > day);
            if (recent.length >= NEW_PER_IP_DAY)
                return reply.code(429).send({ error: 'Too many new devices' });
            created.set(req.ip, [...recent, Date.now()]);
        }
        return mutate(async () => {
            const entry = identities[v.id] ??= { publicKey: v.publicKey, created: Date.now(), lastSeen: Date.now(), lastIp: '', ban: null, readers: {} };
            entry.lastSeen = Date.now();
            entry.lastIp = req.ip;
            if (v.profile) {
                entry.profiles = entry.profiles || {};
                entry.profiles[v.profile.id] = { name: v.profile.name, kind: v.profile.kind, lastSeen: Date.now() };
            }
            if (v.hardware && Object.keys(v.hardware).length) {
                const seen = hardwareSets(entry).filter(h => JSON.stringify(h) !== JSON.stringify(v.hardware));
                entry.hardware = v.hardware;
                entry.hardwareSeen = seen.slice(0, HARDWARE_HISTORY - 1);
            }
            entry.readers = Object.fromEntries(Object.entries(entry.readers).filter(([, expiry]) => expiry > Date.now()).slice(-7));
            const reader = digest(readToken);
            entry.readers[reader] = expires;
            entry.readerProfiles = Object.fromEntries(Object.entries(entry.readerProfiles ?? {}).filter(([key]) => key in entry.readers));
            return { ...await status(v.id, entry), id: v.id, readToken, expires };
        });
    });
    app.post('/v1/identity/status', async (req, reply) => {
        reply.header('Cache-Control', 'no-store');
        const input = zod_1.z.object({ id: Id, token: zod_1.z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(req.body);
        if (!input.success)
            return reply.code(400).send({ error: 'Invalid status request' });
        const entry = identities[input.data.id];
        if (!entry || !(entry.readers[digest(input.data.token)] > Date.now()))
            return reply.code(401).send({ error: 'Expired identity session' });
        return status(input.data.id, entry);
    });
    const durations = new Map(Object.entries({ ...emote_durations_json_1.default, wave: 2400 }));
    const gestures = zod_1.z.string().max(64).refine(id => durations.has(id));
    const emoteRequest = zod_1.z.object({ id: Id, token: Id, room: Id, gesture: gestures.optional(), stop: zod_1.z.boolean().optional() }).strict();
    const emotes = new Map();
    app.post('/v1/identity/emotes/bind', async (req, reply) => {
        if (!authenticatePlayer)
            return reply.code(404).send({ error: 'Unavailable' });
        const player = authenticatePlayer(req).id;
        const input = zod_1.z.object({ id: Id, token: Id, player: Profile.shape.id }).strict().safeParse(req.body);
        if (!input.success)
            return reply.code(400).send({ error: 'Invalid emote binding' });
        const { id, token } = input.data;
        const reader = digest(token);
        return mutate(() => {
            const entry = identities[id];
            if (input.data.player !== player || !entry?.profiles?.[player] || !(entry.readers[reader] > Date.now())) {
                return reply.code(403).send({ error: 'Invalid emote session' });
            }
            (entry.readerProfiles ??= {})[reader] = player;
            return { ok: true };
        });
    });
    app.post('/v1/identity/emotes', async (req, reply) => {
        reply.header('Cache-Control', 'no-store');
        const input = emoteRequest.safeParse(req.body);
        if (!input.success)
            return reply.code(400).send({ error: 'Invalid emote request' });
        const { id, token, room, gesture, stop } = input.data;
        const now = Date.now(), entry = identities[id], reader = digest(token);
        const player = entry?.readerProfiles?.[reader];
        if (!player || !(entry.readers[reader] > now))
            return reply.code(401).send({ error: 'Expired emote session' });
        for (const [key, event] of emotes)
            if (now >= event.expires)
                emotes.delete(key);
        const previous = emotes.get(player);
        if (stop && !gesture)
            emotes.delete(player);
        else if (gesture && (!previous || now - previous.at >= 700)) {
            if ((await restriction(id, entry))?.ban)
                return reply.code(403).send({ error: 'Restricted session' });
            if (emotes.size >= 2048 && !previous)
                return reply.code(429).send({ error: 'Too many active emotes' });
            const at = Date.now();
            emotes.set(player, { player, room, gesture, at, expires: at + durations.get(gesture) });
        }
        const clock = Date.now();
        return { events: [...emotes.values()].filter(event => event.room === room && event.player !== player && clock < event.expires)
                .slice(-100).map(({ player, gesture, at }) => ({ player, gesture, age: clock - at })) };
    });
    // Admin: every install with its nicks, the restriction and where it comes from (device, player blacklist, or the same PC).
    app.get('/v1/admin/identities', async (req) => {
        admin(req);
        return { identities: await Promise.all(Object.entries(identities).map(async ([id, e]) => {
                const r = await restriction(id, e), net = subnet(e.lastIp || '');
                return { id, created: e.created, lastSeen: e.lastSeen, lastIp: e.lastIp || '', serverTime: Date.now(), ban: r?.ban ?? null, banSource: r?.source ?? null, banFrom: r && r.from !== id ? r.from : null,
                    profiles: Object.values(e.profiles || {}).map(p => ({ name: p.name, kind: p.kind, lastSeen: p.lastSeen })),
                    linked: Object.entries(identities).filter(([other, o]) => other !== id && (0, exports.samePc)(e, o)).map(([other]) => other),
                    // same network: a hint for the admin only, never a ban (banned = an install on that network is restricted)
                    network: net ? Object.entries(identities).filter(([other, o]) => other !== id && subnet(o.lastIp || '') === net).map(([other]) => other) : [],
                    networkBanned: net ? (await Promise.all(Object.entries(identities).filter(([other, o]) => other !== id && subnet(o.lastIp || '') === net).map(([other, o]) => restriction(other, o)))).some(Boolean) : false };
            })) };
    });
    app.post('/v1/admin/identity/ban', async (req, reply) => {
        admin(req);
        const input = zod_1.z.object({ id: Id, reason: zod_1.z.string().trim().min(1).max(500), expires: zod_1.z.number().int().positive().nullable() }).strict().safeParse(req.body);
        if (!input.success || input.data.expires !== null && input.data.expires <= Date.now())
            return reply.code(400).send({ error: 'Invalid restriction' });
        if (!identities[input.data.id])
            return reply.code(404).send({ error: 'Unknown identity' });
        return mutate(() => { identities[input.data.id].ban = { reason: input.data.reason, since: Date.now(), expires: input.data.expires }; return { ok: true }; });
    });
    app.post('/v1/admin/identity/revoke', async (req, reply) => {
        admin(req);
        const input = zod_1.z.object({ id: Id }).strict().safeParse(req.body);
        if (!input.success)
            return reply.code(400).send({ error: 'Invalid identity' });
        if (!identities[input.data.id])
            return reply.code(404).send({ error: 'Unknown identity' });
        return mutate(() => { identities[input.data.id].ban = null; return { ok: true }; });
    });
    // Attestation (attest.ts): the launcher's read token proves the device; the restriction covers its whole PC.
    return {
        verify: async (id, token) => { const e = identities[id]; if (!e || !(e.readers[digest(token)] > Date.now()))
            return false; return (await restriction(id, e))?.ban ?? null; },
        restriction: async (id) => { const e = identities[id]; return e ? (await restriction(id, e))?.ban ?? null : null; },
        /** For offline accounts (cosmetics.ts): is this install known with real hardware (2+ parts), and every install on its PC. */
        device: (id) => {
            const e = identities[id];
            if (!e)
                return null;
            return { hardware: Object.keys(e.hardware || {}).length >= exports.HARDWARE_MATCH, pc: [id, ...Object.entries(identities).filter(([other, o]) => other !== id && (0, exports.samePc)(e, o)).map(([other]) => other)] };
        },
    };
}
