"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSessionRelay = registerSessionRelay;
const zod_1 = require("zod");
// Mojang session relay for Velocity proxies (-Dmojang.sessionserver=https://api.exerclient.com/v1/session/hasJoined).
// Velocity gives up on the first 5xx from sessionserver.mojang.com and refuses the login; this relay asks Mojang
// again a few times before answering. The answer is always Mojang's own: EXER never vouches for a login itself.
const MOJANG = 'https://sessionserver.mojang.com/session/minecraft/hasJoined';
const Query = zod_1.z.object({ username: zod_1.z.string().regex(/^[A-Za-z0-9_]{1,16}$/), serverId: zod_1.z.string().regex(/^-?[0-9a-f]{1,40}$/), ip: zod_1.z.string().max(64).regex(/^[0-9a-fA-F:.]+$/).optional() });
/** Pauses between tries; the whole relay stays well under Velocity's own HTTP timeout. */
const RETRY_MS = [0, 700, 1500, 2500];
function registerSessionRelay(app, fetchImpl = fetch, wait = (ms) => new Promise(r => setTimeout(r, ms))) {
    const recent = new Map();
    app.get('/v1/session/hasJoined', async (req, reply) => {
        const q = Query.safeParse(req.query);
        if (!q.success)
            return reply.code(400).send({ error: 'Bad request' });
        // a proxy logs players in one at a time; 120 a minute per address is far above a busy network
        const now = Date.now(), hits = (recent.get(req.ip) || []).filter(t => t > now - 60_000);
        if (hits.length >= 120)
            return reply.code(429).send({ error: 'Too many requests' });
        recent.set(req.ip, [...hits, now]);
        if (recent.size > 5000)
            for (const [k, v] of recent)
                if (!v.some(t => t > now - 60_000))
                    recent.delete(k);
        const url = MOJANG + '?' + new URLSearchParams(Object.entries(q.data).filter(([, v]) => v != null));
        let last = 502;
        for (const pause of RETRY_MS) {
            if (pause)
                await wait(pause);
            try {
                const r = await fetchImpl(url, { headers: { 'user-agent': 'EXER-Session-Relay' }, signal: AbortSignal.timeout(4000) });
                // 200 = verified, 204 = not joined: final answers. 429 and 5xx are Mojang's hiccups: try again.
                if (r.status === 200) {
                    reply.header('Cache-Control', 'no-store');
                    return reply.type('application/json').send(await r.text());
                }
                if (r.status === 204)
                    return reply.code(204).send();
                last = r.status;
                if (r.status !== 429 && r.status < 500)
                    return reply.code(r.status).send();
            }
            catch {
                last = 504;
            }
        }
        req.log.warn({ status: last, username: q.data.username }, 'Mojang hasJoined failed after retries');
        return reply.code(last >= 500 ? last : 503).send();
    });
}
