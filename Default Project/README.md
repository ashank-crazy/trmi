# Sabotage

Among Us for code review: a 4–6 player social deduction game. Socket.IO server + React (Vite) client in one package.

Everyone joins from a link. Otto, an AI agent, proposes a series of code changes, and the team votes to approve or reject each one. One player is the secret **saboteur**: they know which changes hide a bug, and they argue for shipping them. The team wins by catching the bad changes and voting out the saboteur. The saboteur wins by getting enough bugs merged. The debrief at the end shows each hidden bug and who fell for it.

Otto's changes come from a hand-written bank in `src/server/changes.ts` (TypeScript and Python diffs, half of them with a planted bug and an explanation), so there's no API key or live model to set up.

## Install

```bash
npm install
```

## Dev

```bash
npm run dev
```

Runs the game server (`tsx watch src/server/index.ts --dev`, port 3001) and the Vite dev server (http://localhost:5173) together. Vite proxies `/socket.io` (including websockets) to the game server, so the client connects to its own origin.

## Test

```bash
npm test
```

Unit tests for the game rules (`test/game.test.ts`) and integration tests that drive real Socket.IO clients through the lobby and full 4-player games (`test/server.test.ts`). `npm run typecheck` checks server, client and tests.

## Build

```bash
npm run build
```

Builds the client to `dist/client/` (Vite) and the server to `dist/server/` (tsc, strict mode).

## Start (production)

```bash
npm start
```

Serves the built client and Socket.IO from a single Express server.

## Environment variables

| Var           | Default                       | Used by                                                           |
| ------------- | ----------------------------- | ----------------------------------------------------------------- |
| `PORT`        | `3001` (prod) / `5173` (dev)  | The port you open in the browser: Express in prod, Vite in dev    |
| `SERVER_PORT` | `3001`                        | Dev only: the game server's port, which Vite proxies to           |

## Game rules

All the numbers below live in `src/shared/rules.ts`.

1. The host starts once 4–6 players are online. One random player becomes the saboteur; only they see their role.
2. The game deals 9 changes: 6 clean and 3 with a hidden bug, one bug in each third of the queue. A room avoids repeating changes until it has played through the bank.
3. **Review (90s per change):** read Otto's diff, comment on the change or on a specific line, and vote approve or reject. You can change your vote until everyone has voted. While reviewing, the saboteur sees whether the change is clean and, if not, which line is the bug and why.
4. **Outcome:** a change merges only if approvals outnumber rejections (a tie or no votes rejects it). A merged bug is revealed straight away; whether a rejected change hid a bug stays secret until the debrief. Everyone sees who approved and who rejected.
5. **Retro (60s, after every 2 changes):** vote to remove someone from the team, or skip. Only a single clear leader goes; a tie or a skip majority removes nobody. Removing the saboteur ends the game. A wrongly removed reviewer stays to watch but can't vote or comment any more.
6. **Winning:**
   - Reviewers win by shipping 4 clean changes, or by voting out the saboteur.
   - The saboteur wins once 2 bugs are merged, or once too many clean changes have been rejected for the team to still ship 4.
7. **Debrief:** every change with its verdict, each hidden bug with the offending line, who fell for it and who caught it, and a per-player scorecard. The host can then take everyone back to the lobby. The host can also end a game early.

## Room rules

- Room codes are 4 uppercase letters (unambiguous alphabet, no I/O).
- Max 6 players per room. New players can't join while a game is in progress; seated players can always rejoin.
- Each player gets a secret seat token (kept in `sessionStorage`): refreshing a tab rebinds to the same seat, and each tab is a separate player. Public player ids can't be used to take over a seat.
- In the lobby, disconnected players stay seated but offline for 60s, then are removed. Mid-game they keep their seat (and role) until the game ends, and the game doesn't wait for offline players.
- Leaving (Leave, or navigating back) frees a lobby seat immediately. If the host leaves or stays offline for 60s, the next online player becomes host. Empty rooms are deleted.

## Testing with several tabs

Seat tokens are per tab, so one browser is enough:

1. **Tab A**: open http://localhost:5173, enter a name, Create room.
2. **Tabs B–D**: open the link copied with Copy link (or type the code on the home page) and enter a name.
3. With 4 players online, the host's Start game button unlocks.
4. Refresh any tab mid-game: it rebinds to the same seat with the same role.
5. Close a tab mid-review: the others can still finish voting without them.
6. A 7th player gets "room full", and joining mid-game gets "game already underway".
