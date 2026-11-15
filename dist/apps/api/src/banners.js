"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BANNER_MAX_BYTES = exports.BANNER_SIZES = void 0;
exports.bannerHost = bannerHost;
exports.pngSize = pngSize;
exports.checkBannerImage = checkBannerImage;
exports.motdText = motdText;
exports.pingServer = pingServer;
exports.registerBanners = registerBanners;
const node_crypto_1 = __importDefault(require("node:crypto"));
const promises_1 = __importDefault(require("node:dns/promises"));
const promises_2 = __importDefault(require("node:fs/promises"));
const node_net_1 = __importDefault(require("node:net"));
const node_path_1 = __importDefault(require("node:path"));
const zod_1 = require("zod");
const attest_1 = require("./attest");
exports.BANNER_SIZES = [[468, 60], [936, 120]];
exports.BANNER_MAX_BYTES = 512 * 1024;
const MAX_BANNERS = 500, MAX_PENDING = 200;
/** Lower-case host plus ":port" only when it is not 25565; null for an invalid address. */
function bannerHost(value) {
    const a = (0, attest_1.blacklistAddress)(value);
    if (!/^[a-z0-9.-]{1,253}$/.test(a.host) && !node_net_1.default.isIP(a.host))
        return null;
    if (!a.host.includes('.') && !node_net_1.default.isIP(a.host))
        return null;
    return (0, attest_1.blacklistKey)(a.host, a.port);
}
/** Width and height of a PNG, or null when the bytes are not a PNG. */
function pngSize(b) {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (b.length < 24 || !b.subarray(0, 8).equals(sig) || b.toString('ascii', 12, 16) !== 'IHDR')
        return null;
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
/** Checks a banner image; returns the error text (Polish) or the size. */
function checkBannerImage(b) {
    if (b.length > exports.BANNER_MAX_BYTES)
        return { error: `Plik jest za duży (max ${exports.BANNER_MAX_BYTES / 1024} KB).` };
    const size = pngSize(b);
    if (!size)
        return { error: 'Banner musi być plikiem PNG.' };
    if (!exports.BANNER_SIZES.some(([w, h]) => w === size.width && h === size.height))
        return { error: `Banner musi mieć 468x60 albo 936x120 px (ten ma ${size.width}x${size.height}).` };
    return size;
}
// ---- Server List Ping (the status packet every Minecraft client sends) ----
const varint = (n) => { const out = []; do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n)
        b |= 0x80;
    out.push(b);
} while (n); return Buffer.from(out); };
const packet = (...parts) => { const body = Buffer.concat(parts); return Buffer.concat([varint(body.length), body]); };
function readVarint(b, at) { let n = 0, shift = 0; for (let i = at; i < b.length && i < at + 5; i++) {
    n |= (b[i] & 0x7f) << shift;
    shift += 7;
    if (!(b[i] & 0x80))
        return [n, i + 1];
} return null; }
/** Flattens a chat component (or a plain string) into text with § colour codes. */
function motdText(v) {
    if (typeof v === 'string')
        return v;
    if (!v || typeof v !== 'object')
        return '';
    const o = v;
    let s = typeof o.text === 'string' ? o.text : '';
    if (Array.isArray(o.extra))
        for (const e of o.extra)
            s += motdText(e);
    return s;
}
async function pingServer(address, timeoutMs = 4000) {
    const a = (0, attest_1.blacklistAddress)(address);
    let host = a.host, port = a.port ?? 25565;
    if (a.port === null && !node_net_1.default.isIP(host)) {
        try {
            const srv = await promises_1.default.resolveSrv('_minecraft._tcp.' + host);
            if (srv[0]) {
                host = srv[0].name;
                port = srv[0].port;
            }
        }
        catch { }
    }
    const started = Date.now();
    return await new Promise((resolve, reject) => {
        const socket = node_net_1.default.connect({ host, port });
        let buf = Buffer.alloc(0);
        const done = (e, s) => { socket.destroy(); clearTimeout(timer); e ? reject(e) : resolve(s); };
        const timer = setTimeout(() => done(Error('timeout')), timeoutMs);
        socket.on('error', e => done(e));
        socket.on('connect', () => {
            const name = Buffer.from(a.host, 'utf8');
            const p = Buffer.alloc(2);
            p.writeUInt16BE(a.port ?? 25565);
            socket.write(packet(varint(0), varint(767), varint(name.length), name, p, varint(1)));
            socket.write(packet(varint(0)));
        });
        socket.on('data', d => {
            buf = Buffer.concat([buf, d]);
            const len = readVarint(buf, 0);
            if (!len || buf.length < len[1] + len[0])
                return;
            const id = readVarint(buf, len[1]);
            if (!id)
                return done(Error('bad reply'));
            const sl = readVarint(buf, id[1]);
            if (!sl)
                return done(Error('bad reply'));
            try {
                const j = JSON.parse(buf.toString('utf8', sl[1], sl[1] + sl[0]));
                done(undefined, { online: true, motd: motdText(j.description).slice(0, 400), players: Number(j.players?.online) || 0, max: Number(j.players?.max) || 0, version: String(j.version?.name || '').slice(0, 60), ms: Date.now() - started });
            }
            catch {
                done(Error('bad reply'));
            }
        });
    });
}
const offline = { online: false, motd: '', players: 0, max: 0, version: '', ms: 0 };
const owners = zod_1.z.object({ mc: zod_1.z.array(zod_1.z.string().regex(/^[A-Za-z0-9_]{3,16}$/)).max(10).default([]), discord: zod_1.z.array(zod_1.z.string().regex(/^\d{5,25}$/)).max(10).default([]) });
const fields = {
    name: zod_1.z.string().trim().min(2).max(40),
    hosts: zod_1.z.array(zod_1.z.string().max(120)).min(1).max(5),
    owners,
    invite: zod_1.z.string().trim().max(120).default(''),
    description: zod_1.z.string().trim().max(200).default('')
};
const image = zod_1.z.string().max(Math.ceil(exports.BANNER_MAX_BYTES * 4 / 3) + 8);
const id = () => node_crypto_1.default.randomBytes(6).toString('hex');
const hash = (b) => node_crypto_1.default.createHash('sha256').update(b).digest('hex').slice(0, 16);
async function registerBanners(app, root, hooks, botKey = process.env.EXER_BOT_KEY || '') {
    const file = node_path_1.default.join(root, 'banners.json');
    const dir = node_path_1.default.join(root, 'banners');
    await promises_2.default.mkdir(dir, { recursive: true });
    let db = { banners: [], applications: [] };
    try {
        db = { ...db, ...JSON.parse(await promises_2.default.readFile(file, 'utf8')) };
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
    const ping = hooks.ping || pingServer;
    let queue = Promise.resolve();
    const save = () => { queue = queue.then(async () => { const tmp = file + '.tmp'; await promises_2.default.writeFile(tmp, JSON.stringify(db)); await promises_2.default.rename(tmp, file); }); return queue; };
    const fail = (code, error) => Object.assign(Error(error), { statusCode: code, expose: true });
    const bot = (req) => {
        const h = String(req.headers.authorization || '');
        const d = (s) => node_crypto_1.default.createHash('sha256').update(s).digest();
        if (!botKey)
            throw fail(503, 'Bot key not configured.');
        if (!h.startsWith('Bot ') || !node_crypto_1.default.timingSafeEqual(d(h.slice(4)), d(botKey)))
            throw fail(401, 'Bad bot key.');
    };
    const admin = (req) => hooks.user(req, 'partners.manage');
    const hostsOf = (list) => {
        const out = [];
        for (const h of list) {
            const v = bannerHost(h);
            if (!v)
                throw fail(400, `Nieprawidłowy adres: ${h}`);
            if (!out.includes(v))
                out.push(v);
        }
        if (hooks.serverBlocked && out.some(h => hooks.serverBlocked(h)))
            throw fail(403, 'Ten serwer jest na czarnej liście EXER.');
        return out;
    };
    const readImage = (b64) => {
        const b = Buffer.from(b64.replace(/^data:image\/png;base64,/, ''), 'base64');
        const r = checkBannerImage(b);
        if ('error' in r)
            throw fail(400, r.error);
        return { bytes: b, ...r, hash: hash(b) };
    };
    const writeImage = async (name, b) => { const tmp = node_path_1.default.join(dir, name + '.tmp'); await promises_2.default.writeFile(tmp, b); await promises_2.default.rename(tmp, node_path_1.default.join(dir, name)); };
    const removeImage = async (name) => { if (name)
        await promises_2.default.rm(node_path_1.default.join(dir, name), { force: true }); };
    const used = (name) => db.banners.some(b => b.file === name) || db.applications.some(a => a.file === name);
    const partners = () => new Set((hooks.partnerHosts?.() || []).map(h => bannerHost(h)).filter(Boolean));
    const pub = (b) => { const p = partners(); return { id: b.id, name: b.name, hosts: b.hosts, url: '/assets/banners/' + b.file, hash: b.hash, width: b.width, height: b.height, partner: b.hosts.some(h => p.has(h)), invite: b.invite, description: b.description }; };
    /** Another enabled banner already shows one of these hosts. */
    const taken = (hosts, except) => db.banners.find(b => b.id !== except && b.enabled && b.hosts.some(h => hosts.includes(h)));
    async function apply(input, applicant) {
        const v = zod_1.z.object({ ...fields, image, replaces: zod_1.z.string().max(20).optional() }).parse(input);
        if (db.applications.filter(a => a.status === 'pending').length >= MAX_PENDING)
            throw fail(429, 'Za dużo zgłoszeń czeka na sprawdzenie.');
        const hosts = hostsOf(v.hosts);
        if (v.replaces) {
            const b = db.banners.find(x => x.id === v.replaces);
            if (!b)
                throw fail(404, 'Nie ma takiego bannera.');
            if (!b.owners.discord.includes(applicant))
                throw fail(403, 'Tylko właściciel serwera może zmienić jego banner.');
        }
        else {
            const t = taken(hosts);
            if (t)
                throw fail(409, `Ten serwer ma już banner (${t.name}). Właściciel może go zmienić: /baner aktualizuj.`);
        }
        if (db.applications.some(a => a.status === 'pending' && a.applicant === applicant))
            throw fail(409, 'Masz już zgłoszenie, które czeka na sprawdzenie.');
        const img = readImage(v.image);
        const now = new Date().toISOString();
        const a = { id: id(), status: 'pending', name: v.name, hosts, owners: { mc: v.owners.mc, discord: [...new Set([applicant, ...v.owners.discord])] },
            applicant, invite: v.invite, description: v.description, file: '', hash: img.hash, width: img.width, height: img.height,
            code: 'EXER-' + node_crypto_1.default.randomBytes(3).toString('hex').toUpperCase(), verified: false, replaces: v.replaces, createdAt: now, updatedAt: now };
        a.file = `pending-${a.id}-${img.hash}.png`;
        await writeImage(a.file, img.bytes);
        db.applications.unshift(a);
        db.applications = db.applications.slice(0, 1000);
        await save();
        return a;
    }
    /** Pings the server and looks for the application's code in the MOTD. */
    async function verify(appId) {
        const a = db.applications.find(x => x.id === appId);
        if (!a)
            throw fail(404, 'Nie ma takiego zgłoszenia.');
        let s = offline;
        for (const h of a.hosts) {
            try {
                s = await ping(h);
                if (s.online)
                    break;
            }
            catch {
                s = offline;
            }
        }
        a.check = s;
        if (s.online && s.motd.replace(/§./g, '').toUpperCase().includes(a.code))
            a.verified = true;
        a.updatedAt = new Date().toISOString();
        await save();
        return a;
    }
    async function review(appId, input, by) {
        const v = zod_1.z.object({ action: zod_1.z.enum(['accept', 'reject', 'changes']), reason: zod_1.z.string().trim().max(300).default('') }).parse(input);
        const a = db.applications.find(x => x.id === appId);
        if (!a)
            throw fail(404, 'Nie ma takiego zgłoszenia.');
        if (a.status !== 'pending' && a.status !== 'changes')
            throw fail(409, 'To zgłoszenie jest już zamknięte.');
        const now = new Date().toISOString();
        let banner;
        if (v.action === 'accept') {
            if (hooks.serverBlocked && a.hosts.some(h => hooks.serverBlocked(h)))
                throw fail(403, 'Ten serwer jest na czarnej liście EXER.');
            const t = taken(a.hosts, a.replaces);
            if (t)
                throw fail(409, `Ten serwer ma już banner (${t.name}).`);
            const final = `${a.replaces || a.id}-${a.hash}.png`;
            await promises_2.default.copyFile(node_path_1.default.join(dir, a.file), node_path_1.default.join(dir, final));
            const old = a.replaces ? db.banners.find(b => b.id === a.replaces) : undefined;
            if (old) {
                const prev = old.file;
                Object.assign(old, { name: a.name, hosts: a.hosts, file: final, hash: a.hash, width: a.width, height: a.height, owners: a.owners, invite: a.invite, description: a.description, enabled: true, updatedAt: now, by });
                banner = old;
                if (prev !== final && !used(prev))
                    await removeImage(prev);
            }
            else {
                if (db.banners.length >= MAX_BANNERS)
                    throw fail(429, 'Osiągnięto limit bannerów.');
                banner = { id: a.id, name: a.name, hosts: a.hosts, file: final, hash: a.hash, width: a.width, height: a.height, owners: a.owners, invite: a.invite, description: a.description, enabled: true, createdAt: now, updatedAt: now, by };
                db.banners.push(banner);
            }
        }
        a.status = v.action === 'accept' ? 'accepted' : v.action === 'reject' ? 'rejected' : 'changes';
        a.reason = v.reason;
        a.reviewedBy = by;
        a.updatedAt = now;
        const pending = a.file;
        if (a.status === 'accepted' || a.status === 'rejected') {
            a.file = '';
            if (!used(pending))
                await removeImage(pending);
        }
        await save();
        hooks.notify?.(a.applicant, { type: 'banner-review', status: a.status, name: a.name, reason: a.reason, by });
        return { application: a, banner: banner ? pub(banner) : null };
    }
    async function edit(bannerId, input, by) {
        const v = zod_1.z.object({ name: fields.name.optional(), hosts: fields.hosts.optional(), owners: owners.optional(), invite: fields.invite.optional(), description: fields.description.optional(),
            enabled: zod_1.z.boolean().optional(), image: image.optional() }).parse(input);
        const b = db.banners.find(x => x.id === bannerId);
        if (!b)
            throw fail(404, 'Nie ma takiego bannera.');
        if (v.hosts) {
            const hosts = hostsOf(v.hosts);
            const t = taken(hosts, b.id);
            if (t)
                throw fail(409, `Ten serwer ma już banner (${t.name}).`);
            b.hosts = hosts;
        }
        if (v.enabled === true) {
            const t = taken(b.hosts, b.id);
            if (t)
                throw fail(409, `Ten serwer ma już banner (${t.name}).`);
        }
        if (v.image) {
            const img = readImage(v.image);
            const prev = b.file;
            const final = `${b.id}-${img.hash}.png`;
            await writeImage(final, img.bytes);
            Object.assign(b, { file: final, hash: img.hash, width: img.width, height: img.height });
            if (prev !== final && !used(prev))
                await removeImage(prev);
        }
        for (const k of ['name', 'owners', 'invite', 'description', 'enabled'])
            if (v[k] !== undefined)
                b[k] = v[k];
        b.updatedAt = new Date().toISOString();
        b.by = by;
        await save();
        return pub(b);
    }
    async function create(input, by) {
        const v = zod_1.z.object({ ...fields, image }).parse(input);
        const hosts = hostsOf(v.hosts);
        const t = taken(hosts);
        if (t)
            throw fail(409, `Ten serwer ma już banner (${t.name}).`);
        if (db.banners.length >= MAX_BANNERS)
            throw fail(429, 'Osiągnięto limit bannerów.');
        const img = readImage(v.image);
        const now = new Date().toISOString();
        const bid = id();
        const b = { id: bid, name: v.name, hosts, file: `${bid}-${img.hash}.png`, hash: img.hash, width: img.width, height: img.height, owners: v.owners,
            invite: v.invite, description: v.description, enabled: true, createdAt: now, updatedAt: now, by };
        await writeImage(b.file, img.bytes);
        db.banners.push(b);
        await save();
        return pub(b);
    }
    async function remove(bannerId) {
        const b = db.banners.find(x => x.id === bannerId);
        if (!b)
            throw fail(404, 'Nie ma takiego bannera.');
        db.banners = db.banners.filter(x => x !== b);
        if (!used(b.file))
            await removeImage(b.file);
        await save();
        return { ok: true };
    }
    const full = (b) => ({ ...pub(b), owners: b.owners, enabled: b.enabled, createdAt: b.createdAt, updatedAt: b.updatedAt, by: b.by });
    const listAll = () => ({ banners: db.banners.map(full), applications: db.applications.filter(a => a.status === 'pending' || a.status === 'changes').map(a => ({ ...a, url: a.file ? '/assets/banners/' + a.file : '' })) });
    const wrap = (fn) => async (req, reply) => {
        try {
            return await fn(req, reply);
        }
        catch (e) {
            if (e instanceof zod_1.z.ZodError)
                return reply.code(400).send({ error: 'Nieprawidłowe dane bannera.' });
            if (e.statusCode)
                return reply.code(e.statusCode).send({ error: e.message });
            throw e;
        }
    };
    const big = { bodyLimit: 2 * 1024 * 1024 };
    // public
    app.get('/v1/servers/banners', async (_req, reply) => { reply.header('Cache-Control', 'public, max-age=60'); return db.banners.filter(b => b.enabled).map(pub); });
    app.get('/assets/banners/:file', async (req, reply) => {
        const name = String(req.params.file);
        if (!/^[a-z0-9-]{1,80}\.png$/.test(name))
            return reply.code(404).send({ error: 'Not found' });
        try {
            const b = await promises_2.default.readFile(node_path_1.default.join(dir, name));
            reply.header('Cache-Control', 'public, max-age=86400, immutable');
            return reply.type('image/png').send(b);
        }
        catch {
            return reply.code(404).send({ error: 'Not found' });
        }
    });
    // Discord bot
    app.get('/v1/bot/banners', wrap(async (req) => { bot(req); return listAll(); }));
    app.post('/v1/bot/banners/apply', big, wrap(async (req) => { bot(req); const applicant = zod_1.z.string().regex(/^\d{5,25}$/).parse(req.body?.applicant); return apply(req.body, applicant); }));
    app.post('/v1/bot/banners/:id/verify', wrap(async (req) => { bot(req); return verify(req.params.id); }));
    app.post('/v1/bot/banners/:id/review', wrap(async (req) => { bot(req); return review(req.params.id, req.body, 'discord:' + String(req.body?.by || '').slice(0, 40)); }));
    app.post('/v1/bot/banners/:id/edit', big, wrap(async (req) => { bot(req); return edit(req.params.id, req.body, 'discord:' + String(req.body?.by || '').slice(0, 40)); }));
    app.delete('/v1/bot/banners/:id', wrap(async (req) => { bot(req); return remove(req.params.id); }));
    // launcher admin tab
    app.get('/v1/admin/banners', wrap(async (req) => { admin(req); return listAll(); }));
    app.post('/v1/admin/banners', big, wrap(async (req) => { const p = admin(req); return create(req.body, p.name); }));
    app.post('/v1/admin/banners/:id/verify', wrap(async (req) => { admin(req); return verify(req.params.id); }));
    app.post('/v1/admin/banners/:id/review', wrap(async (req) => { const p = admin(req); return review(req.params.id, req.body, p.name); }));
    app.post('/v1/admin/banners/:id/edit', big, wrap(async (req) => { const p = admin(req); return edit(req.params.id, req.body, p.name); }));
    app.delete('/v1/admin/banners/:id', wrap(async (req) => { admin(req); return remove(req.params.id); }));
    return { list: () => db.banners.filter(b => b.enabled).map(pub) };
}
