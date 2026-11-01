import { useEffect, useState } from 'react';
import { BUGS_TO_WIN, MAX_NAME_LENGTH, MAX_PLAYERS, MIN_PLAYERS, RETRO_EVERY, SHIP_TO_WIN } from '../shared/rules';
import type { RoomError, RoomState } from '../shared/types';
import { LogoMark } from './Icons';
import { navigate } from './router';
import { errorText, getName, saveName, saveToken, socket } from './socket';

const HOW_TO: [string, string][] = [
  [
    'Get your role',
    'One of you is secretly the saboteur. Only they know which of Otto the AI agent’s changes hide a bug.',
  ],
  [
    'Review each change',
    'Read the diff, comment on lines, then approve or reject. It merges only if approvals outnumber rejections.',
  ],
  [
    'Hold a retro',
    `Every ${RETRO_EVERY} changes, vote someone off the team. Catch the saboteur and the reviewers win on the spot.`,
  ],
  [
    'Ship or sink',
    `Reviewers win by shipping ${SHIP_TO_WIN} clean changes. The saboteur wins once ${BUGS_TO_WIN} bugs merge, or if too many clean changes get rejected. The debrief shows every bug and who fell for it.`,
  ],
];

export default function Home(): React.JSX.Element {
  const [name, setName] = useState(getName());
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const onState = (state: RoomState): void => {
      if (state.youToken) saveToken(state.code, state.youToken);
      navigate(`/room/${state.code}`);
    };
    const onError = (err: RoomError): void => {
      setError(errorText(err));
      setCreating(false);
    };
    socket.on('room:state', onState);
    socket.on('room:error', onError);
    return () => {
      socket.off('room:state', onState);
      socket.off('room:error', onError);
    };
  }, []);

  const create = (): void => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(errorText('NAME_REQUIRED'));
      return;
    }
    saveName(trimmed);
    setError('');
    setCreating(true);
    if (socket.connected) socket.emit('room:create', { name: trimmed });
    else {
      socket.once('connect', () => socket.emit('room:create', { name: trimmed }));
      socket.connect();
    }
  };

  const join = (): void => {
    const c = code.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(c)) {
      setError('Room codes are 4 letters.');
      return;
    }
    if (name.trim()) saveName(name.trim());
    setError('');
    navigate(`/room/${c}`);
  };

  return (
    <main className="page narrow">
      <header className="hero">
        <LogoMark large />
        <h1 className="title">
          <span className="gradient-text">Sabotage</span>
        </h1>
        <p className="tagline">
          Among Us for code review. An AI agent proposes changes, your team approves or rejects them, and one of you is
          secretly trying to ship the bugs.
        </p>
        <div className="chips">
          <span className="chip">
            {MIN_PLAYERS}–{MAX_PLAYERS} players
          </span>
          <span className="chip">~15 minutes</span>
          <span className="chip">No sign-up</span>
        </div>
      </header>

      <section className="card stack">
        <label htmlFor="name">Your name</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_NAME_LENGTH}
          placeholder="e.g. Sam"
          autoComplete="nickname"
        />
        <button className="primary big" onClick={create} disabled={creating}>
          {creating ? 'Creating…' : 'Create a room'}
        </button>

        <div className="divider">or join a friend</div>

        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            join();
          }}
        >
          <input
            className="code-input"
            aria-label="Room code"
            placeholder="CODE"
            value={code}
            maxLength={4}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button type="submit">Join</button>
        </form>

        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>

      <section className="card">
        <h2>How to play</h2>
        <ol className="how-list">
          {HOW_TO.map(([title, text], i) => (
            <li key={title}>
              <span className="step-num">{i + 1}</span>
              <div>
                <strong>{title}</strong>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
