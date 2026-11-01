import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { BUGS_TO_WIN, MAX_COMMENT_LENGTH, RETRO_EVERY, RETRO_MS, REVIEW_MS, SHIP_TO_WIN } from '../shared/rules';
import type {
  Bug,
  ChangeRecord,
  Debrief,
  DebriefChange,
  DiffLine,
  GameView,
  Player,
  RoomState,
  Verdict,
  WinReason,
} from '../shared/types';
import { DiffView, highlight, langOf, lineLabel } from './Diff';
import { BotIcon, BugIcon, CheckIcon, ShieldIcon, XIcon } from './Icons';
import { Avatar, PlayerName } from './Players';
import { socket } from './socket';

interface PhaseProps {
  state: RoomState;
  game: GameView;
  isHost: boolean;
  byId: Map<string, Player>;
}

interface LineProps {
  /** the diff line picked for the next comment */
  line: number | null;
  onSelectLine: (index: number) => void;
}

const WIN_TEXT: Record<WinReason, string> = {
  shipped: `The team shipped ${SHIP_TO_WIN} clean changes. The release is out!`,
  caught: 'The team voted out the saboteur.',
  bugs: `${BUGS_TO_WIN} bugs made it into production.`,
  deadline: `Too many clean changes were rejected, so the release can't ship ${SHIP_TO_WIN} in time.`,
};

function isBenched(state: RoomState, game: GameView): boolean {
  return state.youId !== undefined && game.benched.includes(state.youId);
}

/** Online players who still have to vote in the current review or retro. */
function waitingOn(state: RoomState, game: GameView): Player[] {
  return state.players.filter((p) => p.online && !game.benched.includes(p.id) && !game.submitted.includes(p.id));
}

export default function GameScreen({ state, isHost }: { state: RoomState; isHost: boolean }): React.JSX.Element | null {
  const game = state.game;
  const byId = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);
  // A picked line belongs to one change; it's dropped as soon as the next one comes up.
  const [picked, setPicked] = useState<{ change: number; line: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Each new step replaces the main column, so start reading it from the top.
  const step = `${state.phase}-${game?.changeNumber}`;
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);
  if (!game) return null;
  const props: PhaseProps = { state, game, isHost, byId };

  if (state.phase === 'debrief') return <DebriefPhase {...props} />;

  const onChange = game.change !== null;
  const line = onChange && picked?.change === game.changeNumber ? picked.line : null;
  const lineProps: LineProps = {
    line,
    onSelectLine: (index) => {
      setPicked({ change: game.changeNumber, line: index });
      const input = inputRef.current;
      if (!input) return;
      // Scroll only if the box is off screen, so buttons don't shift under the cursor for nothing.
      const box = input.getBoundingClientRect();
      input.focus({ preventScroll: box.top >= 0 && box.bottom <= window.innerHeight });
    },
  };

  return (
    <div className="game">
      <StatusBar state={state} game={game} />
      <div className="layout">
        <div className="stack">
          {state.phase === 'review' && <ReviewPhase {...props} {...lineProps} />}
          {state.phase === 'outcome' && <OutcomePhase {...props} {...lineProps} />}
          {state.phase === 'retro' && <RetroPhase {...props} />}
          {state.phase === 'verdict' && <VerdictPhase {...props} />}
        </div>
        <aside className="stack">
          <RoleCard state={state} game={game} />
          <Discussion {...props} line={line} onClearLine={() => setPicked(null)} inputRef={inputRef} />
          <TeamPanel {...props} />
        </aside>
      </div>
    </div>
  );
}

function StatusBar({ state, game }: { state: RoomState; game: GameView }): React.JSX.Element {
  const retro = state.phase === 'retro' || state.phase === 'verdict';
  return (
    <div className="card status-bar">
      <span className="round-pill">
        {retro ? (
          <strong>Retro</strong>
        ) : (
          <>
            Change <strong>{game.changeNumber}</strong> / {game.totalChanges}
          </>
        )}
      </span>
      <div className="tracks">
        <Meter kind="ship" label="Shipped" value={game.shipped} goal={SHIP_TO_WIN} />
        <Meter kind="bug" label="Bugs merged" value={game.bugsShipped} goal={BUGS_TO_WIN} />
      </div>
      {game.remainingMs !== null ? (
        <Countdown remainingMs={game.remainingMs} totalMs={state.phase === 'retro' ? RETRO_MS : REVIEW_MS} />
      ) : (
        <span className="timer-spacer" />
      )}
    </div>
  );
}

