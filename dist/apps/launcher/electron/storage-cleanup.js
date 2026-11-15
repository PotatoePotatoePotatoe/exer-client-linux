"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanStorage = cleanStorage;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
async function entries(dir) {
    try {
        if (!(await promises_1.default.lstat(dir)).isDirectory())
            return [];
        return await promises_1.default.readdir(dir, { withFileTypes: true });
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
}
async function cleanStorage(userRoot, gameRoot) {
    const result = { bytes: 0, skipped: 0 };
    async function cleanFiles(dir, pattern) {
        for (const item of await entries(dir)) {
            if (!item.isFile() || !pattern.test(item.name))
                continue;
            const file = node_path_1.default.join(dir, item.name);
            try {
                const stat = await promises_1.default.lstat(file);
                if (!stat.isFile())
                    continue;
                await promises_1.default.unlink(file);
                result.bytes += stat.size;
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    result.skipped++;
            }
        }
    }
    await cleanFiles(node_path_1.default.join(userRoot, 'logs'), /^\d{4}-\d{2}-\d{2}\.log$/);
    for (const profile of await entries(gameRoot)) {
        if (!profile.isDirectory() || !/^exer-\d+\.\d+(?:\.\d+)?(?:-dev)?$/.test(profile.name))
            continue;
        const root = node_path_1.default.join(gameRoot, profile.name);
        try {
            if ((await entries(root)).some(item => item.name === 'process.json')) {
                result.skipped++;
                continue;
            }
            await cleanFiles(node_path_1.default.join(root, 'logs'), /\.log(?:\.gz)?$/i);
            await cleanFiles(node_path_1.default.join(root, 'crash-reports'), /^crash-.*\.txt$/);
            await cleanFiles(root, /^hs_err_pid\d+\.log$/);
            const packName = /^(?:[a-f0-9]{40}|legacy)(?:\.zip)?$/i;
            await cleanFiles(node_path_1.default.join(root, 'server-resource-packs'), packName);
            const downloads = node_path_1.default.join(root, 'downloads');
            for (const source of await entries(downloads)) {
                if (source.isDirectory() && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(source.name)) {
                    await cleanFiles(node_path_1.default.join(downloads, source.name), packName);
                }
            }
        }
        catch {
            result.skipped++;
        }
    }
    return result;
}
