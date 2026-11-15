"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApi = createApi;
const cosmetics_1 = require("./cosmetics");
const assets_1 = require("./assets");
const identity_1 = require("./identity");
const fastify_1 = __importDefault(require("fastify"));
const updates_1 = require("./updates");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
async function createApi(root, key) {
    const app = (0, fastify_1.default)({ trustProxy: true, logger: { redact: ['req.headers.authorization', 'req.body.minecraftToken'] }, bodyLimit: 1024 * 1024 });
    app.addHook('onRequest', async (req, reply) => {
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS')
            return reply.code(204).send();
    });
    app.addHook('onSend', async (req, reply, payload) => {
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('X-Frame-Options', 'DENY');
        reply.header('Referrer-Policy', 'no-referrer');
        reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        reply.header('Access-Control-Allow-Origin', '*');
        if (req.url === '/health')
            reply.header('Cache-Control', 'no-store');
        return payload;
    });
    app.get('/health', async () => ({ service: 'EXER API', status: 'ok', version: '0.4.0' }));
    // 1. Register cosmetics service and retrieve admin authentication guard
    const botKey = process.env.EXER_BOT_KEY;
    const cosmetics = await (0, cosmetics_1.registerCosmetics)(app, node_path_1.default.join(root, 'data'), undefined, undefined, undefined, undefined, botKey);
    await (0, assets_1.registerAssets)(app, node_path_1.default.join(root, 'data'));
    cosmetics.useDevices(await (0, identity_1.registerIdentity)(app, node_path_1.default.join(root, 'data'), req => cosmetics.user(req, 'players.ban'), req => cosmetics.user(req)));
    await (0, updates_1.registerUpdates)(app, root, key, cosmetics);
    return app;
}
if (require.main === module) {
    const root = node_path_1.default.resolve(process.env.EXER_RELEASE_DIR || 'runtime/releases');
    const key = process.env.EXER_PUBLIC_KEY_FILE ? require('node:fs').readFileSync(process.env.EXER_PUBLIC_KEY_FILE, 'utf8') : '';
    promises_1.default.mkdir(node_path_1.default.join(root, 'artifacts'), { recursive: true }).then(async () => {
        const api = await createApi(root, key);
        await api.listen({ port: Number(process.env.PORT || 8787), host: '127.0.0.1' });
    });
}
