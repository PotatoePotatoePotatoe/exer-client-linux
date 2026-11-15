"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyManifest = verifyManifest;
exports.verifyLauncherManifest = verifyLauncherManifest;
exports.newerVersion = newerVersion;
const node_crypto_1 = __importDefault(require("node:crypto"));
const contracts_1 = require("../../shared/src/contracts");
function verifyManifest(envelope, key, minSequence = -1) {
    if (!key.trim())
        throw Error('Brak przypiętego klucza publicznego wydawcy.');
    if (typeof envelope?.payload !== 'string' || envelope.payload.length > 2 * 1024 * 1024 || typeof envelope.signature !== 'string')
        throw Error('Nieprawidłowy podpisany manifest.');
    const bytes = Buffer.from(envelope.payload, 'base64');
    if (!node_crypto_1.default.verify(null, bytes, key, Buffer.from(envelope.signature, 'base64')))
        throw Error('Podpis aktualizacji nie jest prawidłowy.');
    const manifest = contracts_1.ManifestSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (manifest.sequence <= minSequence)
        throw Error('Aktualizacja starsza lub równa zainstalowanej.');
    const paths = new Set();
    for (const file of manifest.files) {
        if (!/^(mods\/exer-client\.jar|config\/exer-defaults\/[a-zA-Z0-9_-]+\.json)$/.test(file.path))
            throw Error('Manifest próbuje zmienić niedozwolony plik.');
        const normalized = file.path.toLowerCase();
        if (paths.has(normalized))
            throw Error('Duplikat ścieżki aktualizacji.');
        paths.add(normalized);
    }
    if (!paths.has('mods/exer-client.jar'))
        throw Error('Wydanie musi zawierać moda EXER.');
    return manifest;
}
// Paths come from a signed manifest but still end up joined to the install folder: only plain relative names pass.
function launcherObjects(value) {
    if (value === undefined)
        return undefined;
    const hex = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
    const count = (v) => Number.isInteger(v) && v >= 0 && v <= 2 * 1024 ** 3;
    const name = (v) => typeof v === 'string' && /^[A-Za-z0-9_. -]+(\/[A-Za-z0-9_. -]+)*$/.test(v) && !v.split('/').some(p => p === '.' || p === '..' || p.endsWith('.') || p.endsWith(' '));
    if (typeof value?.base !== 'string' || !value.base.startsWith('https://') || !value.base.endsWith('/') || !Array.isArray(value.files) || !value.files.length || value.files.length > 512)
        throw Error('Nieprawidłowy manifest aktualizacji launchera.');
    const files = value.files.map((f) => {
        if (!name(f?.path) || !hex(f.sha256) || !hex(f.packedSha256) || !count(f.size) || !count(f.packed))
            throw Error('Nieprawidłowy manifest aktualizacji launchera.');
        return { path: f.path, sha256: f.sha256, size: f.size, packed: f.packed, packedSha256: f.packedSha256 };
    });
    return { base: value.base, files };
}
function verifyLauncherManifest(envelope, key) {
    if (!key.trim())
        throw Error('Brak przypiętego klucza publicznego wydawcy.');
    if (typeof envelope?.payload !== 'string' || envelope.payload.length > 64 * 1024 || typeof envelope.signature !== 'string')
        throw Error('Nieprawidłowy podpisany manifest.');
    const bytes = Buffer.from(envelope.payload, 'base64');
    if (!node_crypto_1.default.verify(null, bytes, key, Buffer.from(envelope.signature, 'base64')))
        throw Error('Podpis aktualizacji nie jest prawidłowy.');
    const m = JSON.parse(bytes.toString('utf8'));
    const lines = (v) => Array.isArray(v) ? v.filter(x => typeof x === 'string').map(x => x.slice(0, 200)).slice(0, 12) : [];
    if (m.channel !== undefined && m.channel !== 'stable' && m.channel !== 'dev')
        throw Error('Nieprawid�owy kana� manifestu.');
    if (m?.product !== 'exer-launcher' || !/^\d{1,3}\.\d{1,3}\.\d{1,4}$/.test(m.version) || typeof m.url !== 'string' || !m.url.startsWith('https://') || !/^[a-f0-9]{64}$/.test(m.sha256) || !Number.isInteger(m.size) || m.size < 1024 * 1024 || m.size > 2 * 1024 ** 3)
        throw Error('Nieprawidłowy manifest aktualizacji launchera.');
    return { product: 'exer-launcher', channel: m.channel || 'stable', version: m.version, url: m.url, sha256: m.sha256, size: m.size, published: String(m.published || ''), notes: { pl: lines(m.notes?.pl), en: lines(m.notes?.en) }, objects: launcherObjects(m.objects) };
}
// 0.5.10 > 0.5.9
function newerVersion(a, b) {
    const x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((x[i] || 0) !== (y[i] || 0))
            return (x[i] || 0) > (y[i] || 0);
    }
    return false;
}
