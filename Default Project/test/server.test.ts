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

/** Has every client that can vote send `emit`, then waits for everyone to see `phase`. */
async function everyone(clients: Client[], emit: (c: Client) => void, phase: RoomState['phase']): Promise<void> {
  for (const c of clients) if (!c.state!.game!.benched.includes(c.you)) emit(c);
  await Promise.all(clients.map((c) => c.until((s) => s.phase === phase, phase)));
}

describe('a full game', () => {
  it('plays through reviews and retros to the debrief and back to the lobby', async () => {
    const { clients, code } = await fillRoom(4);
    const [host] = clients;
    host.socket.emit('game:start');
    await Promise.all(clients.map((c) => c.until((s) => s.phase === 'review', 'review')));

    const late = new Client();
    assert.deepEqual(await late.join(code, 'Late'), { ok: false, error: 'GAME_IN_PROGRESS' });

    // Exactly one saboteur, and only they get told about bugs.
    const saboteurs = clients.filter((c) => c.state!.game!.role === 'saboteur');
    assert.equal(saboteurs.length, 1);
    for (const c of clients) assert.equal(c.state!.game!.intel !== null, c === saboteurs[0]);

    clients[1].socket.emit('game:comment', { text: 'line 1 looks odd', line: 0 });
    const seen = await clients[2].until((s) => s.game!.comments.length === 1, 'comment');
    assert.deepEqual(seen.game!.comments[0], { id: 1, by: clients[1].you, text: 'line 1 looks odd', line: 0 });

    // Approve everything: the game ends as soon as 4 clean changes or 2 bugs are merged.
    while (true) {
      await everyone(clients, (c) => c.socket.emit('game:verdict', 'approve'), 'outcome');
      const outcome = host.state!.game!;
      assert.equal(outcome.history.at(-1)!.merged, true);
      assert.equal(Object.keys(outcome.history.at(-1)!.votes).length, 4);
      if (outcome.winner) break;

      clients[1].socket.emit('game:next');
      await clients[1].untilError('NOT_HOST');
      host.socket.emit('game:next');
      await host.until((s) => s.phase === 'review' || s.phase === 'retro', 'next phase');
      if (host.state!.phase === 'retro') {
        await everyone(clients, (c) => c.socket.emit('game:retro', 'skip'), 'verdict');
        assert.equal(host.state!.game!.retro!.ejectedId, null);
        host.socket.emit('game:next');
        await host.until((s) => s.phase === 'review', 'review');
      }
    }

    const { shipped, bugsShipped, winner } = host.state!.game!;
    assert.deepEqual(
      winner,
      bugsShipped === 2 ? { side: 'saboteur', reason: 'bugs' } : { side: 'reviewers', reason: 'shipped' },
    );
    assert.equal(shipped === 4 || bugsShipped === 2, true);

    host.socket.emit('game:next');
    const debrief = (await clients[3].until((s) => s.phase === 'debrief', 'debrief')).game!.debrief!;
    assert.equal(debrief.saboteurId, saboteurs[0].you);
    assert.equal(debrief.changes.length, shipped + bugsShipped);
    assert.equal(debrief.changes.filter((c) => c.bug).length, bugsShipped);

    host.socket.emit('game:lobby');
    const lobby = await clients[3].until((s) => s.phase === 'lobby', 'lobby');
    assert.equal(lobby.game, null);
    assert.equal(lobby.players.length, 4);
  });

  it('ends the game when the team votes out the saboteur', async () => {
    const { clients } = await fillRoom(4);
    const [host] = clients;
    host.socket.emit('game:start');
    await Promise.all(clients.map((c) => c.until((s) => s.phase === 'review', 'review')));
    const saboteur = clients.find((c) => c.state!.game!.role === 'saboteur')!;
    const scapegoat = clients.find((c) => c !== saboteur)!;

    for (let i = 0; i < 2; i++) {
      await everyone(clients, (c) => c.socket.emit('game:verdict', 'reject'), 'outcome');
      host.socket.emit('game:next');
    }
    await Promise.all(clients.map((c) => c.until((s) => s.phase === 'retro', 'retro')));
    await everyone(
      clients,
      (c) => c.socket.emit('game:retro', c === saboteur ? scapegoat.you : saboteur.you),
      'verdict',
    );
    assert.deepEqual(host.state!.game!.retro!.ejectedId, saboteur.you);
    assert.deepEqual(host.state!.game!.winner, { side: 'reviewers', reason: 'caught' });
  });

  it('keeps a disconnected player seated mid-game and lets them rejoin', async () => {
    const { clients, code } = await fillRoom(4);
    const [host, , , quitter] = clients;
    host.socket.emit('game:start');
    await quitter.until((s) => s.phase === 'review');
    const { youId: you = '', youToken } = quitter.state!;
    const role = quitter.state!.game!.role;

    quitter.socket.disconnect();
    await host.until((s) => s.players.some((p) => p.id === you && !p.online));
    // The three remaining players are enough to finish the review.
    clients.slice(0, 3).forEach((c) => c.socket.emit('game:verdict', 'reject'));
    await host.until((s) => s.phase === 'outcome', 'outcome');
    assert.equal(you in host.state!.game!.history[0].votes, false);

    const back = new Client();
    const res = await back.join(code, 'Quitter', youToken);
    assert.equal(res.ok, true);
    assert.equal(res.ok && res.state.game!.role, role);
    assert.equal(res.ok && res.state.phase, 'outcome');
  });
});
