"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Accounts = void 0;
exports.pkce = pkce;
exports.sessionFromMinecraft = sessionFromMinecraft;
const electron_1 = require("electron");
const node_http_1 = __importDefault(require("node:http"));
const msmc_1 = require("msmc");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const contracts_1 = require("../../../packages/shared/src/contracts");
const offline_account_1 = require("./offline-account");
// MSMC rejects with a code; the ones a player can fix get a sentence that says how.
const MICROSOFT_ERRORS = {
    'error.auth.xsts.userNotFound': 'To konto Microsoft nie ma jeszcze profilu Xbox. Zaloguj się nim raz na xbox.com (profil utworzy się sam) i spróbuj ponownie.',
    'error.auth.xsts.child': 'To konto dziecka: dorosły musi dodać je do rodziny Microsoft na account.microsoft.com/family, potem spróbuj ponownie.',
    'error.auth.xsts.child.SK': 'To konto dziecka: dorosły musi dodać je do rodziny Microsoft na account.microsoft.com/family, potem spróbuj ponownie.',
    'error.auth.xsts.bannedCountry': 'Xbox Live nie działa w kraju ustawionym na tym koncie Microsoft.',
    'error.auth.minecraft.entitlements': 'Na tym koncie Microsoft nie ma kupionego Minecraft Java Edition.',
    'error.auth.minecraft.profile': 'To konto nie ma jeszcze profilu Minecraft: ustaw nick na minecraft.net i spróbuj ponownie.',
    'error.gui.closed': 'Okno logowania zostało zamknięte.',
};
function pkce() { const verifier = node_crypto_1.default.randomBytes(48).toString('base64url'); return { verifier, challenge: node_crypto_1.default.createHash('sha256').update(verifier).digest('base64url'), state: node_crypto_1.default.randomBytes(32).toString('base64url') }; }
async function json(url, body, headers = {}) { const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) }); if (!response.ok)
    throw Error(`Usługa ${new URL(url).hostname}: HTTP ${response.status}. Sprawdź konto i uprawnienia aplikacji.`); return response.json(); }
async function microsoft(params) { const response = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(30000) }); if (!response.ok)
    throw Error('Microsoft odrzucił sesję. Sprawdź Client ID i redirect URI, a następnie zaloguj ponownie.'); return response.json(); }
