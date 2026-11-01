import {
  BUGGED_CHANGES,
  BUGS_TO_WIN,
  CLEAN_CHANGES,
  MAX_COMMENT_LENGTH,
  MIN_PLAYERS,
  RETRO_EVERY,
  RETRO_MS,
  REVIEW_MS,
  SHIP_TO_WIN,
} from '../shared/rules.js';
import type { ChangeView, GameView, Role, RoomError } from '../shared/types.js';
import { CHANGES, type Change } from './changes.js';
import type { Game, Room } from './model.js';

/** comments per player per discussion, and the minimum gap between two of them */
export const MAX_COMMENTS = 20;
export const COMMENT_GAP_MS = 750;

export type Rng = () => number;
export type GameResult = { ok: true } | { ok: false; error: RoomError };

const OK: GameResult = { ok: true };
const fail = (error: RoomError): GameResult => ({ ok: false, error });

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Picks n of `pool`, preferring changes this room hasn't played yet. */
function draw(pool: number[], n: number, played: Set<number>, rng: Rng): number[] {
  let fresh = pool.filter((i) => !played.has(i));
  if (fresh.length < n) {
    for (const i of pool) played.delete(i);
    fresh = pool;
  }
  return shuffle(fresh, rng).slice(0, n);
}

function currentChange(game: Game): Change {
  return CHANGES[game.queue[game.current]];
}

/** Online players who still vote: everyone not voted off the team. */
function voters(room: Room): string[] {
  const benched = room.game?.benched;
  return [...room.players.values()].filter((p) => p.online && !benched?.has(p.id)).map((p) => p.id);
}

function votesThisPhase(room: Room): Map<string, string> | null {
  if (!room.game) return null;
  if (room.phase === 'review') return room.game.verdicts;
  if (room.phase === 'retro') return room.game.retroVotes;
  return null;
}

function resetDiscussion(game: Game): void {
  game.comments = [];
  game.lastCommentAt = new Map();
}

export function startGame(room: Room, now: number, rng: Rng = Math.random): GameResult {
  if (room.phase !== 'lobby') return fail('WRONG_PHASE');
  const online = [...room.players.values()].filter((p) => p.online).map((p) => p.id);
  if (online.length < MIN_PLAYERS) return fail('NOT_ENOUGH_PLAYERS');

  const clean = draw(
    CHANGES.flatMap((c, i) => (c.bug ? [] : [i])),
    CLEAN_CHANGES,
    room.playedChanges,
    rng,
  );
  const bugged = draw(
    CHANGES.flatMap((c, i) => (c.bug ? [i] : [])),
    BUGGED_CHANGES,
    room.playedChanges,
    rng,
  );
  // One bug per stretch of the queue, so the team can't ship the release before any bug shows up.
  const queue = bugged.flatMap((bug, b) => {
    const from = Math.round((b * clean.length) / bugged.length);
    const to = Math.round(((b + 1) * clean.length) / bugged.length);
    return shuffle([bug, ...clean.slice(from, to)], rng);
  });
  for (const i of queue) room.playedChanges.add(i);

  room.game = {
    saboteurId: online[Math.floor(rng() * online.length)],
    queue,
    current: 0,
    shipped: 0,
    bugsShipped: 0,
    benched: new Set(),
    verdicts: new Map(),
    retroVotes: new Map(),
    reviewed: [],
    retro: null,
    comments: [],
    nextCommentId: 1,
    lastCommentAt: new Map(),
    winner: null,
    deadline: null,
  };
  beginReview(room, now);
  return OK;
}

function beginReview(room: Room, now: number): void {
  const game = room.game!;
  game.verdicts = new Map();
  resetDiscussion(game);
  game.deadline = now + REVIEW_MS;
  room.phase = 'review';
}

function beginRetro(room: Room, now: number): void {
  const game = room.game!;
  game.retroVotes = new Map();
  game.retro = null;
  resetDiscussion(game);
  game.deadline = now + RETRO_MS;
  room.phase = 'retro';
}

