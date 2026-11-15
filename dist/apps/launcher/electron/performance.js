"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERFORMANCE_PRESETS = void 0;
exports.applyPresetToSettings = applyPresetToSettings;
exports.configureInstancePerformance = configureInstancePerformance;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const contracts_1 = require("../../../packages/shared/src/contracts");
exports.PERFORMANCE_PRESETS = {
    'low-end': {
        id: 'low-end',
        title: 'Low End',
        summary: 'Minimalny zasięg renderowania (6 chunków), ograniczone cząsteczki, uproszczone animacje i optymalizacja kosmetyków dla słabszych układów.',
        renderDistance: 6,
        simulationDistance: 5,
        particles: 'minimal',
        animations: false,
        cosmeticsOptimization: true,
        diagnosticsOverlay: true,
        graphicsMode: 0,
        entityDistanceScaling: 0.5,
        vsync: false
    },
    'balanced': {
        id: 'balanced',
        title: 'Balanced',
        summary: 'Zbalansowana szczegółowość (12 chunków), zredukowane cząsteczki, pełne animacje i aktywna optymalizacja modeli 3D.',
        renderDistance: 12,
        simulationDistance: 8,
        particles: 'decreased',
        animations: true,
        cosmeticsOptimization: true,
        diagnosticsOverlay: false,
        graphicsMode: 1,
        entityDistanceScaling: 1.0,
        vsync: false
    },
    'performance': {
        id: 'performance',
        title: 'Performance',
        summary: 'Profil turniejowy / PvP (8 chunków), minimalne cząsteczki, szybka grafika Sodium i priorytet niskiego opóźnienia klatek.',
        renderDistance: 8,
        simulationDistance: 6,
        particles: 'minimal',
        animations: true,
        cosmeticsOptimization: true,
        diagnosticsOverlay: false,
        graphicsMode: 0,
        entityDistanceScaling: 0.75,
        vsync: false
    },
    'quality': {
        id: 'quality',
        title: 'Quality',
        summary: 'Wysoka szczegółowość świata (16 chunków), wszystkie cząsteczki i pełny zasięg renderowania kosmetyków 3D.',
        renderDistance: 16,
        simulationDistance: 12,
        particles: 'all',
        animations: true,
        cosmeticsOptimization: false,
        diagnosticsOverlay: false,
        graphicsMode: 1,
        entityDistanceScaling: 1.5,
        // Do not silently cap at the display refresh rate (e.g. 150 Hz).
        vsync: false
    }
};
function applyPresetToSettings(profile, current) {
    const preset = exports.PERFORMANCE_PRESETS[profile];
    return {
        ...current,
        performanceProfile: profile,
        renderDistance: preset.renderDistance,
        particles: preset.particles,
        animations: preset.animations,
        cosmeticsOptimization: preset.cosmeticsOptimization,
        diagnosticsOverlay: preset.diagnosticsOverlay
    };
}
/** Writes through a temporary file: the game reads these files while the launcher may still be writing them. */
async function writeAtomic(file, data) {
    const tmp = file + '.' + process.pid + '.tmp';
    try {
        await promises_1.default.writeFile(tmp, data, 'utf8');
        await promises_1.default.rename(tmp, file);
    }
    catch (e) {
        await promises_1.default.rm(tmp, { force: true }).catch(() => { });
        throw e;
    }
}
async function configureInstancePerformance(instanceRoot, settings, systemLocale) {
    const preset = exports.PERFORMANCE_PRESETS[settings.performanceProfile] || exports.PERFORMANCE_PRESETS.balanced;
    const resolvedLang = (0, contracts_1.resolveSystemLanguage)(settings.language, systemLocale);
    // Minecraft 1.8.9 (Legacy Fabric) has its own options.txt dialect: language files are pl_PL.lang / en_US.lang
    // (lower case codes only exist since 1.11) and graphicsMode, simulationDistance and entityDistanceScaling are unknown.
    const legacy = settings.version === '1.8.9';
    const exerDir = node_path_1.default.join(instanceRoot, 'config', 'exer');
    await promises_1.default.mkdir(exerDir, { recursive: true });
    await writeAtomic(node_path_1.default.join(exerDir, 'performance.json'), JSON.stringify({
        language: resolvedLang,
        languagePreference: settings.language,
        profile: settings.performanceProfile,
        maxFps: settings.maxFps,
        renderDistance: settings.renderDistance,
        particles: settings.particles,
        animations: settings.animations,
        cosmeticsOptimization: settings.cosmeticsOptimization,
        diagnosticsOverlay: settings.diagnosticsOverlay,
        // Low End switches the in-game FPS Mode on (clouds, shadows, biome blend, particles, entity distance)
        fpsBoost: settings.performanceProfile === 'low-end',
        // Exer Core reapplies its config after Minecraft reads options.txt. Keep the
        // profile's VSync value in the bridge file so the second application agrees.
        vsync: preset.vsync
    }, null, 2));
    const optionsFile = node_path_1.default.join(instanceRoot, 'options.txt');
    let lines = [];
    try {
        lines = (await promises_1.default.readFile(optionsFile, 'utf8')).split(/\r?\n/).filter(Boolean);
    }
    catch { }
    const kv = new Map();
    for (const line of lines) {
        const idx = line.indexOf(':');
        if (idx > 0)
            kv.set(line.slice(0, idx), line.slice(idx + 1));
    }
    const particleCode = settings.particles === 'minimal' ? '2' : settings.particles === 'decreased' ? '1' : '0';
    // 260 is Minecraft's “Unlimited” value; explicitly replace any stale 150 FPS cap.
    kv.set('maxFps', String(settings.maxFps));
    kv.set('renderDistance', String(settings.renderDistance));
    kv.set('particles', particleCode);
    kv.set('enableVsync', String(preset.vsync));
    if (legacy) {
        kv.set('fancyGraphics', String(preset.graphicsMode === 1));
        for (const key of ['simulationDistance', 'graphicsMode', 'entityDistanceScaling'])
            kv.delete(key);
    }
    else {
        kv.set('simulationDistance', String(preset.simulationDistance));
        kv.set('graphicsMode', String(preset.graphicsMode));
        kv.set('entityDistanceScaling', preset.entityDistanceScaling.toFixed(1));
    }
    if (settings.language !== 'auto' || !kv.has('lang')) {
        kv.set('lang', legacy ? (resolvedLang === 'pl' ? 'pl_PL' : 'en_US') : (resolvedLang === 'pl' ? 'pl_pl' : 'en_us'));
    }
    else if (legacy) {
        // an earlier launcher build wrote the lower case code, which 1.8.9 does not know
        const m = /^([a-z]{2})_([a-z]{2})$/.exec(kv.get('lang') || '');
        if (m)
            kv.set('lang', `${m[1]}_${m[2].toUpperCase()}`);
    }
    const out = Array.from(kv.entries()).map(([k, v]) => `${k}:${v}`).join('\n') + '\n';
    await writeAtomic(optionsFile, out);
}
