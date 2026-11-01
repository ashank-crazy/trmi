import { useEffect, useRef, useState } from 'react';
import { MAX_NAME_LENGTH, MAX_PLAYERS, MIN_PLAYERS } from '../shared/rules';
import type { RoomError, RoomState } from '../shared/types';
import GameScreen from './Game';
import { CheckIcon, CopyIcon, FlagIcon, LeaveIcon, LoadingDots, LogoMark } from './Icons';
import { Avatar, PlayerTags } from './Players';
import { navigate } from './router';
import { errorText, getName, getToken, saveName, saveToken, socket } from './socket';

export default function Room({ code }: { code: string }): React.JSX.Element {
  const [state, setState] = useState<RoomState | null>(null);
  const [name, setName] = useState(getName());
  const [joinName, setJoinName] = useState(() => getName().trim());
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [fatal, setFatal] = useState<RoomError | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [copied, setCopied] = useState(false);
  const joining = useRef(false);

  useEffect(() => {
    const onState = (s: RoomState): void => {
      if (s.code !== code) return;
      setState(s);
      if (s.youToken) saveToken(s.code, s.youToken);
    };
    const onError = (err: RoomError): void => {
      if (err === 'SESSION_REPLACED') setFatal(err);
      else setError(errorText(err));
    };
    const onConnect = (): void => setConnected(true);
    const onDisconnect = (): void => {
      setConnected(false);
      joining.current = false;
    };
    socket.on('room:state', onState);
    socket.on('room:error', onError);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('room:state', onState);
      socket.off('room:error', onError);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [code]);

  // (Re)join whenever the socket (re)connects, so a dropped connection gets its seat back.
  useEffect(() => {
    if (!joinName) return;
    const join = (): void => {
      if (joining.current) return;
      joining.current = true;
      socket.emit('room:join', { code, name: joinName, token: getToken(code) }, (res) => {
        joining.current = false;
        if (!res.ok) {
          setFatal(res.error);
          return;
        }
        setFatal(null);
        setState(res.state);
        if (res.state.youToken) saveToken(code, res.state.youToken);
      });
    };
    socket.on('connect', join);
    if (socket.connected) join();
    else socket.connect();
    return () => {
      socket.off('connect', join);
    };
  }, [code, joinName, attempt]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const submitName = (): void => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(errorText('NAME_REQUIRED'));
      return;
    }
    saveName(trimmed);
    setError('');
    setJoinName(trimmed);
  };

  const copyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy — share the room code instead.');
    }
  };

  if (!joinName) {
    return (
      <main className="page narrow">
        <header className="hero compact">
          <LogoMark large />
          <h1 className="title small">
            Join room <span className="gradient-text">{code}</span>
          </h1>
        </header>
        <section className="card stack">
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              submitName();
            }}
          >
            <label htmlFor="room-name">Your name</label>
            <input
              id="room-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME_LENGTH}
              autoComplete="nickname"
              autoFocus
            />
            <button className="primary big" type="submit">
              Join the game
            </button>
          </form>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </section>
      </main>
    );
  }

  if (fatal) {
    const replaced = fatal === 'SESSION_REPLACED';
    return (
      <main className="page narrow">
        <header className="hero compact">
          <LogoMark large />
        </header>
        <section className="card stack">
          <h1>{replaced ? 'Opened elsewhere' : `Can't join ${code}`}</h1>
          <p>{errorText(fatal)}</p>
          {replaced && (
            <button
              className="primary"
              onClick={() => {
                setFatal(null);
                setAttempt((a) => a + 1);
              }}
            >
              Play in this tab
            </button>
          )}
          <button onClick={() => navigate('/')}>Back to home</button>
        </section>
      </main>
    );
  }

  const isHost = state !== null && state.youId !== undefined && state.youId === state.hostId;

  return (
    <main className="page">
      <header className="room-header">
        <div className="room-id">
          <LogoMark />
          <span className="label">Room</span>
          <span className="code-tiles" aria-label={`Room code ${code}`}>
            {[...code].map((c, i) => (
              <span key={i}>{c}</span>
            ))}
          </span>
        </div>
        <div className="row">
          <button className="sm" onClick={copyLink} aria-label={copied ? 'Copied' : 'Copy link'}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            <span className="btn-label">{copied ? 'Copied!' : 'Copy link'}</span>
          </button>
          {isHost && state.phase !== 'lobby' && state.phase !== 'results' && (
            <button
              className="sm"
              aria-label="End game"
              onClick={() => {
                if (window.confirm('End the game for everyone and return to the lobby?')) socket.emit('game:lobby');
              }}
            >
              <FlagIcon />
              <span className="btn-label">End game</span>
            </button>
          )}
          <button className="sm" onClick={() => navigate('/')} aria-label="Leave">
            <LeaveIcon />
            <span className="btn-label">Leave</span>
          </button>
        </div>
      </header>

      {!connected && state !== null && (
        <p className="banner">
          <span className="spinner" aria-hidden /> Reconnecting…
        </p>
      )}

      {state === null ? (
        <p className="center-note">
          <LoadingDots /> Joining room…
        </p>
      ) : state.phase === 'lobby' ? (
        <Lobby state={state} isHost={isHost} />
      ) : (
        <GameScreen state={state} isHost={isHost} />
      )}

      {error && (
        <p role="alert" className="error toast">
          {error}
        </p>
      )}
    </main>
  );
}

function Lobby({ state, isHost }: { state: RoomState; isHost: boolean }): React.JSX.Element {
  const online = state.players.filter((p) => p.online).length;
  const need = Math.max(0, MIN_PLAYERS - online);
  const seats = Array.from({ length: MAX_PLAYERS }, (_, i) => state.players[i] ?? null);
  return (
    <div className="lobby">
      <section className="card stack">
        <div className="lobby-head">
          <div>
            <h2>Waiting for players</h2>
            <p className="muted">
              Share the code or copy the link. Games need {MIN_PLAYERS}–{MAX_PLAYERS} players.
            </p>
          </div>
          <span className="count-pill" aria-label={`${state.players.length} of ${MAX_PLAYERS} seats taken`}>
            {state.players.length}/{MAX_PLAYERS}
          </span>
        </div>

        <ul className="seats">
          {seats.map((p, i) =>
            p ? (
              <li
                key={p.id}
                className={['seat filled', p.id === state.youId && 'you', !p.online && 'offline'].filter(Boolean).join(' ')}
              >
                <Avatar player={p} size="lg" />
                <span className="seat-name">{p.name}</span>
                <span className="seat-tags">
                  <PlayerTags player={p} youId={state.youId} />
                </span>
              </li>
            ) : (
              <li key={`open-${i}`} className="seat empty">
                <span className="seat-ghost" />
                Open seat
              </li>
            ),
          )}
        </ul>

        {isHost ? (
          <div className="start-area">
            <button className="primary big" disabled={need > 0} onClick={() => socket.emit('game:start')}>
              Start game
            </button>
            <p className="muted small">
              {need > 0
                ? `${online}/${MIN_PLAYERS} players online. Waiting for ${need} more…`
                : `${online} players ready. Let's go!`}
            </p>
          </div>
        ) : (
          <p className="waiting-host">
            <LoadingDots /> Waiting for the host to start…
          </p>
        )}
      </section>
    </div>
  );
}
