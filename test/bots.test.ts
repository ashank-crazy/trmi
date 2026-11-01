import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, afterEach, before, describe, it } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { createGameServer } from '../src/server/app.js';
import { planMoves, setBotPace, suspicion } from '../src/server/bots.js';
import { CHANGES } from '../src/server/changes.js';
import { startGame } from '../src/server/game.js';
import type { Room } from '../src/server/model.js';
import { addBots, resetRooms } from '../src/server/rooms.js';
import type { ClientToServerEvents, RoomState, ServerToClientEvents } from '../src/shared/types.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let url = '';
const { httpServer, io } = createGameServer();
const open: ClientSocket[] = [];

function client(): { socket: ClientSocket; state: () => RoomState | null; until: (check: (s: RoomState) => boolean) => Promise<RoomState> } {
  const socket: ClientSocket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  open.push(socket);
  let state: RoomState | null = null;
  let waiters: (() => void)[] = [];
  socket.on('room:state', (s) => {
    state = s;
    const run = waiters;
    waiters = [];
    for (const w of run) w();
  });
  const until = (check: (s: RoomState) => boolean): Promise<RoomState> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out')), 4000);
      const test = (): void => {
        if (state && check(state)) {
          clearTimeout(timer);
          resolve(state);
        } else waiters.push(test);
      };
      test();
    });
  return { socket, state: () => state, until };
}

function bareRoom(): Room {
  const room: Room = { code: 'TEST', phase: 'lobby', hostId: 'h', players: new Map(), game: null, playedChanges: new Set() };
  room.players.set('h', { id: 'h', token: 't', name: 'Host', online: true, offlineSince: null, socketId: null, bot: false });
  addBots(room, 3);
  return room;
}

before(async () => {
  setBotPace(0.002);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

afterEach(() => {
  for (const s of open.splice(0)) s.disconnect();
  resetRooms();
});

after(async () => {
  await io.close();
});

describe('seating bots', () => {
  it('fills the room with named bots, but not past the limit', () => {
    const room = bareRoom();
    assert.equal(room.players.size, 4);
    assert.equal(new Set([...room.players.values()].map((p) => p.name)).size, 4);
    assert.deepEqual(addBots(room, 3), { ok: false, error: 'ROOM_FULL' });
  });

  it('hands the host seat to a person, never to a bot', async () => {
    const host = client();
    host.socket.emit('room:create', { name: 'Host', bots: 2 });
    const { code } = await host.until((s) => s.players.length === 3);
    const guest = client();
    guest.socket.emit('room:join', { code, name: 'Guest' });
    await guest.until((s) => s.players.length === 4);
    host.socket.emit('room:leave');
    const state = await guest.until((s) => s.players.length === 3);
    assert.equal(state.hostId, state.youId);
  });

  it('gives a bot seat to a person when the room is full', async () => {
    const host = client();
    host.socket.emit('room:create', { name: 'Host', bots: 3 });
    const { code } = await host.until((s) => s.players.length === 4);
    host.socket.emit('room:addBots', 2);
    await host.until((s) => s.players.length === 6);
    const guest = client();
    guest.socket.emit('room:join', { code, name: 'Guest' });
    const state = await host.until((s) => s.players.some((p) => p.name === 'Guest'));
    assert.equal(state.players.length, 6);
    assert.equal(state.players.filter((p) => p.isBot).length, 4);
  });

  it('lets only the host remove a bot', async () => {
    const host = client();
    host.socket.emit('room:create', { name: 'Host', bots: 3 });
    const state = await host.until((s) => s.players.length === 4);
    host.socket.emit('room:removeBot', state.players.find((p) => p.isBot)!.id);
    await host.until((s) => s.players.length === 3);
  });
});

describe('bot decisions', () => {
  it('has the saboteur bot approve bugs, and never touches a benched bot', () => {
    for (let i = 0; i < 200; i++) {
      const room = bareRoom();
      startGame(room, 0);
      const game = room.game!;
      const sab = [...room.players.values()].find((p) => p.bot && p.id === game.saboteurId);
      const benched = [...room.players.values()].find((p) => p.bot && p.id !== game.saboteurId)!;
      game.benched.add(benched.id);
      const moves = planMoves(room, 0);
      assert.ok(!moves.some((m) => m.bot === benched.id));
      if (sab && CHANGES[game.queue[0]].bug) {
        const vote = moves.find((m) => m.bot === sab.id && m.act.type === 'verdict');
        assert.deepEqual(vote?.act, { type: 'verdict', verdict: 'approve' });
      }
    }
  });

  it('suspects whoever approved a merged bug, not whoever rejected it', () => {
    const room = bareRoom();
    startGame(room, 0);
    const game = room.game!;
    const change = CHANGES.findIndex((c) => c.bug);
    game.reviewed.push({
      change,
      merged: true,
      votes: new Map([
        ['a', 'approve'],
        ['b', 'reject'],
      ]),
    });
    const scores = suspicion(game);
    assert.ok(scores.get('a')! > scores.get('b')!);
  });

  it('bases a retro vote on what is public, never on who the saboteur is', () => {
    const room = bareRoom();
    startGame(room, 0);
    room.phase = 'retro';
    const moves = planMoves(room, 0);
    for (const m of moves) if (m.act.type === 'retro') assert.equal(m.act.vote, 'skip');
  });
});

describe('a solo game', () => {
  it('plays to the debrief with one person and three bots', async () => {
    const me = client();
    me.socket.emit('room:create', { name: 'Solo', bots: 3 });
    await me.until((s) => s.players.length === 4);
    me.socket.emit('game:start');

    for (let step = 0; step < 60; step++) {
      const s = await me.until((x) => x.phase !== 'lobby');
      if (s.phase === 'debrief') break;
      if (s.phase === 'review') {
        me.socket.emit('game:verdict', 'approve');
        await me.until((x) => x.phase !== 'review');
      } else if (s.phase === 'retro') {
        me.socket.emit('game:retro', 'skip');
        await me.until((x) => x.phase !== 'retro');
      } else {
        const before = `${s.phase}:${s.game?.changeNumber}`;
        me.socket.emit('game:next');
        await me.until((x) => `${x.phase}:${x.game?.changeNumber}` !== before);
      }
    }

    const final = me.state()!;
    assert.equal(final.phase, 'debrief');
    assert.ok(final.game?.winner);
  });
});
