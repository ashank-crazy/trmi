# Odd One Out

A 4–6 player word-deduction party game: Socket.IO server + React (Vite) client in one package.

Each round everyone gets the same secret word except one player, the **odd one out**, who gets a related one (_Coffee_ vs _Tea_). Nobody is told who the odd one out is, not even the odd one out. Players write clues, compare notes, and vote.

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

Unit tests for the game rules (`test/game.test.ts`) and integration tests that drive real Socket.IO clients through the lobby and a full 4-player game (`test/server.test.ts`). `npm run typecheck` checks server, client and tests.

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

1. The host starts once 4–6 players are online. There's one round per player, and everyone takes a turn as the odd one out (if it's an offline player's turn, a random online player takes it).
2. **Clues (2 passes, 60s each):** everyone writes a short clue (up to 24 characters, and it can't contain your own word). Clues stay hidden until everyone is in or time runs out, then appear together.
3. **Vote (60s):** vote for the player you think had the different word. You can change your clue or vote until everyone has acted.
4. **Reveal:** the odd one out is caught only with strictly the most votes.
   - Caught: +1 to each player who voted for them.
   - Escaped (including ties and no votes): +3 to the odd one out.
5. After the last round the host sees final results and can return everyone to the lobby for another game. The host can also end a game early.

## Room rules

- Room codes are 4 uppercase letters (unambiguous alphabet, no I/O).
- Max 6 players per room. New players can't join while a game is in progress; seated players can always rejoin.
- Each player gets a secret seat token (kept in `sessionStorage`): refreshing a tab rebinds to the same seat, and each tab is a separate player. Public player ids can't be used to take over a seat.
- In the lobby, disconnected players stay seated but offline for 60s, then are removed. Mid-game they keep their seat (and score) until the game ends, and the game doesn't wait for offline players.
- Leaving (Leave, or navigating back) frees a lobby seat immediately. If the host leaves or stays offline for 60s, the next online player becomes host. Empty rooms are deleted.

## Testing with several tabs

Seat tokens are per tab, so one browser is enough:

1. **Tab A**: open http://localhost:5173, enter a name, Create room.
2. **Tabs B–D**: open the link copied with Copy link (or type the code on the home page) and enter a name.
3. With 4 players online, the host's Start game button unlocks.
4. Refresh any tab mid-game: it rebinds to the same seat with the same word.
5. Close a tab mid-clue: the others can still finish the pass, and that player's clue shows as "no clue".
6. A 7th player gets "room full", and joining mid-game gets "game already underway".
