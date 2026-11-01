import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CHANGES } from '../src/server/changes.js';
import {
  COMMENT_GAP_MS,
  addComment,
  backToLobby,
  endPhase,
  gameView,
  maybeAdvance,
  nextStep,
  startGame,
  submitRetroVote,
  submitVerdict,
} from '../src/server/game.js';
import type { Room } from '../src/server/model.js';
import { BUGGED_CHANGES, CLEAN_CHANGES, MAX_COMMENT_LENGTH } from '../src/shared/rules.js';
import type { Verdict } from '../src/shared/types.js';

/** Small deterministic PRNG so dealing is reproducible. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CLEAN = CHANGES.flatMap((c, i) => (c.bug ? [] : [i]));
const BUGGED = CHANGES.flatMap((c, i) => (c.bug ? [i] : []));

function makeRoom(count: number): Room {
  const room: Room = {
    code: 'TEST',
    phase: 'lobby',
    hostId: 'p1',
    players: new Map(),
    game: null,
    playedChanges: new Set(),
  };
  for (let i = 1; i <= count; i++) {
    const id = `p${i}`;
    room.players.set(id, { id, token: `t${i}`, name: `Player ${i}`, online: true, offlineSince: null, socketId: id, bot: false });
  }
  return room;
}

/**
 * Starts a game with p1 as the saboteur. `order` fixes the queue: 'c' is a clean
 * change and 'b' one that hides a bug.
 */
function started(count = 4, order = 'cbcbccbcc'): Room {
  const room = makeRoom(count);
  assert.deepEqual(startGame(room, 0, seeded(1)), { ok: true });
  const game = room.game!;
  game.saboteurId = 'p1';
  let c = 0;
  let b = 0;
  game.queue = [...order].map((k) => (k === 'b' ? BUGGED[b++] : CLEAN[c++]));
  return room;
}

function ids(room: Room): string[] {
  return [...room.players.keys()];
}

/** Every player who can still vote casts `verdict` (or whatever `pick` says). */
function review(room: Room, pick: Verdict | ((id: string) => Verdict)): void {
  for (const id of ids(room)) {
    if (room.game!.benched.has(id) || !room.players.get(id)!.online) continue;
    const verdict = typeof pick === 'function' ? pick(id) : pick;
    assert.deepEqual(submitVerdict(room, id, verdict, 0), { ok: true });
  }
  assert.equal(room.phase, 'outcome');
}

function retro(room: Room, pick: (id: string) => string): void {
  for (const id of ids(room)) {
    if (room.game!.benched.has(id) || !room.players.get(id)!.online) continue;
    assert.deepEqual(submitRetroVote(room, id, pick(id), 0), { ok: true });
  }
  assert.equal(room.phase, 'verdict');
}

function next(room: Room): void {
  assert.deepEqual(nextStep(room, 0), { ok: true });
}

describe('the change bank', () => {
  it('has enough changes of each kind, each bug on an added line', () => {
    assert.ok(CLEAN.length >= CLEAN_CHANGES * 2, 'clean changes');
    assert.ok(BUGGED.length >= BUGGED_CHANGES * 2, 'bugged changes');
    assert.equal(new Set(CHANGES.map((c) => c.title)).size, CHANGES.length, 'unique titles');
    for (const c of CHANGES) {
      if (!c.bug) continue;
      assert.equal(c.lines[c.bug.line].kind, 'add', c.title);
      assert.ok(c.bug.explanation.length > 20, c.title);
    }
  });
});

