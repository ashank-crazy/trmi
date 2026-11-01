import { randomBytes, randomUUID } from 'node:crypto';
import { MAX_PLAYERS } from '../shared/rules.js';
import { endPhase, gameView, maybeAdvance } from './game.js';
export const OFFLINE_GRACE_MS = 60_000;
const rooms = new Map();
const phaseTimers = new Map();
let io = null;
export function setIo(server) {
    io = server;
}
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 4;
function generateCode() {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
        code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return code;
}
function allocateCode() {
    let code = generateCode();
    while (rooms.has(code))
        code = generateCode();
    return code;
}
function toState(room, viewer, now = Date.now()) {
    return {
        code: room.code,
        hostId: room.hostId,
        players: [...room.players.values()]
            .sort((a, b) => Number(b.id === room.hostId) - Number(a.id === room.hostId))
            .map((p) => ({ id: p.id, name: p.name, isHost: p.id === room.hostId, online: p.online })),
        phase: room.phase,
        game: gameView(room, viewer?.id, now),
        youId: viewer?.id,
        youToken: viewer?.token,
    };
}
/** Sends every connected player their own view of the room and re-arms the phase timer. */
function commit(room) {
    syncPhaseTimer(room);
    const now = Date.now();
    for (const player of room.players.values()) {
        if (player.socketId)
            io?.to(player.socketId).emit('room:state', toState(room, player, now));
    }
}
function syncPhaseTimer(room) {
    clearTimeout(phaseTimers.get(room.code));
    phaseTimers.delete(room.code);
    const deadline = room.game?.deadline;
    if (deadline == null)
        return;
    const timer = setTimeout(() => {
        phaseTimers.delete(room.code);
        if (rooms.get(room.code) !== room || room.game?.deadline !== deadline)
            return;
        endPhase(room, Date.now());
        commit(room);
    }, Math.max(0, deadline - Date.now()));
    timer.unref();
    phaseTimers.set(room.code, timer);
}
function deleteRoom(room) {
    clearTimeout(phaseTimers.get(room.code));
    phaseTimers.delete(room.code);
    rooms.delete(room.code);
}
function addPlayer(room, name) {
    let id = randomBytes(4).toString('hex');
    while (room.players.has(id))
        id = randomBytes(4).toString('hex');
    const player = { id, token: randomUUID(), name, online: true, offlineSince: null, socketId: null };
    room.players.set(id, player);
    return player;
}
function currentSeat(socket) {
    const { roomCode, playerId } = socket.data;
    const room = roomCode ? rooms.get(roomCode) : undefined;
    const player = playerId ? room?.players.get(playerId) : undefined;
    if (!room || !player || player.socketId !== socket.id)
        return null;
    return { room, player };
}
function bindSocket(socket, room, player) {
    const seat = currentSeat(socket);
    if (seat && seat.player !== player)
        leaveSeat(seat.room, seat.player);
    // Same seat opened somewhere else (e.g. a duplicated tab): the newest connection wins.
    if (player.socketId && player.socketId !== socket.id) {
        const previous = io?.sockets.sockets.get(player.socketId);
        if (previous) {
            previous.data = {};
            previous.emit('room:error', 'SESSION_REPLACED');
        }
    }
    player.socketId = socket.id;
    player.online = true;
    player.offlineSince = null;
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
}
/** Prefers the first online player in seat order; keeps an offline host only if nobody else is online. */
function promoteNextHost(room) {
    const hostSeated = room.hostId !== null && room.players.has(room.hostId);
    const others = [...room.players.values()].filter((p) => p.id !== room.hostId);
    const next = others.find((p) => p.online) ?? (hostSeated ? undefined : others[0]);
    if (next)
        room.hostId = next.id;
    else if (!hostSeated)
        room.hostId = null;
}
function markOffline(room, player, now) {
    player.online = false;
    player.offlineSince = now;
    player.socketId = null;
    // The players still here may all have acted already.
    maybeAdvance(room, now);
}
/** Lobby seats are freed immediately; mid-game seats are kept (offline) so the round stays consistent. */
function leaveSeat(room, player, now = Date.now()) {
    if (room.phase === 'lobby')
        room.players.delete(player.id);
    else
        markOffline(room, player, now);
    if (room.hostId === player.id)
        promoteNextHost(room);
    if (room.players.size === 0)
        deleteRoom(room);
    else
        commit(room);
}
export function createRoom(socket, name) {
    const room = {
        code: allocateCode(),
        phase: 'lobby',
        hostId: null,
        players: new Map(),
        game: null,
        playedChanges: new Set(),
    };
    const player = addPlayer(room, name);
    room.hostId = player.id;
    rooms.set(room.code, room);
    bindSocket(socket, room, player);
    commit(room);
    return toState(room, player);
}
export function joinRoom(socket, code, name, token) {
    const room = rooms.get(code);
    if (!room)
        return { ok: false, error: 'ROOM_NOT_FOUND' };
    const existing = token ? [...room.players.values()].find((p) => p.token === token) : undefined;
    if (existing) {
        bindSocket(socket, room, existing);
        commit(room);
        return { ok: true, state: toState(room, existing) };
    }
    if (room.phase !== 'lobby')
        return { ok: false, error: 'GAME_IN_PROGRESS' };
    if (room.players.size >= MAX_PLAYERS)
        return { ok: false, error: 'ROOM_FULL' };
    const player = addPlayer(room, name);
    bindSocket(socket, room, player);
    commit(room);
    return { ok: true, state: toState(room, player) };
}
export function leaveRoom(socket) {
    const seat = currentSeat(socket);
    socket.data = {};
    if (seat)
        leaveSeat(seat.room, seat.player);
}
export function handleDisconnect(socket, now = Date.now()) {
    const seat = currentSeat(socket);
    socket.data = {};
    if (!seat)
        return;
    markOffline(seat.room, seat.player, now);
    commit(seat.room);
}
/** Runs a game action for the socket's seat and broadcasts the result. */
export function act(socket, action, opts = {}) {
    const seat = currentSeat(socket);
    if (!seat)
        return { ok: false, error: 'ROOM_NOT_FOUND' };
    if (opts.hostOnly && seat.room.hostId !== seat.player.id)
        return { ok: false, error: 'NOT_HOST' };
    const result = action(seat.room, seat.player, Date.now());
    if (result.ok)
        commit(seat.room);
    return result;
}
export function sweepExpired(now = Date.now()) {
    const expired = (p) => !p.online && p.offlineSince !== null && now - p.offlineSince >= OFFLINE_GRACE_MS;
    for (const room of [...rooms.values()]) {
        const players = [...room.players.values()];
        if (players.every(expired)) {
            deleteRoom(room);
            continue;
        }
        let changed = false;
        // Mid-game, expired players keep their seat (and role) until the room returns to the lobby.
        if (room.phase === 'lobby') {
            for (const p of players) {
                if (expired(p)) {
                    room.players.delete(p.id);
                    changed = true;
                }
            }
        }
        const host = room.hostId !== null ? room.players.get(room.hostId) : undefined;
        if (!host || expired(host)) {
            const before = room.hostId;
            promoteNextHost(room);
            changed ||= room.hostId !== before;
        }
        if (changed)
            commit(room);
    }
}
/** Test hook: drops all rooms and pending timers. */
export function resetRooms() {
    for (const room of [...rooms.values()])
        deleteRoom(room);
}
//# sourceMappingURL=rooms.js.map