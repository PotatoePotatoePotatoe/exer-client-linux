"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pingMinecraftServer = pingMinecraftServer;
exports.pingMinecraftServers = pingMinecraftServers;
const node_net_1 = __importDefault(require("node:net"));
const promises_1 = __importDefault(require("node:dns/promises"));
function writeVarInt(value) {
    const bytes = [];
    let v = value >>> 0;
    while (true) {
        if ((v & ~0x7f) === 0) {
            bytes.push(v);
            break;
        }
        bytes.push((v & 0x7f) | 0x80);
        v >>>= 7;
    }
    return Buffer.from(bytes);
}
function readVarInt(buf, offset = 0) {
    let numRead = 0;
    let result = 0;
    while (true) {
        if (offset + numRead >= buf.length)
            return null;
        const read = buf[offset + numRead];
        const value = read & 0x7f;
        result |= value << (7 * numRead);
        numRead++;
        if (numRead > 5)
            throw new Error('VarInt too big');
        if ((read & 0x80) === 0)
            break;
    }
    return { value: result, length: numRead };
}
function stripMinecraftFormatting(input) {
    return input
        .replace(/§[0-9a-fk-orx]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function extractMotd(desc) {
    if (!desc)
        return '';
    if (typeof desc === 'string')
        return stripMinecraftFormatting(desc);
    let out = '';
    if (typeof desc.text === 'string')
        out += desc.text;
    if (Array.isArray(desc.extra)) {
        for (const item of desc.extra) {
            out += extractMotd(item);
        }
    }
    return stripMinecraftFormatting(out);
}
async function resolveMinecraftEndpoint(rawAddress) {
    const cleaned = rawAddress.trim().replace(/^minecraft:\/\//i, '');
    const idx = cleaned.lastIndexOf(':');
    if (idx > 0 && !cleaned.endsWith(']')) {
        const hostPart = cleaned.slice(0, idx);
        const portPart = Number(cleaned.slice(idx + 1));
        if (Number.isInteger(portPart) && portPart >= 1 && portPart <= 65535) {
            return { host: hostPart, port: portPart };
        }
    }
    try {
        const srv = await Promise.race([
            promises_1.default.resolveSrv(`_minecraft._tcp.${cleaned}`),
            new Promise((_, rej) => setTimeout(() => rej(new Error('srv-timeout')), 1500))
        ]);
        if (srv && srv.length > 0 && srv[0].name && srv[0].port) {
            return { host: srv[0].name.replace(/\.$/, ''), port: srv[0].port };
        }
    }
    catch { }
    return { host: cleaned, port: 25565 };
}
const MAX_PING_RESPONSE_BYTES = 512 * 1024; // 512 KiB maximum allowed SLP response buffer
async function pingMinecraftServer(address, timeoutMs = 4500) {
    const cleanAddr = address.trim();
    if (!cleanAddr || !/^[-a-zA-Z0-9.:[\]]{1,255}$/.test(cleanAddr)) {
        return { address: cleanAddr, online: false, motd: '', playersOnline: 0, playersMax: 0, pingMs: null, versionName: '' };
    }
    const { host, port } = await resolveMinecraftEndpoint(cleanAddr);
    const startedAt = Date.now();
    return new Promise(resolve => {
        const socket = new node_net_1.default.Socket();
        let settled = false;
        let connectTime = startedAt;
        let buffer = Buffer.alloc(0);
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            socket.destroy();
            resolve(result);
        };
        const timer = setTimeout(() => {
            finish({ address: cleanAddr, online: false, motd: '', playersOnline: 0, playersMax: 0, pingMs: null, versionName: '' });
        }, timeoutMs);
        socket.once('error', () => {
            clearTimeout(timer);
            finish({ address: cleanAddr, online: false, motd: '', playersOnline: 0, playersMax: 0, pingMs: null, versionName: '' });
        });
        socket.once('close', () => {
            clearTimeout(timer);
            finish({ address: cleanAddr, online: false, motd: '', playersOnline: 0, playersMax: 0, pingMs: null, versionName: '' });
        });
        socket.connect(port, host, () => {
            connectTime = Date.now();
            const hostBytes = Buffer.from(host, 'utf8');
            const portBuf = Buffer.alloc(2);
            portBuf.writeUInt16BE(port, 0);
            // Handshake packet (ID = 0x00, Protocol = 767 [1.21.1], Host, Port, NextState = 1 [Status])
            const handshakePayload = Buffer.concat([
                writeVarInt(0x00),
                writeVarInt(767),
                writeVarInt(hostBytes.length),
                hostBytes,
                portBuf,
                writeVarInt(1)
            ]);
            const handshakePacket = Buffer.concat([writeVarInt(handshakePayload.length), handshakePayload]);
            // Status Request packet (Length = 1, ID = 0x00)
            const statusRequest = Buffer.from([0x01, 0x00]);
            socket.write(Buffer.concat([handshakePacket, statusRequest]));
        });
        socket.on('data', chunk => {
            if (buffer.length + chunk.length > MAX_PING_RESPONSE_BYTES) {
                clearTimeout(timer);
                finish({ address: cleanAddr, online: false, motd: '', playersOnline: 0, playersMax: 0, pingMs: null, versionName: '' });
                return;
            }
            buffer = Buffer.concat([buffer, chunk]);
            try {
                const packetLen = readVarInt(buffer, 0);
                if (!packetLen)
                    return;
                if (packetLen.value <= 0 || packetLen.value > MAX_PING_RESPONSE_BYTES) {
                    throw new Error('Invalid packetLen');
                }
                if (buffer.length < packetLen.length + packetLen.value)
                    return;
                const packetId = readVarInt(buffer, packetLen.length);
                if (!packetId || packetId.value !== 0x00) {
                    throw new Error('Invalid packetId');
                }
                const jsonLenOffset = packetLen.length + packetId.length;
                const jsonLen = readVarInt(buffer, jsonLenOffset);
                if (!jsonLen)
                    return;
                if (jsonLen.value <= 0 || jsonLen.value > MAX_PING_RESPONSE_BYTES) {
                    throw new Error('Invalid jsonLen');
                }
                const expectedMinPacketLen = packetId.length + jsonLen.length + jsonLen.value;
                if (packetLen.value < expectedMinPacketLen) {
                    throw new Error('Packet length mismatch with jsonLen');
                }
                const jsonStart = jsonLenOffset + jsonLen.length;
                if (buffer.length < jsonStart + jsonLen.value)
                    return;
                const rawJson = buffer.subarray(jsonStart, jsonStart + jsonLen.value).toString('utf8');
                const parsed = JSON.parse(rawJson);
                const rtt = Math.max(1, Date.now() - connectTime);
                clearTimeout(timer);
                finish({
                    address: cleanAddr,
                    online: true,
                    motd: extractMotd(parsed.description) || cleanAddr,
                    playersOnline: Number(parsed.players?.online ?? 0),
                    playersMax: Number(parsed.players?.max ?? 0),
                    pingMs: rtt,
                    versionName: stripMinecraftFormatting(String(parsed.version?.name || '')),
                    favicon: typeof parsed.favicon === 'string' && parsed.favicon.startsWith('data:image/png;base64,') ? parsed.favicon : undefined
                });
            }
            catch {
                clearTimeout(timer);
                finish({ address: cleanAddr, online: false, motd: '', playersOnline: 0, playersMax: 0, pingMs: null, versionName: '' });
            }
        });
    });
}
async function pingMinecraftServers(addresses) {
    const unique = Array.from(new Set(addresses.map(a => a.trim()).filter(Boolean))).slice(0, 30);
    return Promise.all(unique.map(addr => pingMinecraftServer(addr)));
}
