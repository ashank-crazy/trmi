import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server as SocketIOServer } from 'socket.io';
import { MAX_NAME_LENGTH } from '../shared/rules.js';
import { addComment, backToLobby, nextStep, startGame, submitRetroVote, submitVerdict, } from './game.js';
import { act, createRoom, handleDisconnect, joinRoom, leaveRoom, setIo, } from './rooms.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CODE_RE = /^[A-Z]{4}$/;
function cleanName(name) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    return trimmed && trimmed.length <= MAX_NAME_LENGTH ? trimmed : null;
}
function reportError(socket, result) {
    if (!result.ok)
        socket.emit('room:error', result.error);
}
function registerHandlers(socket) {
    socket.on('room:create', (payload) => {
        const name = cleanName(payload?.name);
        if (!name) {
            socket.emit('room:error', 'NAME_REQUIRED');
            return;
        }
        createRoom(socket, name);
    });
    socket.on('room:join', (payload, callback) => {
        const reply = typeof callback === 'function' ? callback : undefined;
        const fail = (error) => {
            socket.emit('room:error', error);
            reply?.({ ok: false, error });
        };
        const code = typeof payload?.code === 'string' ? payload.code.trim().toUpperCase() : '';
        const name = cleanName(payload?.name);
        if (!name)
            return fail('NAME_REQUIRED');
        if (!CODE_RE.test(code))
            return fail('ROOM_NOT_FOUND');
        const token = typeof payload.token === 'string' && payload.token ? payload.token : undefined;
        const result = joinRoom(socket, code, name, token);
        if (!result.ok)
            return fail(result.error);
        reply?.(result);
    });
    socket.on('room:leave', () => leaveRoom(socket));
    socket.on('game:start', () => {
        reportError(socket, act(socket, (room, _player, now) => startGame(room, now), { hostOnly: true }));
    });
    socket.on('game:verdict', (verdict) => {
        reportError(socket, act(socket, (room, player, now) => submitVerdict(room, player.id, verdict, now)));
    });
    socket.on('game:retro', (vote) => {
        reportError(socket, act(socket, (room, player, now) => submitRetroVote(room, player.id, vote, now)));
    });
    socket.on('game:comment', (payload) => {
        reportError(socket, act(socket, (room, player, now) => addComment(room, player.id, payload, now)));
    });
    socket.on('game:next', () => {
        reportError(socket, act(socket, (room, _player, now) => nextStep(room, now), { hostOnly: true }));
    });
    socket.on('game:lobby', () => {
        reportError(socket, act(socket, (room) => backToLobby(room), { hostOnly: true }));
    });
    socket.on('disconnect', () => handleDisconnect(socket));
}
export function createGameServer({ serveClient = false } = {}) {
    const app = express();
    const httpServer = createServer(app);
    const io = new SocketIOServer(httpServer);
    setIo(io);
    io.on('connection', registerHandlers);
    // In production the built client sits next to the built server (in dev, Vite
    // serves it). Socket.IO answers its own /socket.io requests before Express sees them.
    const clientDir = path.join(__dirname, '..', 'client');
    const indexHtml = path.join(clientDir, 'index.html');
    if (serveClient && existsSync(indexHtml)) {
        app.use(express.static(clientDir));
        app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(indexHtml) : next()));
    }
    return { httpServer, io };
}
//# sourceMappingURL=app.js.map