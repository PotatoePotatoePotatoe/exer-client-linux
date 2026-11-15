"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Content = void 0;
exports.makeModIconDataUri = makeModIconDataUri;
exports.compatible = compatible;
exports.optifineInfo = optifineInfo;
exports.invalidateArchiveMetaCache = invalidateArchiveMetaCache;
exports.clearAllArchiveMetaCaches = clearAllArchiveMetaCaches;
exports.getCachedModInfo = getCachedModInfo;
exports.getCachedResourcePackInfo = getCachedResourcePackInfo;
exports.getCachedShaderPackInfo = getCachedShaderPackInfo;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const semver_1 = __importDefault(require("semver"));
const electron_1 = require("electron");
const contracts_1 = require("../../../packages/shared/src/contracts");
const io_1 = require("./io");
const installer_1 = require("./installer");
const kinds = ['mods', 'resourcepacks', 'shaderpacks'];
const fixed = new Set(['fabric-api.jar', 'exer-client.jar']);
const MODRINTH = 'https://api.modrinth.com/v2';
const PROJECT_TYPE = { mods: 'mod', resourcepacks: 'resourcepack', shaderpacks: 'shader', modpacks: 'modpack' };
function makeModIconDataUri(title, color = '#ff8c24', glyph = 'cube', source = 'both') {
    const initials = title.replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || title.slice(0, 2).toUpperCase() || 'EX';
    const glyphPaths = {
        cube: '<path d="M32 13L48 22V40L32 49L16 40V22L32 13Z" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/><path d="M16 22L32 31L48 22M32 31V49" fill="none" stroke="#fff" stroke-width="2.2" stroke-opacity="0.75"/>',
        bolt: '<path d="M35 12L19 34H31L28 52L45 29H33L35 12Z" fill="#fff" fill-opacity="0.92" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>',
        prism: '<polygon points="32,13 49,45 15,45" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/><line x1="32" y1="13" x2="32" y2="45" stroke="#fff" stroke-width="2" stroke-opacity="0.65"/>',
        eye: '<path d="M14 32C19 22 25 18 32 18C39 18 45 22 50 32C45 42 39 46 32 46C25 46 19 42 14 32Z" fill="none" stroke="#fff" stroke-width="2.6"/><circle cx="32" cy="32" r="6" fill="#fff"/>',
        sliders: '<line x1="18" y1="22" x2="46" y2="22" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="27" cy="22" r="4.2" fill="#fff"/><line x1="18" y1="32" x2="46" y2="32" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="38" cy="32" r="4.2" fill="#fff"/><line x1="18" y1="42" x2="46" y2="42" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="24" cy="42" r="4.2" fill="#fff"/>',
        chip: '<rect x="20" y="20" width="24" height="24" rx="4" fill="none" stroke="#fff" stroke-width="2.6"/><rect x="26" y="26" width="12" height="12" rx="2" fill="#fff" fill-opacity="0.85"/><path d="M26 14V20M38 14V20M26 44V50M38 44V50M14 26H20M14 38H20M44 26H50M44 38H50" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
        layers: '<polygon points="32,14 48,23 32,32 16,23" fill="none" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/><polyline points="16,31 32,40 48,31" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><polyline points="16,39 32,48 48,39" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
        crystal: '<polygon points="32,12 45,25 40,48 24,48 19,25" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/><polyline points="19,25 32,31 45,25" fill="none" stroke="#fff" stroke-width="2" stroke-opacity="0.75"/><line x1="32" y1="12" x2="32" y2="48" stroke="#fff" stroke-width="2" stroke-opacity="0.65"/>',
        apple: '<path d="M32 21C26 21 20 26 20 34C20 42 26 48 32 48C38 48 44 42 44 34C44 26 38 21 32 21Z" fill="none" stroke="#fff" stroke-width="2.6"/><path d="M32 21C32 16 36 13 40 13" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>',
        compass: '<circle cx="32" cy="32" r="16" fill="none" stroke="#fff" stroke-width="2.5"/><polygon points="38,26 34,34 26,38 30,30" fill="#fff"/>',
        sword: '<path d="M44 16L24 36M20 32L28 40M17 43L24 36" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round"/><circle cx="17" cy="43" r="2.5" fill="#fff"/>',
        spark: '<path d="M32 13L36 27L50 32L36 37L32 51L28 37L14 32L28 27L32 13Z" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>',
        mic: '<rect x="26" y="15" width="12" height="20" rx="6" fill="none" stroke="#fff" stroke-width="2.5"/><path d="M21 29C21 35 26 40 32 40C38 40 43 35 43 29M32 40V48M26 48H38" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>',
        paint: '<circle cx="32" cy="32" r="16" fill="none" stroke="#fff" stroke-width="2.5"/><circle cx="26" cy="27" r="2.6" fill="#fff"/><circle cx="35" cy="25" r="2.6" fill="#fff"/><circle cx="38" cy="33" r="2.6" fill="#fff"/><circle cx="28" cy="37" r="3" fill="#fff"/>',
        sun: '<circle cx="32" cy="32" r="8" fill="none" stroke="#fff" stroke-width="2.6"/><path d="M32 14V19M32 45V50M14 32H19M45 32H50M19 19L23 23M41 41L45 45M45 19L41 23M23 41L19 45" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>'
    };
    const sourceDot = source === 'curseforge' ? '#f16436' : source === 'modrinth' ? '#1bd96a' : '#ffa32d';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.92"/><stop offset="100%" stop-color="#141822" stop-opacity="0.98"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="#141822"/><rect x="1.5" y="1.5" width="61" height="61" rx="12.5" fill="url(#g)" stroke="${color}" stroke-opacity="0.65" stroke-width="2"/>${glyphPaths[glyph] || glyphPaths.cube}<rect x="40" y="44" width="19" height="15" rx="5" fill="#0d1017" fill-opacity="0.86" stroke="${sourceDot}" stroke-width="1.2"/><text x="49.5" y="54.5" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-weight="800" font-size="8.5">${initials}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
const CURATED_CATALOG = [
    // MODS (Modrinth & CurseForge)
    { id: 'P7dR8mSH', slug: 'fabric-api', title: 'Fabric API', author: 'modmuss50', description: 'Lightweight and modular API providing common hooks and intercompatibility measures utilized by mods using the Fabric toolchain.', downloads: 282100000, color: '#d6b06f', glyph: 'cube', source: 'both', curseforgeId: 306612, category: 'library', kind: 'mods', iconUrl: 'https://cdn.modrinth.com/data/P7dR8mSH/icon.png' },
    { id: 'AANobbMI', slug: 'sodium', title: 'Sodium', author: 'jellysquid3', description: 'A high-performance rendering engine replacement for Minecraft, which greatly improves frame rates and reduces micro-stutter.', downloads: 248000000, color: '#34d399', glyph: 'bolt', source: 'both', curseforgeId: 394468, category: 'optimization', kind: 'mods', iconUrl: 'https://cdn.modrinth.com/data/AANobbMI/295862f4724dc3f78df3447ad6072b2dcd3ef0c9_96.webp' },
    { id: 'YL57xq9U', slug: 'iris', title: 'Iris Shaders', author: 'coderbot', description: 'A modern shader pack loader for Minecraft intended to be compatible with existing OptiFine shader packs.', downloads: 192400000, color: '#6366f1', glyph: 'prism', source: 'both', curseforgeId: 455508, category: 'graphics', kind: 'mods', iconUrl: 'https://cdn.modrinth.com/data/YL57xq9U/18d0e7f076d3d6ed5bedd472b853909aac5da202_96.webp' },
    { id: 'NNAgCjsB', slug: 'entityculling', title: 'Entity Culling', author: 'tr7zw', description: 'Using async path-tracing to hide Block-/Entities that are not visible to the player.', downloads: 185000000, color: '#38bdf8', glyph: 'eye', source: 'both', curseforgeId: 448233, category: 'optimization', kind: 'mods', iconUrl: 'https://cdn.modrinth.com/data/NNAgCjsB/7873452d6cede4daed12da3d7d8c193ab88b4fd6_96.webp' },
    { id: '9s6osm5g', slug: 'cloth-config', title: 'Cloth Config API', author: 'shedaniel', description: 'Configuration Library for Minecraft Mods providing in-game configuration screens.', downloads: 210500000, color: '#84cc16', glyph: 'sliders', source: 'both', curseforgeId: 348521, category: 'library', kind: 'mods', iconUrl: 'https://cdn.modrinth.com/data/9s6osm5g/ed8a2316cbb6f4fc5f510e8e13a59a85cbbbff4d_96.webp' },
    { id: 'uXXizFIs', slug: 'ferrite-core', title: 'FerriteCore', author: 'malte0811', description: 'Memory usage optimizations for Minecraft, significantly reducing RAM consumption.', downloads: 164200000, color: '#f97316', glyph: 'chip', source: 'both', curseforgeId: 459857, category: 'optimization', kind: 'mods', iconUrl: 'https://cdn.modrinth.com/data/uXXizFIs/222a126f26f8f9ae1eb339f3b767677f18bff31f_96.webp' },
    { id: 'mOgUt4GM', slug: 'modmenu', title: 'Mod Menu', author: 'Prospector', description: 'Adds a mod menu screen to view the list of installed mods and configure settings.', downloads: 153200000, color: '#a855f7', glyph: 'layers', source: 'both', curseforgeId: 308702, category: 'utility', kind: 'mods', iconUrl: 'https://cdn.modrinth.com/data/mOgUt4GM/5a20ed1450a0e1e79a1fe04e61bb4e5878bf1d20.png' },
    { id: 'gvQqBUqZ', slug: 'lithium', title: 'Lithium', author: 'jellysquid3', description: 'No-compromises game logic, mob AI, and physics optimization mod for Fabric.', downloads: 176900000, color: '#ec4899', glyph: 'crystal', source: 'both', curseforgeId: 360438, category: 'optimization', kind: 'mods', iconUrl: 'https://cdn.modrinth.com/data/gvQqBUqZ/bcc8686c13af0143adf4285d741256af824f70b7_96.webp' },
    { id: '5ZwdcRci', slug: 'immediatelyfast', title: 'ImmediatelyFast', author: 'RK_01', description: 'Speed up immediate mode rendering in Minecraft (HUD, entities, block entities, text).', downloads: 98400000, color: '#eab308', glyph: 'bolt', source: 'both', curseforgeId: 686911, category: 'optimization', kind: 'mods', iconUrl: 'https://cdn.modrinth.com/data/5ZwdcRci/e57b6b451425692ac17ad322d5e14bea686a383a_96.webp' },
    { id: 'EsAfCjCV', slug: 'appleskin', title: 'AppleSkin', author: 'squeek502', description: 'Adds food, saturation, and exhaustion HUD overlays to the default Minecraft experience.', downloads: 234600000, color: '#ef4444', glyph: 'apple', source: 'curseforge', curseforgeId: 248787, category: 'pvp', kind: 'mods', iconUrl: 'https://cdn.modrinth.com/data/EsAfCjCV/icon.png' },
    { id: '1bokaNcj', slug: 'xaeros-minimap', title: "Xaero's Minimap", author: 'xaero96', description: 'Displays a clean, customizable radar and minimap of nearby terrain, players, and waypoints.', downloads: 196400000, color: '#f97316', glyph: 'compass', source: 'curseforge', curseforgeId: 263420, category: 'pvp', kind: 'mods', iconUrl: 'https://cdn.modrinth.com/data/1bokaNcj/354080f65407e49f486fcf9c4580e82c45ae63b8_96.webp' },
    { id: 'NcUtCpym', slug: 'xaeros-world-map', title: "Xaero's World Map", author: 'xaero96', description: 'Adds a full-screen self-writing world map that integrates seamlessly with Minimap.', downloads: 174100000, color: '#ea580c', glyph: 'compass', source: 'curseforge', curseforgeId: 317780, category: 'utility', kind: 'mods', iconUrl: 'https://cdn.modrinth.com/data/NcUtCpym/354080f65407e49f486fcf9c4580e82c45ae63b8_96.webp' },
    { id: 'aC3cM3Vq', slug: 'mouse-tweaks', title: 'Mouse Tweaks', author: 'YaLTeR', description: 'Enhances inventory management by adding fast RMB/LMB dragging and scroll wheel item transfer.', downloads: 261000000, color: '#f59e0b', glyph: 'sword', source: 'curseforge', curseforgeId: 60089, category: 'pvp', kind: 'mods', iconUrl: 'https://cdn.modrinth.com/data/aC3cM3Vq/6c0eaa4e60a9c87f4766f222ff63286f09da32c0_96.webp' },
    { id: 'nvQzSEkH', slug: 'jade', title: 'Jade (HWYLA / WTHIT)', author: 'Snownee', description: 'Shows block, entity, and container inspection tooltips at the top of your HUD.', downloads: 188900000, color: '#10b981', glyph: 'eye', source: 'curseforge', curseforgeId: 324717, category: 'utility', kind: 'mods', iconUrl: 'https://cdn.modrinth.com/data/nvQzSEkH/b04217bc2b7dc524c4d12f81ff42cc1cefb9b0fc_96.webp' },
    { id: 'zV5r3pPn', slug: '3dskinlayers', title: '3D Skin Layers', author: 'tr7zw', description: 'Renders the player skin outer layer in 3D instead of a flat second texture layer.', downloads: 112300000, color: '#db2777', glyph: 'layers', source: 'curseforge', curseforgeId: 521480, category: 'graphics', kind: 'mods', iconUrl: 'https://cdn.modrinth.com/data/zV5r3pPn/ff7010d4ec0275609866c8b0f603b25e25949c08_96.webp' },
    { id: 'MPCX6s5C', slug: 'not-enough-animations', title: 'Not Enough Animations', author: 'tr7zw', description: 'Brings missing third-person animations (eating, rowboats, map holding, climbing) into Minecraft.', downloads: 104800000, color: '#8b5cf6', glyph: 'spark', source: 'curseforge', curseforgeId: 433760, category: 'graphics', kind: 'mods', iconUrl: 'https://cdn.modrinth.com/data/MPCX6s5C/b97fd5f7a893165052408b747286d6eb38d57abb_96.webp' },
    { id: '9eGKb6K1', slug: 'simple-voice-chat', title: 'Simple Voice Chat', author: 'henkelmax', description: 'Proximity voice chat mod for Minecraft Fabric with spatial audio and group channels.', downloads: 119700000, color: '#22c55e', glyph: 'mic', source: 'both', curseforgeId: 416089, category: 'utility', kind: 'mods', iconUrl: 'https://cdn.modrinth.com/data/9eGKb6K1/icon.png' },
    { id: 'w7ThoJFB', slug: 'zoomify', title: 'Zoomify', author: 'isXander', description: 'Infinitely customizable spyglass-free optical zoom with smooth transitions and scroll zoom.', downloads: 64200000, color: '#06b6d4', glyph: 'eye', source: 'modrinth', curseforgeId: 596335, category: 'pvp', kind: 'mods', iconUrl: 'https://cdn.modrinth.com/data/w7ThoJFB/e2de67a0bfb9e8aa2347982ab3ec5463f26cca31_96.webp' },
    { id: '1IjD5062', slug: 'continuity', title: 'Continuity', author: 'PepperCode1', description: 'Connected textures and emissive block rendering for Fabric + Sodium without OptiFine.', downloads: 78500000, color: '#6366f1', glyph: 'cube', source: 'modrinth', curseforgeId: 531351, category: 'graphics', kind: 'mods', iconUrl: 'https://cdn.modrinth.com/data/1IjD5062/icon.png' },
    { id: 'PtjYWJkn', slug: 'sodium-extra', title: 'Sodium Extra', author: 'FlashyReese', description: 'Extra particles, animations, FPS overlay, and detail toggles for the Sodium video settings screen.', downloads: 86900000, color: '#10b981', glyph: 'bolt', source: 'modrinth', curseforgeId: 447673, category: 'optimization', kind: 'mods', iconUrl: 'https://cdn.modrinth.com/data/PtjYWJkn/0df4fb22a11e1dcb5e83cb0aadd275b571aca7a9_96.webp' },
    { id: 'LQ3K71Q1', slug: 'dynamic-fps', title: 'Dynamic FPS', author: 'juliand665', description: 'Reduces resource usage when Minecraft is in the background, minimized, or idle.', downloads: 81400000, color: '#14b8a6', glyph: 'chip', source: 'modrinth', curseforgeId: 335493, category: 'optimization', kind: 'mods', iconUrl: 'https://cdn.modrinth.com/data/LQ3K71Q1/5056368d0d87c1a9f3efead0cb48ab39a4ea87bf_96.webp' },
    // RESOURCE PACKS (Modrinth & CurseForge)
    { id: 'w0TnApzs', slug: 'faithful-32x', title: 'Faithful 32x', author: 'Faithful_Team', description: 'Double resolution 32x32 vanilla textures keeping the classic Minecraft art style crisp and clean.', downloads: 48200000, color: '#22c55e', glyph: 'paint', source: 'curseforge', curseforgeId: 436482, category: 'graphics', kind: 'resourcepacks', iconUrl: 'https://cdn.modrinth.com/data/w0TnApzs/e8403d1fb2f55321ae74402c1e8c90a3a5670856.png' },
    { id: 'rox3U8B6', slug: 'bare-bones', title: 'Bare Bones', author: 'RobotPantaloons', description: 'Vibrant, simplified textures inspired by official Minecraft trailers — great visibility for PvP.', downloads: 36800000, color: '#f97316', glyph: 'cube', source: 'both', curseforgeId: 302226, category: 'pvp', kind: 'resourcepacks', iconUrl: 'https://cdn.modrinth.com/data/rox3U8B6/b502bd8b2a6048f635230da8e8a66eeb4383874b_96.webp' },
    { id: 'RRxvWKNC', slug: 'low-on-fire', title: 'Low On Fire (PvP)', author: 'Haizor', description: 'Lowers the first-person fire overlay so it never blocks your crosshair during PvP combat.', downloads: 19400000, color: '#ef4444', glyph: 'sword', source: 'modrinth', curseforgeId: 614520, category: 'pvp', kind: 'resourcepacks', iconUrl: 'https://cdn.modrinth.com/data/RRxvWKNC/06a7e7691a6da41798c255108a8563d7ffea171d.png' },
    { id: '6SLU7tS5', slug: 'default-dark-mode', title: 'Default Dark Mode GUI', author: 'nebuIr', description: 'Sleek dark-themed inventory, crafting, and container interfaces for Minecraft.', downloads: 27500000, color: '#6366f1', glyph: 'layers', source: 'curseforge', curseforgeId: 409152, category: 'utility', kind: 'resourcepacks', iconUrl: 'https://cdn.modrinth.com/data/6SLU7tS5/f90001e4ebed860e7ae913f34c85d745f516a89b.png' },
    { id: '50dA9Sha', slug: 'fresh-animations', title: 'Fresh Animations', author: 'FreshLX', description: 'Dynamic skeletal animations for mobs and creatures making the world feel alive.', downloads: 54900000, color: '#eab308', glyph: 'spark', source: 'both', curseforgeId: 453763, category: 'graphics', kind: 'resourcepacks', iconUrl: 'https://cdn.modrinth.com/data/50dA9Sha/3132c10e9e3c73fde9799720fd3da5561071708c_96.webp' },
    { id: 'hYykXjDp', slug: 'stay-true', title: 'Stay True', author: 'haimcyfly', description: 'Visual remaster of default textures with connected foliage, varied bricks, and natural colors.', downloads: 41200000, color: '#10b981', glyph: 'paint', source: 'curseforge', curseforgeId: 353554, category: 'graphics', kind: 'resourcepacks', iconUrl: 'https://cdn.modrinth.com/data/hYykXjDp/11f469b1bf1f201a95c2e3ddc09ca47d85c3ed53.png' },
    // SHADER PACKS (Modrinth & CurseForge)
    { id: 'HVnmMxH1', slug: 'complementary-reimagined', title: 'Complementary Reimagined', author: 'EminGT', description: 'Preserves the unique visual style of Minecraft while adding atmospheric lighting, water, and shadows.', downloads: 92600000, color: '#8b5cf6', glyph: 'sun', source: 'both', curseforgeId: 627557, category: 'graphics', kind: 'shaderpacks', iconUrl: 'https://cdn.modrinth.com/data/HVnmMxH1/79cb7c8123bbc54945305b2ebad6b8881efdf5f8_96.webp' },
    { id: 'R6NEzAwj', slug: 'complementary-unbound', title: 'Complementary Unbound', author: 'EminGT', description: 'Realistic water waves, volumetric clouds, and cinematic lighting built for Iris + Sodium.', downloads: 74800000, color: '#ec4899', glyph: 'sun', source: 'curseforge', curseforgeId: 372621, category: 'graphics', kind: 'shaderpacks', iconUrl: 'https://cdn.modrinth.com/data/R6NEzAwj/c85ce4049aac76360d2cd24fd9a7003de01ef312_96.webp' },
    { id: 'Q1vvjJYV', slug: 'bsl-shaders', title: 'BSL Shaders', author: 'Capttatsu', description: 'Warm, cinematic realtime shadows, volumetric light, ambient occlusion, and customizable bloom.', downloads: 88300000, color: '#3b82f6', glyph: 'prism', source: 'both', curseforgeId: 310606, category: 'graphics', kind: 'shaderpacks', iconUrl: 'https://cdn.modrinth.com/data/Q1vvjJYV/2a611a3cb434fb52fb81fa5dace13c5d8b67e55d_96.webp' },
    { id: 'izsIPI7a', slug: 'makeup-ultra-fast-shaders', title: 'MakeUp - Ultra Fast', author: 'XavierFST', description: 'High-FPS lightweight shader pack designed for low-end and competitive systems.', downloads: 31900000, color: '#10b981', glyph: 'bolt', source: 'modrinth', curseforgeId: 416220, category: 'optimization', kind: 'shaderpacks', iconUrl: 'https://cdn.modrinth.com/data/izsIPI7a/a08432baa86b8ffd58c08f4b3a001ef976ff764d_96.webp' },
    { id: 'LMIZZNxZ', slug: 'super-duper-vanilla-shaders', title: 'Super Duper Vanilla', author: 'Eldeston', description: 'Vibrant vanilla-plus fantasy shader pack inspired by the official Super Duper Graphics style.', downloads: 26400000, color: '#f59e0b', glyph: 'sun', source: 'curseforge', curseforgeId: 849422, category: 'graphics', kind: 'shaderpacks', iconUrl: 'https://cdn.modrinth.com/data/LMIZZNxZ/5d09a380b6da014dcbca683879cdfb4a94603cf8_96.webp' },
    { id: '5aaWibi9', slug: 'miniature-shader', title: 'Miniature Shader (High FPS)', author: 'ims212', description: 'Minimal performance impact with crisp shadows, water reflections, and dynamic sunlight.', downloads: 18700000, color: '#06b6d4', glyph: 'crystal', source: 'modrinth', curseforgeId: 891124, category: 'optimization', kind: 'shaderpacks', iconUrl: 'https://cdn.modrinth.com/data/5aaWibi9/icon.png' }
];
function compatible(version, range) {
    if (range === '*')
        return true;
    if (Array.isArray(range))
        return range.some(r => compatible(version, r));
    if (typeof range !== 'string')
        return false;
    try {
        // Fabric uses ranges such as `~26.1-`: two-part Minecraft versions and a
        // trailing dash meaning “include prereleases”. npm semver does not accept
        // that spelling, so normalize it without widening the version interval.
        const normalized = range
            .replace(/(?<![\d.])(\d+\.\d+)(?=-|(?=\s|$))/g, '$1.0')
            .replace(/(?<=\d)-(?=\s|$)/g, '-0');
        const parsedVersion = semver_1.default.valid(version, { loose: true }) || semver_1.default.coerce(version);
        const validRange = semver_1.default.validRange(normalized, { loose: true });
        if (!parsedVersion || !validRange)
            return version === range;
        return semver_1.default.satisfies(parsedVersion, validRange, { loose: true, includePrerelease: true });
    }
    catch {
        return version === range;
    }
}
/** OptiFine is not a Fabric mod: the player brings the official jar (we never host it) and OptiFabric loads it.
 * Read its version from Config.class ("OptiFine_1.8.9_HD_U_L5"); undefined for any other jar. */
function optifineInfo(zip) {
    const config = zip.getEntry('Config.class');
    if (!config || !zip.getEntry('optifine/Installer.class') || config.header.size > 1024 * 1024)
        return;
    const m = config.getData().toString('latin1').match(/OptiFine_(\d+\.\d+(?:\.\d+)?)_([A-Za-z0-9_]+)/);
    return m ? { minecraft: m[1], version: m[2] } : { minecraft: '', version: '?' };
}
function modInfo(bytes) {
    const zip = new adm_zip_1.default(bytes), entry = zip.getEntry('fabric.mod.json');
    if (!entry) {
        const optifine = optifineInfo(zip);
        // shown like a mod: it needs OptiFabric and its own Minecraft version, so the usual checks report what is missing
        if (optifine)
            return [{ id: 'optifine', name: 'OptiFine', version: optifine.version, environment: 'client', depends: { minecraft: optifine.minecraft || '?', optifabric: '*' } }];
        if (zip.getEntry('mcmod.info') || zip.getEntry('META-INF/mods.toml') || zip.getEntries().some(e => e.entryName.startsWith('net/minecraftforge/')))
            throw Error('Mod Forge nie działa w profilu Fabric / Legacy Fabric. Wyłącz ten plik i wybierz wydanie dla loadera profilu.');
        throw Error('Brak prawidłowego fabric.mod.json. Wybierz wydanie Fabric / Legacy Fabric, zgodne z profilem gry.');
    }
    if (entry.header.size > 1024 * 1024)
        throw Error('Brak prawidłowego fabric.mod.json.');
    const info = JSON.parse(entry.getData().toString());
    const all = [info];
    for (const nested of info.jars || []) {
        const nestedEntry = zip.getEntry(nested.file);
        if (nestedEntry && nestedEntry.header.size < 32 * 1024 * 1024)
            try {
                all.push(...modInfo(nestedEntry.getData()));
            }
            catch { }
    }
    return all;
}
function legacyLoaderIssue(mods, version) {
    if (version !== '1.8.9')
        return;
    const ornithe = mods.some((mod, index) => {
        const mc = mod.depends?.minecraft;
        if (index > 0 && mc !== undefined && !compatible(version, mc))
            return false;
        return Object.keys(mod.depends || {}).some(id => id === 'osl' || id.startsWith('osl-'));
    });
    if (ornithe)
        return 'Wydanie Ornithe (OSL) nie działa w profilu Legacy Fabric. Wyłącz ten plik i wybierz wydanie Legacy Fabric dla Minecraft 1.8.9.';
}
const modCache = new Map();
const resourcePackCache = new Map();
const shaderPackCache = new Map();
function pruneCache(map, max = 1000) {
    while (map.size > max) {
        const firstKey = map.keys().next().value;
        if (firstKey !== undefined)
            map.delete(firstKey);
        else
            break;
    }
}
function invalidateArchiveMetaCache(filePath) {
    modCache.delete(filePath);
    resourcePackCache.delete(filePath);
    shaderPackCache.delete(filePath);
}
function clearAllArchiveMetaCaches() {
    modCache.clear();
    resourcePackCache.clear();
    shaderPackCache.clear();
}
async function getCachedModInfo(filePath, stat) {
    const st = stat || await promises_1.default.stat(filePath);
    const cached = modCache.get(filePath);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
        if (cached.error)
            throw Error(cached.error);
        return cached.mods;
    }
    if (st.size > 256 * 1024 ** 2) {
        const err = 'Plik przekracza limit analizy 256 MB.';
        modCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, error: err });
        throw Error(err);
    }
    try {
        const bytes = await promises_1.default.readFile(filePath);
        const mods = modInfo(bytes);
        modCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, mods });
        pruneCache(modCache);
        return mods;
    }
    catch (e) {
        const err = e instanceof Error ? e.message : 'Nieprawidłowe archiwum.';
        modCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, error: err });
        throw e;
    }
}
async function getCachedResourcePackInfo(filePath, stat) {
    const st = stat || await promises_1.default.stat(filePath);
    const cached = resourcePackCache.get(filePath);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
        if (cached.error)
            throw Error(cached.error);
        return { packFormat: cached.packFormat, supportedFormats: cached.supportedFormats };
    }
    if (st.size > 256 * 1024 ** 2) {
        const err = 'Plik przekracza limit analizy 256 MB.';
        resourcePackCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, error: err });
        throw Error(err);
    }
    try {
        const bytes = await promises_1.default.readFile(filePath);
        const zip = new adm_zip_1.default(bytes);
        const entry = zip.getEntry('pack.mcmeta');
        if (!entry)
            throw Error('Brak pack.mcmeta.');
        const data = JSON.parse(entry.getData().toString());
        const packFormat = data.pack?.pack_format;
        const supportedFormats = data.pack?.supported_formats;
        resourcePackCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, packFormat, supportedFormats });
        pruneCache(resourcePackCache);
        return { packFormat, supportedFormats };
    }
    catch (e) {
        const err = e instanceof Error ? e.message : 'Nieprawidłowe archiwum.';
        resourcePackCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, error: err });
        throw e;
    }
}
async function getCachedShaderPackInfo(filePath, stat) {
    const st = stat || await promises_1.default.stat(filePath);
    const cached = shaderPackCache.get(filePath);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
        if (cached.error)
            throw Error(cached.error);
        return { hasShaders: !!cached.hasShaders, sizeKb: Math.round(st.size / 1024) };
    }
    if (st.size > 256 * 1024 ** 2) {
        const err = 'Plik przekracza limit analizy 256 MB.';
        shaderPackCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, error: err });
        throw Error(err);
    }
    try {
        const bytes = await promises_1.default.readFile(filePath);
        const zip = new adm_zip_1.default(bytes);
        const hasShaders = zip.getEntries().some(e => /^shaders\/.*\.(fsh|vsh|glsl)$/.test(e.entryName));
        shaderPackCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, hasShaders });
        pruneCache(shaderPackCache);
        return { hasShaders, sizeKb: Math.round(st.size / 1024) };
    }
    catch (e) {
        const err = e instanceof Error ? e.message : 'Nieprawidłowe archiwum.';
        shaderPackCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, error: err });
        throw e;
    }
}
function isHiddenExerJarName(name) {
    const lower = name.toLowerCase().replace(/\.disabled$/, '');
    return lower === 'exer-client.jar' || lower.startsWith('exer-client-');
}
const LOADER_PROVIDED = 'loader';
class Content {
    root;
    busy;
    version;
    constructor(root, busy, version = () => contracts_1.MC_VERSION) {
        this.root = root;
        this.busy = busy;
        this.version = version;
    }
    /** Modrinth loader of the selected version: 1.8.9 runs Legacy Fabric. */
    modLoader() { return this.version() === '1.8.9' ? 'legacy-fabric' : 'fabric'; }
    modLoaderQuery() { return encodeURIComponent(JSON.stringify([this.modLoader()])); }
    folder(kind) { if (!kinds.includes(kind))
        throw Error('Nieprawidłowy rodzaj zasobów.'); return node_path_1.default.join(this.root(), kind); }
    async sweepHiddenExerJar() {
        const modsDir = this.folder('mods');
        const coreDir = node_path_1.default.join(this.root(), '.exer-core');
        const activeRelease = node_path_1.default.join(this.root(), 'active-release.json');
        try {
            const names = await promises_1.default.readdir(modsDir);
            for (const name of names) {
                if (isHiddenExerJarName(name)) {
                    const full = (0, io_1.safePath)(modsDir, name);
                    await promises_1.default.mkdir(coreDir, { recursive: true });
                    await (0, installer_1.unhidePathOnWindows)(coreDir);
                    const hiddenTarget = node_path_1.default.join(coreDir, 'exer-client.jar');
                    await (0, installer_1.unhidePathOnWindows)(hiddenTarget);
                    await promises_1.default.rm(hiddenTarget, { force: true }).catch(() => { });
                    try {
                        await promises_1.default.copyFile(full, hiddenTarget);
                    }
                    catch {
                        const data = await promises_1.default.readFile(full);
                        await promises_1.default.writeFile(hiddenTarget, data);
                    }
                    invalidateArchiveMetaCache(full);
                    invalidateArchiveMetaCache(hiddenTarget);
                    await (0, installer_1.unhidePathOnWindows)(hiddenTarget);
                    await (0, installer_1.unhidePathOnWindows)(full);
                    await promises_1.default.rm(full, { force: true }).catch(() => { });
                }
            }
        }
        catch { }
    }
    async configMods() {
        const data = new Map([
            ['minecraft', this.version()],
            ['java', this.version().startsWith('26.') ? '25' : this.version() === '1.8.9' ? '8' : '21'],
            ['fabricloader', contracts_1.FABRIC_LOADER],
            ['exer', '0.4.0']
        ]);
        try {
            const meta = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(this.root(), 'installed.json'), 'utf8'));
            if (meta.loader !== 'vanilla')
                data.set('fabricloader', meta.loader);
        }
        catch { }
        // Fabric Loader 0.15+ bundles MixinExtras (Legacy Fabric does not); its version follows the loader, so mods that
        // depend on it count it as present without a version check (LOADER_PROVIDED).
        if (this.version() !== '1.8.9')
            data.set('mixinextras', LOADER_PROVIDED);
        try {
            for (const name of await promises_1.default.readdir(this.folder('mods'))) {
                if (!name.endsWith('.jar'))
                    continue;
                try {
                    const full = (0, io_1.safePath)(this.folder('mods'), name);
                    const st = await promises_1.default.stat(full);
                    for (const info of await getCachedModInfo(full, st)) {
                        data.set(info.id, info.version);
                    }
                }
                catch { }
            }
        }
        catch { }
        return data;
    }
    async list(kind) {
        const folder = this.folder(kind);
        await promises_1.default.mkdir(folder, { recursive: true });
        if (kind === 'mods')
            await this.sweepHiddenExerJar();
        const installed = await this.configMods();
        const names = (await promises_1.default.readdir(folder)).filter(n => /\.(jar|zip)(\.disabled)?$/.test(n));
        const result = [];
        const seen = new Map();
        for (const name of names) {
            if (kind === 'mods' && isHiddenExerJarName(name))
                continue;
            const enabled = !name.endsWith('.disabled'), issues = [];
            let details = '';
            try {
                const full = (0, io_1.safePath)(folder, name);
                const st = await promises_1.default.stat(full);
                if (kind === 'mods') {
                    const mods = await getCachedModInfo(full, st), info = mods[0];
                    if (info?.id === 'exer' || info?.id === 'exer-client' || String(info?.name || '').toLowerCase() === 'exer client') {
                        await (0, installer_1.unhidePathOnWindows)(full);
                        invalidateArchiveMetaCache(full);
                        continue;
                    }
                    details = `${info.name || info.id} · ${info.version}`;
                    const loaderIssue = legacyLoaderIssue(mods, this.version());
                    if (loaderIssue) {
                        issues.push(loaderIssue);
                    }
                    else {
                        for (const mod of mods) {
                            // multi-version jars (Legacy Fabric API: 1.3–1.12.2 in one file) carry modules for other Minecraft versions that
                            // the loader leaves out; only the top-level mod and the nested modules for this version are judged
                            const mc = (mod.depends || {}).minecraft;
                            if (mod !== mods[0] && mc !== undefined && !compatible(this.version(), mc))
                                continue;
                            if (enabled && mod === mods[0] && seen.has(mod.id))
                                issues.push('Duplikat moda: ' + mod.id);
                            if (enabled && mod === mods[0])
                                seen.set(mod.id, name);
                            for (const [id, range] of Object.entries(mod.depends || {})) {
                                if (!installed.has(id))
                                    issues.push('Brak zależności: ' + id);
                                else if (installed.get(id) !== LOADER_PROVIDED && !compatible(installed.get(id), range))
                                    issues.push('Niezgodna zależność: ' + id + ' ' + JSON.stringify(range));
                            }
                            for (const [id, range] of Object.entries(mod.breaks || {})) {
                                if (installed.has(id) && compatible(installed.get(id), range))
                                    issues.push('Konflikt z ' + id);
                            }
                            if (mod.environment === 'server')
                                issues.push('Mod przeznaczony tylko dla serwera.');
                        }
                    }
                }
                else if (kind === 'resourcepacks') {
                    const pack = await getCachedResourcePackInfo(full, st);
                    details = 'Pack format ' + pack.packFormat;
                    const formats = pack.supportedFormats;
                    const supports = typeof formats === 'number' ? formats === 34 : Array.isArray(formats) ? formats[0] <= 34 && formats[1] >= 34 : formats ? formats.min_inclusive <= 34 && formats.max_inclusive >= 34 : false;
                    if (this.version() === '1.21.1' && pack.packFormat !== 34 && !supports)
                        issues.push('Paczka nie deklaruje formatu 34 dla Minecraft 1.21.1.');
                }
                else {
                    const shaders = await getCachedShaderPackInfo(full, st);
                    if (!shaders.hasShaders)
                        issues.push('Brak rozpoznanych plików shaderów.');
                    if (!installed.has('iris'))
                        issues.push('Brak Iris — paczka nie będzie działać.');
                    details = 'Shader pack · ' + shaders.sizeKb + ' KB';
                }
            }
            catch (e) {
                issues.push(e instanceof Error ? e.message : 'Nieprawidłowe archiwum.');
            }
            result.push({ name, kind, enabled, details, issues, locked: fixed.has(name) });
        }
        return result;
    }
    check() { if (this.busy())
        throw Error('Zamknij grę i zakończ instalację przed zmianą plików.'); }
    async import(kind, win) {
        this.check();
        const result = await electron_1.dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: kind, extensions: [kind === 'mods' ? 'jar' : 'zip'] }] });
        if (result.canceled)
            return;
        await promises_1.default.mkdir(this.folder(kind), { recursive: true });
        for (const source of result.filePaths) {
            const name = node_path_1.default.basename(source);
            if (fixed.has(name) || isHiddenExerJarName(name))
                throw Error('Nie można zastąpić wymaganych plików EXER.');
            const target = (0, io_1.safePath)(this.folder(kind), name);
            if ((await promises_1.default.stat(source)).size > 256 * 1024 ** 2)
                throw Error('Plik za duży.');
            if (kind === 'mods') {
                const mods = modInfo(await promises_1.default.readFile(source));
                const issue = legacyLoaderIssue(mods, this.version());
                if (issue)
                    throw Error(issue);
            }
            else
                new adm_zip_1.default(source);
            await promises_1.default.copyFile(source, target, require('node:fs').constants.COPYFILE_EXCL);
            invalidateArchiveMetaCache(target);
            if (kind === 'resourcepacks')
                await this.resourceOption(name, true);
        }
        return this.list(kind);
    }
    async toggle(kind, name) {
        this.check();
        if (fixed.has(name) || fixed.has(name.replace(/\.disabled$/, '')))
            throw Error('To wymagany mod EXER.');
        const source = (0, io_1.safePath)(this.folder(kind), name);
        const enabled = name.endsWith('.disabled');
        const targetName = enabled ? name.slice(0, -9) : name + '.disabled';
        const target = (0, io_1.safePath)(this.folder(kind), targetName);
        try {
            await promises_1.default.access(target);
            throw Error('Plik docelowy już istnieje.');
        }
        catch (e) {
            if (e.code !== 'ENOENT')
                throw e;
        }
        await promises_1.default.rename(source, target);
        invalidateArchiveMetaCache(source);
        invalidateArchiveMetaCache(target);
        if (kind === 'resourcepacks')
            await this.resourceOption(name.replace(/\.disabled$/, ''), enabled);
        if (kind === 'shaderpacks')
            await this.shaderOption(name.replace(/\.disabled$/, ''), enabled);
        return this.list(kind);
    }
    async remove(kind, name) {
        this.check();
        if (fixed.has(name) || fixed.has(name.replace(/\.disabled$/, '')))
            throw Error('Nie można usunąć wymaganego moda.');
        const source = (0, io_1.safePath)(this.folder(kind), name);
        const trash = node_path_1.default.join(this.root(), 'trash', Date.now() + '-' + name);
        await promises_1.default.mkdir(node_path_1.default.dirname(trash), { recursive: true });
        await promises_1.default.rename(source, trash);
        invalidateArchiveMetaCache(source);
        if (kind === 'resourcepacks')
            await this.resourceOption(name.replace(/\.disabled$/, ''), false);
        if (kind === 'shaderpacks')
            await this.shaderOption(name.replace(/\.disabled$/, ''), false);
    }
    async resourceOption(name, enabled) {
        const file = node_path_1.default.join(this.root(), 'options.txt');
        let lines = [];
        try {
            lines = (await promises_1.default.readFile(file, 'utf8')).split('\n');
        }
        catch { }
        const index = lines.findIndex(l => l.startsWith('resourcePacks:'));
        let packs = [];
        try {
            packs = JSON.parse(lines[index].slice(14));
        }
        catch { }
        packs = packs.filter(p => p !== 'file/' + name);
        if (enabled)
            packs.push('file/' + name);
        const line = 'resourcePacks:' + JSON.stringify(packs);
        if (index >= 0)
            lines[index] = line;
        else
            lines.push(line);
        await promises_1.default.writeFile(file, lines.join('\n'));
    }
    async shaderOption(name, enabled) {
        const file = node_path_1.default.join(this.root(), 'config', 'iris.properties');
        await promises_1.default.mkdir(node_path_1.default.dirname(file), { recursive: true });
        let lines = [];
        try {
            lines = (await promises_1.default.readFile(file, 'utf8')).split('\n');
        }
        catch { }
        const existing = lines.find(l => l.startsWith('shaderPack='))?.slice(11);
        if (!enabled && existing !== name)
            return;
        lines = lines.filter(l => !l.startsWith('shaderPack=') && !l.startsWith('enableShaders='));
        lines.push('shaderPack=' + (enabled ? name : ''), 'enableShaders=' + enabled);
        await promises_1.default.writeFile(file, lines.join('\n'));
    }
    // Crash assistant: switch off the jars whose fabric.mod.json id is on the list (required EXER mods stay).
    async disableMods(ids) {
        this.check();
        const done = [];
        const dir = this.folder('mods');
        for (const name of await promises_1.default.readdir(dir).catch(() => [])) {
            if (!name.endsWith('.jar') || fixed.has(name) || isHiddenExerJarName(name))
                continue;
            try {
                const full = (0, io_1.safePath)(dir, name);
                const id = (await getCachedModInfo(full))[0]?.id;
                if (id && ids.includes(id)) {
                    const target = (0, io_1.safePath)(dir, name + '.disabled');
                    await promises_1.default.rename(full, target);
                    invalidateArchiveMetaCache(full);
                    invalidateArchiveMetaCache(target);
                    done.push(name);
                }
            }
            catch { }
        }
        return done;
    }
    async disableShaders() {
        const file = node_path_1.default.join(this.root(), 'config', 'iris.properties');
        await promises_1.default.mkdir(node_path_1.default.dirname(file), { recursive: true });
        let lines = [];
        try {
            lines = (await promises_1.default.readFile(file, 'utf8')).split('\n');
        }
        catch { }
        lines = lines.filter(l => !l.startsWith('enableShaders='));
        lines.push('enableShaders=false');
        await promises_1.default.writeFile(file, lines.join('\n'));
    }
    // ---- OptiFine (1.8.9): the player downloads the official jar from optifine.net and imports it here. EXER never
    // hosts or ships OptiFine (its license forbids redistribution); OptiFabric (MPL-2.0) comes from Modrinth. ----
    async optifineFiles() {
        const dir = this.folder('mods'), out = [];
        for (const name of await promises_1.default.readdir(dir).catch(() => [])) {
            if (!/\.jar(\.disabled)?$/.test(name))
                continue;
            try {
                const info = (await getCachedModInfo((0, io_1.safePath)(dir, name)))[0];
                if (info?.id === 'optifine')
                    out.push({ name, version: info.version, minecraft: info.depends?.minecraft || '', enabled: !name.endsWith('.disabled') });
            }
            catch { }
        }
        return out;
    }
    async optifabricFiles() {
        const dir = this.folder('mods'), out = [];
        for (const name of await promises_1.default.readdir(dir).catch(() => [])) {
            if (!/\.jar(\.disabled)?$/.test(name))
                continue;
            try {
                if ((await getCachedModInfo((0, io_1.safePath)(dir, name)))[0]?.id === 'optifabric')
                    out.push(name);
            }
            catch { }
        }
        return out;
    }
    async optifineStatus() {
        if (this.version() !== '1.8.9')
            return { supported: false };
        const files = await this.optifineFiles(), optifabric = await this.optifabricFiles();
        const active = files.find(f => f.enabled) || files[0];
        return { supported: true, installed: !!active, file: active?.name, version: active?.version, enabled: !!active?.enabled, optifabric: optifabric.length > 0 };
    }
    async optifineImport(win, signal) {
        this.check();
        if (this.version() !== '1.8.9')
            throw Error('OptiFine można dodać tylko w profilu 1.8.9.');
        const result = await electron_1.dialog.showOpenDialog(win, { title: 'OptiFine 1.8.9', properties: ['openFile'], filters: [{ name: 'OptiFine', extensions: ['jar'] }] });
        if (result.canceled || !result.filePaths[0])
            return this.optifineStatus();
        const source = result.filePaths[0];
        if ((await promises_1.default.stat(source)).size > 64 * 1024 ** 2)
            throw Error('Plik za duży.');
        const info = optifineInfo(new adm_zip_1.default(source));
        if (!info)
            throw Error('To nie jest plik OptiFine. Pobierz OptiFine 1.8.9 ze strony optifine.net.');
        if (info.minecraft !== '1.8.9')
            throw Error(`To OptiFine dla Minecraft ${info.minecraft || 'innej wersji'}. Pobierz wersję dla 1.8.9.`);
        // only one OptiFine at a time: earlier copies go to the instance trash
        for (const old of await this.optifineFiles())
            await this.remove('mods', old.name);
        const name = node_path_1.default.basename(source).replace(/[^\w.+-]/g, '_');
        await promises_1.default.mkdir(this.folder('mods'), { recursive: true });
        await promises_1.default.copyFile(source, (0, io_1.safePath)(this.folder('mods'), name));
        invalidateArchiveMetaCache((0, io_1.safePath)(this.folder('mods'), name));
        if (!(await this.optifabricFiles()).length)
            await this.installOptimization('legacy-optifabric', signal);
        return this.optifineStatus();
    }
    async optifineRemove() {
        this.check();
        for (const f of await this.optifineFiles())
            await this.remove('mods', f.name);
        // OptiFabric only loads OptiFine: without it, it goes too
        for (const name of await this.optifabricFiles())
            await this.remove('mods', name);
        return this.optifineStatus();
    }
    async checkLaunch() {
        const issues = (await this.list('mods')).filter(f => f.enabled && f.issues.length);
        if (issues.length)
            throw Error('Konflikty modów: ' + issues.map(f => f.name + ': ' + f.issues.join('; ')).join(' | '));
    }
    async catalog() {
        return Promise.all(['sodium', 'lithium', 'ferrite-core', 'immediatelyfast', 'entityculling', 'iris'].map(async (id) => {
            try {
                const project = await (0, io_1.getJSON)('https://api.modrinth.com/v2/project/' + id);
                const versions = await (0, io_1.getJSON)('https://api.modrinth.com/v2/project/' + id + '/version?loaders=' + this.modLoaderQuery() + '&game_versions=' + encodeURIComponent(JSON.stringify([this.version()])));
                const version = versions.find((v) => v.version_type === 'release') || versions[0];
                return { id, title: project.title, license: project.license?.id || 'Nieznana', version: version?.version_number || '', available: !!version };
            }
            catch {
                return { id, title: id, license: 'Nie udało się pobrać', version: '', available: false };
            }
        }));
    }
    async searchModrinth(query = '', sort = 'relevance', options) {
        const kind = options?.kind || 'mods';
        const sourceFilter = options?.source || 'all';
        const categoryFilter = options?.category || 'all';
        const installedMods = await this.configMods();
        const folderFiles = await promises_1.default.readdir(this.folder(kind)).catch(() => []);
        const lowerFiles = folderFiles.map(f => f.toLowerCase());
        const isInstalled = (slug) => {
            const s = slug.toLowerCase();
            if (kind === 'mods') {
                if (installedMods.has(s) || installedMods.has(s.replaceAll('-', '')) || installedMods.has(s.replaceAll('-', '_')))
                    return true;
            }
            return lowerFiles.some(f => f.includes(s) || f.includes(s.replaceAll('-', '')));
        };
        const q = query.trim();
        const lowerQ = q.toLowerCase();
        // Map curated entries for this kind
        const curatedForKind = CURATED_CATALOG.filter(item => {
            if (item.kind !== kind)
                return false;
            if (sourceFilter === 'modrinth' && item.source === 'curseforge')
                return false;
            if (sourceFilter === 'curseforge' && item.source === 'modrinth')
                return false;
            if (categoryFilter !== 'all' && item.category !== categoryFilter)
                return false;
            if (lowerQ && !item.title.toLowerCase().includes(lowerQ) && !item.slug.toLowerCase().includes(lowerQ) && !item.description.toLowerCase().includes(lowerQ) && !item.author.toLowerCase().includes(lowerQ))
                return false;
            return true;
        });
        const liveIconBySlug = new Map();
        const extraLiveHits = [];
        try {
            const projectType = kind === 'resourcepacks' ? 'resourcepack' : kind === 'shaderpacks' ? 'shader' : 'mod';
            const facetGroups = [[`project_type:${projectType}`]];
            if (kind === 'mods')
                facetGroups.push(['categories:' + this.modLoader()]);
            const ver = this.version();
            if (!ver.startsWith('26.'))
                facetGroups.push([`versions:${ver}`]);
            const facets = encodeURIComponent(JSON.stringify(facetGroups));
            const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(q)}&facets=${facets}&index=${encodeURIComponent(sort)}&limit=24`;
            const res = await (0, io_1.getJSON)(url);
            if (Array.isArray(res?.hits)) {
                for (const h of res.hits) {
                    const slug = String(h.slug || h.project_id || '').toLowerCase();
                    const icon = typeof h.icon_url === 'string' && h.icon_url.startsWith('https://') ? h.icon_url : undefined;
                    if (slug && icon)
                        liveIconBySlug.set(slug, icon);
                    const inCurated = CURATED_CATALOG.some(c => c.kind === kind && (c.slug.toLowerCase() === slug || c.id === h.project_id));
                    if (!inCurated && sourceFilter !== 'curseforge' && categoryFilter === 'all') {
                        const title = String(h.title || h.slug || 'Mod');
                        const fallbackIconUrl = makeModIconDataUri(title, '#3b82f6', kind === 'shaderpacks' ? 'sun' : kind === 'resourcepacks' ? 'paint' : 'cube', 'modrinth');
                        extraLiveHits.push({
                            id: String(h.project_id || h.slug),
                            slug: String(h.slug || h.project_id),
                            title,
                            author: String(h.author || 'Modrinth'),
                            description: String(h.description || ''),
                            downloads: Number(h.downloads || 0),
                            color: '#3b82f6',
                            iconUrl: icon || fallbackIconUrl,
                            fallbackIconUrl,
                            source: 'modrinth',
                            category: 'utility',
                            kind,
                            installed: isInstalled(slug),
                            available: true
                        });
                    }
                }
            }
        }
        catch { }
        const mappedCurated = curatedForKind.map(m => {
            const fallbackIconUrl = makeModIconDataUri(m.title, m.color, m.glyph, m.source);
            const liveIcon = liveIconBySlug.get(m.slug.toLowerCase());
            return {
                id: m.id,
                slug: m.slug,
                title: m.title,
                author: m.author,
                description: m.description,
                downloads: m.downloads,
                color: m.color,
                iconUrl: liveIcon || m.iconUrl || fallbackIconUrl,
                fallbackIconUrl,
                source: m.source,
                curseforgeId: m.curseforgeId,
                category: m.category,
                kind: m.kind,
                installed: isInstalled(m.slug),
                available: true
            };
        });
        const combined = [...mappedCurated, ...extraLiveHits];
        if (sort === 'downloads') {
            combined.sort((a, b) => Number(b.downloads || 0) - Number(a.downloads || 0));
        }
        return combined.slice(0, 24);
    }
    async installOptimization(input, signal) {
        this.check();
        const id = typeof input === 'string' ? input : input.slug;
        if (!/^[a-zA-Z0-9_-]{2,64}$/.test(id))
            throw Error('Nieprawidłowy identyfikator zasobu.');
        const curated = CURATED_CATALOG.find(c => c.slug === id || c.id === id);
        const kind = (typeof input === 'object' && input?.kind) || curated?.kind || 'mods';
        const lookupId = curated?.id || id;
        if (kind === 'resourcepacks' || kind === 'shaderpacks') {
            await this.installPackFromCatalog(lookupId, id, kind, signal);
            return;
        }
        let versions = [];
        try {
            versions = await (0, io_1.getJSON)(`https://api.modrinth.com/v2/project/${encodeURIComponent(lookupId)}/version?loaders=${this.modLoaderQuery()}&game_versions=${encodeURIComponent(JSON.stringify([this.version()]))}`, signal);
        }
        catch { }
        // only files made for this Minecraft version: a newer version's jar would not load (or would crash) here
        const version = Array.isArray(versions) ? (versions.find((v) => v.version_type === 'release') || versions[0]) : null;
        if (!version)
            throw Error('Ten mod nie ma wydania dla Minecraft ' + this.version() + '.');
        await this.installModrinth(version, new Set(), signal);
    }
    async installPackFromCatalog(projectId, slug, kind, signal) {
        await promises_1.default.mkdir(this.folder(kind), { recursive: true });
        let versions = [];
        try {
            versions = await (0, io_1.getJSON)(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version?game_versions=${encodeURIComponent(JSON.stringify([this.version()]))}`, signal);
        }
        catch { }
        if (!Array.isArray(versions) || versions.length === 0) {
            try {
                versions = await (0, io_1.getJSON)(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version`, signal);
            }
            catch { }
        }
        const version = Array.isArray(versions) ? (versions.find((v) => v.version_type === 'release') || versions[0]) : null;
        const file = version?.files?.find((f) => f.primary) || version?.files?.[0];
        if (file?.hashes?.sha512 && new URL(file.url).hostname === 'cdn.modrinth.com') {
            const destination = (0, io_1.safePath)(this.folder(kind), file.filename);
            await (0, io_1.download)(file.url, destination, { hash: file.hashes.sha512, algorithm: 'sha512', size: file.size, signal });
            if (kind === 'resourcepacks')
                await this.resourceOption(file.filename, true);
            if (kind === 'shaderpacks')
                await this.shaderOption(file.filename, true);
            return;
        }
        throw Error('Nie udało się pobrać paczki z Modrinth. Sprawdź połączenie i spróbuj ponownie.');
    }
    async installModrinth(version, seen, signal) {
        if (seen.has(version.id))
            return;
        seen.add(version.id);
        if (!version.loaders?.includes(this.modLoader()))
            throw Error('Niezgodny loader moda.');
        for (const dep of version.dependencies || []) {
            if (dep.dependency_type === 'incompatible')
                throw Error('Wydanie deklaruje konflikt; wymagana ręczna weryfikacja ' + dep.project_id);
            if (dep.dependency_type !== 'required')
                continue;
            // Fabric API is installed and version-pinned by EXER's Minecraft profile.
            // Do not let a catalog mod pull in a second, potentially stale Fabric API jar.
            if (['p7dr8msh', 'fabric-api'].includes(String(dep.project_id || '').toLowerCase()))
                continue;
            let v = null;
            try {
                // a pinned version is used only when it is made for this Minecraft version and loader; otherwise (an old pin such
                // as Legacy Fabric API 0.4.3) the newest release of that project for this version is installed instead
                const pinned = dep.version_id ? await (0, io_1.getJSON)('https://api.modrinth.com/v2/version/' + dep.version_id, signal) : null;
                const project = dep.project_id || pinned?.project_id;
                if (pinned && pinned.loaders?.includes(this.modLoader()) && pinned.game_versions?.includes(this.version()))
                    v = pinned;
                else if (project) {
                    const list = await (0, io_1.getJSON)(`https://api.modrinth.com/v2/project/${project}/version?loaders=${this.modLoaderQuery()}&game_versions=${encodeURIComponent(JSON.stringify([this.version()]))}`, signal);
                    v = list.find((x) => x.version_type === 'release') || list[0] || null;
                }
            }
            catch { }
            if (v)
                await this.installModrinth(v, seen, signal);
        }
        const file = version.files.find((f) => f.primary) || version.files[0];
        if (!file?.hashes?.sha512 || new URL(file.url).hostname !== 'cdn.modrinth.com')
            throw Error('Nieprawidłowe źródło moda.');
        await promises_1.default.mkdir(this.folder('mods'), { recursive: true });
        const destination = (0, io_1.safePath)(this.folder('mods'), file.filename);
        await (0, io_1.download)(file.url, destination, { hash: file.hashes.sha512, algorithm: 'sha512', size: file.size, signal });
        invalidateArchiveMetaCache(destination);
        const info = (await getCachedModInfo(destination))[0];
        for (const existing of await promises_1.default.readdir(this.folder('mods'))) {
            if (existing === file.filename || !existing.endsWith('.jar') || fixed.has(existing))
                continue;
            try {
                const existingPath = (0, io_1.safePath)(this.folder('mods'), existing);
                if ((await getCachedModInfo(existingPath))[0].id === info.id) {
                    const targetPath = (0, io_1.safePath)(this.folder('mods'), existing + '.disabled');
                    await promises_1.default.rename(existingPath, targetPath);
                    invalidateArchiveMetaCache(existingPath);
                    invalidateArchiveMetaCache(targetPath);
                }
            }
            catch { }
        }
    }
    // Whether a catalog entry is already in the instance (mod id from fabric.mod.json, or a matching file name).
    async installedChecker(kind) {
        const installedMods = kind === 'mods' ? await this.configMods() : new Map();
        const lowerFiles = (await promises_1.default.readdir(this.folder(kind)).catch(() => [])).map(f => f.toLowerCase());
        return (slug) => {
            const s = slug.toLowerCase();
            if (kind === 'mods' && (installedMods.has(s) || installedMods.has(s.replaceAll('-', '')) || installedMods.has(s.replaceAll('-', '_'))))
                return true;
            return lowerFiles.some(f => f.includes(s) || f.includes(s.replaceAll('-', '')));
        };
    }
    // One page of the Modrinth catalog with the real total. Falls back to the curated list when offline.
    async searchPage(o) {
        const isInstalled = o.kind === 'modpacks' ? () => false : await this.installedChecker(o.kind);
        const curated = () => {
            if (o.kind === 'modpacks')
                return [];
            const q = o.query.trim().toLowerCase();
            return CURATED_CATALOG.filter(c => c.kind === o.kind && (!q || [c.title, c.slug, c.description, c.author].some(x => x.toLowerCase().includes(q)))).map(m => {
                const fallbackIconUrl = makeModIconDataUri(m.title, m.color, m.glyph, m.source);
                return { id: m.id, slug: m.slug, title: m.title, author: m.author, description: m.description, downloads: m.downloads, color: m.color, iconUrl: m.iconUrl || fallbackIconUrl, fallbackIconUrl, source: m.source, curseforgeId: m.curseforgeId, category: m.category, kind: m.kind, installed: isInstalled(m.slug), available: true };
            });
        };
        // CurseForge has no public search without an API key: show the curated entries that are also there.
        if (o.source === 'curseforge') {
            const items = curated().filter(c => c.source !== 'modrinth');
            return { items: items.slice(o.offset, o.offset + o.limit), total: items.length, offset: o.offset, limited: true };
        }
        const facets = [[`project_type:${PROJECT_TYPE[o.kind]}`]];
        if (o.kind === 'mods' || o.kind === 'modpacks')
            facets.push(['categories:' + this.modLoader()]);
        const ver = this.version();
        if (o.kind === 'modpacks')
            facets.push(o.versions.filter(v => !v.startsWith('26.')).map(v => `versions:${v}`));
        else if (!ver.startsWith('26.'))
            facets.push([`versions:${ver}`]);
        if (o.category !== 'all')
            facets.push([`categories:${o.category}`]);
        if (o.environment === 'client')
            facets.push(['client_side:required', 'client_side:optional']);
        if (o.environment === 'server')
            facets.push(['server_side:required', 'server_side:optional']);
        if (o.openSource)
            facets.push(['open_source:true']);
        const index = o.sort === 'follows' ? 'follows' : o.sort;
        try {
            const res = await (0, io_1.getJSON)(`${MODRINTH}/search?query=${encodeURIComponent(o.query.trim())}&facets=${encodeURIComponent(JSON.stringify(facets))}&index=${index}&offset=${o.offset}&limit=${o.limit}`);
            const items = (Array.isArray(res?.hits) ? res.hits : []).map((h) => {
                const title = String(h.title || h.slug || '?');
                const fallbackIconUrl = makeModIconDataUri(title, '#3b82f6', o.kind === 'shaderpacks' ? 'sun' : o.kind === 'resourcepacks' ? 'paint' : 'cube', 'modrinth');
                const icon = typeof h.icon_url === 'string' && h.icon_url.startsWith('https://') ? h.icon_url : undefined;
                return {
                    id: String(h.project_id || h.slug), slug: String(h.slug || h.project_id), title, author: String(h.author || 'Modrinth'), description: String(h.description || ''),
                    downloads: Number(h.downloads || 0), follows: Number(h.follows || 0), updated: typeof h.date_modified === 'string' ? h.date_modified : undefined, license: typeof h.license === 'string' ? h.license : undefined,
                    color: '#3b82f6', iconUrl: icon || fallbackIconUrl, fallbackIconUrl, source: 'modrinth', category: Array.isArray(h.categories) ? String(h.categories[0] || '') : '',
                    kind: o.kind, installed: isInstalled(String(h.slug || '')), available: true
                };
            });
            return { items, total: Number(res?.total_hits || items.length), offset: o.offset };
        }
        catch {
            const items = curated();
            return { items: items.slice(o.offset, o.offset + o.limit), total: items.length, offset: o.offset, offline: true };
        }
    }
    // Everything the details window shows about one project: description, gallery, versions for this game version, dependencies.
    async project(id, kind, versions) {
        if (!/^[a-zA-Z0-9_-]{2,64}$/.test(id))
            throw Error('Nieprawidłowy identyfikator zasobu.');
        const p = await (0, io_1.getJSON)(`${MODRINTH}/project/${encodeURIComponent(id)}`);
        const ver = this.version();
        const loaders = kind === 'mods' || kind === 'modpacks' ? `loaders=${this.modLoaderQuery()}&` : '';
        const gameVersions = kind === 'modpacks' ? versions : [ver];
        let list = [];
        try {
            list = await (0, io_1.getJSON)(`${MODRINTH}/project/${encodeURIComponent(id)}/version?${loaders}game_versions=${encodeURIComponent(JSON.stringify(gameVersions))}`);
        }
        catch { }
        const latest = list.find(v => v.version_type === 'release') || list[0];
        const depIds = [...new Set((latest?.dependencies || []).filter((d) => d.dependency_type === 'required' && d.project_id).map((d) => String(d.project_id)))].slice(0, 20);
        let deps = [];
        if (depIds.length) {
            try {
                deps = await (0, io_1.getJSON)(`${MODRINTH}/projects?ids=${encodeURIComponent(JSON.stringify(depIds))}`);
            }
            catch { }
        }
        const https = (u) => typeof u === 'string' && u.startsWith('https://') ? u : undefined;
        const installed = kind === 'modpacks' ? false : (await this.installedChecker(kind))(String(p.slug || ''));
        return {
            id: String(p.id), slug: String(p.slug), title: String(p.title || p.slug), description: String(p.description || ''),
            body: String(p.body || '').slice(0, 12000), icon: https(p.icon_url),
            gallery: (Array.isArray(p.gallery) ? p.gallery : []).map((g) => ({ url: https(g.url), title: typeof g.title === 'string' ? g.title : '' })).filter((g) => g.url && new URL(g.url).hostname.endsWith('modrinth.com')).slice(0, 6),
            license: String(p.license?.id || ''), downloads: Number(p.downloads || 0), followers: Number(p.followers || 0), updated: String(p.updated || ''), published: String(p.published || ''),
            categories: Array.isArray(p.categories) ? p.categories.map(String).slice(0, 8) : [], clientSide: String(p.client_side || ''), serverSide: String(p.server_side || ''),
            versions: list.slice(0, 6).map(v => ({ id: String(v.id), number: String(v.version_number || ''), type: String(v.version_type || ''), date: String(v.date_published || ''), gameVersions: (v.game_versions || []).slice(-3).map(String) })),
            dependencies: (Array.isArray(deps) ? deps : []).map((d) => ({ id: String(d.id), slug: String(d.slug), title: String(d.title || d.slug), icon: https(d.icon_url) })),
            compatible: list.length > 0, installed, kind
        };
    }
    // Installed mods / packs that have a newer Modrinth release for this game version (matched by file hash).
    async updates(kind) {
        const folder = this.folder(kind);
        const names = (await promises_1.default.readdir(folder).catch(() => [])).filter(n => /\.(jar|zip)$/.test(n) && !fixed.has(n) && !(kind === 'mods' && isHiddenExerJarName(n)));
        if (!names.length)
            return [];
        const byHash = new Map();
        for (const name of names)
            byHash.set(await (0, io_1.hashFile)(node_path_1.default.join(folder, name), 'sha1'), name);
        const hashes = [...byHash.keys()];
        const current = await (0, io_1.postJSON)(`${MODRINTH}/version_files`, { hashes, algorithm: 'sha1' });
        const body = { hashes, algorithm: 'sha1', game_versions: [this.version()] };
        if (kind === 'mods')
            body.loaders = [this.modLoader()];
        const latest = await (0, io_1.postJSON)(`${MODRINTH}/version_files/update`, body);
        const found = [];
        for (const [hash, name] of byHash) {
            const now = current?.[hash], next = latest?.[hash];
            if (now && next && now.id !== next.id && Date.parse(next.date_published) > Date.parse(now.date_published))
                found.push({ name, projectId: String(now.project_id), title: name, from: String(now.version_number), to: String(next.version_number), versionId: String(next.id) });
        }
        if (found.length) {
            try {
                const projects = await (0, io_1.getJSON)(`${MODRINTH}/projects?ids=${encodeURIComponent(JSON.stringify([...new Set(found.map(f => f.projectId))]))}`);
                for (const f of found)
                    f.title = String(projects.find((p) => p.id === f.projectId)?.title || f.name);
            }
            catch { }
        }
        return found;
    }
    // Replaces the chosen files with their newer releases; the old file goes to trash only after the new one is in place.
    async applyUpdates(kind, names, signal) {
        this.check();
        const available = await this.updates(kind);
        let done = 0;
        for (const u of available.filter(a => names.includes(a.name))) {
            const version = await (0, io_1.getJSON)(`${MODRINTH}/version/${encodeURIComponent(u.versionId)}`, signal);
            const oldPath = (0, io_1.safePath)(this.folder(kind), u.name);
            const trash = node_path_1.default.join(this.root(), 'trash', Date.now() + '-' + u.name);
            await promises_1.default.mkdir(node_path_1.default.dirname(trash), { recursive: true });
            await promises_1.default.rename(oldPath, trash);
            invalidateArchiveMetaCache(oldPath);
            try {
                if (kind === 'mods')
                    await this.installModrinth(version, new Set(), signal);
                else {
                    const file = version.files.find((f) => f.primary) || version.files[0];
                    if (!file?.hashes?.sha512 || new URL(file.url).hostname !== 'cdn.modrinth.com')
                        throw Error('Nieprawidłowe źródło pliku.');
                    await (0, io_1.download)(file.url, (0, io_1.safePath)(this.folder(kind), file.filename), { hash: file.hashes.sha512, algorithm: 'sha512', size: file.size, signal });
                    if (kind === 'resourcepacks') {
                        await this.resourceOption(u.name, false);
                        await this.resourceOption(file.filename, true);
                    }
                    if (kind === 'shaderpacks')
                        await this.shaderOption(file.filename, true);
                }
                done++;
            }
            catch (e) {
                await promises_1.default.rename(trash, oldPath).catch(() => { });
                throw e;
            }
        }
        return { updated: done, files: await this.list(kind) };
    }
    // Modpack (.mrpack) plan: the newest Fabric release for a game version EXER supports.
    async modpackPlan(id, supported, preferred) {
        if (!/^[a-zA-Z0-9_-]{2,64}$/.test(id))
            throw Error('Nieprawidłowy identyfikator paczki.');
        const project = await (0, io_1.getJSON)(`${MODRINTH}/project/${encodeURIComponent(id)}`);
        const list = await (0, io_1.getJSON)(`${MODRINTH}/project/${encodeURIComponent(id)}/version?loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent(JSON.stringify(supported))}`);
        // Prefer the version the player is on; otherwise the newest release EXER supports.
        const forPreferred = list.filter(v => (v.game_versions || []).includes(preferred));
        const pool = forPreferred.length ? forPreferred : list;
        const version = pool.find(v => v.version_type === 'release') || pool[0];
        if (!version)
            throw Error('Ta paczka nie ma wydania Fabric dla wersji obsługiwanych przez EXER.');
        const mc = forPreferred.length ? preferred : version.game_versions.find(v => supported.includes(v));
        if (!mc)
            throw Error('Ta paczka nie ma wydania Fabric dla wersji obsługiwanych przez EXER.');
        return { id: String(project.id), slug: String(project.slug), title: String(project.title), versionId: String(version.id), versionNumber: String(version.version_number), mcVersion: mc };
    }
    // Installs a modpack into the current instance. Mods and config are copied to backups/ first and can be restored.
    async installModpack(plan, signal, progress, localPack) {
        this.check();
        const root = this.root();
        const zip = localPack ?? await this.downloadModpack(plan.versionId, root, signal, progress);
        const index = JSON.parse(zip.getEntry('modrinth.index.json')?.getData().toString('utf8') || '{}');
        if (index.game !== 'minecraft' || index.dependencies?.minecraft !== plan.mcVersion || !index.dependencies?.['fabric-loader'])
            throw Error('Paczka nie jest paczką Fabric dla Minecraft ' + plan.mcVersion + '.');
        // Backup: copy mods and config as they are now.
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backup = node_path_1.default.join(root, 'backups', `${stamp}-przed-${plan.slug}`);
        for (const dir of ['mods', 'config']) {
            await promises_1.default.mkdir(node_path_1.default.join(backup, dir), { recursive: true });
            await promises_1.default.cp(node_path_1.default.join(root, dir), node_path_1.default.join(backup, dir), { recursive: true }).catch(() => { });
        }
        const files = (Array.isArray(index.files) ? index.files : []).filter((f) => f?.env?.client !== 'unsupported');
        const skipped = [];
        let done = 0;
        for (const f of files) {
            signal?.throwIfAborted();
            progress?.('Pobieranie modów z paczki…', done, files.length);
            const url = (f.downloads || []).find((u) => { try {
                return new URL(u).hostname === 'cdn.modrinth.com';
            }
            catch {
                return false;
            } });
            const rel = String(f.path || '');
            const dir = rel.split('/')[0];
            if (!url || !f.hashes?.sha512 || !['mods', 'resourcepacks', 'shaderpacks'].includes(dir)) {
                skipped.push(rel);
                done++;
                continue;
            }
            const name = node_path_1.default.basename(rel);
            if (fixed.has(name)) {
                done++;
                continue;
            }
            const dest = (0, io_1.safePath)(root, rel);
            await (0, io_1.download)(url, dest, { hash: f.hashes.sha512, algorithm: 'sha512', size: f.fileSize, signal });
            if (dir === 'mods')
                await this.disableDuplicates(name);
            done++;
        }
        // Overrides: only config, resource packs and shader packs; nothing that runs code outside mods.
        let overrides = 0;
        for (const entry of zip.getEntries()) {
            const m = /^(?:client-)?overrides\/((?:config|resourcepacks|shaderpacks)\/.+)$/.exec(entry.entryName);
            if (!m || entry.isDirectory)
                continue;
            const dest = (0, io_1.safePath)(root, m[1]);
            await promises_1.default.mkdir(node_path_1.default.dirname(dest), { recursive: true });
            await promises_1.default.writeFile(dest, entry.getData());
            overrides++;
        }
        const info = { id: plan.id, slug: plan.slug, title: plan.title, version: plan.versionNumber, mcVersion: plan.mcVersion, installedAt: new Date().toISOString(), backup: node_path_1.default.relative(root, backup), mods: files.length - skipped.length, skipped };
        await promises_1.default.writeFile(node_path_1.default.join(root, 'modpack.json'), JSON.stringify(info, null, 2));
        progress?.('Gotowe', files.length, files.length);
        return { ...info, overrides };
    }
    async downloadModpack(versionId, root, signal, progress) {
        const version = await (0, io_1.getJSON)(`${MODRINTH}/version/${encodeURIComponent(versionId)}`, signal);
        const pack = (version.files || []).find((f) => f.primary && /\.mrpack$/.test(f.filename)) || (version.files || []).find((f) => /\.mrpack$/.test(f.filename));
        if (!pack?.hashes?.sha512 || new URL(pack.url).hostname !== 'cdn.modrinth.com')
            throw Error('Paczka nie ma pliku .mrpack z Modrinth.');
        const packFile = node_path_1.default.join(root, '.exer-cache', 'modpacks', pack.filename.replace(/[^a-zA-Z0-9._-]/g, '_'));
        progress?.('Pobieranie paczki modów…', 0, 1);
        await (0, io_1.download)(pack.url, packFile, { hash: pack.hashes.sha512, algorithm: 'sha512', size: pack.size, signal });
        return new adm_zip_1.default(packFile);
    }
    async modpackInfo() {
        try {
            return JSON.parse(await promises_1.default.readFile(node_path_1.default.join(this.root(), 'modpack.json'), 'utf8'));
        }
        catch {
            return null;
        }
    }
    // Puts back the mods and config from before the modpack; the modpack's files go to trash.
    async restoreModpack() {
        this.check();
        const root = this.root();
        const info = await this.modpackInfo();
        if (!info?.backup)
            throw Error('Brak zainstalowanej paczki modów.');
        const backup = (0, io_1.safePath)(root, String(info.backup).replaceAll('\\', '/'));
        await promises_1.default.access(node_path_1.default.join(backup, 'mods'));
        const trash = node_path_1.default.join(root, 'trash', Date.now() + '-modpack-' + info.slug);
        await promises_1.default.mkdir(trash, { recursive: true });
        for (const dir of ['mods', 'config']) {
            await promises_1.default.rename(node_path_1.default.join(root, dir), node_path_1.default.join(trash, dir)).catch(() => { });
            await promises_1.default.cp(node_path_1.default.join(backup, dir), node_path_1.default.join(root, dir), { recursive: true }).catch(() => { });
        }
        await promises_1.default.rm(node_path_1.default.join(root, 'modpack.json'), { force: true });
        return { restored: true };
    }
    // After a new jar lands in mods/, older jars with the same mod id are switched off.
    async disableDuplicates(newName) {
        const dir = this.folder('mods');
        let id = '';
        try {
            id = (await getCachedModInfo((0, io_1.safePath)(dir, newName)))[0]?.id || '';
        }
        catch {
            return;
        }
        if (!id)
            return;
        for (const existing of await promises_1.default.readdir(dir)) {
            if (existing === newName || !existing.endsWith('.jar') || fixed.has(existing))
                continue;
            try {
                const existingPath = (0, io_1.safePath)(dir, existing);
                if ((await getCachedModInfo(existingPath))[0]?.id === id) {
                    const targetPath = (0, io_1.safePath)(dir, existing + '.disabled');
                    await promises_1.default.rename(existingPath, targetPath);
                    invalidateArchiveMetaCache(existingPath);
                    invalidateArchiveMetaCache(targetPath);
                }
            }
            catch { }
        }
    }
}
exports.Content = Content;
