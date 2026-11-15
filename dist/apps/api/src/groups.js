"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GROUP_ICONS = exports.DEFAULT_PARTNERS = exports.DEFAULT_GROUPS = exports.OWNER_PRIORITY = exports.PERMS = void 0;
exports.createGroups = createGroups;
const zod_1 = require("zod");
/** What a group lets its members do. The owner (adminUuid) always has every permission. */
exports.PERMS = ['admin.panel', 'cosmetics.all', 'cosmetics.edit', 'cosmetics.grant', 'coins.give', 'events.manage', 'news.manage',
    'partners.manage', 'players.ban', 'chat.moderate', 'updates.manage', 'groups.assign', 'groups.partners', 'groups.manage'];
exports.OWNER_PRIORITY = 100;
const all = exports.PERMS.filter(p => p !== 'groups.manage');
/** admin and partner are kept because older data (db.admins, role 'partner') maps onto them; the rest are starting suggestions. */
exports.DEFAULT_GROUPS = [
    // Staff: the EXER team above the administrators (the owner is a member).
    { id: 'staff', name: 'Staff', tag: 'STAFF', kind: 'staff', color: '#ff5a3c', badge: '⚡', priority: 95, perms: all, cosmetics: [], builtin: true },
    { id: 'admin', name: 'Administrator', tag: 'ADMIN', kind: 'staff', color: '#ff8a1f', badge: '🛡', priority: 90, perms: all, cosmetics: [], builtin: true },
    { id: 'mod', name: 'Moderator', tag: 'MOD', kind: 'staff', color: '#4fb4ff', badge: '🔨', priority: 70, perms: ['admin.panel', 'players.ban', 'chat.moderate'], cosmetics: [] },
    { id: 'partner', name: 'Partner', tag: 'PARTNER', kind: 'partner', color: '#3ddc84', badge: '🤝', priority: 50, perms: [], cosmetics: [], builtin: true },
    { id: 'creator', name: 'Twórca', tag: 'TWÓRCA', kind: 'special', color: '#ff5a8a', badge: '🎬', priority: 40, perms: [], cosmetics: [] },
    { id: 'tester', name: 'Tester', tag: 'TESTER', kind: 'special', color: '#b77cff', badge: '🧪', priority: 30, perms: [], cosmetics: [] },
    { id: 'vip', name: 'VIP', tag: 'VIP', kind: 'special', color: '#ffd23f', badge: '⭐', priority: 20, perms: [], cosmetics: [] }
];
/** Partners EXER already works with, made as subgroups of 'partner' on the first start of the groups system.
 * cosmetics: candidate ids, only the ones in the catalog are kept. */
