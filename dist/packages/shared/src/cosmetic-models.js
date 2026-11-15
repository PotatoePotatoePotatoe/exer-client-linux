"use strict";
// Shared 3D Cosmetic Rig & Blockbench-compatible Cuboid Specification (EXER Cosmetics 2.0)
// Used by both the Electron Launcher 3D Wardrobe (Three.js / skinview3d) and Minecraft EXER Core.
Object.defineProperty(exports, "__esModule", { value: true });
exports.COSMETIC_RIGS = void 0;
exports.COSMETIC_RIGS = {
    wings: {
        id: 'amethyst-wings-2.0',
        model: 'wings',
        attachTo: 'body',
        formatVersion: '1.12.0',
        bones: [
            {
                name: 'wingCore',
                pivot: [0, 2.5, 2.4],
                cuboids: [
                    // Dorsal armored spine mount
                    { origin: [-2.2, 1.0, 2.0], size: [4.4, 5.2, 1.2], layer: 'dark' },
                    { origin: [-1.4, 1.6, 2.8], size: [2.8, 4.0, 1.1], layer: 'primary' },
                    // Central glowing amethyst core crystal
                    { origin: [-0.8, 0.4, 3.3], size: [1.6, 6.2, 1.2], layer: 'emissive' },
                    // Left & right shoulder crystal pauldrons
                    { origin: [-3.8, 1.4, 2.2], size: [1.8, 2.6, 1.4], layer: 'accent' },
                    { origin: [2.0, 1.4, 2.2], size: [1.8, 2.6, 1.4], layer: 'accent' }
                ]
            },
            {
                name: 'wingLeftInner',
                pivot: [-2.0, 2.2, 2.8],
                cuboids: [
                    // Main inner skeletal arch spar
                    { origin: [-9.5, -0.8, 2.8], size: [7.8, 2.0, 1.3], rotation: [0, 0, 14], layer: 'dark' },
                    { origin: [-9.2, -1.6, 3.0], size: [7.2, 1.2, 1.5], rotation: [0, 0, 14], layer: 'accent' },
                    // Dorsal crystal spikes along inner arch
                    { origin: [-5.5, -2.8, 3.1], size: [1.4, 2.4, 1.1], rotation: [0, 0, -18], layer: 'emissive' },
                    { origin: [-8.2, -3.6, 3.2], size: [1.5, 2.8, 1.1], rotation: [0, 0, -22], layer: 'emissive' },
                    // Inner primary crystal feathers (4 layered faceted blades)
                    { origin: [-4.8, 0.8, 3.0], size: [1.7, 7.5, 0.9], rotation: [0, 0, 8], layer: 'primary' },
                    { origin: [-6.5, 0.2, 3.1], size: [1.8, 9.2, 0.9], rotation: [0, 0, 12], layer: 'emissive' },
                    { origin: [-8.3, -0.4, 3.2], size: [1.8, 10.6, 1.0], rotation: [0, 0, 16], layer: 'primary' },
                    { origin: [-10.0, -1.0, 3.3], size: [1.9, 11.8, 1.0], rotation: [0, 0, 20], layer: 'accent' }
                ]
            },
            {
                name: 'wingLeftOuter',
                pivot: [-9.5, -0.5, 3.3],
                cuboids: [
                    // Outer wing spar sweeping upward and outward
                    { origin: [-18.5, -3.2, 3.2], size: [9.4, 1.8, 1.2], rotation: [0, 0, -12], layer: 'dark' },
                    { origin: [-19.2, -4.0, 3.3], size: [8.8, 1.1, 1.3], rotation: [0, 0, -12], layer: 'emissive' },
                    // Apex claw crystal at wing bend
                    { origin: [-11.2, -5.2, 3.3], size: [1.6, 3.2, 1.2], rotation: [0, 0, 24], layer: 'gem' },
                    // 5 long outer crystal flight pinions fanning out
                    { origin: [-12.0, -1.4, 3.4], size: [2.0, 13.2, 1.0], rotation: [0, 0, 18], layer: 'emissive' },
                    { origin: [-14.0, -2.0, 3.5], size: [2.0, 14.0, 0.95], rotation: [0, 0, 24], layer: 'primary' },
                    { origin: [-16.0, -2.6, 3.6], size: [1.9, 13.0, 0.9], rotation: [0, 0, 30], layer: 'emissive' },
                    { origin: [-18.0, -3.0, 3.7], size: [1.8, 11.2, 0.85], rotation: [0, 0, 36], layer: 'accent' },
                    { origin: [-19.8, -3.4, 3.8], size: [1.6, 8.8, 0.8], rotation: [0, 0, 42], layer: 'gem' }
                ]
            },
            {
                name: 'wingRightInner',
                pivot: [2.0, 2.2, 2.8],
                cuboids: [
                    { origin: [1.7, -0.8, 2.8], size: [7.8, 2.0, 1.3], rotation: [0, 0, -14], layer: 'dark' },
                    { origin: [2.0, -1.6, 3.0], size: [7.2, 1.2, 1.5], rotation: [0, 0, -14], layer: 'accent' },
                    { origin: [4.1, -2.8, 3.1], size: [1.4, 2.4, 1.1], rotation: [0, 0, 18], layer: 'emissive' },
                    { origin: [6.7, -3.6, 3.2], size: [1.5, 2.8, 1.1], rotation: [0, 0, 22], layer: 'emissive' },
                    { origin: [3.1, 0.8, 3.0], size: [1.7, 7.5, 0.9], rotation: [0, 0, -8], layer: 'primary' },
                    { origin: [4.7, 0.2, 3.1], size: [1.8, 9.2, 0.9], rotation: [0, 0, -12], layer: 'emissive' },
                    { origin: [6.5, -0.4, 3.2], size: [1.8, 10.6, 1.0], rotation: [0, 0, -16], layer: 'primary' },
                    { origin: [8.1, -1.0, 3.3], size: [1.9, 11.8, 1.0], rotation: [0, 0, -20], layer: 'accent' }
                ]
            },
            {
                name: 'wingRightOuter',
                pivot: [9.5, -0.5, 3.3],
                cuboids: [
                    { origin: [9.1, -3.2, 3.2], size: [9.4, 1.8, 1.2], rotation: [0, 0, 12], layer: 'dark' },
                    { origin: [10.4, -4.0, 3.3], size: [8.8, 1.1, 1.3], rotation: [0, 0, 12], layer: 'emissive' },
                    { origin: [9.6, -5.2, 3.3], size: [1.6, 3.2, 1.2], rotation: [0, 0, -24], layer: 'gem' },
                    { origin: [10.0, -1.4, 3.4], size: [2.0, 13.2, 1.0], rotation: [0, 0, -18], layer: 'emissive' },
                    { origin: [12.0, -2.0, 3.5], size: [2.0, 14.0, 0.95], rotation: [0, 0, -24], layer: 'primary' },
                    { origin: [14.1, -2.6, 3.6], size: [1.9, 13.0, 0.9], rotation: [0, 0, -30], layer: 'emissive' },
                    { origin: [16.2, -3.0, 3.7], size: [1.8, 11.2, 0.85], rotation: [0, 0, -36], layer: 'accent' },
                    { origin: [18.2, -3.4, 3.8], size: [1.6, 8.8, 0.8], rotation: [0, 0, -42], layer: 'gem' }
                ]
            }
        ]
    },
    halo: {
        id: 'solar-halo-2.0',
        model: 'halo',
        attachTo: 'head',
        formatVersion: '1.12.0',
        bones: [
            {
                name: 'haloRing',
                pivot: [0, -11.8, 0],
                cuboids: [
                    // 8-segment beveled 3D octagonal ring
                    { origin: [-3.6, -12.2, -5.4], size: [7.2, 1.1, 1.2], layer: 'primary' },
                    { origin: [-3.6, -12.2, 4.2], size: [7.2, 1.1, 1.2], layer: 'primary' },
                    { origin: [-5.4, -12.2, -3.6], size: [1.2, 1.1, 7.2], layer: 'primary' },
                    { origin: [4.2, -12.2, -3.6], size: [1.2, 1.1, 7.2], layer: 'primary' },
                    // Corner diagonal bevel segments
                    { origin: [-4.6, -12.1, -4.6], size: [2.0, 0.9, 2.0], layer: 'emissive' },
                    { origin: [2.6, -12.1, -4.6], size: [2.0, 0.9, 2.0], layer: 'emissive' },
                    { origin: [-4.6, -12.1, 2.6], size: [2.0, 0.9, 2.0], layer: 'emissive' },
                    { origin: [2.6, -12.1, 2.6], size: [2.0, 0.9, 2.0], layer: 'emissive' }
                ]
            },
            {
                name: 'haloRays',
                pivot: [0, -11.8, 0],
                cuboids: [
                    // 8 radiant outer solar shards / sun-spires
                    { origin: [-0.7, -12.6, -7.2], size: [1.4, 1.8, 1.6], layer: 'emissive' },
                    { origin: [-0.7, -12.6, 5.6], size: [1.4, 1.8, 1.6], layer: 'emissive' },
                    { origin: [-7.2, -12.6, -0.7], size: [1.6, 1.8, 1.4], layer: 'emissive' },
                    { origin: [5.6, -12.6, -0.7], size: [1.6, 1.8, 1.4], layer: 'emissive' },
                    { origin: [-5.8, -12.4, -5.8], size: [1.3, 1.4, 1.3], layer: 'gem' },
                    { origin: [4.5, -12.4, -5.8], size: [1.3, 1.4, 1.3], layer: 'gem' },
                    { origin: [-5.8, -12.4, 4.5], size: [1.3, 1.4, 1.3], layer: 'gem' },
                    { origin: [4.5, -12.4, 4.5], size: [1.3, 1.4, 1.3], layer: 'gem' }
                ]
            }
        ]
    },
    crown: {
        id: 'founder-crown-2.0',
        model: 'crown',
        attachTo: 'head',
        formatVersion: '1.12.0',
        bones: [
            {
                name: 'crownBase',
                pivot: [0, -8.5, 0],
                cuboids: [
                    // Lower rim bevel (golden trim)
                    { origin: [-4.7, -8.8, -4.7], size: [9.4, 1.0, 1.1], layer: 'dark' },
                    { origin: [-4.7, -8.8, 3.6], size: [9.4, 1.0, 1.1], layer: 'dark' },
                    { origin: [-4.7, -8.8, -3.6], size: [1.1, 1.0, 7.2], layer: 'dark' },
                    { origin: [3.6, -8.8, -3.6], size: [1.1, 1.0, 7.2], layer: 'dark' },
                    // Main sculpted golden diadem band
                    { origin: [-4.5, -10.5, -4.5], size: [9.0, 1.9, 1.0], layer: 'primary' },
                    { origin: [-4.5, -10.5, 3.5], size: [9.0, 1.9, 1.0], layer: 'primary' },
                    { origin: [-4.5, -10.5, -3.5], size: [1.0, 1.9, 7.0], layer: 'primary' },
                    { origin: [3.5, -10.5, -3.5], size: [1.0, 1.9, 7.0], layer: 'primary' },
                    // Central front sovereign fleur-de-lis peak + cross-guard
                    { origin: [-1.1, -13.8, -4.7], size: [2.2, 3.5, 1.1], layer: 'primary' },
                    { origin: [-1.8, -12.6, -4.6], size: [3.6, 1.0, 0.9], layer: 'accent' },
                    { origin: [-0.6, -14.6, -4.6], size: [1.2, 1.0, 1.0], layer: 'emissive' },
                    // Front corner spires
                    { origin: [-4.5, -12.6, -4.5], size: [1.5, 2.3, 1.5], layer: 'primary' },
                    { origin: [3.0, -12.6, -4.5], size: [1.5, 2.3, 1.5], layer: 'primary' },
                    // Side sovereign spires
                    { origin: [-4.6, -13.1, -0.9], size: [1.1, 2.7, 1.8], layer: 'primary' },
                    { origin: [3.5, -13.1, -0.9], size: [1.1, 2.7, 1.8], layer: 'primary' },
                    // Rear spires
                    { origin: [-4.5, -12.4, 3.0], size: [1.5, 2.1, 1.5], layer: 'primary' },
                    { origin: [3.0, -12.4, 3.0], size: [1.5, 2.1, 1.5], layer: 'primary' },
                    { origin: [-1.0, -13.0, 3.5], size: [2.0, 2.6, 1.1], layer: 'primary' },
                    // 3D inset royal gemstones (Front center ruby/diamond + side gems)
                    { origin: [-0.8, -10.3, -5.0], size: [1.6, 1.5, 0.7], layer: 'gem' },
                    { origin: [-3.2, -10.1, -4.8], size: [1.1, 1.1, 0.6], layer: 'emissive' },
                    { origin: [2.1, -10.1, -4.8], size: [1.1, 1.1, 0.6], layer: 'emissive' },
                    { origin: [-4.9, -10.1, -0.6], size: [0.6, 1.2, 1.2], layer: 'gem' },
                    { origin: [4.3, -10.1, -0.6], size: [0.6, 1.2, 1.2], layer: 'gem' }
                ]
            }
        ]
    },
    cape: {
        id: 'exer-cape-2.0',
        model: 'cape',
        attachTo: 'body',
        formatVersion: '1.12.0',
        bones: [
            {
                name: 'capeClasp',
                pivot: [0, 0, 2.2],
                cuboids: [
                    // Left & right golden shoulder mantle clasps
                    { origin: [-5.2, -0.5, 1.8], size: [2.4, 1.3, 1.6], layer: 'accent' },
                    { origin: [2.8, -0.5, 1.8], size: [2.4, 1.3, 1.6], layer: 'accent' },
                    // Upper mantle collar bridge
                    { origin: [-5.2, 0.0, 2.2], size: [10.4, 1.4, 0.9], layer: 'dark' }
                ]
            },
            {
                name: 'capeUpper',
                pivot: [0, 0.5, 2.5],
                cuboids: [
                    { origin: [-5.0, 0.5, 2.4], size: [10.0, 5.5, 0.75], layer: 'cloth' },
                    // Raised EXER emblem golden chevron on upper back
                    { origin: [-2.6, 2.2, 3.0], size: [5.2, 1.2, 0.35], layer: 'emissive' },
                    { origin: [-2.6, 3.4, 3.0], size: [1.4, 2.4, 0.35], layer: 'emissive' },
                    { origin: [-1.2, 4.0, 3.0], size: [3.2, 1.0, 0.35], layer: 'emissive' }
                ]
            },
            {
                name: 'capeMid',
                pivot: [0, 6.0, 2.5],
                cuboids: [
                    { origin: [-5.1, 6.0, 2.4], size: [10.2, 5.5, 0.7], layer: 'cloth' },
                    { origin: [-2.6, 6.0, 3.0], size: [5.2, 1.1, 0.35], layer: 'emissive' }
                ]
            },
            {
                name: 'capeLower',
                pivot: [0, 11.5, 2.5],
                cuboids: [
                    { origin: [-5.2, 11.5, 2.4], size: [10.4, 4.8, 0.65], layer: 'cloth' },
                    // Royal gold-trimmed bottom hem
                    { origin: [-5.2, 15.2, 2.35], size: [10.4, 1.2, 0.75], layer: 'accent' }
                ]
            }
        ]
    }
};
