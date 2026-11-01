import type { RoomPhase, RoundReveal } from '../shared/types.js';

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

export interface Game {
  /** outsider rotation: round N's outsider is order[N - 1] when they're online */
  order: string[];
  round: number;
  totalRounds: number;
  cluePass: number;
  outsiderId: string;
  majorityWord: string;
  outsiderWord: string;
  /** clues from completed passes this round */
  clues: Map<string, (string | null)[]>;
  /** clues submitted during the current pass, hidden until it ends */
  pending: Map<string, string>;
  /** voterId -> targetId */
  votes: Map<string, string>;
  scores: Map<string, number>;
  reveal: RoundReveal | null;
  /** when the current clue/vote phase times out; null outside timed phases */
  deadline: number | null;
  usedPairs: Set<number>;
}

export interface Room {
  code: string;
  phase: RoomPhase;
  hostId: string | null;
  /** insertion order is seat order */
  players: Map<string, InternalPlayer>;
  game: Game | null;
}
