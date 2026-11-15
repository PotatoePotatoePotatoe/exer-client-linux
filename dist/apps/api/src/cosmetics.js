"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.slot = exports.FOUNDER_COSMETICS = exports.STARTER_COSMETICS = exports.OFFLINE_ACCOUNTS_PER_DEVICE = exports.ENDIXON_UUID = void 0;
exports.offlineUuid = offlineUuid;
exports.registerCosmetics = registerCosmetics;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const zod_1 = require("zod");
const vops_catalog_1 = require("../../../packages/shared/src/vops-catalog");
const cosmetic_variants_1 = require("../../../packages/shared/src/cosmetic-variants");
const cosmetic_aliases_json_1 = __importDefault(require("../../../packages/shared/src/cosmetic-aliases.json"));
const economy_1 = require("../../../packages/shared/src/economy");
const shop_1 = require("../../../packages/shared/src/shop");
const quests_1 = require("./quests");
const gifts_1 = require("./gifts");
const ranking_1 = require("./ranking");
const attest_1 = require("./attest");
const session_1 = require("./session");
const social_1 = require("./social");
const banners_1 = require("./banners");
const global_chat_1 = require("./global-chat");
const discord_1 = require("./discord");
const groups_1 = require("./groups");
exports.ENDIXON_UUID = 'ef5f85e57a354b828429309faad1da32';
const uuid = zod_1.z.string().regex(/^[a-f0-9]{32}$/i).transform(s => s.toLowerCase());
/** The UUID Minecraft gives an offline-mode player (UUID v3 of "OfflinePlayer:<nick>"), without dashes. */
function offlineUuid(name) {
    const bytes = node_crypto_1.default.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
    bytes[6] = (bytes[6] & 0x0f) | 0x30;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return bytes.toString('hex');
}
/** Offline nicks one device may own (each starts with the starter pack, so a cap stops farming alts). */
exports.OFFLINE_ACCOUNTS_PER_DEVICE = 3;
const ALLOWED_MODELS = new Set(['cape', 'wings', 'halo', 'crown', ...vops_catalog_1.VOPS_COSMETICS_CATALOG.map(c => c.model)]);
const cosmetic = zod_1.z.object({
    id: zod_1.z.string().regex(/^[a-z0-9_-]{1,40}$/),
    name: zod_1.z.string().trim().min(1).max(48),
    model: zod_1.z.string().refine(m => ALLOWED_MODELS.has(m)),
    color: zod_1.z.string().regex(/^#[0-9a-fA-F]{6}$/),
    category: zod_1.z.string().optional(),
    slot: zod_1.z.string().optional(),
    rarity: zod_1.z.string().optional(),
    price: zod_1.z.number().optional(),
    texture: zod_1.z.string().optional(),
    render: zod_1.z.string().optional(),
    description: zod_1.z.string().optional(),
    variant: zod_1.z.enum(['costume', 'wings', 'armor_wings']).optional(),
    covers: zod_1.z.array(zod_1.z.string()).optional(),
    collection: zod_1.z.string().optional(),
    reward: zod_1.z.boolean().optional(),
    adminOnly: zod_1.z.boolean().optional(),
    enabled: zod_1.z.boolean().default(true)
});
const legacyDefaults = [
    { id: 'founder-crown', name: 'Founder Crown', model: 'crown', color: '#FFBE55', slot: 'head', category: 'hats', rarity: 'legendary', price: 0, render: './cosmetics/renders/founder-crown.png', enabled: true },
    { id: 'solar-halo', name: 'Solar Halo', model: 'halo', color: '#79E9FF', slot: 'head', category: 'hats', rarity: 'epic', price: 0, render: './cosmetics/renders/solar-halo.png', enabled: true },
    { id: 'amethyst-wings', name: 'Amethyst Wings', model: 'wings', color: '#BC88FF', slot: 'wings', category: 'wings', rarity: 'epic', price: 0, render: './cosmetics/renders/amethyst-wings.png', enabled: true },
    { id: 'exer-cape', name: 'EXER Cape', model: 'cape', color: '#FF963F', slot: 'cape', category: 'capes', rarity: 'rare', price: 0, render: './cosmetics/renders/exer-cape.png', enabled: true }
];
const vopsDefaults = vops_catalog_1.VOPS_COSMETICS_CATALOG.map(item => ({
    id: item.id,
    name: item.name,
    model: item.model,
    color: item.color,
    category: item.category,
    slot: item.slot,
    rarity: item.rarity,
    price: item.price,
    texture: item.texture,
    render: item.render,
    description: item.description,
    variant: item.variant,
    covers: item.covers,
    collection: item.collection,
    reward: item.reward,
    adminOnly: item.adminOnly,
    enabled: item.enabled
}));
const defaults = [...vopsDefaults, ...legacyDefaults];
/** Every cosmetic a founder gets (the founder pack, the founder cape and the old built-in items). */
exports.STARTER_COSMETICS = ['solar-halo', 'amethyst-wings', 'exer-cape', ...vops_catalog_1.VOPS_STARTER_IDS];
exports.FOUNDER_COSMETICS = [...new Set(['solar-halo', 'amethyst-wings', 'exer-cape', ...economy_1.FOUNDER_PACK, economy_1.FOUNDER_CAPE])];
const aliases = cosmetic_aliases_json_1.default;
const conflict = (a, b) => (0, cosmetic_variants_1.cosmeticsConflict)(a, b, c => (0, exports.slot)(c));
const slot = (c) => {
    if (!c)
        return 'head';
    if (c.slot)
        return c.slot;
    const found = vops_catalog_1.VOPS_COSMETICS_CATALOG.find(x => x.id === c.id || x.model === c.model);
    if (found)
        return found.slot;
    const m = (c.model || '').toLowerCase();
    const id = (c.id || '').toLowerCase();
    if (m === 'cape' || id.includes('cape') || id.includes('minecon') || id === 'migrator' || id === 'turtle' || id === 'cobalt' || id === 'vops' || id === 'founders' || id === '1million')
        return 'cape';
    if (m.includes('wings'))
        return 'wings';
    if (m.includes('crown') || m.includes('halo') || m.includes('hat') || m.includes('antlers') || m.includes('head') || m.includes('ushanka'))
        return 'head';
    if (m.includes('axe') || m.includes('guitar') || m.includes('machete') || m.includes('sword') || m.includes('parrot'))
        return 'hand';
    if (m.includes('katana') || m.includes('backpack') || m.includes('shield'))
        return 'back';
    if (m.includes('pig') || m.includes('axolotl') || m.includes('cat'))
        return 'pet';
    return 'head';
};
exports.slot = slot;
async function verifyMinecraft(token) {
    const r = await fetch('https://api.minecraftservices.com/minecraft/profile', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000) });
    if (!r.ok)
        throw Error('Invalid Minecraft session');
    return zod_1.z.object({ id: uuid, name: zod_1.z.string().min(1).max(16) }).parse(await r.json());
}
/** Like a Minecraft server: the launcher told Mojang it joins "serverId" (with its own token), Mojang confirms who it was.
 * EXER never receives the player's Minecraft token. */
