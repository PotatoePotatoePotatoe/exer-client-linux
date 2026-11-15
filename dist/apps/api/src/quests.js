"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerQuests = registerQuests;
const zod_1 = require("zod");
const quests_1 = require("../../../packages/shared/src/quests");
const byId = new Map([...quests_1.DAILY_QUESTS, ...quests_1.WEEKLY_QUESTS].map(q => [q.id, q]));
function registerQuests(app, deps) {
    /** The player's tasks for today and this week, picked anew when the day or week changed (old progress is dropped). */
    function tasks(id, p, now = Date.now()) {
        const day = (0, quests_1.questDay)(now), week = (0, quests_1.questWeek)(now);
        const fresh = (defs) => defs.map(q => ({ id: q.id, progress: 0, claimed: false }));
        if (!p.quests)
            p.quests = { day: '', daily: [], week: '', weekly: [] };
        if (p.quests.day !== day) {
            p.quests.day = day;
            p.quests.daily = fresh((0, quests_1.pickQuests)(quests_1.DAILY_QUESTS, id, day));
        }
        if (p.quests.week !== week) {
            p.quests.week = week;
            p.quests.weekly = fresh((0, quests_1.pickQuests)(quests_1.WEEKLY_QUESTS, id, week));
        }
        return p.quests;
    }
    function pass(p, now = Date.now()) {
        if (!p.pass || p.pass.season !== quests_1.SEASON.id)
            p.pass = { season: quests_1.SEASON.id, xp: 0, claimed: [], day: '', playXp: 0 };
        const day = (0, quests_1.questDay)(now);
        if (p.pass.day !== day) {
            p.pass.day = day;
            p.pass.playXp = 0;
        }
        return p.pass;
    }
    // Progress is counted in memory on the player and saved at most every 30 s (play time arrives every minute for
    // everyone online); claims are saved at once.
    let dirty = false;
    const flush = () => { if (!dirty)
        return Promise.resolve(); dirty = false; return deps.mutate('quests', 'progress', '', () => { }).catch(() => { dirty = true; }); };
    const timer = setInterval(() => void flush(), 30000);
    timer.unref?.();
    app.addHook('onClose', async () => { clearInterval(timer); await flush(); });
    /** Counts `amount` towards every unfinished task of that kind today and this week. */
    function count(id, kind, amount = 1) {
        const p = deps.players()[id];
        if (!p || amount <= 0)
            return;
        const q = tasks(id, p);
        for (const t of [...q.daily, ...q.weekly]) {
            const def = byId.get(t.id);
            if (def?.kind === kind && t.progress < def.goal) {
                t.progress = Math.min(def.goal, t.progress + amount);
                dirty = true;
            }
        }
    }
    // Minutes in game: whole minutes count for the play tasks (and the server tasks when on a server) and give pass XP.
    const playMs = new Map();
    function played(id, ms, server) {
        const p = deps.players()[id];
        if (!p)
            return;
        const m = playMs.get(id) || { ms: 0, serverMs: 0 };
        m.ms += ms;
        if (server)
            m.serverMs += ms;
        const minutes = Math.floor(m.ms / 60000), serverMinutes = Math.floor(m.serverMs / 60000);
        m.ms -= minutes * 60000;
        m.serverMs -= serverMinutes * 60000;
        playMs.set(id, m);
        if (minutes) {
            count(id, 'play', minutes);
            const week = (0, quests_1.questWeek)();
            p.weekPlay = { week, minutes: (p.weekPlay?.week === week ? p.weekPlay.minutes : 0) + minutes };
            dirty = true;
        }
        if (serverMinutes)
            count(id, 'server', serverMinutes);
        if (minutes && (0, quests_1.seasonActive)()) {
            const s = pass(p), xp = Math.min(minutes * quests_1.SEASON.playXpPerMinute, quests_1.SEASON.playXpDailyCap - s.playXp);
            if (xp > 0) {
                s.playXp += xp;
                s.xp += xp;
                dirty = true;
            }
        }
    }
    /** The Rewards page: tasks with their progress, the pass track and when things reset. */
    function view(id, name) {
        const players = deps.players();
        const p = players[id] || { name, grants: [] };
        const now = Date.now(), q = tasks(id, p, now), s = pass(p, now), level = (0, quests_1.passLevel)(s.xp);
        const show = (t) => ({ ...byId.get(t.id), progress: t.progress, claimed: t.claimed });
        return {
            day: q.day, dayResetAt: (0, quests_1.dayResetAt)(now), week: q.week, weekResetAt: (0, quests_1.weekResetAt)(now),
            daily: q.daily.map(show), weekly: q.weekly.map(show), coins: p.coins ?? deps.legacyCoins,
            pass: { season: quests_1.SEASON.id, name: quests_1.SEASON.name, start: quests_1.SEASON.start, end: quests_1.SEASON.end, active: (0, quests_1.seasonActive)(now), xp: s.xp, level, xpPerLevel: quests_1.SEASON.xpPerLevel, levels: quests_1.SEASON.levels,
                playXpToday: s.playXp, playXpDailyCap: quests_1.SEASON.playXpDailyCap, claimed: s.claimed,
                rewards: Array.from({ length: quests_1.SEASON.levels }, (_, i) => ({ level: i + 1, ...(0, quests_1.passReward)(i + 1) })) }
        };
    }
    /** Tasks done but not claimed plus pass levels reached but not claimed (the Start page badge). */
    function ready(id) {
        const p = deps.players()[id];
        if (!p)
            return 0;
        const q = tasks(id, p), s = pass(p);
        const done = [...q.daily, ...q.weekly].filter(t => !t.claimed && t.progress >= (byId.get(t.id)?.goal ?? Infinity)).length;
        let levels = 0;
        for (let l = 1; l <= (0, quests_1.passLevel)(s.xp); l++)
            if (!s.claimed.includes(l))
                levels++;
        return done + levels;
    }
    app.get('/v1/quests', async (req) => { const u = deps.user(req); return view(u.id, u.name); });
    // Claims a finished task: its coins and its pass XP.
    app.post('/v1/quests/claim', async (req, reply) => {
        const u = deps.user(req);
        const input = zod_1.z.object({ id: zod_1.z.string().max(40) }).safeParse(req.body);
        if (!input.success)
            return reply.code(400).send({ error: 'Nieprawidłowe zadanie.' });
        const p = deps.players()[u.id];
        if (!p)
            return reply.code(404).send({ error: 'Nie ma takiego zadania.' });
        const q = tasks(u.id, p), t = [...q.daily, ...q.weekly].find(x => x.id === input.data.id), def = byId.get(input.data.id);
        if (!t || !def)
            return reply.code(404).send({ error: 'Nie ma takiego zadania.' });
        if (t.claimed)
            return reply.code(400).send({ error: 'Nagroda za to zadanie jest już odebrana.' });
        if (t.progress < def.goal)
            return reply.code(400).send({ error: 'To zadanie nie jest jeszcze ukończone.' });
        // checked again inside the queued write: two quick clicks pay once
        let paid = false;
        await deps.mutate(u.id, 'quest-claim', u.id + ':' + def.id + ':' + def.coins, () => {
            if (t.claimed)
                return;
            t.claimed = true;
            paid = true;
            p.coins = (p.coins ?? deps.legacyCoins) + def.coins;
            if ((0, quests_1.seasonActive)())
                pass(p).xp += def.xp;
        });
        if (!paid)
            return reply.code(400).send({ error: 'Nagroda za to zadanie jest już odebrana.' });
        return view(u.id, u.name);
    });
    // Claims every pass level reached and not claimed yet: coins, and the season capes at levels 15 and 30.
    app.post('/v1/pass/claim', async (req, reply) => {
        const u = deps.user(req);
        const p = deps.players()[u.id];
        if (!p)
            return reply.code(400).send({ error: 'Nie ma nic do odebrania.' });
        const s = pass(p), todo = [];
        // levels picked inside the queued write: two quick clicks pay once
        await deps.mutate(u.id, 'pass-claim', u.id, () => {
            for (let l = 1; l <= (0, quests_1.passLevel)(s.xp); l++)
                if (!s.claimed.includes(l))
                    todo.push(l);
            for (const l of todo) {
                const r = (0, quests_1.passReward)(l);
                if (r.coins)
                    p.coins = (p.coins ?? deps.legacyCoins) + r.coins;
                if (r.item && deps.hasItem(r.item) && !p.grants.includes(r.item))
                    p.grants.push(r.item);
                s.claimed.push(l);
            }
        });
        if (!todo.length)
            return reply.code(400).send({ error: 'Nie ma nic do odebrania.' });
        return view(u.id, u.name);
    });
    /** Season pass level of a player (player profile). */
    const level = (id) => { const p = deps.players()[id]; return p?.pass?.season === quests_1.SEASON.id ? (0, quests_1.passLevel)(p.pass.xp) : 0; };
    return { count, played, ready, level };
}
