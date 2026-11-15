"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASSET_MODELS = void 0;
exports.registerAssets = registerAssets;
const node_crypto_1 = __importDefault(require("node:crypto"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const vops_catalog_1 = require("../../../packages/shared/src/vops-catalog");
exports.ASSET_MODELS = {
    crown: {
        id: 'crown',
        model: 'royal_crown',
        slot: 'head',
        texture: '/cosmetics/items/royal_crown/texture.png',
        animation: 'orbit',
        cuboids: [
            [-4.7, -9.5, -4.7, 9.4, 2, 1], [-4.7, -9.5, 3.7, 9.4, 2, 1], [-4.7, -9.5, -3.7, 1, 2, 7.4], [3.7, -9.5, -3.7, 1, 2, 7.4],
            [-4, -12, -4.7, 1, 3, 1], [-0.5, -12, -4.7, 1, 3, 1], [3, -12, -4.7, 1, 3, 1],
            [-4, -12, 3.7, 1, 3, 1], [-0.5, -12, 3.7, 1, 3, 1], [3, -12, 3.7, 1, 3, 1]
        ]
    },
    halo: {
        id: 'halo',
        model: 'halo',
        slot: 'head',
        texture: '/assets/cosmetics/material.png',
        animation: 'float',
        cuboids: [[-5, -13, -5, 10, 0.7, 1], [-5, -13, 4, 10, 0.7, 1], [-5, -13, -4, 1, 0.7, 8], [4, -13, -4, 1, 0.7, 8]]
    },
    wings: {
        id: 'wings',
        model: 'phoenix_wings',
        slot: 'wings',
        texture: '/cosmetics/items/phoenix_wings/texture.png',
        animation: 'flap',
        cuboids: [-1, 1].flatMap(side => Array.from({ length: 5 }, (_, i) => [side < 0 ? -6 - i * 2.3 : 4 + i * 2.3, 1 + i * 1.4, 3 + i * 0.6, 2.5, 12 - i * 1.5, 0.7]))
    },
    cape: {
        id: 'cape',
        model: 'cape',
        slot: 'cape',
        texture: '/cosmetics/capes/2011.png',
        animation: 'cloth',
        cuboids: [[-5, 0, 2.6, 10, 16, 0.6]]
    }
};
async function registerAssets(app, root) {
    const assetsDir = node_path_1.default.join(root, 'cdn-assets');
    await promises_1.default.mkdir(assetsDir, { recursive: true });
    const vopsDir = node_path_1.default.resolve('packages/cosmetics-assets');
    app.get('/v1/assets/catalog', async (_req, reply) => {
        reply.header('Cache-Control', 'public, max-age=300');
        return {
            service: 'EXER Asset CDN',
            version: '0.4.0',
            models: Object.values(exports.ASSET_MODELS),
            catalog: vops_catalog_1.VOPS_COSMETICS_CATALOG
        };
    });
    // Serve specific Vops capes
    app.get('/assets/cosmetics/capes/:file', async (req, reply) => {
        const file = String(req.params.file || '');
        if (!/^[a-zA-Z0-9._-]+\.png$/.test(file))
            return reply.code(400).send({ error: 'Invalid file name' });
        const target = node_path_1.default.join(vopsDir, 'capes', file);
        try {
            const bytes = await promises_1.default.readFile(target);
            const sha256 = node_crypto_1.default.createHash('sha256').update(bytes).digest('hex');
            reply.header('Content-Type', 'image/png');
            reply.header('X-EXER-SHA256', sha256);
            reply.header('Cache-Control', 'public, max-age=86400');
            return reply.send(bytes);
        }
        catch {
            return reply.code(404).send({ error: 'Cape not found' });
        }
    });
    // Serve Vops 3D item models and textures
    app.get('/assets/cosmetics/items/:item/:file', async (req, reply) => {
        const item = String(req.params.item || '');
        const file = String(req.params.file || '');
        if (!/^[a-zA-Z0-9_-]+$/.test(item) || !/^[a-zA-Z0-9._-]+\.(png|cfg|json)$/.test(file)) {
            return reply.code(400).send({ error: 'Invalid path' });
        }
        const target = node_path_1.default.join(vopsDir, 'items', item, file);
        try {
            const bytes = await promises_1.default.readFile(target);
            const contentType = file.endsWith('.png') ? 'image/png' : 'application/json';
            reply.header('Content-Type', contentType);
            reply.header('Cache-Control', 'public, max-age=86400');
            return reply.send(bytes);
        }
        catch {
            return reply.code(404).send({ error: 'Item asset not found' });
        }
    });
    // Fallback root cosmetics endpoint
    app.get('/assets/cosmetics/:name', async (req, reply) => {
        const name = String(req.params.name || '');
        if (!/^[a-zA-Z0-9._-]+\.png$/.test(name))
            return reply.code(400).send({ error: 'Invalid asset name' });
        const candidates = [
            node_path_1.default.join(assetsDir, name),
            node_path_1.default.join(vopsDir, 'capes', name),
            node_path_1.default.resolve('minecraft/exer-client/src/main/resources/assets/exer/textures/cosmetics', name),
            node_path_1.default.resolve('packages/cosmetics-assets/capes/2011.png')
        ];
        for (const candidate of candidates) {
            try {
                const bytes = await promises_1.default.readFile(candidate);
                const sha256 = node_crypto_1.default.createHash('sha256').update(bytes).digest('hex');
                reply.header('Content-Type', 'image/png');
                reply.header('X-EXER-SHA256', sha256);
                reply.header('Cache-Control', 'public, max-age=3600');
                return reply.send(bytes);
            }
            catch { }
        }
        return reply.code(404).send({ error: 'Asset not found' });
    });
}
