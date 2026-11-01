import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { createGameServer } from '../src/server/app.js';
import { resetRooms } from '../src/server/rooms.js';
import type {
  ClientToServerEvents,
  JoinResponse,
  RoomError,
  RoomState,
  ServerToClientEvents,
} from '../src/shared/types.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let url = '';
const { httpServer, io } = createGameServer();
const open: Client[] = [];

class Client {
  readonly socket: ClientSocket;
  state: RoomState | null = null;
  errors: RoomError[] = [];
  private waiters: (() => void)[] = [];

  constructor() {
    this.socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    this.socket.on('room:state', (s) => {
      this.state = s;
      this.notify();
    });
    this.socket.on('room:error', (e) => {
      this.errors.push(e);
      this.notify();
    });
    open.push(this);
  }

  private notify(): void {
    for (const w of this.waiters.splice(0)) w();
  }

  /** Resolves once `check` passes against the latest state, re-checking on every update. */
  until(check: (s: RoomState) => boolean, label = 'state'): Promise<RoomState> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 2000);
      const test = (): void => {
        if (this.state && check(this.state)) {
          clearTimeout(timer);
          resolve(this.state);
        } else {
          this.waiters.push(test);
        }
      };
      test();
    });
  }

  untilError(error: RoomError): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${error}`)), 2000);
      const test = (): void => {
        if (this.errors.includes(error)) {
          clearTimeout(timer);
          resolve();
        } else {
          this.waiters.push(test);
        }
      };
      test();
    });
  }

  join(code: string, name: string, token?: string): Promise<JoinResponse> {
    return new Promise((resolve) => this.socket.emit('room:join', { code, name, token }, resolve));
  }

  get you(): string {
    return this.state!.youId!;
  }
}

async function createRoom(name = 'Host'): Promise<{ host: Client; code: string }> {
  const host = new Client();
  host.socket.emit('room:create', { name });
  const state = await host.until((s) => s.youId !== undefined, 'room created');
  return { host, code: state.code };
}

async function fillRoom(count: number): Promise<{ clients: Client[]; code: string }> {
  const { host, code } = await createRoom();
  const clients = [host];
  for (let i = 2; i <= count; i++) {
    const c = new Client();
    const res = await c.join(code, `Player ${i}`);
    assert.equal(res.ok, true);
    clients.push(c);
  }
  await host.until((s) => s.players.length === count, `${count} players`);
  return { clients, code };
}

before(async () => {
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

beforeEach(() => {
  for (const c of open.splice(0)) c.socket.disconnect();
  resetRooms();
});

after(async () => {
  for (const c of open.splice(0)) c.socket.disconnect();
  resetRooms();
  await io.close();
});

describe('lobby', () => {
  it('creates a room and lets others join by code', async () => {
    const { clients, code } = await fillRoom(3);
    const state = await clients[0].until((s) => s.players.length === 3);
    assert.match(code, /^[A-Z]{4}$/);
    assert.equal(state.hostId, clients[0].you);
    assert.equal(state.players.filter((p) => p.isHost).length, 1);
    // Each player only ever receives their own token.
    const tokens = clients.map((c) => c.state!.youToken);
    assert.equal(new Set(tokens).size, 3);
  });

  it('rejects unknown rooms, missing names, and a 7th player', async () => {
    const stranger = new Client();
    assert.deepEqual(await stranger.join('ZZZZ', 'Bob'), { ok: false, error: 'ROOM_NOT_FOUND' });
    const { code } = await fillRoom(6);
    assert.deepEqual(await stranger.join(code, '   '), { ok: false, error: 'NAME_REQUIRED' });
    assert.deepEqual(await stranger.join(code, 'Seventh'), { ok: false, error: 'ROOM_FULL' });
  });

  it('rebinds the same seat when a player reconnects with their token', async () => {
    const { clients, code } = await fillRoom(2);
    const [host, guest] = clients;
    const { youId: you, youToken } = guest.state!;
    guest.socket.disconnect();
    await host.until((s) => s.players.some((p) => p.id === you && !p.online), 'guest offline');

    const again = new Client();
    const res = await again.join(code, 'Renamed', youToken);
    assert.equal(res.ok && res.state.youId, you);
    const state = await host.until((s) => s.players.every((p) => p.online), 'guest back');
    assert.equal(state.players.length, 2);

    // A rejoined socket must still be tracked: dropping it marks the seat offline again.
    again.socket.disconnect();
    await host.until((s) => s.players.some((p) => p.id === you && !p.online), 'guest offline again');
  });

  it("can't take over someone's seat with their public id", async () => {
    const { clients, code } = await fillRoom(2);
    const intruder = new Client();
    const res = await intruder.join(code, 'Intruder', clients[1].you);
    assert.equal(res.ok, true);
    assert.notEqual(res.ok && res.state.youId, clients[1].you);
    await clients[0].until((s) => s.players.length === 3);
  });

  it('frees a lobby seat and promotes a new host on leave', async () => {
    const { clients } = await fillRoom(3);
    const [host, second] = clients;
    host.socket.emit('room:leave');
    const state = await second.until((s) => s.players.length === 2, 'host left');
    assert.equal(state.hostId, second.you);
  });

  it('only lets the host start, and only with 4 online players', async () => {
    const { clients } = await fillRoom(3);
    clients[1].socket.emit('game:start');
    await clients[1].untilError('NOT_HOST');
    clients[0].socket.emit('game:start');
    await clients[0].untilError('NOT_ENOUGH_PLAYERS');
  });
});

describe('a full game', () => {
  it('plays every round to the results and back to the lobby', async () => {
    const { clients, code } = await fillRoom(4);
    const [host] = clients;
    host.socket.emit('game:start');
    await Promise.all(clients.map((c) => c.until((s) => s.phase === 'clue', 'clue phase')));

    const late = new Client();
    assert.deepEqual(await late.join(code, 'Late'), { ok: false, error: 'GAME_IN_PROGRESS' });

    const totalRounds = host.state!.game!.totalRounds;
    assert.equal(totalRounds, 4);
    const outsiders = new Set<string>();

    for (let round = 1; round <= totalRounds; round++) {
      await Promise.all(clients.map((c) => c.until((s) => s.phase === 'clue' && s.game!.round === round)));

      // Exactly one player holds a different word, and only they can see it.
      const words = clients.map((c) => c.state!.game!.yourWord!);
      const counts = new Map<string, number>();
      for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
      assert.deepEqual([...counts.values()].sort(), [1, 3]);
      const odd = clients[words.findIndex((w) => counts.get(w) === 1)];
      outsiders.add(odd.you);

      for (let pass = 1; pass <= 2; pass++) {
        await Promise.all(clients.map((c) => c.until((s) => s.phase === 'clue' && s.game!.cluePass === pass)));
        clients.forEach((c, i) => c.socket.emit('game:clue', `hint${i}x${pass}`));
      }

      await Promise.all(clients.map((c) => c.until((s) => s.phase === 'vote', 'vote phase')));
      assert.deepEqual(host.state!.game!.clues[host.you], ['hint0x1', 'hint0x2']);
      for (const c of clients) {
        const target = c === odd ? clients.find((o) => o !== odd)! : odd;
        c.socket.emit('game:vote', target.you);
      }

      const reveal = (await host.until((s) => s.phase === 'reveal', 'reveal')).game!.reveal!;
      assert.equal(reveal.outsiderId, odd.you);
      assert.equal(reveal.caught, true);
      assert.equal(Object.keys(reveal.points).length, 3);

      // Only the host can move on.
      clients[1].socket.emit('game:next');
      await clients[1].untilError('NOT_HOST');
      host.socket.emit('game:next');
    }

    const results = await host.until((s) => s.phase === 'results', 'results');
    assert.equal(outsiders.size, 4, 'everyone was the odd one out once');
    // Each player caught the outsider in the 3 rounds they weren't it.
    assert.deepEqual(Object.values(results.game!.scores), [3, 3, 3, 3]);

    host.socket.emit('game:lobby');
    const lobby = await clients[3].until((s) => s.phase === 'lobby', 'lobby');
    assert.equal(lobby.game, null);
    assert.equal(lobby.players.length, 4);
  });

  it('keeps a disconnected player seated mid-game and lets them rejoin', async () => {
    const { clients, code } = await fillRoom(4);
    const [host, , , quitter] = clients;
    host.socket.emit('game:start');
    await quitter.until((s) => s.phase === 'clue');
    const { youId: you = "", youToken } = quitter.state!;
    const word = quitter.state!.game!.yourWord;

    quitter.socket.disconnect();
    await host.until((s) => s.players.some((p) => p.id === you && !p.online));
    // The three remaining players are enough to finish the pass.
    clients.slice(0, 3).forEach((c, i) => c.socket.emit('game:clue', `hint${i}`));
    await host.until((s) => s.game!.cluePass === 2, 'second pass');
    assert.deepEqual(host.state!.game!.clues[you], [null]);

    const back = new Client();
    const res = await back.join(code, 'Quitter', youToken);
    assert.equal(res.ok, true);
    assert.equal(res.ok && res.state.game!.yourWord, word);
    assert.equal(res.ok && res.state.phase, 'clue');
  });
});
