"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RANKING = void 0;
exports.registerRanking = registerRanking;
const quests_1 = require("../../../packages/shared/src/quests");
// Weekly ranking (EXER Coins stage 5): hours in game this week, the /daily streak and the size of the collection.
// When a Polish week ends, the top 3 of every table get RANKING.prizes coins and the bot posts the winners.
exports.RANKING = { prizes: [500, 300, 150], shown: 10, tables: ['hours', 'streak', 'collection'] };
function registerRanking(app, deps) {
    /** The three tables of a week. Founders own every cosmetic by rule, so the collection table is for the others. */
    function tables(week) {
        const all = Object.entries(deps.players());
        const sort = (rows) => rows.filter(r => r.value > 0).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
        return {
            hours: sort(all.map(([id, p]) => ({ id, name: p.name, value: p.weekPlay?.week === week ? p.weekPlay.minutes : 0 }))),
            streak: sort(all.map(([id, p]) => ({ id, name: p.name, value: deps.streak(id) }))),
            collection: sort(all.filter(([, p]) => !p.founder).map(([id, p]) => ({ id, name: p.name, value: p.grants.filter(deps.sellable).length })))
        };
    }
    // Paying out last week: once, when its week is over. The first run after the ranking came in only remembers the week,
    // so nobody is paid for a week that was not counted yet.
    let settling = null;
    function settle(now = Date.now()) {
        const thisWeek = (0, quests_1.questWeek)(now), last = (0, quests_1.questWeek)(Date.parse(thisWeek + 'T12:00:00Z') - 7 * 86400000), s = deps.state();
        if (s.rankingWeek === last || s.rankingWeek === thisWeek || settling)
            return settling || Promise.resolve();
        const first = !s.rankingWeek;
        const t = tables(last);
        const result = { week: last, tables: Object.fromEntries(exports.RANKING.tables.map(k => [k, t[k].slice(0, 3).map((r, i) => ({ ...r, prize: first ? 0 : exports.RANKING.prizes[i] }))])) };
        settling = deps.mutate('ranking', 'ranking-paid', last, () => {
            const st = deps.state();
            if (st.rankingWeek === last)
                return;
            st.rankingWeek = last;
            if (first)
                return;
            for (const k of exports.RANKING.tables)
                for (const w of result.tables[k]) {
                    const p = deps.players()[w.id];
                    if (p)
                        p.coins = (p.coins ?? deps.legacyCoins) + w.prize;
                }
            st.rankings = [result, ...(st.rankings || [])].slice(0, 8);
        }).then(async () => { if (!first && exports.RANKING.tables.some(k => result.tables[k].length))
            await deps.announce(result); }).finally(() => { settling = null; });
        return settling;
    }
    const timer = setInterval(() => void settle().catch(() => { }), 60000);
    timer.unref?.();
    app.addHook('onClose', async () => clearInterval(timer));
    // This week so far (top 10 of each table and the player's own place), when it ends, and last week's winners.
    app.get('/v1/ranking', async (req) => {
        const u = deps.user(req);
        await settle().catch(() => { });
        const now = Date.now(), week = (0, quests_1.questWeek)(now), t = tables(week);
        const mine = Object.fromEntries(exports.RANKING.tables.map(k => { const i = t[k].findIndex(r => r.id === u.id); return [k, i < 0 ? null : { place: i + 1, value: t[k][i].value }]; }));
        return { week, endsAt: (0, quests_1.weekResetAt)(now), prizes: exports.RANKING.prizes,
            tables: Object.fromEntries(exports.RANKING.tables.map(k => [k, t[k].slice(0, exports.RANKING.shown).map(({ name, value }, i) => ({ place: i + 1, name, value, me: t[k][i].id === u.id }))])),
            mine, last: deps.state().rankings?.[0] || null };
    });
    return { settle };
}