export function submitVerdict(room: Room, playerId: string, verdict: unknown, now: number): GameResult {
  const game = room.game;
  if (!game || room.phase !== 'review' || !room.players.has(playerId)) return fail('WRONG_PHASE');
  if (game.benched.has(playerId)) return fail('VOTED_OUT');
  if (verdict !== 'approve' && verdict !== 'reject') return fail('VOTE_INVALID');
  game.verdicts.set(playerId, verdict);
  maybeAdvance(room, now);
  return OK;
}

export function submitRetroVote(room: Room, playerId: string, vote: unknown, now: number): GameResult {
  const game = room.game;
  if (!game || room.phase !== 'retro' || !room.players.has(playerId)) return fail('WRONG_PHASE');
  if (game.benched.has(playerId)) return fail('VOTED_OUT');
  const valid =
    vote === 'skip' ||
    (typeof vote === 'string' && vote !== playerId && room.players.has(vote) && !game.benched.has(vote));
  if (!valid) return fail('VOTE_INVALID');
  game.retroVotes.set(playerId, vote);
  maybeAdvance(room, now);
  return OK;
}

export function addComment(room: Room, playerId: string, payload: unknown, now: number): GameResult {
  const game = room.game;
  const open = ['review', 'outcome', 'retro', 'verdict'].includes(room.phase);
  if (!game || !open || !room.players.has(playerId)) return fail('WRONG_PHASE');
  if (game.benched.has(playerId)) return fail('VOTED_OUT');

  const { text, line } = (payload ?? {}) as { text?: unknown; line?: unknown };
  const body = typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '';
  if (!body || body.length > MAX_COMMENT_LENGTH) return fail('COMMENT_INVALID');
  // Line comments only make sense while there's a change on screen.
  const onChange = room.phase === 'review' || room.phase === 'outcome';
  const lineCount = currentChange(game).lines.length;
  const hasLine = line !== undefined && line !== null;
  if (hasLine && !(onChange && Number.isInteger(line) && (line as number) >= 0 && (line as number) < lineCount)) {
    return fail('COMMENT_INVALID');
  }

  const last = game.lastCommentAt.get(playerId);
  const mine = game.comments.filter((c) => c.by === playerId).length;
  if ((last !== undefined && now - last < COMMENT_GAP_MS) || mine >= MAX_COMMENTS) return fail('COMMENT_LIMIT');
  game.lastCommentAt.set(playerId, now);
  game.comments.push({ id: game.nextCommentId++, by: playerId, text: body, line: hasLine ? (line as number) : null });
  return OK;
}

/** Ends the current review or retro early once every online voter has voted. */
export function maybeAdvance(room: Room, now: number): void {
  const votes = votesThisPhase(room);
  if (!votes) return;
  const waitingFor = voters(room);
  if (waitingFor.length > 0 && waitingFor.every((id) => votes.has(id))) endPhase(room, now);
}

/** Ends the current review or retro, whether everyone voted or time ran out. */
export function endPhase(room: Room, _now: number): void {
  if (room.phase === 'review') resolveReview(room);
  else if (room.phase === 'retro') resolveRetro(room);
}

function resolveReview(room: Room): void {
  const game = room.game!;
  const change = currentChange(game);
  let approvals = 0;
  let rejections = 0;
  for (const v of game.verdicts.values()) {
    if (v === 'approve') approvals++;
    else rejections++;
  }
  // Like a code review, a change needs more approvals than rejections: ties and silence block it.
  const merged = approvals > rejections;
  game.reviewed.push({ change: game.queue[game.current], merged, votes: game.verdicts });
  if (merged && change.bug) game.bugsShipped += 1;
  else if (merged) game.shipped += 1;

  const cleanLeft = game.queue.slice(game.current + 1).filter((i) => !CHANGES[i].bug).length;
  if (game.bugsShipped >= BUGS_TO_WIN) game.winner = { side: 'saboteur', reason: 'bugs' };
  else if (game.shipped >= SHIP_TO_WIN) game.winner = { side: 'reviewers', reason: 'shipped' };
  else if (game.shipped + cleanLeft < SHIP_TO_WIN) game.winner = { side: 'saboteur', reason: 'deadline' };

  game.deadline = null;
  room.phase = 'outcome';
}

