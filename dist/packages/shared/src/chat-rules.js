"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PARTY_NOTE_MAX_LENGTH = exports.CHAT_MAX_LENGTH = void 0;
exports.chatTextProblem = chatTextProblem;
// What may be written to strangers: the global chat, party chat and open party notes share these rules.
exports.CHAT_MAX_LENGTH = 200;
exports.PARTY_NOTE_MAX_LENGTH = 60;
// Bare server addresses (mc.hypixel.net) stay allowed: finding a server to play on is the point of these chats.
const LINK = /(https?:\/\/|www\.|discord(app)?\.(gg|com)|bit\.ly|tinyurl\.|t\.me\/)/i;
function chatTextProblem(text, max = exports.CHAT_MAX_LENGTH) {
    if (!text.trim())
        return 'empty';
    if (text.length > max)
        return 'long';
    if (LINK.test(text))
        return 'link';
    return null;
}
