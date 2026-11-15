"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Updates = void 0;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const verify_1 = require("../../../packages/manifests/src/verify");
const contracts_1 = require("../../../packages/shared/src/contracts");
const io_1 = require("./io");
class Updates {
    root;
    api;
    key;
    channel;
    progress;
    token;
    onUnauthorizedChannel;
    generation = 0;
    pending = null;
    stagedDir = null;
    lastStatus = { available: false, channel: 'stable', version: '0.4.0', downloaded: false, message: 'Klient EXER jest aktualny.' };
    constructor(root, api, key, channel = () => 'stable', progress, token = async () => '', onUnauthorizedChannel) {
        this.root = root;
        this.api = api;
        this.key = key;
        this.channel = channel;
        this.progress = progress;
        this.token = token;
        this.onUnauthorizedChannel = onUnauthorizedChannel;
    }
    reset() { this.generation++; this.pending = null; this.stagedDir = null; }
    status() { return { ...this.lastStatus, channel: this.channel() }; }
    async active() {
        try {
            const raw = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(this.root(), 'active-release.json'), 'utf8'));
            return (0, verify_1.verifyManifest)(raw, await this.key());
        }
        catch (e) {
            if (e.code === 'ENOENT')
                return null;
            throw e;
        }
    }
    async check() {
        const generation = this.generation;
        const ch = this.channel();
        if (!this.api()) {
            this.lastStatus = { available: false, channel: ch, version: '0.4.0', downloaded: false, message: `Kanał aktualizacji EXER (${ch.toUpperCase()}) jest aktualny (0.4.0).` };
            return this.lastStatus;
        }
        try {
            const query = ch === 'dev' ? '?channel=dev' : (ch === 'beta' ? '?channel=beta' : '');
            const endpoint = this.api().replace(/\/$/, '') + '/v1/releases/latest' + query;
            const headers = {};
            if (ch === 'dev')
                headers['Authorization'] = 'Bearer ' + await this.token();
            const raw = await (0, io_1.getJSON)(endpoint, { headers });
            if (generation !== this.generation)
                throw Error('Zmieniono kanał aktualizacji.');
            const candidate = (0, verify_1.verifyManifest)(raw, await this.key());
            if (candidate.channel !== ch)
                throw Error('Niezgodny kanał podpisanego manifestu.');
            // the launcher's own EXER Core is newer than this signed release: nothing to install
            if ((0, contracts_1.olderBuild)(candidate.clientBuild, contracts_1.BUILD)) {
                this.pending = null;
                this.lastStatus = { available: false, channel: ch, version: contracts_1.BUILD, downloaded: false, message: 'Masz aktualne podpisane wydanie.' };
                return this.lastStatus;
            }
            const active = await this.active();
            const isChannelSwitch = Boolean(active && active.channel !== candidate.channel);
            if (!isChannelSwitch && candidate.sequence <= (active?.sequence || 0)) {
                this.lastStatus = { available: false, channel: ch, version: active?.clientBuild || '0.4.0', downloaded: false, message: 'Masz aktualne podpisane wydanie.' };
                return this.lastStatus;
            }
            if (this.pending?.payload !== raw.payload)
                this.stagedDir = null;
            this.pending = raw;
            this.lastStatus = { available: true, channel: ch, version: candidate.clientBuild, downloaded: Boolean(this.stagedDir), message: 'Dostępny EXER build ' + candidate.clientBuild };
            return this.lastStatus;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'Nie udało się sprawdzić aktualizacji.';
            if (ch === 'dev' && /403|401|Brak uprawnień/.test(msg)) {
                this.reset();
                this.onUnauthorizedChannel?.('stable');
                this.lastStatus = { available: false, channel: 'stable', version: '0.4.0', downloaded: false, message: 'Brak uprawnień do kanału DEV. Przywrócono kanał Stable.', error: msg };
                return this.lastStatus;
            }
            this.lastStatus = { available: false, channel: ch, version: '0.4.0', downloaded: false, message: msg, error: msg };
            throw e;
        }
    }
    async downloadInBackground(signal) {
        if (!this.pending)
            await this.check();
        if (!this.pending)
            return this.lastStatus;
        const active = await this.active();
        const minSeq = (active && active.channel === this.channel()) ? active.sequence : 0;
        const manifest = (0, verify_1.verifyManifest)(this.pending, await this.key(), minSeq);
        if (manifest.channel !== this.channel())
            throw Error('Niezgodny kanał aktualizacji.');
        const root = this.root();
        const stage = 'updates/bg-' + manifest.channel + '-' + manifest.sequence;
        await promises_1.default.mkdir(node_path_1.default.join(root, stage), { recursive: true });
        let index = 0;
        const ch = this.channel();
        const headers = {};
        if (ch === 'dev')
            headers['Authorization'] = 'Bearer ' + await this.token();
        for (const file of manifest.files) {
            signal?.throwIfAborted();
            index++;
            const target = (0, io_1.safePath)(root, stage + '/' + file.path);
            if (await (0, io_1.validFile)(target, file.sha256, 'sha256', file.size))
                continue;
            if (ch === 'dev' && new URL(file.url).origin !== new URL(this.api()).origin)
                throw Error('Prywatny plik wymaga adresu EXER API.');
            await (0, io_1.download)(file.url, target, {
                hash: file.sha256,
                algorithm: 'sha256',
                size: file.size,
                signal,
                headers,
                progress: (done, total) => this.progress?.({ phase: `Trwa pobieranie aktualizacji ${manifest.clientBuild} (${index}/${manifest.files.length})…`, done, total, busy: true })
            });
        }
        this.stagedDir = stage;
        this.lastStatus = { ...this.lastStatus, available: true, downloaded: true, message: `Pobrano i zweryfikowano EXER ${manifest.clientBuild}. Gotowy do instalacji.` };
        return this.lastStatus;
    }
    /** The signed jar is delivered to mods/exer-client.jar, but the installer moves it into the hidden .exer-core folder
     * on the next launch (ensureHiddenExerCoreJar). Either place counts as "installed". */
    async installedFile(file, root = this.root()) {
        if (await (0, io_1.validFile)((0, io_1.safePath)(root, file.path), file.sha256, 'sha256', file.size))
            return true;
        if (file.path === 'mods/exer-client.jar')
            return (0, io_1.validFile)(node_path_1.default.join(root, '.exer-core', 'exer-client.jar'), file.sha256, 'sha256', file.size);
        return false;
    }
    async verifyActive() {
        const manifest = await this.active();
        if (!manifest)
            return;
        for (const file of manifest.files) {
            if (!await this.installedFile(file)) {
                throw Error('Uszkodzony plik podpisanego wydania: ' + file.path + '. Zastosuj ponownie podpisaną aktualizację.');
            }
        }
    }
    async repair(signal) {
        if (!await this.active())
            return;
        this.pending = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(this.root(), 'active-release.json'), 'utf8'));
        await this.apply(signal, true);
    }
    async recover(root = this.root()) {
        const journal = node_path_1.default.join(root, 'update-journal.json');
        let data;
        try {
            data = JSON.parse(await promises_1.default.readFile(journal, 'utf8'));
        }
        catch (e) {
            if (e.code === 'ENOENT')
                return;
            // A journal cut off by a crash or a power loss cannot be replayed. Keep it for inspection and let the launcher
            // start: throwing here would stop the launcher from ever opening again.
            await promises_1.default.rename(journal, journal + '.corrupt').catch(() => promises_1.default.rm(journal, { force: true }).catch(() => { }));
            return;
        }
        const allowed = /^(mods\/exer-client\.jar|config\/exer-defaults\/[a-zA-Z0-9_-]+\.json|active-release\.json)$/;
        const entries = Array.isArray(data?.entries) ? data.entries : [];
        // validate everything first so a bad entry cannot leave a half-restored folder
        for (const entry of entries) {
            if (typeof entry?.path !== 'string' || !allowed.test(entry.path) || (entry.hadFile && typeof entry.backup !== 'string'))
                throw Error('Nieprawidłowy dziennik przywracania.');
        }
        for (const entry of [...entries].reverse()) {
            const dest = (0, io_1.safePath)(root, entry.path);
            if (entry.hadFile) {
                const backup = (0, io_1.safePath)(root, entry.backup);
                await promises_1.default.mkdir(node_path_1.default.dirname(dest), { recursive: true });
                await promises_1.default.copyFile(backup, dest);
            }
            else {
                await promises_1.default.rm(dest, { force: true });
            }
        }
        await promises_1.default.rm(journal, { force: true });
    }
    async apply(signal, repair = false) {
        const generation = this.generation;
        if (!this.pending)
            await this.check();
        if (!this.pending)
            throw Error('Brak dostępnej aktualizacji.');
        const envelope = this.pending;
        const active = await this.active();
        const minSeq = (active && active.channel === this.channel()) ? (active.sequence - (repair ? 1 : 0)) : -1;
        const manifest = (0, verify_1.verifyManifest)(envelope, await this.key(), minSeq);
        if (manifest.channel !== this.channel())
            throw Error('Niezgodny kanał aktualizacji.');
        const root = this.root();
        const stage = this.stagedDir || ('updates/' + node_crypto_1.default.randomUUID());
        const entries = [];
        await promises_1.default.mkdir(node_path_1.default.join(root, stage), { recursive: true });
        let idx = 0;
        const ch = this.channel();
        const headers = {};
        if (ch === 'dev')
            headers['Authorization'] = 'Bearer ' + await this.token();
        for (const file of manifest.files) {
            signal?.throwIfAborted();
            idx++;
            if (await this.installedFile(file, root))
                continue;
            const stagedFile = (0, io_1.safePath)(root, stage + '/' + file.path);
            if (!await (0, io_1.validFile)(stagedFile, file.sha256, 'sha256', file.size)) {
                if (ch === 'dev' && new URL(file.url).origin !== new URL(this.api()).origin)
                    throw Error('Prywatny plik wymaga adresu EXER API.');
                await (0, io_1.download)(file.url, stagedFile, {
                    hash: file.sha256,
                    algorithm: 'sha256',
                    size: file.size,
                    signal,
                    headers,
                    progress: (done, total) => this.progress?.({ phase: `Trwa pobieranie aktualizacji (${idx}/${manifest.files.length})…`, done, total, busy: true })
                });
            }
        }
        if (generation !== this.generation)
            throw Error('Zmieniono kanał aktualizacji.');
        try {
            for (const file of [...manifest.files, { path: 'active-release.json', sha256: '', size: 0 }]) {
                signal?.throwIfAborted();
                const destination = (0, io_1.safePath)(root, file.path);
                if (file.path !== 'active-release.json' && await this.installedFile(file, root))
                    continue;
                let parent = node_path_1.default.dirname(destination);
                while (parent !== node_path_1.default.resolve(root)) {
                    try {
                        if ((await promises_1.default.lstat(parent)).isSymbolicLink())
                            throw Error('Aktualizacja nie może podążać za linkiem symbolicznym.');
                    }
                    catch (e) {
                        if (e.code !== 'ENOENT')
                            throw e;
                    }
                    parent = node_path_1.default.dirname(parent);
                }
                const backup = stage + '/backup/' + file.path;
                const hadFile = await (0, io_1.validFile)(destination);
                if (hadFile) {
                    await promises_1.default.mkdir(node_path_1.default.dirname((0, io_1.safePath)(root, backup)), { recursive: true });
                    await promises_1.default.copyFile(destination, (0, io_1.safePath)(root, backup));
                }
                entries.push({ path: file.path, backup, hadFile });
                // atomic write: a crash in the middle must never leave a journal that cannot be read back
                const journalFile = node_path_1.default.join(root, 'update-journal.json');
                await promises_1.default.writeFile(journalFile + '.tmp', JSON.stringify({ entries }));
                await promises_1.default.rename(journalFile + '.tmp', journalFile);
                await promises_1.default.mkdir(node_path_1.default.dirname(destination), { recursive: true });
                if (file.path === 'active-release.json')
                    await promises_1.default.writeFile(destination, JSON.stringify(envelope));
                else
                    await promises_1.default.rename((0, io_1.safePath)(root, stage + '/' + file.path), destination);
            }
            await promises_1.default.rm(node_path_1.default.join(root, 'update-journal.json'), { force: true });
            this.pending = null;
            this.stagedDir = null;
            this.lastStatus = { available: false, channel: this.channel(), version: manifest.clientBuild, downloaded: false, message: `Zainstalowano aktualizację EXER ${manifest.clientBuild}.` };
            return this.lastStatus;
        }
        catch (e) {
            await this.recover(root);
            throw e;
        }
    }
}
exports.Updates = Updates;
