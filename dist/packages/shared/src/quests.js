"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dayResetAt = exports.questDay = exports.seasonActive = exports.passLevel = exports.SEASON = exports.QUESTS_PER_PERIOD = exports.WEEKLY_QUESTS = exports.DAILY_QUESTS = void 0;
exports.passReward = passReward;
exports.questWeek = questWeek;
exports.weekResetAt = weekResetAt;
exports.pickQuests = pickQuests;
// EXER Coins stage 3 (approved 2026-10-26): daily and weekly tasks and the free season pass.
// Pure rules shared by the API (which counts and pays) and the launcher (which shows the same numbers).
const shop_1 = require("./shop");
/** 3 a day, 15-30 coins and 20-50 pass XP each; one of them is always a play task. */
exports.DAILY_QUESTS = [
    { id: 'd-play-30', kind: 'play', goal: 30, coins: 20, xp: 30 },
    { id: 'd-play-60', kind: 'play', goal: 60, coins: 30, xp: 50 },
    { id: 'd-server-15', kind: 'server', goal: 15, coins: 25, xp: 40 },
    { id: 'd-equip-3', kind: 'equip', goal: 3, coins: 15, xp: 20 },
    { id: 'd-daily', kind: 'daily', goal: 1, coins: 15, xp: 20 },
    { id: 'd-message', kind: 'message', goal: 1, coins: 15, xp: 20 }
];
/** 3 a week (Monday to Sunday, Polish time), 75-150 coins each; 5 h of play is always one of them. */
exports.WEEKLY_QUESTS = [
    { id: 'w-play-300', kind: 'play', goal: 300, coins: 150, xp: 50 },
    { id: 'w-server-120', kind: 'server', goal: 120, coins: 125, xp: 50 },
    { id: 'w-daily-5', kind: 'daily', goal: 5, coins: 100, xp: 50 },
    { id: 'w-friend', kind: 'friend', goal: 1, coins: 75, xp: 40 },
    { id: 'w-buy', kind: 'buy', goal: 1, coins: 75, xp: 40 }
];
exports.QUESTS_PER_PERIOD = 3;
/** Season 1: 8 weeks, 30 levels of 200 XP; 1 XP a minute in game (at most 120 a day) plus the tasks' XP. */
exports.SEASON = {
    id: 's1', name: 'Sezon 1',
    start: '2026-10-26T23:00:00.000Z', // 27 Oct 2026 00:00 Polish time
    end: '2026-12-21T23:00:00.000Z', // 22 Dec 2026 00:00 Polish time
    levels: 30, xpPerLevel: 200, playXpPerMinute: 1, playXpDailyCap: 120,
    items: { 15: 'season-1-silver-cape', 30: 'season-1-gold-cape' }
};
/** Reward of a pass level: the season capes at 15 and 30, otherwise 50 coins at level 1 rising to 290 at level 29. */
function passReward(level) {
    const item = exports.SEASON.items[level];
    if (item)
        return { item };
    return { coins: 50 + Math.round((level - 1) * 240 / 28 / 10) * 10 };
}
const passLevel = (xp) => Math.min(exports.SEASON.levels, Math.floor(Math.max(0, xp) / exports.SEASON.xpPerLevel));
exports.passLevel = passLevel;
const seasonActive = (now = Date.now()) => Date.parse(exports.SEASON.start) <= now && now < Date.parse(exports.SEASON.end);
exports.seasonActive = seasonActive;
// ---- days and weeks in Polish time (the same clock as the shop of the day) ----
const questDay = (now = Date.now()) => (0, shop_1.shopDay)(now);
exports.questDay = questDay;
/** Monday (YYYY-MM-DD) of the Polish week that `now` falls in. */
function questWeek(now = Date.now()) {
    const d = new Date((0, exports.questDay)(now) + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
    return d.toISOString().slice(0, 10);
}
const dayResetAt = (now = Date.now()) => (0, shop_1.nextShopReset)(now);
exports.dayResetAt = dayResetAt;
/** Next Monday 00:00 Polish time. */
function weekResetAt(now = Date.now()) {
    // midnight to midnight until the new day is a Monday (at most 7 steps, DST-proof)
    let at = (0, shop_1.nextShopReset)(now);
    while (new Date((0, exports.questDay)(at) + 'T00:00:00Z').getUTCDay() !== 1)
        at = (0, shop_1.nextShopReset)(at + 1000);
    return at;
}
function seeded(text) {
    let a = [...text].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** The tasks of one player for a day or a week: a play task first, then two others, picked from the player id and the date. */
function pickQuests(pool, player, period) {
    const random = seeded(player + ':' + period);
    const plays = pool.filter(q => q.kind === 'play'), rest = pool.filter(q => q.kind !== 'play');
    const picked = [plays[Math.floor(random() * plays.length)]];
    while (picked.length < exports.QUESTS_PER_PERIOD && rest.length)
        picked.push(rest.splice(Math.floor(random() * rest.length), 1)[0]);
    return picked;
}
