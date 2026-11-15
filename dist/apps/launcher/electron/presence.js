"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Presence = void 0;
const discord_rpc_1 = __importDefault(require("discord-rpc"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
// Discord Rich Presence. The Discord application id comes from the player's settings or, by default,
// from distribution.json (discordClientId). The game mod writes config/exer/presence.json every few
// seconds: menu / singleplayer / multiplayer, the server address and when the game started.
const TEXT = {
    pl: { launcher: 'W launcherze', starting: 'Uruchamia Minecrafta', menu: 'W menu głównym', single: 'Gra jednoosobowa', multi: 'Gra na serwerze', server: (s) => 'Gra na ' + s, download: 'Pobierz EXER Client' },
    en: { launcher: 'In the launcher', starting: 'Starting Minecraft', menu: 'In the main menu', single: 'Playing singleplayer', multi: 'Playing multiplayer', server: (s) => 'Playing on ' + s, download: 'Get EXER Client' }
};
/** discord-rpc's destroy() writes to the IPC socket; when Discord is not running the socket was never
 * opened and the returned promise rejects (or it throws at once). Either way there is nothing to close. */
function safeDestroy(client) { try {
    Promise.resolve(client.destroy()).catch(() => { });
}
catch { } }
class Presence {
    settings;
    instance;
    running;
    lang;
    defaultClientId;
    client = null;
    connecting = false;
    identity = '';
    timer;
    launcherSince = new Date();
    lastActivity = '';
    constructor(settings, instance, running, lang = () => 'pl', defaultClientId = () => '') {
        this.settings = settings;
        this.instance = instance;
        this.running = running;
        this.lang = lang;
        this.defaultClientId = defaultClientId;
        this.timer = setInterval(() => void this.update().catch(() => { }), 12000);
    }
    clientId() { const own = this.settings().discordClientId; return own || this.defaultClientId(); }
    status() { return { enabled: this.settings().discord, hasClientId: Boolean(this.clientId()), connected: Boolean(this.client), activity: this.lastActivity }; }
    async update() {
        const settings = this.settings();
        const clientId = this.clientId();
        if (!settings.discord || !clientId) {
            this.destroyClient();
            return;
        }
        if (this.client && this.identity !== clientId)
            this.destroyClient();
        if (!this.client) {
            if (this.connecting)
                return;
            this.connecting = true;
            const client = new discord_rpc_1.default.Client({ transport: 'ipc' });
            try {
                await client.login({ clientId });
                this.client = client;
                this.identity = clientId;
            }
            catch {
                safeDestroy(client);
                return;
            }
            finally {
                this.connecting = false;
            }
        }
        const t = TEXT[this.lang()];
        const activity = { details: 'Minecraft ' + settings.version + ' · EXER Client', state: t.launcher, startTimestamp: this.launcherSince, largeImageKey: 'exer', largeImageText: 'EXER Client', buttons: [{ label: t.download, url: 'https://exerclient.com' }] };
        if (this.running()) {
            try {
                const data = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(this.instance(), 'config/exer/presence.json'), 'utf8'));
                if (Date.now() - data.updated < 15000) {
                    const server = typeof data.server === 'string' ? data.server.replace(/[^\w.:-]/g, '').slice(0, 60) : '';
                    activity.state = data.state === 'menu' ? t.menu : data.state === 'singleplayer' ? t.single : server && !settings.hideServer ? t.server(server) : t.multi;
                    if (Number.isFinite(data.since))
                        activity.startTimestamp = new Date(data.since);
                }
                else
                    activity.state = t.starting;
            }
            catch {
                activity.state = t.starting;
            }
        }
        this.lastActivity = `${activity.details} — ${activity.state}`;
        try {
            await this.client?.setActivity(activity);
        }
        catch {
            this.destroyClient();
        }
    }
    destroyClient() { if (this.client)
        safeDestroy(this.client); this.client = null; }
    close() { clearInterval(this.timer); this.destroyClient(); }
}
exports.Presence = Presence;