describe('startGame', () => {
  it('needs at least 4 online players', () => {
    const room = makeRoom(4);
    room.players.get('p4')!.online = false;
    assert.deepEqual(startGame(room, 0), { ok: false, error: 'NOT_ENOUGH_PLAYERS' });
    room.players.get('p4')!.online = true;
    assert.deepEqual(startGame(room, 0), { ok: true });
    assert.deepEqual(startGame(room, 0), { ok: false, error: 'WRONG_PHASE' });
  });

  it('picks one saboteur and deals clean and bugged changes', () => {
    const room = makeRoom(5);
    startGame(room, 0, seeded(7));
    const game = room.game!;
    assert.ok(room.players.has(game.saboteurId));
    assert.equal(game.queue.filter((i) => CHANGES[i].bug).length, BUGGED_CHANGES);
    assert.equal(game.queue.filter((i) => !CHANGES[i].bug).length, CLEAN_CHANGES);
    assert.equal(room.phase, 'review');
    const roles = ids(room).map((id) => gameView(room, id, 0)!.role);
    assert.equal(roles.filter((r) => r === 'saboteur').length, 1);
  });

  it('spreads the bugs out: one in each third of the queue', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const room = makeRoom(4);
      startGame(room, 0, seeded(seed));
      const third = room.game!.queue.length / BUGGED_CHANGES;
      for (let b = 0; b < BUGGED_CHANGES; b++) {
        const stretch = room.game!.queue.slice(b * third, (b + 1) * third);
        assert.equal(stretch.filter((i) => CHANGES[i].bug).length, 1, `seed ${seed}, stretch ${b}`);
      }
    }
  });

  it('only shows the saboteur where the bug is', () => {
    const room = started(4, 'bcccccbcb');
    const sab = gameView(room, 'p1', 0)!;
    assert.deepEqual(sab.intel, { bug: CHANGES[BUGGED[0]].bug });
    for (const id of ['p2', 'p3', 'p4']) assert.equal(gameView(room, id, 0)!.intel, null);
    assert.equal(gameView(room, 'p2', 0)!.change!.title, CHANGES[BUGGED[0]].title);
  });

  it("prefers changes the room hasn't played yet", () => {
    const room = makeRoom(4);
    startGame(room, 0, seeded(3));
    const first = new Set(room.game!.queue);
    backToLobby(room);
    startGame(room, 0, seeded(3));
    assert.equal(room.game!.queue.filter((i) => first.has(i)).length, 0);
  });
});

describe('reviewing a change', () => {
  it('keeps votes secret until everyone has voted', () => {
    const room = started();
    submitVerdict(room, 'p2', 'approve', 0);
    const view = gameView(room, 'p3', 0)!;
    assert.deepEqual(view.submitted, ['p2']);
    assert.equal(view.yourVerdict, null);
    assert.equal(gameView(room, 'p2', 0)!.yourVerdict, 'approve');
    assert.deepEqual(view.history, []);
  });

  it('merges only with more approvals than rejections', () => {
    const tie = started();
    review(tie, (id) => (id === 'p1' || id === 'p2' ? 'approve' : 'reject'));
    assert.equal(gameView(tie, 'p1', 0)!.history[0].merged, false);

    const majority = started();
    review(majority, (id) => (id === 'p4' ? 'reject' : 'approve'));
    assert.equal(gameView(majority, 'p1', 0)!.history[0].merged, true);
    assert.equal(majority.game!.shipped, 1);
  });

  it('blocks a change nobody voted on when time runs out', () => {
    const room = started();
    endPhase(room, 0);
    assert.equal(room.phase, 'outcome');
    assert.equal(room.game!.reviewed[0].merged, false);
  });

  it('reveals a merged bug, but keeps a rejected change secret', () => {
    const room = started(4, 'bbcccccbc');
    review(room, 'approve');
    const shipped = gameView(room, 'p2', 0)!.history[0];
    assert.deepEqual(shipped.bug, CHANGES[BUGGED[0]].bug);
    assert.equal(room.game!.bugsShipped, 1);

    next(room);
    review(room, 'reject');
    assert.equal(gameView(room, 'p2', 0)!.history[1].bug, null);
  });

  it("doesn't wait for offline players", () => {
    const room = started();
    room.players.get('p4')!.online = false;
    review(room, 'approve');
    assert.equal(room.game!.reviewed[0].votes.has('p4'), false);
  });

  it('moves on when the last holdout disconnects', () => {
    const room = started();
    for (const id of ['p1', 'p2', 'p3']) submitVerdict(room, id, 'approve', 0);
    assert.equal(room.phase, 'review');
    room.players.get('p4')!.online = false;
    maybeAdvance(room, 0);
    assert.equal(room.phase, 'outcome');
  });

  it('rejects anything but approve or reject', () => {
    const room = started();
    assert.deepEqual(submitVerdict(room, 'p2', 'maybe', 0), { ok: false, error: 'VOTE_INVALID' });
    assert.deepEqual(submitRetroVote(room, 'p2', 'skip', 0), { ok: false, error: 'WRONG_PHASE' });
  });
});

