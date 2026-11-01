import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CATCH_POINTS,
  CLUE_PASSES,
  ESCAPE_POINTS,
  backToLobby,
  endPhase,
  gameView,
  maybeAdvance,
  nextRound,
  startGame,
  submitClue,
  submitVote,
} from '../src/server/game.js';
import { CLUE_MS } from '../src/shared/rules.js';
import type { Room } from '../src/server/model.js';

/** Small deterministic PRNG so dealing is reproducible. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRoom(count: number): Room {
  const room: Room = { code: 'TEST', phase: 'lobby', hostId: 'p1', players: new Map(), game: null };
  for (let i = 1; i <= count; i++) {
    const id = `p${i}`;
    room.players.set(id, { id, token: `t${i}`, name: `Player ${i}`, online: true, offlineSince: null, socketId: id });
  }
  return room;
}

function ids(room: Room): string[] {
  return [...room.players.keys()];
}

function started(count = 4, seed = 1): Room {
  const room = makeRoom(count);
  assert.deepEqual(startGame(room, 0, seeded(seed)), { ok: true });
  return room;
}

function outsiderOf(room: Room): string {
  return room.game!.outsiderId;
}

function finishClues(room: Room): void {
  for (let pass = 0; pass < CLUE_PASSES; pass++) {
    for (const id of ids(room)) assert.equal(submitClue(room, id, `hint ${id} ${pass}`, 0).ok, true);
  }
}

describe('startGame', () => {
  it('needs at least 4 online players', () => {
    const room = makeRoom(4);
    room.players.get('p4')!.online = false;
    assert.deepEqual(startGame(room, 0), { ok: false, error: 'NOT_ENOUGH_PLAYERS' });
    assert.equal(room.phase, 'lobby');
  });

  it('refuses to start twice', () => {
    const room = started();
    assert.deepEqual(startGame(room, 0), { ok: false, error: 'WRONG_PHASE' });
  });

  it('deals one odd word and plays a round per player', () => {
    const room = started(5);
    const game = room.game!;
    assert.equal(room.phase, 'clue');
    assert.equal(game.totalRounds, 5);
    assert.notEqual(game.majorityWord, game.outsiderWord);
    const words = ids(room).map((id) => gameView(room, id, 0)!.yourWord);
    assert.equal(words.filter((w) => w === game.outsiderWord).length, 1);
    assert.equal(words.filter((w) => w === game.majorityWord).length, 4);
    assert.equal(gameView(room, outsiderOf(room), 0)!.yourWord, game.outsiderWord);
  });

  it('does not reveal the outsider or other words before the reveal', () => {
    const room = started();
    const view = gameView(room, 'p1', 0)!;
    assert.equal(view.reveal, null);
    assert.ok(!JSON.stringify(view).includes(outsiderOf(room) === 'p1' ? room.game!.majorityWord : room.game!.outsiderWord));
  });
});

describe('clues', () => {
  it('validates clue text', () => {
    const room = started();
    const id = 'p1';
    const word = gameView(room, id, 0)!.yourWord!;
    assert.deepEqual(submitClue(room, id, '   ', 0), { ok: false, error: 'CLUE_INVALID' });
    assert.deepEqual(submitClue(room, id, 'x'.repeat(25), 0), { ok: false, error: 'CLUE_INVALID' });
    assert.deepEqual(submitClue(room, id, 42, 0), { ok: false, error: 'CLUE_INVALID' });
    assert.deepEqual(submitClue(room, id, `my ${word.toUpperCase()}!`, 0), { ok: false, error: 'CLUE_HAS_WORD' });
    assert.deepEqual(submitClue(room, id, '  warm   drink ', 0), { ok: true });
    assert.equal(gameView(room, id, 0)!.yourClue, 'warm drink');
  });

  it('hides clues until everyone online is in, then starts the next pass', () => {
    const room = started();
    const [first, ...rest] = ids(room);
    submitClue(room, first, 'alpha', 0);
    const midway = gameView(room, rest[0], 0)!;
    assert.deepEqual(midway.clues, {});
    assert.deepEqual(midway.submitted, [first]);
    assert.equal(midway.yourClue, null);

    for (const id of rest) submitClue(room, id, 'beta', 1000);
    const view = gameView(room, first, 1000)!;
    assert.equal(room.phase, 'clue');
    assert.equal(view.cluePass, 2);
    assert.deepEqual(view.clues[first], ['alpha']);
    assert.deepEqual(view.submitted, []);
    assert.equal(view.remainingMs, CLUE_MS);
  });

  it('moves to voting after the last pass', () => {
    const room = started();
    finishClues(room);
    assert.equal(room.phase, 'vote');
    assert.equal(gameView(room, 'p1', 0)!.clues.p2.length, CLUE_PASSES);
  });

  it('records a missing clue as null when time runs out', () => {
    const room = started();
    submitClue(room, 'p1', 'alpha', 0);
    endPhase(room, CLUE_MS);
    assert.deepEqual(room.game!.clues.get('p1'), ['alpha']);
    assert.deepEqual(room.game!.clues.get('p2'), [null]);
    assert.equal(room.game!.cluePass, 2);
  });

  it('does not wait on offline players', () => {
    const room = started();
    room.players.get('p4')!.online = false;
    for (const id of ['p1', 'p2', 'p3']) submitClue(room, id, 'alpha', 0);
    assert.equal(room.game!.cluePass, 2);
  });

  it('advances when the last holdout disconnects', () => {
    const room = started();
    for (const id of ['p1', 'p2', 'p3']) submitClue(room, id, 'alpha', 0);
    assert.equal(room.game!.cluePass, 1);
    room.players.get('p4')!.online = false;
    maybeAdvance(room, 0);
    assert.equal(room.game!.cluePass, 2);
  });
});

describe('voting and scoring', () => {
  it('rejects self-votes and unknown players', () => {
    const room = started();
    finishClues(room);
    assert.deepEqual(submitVote(room, 'p1', 'p1', 0), { ok: false, error: 'VOTE_INVALID' });
    assert.deepEqual(submitVote(room, 'p1', 'nobody', 0), { ok: false, error: 'VOTE_INVALID' });
  });

  it('rejects clues during voting and votes during clues', () => {
    const room = started();
    assert.deepEqual(submitVote(room, 'p1', 'p2', 0), { ok: false, error: 'WRONG_PHASE' });
    finishClues(room);
    assert.deepEqual(submitClue(room, 'p1', 'late', 0), { ok: false, error: 'WRONG_PHASE' });
  });

  it('awards catchers when the outsider gets the most votes', () => {
    const room = started();
    finishClues(room);
    const outsider = outsiderOf(room);
    const others = ids(room).filter((id) => id !== outsider);
    submitVote(room, others[0], outsider, 0);
    submitVote(room, others[1], outsider, 0);
    submitVote(room, others[2], others[1], 0);
    submitVote(room, outsider, others[0], 0);

    assert.equal(room.phase, 'reveal');
    const reveal = room.game!.reveal!;
    assert.equal(reveal.caught, true);
    assert.equal(reveal.outsiderId, outsider);
    assert.deepEqual(reveal.points, { [others[0]]: CATCH_POINTS, [others[1]]: CATCH_POINTS });
    assert.equal(room.game!.scores.get(others[0]), CATCH_POINTS);
    assert.equal(room.game!.scores.get(others[2]), 0);
    assert.equal(room.game!.scores.get(outsider), 0);
  });

  it('lets the outsider escape on a tie', () => {
    const room = started();
    finishClues(room);
    const outsider = outsiderOf(room);
    const others = ids(room).filter((id) => id !== outsider);
    submitVote(room, others[0], outsider, 0);
    submitVote(room, others[1], outsider, 0);
    submitVote(room, others[2], others[0], 0);
    submitVote(room, outsider, others[0], 0);
    // 2 votes each for the outsider and others[0]
    assert.equal(room.game!.reveal!.caught, false);
    assert.deepEqual(room.game!.reveal!.points, { [outsider]: ESCAPE_POINTS });
    assert.equal(room.game!.scores.get(outsider), ESCAPE_POINTS);
  });

  it('lets the outsider escape when nobody votes', () => {
    const room = started();
    finishClues(room);
    endPhase(room, 0);
    assert.equal(room.phase, 'reveal');
    assert.equal(room.game!.reveal!.caught, false);
  });
});

describe('rounds', () => {
  it('gives everyone a turn as the outsider, then shows results', () => {
    const room = started(6, 7);
    const outsiders: string[] = [];
    for (let round = 1; round <= 6; round++) {
      assert.equal(room.game!.round, round);
      outsiders.push(outsiderOf(room));
      finishClues(room);
      endPhase(room, 0);
      assert.deepEqual(nextRound(room, 0, seeded(round)), { ok: true });
    }
    assert.equal(room.phase, 'results');
    assert.deepEqual([...outsiders].sort(), ids(room).sort());
    assert.deepEqual(nextRound(room, 0), { ok: false, error: 'WRONG_PHASE' });
  });

  it('uses a fresh word pair each round', () => {
    const room = started(6, 3);
    const pairs = new Set<string>();
    for (let round = 1; round <= 6; round++) {
      pairs.add([room.game!.majorityWord, room.game!.outsiderWord].sort().join('/'));
      finishClues(room);
      endPhase(room, 0);
      nextRound(room, 0);
    }
    assert.equal(pairs.size, 6);
  });

  it('skips an offline outsider in favour of an online player', () => {
    const room = started();
    finishClues(room);
    endPhase(room, 0);
    const planned = room.game!.order[1];
    room.players.get(planned)!.online = false;
    nextRound(room, 0);
    assert.notEqual(outsiderOf(room), planned);
    assert.equal(room.players.get(outsiderOf(room))!.online, true);
  });

  it('returns to the lobby', () => {
    const room = started();
    assert.deepEqual(backToLobby(room), { ok: true });
    assert.equal(room.phase, 'lobby');
    assert.equal(room.game, null);
    assert.deepEqual(backToLobby(room), { ok: false, error: 'WRONG_PHASE' });
  });
});