async function minecraft(msToken) {
    const xbox = await json('https://user.auth.xboxlive.com/user/authenticate', { Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msToken }, RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' });
    const xsts = await json('https://xsts.auth.xboxlive.com/xsts/authorize', { Properties: { SandboxId: 'RETAIL', UserTokens: [xbox.Token] }, RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT' });
    const uhs = xsts.DisplayClaims?.xui?.[0]?.uhs;
    if (typeof uhs !== 'string')
        throw Error('Brak profilu Xbox Live.');
    const token = await json('https://api.minecraftservices.com/authentication/login_with_xbox', { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` });
    const headers = { Authorization: 'Bearer ' + token.access_token };
    const entitlements = await json('https://api.minecraftservices.com/entitlements/mcstore', undefined, headers);
    if (!entitlements.items?.some((x) => ['game_minecraft', 'product_minecraft'].includes(x.name)))
        throw Error('To konto nie posiada uprawnień do Minecraft Java Edition.');
    const profile = await json('https://api.minecraftservices.com/minecraft/profile', undefined, headers);
    const skin = profile.skins?.find((s) => s.state === 'ACTIVE')?.url;
    const safeSkin = skin && new URL(skin).hostname === 'textures.minecraft.net' ? skin.replace(/^http:/, 'https:') : undefined;
    return { account: contracts_1.AccountSchema.parse({ id: profile.id, name: profile.name, skin: safeSkin }), access: token.access_token, expires: Date.now() + Number(token.expires_in) * 1000 };
}
class Accounts {
    root;
    encryption;
    refreshXbox;
    vault = { active: null, sessions: [] };
    loginBusy = false;
    constructor(root, encryption = electron_1.safeStorage, refreshXbox = (refresh) => new msmc_1.Auth('select_account').refresh(refresh)) {
        this.root = root;
        this.encryption = encryption;
        this.refreshXbox = refreshXbox;
    }
    async load() { try {
        const file = node_path_1.default.join(this.root, 'accounts.dpapi');
        const encrypted = await promises_1.default.readFile(file).catch(async (e) => { if (e.code !== 'ENOENT')
            throw e; return promises_1.default.readFile(file + '.bak'); });
        if (!this.encryption.isEncryptionAvailable())
            throw Error('Windows DPAPI niedostępne.');
        this.vault = JSON.parse(this.encryption.decryptString(encrypted));
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw Error('Nie można odczytać chronionych kont EXER. Uruchom aplikację na tym samym koncie Windows.');
    } }
    async save() { if (!this.encryption.isEncryptionAvailable())
        throw Error('Systemowy mechanizm szyfrowania nie jest dostępny. Tokeny nie zostaną zapisane.'); await promises_1.default.mkdir(this.root, { recursive: true }); const file = node_path_1.default.join(this.root, 'accounts.dpapi'); await promises_1.default.writeFile(file + '.tmp', this.encryption.encryptString(JSON.stringify(this.vault))); try {
        await promises_1.default.rename(file + '.tmp', file);
    }
    catch (e) {
        if (!['EPERM', 'EEXIST'].includes(e.code))
            throw e;
        await promises_1.default.rm(file + '.bak', { force: true });
        await promises_1.default.rename(file, file + '.bak');
        try {
            await promises_1.default.rename(file + '.tmp', file);
        }
        catch (error) {
            await promises_1.default.rename(file + '.bak', file);
            throw error;
        }
    } await promises_1.default.rm(file + '.bak', { force: true }); }
    list() { return { accounts: this.vault.sessions.map(s => s.account), activeAccount: this.vault.active }; }
    async addOffline(name) {
        const account = (0, offline_account_1.offlineAccount)(name);
        const existing = this.vault.sessions.find(s => s.account.id === account.id);
        if (existing && existing.account.kind !== 'offline')
            throw Error('Konflikt identyfikatora konta.');
        this.vault.sessions = this.vault.sessions.filter(s => s.account.id !== account.id);
        this.vault.sessions.push({ account, refresh: '', access: '0', expires: 0, clientId: '' });
        this.vault.active = account.id;
        await this.save();
        return account;
    }
    // After a skin change in the launcher, so the 3D preview shows it without signing in again.
    async setActiveSkin(url) { const session = this.vault.sessions.find(x => x.account.id === this.vault.active); if (!session)
        throw Error('Zaloguj się kontem Microsoft z Minecraft Java.'); if (new URL(url).hostname !== 'textures.minecraft.net')
        throw Error('Nieprawidłowe źródło skina.'); session.account = { ...session.account, skin: url }; await this.save(); }
    async select(id) { if (!this.vault.sessions.some(s => s.account.id === id))
        throw Error('Nieznane konto.'); this.vault.active = id; await this.save(); }
    async logout(id) { this.vault.sessions = this.vault.sessions.filter(s => s.account.id !== id); if (this.vault.active === id)
        this.vault.active = this.vault.sessions[0]?.account.id || null; await this.save(); }
    async login(parent, clientId = '') {
        if (this.loginBusy)
            throw Error('Logowanie już trwa.');
        this.loginBusy = true;
        try {
            // With EXER's own Azure app (approved for the Minecraft API) the sign-in runs in the player's own browser.
            if (/^[0-9a-f-]{36}$/i.test(clientId)) {
                const result = await browserLogin(clientId);
                this.vault.sessions = this.vault.sessions.filter(s => s.account.id !== result.account.id);
                this.vault.sessions.push(result);
                this.vault.active = result.account.id;
                await this.save();
                return result.account;
            }
            const manager = new msmc_1.Auth('select_account');
            const code = await loginWindow(manager, parent);
            const xbox = await manager.login(code);
            const token = await xbox.getMinecraft();
            const result = await sessionFromMinecraft(token, xbox.save());
            this.vault.sessions = this.vault.sessions.filter(s => s.account.id !== result.account.id);
            this.vault.sessions.push(result);
            this.vault.active = result.account.id;
            await this.save();
            return result.account;
        }
        catch (e) {
            if (e instanceof Error)
                throw e;
            throw Error(MICROSOFT_ERRORS[String(e)] || 'Microsoft: ' + String(e));
        }
        finally {
            this.loginBusy = false;
        }
    }
    async authorization(forceRefresh = false) {
        const session = this.vault.sessions.find(s => s.account.id === this.vault.active);
        if (!session)
            throw Error('Zaloguj się kontem Microsoft z Minecraft Java.');
        if (session.account.kind === 'offline')
            return { access: '0', account: session.account, xuid: '0' };
        if (forceRefresh || session.expires < Date.now() + 300000) {
            try {
                if (session.provider === 'msmc') {
                    const xbox = await this.refreshXbox(session.refresh);
                    session.refresh = xbox.save();
                    await this.save();
                    const updated = await sessionFromMinecraft(await xbox.getMinecraft(), session.refresh);
                    if (updated.account.id !== session.account.id)
                        throw Error('Odnowiona sesja wskazuje inne konto.');
                    Object.assign(session, updated);
                }
                else {
                    const ms = await microsoft({ client_id: session.clientId, grant_type: 'refresh_token', refresh_token: session.refresh, scope: 'XboxLive.signin offline_access' });
                    if (ms.refresh_token) {
                        session.refresh = ms.refresh_token;
                        await this.save();
                    }
                    Object.assign(session, await minecraft(ms.access_token));
                }
                await this.save();
            }
            catch {
                throw Error('Nie udało się odnowić sesji Microsoft. Sprawdź internet i spróbuj ponownie. Jeśli Microsoft cofnął sesję, użyj „Dodaj konto Microsoft”. Zapisane konto nie zostało usunięte.');
            }
        }
        return { access: session.access, account: session.account, xuid: session.xuid || '0' };
    }
}
exports.Accounts = Accounts;
async function sessionFromMinecraft(token, refresh) {
    if (!token.profile?.id || token.isDemo())
        throw Error('To konto nie posiada Minecraft Java Edition.');
    const entitlements = await token.entitlements();
    if (!entitlements.some(x => ['game_minecraft', 'product_minecraft'].includes(x)))
        throw Error('Brak uprawnień do Minecraft Java Edition.');
    const skin = token.profile.skins?.find(s => s.state === 'ACTIVE')?.url;
    const safeSkin = skin && new URL(skin).hostname === 'textures.minecraft.net' ? skin.replace(/^http:/, 'https:') : undefined;
    const jwt = JSON.parse(Buffer.from(token.mcToken.split('.')[1], 'base64url').toString());
    if (!Number.isFinite(jwt.exp) || jwt.exp * 1000 <= Date.now() || !refresh)
        throw Error('Microsoft zwrócił nieprawidłową sesję.');
    return { account: contracts_1.AccountSchema.parse({ id: token.profile.id, name: token.profile.name, skin: safeSkin }), access: token.mcToken, expires: jwt.exp * 1000, refresh, clientId: '', provider: 'msmc', xuid: token.xuid };
}
/** Sign-in in the default browser: Microsoft's page with its own address bar, the code comes back to a one-time
 * http://localhost:<port> listener (OAuth 2.0 for desktop apps: PKCE + state), then Xbox Live and Minecraft as usual. */
async function browserLogin(clientId) {
    const { verifier, challenge } = pkce();
    const state = node_crypto_1.default.randomBytes(32).toString('base64url');
    const server = node_http_1.default.createServer();
    await new Promise((ok, no) => { server.once('error', no); server.listen(0, '127.0.0.1', () => ok()); });
    const redirect = 'http://localhost:' + server.address().port;
    const page = (title, text, ok) => '<!doctype html><meta charset="utf-8"><title>EXER Client</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0c0c0f;color:#f4f4f6;font:16px Segoe UI,system-ui,sans-serif">'
        + '<div style="text-align:center;max-width:460px;padding:40px;border:1px solid #2a2a31;border-radius:20px;background:#141418"><div style="width:64px;height:64px;margin:0 auto 18px;border-radius:50%;display:grid;place-items:center;font-size:34px;background:' + (ok ? '#22c55e' : '#e03131') + '">' + (ok ? '✓' : '!') + '</div>'
        + '<h1 style="margin:0 0 10px;font-size:26px">' + title + '</h1><p style="margin:0;color:#a2a2ac">' + text + '</p></div></body>';
    try {
        const code = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(Error('Upłynął czas logowania. Spróbuj ponownie.')), 300000);
            server.on('request', (req, res) => {
                const url = new URL(req.url || '/', redirect);
                if (url.pathname !== '/') {
                    res.writeHead(404).end();
                    return;
                }
                const done = (error, value) => {
                    clearTimeout(timer);
                    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                    res.end(error ? page('Logowanie przerwane', 'Wróć do EXER Client i spróbuj ponownie.', false) : page('Zalogowano!', 'Możesz zamknąć tę kartę i wrócić do EXER Client.', true));
                    if (error)
                        reject(error);
                    else
                        resolve(value);
                };
                if (url.searchParams.get('state') !== state)
                    return done(Error('Nieprawidłowa odpowiedź logowania Microsoft.'));
                const value = url.searchParams.get('code');
                done(value ? null : Error('Logowanie Microsoft anulowane.'), value || undefined);
            });
            const auth = new URL('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
            for (const [k, v] of Object.entries({ client_id: clientId, response_type: 'code', redirect_uri: redirect, response_mode: 'query', scope: 'XboxLive.signin offline_access', state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' }))
                auth.searchParams.set(k, v);
            void electron_1.shell.openExternal(auth.href).catch(() => reject(Error('Nie udało się otworzyć przeglądarki.')));
        });
        const ms = await microsoft({ client_id: clientId, grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier, scope: 'XboxLive.signin offline_access' });
        return { ...await minecraft(ms.access_token), refresh: ms.refresh_token, clientId };
    }
    finally {
        server.close();
    }
}
function loginWindow(auth, parent) {
    return new Promise((resolve, reject) => {
        const state = node_crypto_1.default.randomBytes(32).toString('base64url');
        const win = new electron_1.BrowserWindow({ width: 540, height: 720, title: 'Zaloguj się przez Microsoft — EXER', parent, autoHideMenuBar: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'exer-auth-' + node_crypto_1.default.randomUUID() } });
        let settled = false;
        const finish = (error, code) => { if (settled)
            return; settled = true; clearTimeout(timer); if (!win.isDestroyed())
            win.destroy(); if (error)
            reject(error);
        else
            resolve(code); };
        const timer = setTimeout(() => finish(Error('Upłynął czas logowania. Spróbuj ponownie.')), 300000);
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        win.webContents.session.setPermissionRequestHandler((_web, _permission, callback) => callback(false));
        const navigate = (event, address) => {
            const url = new URL(address), redirect = new URL(auth.token.redirect);
            if (url.origin === redirect.origin && url.pathname === redirect.pathname) {
                event.preventDefault();
                if (url.searchParams.get('state') !== state) {
                    finish(Error('Nieprawidłowa odpowiedź logowania Microsoft.'));
                    return;
                }
                const code = url.searchParams.get('code');
                finish(code ? null : Error('Logowanie Microsoft anulowane.'), code || undefined);
            }
            else if (url.protocol !== 'https:') {
                event.preventDefault();
            }
        };
        win.webContents.on('will-redirect', navigate);
        win.webContents.on('will-navigate', navigate);
        // no address bar in this window: its title shows the real address of the page, so players see it is Microsoft's own site
        const showAddress = () => { try {
            const u = new URL(win.webContents.getURL());
            win.setTitle((u.protocol === 'https:' ? '🔒 ' : '') + u.host + ' — logowanie Microsoft · EXER nie widzi hasła');
        }
        catch { } };
        win.on('page-title-updated', e => e.preventDefault());
        win.webContents.on('did-navigate', showAddress);
        win.webContents.on('did-navigate-in-page', showAddress);
        win.on('closed', () => finish(Error('Logowanie anulowane.')));
        const url = new URL(auth.createLink());
        url.searchParams.set('state', state);
        void win.loadURL(url.href).catch(() => finish(Error('Nie udało się otworzyć strony Microsoft. Sprawdź połączenie.')));
    });
}
