"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAILY = void 0;
exports.registerDiscord = registerDiscord;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const zod_1 = require("zod");
const CODE_MS = 10 * 60000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DISCORD_REWARDS = ['discord-member-cape', 'discord-booster-cape', 'discord-invite-cape', 'discord-ambassador-cape', 'discord-legend-cape'];
const discordId = zod_1.z.string().regex(/^\d{17,20}$/);
const address = zod_1.z.string().regex(/^[-a-zA-Z0-9.:]{3,80}$/);
const QUEUE_MAX = 300, QUEUE_MS = 3 * 86400000, IMAGE_MAX = 4 * 1024 * 1024;
/** /daily: once per 20 h; the streak goes on when the last claim was within 48 h. 20 coins, +5 for each day of the streak, at most 50. */
exports.DAILY = { cooldown: 20 * 3600000, keep: 48 * 3600000, coins: (streak) => Math.min(50, 20 + 5 * (streak - 1)) };
const LIMITS = { share: [5, 3600000], crash: [3, 3600000], look: [3, 3600000] };
async function registerDiscord(app, root, user, hooks, botKey = process.env.EXER_BOT_KEY || '') {
    const file = node_path_1.default.join(root, 'discord.json'), files = node_path_1.default.join(root, 'discord-queue');
    const now = hooks.now || Date.now;
    let db = { links: {}, queue: [], news: [], daily: {} };
    try {
        db = { ...db, ...JSON.parse(await promises_1.default.readFile(file, 'utf8')) };
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
    await promises_1.default.mkdir(files, { recursive: true });
    let queue = Promise.resolve();
    const save = () => { const task = queue.then(async () => { await promises_1.default.writeFile(file + '.tmp', JSON.stringify(db)); await promises_1.default.rename(file + '.tmp', file); }); queue = task.catch(() => { }); return task; };
    const codes = new Map();
    const fail = (code, message) => Object.assign(Error(message), { statusCode: code });
    const digest = (s) => node_crypto_1.default.createHash('sha256').update(s).digest();
    const bot = (req) => {
        if (!botKey)
            throw fail(503, 'Discord bot is not configured.');
        const header = req.headers.authorization || '';
        if (!header.startsWith('Bot ') || !node_crypto_1.default.timingSafeEqual(digest(header.slice(4)), digest(botKey)))
            throw fail(401, 'Bad bot key.');
    };
    const linkOf = (uuid) => Object.entries(db.links).find(([, l]) => l.uuid === uuid);
    const linkedOrFail = (p) => { const l = linkOf(p.id); if (!l)
        throw fail(409, 'Najpierw połącz konto z Discordem (zakładka Discord).'); return l; };
    const recent = new Map();
    const limit = (key, [n, ms]) => {
        const t = now(), list = (recent.get(key) || []).filter(x => x > t - ms);
        if (list.length >= n)
            throw fail(429, 'Za dużo zgłoszeń. Spróbuj za jakiś czas.');
        list.push(t);
        recent.set(key, list);
    };
    const imageFile = (id) => node_path_1.default.join(files, id.replace(/[^a-z0-9]/g, '') + '.img');
    async function enqueue(kind, discord, data, image) {
        const t = now(), id = t.toString(36) + node_crypto_1.default.randomBytes(4).toString('hex');
        // old and surplus events go first (with their images)
        const drop = db.queue.filter((e, i) => e.at < t - QUEUE_MS || i < db.queue.length - QUEUE_MAX + 1);
        for (const e of drop)
            if (e.file)
                await promises_1.default.rm(imageFile(e.id), { force: true });
        db.queue = db.queue.filter(e => !drop.includes(e));
        if (image)
            await promises_1.default.writeFile(imageFile(id), image);
        db.queue.push({ id, kind, discordId: discord, at: t, data, file: !!image });
        await save();
        return id;
    }
    // DMs about friend requests and messages for linked players with DMs on, at most one per sender and kind in 10 minutes.
    const dmSent = new Map();
    hooks.onNotify((to, e) => {
        const l = linkOf(to);
        if (!l || !l[1].dm)
            return;
        const key = to + ':' + e.from + ':' + e.type, t = now();
        if ((dmSent.get(key) || 0) > t - 10 * 60000)
            return;
        dmSent.set(key, t);
        void enqueue('dm', l[0], { type: e.type, from: e.from, text: e.text?.slice(0, 300) || '', name: l[1].name }).catch(() => { });
    });
    const linkView = (l) => ({ discordName: l.discordName, at: l.at, progress: l.progress || null, dm: !!l.dm });
    // Launcher: a code for /link, and the current link (if any). Unlinking happens on Discord (/unlink), so the bot can take
    // the Discord rewards back first.
    app.post('/v1/discord/code', async (req, reply) => {
        const p = user(req), t = now();
        for (const [k, v] of codes)
            if (v.expires < t || v.profile.id === p.id)
                codes.delete(k);
        if (codes.size > 5000)
            return reply.code(429).send({ error: 'Spróbuj ponownie później.' });
        const code = Array.from(node_crypto_1.default.randomBytes(8), b => ALPHABET[b % ALPHABET.length]).join('');
        codes.set(code, { profile: p, expires: t + CODE_MS });
        const link = linkOf(p.id);
        reply.header('Cache-Control', 'no-store');
        return { code, expires: t + CODE_MS, linked: link ? linkView(link[1]) : null };
    });
    // Launcher Discord tab: the current link, invite progress and settings without making a code.
    app.get('/v1/discord/link', async (req, reply) => {
        const link = linkOf(user(req).id);
        reply.header('Cache-Control', 'no-store');
        return { linked: link ? linkView(link[1]) : null };
    });
    app.post('/v1/discord/unlink', async (req) => {
        const p = user(req), found = linkOf(p.id);
        if (found) {
            const [id, link] = found;
            for (const c of DISCORD_REWARDS)
                await hooks.grant('discord-bot', link.uuid, link.name, c, false).catch(() => { });
            delete db.links[id];
            await save();
        }
        return { ok: true, linked: null };
    });
    app.post('/v1/discord/settings', async (req) => {
        const [, l] = linkedOrFail(user(req));
        const v = zod_1.z.object({ dm: zod_1.z.boolean() }).safeParse(req.body);
        if (!v.success)
            throw fail(400, 'Nieprawidłowe dane.');
        l.dm = v.data.dm;
        await save();
        return { linked: linkView(l) };
    });
    // Screenshot from the launcher gallery to the screenshots channel (JPEG or PNG, at most 4 MB).
    app.post('/v1/discord/share', { bodyLimit: 6 * 1024 * 1024 }, async (req) => {
        const p = user(req), [id, l] = linkedOrFail(p);
        const v = zod_1.z.object({ image: zod_1.z.string().max(6 * 1024 * 1024), caption: zod_1.z.string().trim().max(200).default(''), version: zod_1.z.string().regex(/^[0-9a-z.]{0,20}$/i).default('') }).safeParse(req.body);
        if (!v.success)
            throw fail(400, 'Nieprawidłowe dane.');
        const image = Buffer.from(v.data.image, 'base64');
        const jpeg = image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff, png = image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        if (!jpeg && !png)
            throw fail(400, 'To nie jest obraz PNG ani JPEG.');
        if (image.length > IMAGE_MAX)
            throw fail(413, 'Zrzut jest za duży (maks. 4 MB).');
        limit('share:' + p.id, LIMITS.share);
        await enqueue('share', id, { name: p.name, caption: v.data.caption, version: v.data.version, type: jpeg ? 'jpg' : 'png' }, image);
        return { ok: true, discordName: l.discordName };
    });
    // "Share your look" (locker): the outfit image for the member's cosmetics channel (PNG, at most 4 MB).
    app.post('/v1/discord/look', { bodyLimit: 6 * 1024 * 1024 }, async (req) => {
        const p = user(req), [id, l] = linkedOrFail(p);
        const v = zod_1.z.object({ image: zod_1.z.string().max(6 * 1024 * 1024), caption: zod_1.z.string().trim().max(200).default('') }).safeParse(req.body);
        if (!v.success)
            throw fail(400, 'Nieprawidłowe dane.');
        const image = Buffer.from(v.data.image, 'base64');
        if (!image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
            throw fail(400, 'To nie jest obraz PNG.');
        if (image.length > IMAGE_MAX)
            throw fail(413, 'Obraz jest za duży (maks. 4 MB).');
        limit('look:' + p.id, LIMITS.look);
        await enqueue('look', id, { name: p.name, caption: v.data.caption, type: 'png' }, image);
        return { ok: true, discordName: l.discordName };
    });
    // Crash assistant: a ticket on Discord with what the launcher found.
    app.post('/v1/discord/crash', async (req) => {
        const p = user(req), [id] = linkedOrFail(p);
        const v = zod_1.z.object({ version: zod_1.z.string().max(20), cause: zod_1.z.string().regex(/^[a-z-]{1,30}$/), detail: zod_1.z.string().max(500).default(''), excerpt: zod_1.z.string().max(8000).default(''), mods: zod_1.z.array(zod_1.z.string().regex(/^[a-z0-9_.-]{2,64}$/)).max(20).default([]) }).safeParse(req.body);
        if (!v.success)
            throw fail(400, 'Nieprawidłowe dane.');
        limit('crash:' + p.id, LIMITS.crash);
        await enqueue('crash', id, { name: p.name, ...v.data });
        return { ok: true };
    });
    // Bot: redeem a code, read or remove a link, give or take rewards.
    app.post('/v1/bot/link', async (req, reply) => {
        bot(req);
        const v = zod_1.z.object({ code: zod_1.z.string().trim().toUpperCase().pipe(zod_1.z.string().regex(/^[A-Z0-9]{8}$/)), discordId, discordName: zod_1.z.string().max(40).default('') }).safeParse(req.body);
        if (!v.success)
            return reply.code(400).send({ error: 'bad input' });
        const entry = codes.get(v.data.code);
        codes.delete(v.data.code);
        if (!entry || entry.expires < now())
            return reply.code(404).send({ error: 'unknown or expired code' });
        // offline accounts: one Discord account per EXER device and one device per Discord account, for good
        const owner = hooks.offlineOwner?.(entry.profile.id);
        if (owner) {
            const devices = db.devices ||= {};
            const pc = hooks.samePc?.(owner) ?? [owner];
            const bound = pc.map(d => devices[d]).find(Boolean), taken = Object.entries(devices).some(([d, discord]) => !pc.includes(d) && discord === v.data.discordId);
            if (bound && bound !== v.data.discordId || taken)
                return reply.code(409).send({ error: 'device bound to another Discord account' });
            devices[owner] = v.data.discordId;
        }
        // one Minecraft account per Discord account and the other way round
        const old = linkOf(entry.profile.id);
        if (old)
            delete db.links[old[0]];
        db.links[v.data.discordId] = { uuid: entry.profile.id, name: entry.profile.name, discordName: v.data.discordName, at: new Date(now()).toISOString() };
        await save();
        await hooks.grant('discord-bot', entry.profile.id, entry.profile.name, 'discord-member-cape', true).catch(() => { });
        return { uuid: entry.profile.id, name: entry.profile.name };
    });
    app.get('/v1/bot/link/:id', async (req, reply) => {
        bot(req);
        const link = db.links[req.params.id];
        return link || reply.code(404).send({ error: 'not linked' });
    });
    app.delete('/v1/bot/link/:id', async (req) => {
        bot(req);
        const id = req.params.id, link = db.links[id];
        if (link) {
            for (const c of DISCORD_REWARDS)
                await hooks.grant('discord-bot', link.uuid, link.name, c, false).catch(() => { });
            delete db.links[id];
            await save();
        }
        return { ok: true, unlinked: link || null };
    });
    app.post('/v1/bot/rewards', async (req, reply) => {
        bot(req);
        const v = zod_1.z.object({ discordId, cosmeticId: zod_1.z.string().regex(/^[a-z0-9_-]{1,40}$/), grant: zod_1.z.boolean() }).safeParse(req.body);
        if (!v.success)
            return reply.code(400).send({ error: 'bad input' });
        const link = db.links[v.data.discordId];
        if (!link)
            return reply.code(404).send({ error: 'not linked' });
        if (!await hooks.grant('discord-bot', link.uuid, link.name, v.data.cosmeticId, v.data.grant))
            return reply.code(404).send({ error: 'no such cosmetic' });
        return { ok: true, player: link.name };
    });
    // Invite count and boost, shown in the launcher's Discord tab.
    app.post('/v1/bot/progress', async (req, reply) => {
        bot(req);
        const v = zod_1.z.object({ discordId, invites: zod_1.z.number().int().min(0).max(100000), best: zod_1.z.number().int().min(0).max(100000), booster: zod_1.z.boolean() }).safeParse(req.body);
        if (!v.success)
            return reply.code(400).send({ error: 'bad input' });
        const link = db.links[v.data.discordId];
        if (!link)
            return reply.code(404).send({ error: 'not linked' });
        const { discordId: _, ...progress } = v.data;
        if (JSON.stringify({ ...link.progress, at: '' }) !== JSON.stringify({ ...progress, at: '' })) {
            link.progress = { ...progress, at: new Date(now()).toISOString() };
            await save();
        }
        await hooks.grant('discord-bot', link.uuid, link.name, 'discord-member-cape', true).catch(() => { });
        if (v.data.booster)
            await hooks.grant('discord-bot', link.uuid, link.name, 'discord-booster-cape', true).catch(() => { });
        if (v.data.best >= 3)
            await hooks.grant('discord-bot', link.uuid, link.name, 'discord-invite-cape', true).catch(() => { });
        if (v.data.best >= 10)
            await hooks.grant('discord-bot', link.uuid, link.name, 'discord-ambassador-cape', true).catch(() => { });
        if (v.data.best >= 25)
            await hooks.grant('discord-bot', link.uuid, link.name, 'discord-legend-cape', true).catch(() => { });
        return { ok: true };
    });
    // Launcher → Discord queue: list, image of a share, and acknowledge what was handled.
    app.get('/v1/bot/queue', async (req, reply) => {
        bot(req);
        reply.header('Cache-Control', 'no-store');
        return { events: db.queue.filter(e => e.at > now() - QUEUE_MS).slice(0, 50) };
    });
    app.get('/v1/bot/queue/:id/file', async (req, reply) => {
        bot(req);
        const e = db.queue.find(x => x.id === req.params.id && x.file);
        if (!e)
            return reply.code(404).send({ error: 'no such file' });
        reply.header('Cache-Control', 'no-store').type(e.data.type === 'png' ? 'image/png' : 'image/jpeg');
        return promises_1.default.readFile(imageFile(e.id));
    });
    app.post('/v1/bot/queue/ack', async (req, reply) => {
        bot(req);
        const v = zod_1.z.object({ ids: zod_1.z.array(zod_1.z.string().max(40)).max(100) }).safeParse(req.body);
        if (!v.success)
            return reply.code(400).send({ error: 'bad input' });
        const done = db.queue.filter(e => v.data.ids.includes(e.id));
        for (const e of done)
            if (e.file)
                await promises_1.default.rm(imageFile(e.id), { force: true });
        db.queue = db.queue.filter(e => !done.includes(e));
        if (done.length)
            await save();
        return { ok: true, removed: done.length };
    });
    // Announcements posted on Discord also show in the launcher (bell).
    app.post('/v1/bot/news', async (req, reply) => {
        bot(req);
        const v = zod_1.z.object({ id: zod_1.z.string().regex(/^[a-z0-9-]{1,40}$/), kind: zod_1.z.string().regex(/^[a-z]{1,20}$/), title: zod_1.z.string().max(120), body: zod_1.z.string().max(1500),
            titlePl: zod_1.z.string().max(120).optional(), bodyPl: zod_1.z.string().max(1500).optional(), url: zod_1.z.string().regex(/^https:\/\/(discord\.com|exerclient\.com)\/[-\w/.?=&]{0,200}$/).optional() }).safeParse(req.body);
        if (!v.success)
            return reply.code(400).send({ error: 'bad input' });
        db.news = [{ ...v.data, at: new Date(now()).toISOString() }, ...db.news.filter(n => n.id !== v.data.id)].slice(0, 20);
        await save();
        return { ok: true };
    });
    // Partner roles: each partner subgroup with the Discord ids of its linked members (unlinked members cannot get a role).
    app.get('/v1/bot/groups', async (req) => {
        bot(req);
        const discordOf = new Map(Object.entries(db.links).map(([d, l]) => [l.uuid, d]));
        return { groups: (hooks.partnerGroups?.() || []).map(({ members, ...g }) => ({ ...g, members: members.map(id => discordOf.get(id)).filter(Boolean) })) };
    });
    // Linked players: in game now and time played, for the "in game" and playtime roles.
    app.get('/v1/bot/activity', async (req) => {
        bot(req);
        return { players: Object.fromEntries(Object.entries(db.links).map(([d, l]) => [d, { status: hooks.where(l.uuid).status, playMinutes: hooks.playMinutes(l.uuid) }])) };
    });
    // /where <nick>: status for everyone; the server only for the player and their EXER friends (asker = their Discord id).
    app.get('/v1/bot/where/:name', async (req, reply) => {
        bot(req);
        const name = zod_1.z.string().regex(/^[A-Za-z0-9_]{3,16}$/).safeParse(req.params.name);
        if (!name.success)
            return reply.code(400).send({ error: 'bad nick' });
        const profile = await hooks.profile(name.data).catch(() => null);
        if (!profile)
            return reply.code(404).send({ error: 'no such player' });
        const w = hooks.where(profile.id), asker = db.links[String(req.query?.asker || '')]?.uuid;
        const allowed = !!asker && (asker === profile.id || hooks.friendsWith(asker, profile.id));
        return { id: profile.id, name: profile.name, status: w.status, version: w.version, server: allowed ? w.server : '', hidden: !allowed && !!w.server };
    });
    // /daily: EXER Coins once a day, more for a streak.
    app.post('/v1/bot/daily', async (req, reply) => {
        bot(req);
        const v = zod_1.z.object({ discordId }).safeParse(req.body);
        if (!v.success)
            return reply.code(400).send({ error: 'bad input' });
        const link = db.links[v.data.discordId];
        if (!link)
            return reply.code(404).send({ error: 'not linked' });
        const t = now(), last = db.daily[link.uuid];
        if (last && t - last.last < exports.DAILY.cooldown)
            return reply.code(429).send({ error: 'wait', next: last.last + exports.DAILY.cooldown });
        const streak = last && t - last.last < exports.DAILY.keep ? last.streak + 1 : 1, gained = Math.round(exports.DAILY.coins(streak) * (hooks.coinMultiplier?.() ?? 1));
        const coins = await hooks.addCoins('discord-daily', link.uuid, link.name, gained);
        db.daily[link.uuid] = { last: t, streak };
        await save();
        return { ok: true, gained, streak, coins, next: t + exports.DAILY.cooldown };
    });
    // Public: the online counter, /profile, news for the launcher and "join" links that open the launcher.
    app.get('/v1/public/stats', async (req, reply) => {
        reply.header('Cache-Control', 'public, max-age=60');
        const s = hooks.stats();
        if (req.query?.full === '1')
            return s;
        return { online: s.online, inGame: s.inGame };
    });
    app.get('/v1/public/profile/:name', async (req, reply) => {
        const name = zod_1.z.string().regex(/^[A-Za-z0-9_]{3,16}$/).safeParse(req.params.name);
        if (!name.success)
            return reply.code(400).send({ error: 'bad nick' });
        const profile = await hooks.profile(name.data).catch(() => null);
        if (!profile)
            return reply.code(404).send({ error: 'no such player' });
        reply.header('Cache-Control', 'public, max-age=60');
        return profile;
    });
    app.get('/v1/public/news', async (_req, reply) => { reply.header('Cache-Control', 'public, max-age=60'); return { news: db.news.slice(0, 10) }; });
    // Discord link buttons must be https: this page hands the server address to the launcher (exer://join/<address>).
    app.get('/join/:address', async (req, reply) => {
        const a = address.safeParse(req.params.address);
        if (!a.success)
            return reply.code(400).type('text/plain').send('Bad server address.');
        const target = 'exer://join/' + a.data;
        reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'").header('Cache-Control', 'no-store').type('text/html; charset=utf-8');
        return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${target}"><title>EXER · ${a.data}</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;background:#0c0d10;color:#eee;display:grid;place-items:center;height:100vh;margin:0;text-align:center}a{color:#ffa32d}</style></head>
<body><div><h2>Otwieram EXER Client…</h2><p>Serwer: <b>${a.data}</b></p><p><a href="${target}">Otwórz launcher</a> · <a href="https://exerclient.com">Nie masz EXER? Pobierz</a></p></div></body></html>`;
    });
    // for other modules: is this Minecraft account linked to Discord (player profile badge)
    return {
        linked: (uuid) => !!linkOf(uuid),
        /** an EXER device verified its offline accounts with a Discord account */
        deviceVerified: (owner) => !!db.devices?.[owner],
        /** the /daily streak now (0 when the last claim is older than DAILY.keep) */
        streak: (uuid) => { const d = db.daily[uuid]; return d && now() - d.last < exports.DAILY.keep ? d.streak : 0; },
        /** last week's ranking for the bot (posted in the highlights channel) */
        announceRanking: (data) => enqueue('ranking', '', data).catch(() => ''),
        /** unusual staff activity (many bans in a short time) for the staff log */
        staffAlert: (data) => enqueue('staff', '', data).catch(() => ''),
        /** the owner lifted every restriction: "second chance" announcement */
        announceAmnesty: (data) => enqueue('amnesty', '', data).catch(() => ''),
        /** a server banner application was reviewed: DM to the applicant */
        bannerNotice: (discordId, data) => enqueue('banner', discordId, data).catch(() => '')
    };
}
