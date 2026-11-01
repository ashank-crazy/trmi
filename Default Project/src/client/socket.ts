import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, RoomError, ServerToClientEvents } from '../shared/types';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({ autoConnect: false });

const NAME_KEY = 'game.name';
const tokenKey = (code: string): string => `game.token.${code}`;

function safely<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function getName(): string {
  return safely(() => localStorage.getItem(NAME_KEY) ?? '', '');
}

export function saveName(name: string): void {
  safely(() => localStorage.setItem(NAME_KEY, name), undefined);
}

// Seat tokens live in sessionStorage: a refresh keeps your seat, while each new
// tab is a separate player (handy for testing a 4-player game on one machine).
export function getToken(code: string): string | undefined {
  return safely(() => sessionStorage.getItem(tokenKey(code)) ?? undefined, undefined);
}

export function saveToken(code: string, token: string): void {
  safely(() => sessionStorage.setItem(tokenKey(code), token), undefined);
}

export function clearToken(code: string): void {
  safely(() => sessionStorage.removeItem(tokenKey(code)), undefined);
}

const ERROR_TEXT: Record<RoomError, string> = {
  ROOM_NOT_FOUND: "That room doesn't exist.",
  ROOM_FULL: 'That room is full (6 players max).',
  NAME_REQUIRED: 'Enter a name (up to 20 characters).',
  GAME_IN_PROGRESS: 'A game is already underway in that room.',
  NOT_HOST: 'Only the host can do that.',
  NOT_ENOUGH_PLAYERS: 'Need at least 4 players online to start.',
  WRONG_PHASE: "That isn't possible right now.",
  CLUE_INVALID: 'Clues must be 1–24 characters.',
  CLUE_HAS_WORD: "Your clue can't contain your word.",
  VOTE_INVALID: "You can't vote for that player.",
  SESSION_REPLACED: 'This seat was opened in another tab.',
};

export function errorText(error: RoomError | string): string {
  return ERROR_TEXT[error as RoomError] ?? error.replace(/_/g, ' ').toLowerCase();
}
