import { useEffect, useMemo, useState } from 'react';
import { CLUE_MS, MAX_CLUE_LENGTH, VOTE_MS } from '../shared/rules';
import type { GameView, Player, RoomState } from '../shared/types';
import { CheckIcon, CrownIcon } from './Icons';
import { Avatar, PlayerName } from './Players';
import { socket } from './socket';

interface PhaseProps {
  state: RoomState;
  game: GameView;
  isHost: boolean;
  byId: Map<string, Player>;
}

export default function GameScreen({ state, isHost }: { state: RoomState; isHost: boolean }): React.JSX.Element | null {
  const game = state.game;
  const byId = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);
  if (!game) return null;
  const props: PhaseProps = { state, game, isHost, byId };

  // The results screen is itself a scoreboard, so it gets the full width.
  const results = state.phase === 'results';
  return (
    <div className={results ? 'layout single' : 'layout'}>
      <div className="stack">
        <PhaseBar state={state} game={game} />
        {state.phase === 'clue' && <CluePhase key={`${game.round}-${game.cluePass}`} {...props} />}
        {state.phase === 'vote' && <VotePhase {...props} />}
        {state.phase === 'reveal' && <RevealPhase {...props} />}
        {results && <ResultsPhase {...props} />}
      </div>
      {!results && <Scoreboard {...props} />}
    </div>
  );
}

function PhaseBar({ state, game }: { state: RoomState; game: GameView }): React.JSX.Element {
  const steps = [...Array.from({ length: game.cluePasses }, (_, i) => `Clue ${i + 1}`), 'Vote', 'Reveal'];
  const current =
    state.phase === 'clue'
      ? game.cluePass - 1
      : state.phase === 'vote'
        ? game.cluePasses
        : state.phase === 'reveal'
          ? game.cluePasses + 1
          : steps.length;
  return (
    <div className="card phase-bar">
      <span className="round-pill">
        {state.phase === 'results' ? (
          `${game.totalRounds} rounds played`
        ) : (
          <>
            Round <strong>{game.round}</strong> / {game.totalRounds}
          </>
        )}
      </span>
      {state.phase === 'results' ? (
        <strong className="phase-title">Final results</strong>
      ) : (
        <ol className="steps" aria-label="Round progress">
          {steps.map((label, i) => (
            <li
              key={label}
              className={i < current ? 'done' : i === current ? 'active' : undefined}
              aria-current={i === current ? 'step' : undefined}
            >
              {label}
            </li>
          ))}
        </ol>
      )}
      {game.remainingMs !== null ? (
        <Countdown remainingMs={game.remainingMs} totalMs={state.phase === 'vote' ? VOTE_MS : CLUE_MS} />
      ) : (
        <span className="timer-spacer" />
      )}
    </div>
  );
}

const RING_RADIUS = 20;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function Countdown({ remainingMs, totalMs }: { remainingMs: number; totalMs: number }): React.JSX.Element {
  // remainingMs is measured server-side at send time, so anchor it to our own clock.
  const deadline = useMemo(() => Date.now() + remainingMs, [remainingMs]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, deadline - now);
  const secs = Math.ceil(left / 1000);
  const fraction = Math.min(1, left / totalMs);
  return (
    <span className={secs <= 10 ? 'timer urgent' : 'timer'} role="timer" aria-label={`${secs} seconds left`}>
      <svg viewBox="0 0 48 48" aria-hidden>
        <defs>
          <linearGradient id="timer-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--accent)' }} />
            <stop offset="1" style={{ stopColor: 'var(--accent-2)' }} />
          </linearGradient>
        </defs>
        <circle className="track" cx="24" cy="24" r={RING_RADIUS} />
        <circle
          className="progress"
          cx="24"
          cy="24"
          r={RING_RADIUS}
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - fraction)}
        />
      </svg>
      <span>{secs}</span>
    </span>
  );
}

function WordCard({ word }: { word: string | null }): React.JSX.Element {
  return (
    <section className="word-card">
      <span className="eyebrow">Your secret word</span>
      <strong className="word">{word ?? '—'}</strong>
      <span className="hint">One player has a different word. It might be you.</span>
    </section>
  );
}

function WaitingOn({ players }: { players: Player[] }): React.JSX.Element | null {
  if (players.length === 0) return null;
  return (
    <div className="waiting">
      <span className="avatar-stack">
        {players.map((p) => (
          <Avatar key={p.id} player={p} size="sm" />
        ))}
      </span>
      <span className="muted small">Waiting on {players.map((p) => p.name).join(', ')}…</span>
    </div>
  );
}