describe('winning', () => {
  it('gives the saboteur the game once 2 bugs are merged', () => {
    const room = started(4, 'bbcccccbc');
    review(room, 'approve');
    assert.equal(room.game!.winner, null);
    next(room);
    review(room, 'approve');
    assert.deepEqual(room.game!.winner, { side: 'saboteur', reason: 'bugs' });
    next(room);
    assert.equal(room.phase, 'debrief');
  });

  it('gives the reviewers the game once 4 clean changes ship', () => {
    const room = started(4, 'ccccbbbcc');
    review(room, 'approve');
    next(room);
    review(room, 'approve');
    next(room);
    retro(room, () => 'skip');
    next(room);
    review(room, 'approve');
    next(room);
    review(room, 'approve');
    assert.deepEqual(room.game!.winner, { side: 'reviewers', reason: 'shipped' });
  });

  it('gives the saboteur the game when the release can no longer ship', () => {
    const room = started(4, 'cccbbbccc');
    review(room, 'reject');
    next(room);
    review(room, 'reject');
    assert.equal(room.game!.winner, null);
    next(room);
    retro(room, () => 'skip');
    next(room);
    review(room, 'reject');
    // 0 shipped, and only 3 clean changes left: 4 can't ship any more.
    assert.deepEqual(room.game!.winner, { side: 'saboteur', reason: 'deadline' });
  });
});

