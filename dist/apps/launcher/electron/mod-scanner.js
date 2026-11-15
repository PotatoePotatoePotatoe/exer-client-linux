"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUILTIN_SIGNATURES = void 0;
exports.scanModsFolder = scanModsFolder;
exports.runModScan = runModScan;
exports.mergeSignatures = mergeSignatures;
exports.buildModScanEvidence = buildModScanEvidence;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const adm_zip_1 = __importDefault(require("adm-zip"));
/** Built in; the backend may add more (`mergeSignatures`). Only identifiers that are unique to the client: short generic mod ids are matched by their packages only. */
exports.BUILTIN_SIGNATURES = [
    { name: 'Meteor Client', modIds: ['meteor-client'], packages: ['meteordevelopment/meteorclient/'] },
    { name: 'Wurst Client', modIds: ['wurst', 'wurst-client'], packages: ['net/wurstclient/'] },
    { name: 'Aristois', modIds: ['aristois'], packages: ['me/deftware/aristois/', 'net/aristois/'] },
    { name: 'LiquidBounce', modIds: ['liquidbounce'], packages: ['net/ccbluex/liquidbounce/'] },
    { name: 'BleachHack', modIds: ['bleachhack'], packages: ['org/bleachhack/'] },
    { name: 'RusherHack', modIds: ['rusherhack'], packages: ['org/rusherhack/'] },
    { name: 'ThunderHack', modIds: ['thunderhack'], packages: ['thunder/hack/'] },
    { name: 'Lambda', packages: ['com/lambda/client/'] },
    { name: 'SalHack', modIds: ['salhack'], packages: ['me/ionar/salhack/'] },
    { name: 'KAMI Blue', modIds: ['kamiblue'], packages: ['org/kamiblue/'] },
    { name: 'Impact', packages: ['com/impactclient/'] },
    { name: 'Future', packages: ['net/futureclient/'] },
    { name: 'Sigma', packages: ['info/sigmaclient/'] },
    // A pathfinding bot used by many clients: not cheating by itself, worth a warning.
    { name: 'Baritone', modIds: ['baritone'], packages: ['baritone/api/'], level: 'suspicious' },
];
/** Class names that only exist in hacked clients. Two different ones in one jar mean "looks like a cheat client". */
const CHEAT_MODULE_CLASSES = ['killaura', 'aimbot', 'triggerbot', 'scaffold', 'nofall', 'crystalaura', 'autototem', 'autoclicker', 'reachhack', 'antiknockback'];
const MAX_JAR_BYTES = 96 * 1024 * 1024;
const MAX_NESTED_DEPTH = 2;
const sha256 = (buffer) => node_crypto_1.default.createHash('sha256').update(buffer).digest('hex');
function readJar(buffer) {
    let zip;
    try {
        zip = new adm_zip_1.default(buffer);
    }
    catch {
        return null;
    }
    const facts = { modIds: [], names: [], nested: [], classPaths: [] };
    for (const entry of zip.getEntries()) {
        const name = entry.entryName;
        if (entry.isDirectory)
            continue;
        if (name.endsWith('.class'))
            facts.classPaths.push(name.toLowerCase());
        else if (name === 'fabric.mod.json') {
            try {
                const json = JSON.parse(zip.readAsText(entry));
                if (typeof json.id === 'string')
                    facts.modIds.push(json.id.toLowerCase());
                if (typeof json.name === 'string')
                    facts.names.push(json.name);
                for (const nested of Array.isArray(json.jars) ? json.jars : [])
                    if (typeof nested?.file === 'string')
                        facts.nested.push(nested.file);
            }
            catch { /* a broken fabric.mod.json is not evidence */ }
        }
    }
    return facts;
}
function matchSignatures(facts, signatures) {
    const found = [];
    for (const signature of signatures) {
        const id = facts.modIds.find(candidate => signature.modIds?.includes(candidate));
        if (id) {
            found.push({ signature, by: `mod id ${id}` });
            continue;
        }
        const prefix = signature.packages?.find(p => facts.classPaths.some(c => c.startsWith(p.toLowerCase())));
        if (prefix)
            found.push({ signature, by: `classes ${prefix}` });
    }
    return found;
}
function scanJar(file, buffer, signatures, depth, out, hashPrefix = '') {
    const hash = sha256(buffer);
    const known = signatures.find(s => s.sha256?.includes(hash));
    if (known) {
        out.push({ level: known.level || 'confirmed', file, hash, reason: `Known cheat file (SHA-256): ${known.name}`, evidence: { sha256: hash, signature: known.name, nestedIn: hashPrefix || undefined } });
        return;
    }
    const facts = readJar(buffer);
    if (!facts)
        return;
    for (const hit of matchSignatures(facts, signatures)) {
        out.push({ level: hit.signature.level || 'confirmed', file, hash, reason: `${hit.signature.name} (${hit.by})`, evidence: { signature: hit.signature.name, by: hit.by, modIds: facts.modIds, nestedIn: hashPrefix || undefined } });
    }
    const moduleHits = new Set(CHEAT_MODULE_CLASSES.filter(name => facts.classPaths.some(c => new RegExp(`/${name}[^/]*\\.class$`).test(c))));
    if (moduleHits.size >= 2 && !out.some(d => d.file === file && d.hash === hash)) {
        out.push({ level: 'suspicious', file, hash, reason: `Contains cheat modules: ${[...moduleHits].join(', ')}`, evidence: { classes: [...moduleHits], modIds: facts.modIds } });
    }
    if (depth < MAX_NESTED_DEPTH && facts.nested.length) {
        let zip;
        try {
            zip = new adm_zip_1.default(buffer);
        }
        catch {
            return;
        }
        for (const inner of facts.nested) {
            const entry = zip.getEntry(inner);
            if (!entry || entry.header.size > MAX_JAR_BYTES)
                continue;
            scanJar(file, entry.getData(), signatures, depth + 1, out, hash);
        }
    }
}
/** Scans every `.jar` of a mods folder. `.disabled` files do not load and are skipped. */
async function scanModsFolder(modsDir, signatures = exports.BUILTIN_SIGNATURES) {
    const detections = [];
    let names = [];
    try {
        names = (await promises_1.default.readdir(modsDir)).filter(f => f.toLowerCase().endsWith('.jar'));
    }
    catch { /* no mods folder = nothing to scan */ }
    let scanned = 0;
    for (const name of names) {
        const file = node_path_1.default.join(modsDir, name);
        try {
            const stat = await promises_1.default.stat(file);
            if (!stat.isFile() || stat.size > MAX_JAR_BYTES)
                continue;
            scanJar(file, await promises_1.default.readFile(file), signatures, 0, detections);
            scanned++;
        }
        catch { /* unreadable file: not evidence */ }
    }
    const suspicious = detections.filter(d => d.level === 'suspicious');
    const confirmed = detections.filter(d => d.level === 'confirmed');
    return { clean: confirmed.length === 0, detections, suspicious, confirmed, scanned };
}
async function runModScan(instanceDir, signatures = exports.BUILTIN_SIGNATURES) {
    return scanModsFolder(node_path_1.default.join(instanceDir, 'mods'), signatures);
}
/** Signatures the backend added (the list is public and signed by nobody: only identifiers are accepted from it). */
function mergeSignatures(extra) {
    const merged = [...exports.BUILTIN_SIGNATURES];
    if (!Array.isArray(extra))
        return merged;
    const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
    for (const raw of extra.slice(0, 500)) {
        const name = text(raw?.name, 60);
        if (!name)
            continue;
        const list = (value, max, test) => Array.isArray(value) ? value.slice(0, 50).filter((s) => typeof s === 'string' && s.length <= max && test(s)) : [];
        merged.push({
            name,
            modIds: list(raw.modIds, 64, s => /^[a-z0-9_.-]{2,64}$/.test(s)),
            packages: list(raw.packages, 120, s => /^[A-Za-z0-9_$/.-]{6,120}\/$/.test(s)),
            sha256: list(raw.sha256, 64, s => /^[a-f0-9]{64}$/.test(s)),
            level: raw.level === 'suspicious' ? 'suspicious' : 'confirmed',
        });
    }
    return merged;
}
/** The minimum the backend needs: file names and hashes, no paths of the player's PC and no other account data. */
async function buildModScanEvidence(result) {
    return {
        detections: result.detections.map(d => ({ level: d.level, fileName: node_path_1.default.basename(d.file), hash: d.hash, reason: d.reason.slice(0, 200) })),
        timestamp: new Date().toISOString(),
        scanned: result.scanned,
    };
}
