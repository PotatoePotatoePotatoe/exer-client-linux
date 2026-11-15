"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRANSFER = exports.PLAY = exports.STARTER_PACK = exports.FOUNDER_PACK = exports.FOUNDER_CAPE = exports.LEGACY_COINS = exports.START_COINS = exports.FOUNDER_LIMIT = exports.PRICES = void 0;
exports.priceOf = priceOf;
// EXER Coins economy (stage 1). Coins are earned only by playing and being active (never bought with money), and
// cosmetics are unlocked with them. The first FOUNDER_LIMIT accounts own every cosmetic sold for coins, now and later.
const founder_pack_json_1 = __importDefault(require("./founder-pack.json"));
/** Price by rarity when an item has no price of its own. */
exports.PRICES = { common: 150, rare: 400, epic: 900, legendary: 2000 };
exports.FOUNDER_LIMIT = 500;
/** Coins a new account (not a founder) starts with. */
exports.START_COINS = 300;
/** Players before the economy kept the old balance. */
exports.LEGACY_COINS = 2500;
/** Founder cape: only for the first FOUNDER_LIMIT accounts. */
exports.FOUNDER_CAPE = 'founder-cape';
/** Every cosmetic that existed when the economy started. Founders also get every cosmetic added later (apps/api founderItems). */
exports.FOUNDER_PACK = founder_pack_json_1.default;
/** What every other new account gets: a few simple items for each slot. */
exports.STARTER_PACK = ['cape-wink-smile', 'cape-pixel-heart', 'cape-pizza', 'black-cat-ears', 'bunny_ears', 'duck_floatie', 'fox', 'butterfly_wings', 'briefcase', 'exer-cape'];
/** Coins for time in game with the EXER launcher: 10 per hour, at most 40 a day (UTC). */
exports.PLAY = { perHour: 10, dailyCap: 40 };
/** What an item costs in coins; reward-only items (Discord, giveaways, playtime) have no price. */
function priceOf(item) {
    if (item.reward)
        return null;
    if (item.price && item.price > 0)
        return item.price;
    return exports.PRICES[item.rarity || 'common'] ?? exports.PRICES.common;
}
/** Between friends (stage 3): a coin transfer is at least `min` coins and a player sends at most `dailyMax` a day
 * (Polish day), without a fee; a gifted cosmetic costs the giver its store price now. */
exports.TRANSFER = { min: 50, dailyMax: 1000 };
