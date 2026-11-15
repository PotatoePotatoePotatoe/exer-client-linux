"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeCrash = analyzeCrash;
exports.collectCrash = collectCrash;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const lines = (s) => s.split(/\r?\n/);
// Mod ids from Fabric's "incompatible mods" / missing dependency messages and from mixin failures.
function modsFrom(text) {
    const found = new Set();
    for (const m of text.matchAll(/(?:Mod|mod) '([^']{1,60})' \(([a-z0-9_.-]{2,64})\)/g))
        found.add(m[2]);
    for (const m of text.matchAll(/Mixin apply(?:ing)? (?:for|failed)[^\n]*?from mod ([a-z0-9_.-]{2,64})/gi))
        found.add(m[1]);
    for (const m of text.matchAll(/\[([a-z0-9_.-]{2,64})\.mixins\.json/g))
        found.add(m[1]);
    for (const id of ['minecraft', 'java', 'fabricloader', 'fabric-api', 'exer', 'fabric'])
        found.delete(id);
    return [...found].slice(0, 8);
}
function analyzeCrash(text) {
    // A vanilla crash report ends with "-- System Details --": GPU name, "GL Caps: ... OpenGL 3.2", the mod list.
    // Those lines mention OpenGL in every report, so they must not decide the cause (a plain NullPointerException
    // was reported as a graphics-driver problem).
    const t = text.split(/^-- System Details --/m)[0];
    if (/java\.lang\.OutOfMemoryError|Could not reserve enough space for|There is insufficient memory for the Java Runtime/i.test(t))
        return { cause: 'memory', fixes: ['more-ram'], mods: [], detail: (/(java\.lang\.OutOfMemoryError[^\n]*)/.exec(t)?.[1] || 'OutOfMemoryError').trim() };
    if (/UnsupportedClassVersionError|has been compiled by a more recent version of the Java Runtime|requires (?:a )?(?:newer )?Java \d+/i.test(t))
        return { cause: 'java', fixes: ['repair'], mods: modsFrom(t), detail: (/(UnsupportedClassVersionError[^\n]*|requires[^\n]*Java[^\n]*)/i.exec(t)?.[1] || '').trim() };
    if (/Some of your mods are incompatible|Incompatible mods? found|Incompatible mod set!/i.test(t)) {
        const missing = /requires (?:any version|version [^\n]*) of [^\n]*which is missing|is missing!|which is missing/i.test(t);
        return { cause: missing ? 'mods-missing' : 'mods-incompatible', fixes: ['disable-mods', 'open-reports'], mods: modsFrom(t), detail: lines(t).filter(l => /^\s*-\s*(Mod|Replace|Install|Remove)/.test(l)).slice(0, 6).join('\n').trim() };
    }
    if (/net\.coderbot\.iris|net\.irisshaders|shaderpack|ShaderPack/i.test(t) && /Exception|Error/.test(t))
        return { cause: 'shaders', fixes: ['disable-shaders'], mods: [], detail: (/((?:net\.irisshaders|net\.coderbot\.iris)[^\n]*)/.exec(t)?.[1] || 'Iris').trim() };
    if (/MixinApplyError|Mixin apply failed|InvalidInjectionException|MixinTransformerError|InjectionError/i.test(t))
        return { cause: 'mixin', fixes: ['disable-mods', 'open-reports'], mods: modsFrom(t), detail: (/((?:Mixin apply failed|InvalidInjectionException|MixinTransformerError)[^\n]*)/.exec(t)?.[1] || 'Mixin').trim() };
    if (/Pixel format not accelerated|GLFW error|WGL_ARB_create_context|EXCEPTION_ACCESS_VIOLATION[\s\S]{0,4000}(atio6axx|atioglxx|nvoglv|ig\d+icd|igxelp|amdxx)/i.test(t))
        return { cause: 'graphics', fixes: ['update-drivers', 'disable-shaders'], mods: [], detail: (/(Pixel format not accelerated|GLFW error[^\n]*|EXCEPTION_ACCESS_VIOLATION[^\n]*|[^\n]*OpenGL[^\n]*)/i.exec(t)?.[1] || '').trim() };
    if (/ZipException|zip END header not found|Invalid or corrupt jarfile|error in opening zip file|Corrupted (?:jar|zip|archive)/i.test(t))
        return { cause: 'corrupt', fixes: ['repair'], mods: [], detail: (/((?:java\.util\.zip\.ZipException|Invalid or corrupt jarfile|zip END header not found)[^\n]*)/.exec(t)?.[1] || '').trim() };
    return { cause: 'unknown', fixes: ['open-reports'], mods: modsFrom(t), detail: (/(Description:[^\n]*)/.exec(t)?.[1] || lines(t).find(l => /Exception|Error/.test(l)) || '').trim() };
}
// The most relevant part of a report: description + the first stack trace lines.
function excerptOf(text) {
    const all = lines(text);
    const start = Math.max(0, all.findIndex(l => /^Description:|Exception|Error|Some of your mods/.test(l)));
    return all.slice(start, start + 18).join('\n').slice(0, 3000);
}
async function newest(dir, match, since) {
    try {
        const names = (await promises_1.default.readdir(dir)).filter(n => match.test(n));
        let best = null;
        for (const n of names) {
            const st = await promises_1.default.stat(node_path_1.default.join(dir, n));
            if (st.mtimeMs >= since - 2000 && (!best || st.mtimeMs > best.time))
                best = { file: node_path_1.default.join(dir, n), time: st.mtimeMs };
        }
        return best?.file || '';
    }
    catch {
        return '';
    }
}
// What the JVM wrote to stdout/stderr during THIS launch (the launcher appends a marker line at every start).
// A JVM that dies on startup ("Could not reserve enough space", UnsupportedClassVersionError) leaves no crash
// report and no latest.log; this file is the only place that has it.
async function launchLog(instance) {
    try {
        const file = node_path_1.default.join(instance, 'logs', 'exer-launcher-game.log');
        const stat = await promises_1.default.stat(file), size = Math.min(stat.size, 300000);
        const handle = await promises_1.default.open(file, 'r');
        try {
            const buffer = Buffer.alloc(size);
            await handle.read(buffer, 0, size, stat.size - size);
            const all = buffer.toString('utf8'), at = all.lastIndexOf('--- EXER launch ');
            return at >= 0 ? all.slice(at) : all;
        }
        finally {
            await handle.close();
        }
    }
    catch {
        return '';
    }
}
async function recentFile(file, since) {
    try {
        const stat = await promises_1.default.stat(file);
        return stat.mtimeMs >= since - 2000 ? (await promises_1.default.readFile(file, 'utf8')).slice(-120000) : '';
    }
    catch {
        return '';
    }
}
// Collects what the crashed game left in its instance folder (only files written since the launch).
async function collectCrash(instance, version, exitCode, startedAt, recentLog) {
    const report = await newest(node_path_1.default.join(instance, 'crash-reports'), /^crash-.*\.txt$/, startedAt) || await newest(instance, /^hs_err_pid\d+\.log$/, startedAt);
    let text = '';
    if (report) {
        try {
            text = (await promises_1.default.readFile(report, 'utf8')).slice(0, 400000);
        }
        catch { }
    }
    if (!text) {
        // No report: take the first source that points at a known cause. latest.log counts only when this launch wrote it
        // (an old one would blame the previous session), the game log is the one that has JVM start-up failures.
        const sources = [await recentFile(node_path_1.default.join(instance, 'logs', 'latest.log'), startedAt), await launchLog(instance), recentLog].filter(Boolean);
        text = sources.find(s => analyzeCrash(s).cause !== 'unknown') || sources[0] || '';
    }
    const analysis = analyzeCrash(text);
    return { at: new Date().toISOString(), version, exitCode, ...analysis, excerpt: excerptOf(text), reportFile: report ? node_path_1.default.basename(report) : '' };
}
