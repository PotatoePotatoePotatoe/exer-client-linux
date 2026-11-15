"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerUpdates = registerUpdates;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const verify_1 = require("../../../packages/manifests/src/verify");
async function registerUpdates(app, root, key, access, trustedOrigin = process.env.EXER_UPDATE_ORIGIN || 'https://api.exerclient.com') {
    const origin = new URL(trustedOrigin);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
        throw Error('EXER_UPDATE_ORIGIN must be an HTTPS origin.');
    const authorize = (req, reply) => {
        reply.header('Cache-Control', 'private, no-store').header('Vary', 'Authorization');
        try {
            access.user(req, 'updates.manage');
            return true;
        }
        catch (e) {
            reply.code(e.statusCode || 403).send({ error: e.message });
            return false;
        }
    };
    app.get('/v1/updates/channels', async (req, reply) => {
        reply.header('Cache-Control', 'private, no-store').header('Vary', 'Authorization');
        let admin = false;
        if (req.headers.authorization) {
            try {
                admin = access.isAdmin(access.user(req).id);
            }
            catch (e) {
                return reply.code(e.statusCode || 401).send({ error: e.message });
            }
        }
        return { channels: admin ? ['stable', 'dev'] : ['stable'], admin };
    });
    const manifest = (prefix, verify) => async (req, reply) => {
        const requested = req.query?.channel || 'stable';
        if (!['stable', 'dev', 'beta'].includes(requested))
            return reply.code(400).send({ error: 'Unknown update channel.' });
        // Old beta installations migrate to the public stable channel.
        const channel = requested === 'dev' ? 'dev' : 'stable';
        if (channel === 'dev' && !authorize(req, reply))
            return;
        const candidates = prefix === 'launcher-latest' && channel === 'stable'
            ? [node_path_1.default.join(root, `${prefix}.json`), node_path_1.default.join(root, 'updates', channel, `${prefix}.json`)]
            : [node_path_1.default.join(root, 'updates', channel, `${prefix}.json`), ...(channel === 'stable' ? [node_path_1.default.join(root, `${prefix}.json`)] : [])];
        let fallbackEnvelope = null;
        for (const candidate of candidates) {
            try {
                const envelope = JSON.parse(await promises_1.default.readFile(candidate, 'utf8'));
                verify(envelope, key);
                const signed = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'));
                if ((signed.channel || 'stable') !== channel)
                    throw Error('Release channel mismatch');
                const urls = prefix === 'latest' ? signed.files.map((f) => f.url) : [signed.url];
                for (const value of urls) {
                    const url = new URL(value);
                    if (channel === 'dev' && (url.origin !== origin.origin || !/^\/v1\/artifacts\/dev\/[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(url.pathname) || url.search || url.hash || url.username || url.password))
                        throw Error('Private artifact must use authenticated download');
                    if (channel === 'stable' && /\/(?:artifacts|updates)\/dev(?:\/|$)/i.test(decodeURIComponent(url.pathname)))
                        throw Error('Stable release references DEV');
                }
                if (prefix === 'launcher-latest' && channel === 'stable' && !envelope.installerSignature) {
                    if (!fallbackEnvelope)
                        fallbackEnvelope = envelope;
                    continue;
                }
                reply.header('Cache-Control', channel === 'dev' ? 'private, no-store' : 'no-cache').header('Vary', 'Authorization');
                return envelope;
            }
            catch (e) {
                if (e.code === 'ENOENT')
                    continue;
                break;
            }
        }
        if (fallbackEnvelope) {
            reply.header('Cache-Control', 'no-cache').header('Vary', 'Authorization');
            return fallbackEnvelope;
        }
        return reply.code(503).send({ error: `No verified ${channel.toUpperCase()} release is published.` });
    };
    app.get('/v1/releases/latest', manifest('latest', verify_1.verifyManifest));
    app.get('/v1/launcher/releases/latest', manifest('launcher-latest', verify_1.verifyLauncherManifest));
    // Open only ordinary files under the chosen root. Reject links, dot segments and
    // Windows path aliases too, so private files cannot escape via public paths.
    async function sendArtifact(req, reply, base, name) {
        const parts = name.split('/');
        if (parts.some(p => !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(p) || p === '..' || p.endsWith('.')) || parts[0]?.toLowerCase() === 'dev')
            return reply.code(404).send();
        let file = base;
        let handle;
        try {
            let ancestor = root;
            for (const part of node_path_1.default.relative(root, base).split(node_path_1.default.sep)) {
                ancestor = node_path_1.default.join(ancestor, part);
                if ((await promises_1.default.lstat(ancestor)).isSymbolicLink())
                    return reply.code(404).send();
            }
            for (const part of parts) {
                file = node_path_1.default.join(file, part);
                if ((await promises_1.default.lstat(file)).isSymbolicLink())
                    return reply.code(404).send();
            }
            handle = await promises_1.default.open(file, 'r');
            const stat = await handle.stat();
            if (!stat.isFile()) {
                await handle.close();
                return reply.code(404).send();
            }
            let start = 0, end = stat.size - 1;
            reply.header('Accept-Ranges', 'bytes').header('Content-Type', 'application/octet-stream');
            if (req.headers.range) {
                const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
                if (match && (match[1] || match[2])) {
                    if (match[1]) {
                        start = Number(match[1]);
                        if (match[2])
                            end = Math.min(end, Number(match[2]));
                    }
                    else
                        start = Math.max(0, stat.size - Number(match[2]));
                }
                else
                    start = NaN;
                if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= stat.size) {
                    await handle.close();
                    return reply.code(416).header('Content-Range', `bytes */${stat.size}`).send();
                }
                reply.code(206).header('Content-Range', `bytes ${start}-${end}/${stat.size}`);
            }
            reply.header('Content-Length', Math.max(0, end - start + 1));
            if (stat.size === 0) {
                await handle.close();
                return reply.send();
            }
            return reply.send(handle.createReadStream({ start, end, autoClose: true }));
        }
        catch {
            if (handle)
                await handle.close().catch(() => { });
            return reply.code(404).send();
        }
    }
    app.get('/v1/artifacts/:channel/:file', async (req, reply) => {
        const { channel, file } = req.params;
        if (channel !== 'stable' && channel !== 'dev')
            return reply.code(404).send();
        if (channel === 'dev' && !authorize(req, reply))
            return;
        return sendArtifact(req, reply, node_path_1.default.join(root, 'updates', channel, 'artifacts'), file);
    });
    app.get('/artifacts/*', async (req, reply) => sendArtifact(req, reply, node_path_1.default.join(root, 'artifacts'), req.params['*']));
}
