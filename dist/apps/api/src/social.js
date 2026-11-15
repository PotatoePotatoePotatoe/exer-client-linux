"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanNote = exports.MAX_NOTE = void 0;
exports.mojangLookup = mojangLookup;
exports.registerSocial = registerSocial;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const zod_1 = require("zod");
// The first partner creator; an admin edits or removes her in the launcher (Partners page).
const MALINOWSKA = { id: 'malinowska', name: 'Malinowska Graphics', role: 'Grafika Minecraft • Render 3D • Design', roleEn: 'Minecraft graphics • 3D renders • Design',
    text: 'Oficjalna partnerka graficzna EXER Client. Tworzy oprawy graficzne, rendery 3D, bannery i miniatury dla twórców i serwerów Minecraft.',
    textEn: 'The official graphics partner of EXER Client. She makes Minecraft artwork, 3D renders, banners and thumbnails for creators and servers.',
    tags: ['Bannery', 'Rendery 3D', 'Miniatury', 'Logo'], tagsEn: ['Banners', '3D renders', 'Thumbnails', 'Logos'], website: 'https://malinowska.cc/', discord: 'https://discord.gg/Qbgd8RmTem', banner: 'https://malinowska.cc/photo_gallery/1.png', color: '#e00070', featured: true,
    avatar: 'https://mc-heads.net/avatar/Malinowska', intro: 'Cześć, jestem Zuzia.', introEn: 'Hi, I am Zuzia.',
    about: 'Tworzę unikalną grafikę w klimacie Minecrafta oraz trójwymiarowe rendery. Łączę pasję do gier z dopracowaną estetyką, tworząc banery, miniatury i identyfikacje wizualne dla twórców internetowych.',
    aboutEn: 'I make unique Minecraft-style artwork and 3D renders. I combine my love of games with polished aesthetics, creating banners, thumbnails and visual identities for online creators.',
    skills: ['Photoshop', 'Cinema 4D', 'Blender'], badges: ['3+ months exp', 'Clean aesthetics', 'Pixel perfect', 'Bez AI / No AI'],
    gallery: Array.from({ length: 10 }, (_, i) => `https://malinowska.cc/photo_gallery/${i + 1}.png`),
    prices: [
        { title: 'Miniatura filmu', titleEn: 'Video thumbnail', desc: 'Chwytliwa miniatura YouTube dopasowana do tematyki filmu, zaprojektowana tak, aby przyciągać wzrok i zwiększać klikalność.', descEn: 'An eye-catching YouTube thumbnail matched to the video, designed to grab attention and raise the click-through rate.', price: 'od 15 PLN', priceEn: 'from 15 PLN', market: '30 PLN' },
        { title: 'Banner social media', titleEn: 'Social media banner', desc: 'Profesjonalny baner profilowy na YouTube, Twitch, Twitter lub Discord z korekcją barwną i efektami.', descEn: 'A professional profile banner for YouTube, Twitch, Twitter or Discord with color grading and effects.', price: 'od 20 PLN', priceEn: 'from 20 PLN', market: '35 PLN' },
        { title: 'Logo rysowane', titleEn: 'Hand-drawn logo', desc: 'Unikalna, ręcznie rysowana ilustracja albo postać lub maskotka według Twojej wizji.', descEn: 'A unique hand-drawn illustration, character or mascot made to your vision.', price: 'od 80–100 PLN', priceEn: 'from 80–100 PLN', market: '200 PLN' },
        { title: 'Avatar profilowy', titleEn: 'Profile avatar', desc: 'Dopracowana grafika profilowa z Twoją postacią lub logo, dopasowana do wszystkich portali.', descEn: 'A polished profile picture with your character or logo, sized for every platform.', price: 'od 5 PLN', priceEn: 'from 5 PLN', market: '20 PLN' },
        { title: 'Inny projekt', titleEn: 'Other project', desc: 'Nakładki OBS na streamy, grafiki do sklepów, interfejsy UI lub niestandardowe pakiety.', descEn: 'OBS stream overlays, store artwork, UI designs or custom packages.', price: 'Wycena indywidualna', priceEn: 'Custom quote' },
    ] };
