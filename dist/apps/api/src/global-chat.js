"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRANSLATE_LANGS = void 0;
exports.registerGlobalChat = registerGlobalChat;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const zod_1 = require("zod");
const chat_rules_1 = require("../../../packages/shared/src/chat-rules");
/** Languages a player can have the chat translated into (the models LibreTranslate loads on the VPS). */
exports.TRANSLATE_LANGS = ['pl', 'en', 'de', 'es', 'fr', 'uk', 'ru', 'cs'];
const TRANSLATE_BATCH = 30, TRANSLATE_PER_MINUTE = 120, KEEP_TRANSLATIONS = 4000;
const KEEP_MESSAGES = 100, KEEP_DELETED = 50, KEEP_REPORTS = 300, KEEP_AUDIT = 300, MAX_BLOCKS = 200;
const SEND_GAP_MS = 3000, REPEAT_WINDOW_MS = 30000, MIN_PLAY_MINUTES = 120, REPORTS_PER_HOUR = 10, HOUR_MS = 3600000;
const uuid = zod_1.z.string().regex(/^[a-f0-9]{32}$/);
// Accepted and ignored: there is one room.
const room = zod_1.z.enum(['global', 'pl', 'en']);
const fail = (statusCode, message) => Object.assign(Error(message), { statusCode });
async function registerGlobalChat(app, root, deps) {
    const now = deps.now || Date.now;
    const file = node_path_1.default.join(root, 'global-chat.json');
    let db = { next: 1, messages: [], deleted: [], mutes: {}, blocks: {}, reports: [], audit: [] };
    try {
        db = { ...db, ...JSON.parse(await promises_1.default.readFile(file, 'utf8')) };
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
    // The PL and EN rooms of older versions become the one room (seq numbers were already shared by both).
    if (db.rooms) {
        const gone = db.deleted;
        db.messages = [...(db.messages || []), ...Object.values(db.rooms).flat()].sort((a, b) => a.seq - b.seq).slice(-KEEP_MESSAGES);
        db.deleted = (Array.isArray(gone) ? gone : Object.values((gone || {})).flat()).sort((a, b) => a - b).slice(-KEEP_DELETED);
        delete db.rooms;
    }
    const translate = deps.translate || libreTranslate;
    /** seq:lang -> translated text, or null when the message already is in that language. */
    const translations = new Map();
    const translateTimes = new Map();
    const lastSent = new Map();
    const reportTimes = new Map();
    let queue = Promise.resolve();
    const save = () => {
        queue = queue.catch(() => { }).then(async () => {
            const tmp = `${file}.${node_crypto_1.default.randomUUID()}.tmp`;
            await promises_1.default.writeFile(tmp, JSON.stringify(db));
            await promises_1.default.rename(tmp, file);
        });
        return queue;
    };
    const muteOf = (id) => {
        const mute = db.mutes[id];
        if (!mute)
            return null;
        if (mute.until && Date.parse(mute.until) <= now()) {
            delete db.mutes[id];
            return null;
        }
        return mute;
    };
    const moderator = (id) => deps.can(id, 'chat.moderate');
    function access(id) {
        if (deps.banned(id))
            return { canWrite: false, reason: 'banned', until: null };
        const mute = muteOf(id);
        if (mute)
            return { canWrite: false, reason: 'muted', until: mute.until };
        if (!moderator(id) && !deps.discordLinked(id) && deps.playMinutes(id) < MIN_PLAY_MINUTES)
            return { canWrite: false, reason: 'new-account', until: null };
        return { canWrite: true, reason: null, until: null };
    }
    const log = (actor, action, target, detail) => {
        db.audit.push({ at: new Date(now()).toISOString(), actor: actor.name, action, target, detail });
        db.audit = db.audit.slice(-KEEP_AUDIT);
    };
    function removeMessages(match) {
        const gone = db.messages.filter(match).map(m => m.seq);
        db.messages = db.messages.filter(m => !match(m));
        db.deleted = [...db.deleted, ...gone].slice(-KEEP_DELETED);
    }
    const parse = (schema, value) => {
        const result = schema.safeParse(value);
        if (!result.success)
            throw fail(400, 'Nieprawidłowe żądanie.');
        return result.data;
    };
    app.get('/v1/chat/global', async (req) => {
        const me = deps.user(req);
        const query = parse(zod_1.z.object({ room: room.optional(), after: zod_1.z.coerce.number().int().min(0).default(0) }), req.query);
        const blocked = new Set(db.blocks[me.id] || []);
        return {
            messages: db.messages.filter(m => m.seq > query.after && !blocked.has(m.from)),
            deleted: db.deleted,
            access: access(me.id),
            moderator: moderator(me.id),
            blocked: [...blocked],
            maxLength: chat_rules_1.CHAT_MAX_LENGTH
        };
    });
    // New messages naming this player; without "after" only tells where the room is now, so old mentions stay silent.
    app.get('/v1/chat/mentions', async (req) => {
        const me = deps.user(req);
        const query = parse(zod_1.z.object({ room: room.optional(), after: zod_1.z.coerce.number().int().min(0).optional() }), req.query);
        const list = db.messages, latest = list.at(-1)?.seq || 0;
        if (query.after === undefined)
            return { latest, mentions: [] };
        const blocked = new Set(db.blocks[me.id] || []), tag = '@' + me.name.toLowerCase();
        const named = (text) => text.toLowerCase().split(/[^a-z0-9_@]+/).includes(tag);
        return { latest, mentions: list.filter(m => m.seq > query.after && m.from !== me.id && !blocked.has(m.from) && named(m.text)).map(m => ({ seq: m.seq, name: m.name, text: m.text })) };
    });
    app.post('/v1/chat/global', async (req) => {
        const me = deps.user(req);
        const input = parse(zod_1.z.object({ room: room.optional(), text: zod_1.z.string().max(chat_rules_1.CHAT_MAX_LENGTH * 2) }), req.body);
        const text = input.text.trim();
        const state = access(me.id);
        if (!state.canWrite)
            throw fail(403, state.reason === 'muted' ? 'Masz wyciszony czat.' : state.reason === 'banned' ? 'Konto jest zablokowane.' : 'Połącz Discorda lub zagraj 2 godziny, żeby pisać.');
        const problem = (0, chat_rules_1.chatTextProblem)(text);
        if (problem === 'link')
            throw fail(400, 'Linki są zablokowane na czacie.');
        if (problem)
            throw fail(400, 'Nieprawidłowa wiadomość.');
        const last = lastSent.get(me.id);
        if (last && now() - last.at < SEND_GAP_MS)
            throw fail(429, 'Zwolnij, jedna wiadomość na 3 sekundy.');
        if (last && last.text === text.toLowerCase() && now() - last.at < REPEAT_WINDOW_MS)
            throw fail(429, 'Nie powtarzaj tej samej wiadomości.');
        lastSent.set(me.id, { at: now(), text: text.toLowerCase() });
        const message = { seq: db.next++, from: me.id, name: me.name, group: deps.group(me.id), text, at: new Date(now()).toISOString() };
        db.messages.push(message);
        db.messages = db.messages.slice(-KEEP_MESSAGES);
        await save();
        return { ok: true, seq: message.seq };
    });
    // Translations of chat messages into the player's language: { seq: text }, without the messages already in it.
    app.post('/v1/chat/translate', async (req) => {
        const me = deps.user(req);
        const input = parse(zod_1.z.object({ seqs: zod_1.z.array(zod_1.z.number().int()).max(TRANSLATE_BATCH), to: zod_1.z.enum(exports.TRANSLATE_LANGS) }), req.body);
        const wanted = db.messages.filter(m => input.seqs.includes(m.seq));
        const missing = wanted.filter(m => !translations.has(m.seq + ':' + input.to));
        if (missing.length) {
            const times = (translateTimes.get(me.id) || []).filter(t => t > now() - 60000);
            if (times.length + missing.length > TRANSLATE_PER_MINUTE)
                throw fail(429, 'Za dużo tłumaczeń, spróbuj za chwilę.');
            translateTimes.set(me.id, [...times, ...missing.map(() => now())]);
            let done;
            try {
                done = await translate(missing.map(m => m.text), input.to);
            }
            catch {
                throw fail(503, 'Tłumacz jest teraz niedostępny.');
            }
            missing.forEach((m, i) => { const r = done[i]; translations.set(m.seq + ':' + input.to, !r || r.from === input.to || r.text.trim() === m.text.trim() ? null : r.text); });
            while (translations.size > KEEP_TRANSLATIONS)
                translations.delete(translations.keys().next().value);
        }
        const out = {};
        for (const m of wanted) {
            const t = translations.get(m.seq + ':' + input.to);
            if (t)
                out[m.seq] = t;
        }
        return { to: input.to, translations: out };
    });
    app.post('/v1/chat/block', async (req) => {
        const me = deps.user(req);
        const input = parse(zod_1.z.object({ id: uuid, on: zod_1.z.boolean() }), req.body);
        const list = (db.blocks[me.id] || []).filter(id => id !== input.id);
        db.blocks[me.id] = input.on && input.id !== me.id ? [...list, input.id].slice(-MAX_BLOCKS) : list;
        await save();
        return { blocked: db.blocks[me.id] };
    });
    app.post('/v1/chat/report', async (req) => {
        const me = deps.user(req);
        const input = parse(zod_1.z.object({ room: room.optional(), seq: zod_1.z.number().int().optional(), id: uuid.optional(), name: zod_1.z.string().regex(/^[A-Za-z0-9_]{1,16}$/).optional(), reason: zod_1.z.string().trim().min(1).max(120) }), req.body);
        const times = (reportTimes.get(me.id) || []).filter(t => t > now() - HOUR_MS);
        if (times.length >= REPORTS_PER_HOUR)
            throw fail(429, 'Za dużo zgłoszeń, spróbuj później.');
        // A chat report carries the server's own copy of the message; a party report only names the player, party chat is not stored.
        const message = input.seq !== undefined ? db.messages.find(m => m.seq === input.seq) : undefined;
        if (input.seq !== undefined && !message)
            throw fail(404, 'Tej wiadomości już nie ma.');
        if (!message && !(input.id && input.name))
            throw fail(400, 'Nieprawidłowe zgłoszenie.');
        const target = message ? message.from : input.id, targetName = message ? message.name : input.name;
        if (target === me.id)
            throw fail(400, 'Nie możesz zgłosić siebie.');
        reportTimes.set(me.id, [...times, now()]);
        const report = { id: node_crypto_1.default.randomUUID(), at: new Date(now()).toISOString(), reporter: me.id, reporterName: me.name, source: message ? 'global' : 'party', target, targetName, text: message?.text || '', reason: input.reason, open: true };
        db.reports.push(report);
        db.reports = db.reports.slice(-KEEP_REPORTS);
        await save();
        deps.alert({ type: 'chat-report', actor: me.name, target: targetName, kind: report.source, reason: report.reason, text: report.text });
        return { ok: true };
    });
    app.post('/v1/chat/moderation/delete', async (req) => {
        const me = deps.user(req, 'chat.moderate');
        const input = parse(zod_1.z.object({ room: room.optional(), seq: zod_1.z.number().int() }), req.body);
        const message = db.messages.find(m => m.seq === input.seq);
        if (!message)
            return { ok: true };
        if (message.from !== me.id && deps.rank(message.from) >= deps.rank(me.id))
            throw fail(403, 'Możesz moderować tylko graczy poniżej swojej rangi.');
        removeMessages(m => m.seq === input.seq);
        log(me, 'delete', message.name, message.text);
        await save();
        return { ok: true };
    });
    app.post('/v1/chat/moderation/mute', async (req) => {
        const me = deps.user(req, 'chat.moderate');
        const input = parse(zod_1.z.object({ id: uuid, name: zod_1.z.string().max(16), minutes: zod_1.z.number().int().min(1).max(525600).nullable(), reason: zod_1.z.string().trim().max(120).default('') }), req.body);
        if (input.id === me.id || deps.rank(input.id) >= deps.rank(me.id))
            throw fail(403, 'Możesz moderować tylko graczy poniżej swojej rangi.');
        const until = input.minutes === null ? null : new Date(now() + input.minutes * 60000).toISOString();
        db.mutes[input.id] = { name: input.name, until, reason: input.reason, by: me.name };
        removeMessages(m => m.from === input.id);
        log(me, 'mute', input.name, `${input.minutes === null ? 'permanent' : input.minutes + ' min'} ${input.reason}`.trim());
        await save();
        return { ok: true };
    });
    app.post('/v1/chat/moderation/unmute', async (req) => {
        const me = deps.user(req, 'chat.moderate');
        const input = parse(zod_1.z.object({ id: uuid }), req.body);
        const mute = db.mutes[input.id];
        if (mute) {
            delete db.mutes[input.id];
            log(me, 'unmute', mute.name, '');
            await save();
        }
        return { ok: true };
    });
    app.post('/v1/chat/moderation/resolve', async (req) => {
        const me = deps.user(req, 'chat.moderate');
        const input = parse(zod_1.z.object({ id: zod_1.z.string().uuid() }), req.body);
        const report = db.reports.find(r => r.id === input.id);
        if (report?.open) {
            report.open = false;
            log(me, 'resolve', report.targetName, report.reason);
            await save();
        }
        return { ok: true };
    });
    app.get('/v1/chat/moderation', async (req) => {
        deps.user(req, 'chat.moderate');
        return {
            reports: db.reports.filter(r => r.open).reverse(),
            mutes: Object.entries(db.mutes).filter(([id]) => muteOf(id)).map(([id, m]) => ({ id, ...m })),
            audit: db.audit.slice(-50).reverse()
        };
    });
    app.addHook('onClose', async () => { await queue.catch(() => { }); });
    return {
        /** What the voice service needs in a ticket: may this player talk to strangers, and who do they refuse to meet. */
        voiceAccess: (id) => ({ chat: access(id).canWrite, blocked: db.blocks[id] || [] })
    };
}
/** LibreTranslate on the VPS (systemd exer-translate, listening on 127.0.0.1 only). */
async function libreTranslate(texts, to) {
    const base = (process.env.EXER_TRANSLATE_URL || 'http://127.0.0.1:5000').replace(/\/+$/, '');
    const reply = await fetch(base + '/translate', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: texts, source: 'auto', target: to, format: 'text' }), signal: AbortSignal.timeout(8000) });
    if (!reply.ok)
        throw Error('translate ' + reply.status);
    const data = await reply.json();
    const textsOut = Array.isArray(data.translatedText) ? data.translatedText : [data.translatedText];
    const langs = Array.isArray(data.detectedLanguage) ? data.detectedLanguage : [data.detectedLanguage];
    return textsOut.map((text, i) => ({ text, from: langs[i]?.language || '' }));
}
