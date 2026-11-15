"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VOICE_TICKET_TTL_MS = void 0;
exports.signVoiceTicket = signVoiceTicket;
exports.verifyVoiceTicket = verifyVoiceTicket;
const node_crypto_1 = __importDefault(require("node:crypto"));
// Short-lived pass into the voice service: the API (which knows bans and game tokens) signs it,
// the voice service only checks the signature and never talks to the API.
exports.VOICE_TICKET_TTL_MS = 10 * 60 * 1000;
const mac = (body, secret) => node_crypto_1.default.createHmac('sha256', secret).update(body).digest('base64url');
function signVoiceTicket(ticket, secret) {
    const body = Buffer.from(JSON.stringify(ticket)).toString('base64url');
    return `${body}.${mac(body, secret)}`;
}
function verifyVoiceTicket(value, secret, now = Date.now()) {
    if (typeof value !== 'string' || value.length > 32 * 1024 || !secret)
        return null;
    const [body, signature, extra] = value.split('.');
    if (!body || !signature || extra !== undefined)
        return null;
    const expected = Buffer.from(mac(body, secret)), actual = Buffer.from(signature);
    if (expected.length !== actual.length || !node_crypto_1.default.timingSafeEqual(expected, actual))
        return null;
    try {
        const ticket = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (typeof ticket.id !== 'string' || !/^[0-9a-f]{32}$/.test(ticket.id) || typeof ticket.name !== 'string' || !Number.isFinite(ticket.exp) || ticket.exp <= now)
            return null;
        const friends = Array.isArray(ticket.friends) ? ticket.friends.filter((id) => typeof id === 'string') : [];
        const blocked = Array.isArray(ticket.blocked) ? ticket.blocked.filter((id) => typeof id === 'string') : [];
        return { id: ticket.id, name: ticket.name, exp: ticket.exp, friends, control: ticket.control === true, blocked, chat: ticket.chat === true };
    }
    catch {
        return null;
    }
}
