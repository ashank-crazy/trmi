import { CHANGES } from './changes.js';
import type { Rng } from './game.js';
import type { Game, Room } from './model.js';
import type { RetroVote, Verdict } from '../shared/types.js';

export const BOT_NAMES = ['Ada', 'Linus', 'Grace', 'Ken', 'Radia', 'Barbara'];

/** how often a reviewer bot notices a hidden bug, or raises a false alarm on a clean change */
export const SPOT_CHANCE = 0.45;
export const FALSE_ALARM_CHANCE = 0.12;
/** how often a saboteur bot blocks a clean change to slow the release */
export const SABOTEUR_BLOCK_CHANCE = 0.25;
/** how often a bot passes at a retro even with someone to suspect */
const RETRO_SKIP_CHANCE = 0.2;

const FINE = ['Looks fine to me.', 'Reads clean.', 'LGTM.', 'No objections from me.'];
const WORRIED = [
  'Something looks off on this line.',
  'Are we sure about this line?',
  'What happens on the failure path here?',
  "I'd want a test around this before it merges.",
];
const DEFEND = [
  "I went through this one. It's fine.",
  'Small change, low risk. Ship it.',
  'Looks good. We need this for the release.',
];
const NITPICK = ["Not convinced we need this right now.", 'This feels risky this close to the release.'];

export type BotAct =
  | { type: 'verdict'; verdict: Verdict }
  | { type: 'retro'; vote: RetroVote }
  | { type: 'comment'; text: string; line: number | null };

export interface BotMove {
  bot: string;
  at: number;
  act: BotAct;
}

let pace = 1;

/** Test hook: scales every bot delay. */
export function setBotPace(scale: number): void {
  pace = scale;
}

const pick = <T>(items: readonly T[], rng: Rng): T => items[Math.floor(rng() * items.length)];
const between = (from: number, to: number, rng: Rng): number => (from + rng() * (to - from)) * pace;

function activeBots(room: Room, game: Game): string[] {
  return [...room.players.values()].filter((p) => p.bot && !game.benched.has(p.id)).map((p) => p.id);
}

function planReview(_room: Room, game: Game, bot: string, now: number, rng: Rng): BotMove[] {
  const change = CHANGES[game.queue[game.current]];
  // Lines worth doubting: skips bare closing braces.
  const added = change.lines.flatMap((l, i) => (l.kind === 'add' && l.text.trim().length > 2 ? [i] : []));
  const voteAt = now + between(8_000, 26_000, rng);
  const speakAt = now + between(3_000, 7_000, rng);
  const say = (text: string, line: number | null, at = speakAt): BotMove => ({ bot, at, act: { type: 'comment', text, line } });
  const vote = (verdict: Verdict): BotMove => ({ bot, at: voteAt, act: { type: 'verdict', verdict } });

  if (bot === game.saboteurId) {
    // Speaks late, so it can look like a calm reply to whoever raised a doubt.
    if (change.bug) return [say(pick(DEFEND, rng), null, now + between(9_000, 15_000, rng)), vote('approve')];
    if (rng() < SABOTEUR_BLOCK_CHANCE) return [say(pick(NITPICK, rng), null), vote('reject')];
    return [vote('approve')];
  }
  if (change.bug && rng() < SPOT_CHANCE) return [say(pick(WORRIED, rng), change.bug.line), vote('reject')];
  if (rng() < FALSE_ALARM_CHANCE) return [say(pick(WORRIED, rng), added.length ? pick(added, rng) : null), vote('reject')];
  return rng() < 0.5 ? [say(pick(FINE, rng), null), vote('approve')] : [vote('approve')];
}

/** What everyone can see: who approved a merged bug, and who blocked a change that turned out clean. */
export function suspicion(game: Game): Map<string, number> {
  const scores = new Map<string, number>();
  const add = (id: string, n: number): void => void scores.set(id, (scores.get(id) ?? 0) + n);
  for (const r of game.reviewed) {
    if (!r.merged) continue;
    for (const [id, verdict] of r.votes) {
      if (CHANGES[r.change].bug) add(id, verdict === 'approve' ? 2 : -1);
      else if (verdict === 'reject') add(id, 1);
    }
  }
  return scores;
}

function planRetro(room: Room, game: Game, bot: string, now: number, rng: Rng): BotMove[] {
  const scores = suspicion(game);
  const others = [...room.players.values()].filter((p) => p.id !== bot && !game.benched.has(p.id));
  const top = Math.max(0, ...others.map((p) => scores.get(p.id) ?? 0));
  const suspects = others.filter((p) => (scores.get(p.id) ?? 0) === top);
  const suspect = top > 0 && rng() >= RETRO_SKIP_CHANCE ? pick(suspects, rng) : null;
  const moves: BotMove[] = [{ bot, at: now + between(8_000, 22_000, rng), act: { type: 'retro', vote: suspect?.id ?? 'skip' } }];
  if (rng() < 0.6) {
    const text = suspect ? `${suspect.name}'s votes look bad to me.` : "Nothing solid yet. I'd skip.";
    moves.push({ bot, at: now + between(2_000, 7_000, rng), act: { type: 'comment', text, line: null } });
  }
  return moves;
}

/** Decides what each bot does this review or retro, and when. */
export function planMoves(room: Room, now: number, rng: Rng = Math.random): BotMove[] {
  const game = room.game;
  if (!game) return [];
  const plan = room.phase === 'review' ? planReview : room.phase === 'retro' ? planRetro : null;
  if (!plan) return [];
  return activeBots(room, game).flatMap((bot) => plan(room, game, bot, now, rng));
}

/** Once every human has voted, nobody should sit and wait for the bots. */
export function hurry(room: Room, moves: BotMove[], now: number): void {
  const votes = room.phase === 'review' ? room.game?.verdicts : room.game?.retroVotes;
  const humans = [...room.players.values()].filter((p) => !p.bot && p.online && !room.game?.benched.has(p.id));
  if (!votes || !humans.every((p) => votes.has(p.id))) return;
  moves
    .filter((m) => m.act.type !== 'comment')
    .forEach((m, i) => {
      m.at = Math.min(m.at, now + (500 + i * 400) * pace);
    });
}