function Meter({
  kind,
  label,
  value,
  goal,
}: {
  kind: 'ship' | 'bug';
  label: string;
  value: number;
  goal: number;
}): React.JSX.Element {
  return (
    <span className={`meter ${kind}`} role="img" aria-label={`${label}: ${value} of ${goal}`}>
      <span className="meter-label">{label}</span>
      <span className="pips">
        {Array.from({ length: goal }, (_, i) => (
          <i key={i} className={i < value ? 'on' : undefined} />
        ))}
      </span>
    </span>
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

function RoleCard({ state, game }: { state: RoomState; game: GameView }): React.JSX.Element {
  if (game.role === 'saboteur') {
    return (
      <section className="card role-card saboteur">
        <span className="role-icon">
          <BugIcon size={22} />
        </span>
        <div>
          <strong>You're the saboteur</strong>
          <p>Get {BUGS_TO_WIN} bugs merged without getting caught. Only you can see where they hide.</p>
        </div>
      </section>
    );
  }
  const benched = isBenched(state, game);
  return (
    <section className={benched ? 'card role-card benched' : 'card role-card reviewer'}>
      <span className="role-icon">
        <ShieldIcon size={22} />
      </span>
      <div>
        <strong>{benched ? 'You were voted out' : "You're a reviewer"}</strong>
        <p>
          {benched
            ? "You weren't the saboteur. You can watch the rest, but you can't vote or comment."
            : `Ship ${SHIP_TO_WIN} clean changes and keep the bugs out. One of your teammates is lying.`}
        </p>
      </div>
    </section>
  );
}

function TeamPanel({ state, game }: PhaseProps): React.JSX.Element {
  const voting = state.phase === 'review' || state.phase === 'retro';
  return (
    <section className="card">
      <h2>Team</h2>
      <ul className="team-list">
        {state.players.map((p) => {
          const out = game.benched.includes(p.id);
          return (
            <li key={p.id} className={out ? 'benched' : undefined}>
              <PlayerName player={p} youId={state.youId} />
              <span className="aside">
                {out && <span className="tag out">voted out</span>}
                {voting && game.submitted.includes(p.id) && (
                  <span className="done-check" role="img" aria-label="Voted" title="Voted">
                    <CheckIcon />
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Discussion({
  state,
  game,
  byId,
  line,
  onClearLine,
  inputRef,
}: PhaseProps & {
  line: number | null;
  onClearLine: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const count = game.comments.length;
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [count]);

  const lines = game.change?.lines ?? [];
  const onChange = game.change !== null;
  const send = (): void => {
    const text = draft.trim();
    if (!text) return;
    socket.emit('game:comment', { text, line });
    setDraft('');
    onClearLine();
  };

  return (
    <section className="card discussion">
      <h2>{onChange ? 'Review comments' : 'Retro chat'}</h2>
      <ul className="comment-list" ref={listRef} aria-live="polite">
        {count === 0 && (
          <li className="empty-note">
            {onChange
              ? 'No comments yet. Click a line number in the diff to comment on that line.'
              : 'Make your case. Who keeps approving the bugs?'}
          </li>
        )}
        {game.comments.map((c) => {
          const author = byId.get(c.by);
          return (
            <li key={c.id} className="comment">
              {author && <Avatar player={author} size="sm" />}
              <div>
                <span className="comment-head">
                  <strong>{author?.name ?? '?'}</strong>
                  {c.line !== null && <span className="line-chip">{lineLabel(lines, c.line)}</span>}
                </span>
                <p>{c.text}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {isBenched(state, game) ? (
        <p className="muted small">You were voted out, so you can't comment.</p>
      ) : (
        <form
          className="comment-form"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          {line !== null && (
            <button type="button" className="line-chip removable" onClick={onClearLine}>
              On {lineLabel(lines, line)} <XIcon size={12} />
            </button>
          )}
          <div className="row">
            <input
              ref={inputRef}
              aria-label="Comment"
              value={draft}
              maxLength={MAX_COMMENT_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={onChange ? 'Comment on this change…' : 'Say something…'}
            />
            <button className="primary" type="submit" disabled={!draft.trim()}>
              Send
            </button>
          </div>
        </form>
      )}
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

function Intel({ bug, lines }: { bug: Bug | null; lines: DiffLine[] }): React.JSX.Element {
  return bug ? (
    <div className="intel bugged">
      <BugIcon size={20} />
      <div>
        <strong>Only you can see this: it hides a bug</strong>
        <p>
          {lineLabel(lines, bug.line)}: {bug.explanation}
        </p>
      </div>
    </div>
  ) : (
    <div className="intel clean">
      <ShieldIcon size={20} />
      <div>
        <strong>Only you can see this: it's clean</strong>
        <p>Talk the team into rejecting it and the release falls behind.</p>
      </div>
    </div>
  );
}

function ChangeCard({ game, line, onSelectLine, bugLine }: LineProps & { game: GameView; bugLine: number | null }) {
  const change = game.change!;
  const counts = useMemo(() => {
    const byLine = new Map<number, number>();
    for (const c of game.comments) if (c.line !== null) byLine.set(c.line, (byLine.get(c.line) ?? 0) + 1);
    return byLine;
  }, [game.comments]);
  return (
    <section className="card change-card">
      <div className="agent-head">
        <span className="bot-avatar">
          <BotIcon size={22} />
        </span>
        <div>
          <strong>Otto</strong> <span className="tag">AI agent</span>
          <p className="muted small">
            Proposed change {game.changeNumber} of {game.totalChanges}
          </p>
        </div>
      </div>
      <h2 className="change-title">{change.title}</h2>
      <p className="agent-summary">“{change.summary}”</p>
      {game.intel && <Intel bug={game.intel.bug} lines={change.lines} />}
      <DiffView
        file={change.file}
        lines={change.lines}
        bugLine={bugLine}
        counts={counts}
        selected={line}
        onSelect={onSelectLine}
      />
    </section>
  );
}

function ReviewPhase({ state, game, line, onSelectLine }: PhaseProps & LineProps): React.JSX.Element {
  const vote = (verdict: Verdict): void => {
    socket.emit('game:verdict', verdict);
  };
  return (
    <>
      <ChangeCard game={game} line={line} onSelectLine={onSelectLine} bugLine={game.intel?.bug?.line ?? null} />
      <section className="card vote-card">
        {isBenched(state, game) ? (
          <p className="muted">You were voted out, so you can't vote.</p>
        ) : (
          <>
            <div className="verdict-buttons">
              <button
                className={game.yourVerdict === 'reject' ? 'verdict reject chosen' : 'verdict reject'}
                aria-pressed={game.yourVerdict === 'reject'}
                onClick={() => vote('reject')}
              >
                <XIcon size={20} /> Reject
              </button>
              <button
                className={game.yourVerdict === 'approve' ? 'verdict approve chosen' : 'verdict approve'}
                aria-pressed={game.yourVerdict === 'approve'}
                onClick={() => vote('approve')}
              >
                <CheckIcon size={20} /> Approve
              </button>
            </div>
            <p className="muted small center">
              {game.yourVerdict
                ? 'You can change your vote until everyone has voted.'
                : 'It merges only if approvals outnumber rejections.'}
            </p>
          </>
        )}
        <WaitingOn players={waitingOn(state, game)} />
      </section>
    </>
  );
}

function Continue({ isHost, label }: { isHost: boolean; label: string }): React.JSX.Element {
  return isHost ? (
    <button className="primary big" onClick={() => socket.emit('game:next')}>
      {label}
    </button>
  ) : (
    <p className="muted">Waiting for the host to continue…</p>
  );
}

function NameList({ players }: { players: Player[] }): React.JSX.Element {
  if (players.length === 0) return <span className="muted small">Nobody</span>;
  return (
    <span className="name-list">
      {players.map((p) => (
        <span key={p.id} className="name-chip">
          <Avatar player={p} size="sm" /> {p.name}
        </span>
      ))}
    </span>
  );
}

function VoteSplit({ votes, players }: { votes: Record<string, Verdict>; players: Player[] }): React.JSX.Element {
  const by = (verdict: Verdict): Player[] => players.filter((p) => votes[p.id] === verdict);
  return (
    <div className="vote-split">
      <div className="approve">
        <h3>
          <CheckIcon /> Approved
        </h3>
        <NameList players={by('approve')} />
      </div>
      <div className="reject">
        <h3>
          <XIcon /> Rejected
        </h3>
        <NameList players={by('reject')} />
      </div>
    </div>
  );
}

function OutcomePhase({ state, game, isHost, line, onSelectLine }: PhaseProps & LineProps): React.JSX.Element {
  const record = game.history.at(-1)!;
  const kind = record.merged ? (record.bug ? 'bug' : 'shipped') : 'rejected';
  const left = SHIP_TO_WIN - game.shipped;
  const retroNext = game.changeNumber % RETRO_EVERY === 0;
  return (
    <>
      <section className={`card outcome ${kind}`}>
        <span className="stamp">
          {kind === 'shipped' ? 'Merged' : kind === 'bug' ? 'Bug in production!' : 'Rejected'}
        </span>
        <h2>{record.title}</h2>
        <p className="outcome-text">
          {kind === 'shipped' &&
            (left > 0
              ? `It was clean. ${left} more clean change${left === 1 ? '' : 's'} to ship the release.`
              : 'It was clean, and that completes the release.')}
          {kind === 'bug' && record.bug!.explanation}
          {kind === 'rejected' && 'Nobody finds out whether it hid a bug until the debrief.'}
        </p>
        <VoteSplit votes={record.votes} players={state.players} />
        {game.winner && <p className="game-over-note">Game over. {WIN_TEXT[game.winner.reason]}</p>}
        <Continue
          isHost={isHost}
          label={game.winner ? 'See the debrief' : retroNext ? 'Start the retro' : 'Next change'}
        />
      </section>
      <ChangeCard
        game={game}
        line={line}
        onSelectLine={onSelectLine}
        bugLine={record.bug?.line ?? game.intel?.bug?.line ?? null}
      />
    </>
  );
}

const BADGE = { shipped: 'Shipped', bug: 'Bug shipped', rejected: 'Rejected' } as const;

function History({ history, players }: { history: ChangeRecord[]; players: Player[] }): React.JSX.Element {
  return (
    <section className="card">
      <h2>The evidence so far</h2>
      <ol className="history">
        {history.map((r, i) => {
          const kind = r.merged ? (r.bug ? 'bug' : 'shipped') : 'rejected';
          const names = (verdict: Verdict): string =>
            players
              .filter((p) => r.votes[p.id] === verdict)
              .map((p) => p.name)
              .join(', ') || 'nobody';
          return (
            <li key={i}>
              <span className="history-num">{i + 1}</span>
              <div className="history-body">
                <div className="history-head">
                  <strong>{r.title}</strong>
                  <span className={`badge ${kind}`}>{BADGE[kind]}</span>
                </div>
                <div className="history-votes">
                  <span>
                    <CheckIcon size={14} /> {names('approve')}
                  </span>
                  <span>
                    <XIcon size={14} /> {names('reject')}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function RetroPhase({ state, game }: PhaseProps): React.JSX.Element {
  const candidates = state.players.filter((p) => p.id !== state.youId && !game.benched.includes(p.id));
  const vote = (target: string): void => {
    socket.emit('game:retro', target);
  };
  return (
    <>
      <section className="card stack">
        <div>
          <span className="eyebrow">Retro</span>
          <h2 className="retro-title">Who's the saboteur?</h2>
          <p className="muted small">
            Vote someone off the team, or skip. Whoever gets the most votes goes; a tie keeps everyone. Catch the
            saboteur and the reviewers win on the spot.
          </p>
        </div>
        {isBenched(state, game) ? (
          <p className="muted">You were voted out, so you can't vote.</p>
        ) : (
          <ul className="suspects">
            {candidates.map((p) => {
              const chosen = game.yourRetroVote === p.id;
              return (
                <li key={p.id}>
                  <button
                    className={chosen ? 'suspect chosen' : 'suspect'}
                    aria-pressed={chosen}
                    onClick={() => vote(p.id)}
                  >
                    <Avatar player={p} size="lg" />
                    <span className="suspect-name">{p.name}</span>
                    <span className="vote-mark">
                      {chosen ? (
                        <>
                          <CheckIcon /> Your vote
                        </>
                      ) : (
                        'Vote out'
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
            <li>
              <button
                className={game.yourRetroVote === 'skip' ? 'suspect skip chosen' : 'suspect skip'}
                aria-pressed={game.yourRetroVote === 'skip'}
                onClick={() => vote('skip')}
              >
                <span className="suspect-name">Skip</span>
                <span className="muted small">Not sure yet</span>
              </button>
            </li>
          </ul>
        )}
        <WaitingOn players={waitingOn(state, game)} />
      </section>
      <History history={game.history} players={state.players} />
    </>
  );
}

function VerdictPhase({ state, game, isHost, byId }: PhaseProps): React.JSX.Element {
  const r = game.retro!;
  const kind = r.wasSaboteur ? 'caught' : r.ejectedId ? 'innocent' : 'none';
  const you = r.ejectedId === state.youId;
  const subject = you ? 'You were' : `${byId.get(r.ejectedId ?? '')?.name ?? 'They'} was`;
  return (
    <>
      <section className={`card outcome verdict ${kind}`}>
        <span className="stamp">
          {kind === 'caught' ? 'Saboteur caught!' : kind === 'innocent' ? 'Wrong person!' : 'Nobody voted out'}
        </span>
        <h2>
          {kind === 'none'
            ? 'The team stays as it is'
            : `${subject} ${r.wasSaboteur ? 'the saboteur!' : 'not the saboteur'}`}
        </h2>
        {kind === 'innocent' && (
          <p className="outcome-text">
            {you ? "You're" : `${byId.get(r.ejectedId!)?.name} is`} off the team: no more votes or comments.
          </p>
        )}
        {kind === 'none' && (
          <p className="outcome-text">It was a tie, or most people skipped. Back to reviewing.</p>
        )}
        <ul className="votes">
          {state.players
            .filter((p) => r.votes[p.id])
            .map((p) => {
              const target = r.votes[p.id];
              return (
                <li key={p.id}>
                  <Avatar player={p} size="sm" /> {p.name} <span className="arrow">→</span>
                  {target === 'skip' ? (
                    <span className="muted">skip</span>
                  ) : (
                    <strong>{byId.get(target)?.name ?? '?'}</strong>
                  )}
                </li>
              );
            })}
        </ul>
        <Continue isHost={isHost} label={game.winner ? 'See the debrief' : 'Next change'} />
      </section>
      <History history={game.history} players={state.players} />
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

function DebriefPhase({ state, game, isHost, byId }: PhaseProps): React.JSX.Element {
  const debrief = game.debrief!;
  const winner = game.winner!;
  const youWon = game.role !== null && (game.role === 'saboteur') === (winner.side === 'saboteur');
  const saboteur = byId.get(debrief.saboteurId);
  return (
    <div className="debrief">
      <section className={`card debrief-hero ${winner.side}`}>
        {youWon && <Confetti />}
        <span className="eyebrow">Debrief</span>
        <h2 className="headline">{winner.side === 'reviewers' ? 'The reviewers win!' : 'The saboteur wins!'}</h2>
        <p className="muted">{WIN_TEXT[winner.reason]}</p>
        {saboteur && (
          <div className="saboteur-reveal">
            <Avatar player={saboteur} size="lg" />
            <div>
              <span className="muted small">The saboteur was</span>
              <strong>{saboteur.id === state.youId ? 'You!' : saboteur.name}</strong>
            </div>
          </div>
        )}
        {isHost ? (
          <button className="primary big" onClick={() => socket.emit('game:lobby')}>
            Back to lobby
          </button>
        ) : (
          <p className="muted">Waiting for the host to start a new game…</p>
        )}
      </section>

      <section className="card">
        <h2>Every change, and who fell for it</h2>
        <ol className="debrief-list">
          {debrief.changes.map((change, i) => (
            <DebriefItem key={i} n={i + 1} change={change} players={state.players} saboteurId={debrief.saboteurId} />
          ))}
        </ol>
      </section>

      <Scorecard debrief={debrief} state={state} />
    </div>
  );
}

function DebriefItem({
  n,
  change,
  players,
  saboteurId,
}: {
  n: number;
  change: DebriefChange;
  players: Player[];
  saboteurId: string;
}): React.JSX.Element {
  // The saboteur doesn't fall for their own bugs, so they're left out of who fell for it and who caught it.
  const who = (verdict: Verdict): string =>
    players
      .filter((p) => change.votes[p.id] === verdict && !(change.bug && p.id === saboteurId))
      .map((p) => p.name)
      .join(', ') || 'nobody';
  const [badge, label] = change.bug
    ? change.merged
      ? ['bug', 'Bug shipped']
      : ['caught', 'Bug caught']
    : change.merged
      ? ['shipped', 'Shipped']
      : ['blocked', 'Clean, but rejected'];
  return (
    <li className={change.bug ? 'debrief-item bugged' : 'debrief-item clean'}>
      <div className="history-head">
        <span className="history-num">{n}</span>
        <strong>{change.title}</strong>
        <span className={`badge ${badge}`}>{label}</span>
      </div>
      {change.bug && (
        <>
          <pre className="bug-snippet">
            <span className="line-chip">{lineLabel(change.lines, change.bug.line)}</span>{' '}
            <code>{highlight(change.lines[change.bug.line].text.trim(), langOf(change.file))}</code>
          </pre>
          <p className="small">{change.bug.explanation}</p>
        </>
      )}
      <p className="debrief-votes small">
        {change.bug ? (
          <>
            <span>
              <strong>Fell for it:</strong> {who('approve')}
            </span>
            <span>
              <strong>Caught it:</strong> {who('reject')}
            </span>
          </>
        ) : change.merged ? (
          <span>
            <strong>Approved by:</strong> {who('approve')}
          </span>
        ) : (
          <span>
            <strong>Blocked by:</strong> {who('reject')}
          </span>
        )}
      </p>
    </li>
  );
}

function Scorecard({ debrief, state }: { debrief: Debrief; state: RoomState }): React.JSX.Element {
  const rows = state.players.map((p) => {
    let caught = 0;
    let fell = 0;
    let blocked = 0;
    for (const c of debrief.changes) {
      const verdict = c.votes[p.id];
      if (c.bug && verdict === 'reject') caught++;
      if (c.bug && verdict === 'approve') fell++;
      if (!c.bug && verdict === 'reject') blocked++;
    }
    return { p, caught, fell, blocked };
  });
  return (
    <section className="card">
      <h2>Scorecard</h2>
      <table className="scorecard">
        <thead>
          <tr>
            <th>Player</th>
            <th title="Rejected a change that hid a bug">Bugs caught</th>
            <th title="Approved a change that hid a bug">Fell for</th>
            <th title="Rejected a clean change">Clean blocked</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, caught, fell, blocked }) => {
            const saboteur = p.id === debrief.saboteurId;
            return (
              <tr key={p.id}>
                <td>
                  <PlayerName player={p} youId={state.youId} />
                  {saboteur && <span className="tag out">saboteur</span>}
                </td>
                <td>{saboteur ? '–' : caught}</td>
                <td>{saboteur ? '–' : fell}</td>
                <td>{blocked}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
