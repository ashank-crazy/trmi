export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  online: boolean;
  isBot: boolean;
}

export type RoomPhase = 'lobby' | 'review' | 'outcome' | 'retro' | 'verdict' | 'debrief';

export type Role = 'reviewer' | 'saboteur';
export type Verdict = 'approve' | 'reject';
/** a retro vote: the id of the player to vote out, or 'skip' */
export type RetroVote = string;
export type Side = 'reviewers' | 'saboteur';
/** shipped: reviewers merged enough clean changes. caught: the saboteur was voted out.
 *  bugs: enough bugs were merged. deadline: too many clean changes were rejected to ship. */
export type WinReason = 'shipped' | 'caught' | 'bugs' | 'deadline';

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx';
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface ChangeView {
  title: string;
  file: string;
  /** what the agent says the change does */
  summary: string;
  lines: DiffLine[];
}

export interface Bug {
  /** index into the change's lines */
  line: number;
  explanation: string;
}

export interface Comment {
  id: number;
  by: string;
  text: string;
  /** index into the current change's lines, for a comment on a line */
  line: number | null;
}

/** A reviewed change, as everyone sees it once the vote is in. */
export interface ChangeRecord {
  title: string;
  merged: boolean;
  /** set when the change was merged and hid a bug; rejected changes stay secret until the debrief */
  bug: Bug | null;
  votes: Record<string, Verdict>;
}

export interface RetroResult {
  votes: Record<string, RetroVote>;
  ejectedId: string | null;
  wasSaboteur: boolean;
}

export interface DebriefChange extends ChangeView {
  merged: boolean;
  bug: Bug | null;
  votes: Record<string, Verdict>;
}

export interface Debrief {
  saboteurId: string;
  /** every reviewed change, in order, with its hidden bug (if any) */
  changes: DebriefChange[];
}

export interface GameView {
  role: Role | null;
  /** 1-based position of the current change in the agent's queue */
  changeNumber: number;
  totalChanges: number;
  shipped: number;
  bugsShipped: number;
  /** the change under review (review and outcome phases) */
  change: ChangeView | null;
  /** saboteur only: the current change's bug, or null when it's clean */
  intel: { bug: Bug | null } | null;
  /** discussion for the current change or retro */
  comments: Comment[];
  /** time left in the current review or retro, measured when the state was sent */
  remainingMs: number | null;
  /** players who have voted in the current review or retro */
  submitted: string[];
  yourVerdict: Verdict | null;
  yourRetroVote: RetroVote | null;
  /** players voted off the team at a retro */
  benched: string[];
  /** every change reviewed so far, oldest first; during the outcome phase the last one is current */
  history: ChangeRecord[];
  /** the latest retro's result (verdict phase) */
  retro: RetroResult | null;
  /** set as soon as the game is decided */
  winner: { side: Side; reason: WinReason } | null;
  debrief: Debrief | null;
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
  | 'VOTE_INVALID'
  | 'VOTED_OUT'
  | 'COMMENT_INVALID'
  | 'COMMENT_LIMIT'
  | 'SESSION_REPLACED';

export type JoinResponse = { ok: true; state: RoomState } | { ok: false; error: RoomError };

export type ClientToServerEvents = {
  'room:create': (payload: { name: string; bots?: number }) => void;
  'room:join': (payload: { code: string; name: string; token?: string }, callback?: (res: JoinResponse) => void) => void;
  'room:leave': () => void;
  'room:addBots': (count: number) => void;
  'room:removeBot': (id: string) => void;
  'game:start': () => void;
  'game:verdict': (verdict: Verdict) => void;
  'game:retro': (vote: RetroVote) => void;
  'game:comment': (payload: { text: string; line?: number | null }) => void;
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
