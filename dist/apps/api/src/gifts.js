"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerGifts = registerGifts;
const zod_1 = require("zod");
const economy_1 = require("../../../packages/shared/src/economy");
const quests_1 = require("../../../packages/shared/src/quests");
const uuid = zod_1.z.string().regex(/^[a-f0-9]{32}$/i).transform(s => s.toLowerCase());
const MAX_INBOX = 20;
function registerGifts(app, deps) {
    // errors as {error} with a status, like the rest of the cosmetics service
    const fail = (code, error) => Object.assign(Error(error), { statusCode: code, expose: true });
    const friendOrFail = (me, id) => { if (me === id)
        throw fail(400, 'Nie możesz wysłać prezentu sobie.'); if (!deps.friendsWith(me, id))
        throw fail(403, 'Prezenty i monety możesz wysyłać tylko znajomym.'); };
    const handle = (fn) => async (req, reply) => {
        try {
            return await fn(req);
        }
        catch (e) {
            if (e?.expose)
                return reply.code(e.statusCode).send({ error: e.message });
            throw e;
        }
    };
    const receiver = (id) => { const all = deps.players(); return all[id] || (all[id] = deps.blank(deps.nameOf(id))); };
    // Offline accounts can receive gifts but not send them: a free offline nick must not feed coins to another account.
    const sender = (req) => { const me = deps.user(req); if (me.offline)
        throw fail(403, 'Prezenty i monety mogą wysyłać tylko konta Microsoft.'); return me; };
    const deliver = (to, e) => { to.inbox = [...(to.inbox || []), e].slice(-MAX_INBOX); };
    // A cosmetic for a friend, paid by the giver at today's store price. Reward-only items cannot be gifted.
    app.post('/v1/gifts/cosmetic', handle(async (req) => {
        const me = sender(req);
        const v = zod_1.z.object({ to: uuid, id: zod_1.z.string().max(40) }).safeParse(req.body);
        if (!v.success)
            throw fail(400, 'Nieprawidłowy prezent.');
        friendOrFail(me.id, v.data.to);
        const item = deps.catalog().find(c => c.id === v.data.id && c.enabled);
        if (!item)
            throw fail(404, 'Kosmetyk nie istnieje.');
        const price = deps.priceNow(item);
        if (price === null)
            throw fail(403, 'Ten kosmetyk jest nagrodą i nie można go podarować.');
        // checked inside the queued write: a double click pays once
        let error = '';
        await deps.mutate(me.id, 'gift', me.id + '>' + v.data.to + ':' + item.id + ':' + price, () => {
            const from = deps.players()[me.id], to = receiver(v.data.to);
            if (to.grants.includes(item.id)) {
                error = 'Twój znajomy już ma ten kosmetyk.';
                return;
            }
            const coins = from?.coins ?? deps.legacyCoins;
            if (!from || coins < price) {
                error = `Brakuje ${price - (from ? coins : 0)} monet EXER Coins.`;
                return;
            }
            from.coins = coins - price;
            to.grants.push(item.id);
            deliver(to, { from: me.id, name: me.name, kind: 'cosmetic', item: item.id, at: new Date().toISOString() });
        });
        if (error)
            throw fail(400, error);
        return { ok: true, coins: deps.players()[me.id].coins };
    }));
    // Coins for a friend: at least TRANSFER.min at once, at most TRANSFER.dailyMax sent a day, no fee.
    app.post('/v1/gifts/coins', handle(async (req) => {
        const me = sender(req);
        const v = zod_1.z.object({ to: uuid, amount: zod_1.z.number().int().min(economy_1.TRANSFER.min).max(economy_1.TRANSFER.dailyMax) }).safeParse(req.body);
        if (!v.success)
            throw fail(400, `Możesz wysłać od ${economy_1.TRANSFER.min} do ${economy_1.TRANSFER.dailyMax} monet.`);
        friendOrFail(me.id, v.data.to);
        const day = (0, quests_1.questDay)(), amount = v.data.amount;
        let error = '';
        await deps.mutate(me.id, 'transfer', me.id + '>' + v.data.to + ':' + amount, () => {
            const from = deps.players()[me.id];
            if (!from) {
                error = 'Nie masz monet do wysłania.';
                return;
            }
            const sent = from.sent?.day === day ? from.sent.coins : 0, coins = from.coins ?? deps.legacyCoins;
            if (sent + amount > economy_1.TRANSFER.dailyMax) {
                error = `Dziś możesz wysłać jeszcze ${economy_1.TRANSFER.dailyMax - sent} monet.`;
                return;
            }
            if (coins < amount) {
                error = `Masz tylko ${coins} monet.`;
                return;
            }
            const to = receiver(v.data.to);
            from.coins = coins - amount;
            from.sent = { day, coins: sent + amount };
            to.coins = (to.coins ?? deps.legacyCoins) + amount;
            deliver(to, { from: me.id, name: me.name, kind: 'coins', amount, at: new Date().toISOString() });
        });
        if (error)
            throw fail(400, error);
        const from = deps.players()[me.id];
        return { ok: true, coins: from.coins, sentToday: from.sent.coins, leftToday: economy_1.TRANSFER.dailyMax - from.sent.coins };
    }));
    // Gifts not shown yet are in /v1/cosmetics/me (inbox); the launcher clears them after the notice.
    app.post('/v1/inbox/seen', async (req) => {
        const me = deps.user(req);
        const p = deps.players()[me.id];
        if (p?.inbox?.length)
            await deps.mutate(me.id, 'inbox-seen', me.id, () => { p.inbox = []; });
        return { ok: true };
    });
    // Profile of a friend (or yourself): what they wear, how much they own and play, badges, where they play now.
    app.get('/v1/players/:id/profile', handle(async (req) => {
        const me = deps.user(req);
        const id = uuid.safeParse(req.params.id);
        if (!id.success)
            throw fail(400, 'Nieprawidłowy gracz.');
        if (id.data !== me.id && !deps.friendsWith(me.id, id.data))
            throw fail(403, 'Profil widzą tylko znajomi.');
        const p = deps.players()[id.data], extra = deps.profile(id.data);
        const sellable = deps.catalog().filter(c => c.enabled && !c.reward).length;
        const sent = p?.sent?.day === (0, quests_1.questDay)() ? p.sent.coins : 0;
        return { id: id.data, name: p?.name || deps.nameOf(id.data), founder: p?.founder || null, owned: p?.grants || [], total: sellable, ...extra,
            equipped: deps.visible(id.data).map(c => ({ id: c.id, name: c.name, model: c.model, color: c.color, slot: c.slot, category: c.category, texture: c.texture, covers: c.covers, collection: c.collection, rarity: c.rarity })),
            // only for yourself: how many coins you can still send today
            ...(id.data === me.id ? { leftToday: economy_1.TRANSFER.dailyMax - sent } : {}) };
    }));
    // The skin for the profile's 3D preview, read from Mojang by the service (the launcher only talks to EXER),
    // returned as a data URL and kept for an hour.
    const skins = new Map();
    app.get('/v1/players/:id/skin', handle(async (req) => {
        const me = deps.user(req);
        const id = uuid.safeParse(req.params.id);
        if (!id.success)
            throw fail(400, 'Nieprawidłowy gracz.');
        void me; // a skin is public Mojang data; party members need not be friends with each other
        const cached = skins.get(id.data);
        if (cached && cached.at > Date.now() - 3600000)
            return cached;
        let entry = { at: Date.now(), skin: null, slim: false };
        try {
            const r = await fetch('https://sessionserver.mojang.com/session/minecraft/profile/' + id.data, { signal: AbortSignal.timeout(8000) });
            const session = r.ok ? await r.json() : null;
            const value = session?.properties?.find((x) => x.name === 'textures')?.value;
            const skin = value ? JSON.parse(Buffer.from(value, 'base64').toString()).textures?.SKIN : null;
            if (skin?.url && /^https?:\/\/textures\.minecraft\.net\//.test(skin.url)) {
                const png = await fetch(skin.url, { signal: AbortSignal.timeout(8000) });
                const bytes = Buffer.from(await png.arrayBuffer());
                if (png.ok && bytes.length < 64 * 1024)
                    entry = { at: Date.now(), skin: 'data:image/png;base64,' + bytes.toString('base64'), slim: skin.metadata?.model === 'slim' };
            }
        }
        catch { }
        if (skins.size > 2000)
            skins.clear();
        skins.set(id.data, entry);
        return entry;
    }));
}