const uuid = zod_1.z.string().regex(/^[a-f0-9]{32}$/i).transform(s => s.toLowerCase());
const nick = zod_1.z.string().regex(/^[A-Za-z0-9_]{3,16}$/);
const ONLINE_MS = 90000;
const MAX_FRIENDS = 200;
const MAX_MESSAGES = 200;
exports.MAX_NOTE = 60;
/** A custom status as stored: one line, no control or invisible formatting characters, at most MAX_NOTE characters. */
const cleanNote = (text) => Array.from(text.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, ' ').replace(/\s+/g, ' ').trim()).slice(0, exports.MAX_NOTE).join('').trim();
exports.cleanNote = cleanNote;
const chatKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
async function mojangLookup(name) {
    const r = await fetch('https://api.mojang.com/users/profiles/minecraft/' + encodeURIComponent(name), { signal: AbortSignal.timeout(10000) });
    if (r.status === 404 || r.status === 204)
        return null;
    if (!r.ok)
        throw Error('Mojang lookup failed');
    const p = await r.json();
    return { id: uuid.parse(p.id), name: String(p.name) };
}
/** groupOf: the group shown next to a friend's nick (groups.ts), if any. */
async function registerSocial(app, root, user, lookup = mojangLookup, groupOf) {
    const file = node_path_1.default.join(root, 'social.json');
    let db = { users: {}, chats: {}, read: {}, partners: [] };
    try {
        db = { ...db, ...JSON.parse(await promises_1.default.readFile(file, 'utf8')) };
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
    const presence = new Map();
    const sent = new Map();
    let notify = () => { };
    let played = () => { };
    // tasks: a friendship made (both players) and a message sent to a friend
    let activity = () => { };
    // Time in game adds up from the heartbeats in memory and is saved every few minutes, not on every heartbeat.
    let playDirty = false;
    const flush = setInterval(() => { if (playDirty) {
        playDirty = false;
        void mutate(() => { }).catch(() => { });
    } }, 5 * 60000);
    flush.unref?.();
    app.addHook('onClose', async () => { clearInterval(flush); if (playDirty) {
        playDirty = false;
        await mutate(() => { }).catch(() => { });
    } });
    let queue = Promise.resolve();
    async function mutate(fn) {
        const task = queue.then(async () => {
            const previous = structuredClone(db);
            try {
                fn();
                await promises_1.default.writeFile(file + '.tmp', JSON.stringify(db));
                await promises_1.default.rename(file + '.tmp', file);
            }
            catch (e) {
                db = previous;
                throw e;
            }
        });
        queue = task.catch(() => { });
        await task;
    }
    const fail = (code, message) => Object.assign(Error(message), { statusCode: code });
    // Bad input is a 400 with a short message, never a 500.
    const input = (schema, value) => { const r = schema.safeParse(value); if (!r.success)
        throw fail(400, 'Nieprawidłowe dane.'); return r.data; };
    const groupView = (id) => { const g = groupOf?.(id); return g ? { group: { name: g.name, color: g.color, ...(g.badge ? { badge: g.badge } : {}) } } : {}; };
    const me = (p) => { const u = db.users[p.id] || (db.users[p.id] = { name: p.name, friends: [], incoming: [], outgoing: [] }); u.name = p.name; return u; };
    const nameOf = (id) => db.users[id]?.name || '?';
    const statusOf = (id) => { const p = presence.get(id); return p && Date.now() - p.at < ONLINE_MS ? p : null; };
    const unread = (self, other) => {
        const last = db.read[`${self}>${other}`] || '';
        return (db.chats[chatKey(self, other)] || []).filter(m => m.from === other && m.at > last).length;
    };
    // The newest unread message, for the launcher's notification.
    const previewOf = (self, other) => {
        const last = db.read[`${self}>${other}`] || '';
        const message = (db.chats[chatKey(self, other)] || []).filter(m => m.from === other && m.at > last).at(-1);
        return message ? { preview: message.text.slice(0, 100) } : {};
    };
    const view = (p) => {
        const u = db.users[p.id];
        if (!u)
            return { friends: [], incoming: [], outgoing: [], note: '' };
        return {
            note: u.note || '',
            friends: u.friends.map(id => { const s = statusOf(id); return { id, name: nameOf(id), status: s ? s.status : 'offline', server: s?.server || '', version: s?.version || '', lastSeen: s ? new Date(s.at).toISOString() : db.users[id]?.lastSeen || '', unread: unread(p.id, id), ...(db.users[id]?.note ? { note: db.users[id].note } : {}), ...previewOf(p.id, id), ...groupView(id) }; })
                .sort((a, b) => Number(b.status !== 'offline') - Number(a.status !== 'offline') || b.unread - a.unread || a.name.localeCompare(b.name)),
            incoming: u.incoming.map(r => ({ id: r.from, name: nameOf(r.from), at: r.at })),
            outgoing: u.outgoing.map(r => ({ id: r.to, name: nameOf(r.to), at: r.at }))
        };
    };
    app.get('/v1/social/state', async (req) => view(user(req)));
    // Heartbeat from the launcher every ~30 s: online / in game, and on which server (if the player shares it).
    app.post('/v1/social/presence', async (req) => {
        const p = user(req);
        const v = input(zod_1.z.object({ status: zod_1.z.enum(['online', 'in-game', 'offline']), server: zod_1.z.string().regex(/^[-a-zA-Z0-9.:]{0,80}$/).default(''), version: zod_1.z.string().max(20).default('') }), req.body);
        const now = Date.now(), before = presence.get(p.id);
        if (v.status === 'offline') {
            presence.delete(p.id);
            if (db.users[p.id])
                db.users[p.id].lastSeen = new Date(now).toISOString();
            return { ok: true };
        }
        presence.set(p.id, { status: v.status, server: v.server, version: v.version, at: now });
        if (db.users[p.id]) {
            db.users[p.id].lastSeen = new Date(now).toISOString();
        }
        // two heartbeats in game in a row: the time between them (at most a minute) counts as played
        if (before?.status === 'in-game' && v.status === 'in-game') {
            const ms = Math.min(60000, Math.max(0, now - before.at)), u = me(p);
            u.playMs = (u.playMs || 0) + ms;
            playDirty = true;
            await played(p.id, ms, v.server);
        }
        return { ok: true };
    });
    // Custom status shown to friends next to the nick ("gram bedwars, wbijać"); an empty text clears it.
    app.post('/v1/social/note', async (req) => {
        const p = user(req);
        const text = (0, exports.cleanNote)(input(zod_1.z.string().max(500), req.body?.text));
        await mutate(() => { const u = me(p); if (text)
            u.note = text;
        else
            delete u.note; });
        return view(p);
    });
    app.post('/v1/social/request', async (req) => {
        const p = user(req);
        const name = nick.safeParse(req.body?.name);
        if (!name.success)
            throw fail(400, 'Nieprawidłowy nick.');
        let target;
        try {
            target = await lookup(name.data);
        }
        catch {
            throw fail(502, 'Nie udało się sprawdzić nicku w Mojang. Spróbuj za chwilę.');
        }
        if (!target)
            throw fail(404, 'Nie ma konta Minecraft o takim nicku.');
        if (target.id === p.id)
            throw fail(400, 'Nie możesz zaprosić samego siebie.');
        let result = 'sent';
        await mutate(() => {
            const a = me(p);
            const b = db.users[target.id] || (db.users[target.id] = { name: target.name, friends: [], incoming: [], outgoing: [] });
            b.name = target.name;
            if (a.friends.includes(target.id)) {
                result = 'already';
                return;
            }
            if (a.friends.length >= MAX_FRIENDS)
                throw fail(400, 'Masz już maksymalną liczbę znajomych.');
            // They already invited us: accept instead of sending a second request.
            if (a.incoming.some(r => r.from === target.id)) {
                a.incoming = a.incoming.filter(r => r.from !== target.id);
                b.outgoing = b.outgoing.filter(r => r.to !== p.id);
                a.friends.push(target.id);
                b.friends.push(p.id);
                result = 'accepted';
                return;
            }
            if (a.outgoing.some(r => r.to === target.id)) {
                result = 'pending';
                return;
            }
            if (b.incoming.length >= 100)
                throw fail(429, 'Ten gracz ma za dużo zaproszeń.');
            const at = new Date().toISOString();
            a.outgoing.push({ to: target.id, at });
            b.incoming.push({ from: p.id, at });
        });
        if (result === 'already')
            throw fail(409, 'Ten gracz jest już na liście znajomych.');
        if (result === 'accepted') {
            activity(p.id, 'friend');
            activity(target.id, 'friend');
        }
        if (result === 'sent' && !statusOf(target.id))
            notify(target.id, { type: 'friend-request', from: p.name });
        return { result, ...view(p) };
    });
    app.post('/v1/social/respond', async (req) => {
        const p = user(req);
        const v = input(zod_1.z.object({ id: uuid, accept: zod_1.z.boolean() }), req.body);
        await mutate(() => {
            const a = me(p), b = db.users[v.id];
            if (!b || !a.incoming.some(r => r.from === v.id))
                throw fail(404, 'Nie ma takiego zaproszenia.');
            a.incoming = a.incoming.filter(r => r.from !== v.id);
            b.outgoing = b.outgoing.filter(r => r.to !== p.id);
            if (v.accept && !a.friends.includes(v.id)) {
                a.friends.push(v.id);
                b.friends.push(p.id);
            }
        });
        if (v.accept) {
            activity(p.id, 'friend');
            activity(v.id, 'friend');
        }
        return view(p);
    });
    app.post('/v1/social/cancel', async (req) => {
        const p = user(req);
        const id = input(uuid, req.body?.id);
        await mutate(() => { const a = me(p), b = db.users[id]; a.outgoing = a.outgoing.filter(r => r.to !== id); if (b)
            b.incoming = b.incoming.filter(r => r.from !== p.id); });
        return view(p);
    });
    app.delete('/v1/social/friends/:id', async (req) => {
        const p = user(req);
        const id = input(uuid, req.params.id);
        await mutate(() => { const a = me(p), b = db.users[id]; a.friends = a.friends.filter(x => x !== id); if (b)
            b.friends = b.friends.filter(x => x !== p.id); });
        return view(p);
    });
    const friendOrFail = (p, id) => { if (!db.users[p.id]?.friends.includes(id))
        throw fail(403, 'Możesz pisać tylko do znajomych.'); };
    app.get('/v1/social/messages/:id', async (req) => {
        const p = user(req);
        const id = input(uuid, req.params.id);
        friendOrFail(p, id);
        const list = db.chats[chatKey(p.id, id)] || [];
        const last = list.filter(m => m.from === id).at(-1)?.at;
        if (last && last !== db.read[`${p.id}>${id}`])
            await mutate(() => { db.read[`${p.id}>${id}`] = last; });
        return list.map(m => ({ mine: m.from === p.id, text: m.text, at: m.at }));
    });
    app.post('/v1/social/messages/:id', async (req) => {
        const p = user(req);
        const id = input(uuid, req.params.id);
        friendOrFail(p, id);
        const text = zod_1.z.string().trim().min(1).max(500).safeParse(req.body?.text);
        if (!text.success)
            throw fail(400, 'Wiadomość musi mieć od 1 do 500 znaków.');
        const now = Date.now();
        const times = (sent.get(p.id) || []).filter(t => t > now - 60000);
        if (times.length >= 20)
            throw fail(429, 'Za dużo wiadomości. Zwolnij na chwilę.');
        times.push(now);
        sent.set(p.id, times);
        await mutate(() => {
            const key = chatKey(p.id, id);
            const list = db.chats[key] || (db.chats[key] = []);
            list.push({ from: p.id, text: text.data, at: new Date(now).toISOString() });
            if (list.length > MAX_MESSAGES)
                list.splice(0, list.length - MAX_MESSAGES);
        });
        activity(p.id, 'message');
        if (!statusOf(id))
            notify(id, { type: 'message', from: p.name, text: text.data });
        return (db.chats[chatKey(p.id, id)] || []).map(m => ({ mine: m.from === p.id, text: m.text, at: m.at }));
    });
    // Partner servers: public list; only the admin changes it.
    const partner = zod_1.z.object({ id: zod_1.z.string().regex(/^[a-z0-9-]{2,32}$/), name: zod_1.z.string().trim().min(2).max(40), address: zod_1.z.string().regex(/^[-a-zA-Z0-9.:]{3,80}$/), description: zod_1.z.string().max(160).default(''), color: zod_1.z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ff8a1f'), tags: zod_1.z.array(zod_1.z.string().max(20)).max(4).default([]) });
    app.get('/v1/servers/partners', async (_req, reply) => { reply.header('Cache-Control', 'public, max-age=60'); return db.partners; });
    app.post('/v1/admin/partners', async (req) => {
        user(req, 'partners.manage');
        const v = input(partner, req.body);
        await mutate(() => { db.partners = [...db.partners.filter(x => x.id !== v.id), v].slice(0, 30); });
        return db.partners;
    });
    app.delete('/v1/admin/partners/:id', async (req) => {
        user(req, 'partners.manage');
        const id = input(zod_1.z.string().regex(/^[a-z0-9-]{2,32}$/), req.params.id);
        await mutate(() => { db.partners = db.partners.filter(x => x.id !== id); });
        return db.partners;
    });
    // Partner creators: public list for the launcher; only the admin changes it. Links must be https (the launcher opens them).
    db.creators ??= [MALINOWSKA];
    const https = zod_1.z.string().trim().max(300).url().refine(u => u.startsWith('https://'));
    const creator = zod_1.z.object({ id: zod_1.z.string().regex(/^[a-z0-9-]{2,32}$/), name: zod_1.z.string().trim().min(2).max(40), role: zod_1.z.string().trim().max(80).default(''), roleEn: zod_1.z.string().trim().max(80).optional(),
        text: zod_1.z.string().trim().max(300).default(''), textEn: zod_1.z.string().trim().max(300).optional(), tags: zod_1.z.array(zod_1.z.string().trim().min(1).max(20)).max(6).default([]), tagsEn: zod_1.z.array(zod_1.z.string().trim().min(1).max(20)).max(6).optional(),
        website: https, discord: https.optional(), banner: https.optional(), color: zod_1.z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ff8a1f'),
        code: zod_1.z.string().trim().max(32).optional(), codeText: zod_1.z.string().trim().max(80).optional(), codeTextEn: zod_1.z.string().trim().max(80).optional(), featured: zod_1.z.boolean().default(false),
        avatar: https.optional(), intro: zod_1.z.string().trim().max(80).optional(), introEn: zod_1.z.string().trim().max(80).optional(), about: zod_1.z.string().trim().max(400).optional(), aboutEn: zod_1.z.string().trim().max(400).optional(),
        skills: zod_1.z.array(zod_1.z.string().trim().min(1).max(20)).max(8).optional(), badges: zod_1.z.array(zod_1.z.string().trim().min(1).max(24)).max(6).optional(), gallery: zod_1.z.array(https).max(12).optional(),
        prices: zod_1.z.array(zod_1.z.object({ title: zod_1.z.string().trim().min(1).max(40), titleEn: zod_1.z.string().trim().max(40).optional(), desc: zod_1.z.string().trim().max(200).default(''), descEn: zod_1.z.string().trim().max(200).optional(),
            price: zod_1.z.string().trim().min(1).max(30), priceEn: zod_1.z.string().trim().max(30).optional(), market: zod_1.z.string().trim().max(30).optional() })).max(8).optional() });
    // Seconds between partner creators in the Partners page carousel (0 = no rotation), set by the admin.
    const ROTATE = [0, 5, 8, 15, 30, 60];
    app.get('/v1/creators/settings', async (_req, reply) => { reply.header('Cache-Control', 'public, max-age=60'); return { rotate: db.creatorsRotate ?? 8 }; });
    app.post('/v1/admin/creators/settings', async (req) => {
        user(req, 'partners.manage');
        const rotate = input(zod_1.z.number().int().refine(n => ROTATE.includes(n)), req.body?.rotate);
        await mutate(() => { db.creatorsRotate = rotate; });
        return { rotate };
    });
    app.get('/v1/creators', async (_req, reply) => { reply.header('Cache-Control', 'public, max-age=60'); return db.creators; });
    app.post('/v1/admin/creators', async (req) => {
        user(req, 'partners.manage');
        const v = input(creator, req.body);
        await mutate(() => { const list = db.creators || [], at = list.findIndex(x => x.id === v.id); db.creators = at < 0 ? [...list, v].slice(0, 12) : list.map(x => x.id === v.id ? v : x); });
        return db.creators;
    });
    app.delete('/v1/admin/creators/:id', async (req) => {
        user(req, 'partners.manage');
        const id = input(zod_1.z.string().regex(/^[a-z0-9-]{2,32}$/), req.params.id);
        await mutate(() => { db.creators = (db.creators || []).filter(x => x.id !== id); });
        return db.creators;
    });
    // In game with EXER Client right now (launcher heartbeat): the EXER icon before the nick in game.
    return {
        /** Addresses of the partner servers (server banners mark them as partners). */
        partnerHosts: () => db.partners.map(p => p.address),
        playingExer: (id) => statusOf(id)?.status === 'in-game',
        status: (id) => statusOf(id)?.status || 'offline',
        /** server and version of a player in game now ('' when hidden or not in game) */
        friendsOf: (id) => db.users[id]?.friends || [],
        where: (id) => { const s = statusOf(id); return { status: s?.status || 'offline', server: s?.status === 'in-game' ? s.server : '', version: s?.status === 'in-game' ? s.version : '' }; },
        friendsWith: (a, b) => !!db.users[a]?.friends.includes(b),
        nameOf: (id) => db.users[id]?.name || '',
        idByName: (name) => { const n = name.toLowerCase(); for (const [id, u] of Object.entries(db.users))
            if (u.name?.toLowerCase() === n)
                return id; return undefined; },
        playMinutes: (id) => Math.floor((db.users[id]?.playMs || 0) / 60000),
        onNotify: (fn) => { notify = fn; },
        /** time in game as it adds up (EXER Coins for playing) */
        onPlay: (fn) => { played = fn; },
        onActivity: (fn) => { activity = fn; },
        friends: (id) => db.users[id]?.friends.length || 0,
        // players with the launcher open now, and how many of them are in game
        stats: () => { let online = 0, inGame = 0; for (const id of presence.keys()) {
            const s = statusOf(id);
            if (s) {
                online++;
                if (s.status === 'in-game')
                    inGame++;
            }
        } return { online, inGame }; },
    };
}
