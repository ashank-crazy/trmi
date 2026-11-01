import { CLUE_MS, MAX_CLUE_LENGTH, MIN_PLAYERS, VOTE_MS } from '../shared/rules.js';
import { WORD_PAIRS } from './words.js';
export const CLUE_PASSES = 2;
/** awarded to each player who voted for the outsider, when the outsider is caught */
export const CATCH_POINTS = 1;
/** awarded to the outsider when they escape */
export const ESCAPE_POINTS = 3;
const OK = { ok: true };
const fail = (error) => ({ ok: false, error });
function onlineIds(room) {
    return [...room.players.values()].filter((p) => p.online).map((p) => p.id);
}
function pick(items, rng) {
    return items[Math.floor(rng() * items.length)];
}
function shuffle(items, rng) {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function normalize(text) {
    return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function wordFor(game, playerId) {
    return playerId === game.outsiderId ? game.outsiderWord : game.majorityWord;
}
function actedThisPhase(room) {
    if (!room.game)
        return null;
    if (room.phase === 'clue')
        return room.game.pending;
    if (room.phase === 'vote')
        return room.game.votes;
    return null;
}
export function startGame(room, now, rng = Math.random) {
    if (room.phase !== 'lobby')
        return fail('WRONG_PHASE');
    if (onlineIds(room).length < MIN_PLAYERS)
        return fail('NOT_ENOUGH_PLAYERS');
    const order = shuffle([...room.players.keys()], rng);
    room.game = {
        order,
        round: 0,
        totalRounds: order.length,
        cluePass: 1,
        outsiderId: '',
        majorityWord: '',
        outsiderWord: '',
        clues: new Map(),
        pending: new Map(),
        votes: new Map(),
        scores: new Map(order.map((id) => [id, 0])),
        reveal: null,
        deadline: null,
        usedPairs: new Set(),
    };
    beginRound(room, now, rng);
    return OK;
}
function beginRound(room, now, rng) {
    const game = room.game;
    game.round += 1;
    // Everyone gets a turn as the outsider; if it's someone's turn while they're
    // offline, hand it to a random online player instead so the round is playable.
    const planned = game.order[game.round - 1];
    const online = onlineIds(room);
    game.outsiderId = room.players.get(planned)?.online || online.length === 0 ? planned : pick(online, rng);
    if (game.usedPairs.size >= WORD_PAIRS.length)
        game.usedPairs.clear();
    const unused = WORD_PAIRS.map((_, i) => i).filter((i) => !game.usedPairs.has(i));
    const pairIndex = pick(unused, rng);
    game.usedPairs.add(pairIndex);
    const [a, b] = WORD_PAIRS[pairIndex];
    [game.majorityWord, game.outsiderWord] = rng() < 0.5 ? [a, b] : [b, a];
    game.cluePass = 1;
    game.clues = new Map();
    game.pending = new Map();
    game.votes = new Map();
    game.reveal = null;
    game.deadline = now + CLUE_MS;
    room.phase = 'clue';
}
export function submitClue(room, playerId, text, now) {
    const game = room.game;
    if (!game || room.phase !== 'clue' || !room.players.has(playerId))
        return fail('WRONG_PHASE');
    const clue = typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '';
    if (!clue || clue.length > MAX_CLUE_LENGTH)
        return fail('CLUE_INVALID');
    const word = normalize(wordFor(game, playerId));
    if (normalize(clue).includes(word))
        return fail('CLUE_HAS_WORD');
    game.pending.set(playerId, clue);
    maybeAdvance(room, now);
    return OK;
}
export function submitVote(room, playerId, targetId, now) {
    const game = room.game;
    if (!game || room.phase !== 'vote' || !room.players.has(playerId))
        return fail('WRONG_PHASE');
    if (typeof targetId !== 'string' || targetId === playerId || !room.players.has(targetId))
        return fail('VOTE_INVALID');
    game.votes.set(playerId, targetId);
    maybeAdvance(room, now);
    return OK;
}
/** Ends the current clue/vote phase early once every online player has acted. */
export function maybeAdvance(room, now) {
    const acted = actedThisPhase(room);
    if (!acted)
        return;
    const online = onlineIds(room);
    if (online.length > 0 && online.every((id) => acted.has(id)))
        endPhase(room, now);
}
/** Ends the current clue/vote phase, whether everyone acted or time ran out. */
export function endPhase(room, now) {
    const game = room.game;
    if (!game)
        return;
    if (room.phase === 'clue') {
        for (const id of room.players.keys()) {
            game.clues.set(id, [...(game.clues.get(id) ?? []), game.pending.get(id) ?? null]);
        }
        game.pending = new Map();
        if (game.cluePass < CLUE_PASSES) {
            game.cluePass += 1;
            game.deadline = now + CLUE_MS;
        }
        else {
            room.phase = 'vote';
            game.deadline = now + VOTE_MS;
        }
        return;
    }
    if (room.phase === 'vote')
        scoreRound(room);
}
function scoreRound(room) {
    const game = room.game;
    const tally = new Map();
    for (const target of game.votes.values())
        tally.set(target, (tally.get(target) ?? 0) + 1);
    // The outsider is only caught with a strict plurality; a tie lets them slip away.
    const outsiderVotes = tally.get(game.outsiderId) ?? 0;
    const caught = outsiderVotes > 0 && [...tally].every(([id, n]) => id === game.outsiderId || n < outsiderVotes);
    const points = {};
    if (caught) {
        for (const [voter, target] of game.votes)
            if (target === game.outsiderId)
                points[voter] = CATCH_POINTS;
    }
    else {
        points[game.outsiderId] = ESCAPE_POINTS;
    }
    for (const [id, n] of Object.entries(points))
        game.scores.set(id, (game.scores.get(id) ?? 0) + n);
    game.reveal = {
        outsiderId: game.outsiderId,
        majorityWord: game.majorityWord,
        outsiderWord: game.outsiderWord,
        votes: Object.fromEntries(game.votes),
        caught,
        points,
    };
    game.deadline = null;
    room.phase = 'reveal';
}
export function nextRound(room, now, rng = Math.random) {
    const game = room.game;
    if (!game || room.phase !== 'reveal')
        return fail('WRONG_PHASE');
    if (game.round >= game.totalRounds) {
        room.phase = 'results';
        game.deadline = null;
    }
    else {
        beginRound(room, now, rng);
    }
    return OK;
}
export function backToLobby(room) {
    if (room.phase === 'lobby')
        return fail('WRONG_PHASE');
    room.phase = 'lobby';
    room.game = null;
    return OK;
}
export function gameView(room, viewerId, now) {
    const game = room.game;
    if (!game)
        return null;
    const acted = actedThisPhase(room);
    const seated = viewerId !== undefined && room.players.has(viewerId);
    return {
        round: game.round,
        totalRounds: game.totalRounds,
        cluePass: game.cluePass,
        cluePasses: CLUE_PASSES,
        remainingMs: game.deadline === null ? null : Math.max(0, game.deadline - now),
        yourWord: seated ? wordFor(game, viewerId) : null,
        clues: Object.fromEntries(game.clues),
        submitted: acted ? [...acted.keys()] : [],
        yourClue: seated ? (game.pending.get(viewerId) ?? null) : null,
        yourVote: seated ? (game.votes.get(viewerId) ?? null) : null,
        scores: Object.fromEntries(game.scores),
        reveal: game.reveal,
    };
}
//# sourceMappingURL=game.js.map