"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventActive = exports.EVENT_LIMITS = exports.DAILY_SHOP = void 0;
exports.shopDay = shopDay;
exports.nextShopReset = nextShopReset;
exports.dailyShop = dailyShop;
exports.coinMultiplier = coinMultiplier;
exports.finalPrice = finalPrice;
// EXER Coins economy, stage 2 (approved 2026-10-26): the shop of the day and events set in the admin panel.
// Pure rules shared by the API (which charges) and the launcher (which shows the same prices).
const economy_1 = require("./economy");
/** Shop of the day: 4 cosmetics, the first always epic or legendary; it changes at 00:00 Polish time. */
exports.DAILY_SHOP = { size: 4, discounts: [30, 25, 25, 20], timeZone: 'Europe/Warsaw' };
/** Event limits: coin multipliers the admin can pick, a discount between 5 and 90 %, at most 60 days long. */
exports.EVENT_LIMITS = { multipliers: [1.5, 2], minDiscount: 5, maxDiscount: 90, maxDays: 60 };
/** The shop day (YYYY-MM-DD) in Polish time. */
function shopDay(now = Date.now()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: exports.DAILY_SHOP.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}
/** When the shop changes next: the next midnight in Polish time (ms). */
function nextShopReset(now = Date.now()) {
    const day = shopDay(now);
    // step forward by the minute until the Polish date changes (at most a day, once a call): DST-proof without a time zone library
    let lo = now, hi = now + 26 * 3600000;
    while (hi - lo > 1000) {
        const mid = Math.floor((lo + hi) / 2);
        if (shopDay(mid) === day)
            lo = mid;
        else
            hi = mid;
    }
    return Math.round(hi / 60000) * 60000;
}
// Same day, same shop on every server and launcher: a small seeded generator (mulberry32) from the day.
function seeded(day) {
    let a = [...day].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** The day's offers: only items sold for coins (never Discord, founder or giveaway rewards), one per collection. */
function dailyShop(catalog, day = shopDay()) {
    const random = seeded(day);
    const sellable = catalog.filter(c => c.enabled !== false && (0, economy_1.priceOf)(c) !== null).sort((a, b) => a.id.localeCompare(b.id));
    const pick = (pool) => pool.length ? pool[Math.floor(random() * pool.length)] : undefined;
    const picked = [];
    const free = (c) => !picked.some(p => p.id === c.id || (!!c.collection && p.collection === c.collection));
    const top = pick(sellable.filter(c => c.rarity === 'epic' || c.rarity === 'legendary'));
    if (top)
        picked.push(top);
    while (picked.length < exports.DAILY_SHOP.size) {
        const next = pick(sellable.filter(free));
        if (!next)
            break;
        picked.push(next);
    }
    return picked.map((c, i) => ({ id: c.id, discount: exports.DAILY_SHOP.discounts[i] ?? exports.DAILY_SHOP.discounts[exports.DAILY_SHOP.discounts.length - 1] }));
}
const eventActive = (e, now = Date.now()) => Date.parse(e.start) <= now && now < Date.parse(e.end);
exports.eventActive = eventActive;
/** Coins multiplier now: the highest of the running coin events, 1 without one. */
function coinMultiplier(events, now = Date.now()) {
    return events.filter(e => e.kind === 'coins' && (0, exports.eventActive)(e, now)).reduce((m, e) => Math.max(m, e.multiplier || 1), 1);
}
/** Price now: the base price less the bigger of the shop-of-the-day and the event discount (they do not add up). */
function finalPrice(item, shop = [], events = [], now = Date.now()) {
    const base = (0, economy_1.priceOf)(item);
    if (base === null)
        return null;
    const offer = shop.find(o => o.id === item.id)?.discount || 0;
    const event = events.filter(e => e.kind === 'discount' && (0, exports.eventActive)(e, now) && (!e.collection || e.collection === item.collection)).reduce((d, e) => Math.max(d, e.discount || 0), 0);
    const discount = Math.max(offer, event);
    // rounded to 10 coins so prices stay readable (2000 -30 % = 1400, 400 -25 % = 300)
    return { price: discount ? Math.max(10, Math.round(base * (100 - discount) / 1000) * 10) : base, base, discount };
}
