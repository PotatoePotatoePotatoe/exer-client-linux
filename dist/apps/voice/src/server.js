"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLOSE_FULL = exports.CLOSE_ABUSE = exports.CLOSE_REPLACED = exports.CLOSE_BAD_TICKET = exports.REACTIONS = exports.MAX_PARTY = exports.VOICE_RANGE = void 0;
exports.createVoiceServer = createVoiceServer;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_http_1 = __importDefault(require("node:http"));
const ws_1 = require("ws");
const voice_ticket_1 = require("../../../packages/shared/src/voice-ticket");
const chat_rules_1 = require("../../../packages/shared/src/chat-rules");
// EXER voice relay. Audio only passes through memory: nothing is stored or logged. Parties live here too, so they end with the process.
// Client to server: text {t:'hello',ticket} first, then {t:'state',room,x,y,z,partyOnly} and {t:'party',a,...}; binary frames are Opus packets.
// Server to client: text {t:'ready',id}, {t:'peer',id,name}, {t:'party',party}, {t:'invites',list}, {t:'partyError',code};
// binary frames are AUDIO or PARTY_AUDIO + 16 bytes of speaker id + Opus.
// Reactions: client {t:'react',e} (one of REACTIONS, at most one per REACT_GAP_MS), server {t:'react',id,e} to players in range.
// A launcher connects with a control ticket: it manages the party next to the game's connection and carries party audio
// only while that account has no game connected ({t:'game',active} tells it).
exports.VOICE_RANGE = 64, exports.MAX_PARTY = 8;
exports.REACTIONS = ['gg', 'heart', 'laugh', 'thumbs', 'fire', 'wow'];
const REACT_GAP_MS = 1500;
exports.CLOSE_BAD_TICKET = 4003, exports.CLOSE_REPLACED = 4001, exports.CLOSE_ABUSE = 4008, exports.CLOSE_FULL = 4013;
const AUDIO = 1, PARTY_AUDIO = 2, MAX_PEERS = 500, MAX_PACKET = 512, MAX_PACKETS_PER_SECOND = 60, MAX_ROOM = 128, MAX_TEXT = 64 * 1024;
const MAX_QUEUED_BYTES = 64 * 1024, HELLO_TIMEOUT_MS = 5000, HEARTBEAT_MS = 20000, PARTY_GRACE_MS = 5 * 60 * 1000, LAUNCH_COOLDOWN_MS = 30000;
const STRANGER_GRACE_MS = 60000, QUEUE_MAX_MS = 5 * 60 * 1000, QUEUE_RELAX_MS = 60000, MATCH_ACCEPT_MS = 20000, TICK_MS = 1000, SAY_GAP_MS = 1500, PROPOSE_GAP_MS = 10000;
const QUEUE_SIZES = [2, 3, 4, 8], LANGS = ['pl', 'en'], SERVER = /^[-a-zA-Z0-9.:[\]]{1,255}$/, VERSION = /^[0-9.]{1,16}$/;
function createVoiceServer(options) {
    const now = options.now || Date.now;
    const peers = new Map();
    const controls = new Map();
    const rooms = new Map();
    const parties = new Map();
    const memberOf = new Map();
    const queue = new Map();
    const matches = new Map();
    const matchOf = new Map();
    const server = node_http_1.default.createServer((req, res) => {
        if (req.url === '/health') {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ service: 'EXER voice', status: 'ok', peers: peers.size }));
            return;
        }
        res.statusCode = 404;
        res.end();
    });
    const sockets = new ws_1.WebSocketServer({ noServer: true, maxPayload: MAX_TEXT, perMessageDeflate: false });
    server.on('upgrade', (req, socket, head) => {
        if (req.url !== '/voice') {
            socket.destroy();
            return;
        }
        sockets.handleUpgrade(req, socket, head, ws => accept(ws));
    });
    const online = (id) => peers.has(id) || controls.has(id);
    const sendText = (peer, message) => { if (peer && peer.ws.readyState === ws_1.WebSocket.OPEN)
        peer.ws.send(JSON.stringify(message)); };
    const sendTo = (id, message) => { sendText(peers.get(id), message); sendText(controls.get(id), message); };
    const partyView = (party) => ({ id: party.id, leader: party.leader, members: [...party.members].map(([id, name]) => ({ id, name })), invited: [...party.invited.keys()], public: party.public, open: party.open, votes: Object.fromEntries([...party.votes].map(([id, voters]) => [id, voters.size])) });
    const invitesFor = (id) => [...parties.values()].filter(party => party.invited.has(id)).map(party => ({ party: party.id, from: party.invited.get(id) }));
    const pushInvites = (id) => sendTo(id, { t: 'invites', list: invitesFor(id) });
    const pushParty = (party) => { for (const id of party.members.keys())
        sendTo(id, { t: 'party', party: partyView(party) }); };
    function leaveParty(id) {
        const party = memberOf.get(id);
        if (!party)
            return;
        memberOf.delete(id);
        party.members.delete(id);
        party.votes.delete(id);
        for (const voters of party.votes.values())
            voters.delete(id);
        sendTo(id, { t: 'party', party: null });
        if (!party.members.size) {
            parties.delete(party.id);
            for (const invited of party.invited.keys())
                pushInvites(invited);
            return;
        }
        if (party.leader === id)
            party.leader = party.members.keys().next().value;
        pushParty(party);
    }
    function createParty(peer) {
        const party = { id: node_crypto_1.default.randomUUID(), leader: peer.id, members: new Map([[peer.id, peer.name]]), invited: new Map(), launchedAt: 0, public: false, open: null, votes: new Map(), removed: new Set() };
        parties.set(party.id, party);
        memberOf.set(peer.id, party);
        return party;
    }
    function onParty(peer, message) {
        const fail = (code) => sendText(peer, { t: 'partyError', code });
        const mine = memberOf.get(peer.id);
        if (message.a === 'invite') {
            const target = String(message.id);
            if (!peer.friends.has(target))
                return fail('not-friend');
            if (!online(target))
                return fail('offline');
            if (memberOf.get(target) === mine && mine)
                return fail('already');
            if (mine && mine.members.size + mine.invited.size >= exports.MAX_PARTY)
                return fail('full');
            const party = mine || createParty(peer);
            party.invited.set(target, peer.name);
            pushParty(party);
            pushInvites(target);
        }
        else if (message.a === 'accept') {
            const party = parties.get(String(message.party));
            if (!party || !party.invited.has(peer.id))
                return fail('expired');
            if (party.members.size >= exports.MAX_PARTY)
                return fail('full');
            leaveParty(peer.id);
            party.invited.delete(peer.id);
            party.members.set(peer.id, peer.name);
            memberOf.set(peer.id, party);
            pushParty(party);
            pushInvites(peer.id);
        }
        else if (message.a === 'decline') {
            const party = parties.get(String(message.party));
            if (party?.invited.delete(peer.id))
                pushParty(party);
            pushInvites(peer.id);
        }
        else if (message.a === 'leave') {
            leaveParty(peer.id);
        }
        else if (message.a === 'disband') {
            if (!mine || mine.leader !== peer.id)
                return fail('not-leader');
            for (const id of [...mine.members.keys()])
                leaveParty(id);
        }
        else if (message.a === 'launch') {
            if (!mine || mine.leader !== peer.id)
                return fail('not-leader');
            if (mine.public)
                return fail('public-party');
            const { server: address, version } = message;
            if (typeof address !== 'string' || !/^[-a-zA-Z0-9.:[\]]{1,255}$/.test(address) || typeof version !== 'string' || !/^[0-9.]{1,16}$/.test(version))
                return fail('bad-launch');
            if (now() - mine.launchedAt < LAUNCH_COOLDOWN_MS)
                return fail('cooldown');
            mine.launchedAt = now();
            for (const id of mine.members.keys())
                if (id !== peer.id)
                    sendTo(id, { t: 'launch', from: peer.name, server: address, version });
        }
        else if (message.a === 'kick') {
            const target = String(message.id);
            if (!mine || mine.leader !== peer.id || target === peer.id || !mine.members.has(target))
                return fail('not-leader');
            if (mine.public)
                return fail('vote-only');
            leaveParty(target);
        }
        else if (message.a === 'votekick') {
            const target = String(message.id);
            if (!mine || !mine.public || target === peer.id || !mine.members.has(target))
                return fail('not-allowed');
            const voters = mine.votes.get(target) || new Set();
            voters.add(peer.id);
            mine.votes.set(target, voters);
            if (voters.size > (mine.members.size - 1) / 2) {
                mine.removed.add(target);
                leaveParty(target);
            }
            pushParty(mine);
        }
        else if (message.a === 'block') {
            const target = String(message.id);
            if (message.on === false)
                peer.blocked.delete(target);
            else
                peer.blocked.add(target);
        }
        else if (message.a === 'say') {
            if (!mine)
                return fail('not-allowed');
            if (!mayMeetStrangers(peer))
                return fail('not-eligible');
            const text = String(message.text || '').trim();
            if ((0, chat_rules_1.chatTextProblem)(text))
                return fail('bad-text');
            if (now() - peer.lastSay < SAY_GAP_MS)
                return fail('slow-down');
            peer.lastSay = now();
            for (const id of mine.members.keys())
                if (!controls.get(id)?.blocked.has(peer.id))
                    sendText(controls.get(id), { t: 'say', from: peer.id, name: peer.name, text, at: now() });
        }
        else if (message.a === 'propose') {
            const { server: address, version } = message;
            if (!mine || typeof address !== 'string' || !SERVER.test(address) || typeof version !== 'string' || !VERSION.test(version))
                return fail('bad-launch');
            if (now() - peer.lastPropose < PROPOSE_GAP_MS)
                return fail('slow-down');
            peer.lastPropose = now();
            for (const id of mine.members.keys())
                if (!controls.get(id)?.blocked.has(peer.id))
                    sendText(controls.get(id), { t: 'propose', from: peer.name, server: address, version });
        }
        else if (message.a === 'queue') {
            if (!mayMeetStrangers(peer))
                return fail('not-eligible');
            if (mine && mine.members.size > 1)
                return fail('in-party');
            if (!QUEUE_SIZES.includes(message.size) || !LANGS.includes(message.lang))
                return fail('bad-queue');
            if (matchOf.has(peer.id))
                return;
            queue.set(peer.id, { id: peer.id, name: peer.name, size: message.size, voice: message.voice === true, lang: message.lang, since: now() });
            pushQueue(peer.id, 'searching');
            formMatches();
        }
        else if (message.a === 'unqueue') {
            queue.delete(peer.id);
            const match = matchOf.get(peer.id);
            if (match)
                endMatch(match, new Set([peer.id]));
            pushQueue(peer.id, 'idle');
        }
        else if (message.a === 'match-accept') {
            const match = matchOf.get(peer.id);
            if (!match || match.id !== message.match)
                return fail('expired');
            match.accepted.add(peer.id);
            if (match.accepted.size === match.entries.length)
                completeMatch(match);
        }
        else if (message.a === 'match-decline') {
            const match = matchOf.get(peer.id);
            if (match)
                endMatch(match, new Set([peer.id]));
        }
        else if (message.a === 'publish') {
            if (!mayMeetStrangers(peer))
                return fail('not-eligible');
            const note = String(message.note || '').trim(), max = Number(message.max);
            if ((0, chat_rules_1.chatTextProblem)(note, chat_rules_1.PARTY_NOTE_MAX_LENGTH))
                return fail('bad-text');
            if (!LANGS.includes(message.lang) || !Number.isInteger(max) || max < 2 || max > exports.MAX_PARTY)
                return fail('bad-queue');
            if (mine && mine.leader !== peer.id)
                return fail('not-leader');
            if (mine && max <= mine.members.size)
                return fail('full');
            const party = mine || createParty(peer);
            party.open = { note, lang: message.lang, max };
            pushParty(party);
        }
        else if (message.a === 'unpublish') {
            if (!mine || mine.leader !== peer.id)
                return fail('not-leader');
            mine.open = null;
            pushParty(mine);
        }
        else if (message.a === 'list') {
            const lang = String(message.lang);
            sendText(peer, { t: 'open', list: [...parties.values()].filter(party => party.open?.lang === lang && party.members.size < party.open.max && party !== mine && !party.removed.has(peer.id) && canMeet(peer.id, party)).slice(0, 50).map(party => ({ party: party.id, note: party.open.note, leader: party.members.get(party.leader), count: party.members.size, max: party.open.max })) });
        }
        else if (message.a === 'join') {
            if (!mayMeetStrangers(peer))
                return fail('not-eligible');
            const party = parties.get(String(message.party));
            if (!party?.open || party === mine || party.removed.has(peer.id) || !canMeet(peer.id, party))
                return fail('expired');
            if (party.members.size >= party.open.max)
                return fail('full');
            queue.delete(peer.id);
            leaveParty(peer.id);
            party.members.set(peer.id, peer.name);
            memberOf.set(peer.id, party);
            party.public = true;
            pushParty(party);
        }
    }
    const blocks = (a, b) => !!controls.get(a)?.blocked.has(b) || !!controls.get(b)?.blocked.has(a);
    const canMeet = (id, party) => ![...party.members.keys()].some(member => blocks(id, member));
    // Only a launcher with a fresh ticket: a mute or ban reaches every player within one ticket lifetime.
    const mayMeetStrangers = (peer) => peer.control && peer.chat && peer.ticketExp > now();
    const pushQueue = (id, state, reason) => {
        const entry = queue.get(id);
        sendText(controls.get(id), { t: 'queue', state, size: entry?.size, voice: entry?.voice, since: entry?.since, reason });
    };
    const relaxed = (entry) => now() - entry.since >= QUEUE_RELAX_MS;
    const compatible = (a, b) => !blocks(a.id, b.id) && (a.voice === b.voice || (relaxed(a) && relaxed(b)));
    function formMatches() {
        const waiting = [...queue.values()].sort((a, b) => a.since - b.since);
        const taken = new Set();
        for (const first of waiting) {
            if (taken.has(first.id))
                continue;
            const group = [first];
            for (const other of waiting) {
                if (group.length === first.size)
                    break;
                if (taken.has(other.id) || other === first || other.size !== first.size || other.lang !== first.lang)
                    continue;
                if (group.every(entry => compatible(entry, other)))
                    group.push(other);
            }
            if (group.length < first.size)
                continue;
            for (const entry of group) {
                taken.add(entry.id);
                queue.delete(entry.id);
            }
            const match = { id: node_crypto_1.default.randomUUID(), entries: group, accepted: new Set(), deadline: now() + MATCH_ACCEPT_MS };
            matches.set(match.id, match);
            for (const entry of group) {
                matchOf.set(entry.id, match);
                sendText(controls.get(entry.id), { t: 'match', id: match.id, size: group.length, ms: MATCH_ACCEPT_MS });
            }
        }
    }
    function closeMatch(match) {
        matches.delete(match.id);
        for (const entry of match.entries)
            matchOf.delete(entry.id);
    }
    function completeMatch(match) {
        closeMatch(match);
        for (const entry of match.entries)
            leaveParty(entry.id);
        const leader = match.entries[0];
        const party = { id: node_crypto_1.default.randomUUID(), leader: leader.id, members: new Map(match.entries.map(entry => [entry.id, entry.name])), invited: new Map(), launchedAt: 0, public: true, open: null, votes: new Map(), removed: new Set() };
        parties.set(party.id, party);
        for (const entry of match.entries) {
            memberOf.set(entry.id, party);
            pushQueue(entry.id, 'idle');
        }
        pushParty(party);
    }
    /** dropped leave the queue; everyone else who accepted goes back in without losing their place. */
    function endMatch(match, dropped) {
        closeMatch(match);
        for (const entry of match.entries) {
            if (dropped.has(entry.id)) {
                pushQueue(entry.id, 'idle', 'declined');
                continue;
            }
            if (!controls.has(entry.id))
                continue;
            queue.set(entry.id, entry);
            pushQueue(entry.id, 'searching');
        }
        formMatches();
    }
    function tick() {
        for (const entry of [...queue.values()])
            if (now() - entry.since >= QUEUE_MAX_MS) {
                queue.delete(entry.id);
                pushQueue(entry.id, 'idle', 'timeout');
            }
        for (const match of [...matches.values()])
            if (now() >= match.deadline)
                endMatch(match, new Set(match.entries.filter(entry => !match.accepted.has(entry.id)).map(entry => entry.id)));
        formMatches();
    }
    function leaveRoom(peer) {
        const room = rooms.get(peer.room);
        if (!room)
            return;
        room.delete(peer);
        if (!room.size)
            rooms.delete(peer.room);
    }
    function joinRoom(peer, name) {
        if (peer.room === name)
            return;
        leaveRoom(peer);
        peer.room = name;
        if (!name)
            return;
        let room = rooms.get(name);
        if (!room)
            rooms.set(name, room = new Set());
        room.add(peer);
    }
    function deliver(from, to, packet) {
        if (to === from || to.ws.readyState !== ws_1.WebSocket.OPEN || to.ws.bufferedAmount > MAX_QUEUED_BYTES)
            return;
        if (!to.known.has(from.id)) {
            to.known.add(from.id);
            to.ws.send(JSON.stringify({ t: 'peer', id: from.id, name: from.name }));
        }
        to.ws.send(packet, { binary: true });
    }
    function forward(from, data) {
        if (data.length > MAX_PACKET)
            return;
        const party = memberOf.get(from.id);
        if (party) {
            const packet = Buffer.concat([from.partyHeader, data]);
            for (const id of party.members.keys()) {
                const to = peers.get(id) || controls.get(id);
                if (to)
                    deliver(from, to, packet);
            }
        }
        const room = rooms.get(from.room);
        if (!room || !from.located || from.partyOnly)
            return;
        const packet = Buffer.concat([from.header, data]);
        for (const to of room) {
            if (!to.located || party?.members.has(to.id))
                continue;
            const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
            if (dx * dx + dy * dy + dz * dz <= exports.VOICE_RANGE * exports.VOICE_RANGE)
                deliver(from, to, packet);
        }
    }
    /** A reaction over the head: to players in range in the same room who did not block the sender. */
    function onReact(from, message) {
        const emote = String(message.e || '');
        if (!exports.REACTIONS.includes(emote) || now() - from.lastReact < REACT_GAP_MS)
            return;
        from.lastReact = now();
        const room = rooms.get(from.room);
        if (!room || !from.located)
            return;
        for (const to of room) {
            if (to === from || !to.located || to.blocked.has(from.id))
                continue;
            const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
            if (dx * dx + dy * dy + dz * dz <= exports.VOICE_RANGE * exports.VOICE_RANGE)
                sendText(to, { t: 'react', id: from.id, e: emote });
        }
    }
    function overLimit(peer) {
        const second = Math.floor(now() / 1000);
        if (second !== peer.second) {
            peer.second = second;
            peer.packets = 0;
        }
        return ++peer.packets > MAX_PACKETS_PER_SECOND;
    }
    function onState(peer, message) {
        const { room, x, y, z } = message;
        if (typeof room !== 'string' || room.length > MAX_ROOM || ![x, y, z].every(Number.isFinite))
            return;
        joinRoom(peer, room);
        peer.x = x;
        peer.y = y;
        peer.z = z;
        peer.located = true;
        peer.partyOnly = message.partyOnly === true;
    }
    function register(ws, ticket) {
        const slots = ticket.control ? controls : peers;
        const old = slots.get(ticket.id);
        if (!old && peers.size + controls.size >= MAX_PEERS) {
            ws.close(exports.CLOSE_FULL);
            return null;
        }
        if (old) {
            leaveRoom(old);
            old.ws.close(exports.CLOSE_REPLACED);
        }
        const id = Buffer.from(ticket.id, 'hex');
        const peer = { ws, id: ticket.id, name: ticket.name, control: !!ticket.control, friends: new Set(ticket.friends || []), header: Buffer.concat([Buffer.from([AUDIO]), id]), partyHeader: Buffer.concat([Buffer.from([PARTY_AUDIO]), id]), room: '', x: 0, y: 0, z: 0, located: false, partyOnly: false, known: new Set(), second: 0, packets: 0, alive: true, blocked: new Set(ticket.blocked || []), chat: !!ticket.chat, ticketExp: ticket.exp, lastSay: 0, lastPropose: 0, lastReact: 0 };
        slots.set(ticket.id, peer);
        ws.send(JSON.stringify({ t: 'ready', id: ticket.id }));
        if (ticket.control)
            sendText(peer, { t: 'game', active: peers.has(ticket.id) });
        else
            sendText(controls.get(ticket.id), { t: 'game', active: true });
        const party = memberOf.get(ticket.id);
        sendText(peer, { t: 'party', party: party ? partyView(party) : null });
        sendText(peer, { t: 'invites', list: invitesFor(ticket.id) });
        return peer;
    }
    function accept(ws) {
        let peer = null;
        const hello = setTimeout(() => ws.close(exports.CLOSE_BAD_TICKET), HELLO_TIMEOUT_MS);
        ws.on('error', () => { });
        ws.on('pong', () => { if (peer)
            peer.alive = true; });
        ws.on('close', () => {
            clearTimeout(hello);
            if (!peer)
                return;
            const current = peer, slots = current.control ? controls : peers;
            if (slots.get(current.id) !== current)
                return;
            slots.delete(current.id);
            leaveRoom(current);
            if (!current.control)
                sendText(controls.get(current.id), { t: 'game', active: false });
            if (current.control) {
                queue.delete(current.id);
                const match = matchOf.get(current.id);
                if (match)
                    endMatch(match, new Set([current.id]));
            }
            const party = memberOf.get(current.id);
            if (!online(current.id) && party)
                setTimeout(() => { if (!online(current.id))
                    leaveParty(current.id); }, options.partyGraceMs ?? (party.public ? STRANGER_GRACE_MS : PARTY_GRACE_MS)).unref();
        });
        ws.on('message', (raw, binary) => {
            const data = raw;
            if (binary) {
                if (!peer || (peer.control && peers.has(peer.id)))
                    return;
                if (overLimit(peer))
                    ws.close(exports.CLOSE_ABUSE);
                else
                    forward(peer, data);
                return;
            }
            let message;
            try {
                message = JSON.parse(data.toString('utf8'));
            }
            catch {
                ws.close(exports.CLOSE_ABUSE);
                return;
            }
            if (peer) {
                if (message.t === 'state' && !peer.control)
                    onState(peer, message);
                else if (message.t === 'refresh') {
                    const fresh = (0, voice_ticket_1.verifyVoiceTicket)(message.ticket, options.secret, now());
                    if (fresh && fresh.id === peer.id && !!fresh.control === peer.control) {
                        peer.friends = new Set(fresh.friends || []);
                        peer.blocked = new Set(fresh.blocked || []);
                        peer.chat = !!fresh.chat;
                        peer.ticketExp = fresh.exp;
                    }
                }
                else if (message.t === 'party') {
                    if (overLimit(peer))
                        ws.close(exports.CLOSE_ABUSE);
                    else
                        onParty(peer, message);
                }
                else if (message.t === 'react' && !peer.control) {
                    if (overLimit(peer))
                        ws.close(exports.CLOSE_ABUSE);
                    else
                        onReact(peer, message);
                }
                return;
            }
            if (message.t !== 'hello')
                return;
            const ticket = (0, voice_ticket_1.verifyVoiceTicket)(message.ticket, options.secret, now());
            if (!ticket) {
                ws.close(exports.CLOSE_BAD_TICKET);
                return;
            }
            peer = register(ws, ticket);
            if (peer)
                clearTimeout(hello);
        });
    }
    const heartbeat = setInterval(() => {
        for (const peer of [...peers.values(), ...controls.values()]) {
            if (!peer.alive) {
                peer.ws.terminate();
                continue;
            }
            peer.alive = false;
            peer.ws.ping();
        }
    }, HEARTBEAT_MS);
    heartbeat.unref();
    const matchmaker = setInterval(tick, TICK_MS);
    matchmaker.unref();
    server.on('close', () => { clearInterval(heartbeat); clearInterval(matchmaker); });
    return {
        server,
        listen: (port, host = '127.0.0.1') => new Promise(done => server.listen(port, host, () => done(server.address().port))),
        close: () => new Promise(done => { for (const peer of [...peers.values(), ...controls.values()])
            peer.ws.terminate(); sockets.close(); server.close(() => done()); }),
        peers: () => peers.size,
        tick
    };
}
