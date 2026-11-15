"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashHardware = hashHardware;
exports.readHardware = readHardware;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_child_process_1 = require("node:child_process");
// Placeholder serials that many boards and VMs report: they say nothing about the machine.
const JUNK = /^(|0+|none|null|default string|to be filled by o\.?e\.?m\.?|not (applicable|specified|available)|system serial number|o\.?e\.?m\.?|123456789|ffffffff-ffff-ffff-ffff-ffffffffffff|00000000-0000-0000-0000-000000000000)$/i;
/** Raw values -> salted SHA-256 per part; raw serial numbers never leave this PC. */
function hashHardware(raw) {
    const out = {};
    for (const part of ['machine', 'board', 'disk', 'bios']) {
        const value = typeof raw[part] === 'string' ? raw[part].trim().toLowerCase() : '';
        if (!JUNK.test(value))
            out[part] = node_crypto_1.default.createHash('sha256').update('EXER-hw-v1:' + part + ':' + value).digest('hex');
    }
    return out;
}
// One PowerShell call: Windows install id, motherboard serial, serial of the disk holding Windows, SMBIOS UUID.
const SCRIPT = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$m=(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid",
    "$b=(Get-CimInstance Win32_BaseBoard).SerialNumber",
    "$d=(Get-Partition -DriveLetter $env:SystemDrive[0] | Get-Disk).SerialNumber",
    "$u=(Get-CimInstance Win32_ComputerSystemProduct).UUID",
    "[pscustomobject]@{machine=\"$m\";board=\"$b\";disk=\"$d\";bios=\"$u\"} | ConvertTo-Json -Compress",
].join(';');
let cached = null;
/** Hashed hardware parts of this PC, read once per launcher run; {} when not on Windows or the query fails. */
function readHardware() {
    if (process.platform !== 'win32')
        return Promise.resolve({});
    return cached ??= new Promise(resolve => {
        (0, node_child_process_1.execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], { timeout: 15000, windowsHide: true }, (error, stdout) => {
            if (error) {
                cached = null;
                resolve({});
                return;
            }
            try {
                resolve(hashHardware(JSON.parse(stdout)));
            }
            catch {
                cached = null;
                resolve({});
            }
        });
    });
}
