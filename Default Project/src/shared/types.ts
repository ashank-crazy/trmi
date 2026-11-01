export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  online: boolean;
}

export type RoomPhase = 'lobby' | 'clue' | 'vote' | 'reveal' | 'results';

export interface RoundReveal {
  outsiderId: string;
  majorityWord: string;
  outsiderWord: string;
  /** voterId -> targetId */
  votes: Record<string, string>;
  caught: boolean;
  /** points gained this round, by player id */
  points: Record<string, number>;
}

export interface GameView {
  round: number;
  totalRounds: number;
  /** 1-based clue pass within the current round */
  cluePass: number;
  cluePasses: number;
  /** time left in the current clue/vote phase, measured when the state was sent */
  remainingMs: number | null;
  yourWord: string | null;
  /** clues from completed passes, by player id (one entry per pass, null = no clue given) */
  clues: Record<string, (string | null)[]>;
  /** players who have already acted in the current clue/vote phase */
  submitted: string[];
  yourClue: string | null;
  yourVote: string | null;
  scores: Record<string, number>;
  reveal: RoundReveal | null;
}

export interface RoomState {
  code: string;
  hostId: string | null;
  players: Player[];
  phase: RoomPhase;
  game: GameView | null;
  youId?: string;
  /** secret seat token, only ever sent to its owner */
  youToken?: string;
}

export type RoomError =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'NAME_REQUIRED'
  | 'GAME_IN_PROGRESS'
  | 'NOT_HOST'
  | 'NOT_ENOUGH_PLAYERS'
  | 'WRONG_PHASE'
  | 'CLUE_INVALID'
  | 'CLUE_HAS_WORD'
  | 'VOTE_INVALID'
  | 'SESSION_REPLACED';

export type JoinResponse = { ok: true; state: RoomState } | { ok: false; error: RoomError };

export type ClientToServerEvents = {
  'room:create': (payload: { name: string }) => void;
  'room:join': (payload: { code: string; name: string; token?: string }, callback?: (res: JoinResponse) => void) => void;
  'room:leave': () => void;
  'game:start': () => void;
  'game:clue': (text: string) => void;
  'game:vote': (targetId: string) => void;
  'game:next': () => void;
  'game:lobby': () => void;
};

export type ServerToClientEvents = {
  'room:state': (state: RoomState) => void;
  'room:error': (error: RoomError) => void;
};

export type InterServerEvents = Record<string, never>;

export type SocketData = {
  roomCode?: string;
  playerId?: string;
};
