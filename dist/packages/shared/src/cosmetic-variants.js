"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VARIANT_LABELS = void 0;
exports.cosmeticsConflict = cosmeticsConflict;
exports.VARIANT_LABELS = {
    costume: 'Kostium',
    wings: 'Skrzydła',
    armor_wings: 'Zbroja + skrzydła'
};
// Two cosmetics cannot be worn together when they use the same slot or cover
// a common body region (a costume and a suit with wings both dress the torso;
// a costume and wings-only do not overlap).
function cosmeticsConflict(a, b, slotOf = c => c.slot || '') {
    if (a.id === b.id)
        return true;
    if (slotOf(a) && slotOf(a) === slotOf(b))
        return true;
    const covered = new Set(a.covers || []);
    if (slotOf(a) === 'cape')
        covered.add('back');
    const bCovered = new Set(b.covers || []);
    if (slotOf(b) === 'cape')
        bCovered.add('back');
    return [...bCovered].some(region => covered.has(region));
}