describe('retros', () => {
  it('come after every second change', () => {
    const room = started();
    review(room, 'reject');
    next(room);
    assert.equal(room.phase, 'review');
    assert.equal(gameView(room, 'p1', 0)!.changeNumber, 2);
    review(room, 'reject');
    next(room);
    assert.equal(room.phase, 'retro');
    assert.equal(gameView(room, 'p1', 0)!.change, null);
  });

  function atRetro(count = 4): Room {
    const room = started(count);
    review(room, 'reject');
    next(room);
    review(room, 'reject');
    next(room);
    return room;
  }

  it('ends the game when the saboteur is voted out', () => {
    const room = atRetro();
    retro(room, (id) => (id === 'p1' ? 'p2' : 'p1'));
    assert.deepEqual(room.game!.retro, {
      votes: { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p1' },
      ejectedId: 'p1',
      wasSaboteur: true,
    });
    assert.deepEqual(room.game!.winner, { side: 'reviewers', reason: 'caught' });
  });

  it("benches a reviewer who's voted out: no votes, no comments, nobody waits for them", () => {
    const room = atRetro();
    retro(room, (id) => (id === 'p2' ? 'p3' : 'p2'));
    assert.equal(room.game!.retro!.wasSaboteur, false);
    assert.equal(room.game!.winner, null);
    next(room);
    assert.equal(room.phase, 'review');
    assert.deepEqual(submitVerdict(room, 'p2', 'approve', 0), { ok: false, error: 'VOTED_OUT' });
    assert.deepEqual(addComment(room, 'p2', { text: 'hi' }, 0), { ok: false, error: 'VOTED_OUT' });
    review(room, 'approve');
    assert.equal(room.game!.reviewed.at(-1)!.votes.size, 3);
  });

  it('keeps everyone on a tie or when skip wins', () => {
    const tie = atRetro();
    retro(tie, (id) => ({ p1: 'p2', p2: 'p1', p3: 'p2', p4: 'p1' })[id]!);
    assert.equal(tie.game!.retro!.ejectedId, null);

    const skipped = atRetro();
    retro(skipped, (id) => (id === 'p4' ? 'p1' : 'skip'));
    assert.equal(skipped.game!.retro!.ejectedId, null);
    assert.equal(skipped.game!.benched.size, 0);
  });

  it("rejects votes for yourself or someone who isn't on the team", () => {
    const room = atRetro();
    assert.deepEqual(submitRetroVote(room, 'p2', 'p2', 0), { ok: false, error: 'VOTE_INVALID' });
    assert.deepEqual(submitRetroVote(room, 'p2', 'nobody', 0), { ok: false, error: 'VOTE_INVALID' });
    room.game!.benched.add('p3');
    assert.deepEqual(submitRetroVote(room, 'p2', 'p3', 0), { ok: false, error: 'VOTE_INVALID' });
    assert.deepEqual(submitRetroVote(room, 'p3', 'p2', 0), { ok: false, error: 'VOTED_OUT' });
  });
});

describe('comments', () => {
  it('adds comments, optionally on a line of the change', () => {
    const room = started();
    assert.deepEqual(addComment(room, 'p2', { text: '  looks   fine  ' }, 0), { ok: true });
    assert.deepEqual(addComment(room, 'p3', { text: 'this line?', line: 1 }, COMMENT_GAP_MS), { ok: true });
    assert.deepEqual(
      gameView(room, 'p4', 0)!.comments.map((c) => [c.by, c.text, c.line]),
      [
        ['p2', 'looks fine', null],
        ['p3', 'this line?', 1],
      ],
    );
  });

  it('rejects empty and overlong comments, and lines that do not exist', () => {
    const room = started();
    const lines = gameView(room, 'p2', 0)!.change!.lines.length;
    const bad = { ok: false, error: 'COMMENT_INVALID' };
    assert.deepEqual(addComment(room, 'p2', { text: '   ' }, 0), bad);
    assert.deepEqual(addComment(room, 'p2', { text: 'x'.repeat(MAX_COMMENT_LENGTH + 1) }, 0), bad);
    assert.deepEqual(addComment(room, 'p2', { text: 'hm', line: lines }, 0), bad);
    assert.deepEqual(addComment(room, 'p2', { text: 'hm', line: 1.5 }, 0), bad);
    assert.deepEqual(addComment(room, 'p2', null, 0), bad);
  });

  it('slows down rapid-fire comments', () => {
    const room = started();
    assert.deepEqual(addComment(room, 'p2', { text: 'one' }, 1000), { ok: true });
    assert.deepEqual(addComment(room, 'p2', { text: 'two' }, 1100), { ok: false, error: 'COMMENT_LIMIT' });
    assert.deepEqual(addComment(room, 'p2', { text: 'two' }, 1000 + COMMENT_GAP_MS), { ok: true });
  });

  it('starts a fresh discussion for each change, and line comments only on a change', () => {
    const room = started();
    addComment(room, 'p2', { text: 'first change' }, 0);
    review(room, 'reject');
    assert.equal(room.game!.comments.length, 1, 'still there during the outcome');
    next(room);
    assert.equal(room.game!.comments.length, 0);
    review(room, 'reject');
    next(room);
    assert.equal(room.phase, 'retro');
    assert.deepEqual(addComment(room, 'p2', { text: 'it was p3', line: 0 }, 0), {
      ok: false,
      error: 'COMMENT_INVALID',
    });
    assert.deepEqual(addComment(room, 'p2', { text: 'it was p3' }, 0), { ok: true });
  });
});

describe('the debrief', () => {
  it('shows every hidden bug, who fell for it, and who the saboteur was', () => {
    const room = started(4, 'bbcccccbc');
    review(room, (id) => (id === 'p4' ? 'reject' : 'approve'));
    next(room);
    review(room, 'approve');
    assert.equal(gameView(room, 'p2', 0)!.debrief, null);
    next(room);
    const debrief = gameView(room, 'p2', 0)!.debrief!;
    assert.equal(debrief.saboteurId, 'p1');
    assert.equal(debrief.changes.length, 2);
    assert.deepEqual(debrief.changes[0].bug, CHANGES[BUGGED[0]].bug);
    assert.deepEqual(debrief.changes[0].votes, { p1: 'approve', p2: 'approve', p3: 'approve', p4: 'reject' });
  });

  it('returns to the lobby', () => {
    const room = started();
    assert.deepEqual(backToLobby(room), { ok: true });
    assert.equal(room.phase, 'lobby');
    assert.equal(room.game, null);
    assert.deepEqual(backToLobby(room), { ok: false, error: 'WRONG_PHASE' });
  });
});
