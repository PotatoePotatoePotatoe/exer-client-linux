"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("./server");
const secret = process.env.EXER_VOICE_SECRET || '';
if (secret.length < 32)
    throw Error('EXER_VOICE_SECRET is missing or too short.');
void (0, server_1.createVoiceServer)({ secret }).listen(Number(process.env.PORT || 8790));