function ClueBoard({
  state,
  game,
  onVote,
  revealed,
}: PhaseProps & { onVote?: (id: string) => void; revealed?: boolean }): React.JSX.Element {
  const passes = Math.max(0, ...Object.values(game.clues).map((c) => c.length));
  if (passes === 0) {
    return <p className="muted card">Clues appear here once everyone has written theirs.</p>;
  }
  return (
    <section className="card">
      <h2>Clues</h2>
      <ul className="clue-board">
        {state.players.map((p, idx) => {
          const clues = game.clues[p.id] ?? [];
          const isYou = p.id === state.youId;
          const chosen = game.yourVote === p.id;
          const isOutsider = revealed && game.reveal?.outsiderId === p.id;
          const row = (
            <>
              <PlayerName player={p} youId={state.youId} />
              {isOutsider && <span className="tag odd">odd one out</span>}
              <span className="clues">
                {Array.from({ length: passes }, (_, i) => (
                  <span
                    key={i}
                    className={clues[i] ? 'clue' : 'clue empty'}
                    style={{ '--i': idx * passes + i } as React.CSSProperties}
                  >
                    {clues[i] ?? 'no clue'}
                  </span>
                ))}
              </span>
            </>
          );
          return (
            <li key={p.id} className={isOutsider ? 'outsider' : undefined}>
              {onVote && !isYou ? (
                <button
                  className={chosen ? 'vote-row chosen' : 'vote-row'}
                  aria-pressed={chosen}
                  onClick={() => onVote(p.id)}
                >
                  {row}
                  <span className="vote-mark">
                    {chosen ? (
                      <>
                        <CheckIcon /> Your vote
                      </>
                    ) : (
                      'Vote'
                    )}
                  </span>
                </button>
              ) : (
                <div className="vote-row static">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CluePhase(props: PhaseProps): React.JSX.Element {
  const { state, game } = props;
  const [draft, setDraft] = useState(game.yourClue ?? '');
  const me = state.players.find((p) => p.id === state.youId);
  const waitingOn = state.players.filter((p) => p.online && !game.submitted.includes(p.id));

  const submit = (): void => {
    if (draft.trim()) socket.emit('game:clue', draft.trim());
  };

  return (
    <>
      <WordCard word={game.yourWord} />
      <section className="card stack">
        <div>
          <h2>{game.cluePass === 1 ? 'Write a clue' : 'Write another clue'}</h2>
          <p className="muted small">
            Hint at your word without giving it away. Too vague looks suspicious; too obvious helps the odd one out.
          </p>
        </div>
        <form
          className="clue-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            aria-label="Your clue"
            value={draft}
            maxLength={MAX_CLUE_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="One or two words"
            autoFocus
            disabled={!me}
          />
          <button className="primary" type="submit" disabled={!draft.trim()}>
            {game.yourClue ? 'Update' : 'Submit'}
          </button>
        </form>
        {game.yourClue && (
          <p className="locked">
            <CheckIcon /> Locked in: “{game.yourClue}”. You can change it until everyone is in.
          </p>
        )}
        <WaitingOn players={waitingOn} />
      </section>
      <ClueBoard {...props} />
    </>
  );
}

function VotePhase(props: PhaseProps): React.JSX.Element {
  const { state, game } = props;
  const waitingOn = state.players.filter((p) => p.online && !game.submitted.includes(p.id));
  return (
    <>
      <WordCard word={game.yourWord} />
      <section className="card stack">
        <div>
          <h2>Who's the odd one out?</h2>
          <p className="muted small">Tap a player to vote. You can change your vote until everyone has voted.</p>
        </div>
        <WaitingOn players={waitingOn} />
      </section>
      <ClueBoard {...props} onVote={(id) => socket.emit('game:vote', id)} />
    </>
  );
}

function RevealPhase(props: PhaseProps): React.JSX.Element | null {
  const { state, game, isHost, byId } = props;
  const reveal = game.reveal;
  if (!reveal) return null;
  const outsider = byId.get(reveal.outsiderId);
  const outsiderName = outsider?.name ?? 'Someone';
  const lastRound = game.round >= game.totalRounds;
  const youWereOutsider = reveal.outsiderId === state.youId;

  return (
    <>
      <section className={reveal.caught ? 'card reveal caught' : 'card reveal escaped'}>
        <span className="stamp">{reveal.caught ? 'Caught!' : 'Slipped away!'}</span>
        <h2>{youWereOutsider ? 'You were' : `${outsiderName} was`} the odd one out</h2>
        <div className="words">
          <div className="word-tile">
            <span className="muted small">Everyone else</span>
            <strong>{reveal.majorityWord}</strong>
          </div>
          <span className="vs">vs</span>
          <div className="word-tile odd">
            <span className="muted small">{youWereOutsider ? 'You' : outsiderName}</span>
            <strong>{reveal.outsiderWord}</strong>
          </div>
        </div>
        <ul className="votes">
          {state.players.map((p) => {
            const target = reveal.votes[p.id];
            return (
              <li key={p.id}>
                <Avatar player={p} size="sm" /> {p.name} <span className="arrow">→</span>
                {target ? (
                  <strong className={target === reveal.outsiderId ? 'ok' : undefined}>
                    {byId.get(target)?.name ?? '?'}
                  </strong>
                ) : (
                  <span className="muted">no vote</span>
                )}
                {reveal.points[p.id] ? <span className="points">+{reveal.points[p.id]}</span> : null}
              </li>
            );
          })}
        </ul>
        {isHost ? (
          <button className="primary big" onClick={() => socket.emit('game:next')}>
            {lastRound ? 'See final results' : 'Next round'}
          </button>
        ) : (
          <p className="muted">Waiting for the host to continue…</p>
        )}
      </section>
      <ClueBoard {...props} revealed />
    </>
  );
}

const CONFETTI_COLORS = ['var(--accent)', 'var(--accent-2)', 'var(--accent-3)', 'var(--ok)', '#38bdf8'];

function Confetti(): React.JSX.Element {
  return (
    <div className="confetti" aria-hidden>
      {Array.from({ length: 40 }, (_, i) => (
        <i
          key={i}
          style={
            {
              '--x': `${(i * 37) % 100}%`,
              '--delay': `${((i * 7) % 20) / 10}s`,
              '--dur': `${2.4 + (i % 5) * 0.4}s`,
              '--spin': `${(i % 2 ? 1 : -1) * (360 + i * 23)}deg`,
              '--c': CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

function ResultsPhase({ state, game, isHost, byId }: PhaseProps): React.JSX.Element {
  const ranked = Object.entries(game.scores).sort((a, b) => b[1] - a[1]);
  const top = ranked[0]?.[1] ?? 0;
  const placeOf = (score: number): number => 1 + ranked.filter(([, s]) => s > score).length;
  const winners = ranked.filter(([, s]) => s === top).map(([id]) => byId.get(id)?.name ?? '?');
  // Podium order: 2nd, 1st, 3rd.
  const podium = [ranked[1], ranked[0], ranked[2]].filter((e) => e !== undefined);
  const rest = ranked.slice(3);

  return (
    <section className="card results">
      <Confetti />
      <span className="eyebrow">Final results</span>
      <h2 className="headline">{winners.length > 1 ? `It's a tie: ${winners.join(' & ')}!` : `${winners[0]} wins!`}</h2>
      <div className="podium">
        {podium.map(([id, score]) => {
          const p = byId.get(id);
          const place = placeOf(score);
          return (
            <div key={id} className={`podium-col place-${place}`}>
              {place === 1 && (
                <span className="crown">
                  <CrownIcon />
                </span>
              )}
              {p && <Avatar player={p} size="lg" />}
              <span className="podium-name">
                {p?.name ?? '?'}
                {id === state.youId && <span className="tag">you</span>}
              </span>
              <div className="podium-block">
                <span className="place">{place}</span>
                <span className="podium-score">{score} pts</span>
              </div>
            </div>
          );
        })}
      </div>
      {rest.length > 0 && (
        <ol className="ranking">
          {rest.map(([id, score]) => {
            const p = byId.get(id);
            return (
              <li key={id}>
                <span className="place-num">{placeOf(score)}</span>
                {p ? <PlayerName player={p} youId={state.youId} /> : '?'}
                <strong>{score}</strong>
              </li>
            );
          })}
        </ol>
      )}
      {isHost ? (
        <button className="primary big" onClick={() => socket.emit('game:lobby')}>
          Back to lobby
        </button>
      ) : (
        <p className="muted">Waiting for the host to start a new game…</p>
      )}
    </section>
  );
}

function Scoreboard({ state, game }: PhaseProps): React.JSX.Element {
  const acting = state.phase === 'clue' || state.phase === 'vote';
  const players = [...state.players].sort((a, b) => (game.scores[b.id] ?? 0) - (game.scores[a.id] ?? 0));
  const best = Math.max(1, ...players.map((p) => game.scores[p.id] ?? 0));
  return (
    <aside className="card scoreboard">
      <h2>Scores</h2>
      <ul className="score-list">
        {players.map((p) => {
          const score = game.scores[p.id] ?? 0;
          return (
            <li key={p.id}>
              <div className="score-row">
                <PlayerName player={p} youId={state.youId} />
                <span className="aside">
                  {acting && game.submitted.includes(p.id) && (
                    <span className="done-check" role="img" aria-label="Done" title="Done">
                      <CheckIcon />
                    </span>
                  )}
                  <strong>{score}</strong>
                </span>
              </div>
              <span className="score-bar">
                <span style={{ width: `${(score / best) * 100}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
