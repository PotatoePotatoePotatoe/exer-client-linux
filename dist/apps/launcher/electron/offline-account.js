"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OfflineNameSchema = void 0;
exports.offlineAccount = offlineAccount;
const node_crypto_1 = __importDefault(require("node:crypto"));
const zod_1 = require("zod");
exports.OfflineNameSchema = zod_1.z.string().regex(/^[A-Za-z0-9_]{3,16}$/, 'Nick: 3–16 znaków, litery, cyfry lub _.');
function offlineAccount(input) {
    const name = exports.OfflineNameSchema.parse(input);
    const bytes = node_crypto_1.default.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
    bytes[6] = (bytes[6] & 0x0f) | 0x30;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return { id: bytes.toString('hex'), name, kind: 'offline' };
}
