import type { Comment, RetroResult, RetroVote, RoomPhase, Side, Verdict, WinReason } from '../shared/types.js';

export interface InternalPlayer {
  /** public id, visible to everyone in the room */
  id: string;
  /** secret seat token; presenting it on join rebinds this seat */
  token: string;
  name: string;
  online: boolean;
  offlineSince: number | null;
  socketId: string | null;
}

export interface ReviewResult {
  /** index into CHANGES */
  change: number;
  merged: boolean;
  votes: Map<string, Verdict>;
}

export interface Game {
  saboteurId: string;
  /** indices into CHANGES, in the order the agent proposes them */
  queue: number[];
  /** position in the queue of the change being (or last) reviewed */
  current: number;
  /** clean changes merged */
  shipped: number;
  /** bugged changes merged */
  bugsShipped: number;
  /** players voted off the team at a retro */
  benched: Set<string>;
  verdicts: Map<string, Verdict>;
  retroVotes: Map<string, RetroVote>;
  reviewed: ReviewResult[];
  retro: RetroResult | null;
  /** discussion for the current change or retro */
  comments: Comment[];
  nextCommentId: number;
  lastCommentAt: Map<string, number>;
  winner: { side: Side; reason: WinReason } | null;
  /** when the current review or retro times out; null outside timed phases */
  deadline: number | null;
}

export interface Room {
  code: string;
  phase: RoomPhase;
  hostId: string | null;
  /** insertion order is seat order */
  players: Map<string, InternalPlayer>;
  game: Game | null;
  /** changes used in earlier games, so the next game prefers fresh ones */
  playedChanges: Set<number>;
}
