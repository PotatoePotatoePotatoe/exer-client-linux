"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoicePartyClient = void 0;
const ws_1 = __importDefault(require("ws"));
const RETRY_MS = 5000;
/** The launcher's control connection: manages the voice party while the audio stays with the game. */
class VoicePartyClient {
    url;
    ticket;
    ws = null;
    retry = null;
    state = { connected: false, party: null, invites: [], error: '', self: '' };
    constructor(url, ticket) {
        this.url = url;
        this.ticket = ticket;
    }
    connect() {
        if (this.ws || this.retry)
            return;
        void this.open().catch(() => this.scheduleRetry());
    }
    scheduleRetry() {
        this.ws = null;
        this.state = { ...this.state, connected: false };
        if (!this.retry)
            this.retry = setTimeout(() => { this.retry = null; this.connect(); }, RETRY_MS);
    }
    async open() {
        const { ticket } = await this.ticket();
        const ws = new ws_1.default(this.url().replace(/^http/, 'ws').replace(/\/+$/, '') + '/voice');
        this.ws = ws;
        ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', ticket })));
        ws.on('message', (data, binary) => { if (!binary)
            this.onMessage(JSON.parse(data.toString())); });
        ws.on('close', () => this.scheduleRetry());
        ws.on('error', () => { });
    }
    onMessage(message) {
        if (message.t === 'ready')
            this.state = { ...this.state, connected: true, self: message.id, error: '' };
        else if (message.t === 'party')
            this.state = { ...this.state, party: message.party, error: '' };
        else if (message.t === 'invites')
            this.state = { ...this.state, invites: message.list };
        else if (message.t === 'partyError')
            this.state = { ...this.state, error: message.code };
    }
    command(request) {
        this.connect();
        if (request.action !== 'state' && this.ws?.readyState === ws_1.default.OPEN) {
            const { action, ...rest } = request;
            this.ws.send(JSON.stringify({ t: 'party', a: action, ...rest }));
        }
        return this.state;
    }
}
exports.VoicePartyClient = VoicePartyClient;