function resolveRetro(room: Room): void {
  const game = room.game!;
  const tally = new Map<string, number>();
  for (const v of game.retroVotes.values()) tally.set(v, (tally.get(v) ?? 0) + 1);
  // Only a clear winner goes: a tie, or 'skip' coming out on top, keeps everyone.
  const top = Math.max(0, ...tally.values());
  const leaders = [...tally].filter(([, n]) => n === top).map(([v]) => v);
  const ejectedId = leaders.length === 1 && leaders[0] !== 'skip' ? leaders[0] : null;
  const wasSaboteur = ejectedId !== null && ejectedId === game.saboteurId;

  if (wasSaboteur) game.winner = { side: 'reviewers', reason: 'caught' };
  else if (ejectedId) game.benched.add(ejectedId);
  game.retro = { votes: Object.fromEntries(game.retroVotes), ejectedId, wasSaboteur };
  game.deadline = null;
  room.phase = 'verdict';
}

/** Host moves on from an outcome or verdict: to a retro, the next change, or the debrief. */
export function nextStep(room: Room, now: number): GameResult {
  const game = room.game;
  if (!game || (room.phase !== 'outcome' && room.phase !== 'verdict')) return fail('WRONG_PHASE');
  if (game.winner) {
    room.phase = 'debrief';
  } else if (room.phase === 'outcome' && (game.current + 1) % RETRO_EVERY === 0) {
    beginRetro(room, now);
  } else {
    game.current += 1;
    beginReview(room, now);
  }
  return OK;
}

export function backToLobby(room: Room): GameResult {
  if (room.phase === 'lobby') return fail('WRONG_PHASE');
  room.phase = 'lobby';
  room.game = null;
  return OK;
}

function changeView(change: Change): ChangeView {
  return { title: change.title, file: change.file, summary: change.summary, lines: change.lines };
}

export function gameView(room: Room, viewerId: string | undefined, now: number): GameView | null {
  const game = room.game;
  if (!game) return null;
  const seated = viewerId !== undefined && room.players.has(viewerId);
  const role: Role | null = seated ? (viewerId === game.saboteurId ? 'saboteur' : 'reviewer') : null;
  const onChange = room.phase === 'review' || room.phase === 'outcome';
  const change = currentChange(game);
  const votes = votesThisPhase(room);

  return {
    role,
    changeNumber: game.current + 1,
    totalChanges: game.queue.length,
    shipped: game.shipped,
    bugsShipped: game.bugsShipped,
    change: onChange ? changeView(change) : null,
    intel: onChange && role === 'saboteur' ? { bug: change.bug } : null,
    comments: game.comments,
    remainingMs: game.deadline === null ? null : Math.max(0, game.deadline - now),
    submitted: votes ? [...votes.keys()] : [],
    yourVerdict: seated ? (game.verdicts.get(viewerId) ?? null) : null,
    yourRetroVote: seated ? (game.retroVotes.get(viewerId) ?? null) : null,
    benched: [...game.benched],
    history: game.reviewed.map((r) => {
      const c = CHANGES[r.change];
      // Only a merged bug shows itself; what a rejected change hid stays secret until the debrief.
      return { title: c.title, merged: r.merged, bug: r.merged ? c.bug : null, votes: Object.fromEntries(r.votes) };
    }),
    retro: room.phase === 'verdict' ? game.retro : null,
    winner: game.winner,
    debrief:
      room.phase === 'debrief'
        ? {
            saboteurId: game.saboteurId,
            changes: game.reviewed.map((r) => {
              const c = CHANGES[r.change];
              return { ...changeView(c), merged: r.merged, bug: c.bug, votes: Object.fromEntries(r.votes) };
            }),
          }
        : null,
  };
}