exports.DEFAULT_PARTNERS = [
    { id: 'fazedev', name: 'fazedev.pl', color: '#2b6bff', server: 'fazedev.pl', cosmetics: ['fazedev-partner-cape', 'fazedev-pl-cape', 'fazedev-cape'] },
    { id: 'malinowska', name: 'Malinowska Graphics', color: '#e00070', cosmetics: ['malinowska-partner-cape'] },
    { id: 'wuxmc', name: 'WuxMC.pl', color: '#9229e8', server: 'wuxmc.pl', cosmetics: ['wuxmc-partner-cape'] }
];
const uuid = zod_1.z.string().regex(/^[a-f0-9]{32}$/i).transform(s => s.toLowerCase());
const groupInput = zod_1.z.object({
    id: zod_1.z.string().regex(/^[a-z0-9-]{2,32}$/),
    name: zod_1.z.string().trim().min(1).max(32),
    tag: zod_1.z.string().trim().max(12).regex(/^[^§\u0000-\u001f]*$/).optional(),
    kind: zod_1.z.enum(['staff', 'partner', 'special']),
    color: zod_1.z.string().regex(/^#[0-9a-fA-F]{6}$/),
    badge: zod_1.z.string().trim().max(8).optional(),
    priority: zod_1.z.number().int().min(1).max(99),
    perms: zod_1.z.array(zod_1.z.enum(exports.PERMS)).max(exports.PERMS.length).default([]),
    cosmetics: zod_1.z.array(zod_1.z.string().max(40)).max(100).default([]),
    parent: zod_1.z.string().regex(/^[a-z0-9-]{2,32}$/).optional(),
    server: zod_1.z.string().trim().max(64).optional(),
    discordRole: zod_1.z.string().regex(/^\d{5,25}$/).optional()
});
/** Pixel icons the game draws instead of the [TAG] (glyphs in assets/exer/font/icons.json); a group without one keeps its tag. */
exports.GROUP_ICONS = ['owner', 'admin', 'mod', 'partner', 'creator', 'tester', 'vip', 'staff'];
const groupIcon = (id) => exports.GROUP_ICONS.includes(id) ? id : undefined;
/** Groups: who may do what in the admin panel, partner brands with their cosmetics, badges. Data lives in the cosmetics database. */
function createGroups(deps) {
    const groups = () => deps.state().groups || [];
    const find = (id) => groups().find(g => g.id === id);
    /** Memberships still running, oldest first; groups deleted since are skipped. */
    const active = (id, now = Date.now()) => (deps.state().players[id]?.groups || []).filter(m => (!m.until || Date.parse(m.until) > now) && find(m.id));
    /** A member of a subgroup is a member of its parent too. */
    const of = (id) => [...new Set(active(id).flatMap(m => { const g = find(m.id), p = g.parent ? find(g.parent) : undefined; return p ? [g, p] : [g]; }))];
    const rank = (id) => id === deps.owner ? exports.OWNER_PRIORITY : Math.max(0, ...of(id).map(g => g.priority));
    const perms = (id) => id === deps.owner ? [...exports.PERMS] : [...new Set(of(id).flatMap(g => g.perms))];
    const can = (id, perm) => perms(id).includes(perm);
    /** Cosmetics a player may wear because of a group (a partner's own capes); never written into saved grants. */
    const cosmetics = (id) => [...new Set(of(id).flatMap(g => g.cosmetics))];
    /** The group shown next to the nick: the highest priority one, a subgroup before its parent ("Partner · fazedev.pl"). */
    const shown = (id) => {
        if (id === deps.owner)
            return { id: 'owner', name: 'Właściciel', tag: 'OWNER', icon: 'owner', color: '#ff8a1f', badge: '👑', kind: 'staff' };
        const g = of(id).sort((a, b) => b.priority - a.priority || Number(!!b.parent) - Number(!!a.parent))[0];
        if (!g)
            return undefined;
        const p = g.parent ? find(g.parent) : undefined;
        return { id: g.id, name: p ? p.name + ' · ' + g.name : g.name, tag: g.tag || p?.tag || g.name.slice(0, 12).toUpperCase(), icon: groupIcon(p?.id || g.id), color: g.color, badge: g.badge || p?.badge, kind: g.kind, server: g.server, ...(p ? { parent: p.id } : {}) };
    };
    /** Older API builds read db.admins and role 'partner': keep them in step so a rollback keeps the same people. */
    function mirror() {
        const s = deps.state();
        s.admins = Object.keys(s.players).filter(id => id !== deps.owner && active(id).some(m => m.id === 'admin'));
        for (const [id, p] of Object.entries(s.players)) {
            if (active(id).some(m => find(m.id).kind === 'partner'))
                p.role = 'partner';
            else
                delete p.role;
        }
    }
    /** Run once after loading: default groups on first start, the built-in ones always, old admins and partners moved into groups. */
    function migrate() {
        const s = deps.state();
        const first = !s.groups;
        if (!s.groups)
            s.groups = structuredClone(exports.DEFAULT_GROUPS);
        for (const g of exports.DEFAULT_GROUPS)
            if (g.builtin && !s.groups.some(x => x.id === g.id))
                s.groups.push(structuredClone(g));
        const add = (id, group) => {
            const p = s.players[id] || (s.players[id] = deps.blank(''));
            p.groups = p.groups || [];
            if (!p.groups.some(m => m.id === group))
                p.groups.push({ id: group, by: 'migration' });
        };
        // The staff owns every cape, so holding a partner's cape says nothing about them.
        const isStaff = (id) => id === deps.owner || !!s.admins?.includes(id) || !!s.players[id]?.groups?.some(m => s.groups.find(g => g.id === m.id)?.kind === 'staff');
        // first start: the known partners become subgroups with their capes, and players already given a partner's cape join it
        if (first)
            for (const d of exports.DEFAULT_PARTNERS) {
                const cosmetics = d.cosmetics.filter(deps.hasCosmetic);
                s.groups.push({ id: d.id, name: d.name, kind: 'partner', color: d.color, priority: 50, perms: [], cosmetics, parent: 'partner', ...(d.server ? { server: d.server } : {}) });
                for (const [id, p] of Object.entries(s.players))
                    if (!isStaff(id) && cosmetics.some(c => p.grants?.includes(c)))
                        add(id, d.id);
            }
        // a known partner seeded before its cape reached the catalog (FazeDev in 0.5.69) gets it now
        else
            for (const d of exports.DEFAULT_PARTNERS) {
                const g = s.groups.find(x => x.id === d.id && x.parent === 'partner');
                if (g && !g.cosmetics.length)
                    g.cosmetics = d.cosmetics.filter(deps.hasCosmetic);
            }
        // Groups saved before chat moderation existed: once, so the owner can still take it away from them later.
        if (!s.chatModerationSeeded) {
            for (const g of s.groups)
                if ((g.id === 'mod' || g.id === 'admin') && !g.perms.includes('chat.moderate'))
                    g.perms.push('chat.moderate');
            s.chatModerationSeeded = true;
        }
        // Once: the owner joins the new Staff group (it can be taken away later like any other).
        if (!s.staffSeeded) {
            if (deps.owner)
                add(deps.owner, 'staff');
            s.staffSeeded = true;
        }
        for (const id of s.admins || [])
            if (id !== deps.owner)
                add(id, 'admin');
        // Once: staff that an earlier first start put into partner groups only because of those capes.
        if (!s.partnerStaffCleaned) {
            for (const [id, p] of Object.entries(s.players)) {
                if (!p.groups || !isStaff(id))
                    continue;
                p.groups = p.groups.filter(m => m.by !== 'migration' || s.groups.find(g => g.id === m.id)?.kind !== 'partner');
                if (!p.groups.length)
                    delete p.groups;
            }
            s.partnerStaffCleaned = true;
        }
        for (const [id, p] of Object.entries(s.players))
            if (p.role === 'partner')
                add(id, 'partner');
    }
    const deny = (error) => ({ error, code: 403 });
    /** Who may give a group: groups.assign, and both the group and the player's current rank must be below your own. */
    async function assign(actor, player, name, group, add, days) {
        const g = find(group);
        if (!g)
            return { error: 'Nie ma takiej grupy.', code: 404 };
        if (!can(actor, 'groups.assign'))
            return deny('Brak uprawnienia do nadawania grup.');
        if (player === deps.owner && actor !== deps.owner)
            return deny('Właściciela nie można zmieniać.');
        if (actor !== deps.owner && (g.priority >= rank(actor) || rank(player) >= rank(actor)))
            return deny('Możesz zmieniać tylko grupy i graczy poniżej swojej rangi.');
        // admin and partner keep the audit names the launcher history already shows
        const action = group === 'admin' || group === 'partner' ? group + (add ? '-add' : '-remove') : add ? 'group-add' : 'group-remove';
        await deps.mutate(actor, action, action.startsWith('group') ? player + ':' + group : player, () => {
            const s = deps.state(), p = s.players[player] || (s.players[player] = deps.blank(name));
            if (name)
                p.name = name;
            p.groups = (p.groups || []).filter(m => m.id !== group);
            if (add)
                p.groups.push({ id: group, by: actor, ...(days ? { until: new Date(Date.now() + days * 86400000).toISOString() } : {}) });
            if (!p.groups.length)
                delete p.groups;
            mirror();
        });
        return { ok: true };
    }
    function register(app) {
        /** groups.manage: any group; groups.partners: partner groups and their subgroups only. */
        const manages = (id, g) => can(id, 'groups.manage') || (can(id, 'groups.partners') && (g.parent ? find(g.parent)?.kind : g.kind) === 'partner');
        const actor = (req, perm) => {
            const p = deps.user(req);
            if (!can(p.id, perm))
                throw Object.assign(Error('Brak uprawnień administratora.'), { statusCode: 403 });
            return p;
        };
        app.get('/v1/admin/groups', async (req) => {
            const me = actor(req, 'admin.panel');
            const members = {};
            for (const [id, p] of Object.entries(deps.state().players))
                if (p.groups?.length)
                    members[id] = { name: p.name, groups: p.groups };
            return { groups: groups(), members, perms: exports.PERMS, me: { rank: rank(me.id), perms: perms(me.id) } };
        });
        // Create or edit a group: only below your own rank and only with permissions you have yourself.
        app.post('/v1/admin/groups', async (req, reply) => {
            const me = deps.user(req);
            const input = groupInput.safeParse(req.body);
            if (!input.success)
                return reply.code(400).send({ error: 'Nieprawidłowa grupa: id a-z0-9-, nazwa do 32 znaków, kolor #rrggbb, priorytet 1–99.' });
            const v = input.data, old = find(v.id), mine = perms(me.id);
            if (!manages(me.id, v) || (old && !manages(me.id, old)))
                return reply.code(403).send({ error: 'Brak uprawnienia do zarządzania tą grupą.' });
            if ((old && old.priority >= rank(me.id)) || v.priority >= rank(me.id))
                return reply.code(403).send({ error: 'Możesz zmieniać tylko grupy poniżej swojej rangi.' });
            if (v.perms.some(p => !mine.includes(p)))
                return reply.code(403).send({ error: 'Nie możesz dać grupie uprawnień, których sam nie masz.' });
            if (old?.builtin && old.kind !== v.kind)
                return reply.code(400).send({ error: 'Rodzaju wbudowanej grupy nie można zmienić.' });
            const missing = v.cosmetics.filter(c => !deps.hasCosmetic(c));
            if (missing.length)
                return reply.code(400).send({ error: 'Nie ma takich kosmetyków: ' + missing.join(', ') });
            const parent = v.parent ? find(v.parent) : undefined;
            if (v.parent && (!parent || parent.parent || v.parent === v.id))
                return reply.code(400).send({ error: 'Grupa nadrzędna musi istnieć i nie może być podgrupą.' });
            if (parent && (old?.builtin || groups().some(g => g.parent === v.id)))
                return reply.code(400).send({ error: 'Ta grupa nie może zostać podgrupą.' });
            // a subgroup always has its parent's kind and priority, so ranks stay simple
            const group = { ...v, ...(parent ? { kind: parent.kind, priority: parent.priority } : {}), cosmetics: [...new Set(v.cosmetics)], ...(old?.builtin ? { builtin: true } : {}) };
            for (const k of ['tag', 'badge', 'parent', 'server', 'discordRole'])
                if (!group[k])
                    delete group[k];
            await deps.mutate(me.id, old ? 'group-save' : 'group-create', v.id, () => {
                const s = deps.state();
                s.groups = [...(s.groups || []).filter(g => g.id !== v.id), group];
                mirror();
            });
            return { ok: true, group };
        });
        app.delete('/v1/admin/groups/:id', async (req, reply) => {
            const me = deps.user(req), id = String(req.params.id), g = find(id);
            if (!g)
                return reply.code(404).send({ error: 'Nie ma takiej grupy.' });
            if (!manages(me.id, g))
                return reply.code(403).send({ error: 'Brak uprawnienia do zarządzania tą grupą.' });
            if (g.builtin)
                return reply.code(400).send({ error: 'Wbudowanej grupy nie można usunąć.' });
            if (groups().some(x => x.parent === id))
                return reply.code(400).send({ error: 'Najpierw usuń podgrupy tej grupy.' });
            if (g.priority >= rank(me.id))
                return reply.code(403).send({ error: 'Możesz usuwać tylko grupy poniżej swojej rangi.' });
            await deps.mutate(me.id, 'group-delete', id, () => {
                const s = deps.state();
                s.groups = (s.groups || []).filter(x => x.id !== id);
                for (const p of Object.values(s.players))
                    if (p.groups) {
                        p.groups = p.groups.filter(m => m.id !== id);
                        if (!p.groups.length)
                            delete p.groups;
                    }
                mirror();
            });
            return { ok: true };
        });
        app.post('/v1/admin/groups/assign', async (req, reply) => {
            const me = deps.user(req);
            const input = zod_1.z.object({ player: uuid, name: zod_1.z.string().max(16).default(''), group: zod_1.z.string().max(32), add: zod_1.z.boolean(), days: zod_1.z.number().int().min(1).max(365).optional() }).safeParse(req.body);
            if (!input.success)
                return reply.code(400).send({ error: 'Nieprawidłowe dane gracza.' });
            const v = input.data, r = await assign(me.id, v.player, v.name, v.group, v.add, v.days);
            return 'error' in r ? reply.code(r.code).send({ error: r.error }) : r;
        });
    }
    return { groups, find, active, rank, perms, can, cosmetics, shown, migrate, assign, register };
}
