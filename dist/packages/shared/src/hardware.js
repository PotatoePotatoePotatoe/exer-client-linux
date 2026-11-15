"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gpuName = gpuName;
exports.isIntegrated = isIntegrated;
exports.recommendProfile = recommendProfile;
exports.adviseFromSession = adviseFromSession;
/** From the lightest to the heaviest look; Max FPS ('performance') trades detail for frames on a weak graphics chip. */
const ORDER = ['low-end', 'performance', 'balanced', 'quality'];
/** The card's name from Chromium's GL renderer string:
 * "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)" -> "NVIDIA GeForce RTX 3060". */
function gpuName(renderer) {
    const angle = /^ANGLE \([^,]*,\s*([^,]+?)(\s*\(0x[0-9a-f]+\))?(\s+Direct3D.*|\s+OpenGL.*|\s+Vulkan.*)?,/i.exec(renderer);
    return (angle ? angle[1] : renderer).trim().slice(0, 80);
}
/** Integrated graphics: Intel (but not Arc) and AMD APUs (Radeon Graphics / Vega without an RX card). */
function isIntegrated(gpu) {
    const g = gpu.toLowerCase();
    if (/nvidia|geforce|quadro|rtx|gtx/.test(g))
        return false;
    if (/intel/.test(g))
        return !/\barc\b/.test(g);
    if (/radeon|amd/.test(g))
        return !/\brx\b|radeon pro|\bxt\b/.test(g) || /radeon\(tm\) graphics|vega \d/.test(g);
    return false;
}
/** The profile for this PC and why: little memory or few cores = Słaby PC; integrated graphics = Max FPS; a strong
 * dedicated card with 16 GB and 8 cores = Jakość; the rest = Balans. */
function recommendProfile(h) {
    if (h.ram <= 6)
        return { profile: 'low-end', reason: 'ram' };
    if (h.cores <= 2)
        return { profile: 'low-end', reason: 'cores' };
    if (h.integrated)
        return { profile: h.ram <= 8 ? 'low-end' : 'performance', reason: 'integrated' };
    if (h.ram >= 16 && h.cores >= 8)
        return { profile: 'quality', reason: 'strong' };
    return { profile: 'balanced', reason: 'normal' };
}
/** After a session: below 40 FPS on average (or a 1% low under 20) one step lighter; well over 120 with a steady
 * 1% low on a light profile, one step nicer. Sessions shorter than a minute in a world say nothing. */
function adviseFromSession(s, current) {
    if (!s || s.samples < 20)
        return null;
    const i = ORDER.indexOf(current);
    if (i < 0)
        return null;
    if ((s.avg < 40 || s.low < 20) && i > 0)
        return { suggest: ORDER[i - 1], why: 'slow' };
    if (s.avg >= 120 && s.low >= 60 && i < ORDER.length - 1 && current !== 'balanced')
        return { suggest: ORDER[i + 1], why: 'fast' };
    if (s.avg >= 144 && s.low >= 90 && current === 'balanced')
        return { suggest: 'quality', why: 'fast' };
    return null;
}
