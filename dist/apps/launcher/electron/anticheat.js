"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyModules = classifyModules;
exports.findForeignJavaAgent = findForeignJavaAgent;
exports.findCheatTool = findCheatTool;
exports.listRunningProcesses = listRunningProcesses;
exports.runAnticheatScan = runAnticheatScan;
exports.scanRunningGameForAttachment = scanRunningGameForAttachment;
exports.gamePid = gamePid;
const node_child_process_1 = require("node:child_process");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
/** Modules only Cheat Engine puts into a process it attaches to. */
const CHEAT_ENGINE_MODULES = /^(vehdebug|speedhack|luaclient|winhook|ced3d\d+hook)(-x86_64|-i386|64)?\.dll$/i;
/** Cheat Engine's own process names (a warning when running, never a block). */
const CHEAT_ENGINE_PROCESSES = /^cheat ?engine([ -][\w.-]*)?\.exe$/i;
/** DLL names that are classic side-loading / injection targets. The name alone proves nothing. */
const PROXY_DLLS = new Set(['d3d8.dll', 'd3d9.dll', 'd3d10.dll', 'd3d11.dll', 'd3d12.dll', 'dxgi.dll', 'opengl32.dll', 'vulkan-1.dll', 'version.dll', 'winmm.dll', 'ws2_32.dll', 'dinput.dll', 'dinput8.dll', 'dsound.dll', 'ddraw.dll', 'xinput1_3.dll', 'xinput1_4.dll', 'xinput9_1_0.dll', 'dwmapi.dll', 'wininet.dll', 'winhttp.dll']);
/** Vendors whose signed overlays, drivers and runtimes legitimately load these DLLs into games. */
const TRUSTED_SIGNERS = /\b(Microsoft|NVIDIA|Advanced Micro Devices|AMD|Intel|Valve|Discord|Oracle|Eclipse|Azul|Amazon|Adoptium|Google|Mozilla|Razer|Logitech|Corsair|SteelSeries|Overwolf|OBS|Guru3D|MSI|ASUS|Realtek|Epic Games|Electronic Arts|Ubisoft|Blizzard|Xbox|Brave|Opera|Medal|Streamlabs)\b/i;
const lower = (value) => value.toLowerCase().replace(/\//g, '\\');
function isUnder(file, dirs) {
    const target = lower(file);
    return dirs.filter(Boolean).some(dir => { const d = lower(dir).replace(/\\+$/, ''); return target === d || target.startsWith(d + '\\'); });
}
/** Turns the modules of the game process into a verdict. Exported for the tests. */
async function classifyModules(modules, ctx) {
    const warnings = [];
    for (const mod of modules) {
        const name = mod.name.toLowerCase();
        if (CHEAT_ENGINE_MODULES.test(name)) {
            return { finding: { kind: 'cheat-engine-attached', detail: `Cheat Engine module loaded in the game: ${mod.name}` }, warnings };
        }
    }
    for (const mod of modules) {
        const name = mod.name.toLowerCase();
        if (!PROXY_DLLS.has(name))
            continue;
        if (isUnder(mod.path, ctx.systemDirs))
            continue;
        const signature = await ctx.signatureOf(mod.path);
        const trusted = !!signature && signature.status === 'Valid' && TRUSTED_SIGNERS.test(signature.subject);
        const inGame = isUnder(mod.path, ctx.gameDirs);
        const inUserDir = isUnder(mod.path, ctx.userDirs);
        if (trusted) {
            warnings.push(`${mod.name} from ${mod.path} (signed: OK)`);
        }
        else if (inGame || inUserDir) {
            // An unsigned or foreign-signed copy of a system DLL sitting in the game or a user-writable folder is how a
            // DLL is side-loaded into a process.
            return { finding: { kind: 'injector-attached', detail: `Unsigned ${mod.name} loaded from ${mod.path}` }, warnings };
        }
        else {
            warnings.push(`${mod.name} from ${mod.path} (${signature ? signature.status : 'signature unknown'}): not a finding`);
        }
    }
    return { finding: null, warnings };
}
/** A Java agent on the command line of the game: the launcher itself never passes one. */
function findForeignJavaAgent(commandLine, allowedDirs) {
    for (const match of commandLine.matchAll(/-(?:javaagent|agentpath|agentlib):("[^"]+"|[^\s]+)/gi)) {
        const value = match[1].replace(/^"|"$/g, '');
        // agentlib:jdwp is a debugger, which is not cheating by itself.
        if (/^-agentlib:/i.test(match[0]) && /^jdwp/i.test(value))
            continue;
        const file = value.split('=')[0];
        if (isUnder(file, allowedDirs))
            continue;
        return `Java agent on the game command line: ${file}`;
    }
    return null;
}
function powershell(script, timeoutMs = 10000) {
    if (process.platform !== 'win32')
        return Promise.resolve('');
    return new Promise(resolve => {
        (0, node_child_process_1.execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => resolve(error ? '' : String(stdout)));
    });
}
const psQuote = (value) => "'" + value.replace(/'/g, "''") + "'";
async function readModules(pid) {
    const out = await powershell(`try{(Get-Process -Id ${Math.trunc(pid)} -ErrorAction Stop).Modules|ForEach-Object{[pscustomobject]@{n=$_.ModuleName;p=$_.FileName}}|ConvertTo-Json -Compress}catch{''}`);
    if (!out.trim())
        return null;
    try {
        const parsed = JSON.parse(out);
        return (Array.isArray(parsed) ? parsed : [parsed]).filter(m => m && m.n && m.p).map(m => ({ name: String(m.n), path: String(m.p) }));
    }
    catch {
        return null;
    }
}
async function readCommandLine(pid) {
    return (await powershell(`try{(Get-CimInstance Win32_Process -Filter "ProcessId=${Math.trunc(pid)}" -ErrorAction Stop).CommandLine}catch{''}`)).trim();
}
async function signatureOf(file) {
    const out = await powershell(`try{$s=Get-AuthenticodeSignature -LiteralPath ${psQuote(file)};[pscustomobject]@{s=[string]$s.Status;c=if($s.SignerCertificate){$s.SignerCertificate.Subject}else{''}}|ConvertTo-Json -Compress}catch{''}`, 15000);
    try {
        const j = JSON.parse(out);
        return { status: String(j.s), subject: String(j.c) };
    }
    catch {
        return null;
    }
}
function defaultContext(instanceDir) {
    const windir = process.env.SystemRoot || 'C:\\Windows';
    const home = process.env.USERPROFILE || '';
    return {
        gameDirs: [instanceDir],
        systemDirs: [node_path_1.default.join(windir, 'System32'), node_path_1.default.join(windir, 'SysWOW64'), node_path_1.default.join(windir, 'WinSxS'), node_path_1.default.join(windir, 'SystemApps')],
        userDirs: [node_path_1.default.join(home, 'Downloads'), node_path_1.default.join(home, 'Desktop'), process.env.TEMP || '', process.env.TMP || '', node_path_1.default.join(home, 'AppData', 'Local', 'Temp')],
        signatureOf,
    };
}
/** Memory cheat tools. Matched on the process name, the exe's product/description/company and the main window title. */
const CHEAT_TOOLS = [
    // [label, name/product/description/company pattern, exact window title pattern]
    ['Cheat Engine', /cheat ?engine/i, /^cheat engine( \d[\d.]*)?( \(admin\))?$/i],
    ['ArtMoney', /artmoney/i, /^artmoney\b/i],
    ['Squalr', /^squalr\b/i, /^squalr\b/i],
    ['ReClass.NET', /reclass\.?net/i, /^reclass\.net\b/i],
];
/** Browsers and editors: their window titles can name anything (a download page), so only their exe is judged. */
const TITLE_UNTRUSTED = /^(chrome|msedge|firefox|opera|brave|vivaldi|code|notepad|notepad\+\+|explorer|discord|obs64)$/i;
/** A known memory cheat tool among the running processes (a renamed exe is still caught by its file info or window title). */
function findCheatTool(processes) {
    for (const p of processes) {
        for (const [label, pattern, title] of CHEAT_TOOLS) {
            const byFile = [p.name, p.product, p.description, p.company].some(v => v && pattern.test(v));
            const byTitle = !TITLE_UNTRUSTED.test(p.name) && !!p.title && title.test(p.title.trim());
            if (byFile || byTitle)
                return { kind: 'cheat-tool-running', detail: `${label} running: ${p.name}.exe${p.title ? ' "' + p.title.trim().slice(0, 60) + '"' : ''}`.slice(0, 240) };
        }
    }
    return null;
}
/** Processes with a window, plus any whose name looks like a cheat tool, with their exe's version info when readable. */
async function listRunningProcesses() {
    const out = await powershell("[Console]::OutputEncoding=[Text.Encoding]::UTF8;Get-Process|Where-Object{$_.MainWindowHandle -ne 0 -or $_.ProcessName -match 'cheat|artmoney|squalr|reclass'}|ForEach-Object{$i=$null;try{$i=$_.MainModule.FileVersionInfo}catch{};[pscustomobject]@{n=$_.ProcessName;t=$_.MainWindowTitle;r=if($i){$i.ProductName}else{''};d=if($i){$i.FileDescription}else{''};c=if($i){$i.CompanyName}else{''}}}|ConvertTo-Json -Compress", 12000);
    if (!out.trim())
        return [];
    try {
        const parsed = JSON.parse(out.replace(/[\u0000-\u001f]/g, " "));
        return (Array.isArray(parsed) ? parsed : [parsed]).filter(p => p && p.n).map(p => ({ name: String(p.n), title: String(p.t || ''), product: String(p.r || ''), description: String(p.d || ''), company: String(p.c || '') }));
    }
    catch {
        return [];
    }
}
/** Before launch: informational only. Never blocks the start and never restricts an account. */
async function runAnticheatScan() {
    if (process.platform !== 'win32')
        return { clean: true, detections: [], warnings: [] };
    const warnings = [];
    const out = await new Promise(resolve => (0, node_child_process_1.execFile)('tasklist.exe', ['/fo', 'csv', '/nh'], { timeout: 8000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => resolve(error ? '' : String(stdout))));
    for (const line of out.split(/\r?\n/)) {
        const name = line.split('","')[0]?.replace(/^"/, '').trim();
        if (name && CHEAT_ENGINE_PROCESSES.test(name))
            warnings.push(`Cheat Engine działa w systemie / is running: ${name}. To tylko ostrzeżenie / Warning only.`);
    }
    return { clean: true, detections: [], warnings };
}
/**
 * After launch, for the real game process (pid from the instance's process.json): the only scan whose finding may
 * lead to the self-restriction. Returns null when there is nothing to report, also when the process cannot be read.
 */
async function scanRunningGameForAttachment(pid, instanceDir, log = () => { }) {
    if (!Number.isInteger(pid) || pid <= 0)
        return null;
    const commandLine = await readCommandLine(pid);
    // Only a Java process of this launcher is judged.
    if (!/java/i.test(commandLine) || !/KnotClient|fabric/i.test(commandLine))
        return null;
    const agent = findForeignJavaAgent(commandLine, [instanceDir, node_path_1.default.dirname(instanceDir)]);
    if (agent)
        return { kind: 'untrusted-java-agent', detail: agent.slice(0, 240) };
    const modules = await readModules(pid);
    if (!modules)
        return null;
    const result = await classifyModules(modules, defaultContext(instanceDir));
    for (const warning of result.warnings)
        log('[Antycheat] ' + warning);
    return result.finding ? { kind: result.finding.kind, detail: result.finding.detail.slice(0, 240) } : null;
}
/** pid of the running game as the installer wrote it. */
async function gamePid(instanceDir) {
    try {
        const data = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(instanceDir, 'process.json'), 'utf8'));
        return Number.isInteger(data.pid) && data.pid > 0 ? data.pid : null;
    }
    catch {
        return null;
    }
}
