import { useEffect, useState } from 'react';
import { BUGS_TO_WIN, MAX_NAME_LENGTH, MAX_PLAYERS, MIN_PLAYERS, RETRO_EVERY, SHIP_TO_WIN } from '../shared/rules';
import type { DiffLine, RoomError, RoomState } from '../shared/types';
import { DiffView } from './Diff';
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

const SAMPLE: DiffLine[] = [
  { kind: 'ctx', oldNo: 18, newNo: 18, text: 'export async function createPost(req: Request, res: Response) {' },
  { kind: 'ctx', oldNo: 19, newNo: 19, text: '  const user = await getUser(req);' },
  { kind: 'add', oldNo: null, newNo: 20, text: '  if (user.banned) {' },
  { kind: 'add', oldNo: null, newNo: 21, text: "    res.status(403).send('You are banned');" },
  { kind: 'add', oldNo: null, newNo: 22, text: '  }' },
  { kind: 'ctx', oldNo: 20, newNo: 23, text: '  const post = await db.posts.insert(req.body);' },
  { kind: 'ctx', oldNo: 21, newNo: 24, text: '  res.json(post);' },
  { kind: 'ctx', oldNo: 22, newNo: 25, text: '}' },
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

  const open = (roomName: string, bots: number): void => {
    setError('');
    setCreating(true);
    if (socket.connected) socket.emit('room:create', { name: roomName, bots });
    else {
      socket.once('connect', () => socket.emit('room:create', { name: roomName, bots }));
      socket.connect();
    }
  };

  const create = (): void => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(errorText('NAME_REQUIRED'));
      return;
    }
    saveName(trimmed);
    open(trimmed, 0);
  };

  // Solo play never asks for anything: one click and you're at a table.
  const playSolo = (): void => {
    const soloName = name.trim() || 'Guest';
    saveName(soloName);
    open(soloName, MIN_PLAYERS - 1);
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
    <main className="page landing">
      <div className="landing-grid">
        <div className="intro">
          <span className="wordmark">
            <LogoMark /> sabotage
          </span>
          <h1 className="headline-big">One of your reviewers wants the bug to ship.</h1>
          <p className="tagline">
            A multiplayer code review game. Otto, an AI agent, proposes changes. Your team approves or rejects them.
            One of you knows where the bugs are and argues for them anyway.
          </p>
          <div className="chips">
            <span>
              {MIN_PLAYERS} to {MAX_PLAYERS} players
            </span>
            <span>15 minutes</span>
            <span>No sign-up</span>
          </div>

          <section className="card stack entry">
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
              <label htmlFor="name">Your name</label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={MAX_NAME_LENGTH}
                placeholder="e.g. Sam"
                autoComplete="nickname"
              />
              <button className="primary big" type="submit" disabled={creating}>
                {creating ? 'Creating…' : 'Create a room'}
              </button>
              <button type="button" onClick={playSolo} disabled={creating}>
                Play now with {MIN_PLAYERS - 1} bots
              </button>
            </form>

            <div className="divider">or join with a code</div>

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
        </div>

        <aside className="sample">
          <DiffView file="src/api/posts.ts" lines={SAMPLE} />
          <p className="sample-note">Would you approve this? Someone on your team already knows why you shouldn't.</p>
        </aside>
      </div>

      <ol className="how-list">
        {HOW_TO.map(([title, text], i) => (
          <li key={title}>
            <span className="step-num">0{i + 1}</span>
            <strong>{title}</strong>
            <p>{text}</p>
          </li>
        ))}
      </ol>
    </main>
  );
}