async function verifyJoin(name, serverId) {
    const r = await fetch('https://sessionserver.mojang.com/session/minecraft/hasJoined?username=' + encodeURIComponent(name) + '&serverId=' + encodeURIComponent(serverId), { signal: AbortSignal.timeout(15000) });
    if (r.status !== 200)
        throw Error('Mojang did not confirm the join');
    return zod_1.z.object({ id: uuid, name: zod_1.z.string().min(1).max(16) }).parse(await r.json());
}
async function registerCosmetics(app, root, verify = verifyMinecraft, adminUuid = process.env.EXER_ADMIN_UUID || exports.ENDIXON_UUID, socialLookup, joined = verifyJoin, botKey = process.env.EXER_BOT_KEY) {
    adminUuid = uuid.parse(adminUuid);
    const file = node_path_1.default.join(root, 'cosmetics.json');
    await promises_1.default.mkdir(root, { recursive: true });
    let db = { catalog: defaults, players: {}, audit: [] };
    try {
        const loaded = JSON.parse(await promises_1.default.readFile(file, 'utf8'));
        const catalogMap = new Map(defaults.map(c => [c.id, c]));
        for (const c of (loaded.catalog || [])) {
            if (!catalogMap.has(c.id) && !aliases[c.id])
                catalogMap.set(c.id, c);
        }
        const mergedCatalog = Array.from(catalogMap.values());
        const validIds = new Set(catalogMap.keys());
        const cleanedPlayers = {};
        for (const [pid, pdata] of Object.entries((loaded.players || {}))) {
            // Ids of duplicate models now point at the kept item.
            const migrate = (ids) => [...new Set(ids.map(id => aliases[id] || id))];
            const validGrants = migrate(pdata.grants || []).filter(gid => validIds.has(gid));
            const cleanEquipped = [];
            // Newest equipped item wins when saved data holds two items for the same body parts.
            for (const eid of migrate(pdata.equipped || []).reverse()) {
                const item = catalogMap.get(eid);
                if (item && !cleanEquipped.some(id => conflict(catalogMap.get(id), item)))
                    cleanEquipped.unshift(eid);
            }
            cleanedPlayers[pid] = { ...pdata, grants: validGrants, equipped: cleanEquipped };
        }
        db = { catalog: mergedCatalog, players: cleanedPlayers, audit: loaded.audit || [], admins: loaded.admins || [], groups: loaded.groups, chatModerationSeeded: loaded.chatModerationSeeded, partnerStaffCleaned: loaded.partnerStaffCleaned, events: loaded.events || [], rankings: loaded.rankings || [], rankingWeek: loaded.rankingWeek, cards: loaded.cards || [] };
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
    const sessions = new Map();
    let queue = Promise.resolve();
    const digest = (s) => node_crypto_1.default.createHash('sha256').update(s).digest('hex');
    async function mutate(actor, action, target, fn) {
        const task = queue.then(async () => {
            const previous = structuredClone(db);
            try {
                fn();
                db.audit.push({ at: new Date().toISOString(), actor, action, target });
                db.audit = db.audit.slice(-500);
                await promises_1.default.writeFile(file + '.tmp', JSON.stringify(db, null, 2));
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
    // Groups decide who may do what in the admin panel and which partner cosmetics a player wears.
    const groups = (0, groups_1.createGroups)({ state: () => db, owner: adminUuid, user: req => user(req), mutate, hasCosmetic: id => db.catalog.some(c => c.id === id),
        blank: name => ({ name, coins: economy_1.START_COINS, grants: [], equipped: [] }) });
    groups.migrate();
    groups.register(app);
    const isAdmin = (id) => groups.can(id, 'admin.panel');
    // The game may use its launcher-issued token ("Game <token>") for friends (invites too), private messages and global chat only:
    // never for coins, purchases, gifts, account changes or any admin access.
    const GAME_ROUTES = new Set(['GET /v1/social/state', 'POST /v1/social/request', 'POST /v1/social/respond', 'POST /v1/social/cancel', 'GET /v1/social/messages/:id', 'POST /v1/social/messages/:id', 'GET /v1/chat/global', 'POST /v1/chat/global', 'POST /v1/chat/translate', 'GET /v1/chat/mentions', 'POST /v1/chat/block', 'POST /v1/chat/report']);
    let gameProfile = () => null;
    /** need: true = any admin panel access, or one permission (e.g. 'cosmetics.grant'). */
    function user(req, need = false) {
        const header = req.headers.authorization || '';
        if (header.startsWith('Game ')) {
            const route = req.method + ' ' + (req.routeOptions?.url || '');
            const profile = !need && GAME_ROUTES.has(route) ? gameProfile(header.slice(5)) : null;
            if (!profile)
                throw Object.assign(Error('Uruchom grę ponownie z EXER Launchera.'), { statusCode: 401 });
            return profile;
        }
        const session = header.startsWith('Bearer ') ? sessions.get(digest(header.slice(7))) : undefined;
        if (!session || session.expires < Date.now())
            throw Object.assign(Error('Zaloguj się ponownie do usługi kosmetyków.'), { statusCode: 401 });
        if (need && !groups.can(session.profile.id, need === true ? 'admin.panel' : need))
            throw Object.assign(Error('Brak uprawnień administratora.'), { statusCode: 403 });
        return session.profile;
    }
    // Game tokens for EXER client attestation reuse the verified cosmetics session.
    // Set by createApi once the device identities are registered (useDevices); tests without them skip the device check.
    let devices;
    (0, session_1.registerSessionRelay)(app);
    // restrictions: players.ban, ranks (nobody bans someone above them), staff alerts and the owner's amnesty go to Discord
    const attestation = await (0, attest_1.registerAttestation)(app, root, req => user(req), botKey, {
        actor: req => { try {
            return user(req, 'players.ban');
        }
        catch {
            return null;
        } }, rank: id => groups.rank(id), owner: adminUuid,
        alert: data => { void discord.staffAlert(data); }, amnesty: data => { void discord.announceAmnesty(data); }
    }, () => devices, id => ({ friends: social.friendsOf(id), ...globalChat.voiceAccess(id) }));
    gameProfile = attestation.gameProfile;
    // Friends, chat and partner servers use the same verified session.
    const social = await (0, social_1.registerSocial)(app, root, (req, need) => user(req, need), socialLookup, id => groups.shown(id));
    const globalChat = await (0, global_chat_1.registerGlobalChat)(app, root, { user: (req, need) => user(req, need), can: (id, perm) => groups.can(id, perm), rank: id => groups.rank(id), group: id => groups.shown(id), playMinutes: id => social.playMinutes(id), discordLinked: id => discord.linked(id), banned: id => attestation.banned(id), alert: data => { void discord.staffAlert(data); } });
    function player(id, name = '') {
        const p = db.players[id];
        return p ? { coins: economy_1.LEGACY_COINS, ...p, role: isAdmin(id) ? 'admin' : p.role } : { name, coins: economy_1.START_COINS, grants: [], equipped: [] };
    }
    // Saved grants, plus the cosmetics of the player's groups (a partner's own capes) and, with cosmetics.all, the whole
    // catalog; group items are never copied into saved grants, so leaving a group takes them away.
    const accessGrants = (id, grants = []) => {
        const extra = groups.can(id, 'cosmetics.all') ? db.catalog.filter(c => c.enabled).map(c => c.id) : groups.cosmetics(id);
        return [...new Set([...grants, ...extra])];
    };
    const canUse = (id, item) => accessGrants(id, player(id).grants).includes(item.id);
    /** An offline account before its device verified with Discord (/link): no starter pack, no wearing, nothing shown in game. */
    const offlineLocked = (id) => { const owner = db.players[id]?.offline?.owner; return !!owner && !(devices?.device(owner)?.pc ?? [owner]).some(d => discord.deviceVerified(d)); };
    const lockedReply = { error: 'Połącz konto offline z Discordem (zakładka Discord w launcherze), aby używać kosmetyków. Jedno konto Discord na jeden komputer.', discordRequired: true };
    function visible(id) {
        if (offlineLocked(id))
            return [];
        const p = player(id);
        return p.equipped.map((cid) => db.catalog.find(c => c.id === cid && c.enabled && canUse(id, c))).filter(Boolean);
    }
    // Shop of the day (the same for everyone, picked from the catalog by date) and the events that run or start within a week.
    let shopCache = { day: '', offers: [] };
    const shop = () => { const day = (0, shop_1.shopDay)(); if (shopCache.day !== day)
        shopCache = { day, offers: (0, shop_1.dailyShop)(db.catalog, day) }; return shopCache.offers; };
    const events = () => { const now = Date.now(); return (db.events || []).filter(e => Date.parse(e.end) > now && Date.parse(e.start) < now + 7 * 86400000); };
    // admin "What's new" cards running now (Start page), newest first
    const cards = () => { const now = Date.now(); return (db.cards || []).filter(c => Date.parse(c.start) <= now && now < Date.parse(c.end)).sort((a, b) => Date.parse(b.start) - Date.parse(a.start)).slice(0, 4); };
    const offers = () => ({ shop: shop(), shopResetAt: (0, shop_1.nextShopReset)(), events: events(), cards: cards() });
    app.get('/v1/public/offers', async (_req, reply) => { reply.header('Cache-Control', 'public, max-age=60'); return { ...offers(), shop: shop().map(o => { const c = db.catalog.find(x => x.id === o.id); return { ...o, name: c?.name || o.id, price: c ? (0, shop_1.finalPrice)(c, shop(), events())?.price : undefined }; }) }; });
    /** What a founder owns: every cosmetic sold for coins, also the ones added after the economy started (user's rule:
     * the first FOUNDER_LIMIT accounts have everything for free), plus the founder cape and the old built-in items.
     * Reward-only items (Discord, giveaways, season pass) stay rewards. Given again on every starter call, so new sets arrive by themselves. */
    const founderItems = () => [...new Set([...exports.FOUNDER_COSMETICS, ...db.catalog.filter(c => c.enabled && !c.reward).map(c => c.id)])].filter(cid => db.catalog.some(c => c.id === cid));
    /** Founder places taken and left (launcher store, Discord, website). */
    const founders = () => { const taken = Object.values(db.players).filter(x => x.founder).length; return { taken, limit: economy_1.FOUNDER_LIMIT, left: Math.max(0, economy_1.FOUNDER_LIMIT - taken) }; };
    app.get('/v1/public/founders', async (_req, reply) => { reply.header('Cache-Control', 'public, max-age=30'); return founders(); });
    app.get('/v1/public/download', async (_req, reply) => {
        await mutate('api', 'stats', 'download', () => { if (!db.stats)
            db.stats = {}; db.stats.downloads = (db.stats.downloads || 0) + 1; });
        return reply.redirect('https://api.exerclient.com/artifacts/setup/EXER-Client-WebSetup.exe');
    });
    app.post('/v1/public/launch', async (_req, reply) => {
        await mutate('api', 'stats', 'launch', () => { if (!db.stats)
            db.stats = {}; db.stats.totalLaunches = (db.stats.totalLaunches || 0) + 1; });
        return { ok: true };
    });
    // Coins for time in game: PLAY.perHour, at most PLAY.dailyCap a day. Minutes add up in memory, a coin is saved when one is earned.
    // The day's total is kept here as well, so heartbeats that arrive before the last save cannot go over the cap.
    const playMs = new Map(), earnedToday = new Map(), COIN_MS = 3600000 / economy_1.PLAY.perHour;
    // Daily and weekly tasks and the season pass (apps/api/src/quests.ts): progress from play time, outfit changes,
    // purchases, /daily, friends and messages.
    const quests = (0, quests_1.registerQuests)(app, { players: () => db.players, hasItem: id => db.catalog.some(c => c.id === id), user: req => user(req), mutate, legacyCoins: economy_1.LEGACY_COINS });
    social.onActivity((id, kind) => quests.count(id, kind));
    social.onPlay(async (id, ms, server) => {
        quests.played(id, ms, server);
        const data = db.players[id];
        if (!data)
            return;
        const day = new Date(Date.now()).toISOString().slice(0, 10);
        let e = earnedToday.get(id);
        if (!e || e.day !== day)
            e = { day, play: data.earned?.day === day ? data.earned.play : 0 };
        earnedToday.set(id, e);
        if (e.play >= economy_1.PLAY.dailyCap)
            return;
        const total = (playMs.get(id) || 0) + ms, coins = Math.min(Math.floor(total / COIN_MS), economy_1.PLAY.dailyCap - e.play);
        playMs.set(id, total - coins * COIN_MS);
        if (coins <= 0)
            return;
        e.play += coins;
        const play = e.play;
        // a coin event multiplies what is paid out; the daily cap counts the coins before the multiplier
        const paid = Math.round(coins * (0, shop_1.coinMultiplier)(db.events || []));
        await mutate('playtime', 'coins', id + ':' + paid, () => { const p = db.players[id]; if (!p)
            return; p.coins = (p.coins ?? economy_1.LEGACY_COINS) + paid; p.earned = { day, play }; });
    });
    const attempts = new Map();
    // one-time join codes (Mojang serverId), valid 2 minutes
    const challenges = new Map();
    app.post('/v1/cosmetics/challenge', async (req, reply) => {
        const now = Date.now();
        for (const [k, v] of challenges)
            if (v < now)
                challenges.delete(k);
        if (challenges.size > 20000)
            return reply.code(429).send({ error: 'Spróbuj ponownie później.' });
        const serverId = node_crypto_1.default.randomBytes(20).toString('hex');
        challenges.set(serverId, now + 120000);
        reply.header('Cache-Control', 'no-store');
        return { serverId };
    });
    app.post('/v1/cosmetics/session', async (req, reply) => {
        const now = Date.now();
        for (const [k, v] of sessions)
            if (v.expires < now)
                sessions.delete(k);
        for (const [k, v] of attempts)
            if (v.at < now - 300000)
                attempts.delete(k);
        const attempt = attempts.get(req.ip) || { at: now, count: 0 };
        attempt.count++;
        attempts.set(req.ip, attempt);
        if (attempt.count > 20 || sessions.size > 5000)
            return reply.code(429).send({ error: 'Spróbuj ponownie później.' });
        // New launchers: {name, serverId} after joining at Mojang (the token stays on the player's PC).
        // Launchers before 0.5.23: {minecraftToken}, checked once at Mojang and never stored.
        const joinBody = zod_1.z.object({ name: zod_1.z.string().regex(/^[A-Za-z0-9_]{1,16}$/), serverId: zod_1.z.string().regex(/^[a-f0-9]{40}$/) }).safeParse(req.body);
        const tokenBody = zod_1.z.object({ minecraftToken: zod_1.z.string().min(16).max(16384) }).safeParse(req.body);
        if (!joinBody.success && !tokenBody.success)
            return reply.code(400).send({ error: 'Nieprawidłowa sesja.' });
        let profile;
        try {
            if (joinBody.success) {
                const until = challenges.get(joinBody.data.serverId);
                challenges.delete(joinBody.data.serverId);
                if (!until || until < now)
                    throw Error('unknown or expired join code');
                profile = await joined(joinBody.data.name, joinBody.data.serverId);
            }
            else
                profile = await verify(tokenBody.data.minecraftToken);
            profile = { id: uuid.parse(profile.id), name: profile.name };
        }
        catch {
            return reply.code(401).send({ error: 'Microsoft nie potwierdził konta Minecraft.' });
        }
        const token = node_crypto_1.default.randomBytes(32).toString('base64url');
        sessions.set(digest(token), { profile, expires: now + 3600000 });
        reply.header('Cache-Control', 'no-store');
        return { token, expires: now + 3600000, profile, admin: isAdmin(profile.id), perms: groups.perms(profile.id) };
    });
    // Offline accounts: no Mojang check is possible, so the launcher's device key (the same Ed25519 identity as
    // /v1/identity) signs the join code. The first device that claims a nick owns it; a nick used by a Microsoft
    // account cannot be claimed (on offline-mode servers both would show the same UUID).
    app.post('/v1/cosmetics/offline-session', async (req, reply) => {
        const now = Date.now();
        for (const [k, v] of sessions)
            if (v.expires < now)
                sessions.delete(k);
        for (const [k, v] of attempts)
            if (v.at < now - 300000)
                attempts.delete(k);
        const attempt = attempts.get(req.ip) || { at: now, count: 0 };
        attempt.count++;
        attempts.set(req.ip, attempt);
        if (attempt.count > 20 || sessions.size > 5000)
            return reply.code(429).send({ error: 'Spróbuj ponownie później.' });
        const body = zod_1.z.object({
            name: zod_1.z.string().regex(/^[A-Za-z0-9_]{3,16}$/),
            serverId: zod_1.z.string().regex(/^[a-f0-9]{40}$/),
            identity: zod_1.z.object({ id: zod_1.z.string().regex(/^[a-f0-9]{64}$/), publicKey: zod_1.z.string().max(160) }).strict(),
            signature: zod_1.z.string().max(100),
        }).strict().safeParse(req.body);
        if (!body.success)
            return reply.code(400).send({ error: 'Nieprawidłowa sesja.' });
        const v = body.data;
        const until = challenges.get(v.serverId);
        challenges.delete(v.serverId);
        try {
            if (!until || until < now)
                throw Error('expired');
            const key = node_crypto_1.default.createPublicKey(v.identity.publicKey);
            if (key.asymmetricKeyType !== 'ed25519' || digest(v.identity.publicKey) !== v.identity.id)
                throw Error('key');
            if (!node_crypto_1.default.verify(null, Buffer.from('EXER-offline-v1:' + v.name + ':' + v.serverId), key, Buffer.from(v.signature, 'base64')))
                throw Error('signature');
        }
        catch {
            return reply.code(401).send({ error: 'Nie udało się potwierdzić urządzenia EXER.' });
        }
        const id = offlineUuid(v.name), owner = v.identity.id, existing = db.players[id];
        // the install must be known with its hardware (a fresh key alone is not a device) and not restricted
        const device = devices?.device(owner);
        if (devices && !device?.hardware)
            return reply.code(401).send({ error: 'Uruchom ponownie EXER Launcher: urządzenie nie zostało potwierdzone.' });
        const ban = devices ? await devices.restriction(owner) : null;
        if (ban)
            return reply.code(403).send({ error: 'Konto jest zablokowane w sieci EXER: ' + ban.reason, blacklisted: true, reason: ban.reason, expires: ban.expires === null ? null : new Date(ban.expires).toISOString() });
        // every install on the same PC counts as one device (a deleted identity.dpapi keeps its nicks, limit and Discord)
        const pc = device?.pc ?? [owner];
        if (existing?.offline && !pc.includes(existing.offline.owner))
            return reply.code(403).send({ error: 'Ten nick offline jest już przypisany do innego urządzenia.' });
        if (existing?.offline && existing.offline.owner !== owner)
            await mutate(id, 'move-offline', id + ':' + owner, () => { db.players[id].offline = { owner }; });
        if (!existing?.offline) {
            const lower = v.name.toLowerCase();
            if (Object.entries(db.players).some(([pid, p]) => pid !== id && !p.offline && p.name?.toLowerCase() === lower))
                return reply.code(409).send({ error: 'Ten nick należy do konta Microsoft. Wybierz inny nick offline.' });
            if (Object.values(db.players).filter(p => p.offline && pc.includes(p.offline.owner)).length >= exports.OFFLINE_ACCOUNTS_PER_DEVICE)
                return reply.code(403).send({ error: `Na jednym urządzeniu możesz mieć najwyżej ${exports.OFFLINE_ACCOUNTS_PER_DEVICE} konta offline z kosmetykami.` });
            await mutate(id, 'claim-offline', id + ':' + owner, () => {
                const data = db.players[id] || { name: v.name, coins: economy_1.START_COINS, grants: [], equipped: [] };
                data.name = v.name;
                data.offline = { owner };
                db.players[id] = data;
            });
        }
        const profile = { id, name: v.name, offline: true };
        const token = node_crypto_1.default.randomBytes(32).toString('base64url');
        sessions.set(digest(token), { profile, expires: now + 3600000 });
        reply.header('Cache-Control', 'no-store');
        return { token, expires: now + 3600000, profile, admin: false };
    });
    app.delete('/v1/cosmetics/session', async (req) => {
        user(req);
        sessions.delete(digest((req.headers.authorization || '').slice(7)));
        return { ok: true };
    });
    app.get('/v1/cosmetics/me', async (req) => {
        const p = user(req);
        const me = player(p.id, p.name), grants = accessGrants(p.id, me.grants);
        // Partner/admin-only rewards are visible in the launcher, but remain impossible to buy or claim normally.
        // Rewards the account can use (saved grants, or every item for an administrator) are listed too.
        return { profile: p, admin: isAdmin(p.id), perms: groups.perms(p.id), group: groups.shown(p.id), catalog: db.catalog.filter(c => c.enabled && (!c.reward || c.adminOnly || grants.includes(c.id))), ...me, grants, founders: founders(), ...offers(), rewardsReady: quests.ready(p.id), inbox: db.players[p.id]?.inbox || [], discordRequired: offlineLocked(p.id) };
    });
    app.post('/v1/cosmetics/starter', async (req, reply) => {
        const p = user(req);
        if (offlineLocked(p.id))
            return reply.code(403).send(lockedReply);
        const existing = db.players[p.id];
        const missingFounder = existing?.founder ? founderItems().filter(cid => !existing.grants.includes(cid)) : [];
        if (existing?.starter && missingFounder.length === 0 && existing.name === p.name && existing.coins !== undefined) {
            return { ok: true, ...player(p.id, p.name) };
        }
        await mutate(p.id, 'claim-starter', p.id, () => {
            const data = db.players[p.id] || { name: p.name, coins: economy_1.START_COINS, grants: [], equipped: [] };
            data.name = p.name || data.name;
            if (data.coins === undefined)
                data.coins = db.players[p.id] ? economy_1.LEGACY_COINS : economy_1.START_COINS;
            // once per account: the first FOUNDER_LIMIT accounts become founders and get the founder pack, the rest the starter pack
            if (!data.starter) {
                // founder places are for Microsoft accounts only: an offline nick costs nothing to make
                const taken = Object.values(db.players).filter(x => x.founder).length;
                if (taken < economy_1.FOUNDER_LIMIT && !data.offline)
                    data.founder = taken + 1;
                for (const cid of data.founder ? founderItems() : economy_1.STARTER_PACK) {
                    if (db.catalog.some(c => c.id === cid) && !data.grants.includes(cid))
                        data.grants.push(cid);
                }
                data.starter = true;
            }
            else if (data.founder) {
                for (const cid of founderItems()) {
                    if (db.catalog.some(c => c.id === cid) && !data.grants.includes(cid))
                        data.grants.push(cid);
                }
            }
            db.players[p.id] = data;
        });
        return { ok: true, ...player(p.id, p.name) };
    });
    app.post('/v1/cosmetics/equip', async (req, reply) => {
        const p = user(req);
        if (offlineLocked(p.id))
            return reply.code(403).send(lockedReply);
        const input = zod_1.z.object({ id: zod_1.z.string(), equipped: zod_1.z.boolean() }).safeParse(req.body);
        if (!input.success)
            return reply.code(400).send({ error: 'Nieprawidłowy kosmetyk.' });
        const item = db.catalog.find(c => c.id === input.data.id && c.enabled);
        if (!item || !canUse(p.id, item))
            return reply.code(403).send({ error: 'Nie posiadasz tego kosmetyku.' });
        await mutate(p.id, 'equip', p.id, () => {
            const data = db.players[p.id] || { name: p.name, coins: economy_1.START_COINS, grants: [], equipped: [] };
            // Equipping removes whatever shares the slot or a covered body region.
            data.equipped = data.equipped.filter(id => {
                if (id === item.id)
                    return false;
                if (!input.data.equipped)
                    return true;
                const other = db.catalog.find(c => c.id === id);
                return other ? !conflict(other, item) : false;
            });
            if (input.data.equipped)
                data.equipped.push(item.id);
            db.players[p.id] = data;
        });
        if (input.data.equipped)
            quests.count(p.id, 'equip');
        return { ok: true, equipped: player(p.id).equipped };
    });
    app.post('/v1/cosmetics/buy', async (req, reply) => {
        const p = user(req);
        if (offlineLocked(p.id))
            return reply.code(403).send(lockedReply);
        const input = zod_1.z.object({ id: zod_1.z.string() }).safeParse(req.body);
        if (!input.success)
            return reply.code(400).send({ error: 'Nieprawidłowy kosmetyk.' });
        const item = db.catalog.find(c => c.id === input.data.id && c.enabled);
        if (!item)
            return reply.code(404).send({ error: 'Kosmetyk nie istnieje.' });
        // Reward-only cosmetics are given by the Discord bot or an admin (setGrant), never bought.
        if (item.reward)
            return reply.code(403).send({ error: 'Ten kosmetyk jest nagrodą i nie można go kupić.' });
        const current = player(p.id);
        if (current.grants.includes(item.id))
            return reply.code(400).send({ error: 'Już posiadasz ten kosmetyk.' });
        // the shop of the day and a running discount event lower the price (finalPrice, the same the launcher shows)
        const cost = (0, shop_1.finalPrice)(item, shop(), db.events || [])?.price ?? (0, economy_1.priceOf)(item) ?? 0;
        if ((current.coins ?? 0) < cost)
            return reply.code(400).send({ error: `Brakuje ${cost - (current.coins ?? 0)} monet EXER Coins.` });
        await mutate(p.id, 'buy', p.id + ':' + item.id + ':' + cost, () => {
            const data = db.players[p.id] || { name: p.name, coins: economy_1.START_COINS, grants: [], equipped: [] };
            data.coins = (data.coins ?? economy_1.LEGACY_COINS) - cost;
            data.grants.push(item.id);
            db.players[p.id] = data;
        });
        quests.count(p.id, 'buy');
        return { ok: true, ...player(p.id) };
    });
    // Account id by Minecraft nick (lower case), rebuilt at most once a minute: players on offline-mode servers and LAN.
    let byName = { at: 0, map: new Map() };
    const idByName = (name) => {
        // A Microsoft account wins over an offline account with the same nick.
        if (Date.now() - byName.at > 60000) {
            const map = new Map();
            for (const [id, p] of Object.entries(db.players))
                if (p.name && !(p.offline && map.has(p.name.toLowerCase())))
                    map.set(p.name.toLowerCase(), id);
            byName = { at: Date.now(), map };
        }
        return byName.map.get(name.toLowerCase()) || social.idByName?.(name);
    };
    app.get('/v1/cosmetics/players', async (req, reply) => {
        const query = zod_1.z.object({ ids: zod_1.z.string().max(3400), names: zod_1.z.string().max(5000).optional() }).safeParse(req.query);
        if (!query.success)
            return reply.code(400).send({ error: 'Nieprawidłowa lista graczy.' });
        const ids = query.data.ids.split(',');
        if (ids.length > 100 || ids.some(id => !uuid.safeParse(id).success))
            return reply.code(400).send({ error: 'Nieprawidłowe UUID.' });
        // names: "uuid:Nick" for players whose UUID is an offline one (cracked servers, LAN): those UUIDs come from the nick,
        // not the account, so the account is found by its nick and the answer goes under the UUID the game asked about
        const real = new Map();
        for (const pair of (query.data.names || '').split(',').filter(Boolean).slice(0, 100)) {
            const m = /^([a-f0-9]{32}):([A-Za-z0-9_]{1,16})$/i.exec(pair);
            const id = m && idByName(m[2]);
            if (m && id)
                real.set(m[1].toLowerCase(), id);
        }
        const account = (asked) => real.get(asked) || asked;
        reply.header('Cache-Control', 'no-store');
        // exer: the asked players that play with EXER Client now (the game shows the EXER icon before their nick).
        const asked = ids.map(id => id.toLowerCase());
        // groups: the in-game tag before the nick ("[ADMIN]", "[PARTNER]") with the group color, for the asked players that have a group
        // icon: the pixel icon drawn instead of the tag (older clients ignore it and keep showing the tag)
        const tags = {};
        for (const id of asked) {
            const g = groups.shown(account(id));
            if (g)
                tags[id] = { tag: g.tag, color: g.color, ...(g.icon ? { icon: g.icon } : {}) };
        }
        return { players: Object.fromEntries(asked.map(id => [id, visible(account(id))])), exer: asked.filter(id => social.playingExer(account(id))), groups: tags };
    });
    /** Gives or takes back one cosmetic (admin panel, Discord rewards). False when the cosmetic does not exist. */
    async function setGrant(actor, id, name, cosmeticId, grant) {
        const item = db.catalog.find(c => c.id === cosmeticId);
        if (!item)
            return false;
        await mutate(actor, grant ? 'grant' : 'revoke', id + ':' + item.id, () => {
            const p = db.players[id] || { name, coins: economy_1.START_COINS, grants: [], equipped: [] };
            p.name = name || p.name;
            p.grants = p.grants.filter(g => g !== item.id);
            if (grant) {
                p.grants.push(item.id);
                if (!p.equipped.some(e => { const other = db.catalog.find(c => c.id === e); return other ? conflict(other, item) : false; }))
                    p.equipped.push(item.id);
            }
            else {
                p.equipped = p.equipped.filter(e => e !== item.id);
            }
            db.players[id] = p;
        });
        return true;
    }
    /** Adds (or with a negative amount takes) EXER Coins; the balance never goes below 0. Returns the new balance. */
    async function addCoins(actor, id, name, amount) {
        await mutate(actor, 'coins', id + ':' + amount, () => { const p = db.players[id] || { name, coins: economy_1.START_COINS, grants: [], equipped: [] }; p.name = name || p.name; p.coins = Math.max(0, (p.coins ?? economy_1.LEGACY_COINS) + amount); db.players[id] = p; });
        return db.players[id].coins;
    }
    // Discord bot: links, rewards, online counter, /profile.
    const discord = await (0, discord_1.registerDiscord)(app, root, req => user(req), {
        grant: setGrant,
        partnerGroups: () => groups.groups().filter(g => g.parent && groups.find(g.parent)?.kind === 'partner').map(g => ({ id: g.id, name: g.name, color: g.color,
            ...(g.discordRole ? { discordRole: g.discordRole } : {}), members: Object.keys(db.players).filter(id => groups.active(id).some(m => m.id === g.id)) })),
        stats: () => {
            const s = social.stats();
            return { online: s.online, inGame: s.inGame, downloads: db.stats?.downloads || 0, totalPlayers: Object.keys(db.players || {}).length, totalLaunches: db.stats?.totalLaunches || 0 };
        },
        // /daily also counts for the daily and weekly /daily tasks
        addCoins: async (actor, id, name, amount) => { const coins = await addCoins(actor, id, name, amount); if (actor === 'discord-daily')
            quests.count(id, 'daily'); return coins; },
        coinMultiplier: () => (0, shop_1.coinMultiplier)(db.events || []),
        where: id => social.where(id),
        offlineOwner: id => db.players[id]?.offline?.owner,
        samePc: owner => devices?.device(owner)?.pc ?? [owner],
        friendsWith: (a, b) => social.friendsWith(a, b),
        playMinutes: id => social.playMinutes(id),
        onNotify: fn => social.onNotify(fn),
        profile: async (name) => {
            const local = Object.entries(db.players).find(([, p]) => p.name.toLowerCase() === name.toLowerCase());
            const found = local ? { id: local[0], name: local[1].name } : await (socialLookup || social_1.mojangLookup)(name);
            if (!found)
                return null;
            const p = player(found.id, found.name);
            return { id: found.id, name: found.name, status: social.status(found.id), friends: social.friends(found.id), owned: p.grants.length,
                equipped: visible(found.id).map((c) => ({ id: c.id, name: c.name, rarity: c.rarity || '', slot: (0, exports.slot)(c), color: c.color })) };
        },
    }, botKey);
    // Weekly ranking (hours, /daily streak, collection) and its payout (apps/api/src/ranking.ts).
    // Server banners in the in-game server list (applications from Discord, admin tab in the launcher).
    await (0, banners_1.registerBanners)(app, root, { user: (req, need) => user(req, need), serverBlocked: a => attestation.serverBlocked(a),
        partnerHosts: () => social.partnerHosts(), notify: (id, data) => { void discord.bannerNotice(id, data); } }, botKey);
    (0, ranking_1.registerRanking)(app, { players: () => db.players, state: () => db, sellable: id => !!db.catalog.find(c => c.id === id && !c.reward), streak: id => discord.streak(id),
        user: req => user(req), mutate, announce: data => discord.announceRanking(data), legacyCoins: economy_1.LEGACY_COINS });
    // Between friends: gifts, coin transfers, the player profile and its skin (apps/api/src/gifts.ts).
    (0, gifts_1.registerGifts)(app, { players: () => db.players, catalog: () => db.catalog, user: req => user(req), mutate, friendsWith: (a, b) => social.friendsWith(a, b),
        priceNow: item => (0, shop_1.finalPrice)(item, shop(), db.events || [])?.price ?? null, blank: name => ({ name, coins: economy_1.START_COINS, grants: [], equipped: [] }), legacyCoins: economy_1.LEGACY_COINS,
        visible: (id) => visible(id), nameOf: (id) => db.players[id]?.name || social.nameOf(id),
        profile: id => { const w = social.where(id); return { hours: Math.floor(social.playMinutes(id) / 60), discord: discord.linked(id), admin: isAdmin(id), group: groups.shown(id), seasonLevel: quests.level(id), status: w.status, server: w.server, version: w.version }; } });
    app.get('/v1/admin/cosmetics', async (req) => {
        const me = user(req, true);
        return { perms: groups.perms(me.id), catalog: db.catalog, players: db.players, audit: db.audit.slice(-50).reverse(), owner: adminUuid,
            admins: [adminUuid, ...(db.admins || [])].map(id => ({ id, name: db.players[id]?.name || '' })), groups: groups.groups(), events: db.events || [], cards: db.cards || [],
            // live status for the admin list: launcher open (online) or in game, the rest offline
            presence: Object.fromEntries(Object.keys(db.players).map(id => [id, social.status(id)]).filter(([, s]) => s !== 'offline')) };
    });
    app.post('/v1/admin/cosmetics', async (req, reply) => {
        const admin = user(req, 'cosmetics.edit');
        const parsed = cosmetic.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Nieprawidłowa definicja kosmetyku.' });
        await mutate(admin.id, 'catalog-save', parsed.data.id, () => {
            db.catalog = db.catalog.filter(c => c.id !== parsed.data.id);
            db.catalog.push(parsed.data);
        });
        return { ok: true };
    });
    app.delete('/v1/admin/cosmetics/:id', async (req) => {
        const admin = user(req, 'cosmetics.edit'), id = req.params.id;
        await mutate(admin.id, 'catalog-delete', id, () => {
            db.catalog = db.catalog.filter(c => c.id !== id);
            for (const p of Object.values(db.players)) {
                p.grants = p.grants.filter(x => x !== id);
                p.equipped = p.equipped.filter(x => x !== id);
            }
        });
        return { ok: true };
    });
    // A player known to EXER first (a Microsoft account wins over an offline one), then Mojang, else the nick's offline UUID:
    // offline accounts can be found, given cosmetics and blacklisted even before they play with EXER.
    async function resolveName(name) {
        const lower = name.toLowerCase(), known = Object.entries(db.players).filter(([, p]) => p.name?.toLowerCase() === lower).sort(([, a], [, b]) => Number(!!a.offline) - Number(!!b.offline))[0];
        if (known)
            return { id: known[0], name: known[1].name, offline: !!known[1].offline };
        const r = await fetch('https://api.mojang.com/users/profiles/minecraft/' + name, { signal: AbortSignal.timeout(15000) }).catch(() => null);
        if (r?.ok)
            return { ...zod_1.z.object({ id: uuid, name: zod_1.z.string() }).parse(await r.json()), offline: false };
        return { id: offlineUuid(name), name, offline: true };
    }
    app.get('/v1/admin/resolve/:name', async (req, reply) => {
        user(req, true);
        const name = zod_1.z.string().regex(/^[A-Za-z0-9_]{3,16}$/).safeParse(req.params.name);
        if (!name.success)
            return reply.code(400).send({ error: 'Nieprawidłowy nick.' });
        return resolveName(name.data);
    });
    // Discord bot (/blacklist, /profile): the same lookup with the bot key
    app.get('/v1/bot/resolve/:name', async (req, reply) => {
        if (!botKey || req.headers.authorization !== 'Bot ' + botKey)
            return reply.code(403).send({ error: 'Forbidden' });
        const name = zod_1.z.string().regex(/^[A-Za-z0-9_]{3,16}$/).safeParse(req.params.name);
        if (!name.success)
            return reply.code(400).send({ error: 'Nieprawidłowy nick.' });
        return resolveName(name.data);
    });
    app.post('/v1/admin/grants', async (req, reply) => {
        const admin = user(req, 'cosmetics.grant');
        const input = zod_1.z.object({ player: uuid, name: zod_1.z.string().max(16).default(''), cosmeticId: zod_1.z.string().max(40), grant: zod_1.z.boolean() }).safeParse(req.body);
        if (!input.success)
            return reply.code(400).send({ error: 'Nieprawidłowe dane gracza.' });
        const v = input.data;
        if (!await setGrant(admin.id, v.player, v.name, v.cosmeticId, v.grant))
            return reply.code(404).send({ error: 'Nie ma takiego kosmetyku.' });
        return { ok: true };
    });
    // EXER Coins given (or taken, negative amount) by an administrator.
    app.post('/v1/admin/coins', async (req, reply) => {
        const admin = user(req, 'coins.give');
        const input = zod_1.z.object({ player: uuid, name: zod_1.z.string().max(16).default(''), amount: zod_1.z.number().int().min(-1000000).max(1000000).refine(n => n !== 0) }).safeParse(req.body);
        if (!input.success)
            return reply.code(400).send({ error: 'Nieprawidłowa liczba monet.' });
        return { ok: true, coins: await addCoins(admin.id, input.data.player, input.data.name, input.data.amount) };
    });
    // Events: a coin multiplier or a discount (one collection or everything) between two dates; saved again under the same id.
    const eventInput = zod_1.z.object({
        id: zod_1.z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
        kind: zod_1.z.enum(['coins', 'discount']),
        title: zod_1.z.string().trim().min(1).max(60),
        start: zod_1.z.string().datetime({ offset: true }),
        end: zod_1.z.string().datetime({ offset: true }),
        multiplier: zod_1.z.number().refine(m => shop_1.EVENT_LIMITS.multipliers.includes(m)).optional(),
        discount: zod_1.z.number().int().min(shop_1.EVENT_LIMITS.minDiscount).max(shop_1.EVENT_LIMITS.maxDiscount).optional(),
        collection: zod_1.z.string().max(48).optional()
    }).refine(e => Date.parse(e.end) > Date.parse(e.start) && Date.parse(e.end) - Date.parse(e.start) <= shop_1.EVENT_LIMITS.maxDays * 86400000, 'dates')
        .refine(e => e.kind === 'coins' ? !!e.multiplier : !!e.discount, 'value');
    app.post('/v1/admin/events', async (req, reply) => {
        const admin = user(req, 'events.manage');
        const input = eventInput.safeParse(req.body);
        if (!input.success)
            return reply.code(400).send({ error: 'Nieprawidłowy event: sprawdź daty (najwyżej ' + shop_1.EVENT_LIMITS.maxDays + ' dni), mnożnik albo rabat.' });
        const v = input.data;
        if (v.collection && !db.catalog.some(c => c.collection === v.collection))
            return reply.code(400).send({ error: 'Nie ma takiej kolekcji.' });
        const event = { id: v.id || node_crypto_1.default.randomBytes(4).toString('hex'), kind: v.kind, title: v.title, start: new Date(v.start).toISOString(), end: new Date(v.end).toISOString(),
            ...(v.kind === 'coins' ? { multiplier: v.multiplier } : { discount: v.discount, ...(v.collection ? { collection: v.collection } : {}) }) };
        await mutate(admin.id, 'event-save', event.id, () => { db.events = [...(db.events || []).filter(e => e.id !== event.id), event]; });
        return { ok: true, event };
    });
    app.delete('/v1/admin/events/:id', async (req) => {
        const admin = user(req, 'events.manage'), id = String(req.params.id);
        await mutate(admin.id, 'event-delete', id, () => { db.events = (db.events || []).filter(e => e.id !== id); });
        return { ok: true };
    });
    // "What's new" cards: shown on the Start page between two dates, without a new launcher release.
    const cardInput = zod_1.z.object({
        id: zod_1.z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
        title: zod_1.z.string().trim().min(1).max(60), text: zod_1.z.string().trim().max(140).default(''),
        titleEn: zod_1.z.string().trim().max(60).optional(), textEn: zod_1.z.string().trim().max(140).optional(),
        tag: zod_1.z.string().trim().max(16).optional(), art: zod_1.z.string().max(48).optional(),
        page: zod_1.z.enum(['', 'Store', 'Rewards', 'Cosmetics', 'Friends', 'Discord', 'Versions', 'Servers']).optional(),
        start: zod_1.z.string().datetime({ offset: true }), end: zod_1.z.string().datetime({ offset: true })
    }).refine(c => Date.parse(c.end) > Date.parse(c.start) && Date.parse(c.end) - Date.parse(c.start) <= 90 * 86400000, 'dates');
    app.post('/v1/admin/cards', async (req, reply) => {
        const admin = user(req, 'news.manage');
        const input = cardInput.safeParse(req.body);
        if (!input.success)
            return reply.code(400).send({ error: 'Nieprawidłowa karta: tytuł do 60 znaków, tekst do 140, najwyżej 90 dni.' });
        const v = input.data;
        if (v.art && !db.catalog.some(c => c.collection === v.art))
            return reply.code(400).send({ error: 'Nie ma takiej kolekcji.' });
        const card = { ...v, id: v.id || node_crypto_1.default.randomBytes(4).toString('hex'), start: new Date(v.start).toISOString(), end: new Date(v.end).toISOString() };
        for (const k of ['titleEn', 'textEn', 'tag', 'art', 'page'])
            if (!card[k])
                delete card[k];
        await mutate(admin.id, 'card-save', card.id, () => { db.cards = [...(db.cards || []).filter(c => c.id !== card.id), card]; });
        return { ok: true, card };
    });
    app.delete('/v1/admin/cards/:id', async (req) => {
        const admin = user(req, 'news.manage'), id = String(req.params.id);
        await mutate(admin.id, 'card-delete', id, () => { db.cards = (db.cards || []).filter(c => c.id !== id); });
        return { ok: true };
    });
    // Older launcher switch for the admin role and the partner label: the 'admin' and 'partner' groups.
    // Only someone above a group may change it, so the admin group stays with the owner, and the owner always keeps everything.
    app.post('/v1/admin/admins', async (req, reply) => {
        const admin = user(req, true);
        const input = zod_1.z.object({ player: uuid, name: zod_1.z.string().max(16).default(''), admin: zod_1.z.boolean().optional(), role: zod_1.z.enum(['partner', 'none']).optional() }).refine(v => v.admin !== undefined || v.role !== undefined).safeParse(req.body);
        if (!input.success)
            return reply.code(400).send({ error: 'Nieprawidłowe dane gracza.' });
        const v = input.data;
        if (v.player === adminUuid)
            return reply.code(400).send({ error: 'Właściciel zawsze jest administratorem.' });
        const r = v.role !== undefined ? await groups.assign(admin.id, v.player, v.name, 'partner', v.role === 'partner') : await groups.assign(admin.id, v.player, v.name, 'admin', !!v.admin);
        // user() checks the groups on every request: a removed admin loses access at once
        return 'error' in r ? reply.code(r.code).send({ error: r.error }) : r;
    });
    return {
        user,
        isAdmin,
        can: groups.can,
        useDevices: (check) => { devices = check; },
        verifyAdmin: (req) => { try {
            return Boolean(user(req, true));
        }
        catch {
            return false;
        } }
    };
}
