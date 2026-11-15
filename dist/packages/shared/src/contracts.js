"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ManifestSchema = exports.FileSchema = exports.AccountSchema = exports.SettingsSchema = exports.JavaPathSchema = exports.UpdateChannelSchema = exports.PerformanceProfileSchema = exports.LanguagePreferenceSchema = exports.PUBLISHER = exports.PRODUCT_NAME = exports.APP_ID = exports.BUILD = exports.FABRIC_LOADER = exports.MC_VERSION = exports.PROFILE = void 0;
exports.olderBuild = olderBuild;
exports.resolveSystemLanguage = resolveSystemLanguage;
const zod_1 = require("zod");
exports.PROFILE = 'exer-1.21.1';
exports.MC_VERSION = '1.21.1';
exports.FABRIC_LOADER = '0.16.14';
exports.BUILD = '0.5.99';
/** True when build a (e.g. '0.4.0') is older than build b (e.g. '0.5.99'): a signed OTA older than the launcher's own core jar must not replace it. */
function olderBuild(a, b) { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d)
        return d < 0;
} return false; }
exports.APP_ID = 'pl.exer.client';
exports.PRODUCT_NAME = 'EXER Client';
exports.PUBLISHER = 'EXER';
exports.LanguagePreferenceSchema = zod_1.z.enum(['auto', 'pl', 'en']);
function resolveSystemLanguage(preference = 'auto', systemLocale) {
    if (preference === 'pl')
        return 'pl';
    if (preference === 'en')
        return 'en';
    const raw = (systemLocale || '').trim().toLowerCase();
    if (raw.startsWith('pl'))
        return 'pl';
    if (raw.startsWith('en'))
        return 'en';
    return 'en';
}
exports.PerformanceProfileSchema = zod_1.z.enum(['low-end', 'balanced', 'performance', 'quality']);
exports.UpdateChannelSchema = zod_1.z.enum(['stable', 'dev', 'beta']);
/** A custom runtime path: Windows java.exe or Linux/macOS java executable. */
exports.JavaPathSchema = zod_1.z.string().max(1000).refine(value => {
    if (value === '') return true;
    if (process.platform === 'win32') {
        return /^(?:[a-z]:[\\/])/i.test(value) &&
            !/[\x00-\x1f"<>|?*]/.test(value) &&
            !/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value) &&
            /(?:^|[\\/])java\.exe$/i.test(value);
    }
    return value.startsWith('/') &&
        !/[\x00-\x1f"<>|?*]/.test(value) &&
        !/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value) &&
        /(?:^|[\\/])java(?:\.exe)?$/i.test(value);
}, { message: 'javaPath must be an absolute path to the java executable' });
exports.SettingsSchema = zod_1.z.object({
    language: exports.LanguagePreferenceSchema.default('auto'),
    version: zod_1.z.string().regex(/^(?:1\.8\.9|1\.21(?:\.(?:[1-9]|10|11))?|26\.(?:1(?:\.[12])?|2|3))$/).default('1.21.1'),
    ram: zod_1.z.number().int().min(2).max(32).default(4),
    javaPath: exports.JavaPathSchema.default(''),
    javaArgs: zod_1.z.array(zod_1.z.string().regex(/^-XX:(?:\+UseG1GC|MaxGCPauseMillis=\d{1,4}|G1NewSizePercent=\d{1,2}|G1ReservePercent=\d{1,2})$/)).max(8).default([]),
    width: zod_1.z.number().int().min(854).max(7680).default(1280),
    height: zod_1.z.number().int().min(480).max(4320).default(720),
    fullscreen: zod_1.z.boolean().default(false),
    gameDirectory: zod_1.z.string().max(1000).default(''),
    downloadDirectory: zod_1.z.string().max(1000).default(''),
    // Discord Rich Presence (the EXER badge next to your name on Discord): on by default since 0.5.99.
    discord: zod_1.z.boolean().default(true),
    /** Set once the presence was switched on for players who had the old default (off); they can turn it off again. */
    discordDefaultOn: zod_1.z.boolean().default(false),
    hideServer: zod_1.z.boolean().default(true),
    hardwareAcceleration: zod_1.z.boolean().default(true),
    theme: zod_1.z.enum(['orange', 'amber']).default('orange'),
    autoUpdates: zod_1.z.boolean().default(true),
    updateChannel: exports.UpdateChannelSchema.default('stable'),
    performanceProfile: exports.PerformanceProfileSchema.default('balanced'),
    /** 260 is Minecraft's “Unlimited” value. */
    maxFps: zod_1.z.number().int().min(30).max(260).default(260),
    renderDistance: zod_1.z.number().int().min(2).max(32).default(12),
    particles: zod_1.z.enum(['all', 'decreased', 'minimal']).default('decreased'),
    animations: zod_1.z.boolean().default(true),
    cosmeticsOptimization: zod_1.z.boolean().default(true),
    diagnosticsOverlay: zod_1.z.boolean().default(false),
    onboardingCompleted: zod_1.z.boolean().default(false),
    clientId: zod_1.z.string().refine(x => x === '' || /^[0-9a-f-]{36}$/i.test(x)).default(''),
    discordClientId: zod_1.z.string().regex(/^\d{0,25}$/).default(''),
    apiUrl: zod_1.z.string().refine(x => x === '' || /^https:\/\//.test(x) || /^http:\/\/127\.0\.0\.1:\d+$/.test(x)).default('')
});
exports.AccountSchema = zod_1.z.object({ id: zod_1.z.string().regex(/^[0-9a-f]{32}$/i), name: zod_1.z.string(), skin: zod_1.z.string().url().optional(), kind: zod_1.z.enum(['premium', 'offline']).optional() });
exports.FileSchema = zod_1.z.object({ url: zod_1.z.string().url().refine(s => s.startsWith('https://')), name: zod_1.z.string().min(1), path: zod_1.z.string().min(1), size: zod_1.z.number().int().nonnegative().max(1024 * 1024 * 512), sha256: zod_1.z.string().regex(/^[a-f0-9]{64}$/) });
exports.ManifestSchema = zod_1.z.object({ client: zod_1.z.literal('EXER'), channel: exports.UpdateChannelSchema.default('stable'), minecraftVersion: zod_1.z.literal(exports.MC_VERSION), clientBuild: zod_1.z.string().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/), loader: zod_1.z.literal('fabric'), notes: zod_1.z.object({ pl: zod_1.z.array(zod_1.z.string().max(200)).max(12), en: zod_1.z.array(zod_1.z.string().max(200)).max(12) }).optional(), sequence: zod_1.z.number().int().nonnegative(), files: zod_1.z.array(exports.FileSchema).max(100) });
