"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.supportedVersion = void 0;
exports.versions = versions;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const contracts_1 = require("../../../packages/shared/src/contracts");
const version_manifest_1 = require("../../../packages/shared/src/version-manifest");
const io_1 = require("./io");
const supportedVersion = (id) => /^(?:1\.8\.9|1\.21(?:\.(?:[1-9]|10|11))?|26\.(?:1(?:\.[12])?|2|3))$/.test(id);
exports.supportedVersion = supportedVersion;
async function computeInstanceDiskSize(instanceDir) {
    let total = 0;
    async function walk(dir, depth = 0) {
        if (depth > 5)
            return;
        let entries;
        try {
            entries = await promises_1.default.readdir(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const full = node_path_1.default.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'assets')
                    continue;
                await walk(full, depth + 1);
            }
            else if (entry.isFile()) {
                try {
                    const st = await promises_1.default.stat(full);
                    total += st.size;
                }
                catch { }
            }
        }
    }
    await walk(instanceDir, 0);
    return total;
}
async function versions(options) {
    let mojangList = [];
    try {
        const manifest = await (0, io_1.getJSON)('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
        mojangList = (manifest.versions || []).filter((v) => v.type === 'release' && (0, exports.supportedVersion)(v.id));
    }
    catch {
        mojangList = version_manifest_1.EXER_VERSION_MANIFEST.map(m => ({
            id: m.id,
            type: 'release',
            releaseTime: m.id.startsWith('26.') ? '2026-04-01T12:00:00+00:00' : m.id === '1.8.9' ? '2015-12-09T12:00:00+00:00' : '2024-08-08T12:00:00+00:00'
        }));
    }
    const defaultResolveJar = (versionId) => {
        const meta = (0, version_manifest_1.getVersionManifestEntry)(versionId);
        const jarName = meta?.exerCoreJar || (versionId === '1.21.1' ? 'exer-client-0.5.99.jar' : `exer-client-0.5.99-mc${versionId}.jar`);
        return node_path_1.default.resolve(process.cwd(), 'minecraft/exer-client/build/libs', jarName);
    };
    const resolveJar = options?.resolveClientJar || defaultResolveJar;
    const rootDir = options?.dataRoot || '';
    const results = [];
    for (const v of mojangList) {
        const meta = (0, version_manifest_1.getVersionManifestEntry)(v.id);
        const legacy = meta?.loaderFamily === 'legacy-fabric';
        const bundledJarPath = resolveJar(v.id);
        const exerCoreReady = await (0, io_1.validFile)(bundledJarPath);
        let installed = false;
        let exerCoreInstalled = false;
        let fabricLoaderInstalled = false;
        let fabricApiInstalled = false;
        let sodiumInstalled = false;
        let diskSizeBytes = 0;
        let updateAvailable = false;
        let installedLoader = meta?.fabricLoader || '0.18.4';
        if (rootDir) {
            const instanceDir = node_path_1.default.join(rootDir, 'exer-' + v.id);
            try {
                const installedRaw = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(instanceDir, 'installed.json'), 'utf8'));
                installed = Boolean(installedRaw?.build);
                if (installedRaw?.loader)
                    installedLoader = String(installedRaw.loader);
                if (installedRaw?.build && installedRaw.build !== contracts_1.BUILD)
                    updateAvailable = true;
            }
            catch {
                installed = await (0, io_1.validFile)(node_path_1.default.join(instanceDir, 'launch.json'));
            }
            exerCoreInstalled = (await (0, io_1.validFile)(node_path_1.default.join(instanceDir, '.exer-core', 'exer-client.jar'))) || (await (0, io_1.validFile)(node_path_1.default.join(instanceDir, 'mods', 'exer-client.jar')));
            fabricLoaderInstalled = await (0, io_1.validFile)(node_path_1.default.join(instanceDir, 'fabric.json'));
            try {
                const modEntries = await promises_1.default.readdir(node_path_1.default.join(instanceDir, 'mods'));
                fabricApiInstalled = modEntries.some(name => /^fabric-api/i.test(name) && name.endsWith('.jar'));
                sodiumInstalled = modEntries.some(name => /^sodium/i.test(name) && name.endsWith('.jar'));
            }
            catch { }
            if (installed || exerCoreInstalled || fabricLoaderInstalled) {
                diskSizeBytes = await computeInstanceDiskSize(instanceDir);
            }
            if (installed && (!exerCoreInstalled || (!legacy && !sodiumInstalled))) {
                updateAvailable = true;
            }
        }
        results.push({
            id: v.id,
            title: meta?.title || `Minecraft ${v.id}`,
            releaseTime: v.releaseTime,
            edition: legacy ? 'EXER Legacy' : 'EXER + Sodium',
            releaseChannel: meta?.releaseChannel || 'stable',
            installed,
            exerCoreReady,
            exerCoreInstalled,
            exerCoreVersion: meta?.exerCoreVersion || contracts_1.BUILD,
            fabricLoader: installedLoader,
            fabricLoaderInstalled,
            fabricApiVersion: meta ? meta.fabricApiVersion : '0.116.17+1.21.1',
            fabricApiInstalled,
            sodiumVersion: meta ? meta.sodiumVersion : 'mc1.21.1-0.8.13-fabric',
            sodiumInstalled,
            javaMajor: meta?.javaMajor || (v.id.startsWith('26.') ? 25 : 21),
            loaderFamily: meta?.loaderFamily || 'fabric',
            diskSizeBytes,
            updateAvailable,
            renderPipeline: meta?.renderPipeline || 'EXER Universal Render Pipeline'
        });
    }
    return results;
}
