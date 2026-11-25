# Testing

## Automated

`npm test` runs the unit tests with Node's built-in runner. They cover:

- **Puzzle content.** Every puzzle is legal and ends correctly. Mates end in mate, themes are covered, ratings are in range, the original starter ids survive, and the data file stays under its size budget.
- **What comes next.** Two of every three positions from your own games while any are waiting, newest first; a position due again before one never tried; puzzles due again, then new ones near your rating, then the one seen longest ago; spaced-repetition scheduling; puzzle rating updates.
- **Positions from your games.** Saving a missed move with the better one, the move played and where it came from; short forced mates saved to the end; no duplicates; trimming past the limit; the deeper second look that drops, corrects or confirms a position and leaves alone the answer of one already tried.
- **Analysis.** UCI parsing, win-percentage maths, mistake thresholds, the tactic tagger (fork, pin, skewer, discovered attack, double check, smothered and back-rank mate, free pieces), mistake explanations, and the judge for a move other than the stored one.
- **Your games.** Lichess export URLs and filters, time-control classes, which games are accepted, each game chosen once, losses first and the shortest first, nothing read twice or after it failed, the first sync's two-month reach, Chess.com archive mapping, Lichess evaluation parsing, multi-game PGN splitting and colour detection, with fake responses throughout.
- **Your rating.** The rating followed is the one with the most history; the 30-day trend, and what it is measured against with less history than that.
- **Saved data.** A 6.0 state keeps accounts, ratings, positions and their schedule and drops the rest; a version 1 backup still loads; old default boards move and chosen ones stay; unusable old items are dropped one by one, not the whole state; invalid data and unknown versions are refused; pre-7.0 data is copied aside once before it is slimmed; unreadable data is kept for recovery and brought back when it reads again.
- **Nemesis.** What counts as a trap, the choice of the trap worth most within its cost, a move drawn by likelihood when there is none, stopping once the answer is no longer wanted, which of your moves it prepares replies to, and a run with the real engine and the real Maia network.
- **Human-like play.** Maia input encoding, the network forward pass against a reference implementation, and move sampling.
- **The engine queue.** Restart after a crash, background searches giving way, and stopping a search by its tag.
- **Tools.** The puzzle builder and the Lichess CSV importer with plain and zstd files.
- **Offline shell and deploy.** Versions agree, every precached file exists, every module the app imports is in the offline cache, and staging the site includes every precached and lazily cached file (the Maia networks) and every local page the app links to.

`npm run test:e2e` runs Playwright in Chromium against the staged site (`tools/stage-site.mjs`, the exact files GitHub Pages publishes) served from a sub-path, as on GitHub Pages, so a file missing from the deploy fails the tests. Every test also fails on any browser error, and reloads at the end to check that what it saved loads again. It covers:

- **Train.** The app opens on a board with a puzzle and nothing to set up. A puzzle solved cleanly moves the rating and moves on by itself. A position from your game shows the move you played; a wrong move is checked by Stockfish and refused on its square; the right one is scheduled, and waits for Next. A hint points at the piece and then the move, Show me plays the answer, and neither counts as solved. A move as good as the stored one is accepted.
- **Play.** A game against Nemesis answered from its Maia network, with nothing said during the game and one button; the game survives a reload. A blunder is saved silently; resigning asks first, then shows the costliest move, which opens on the Train board; a new game gives the other colour and Nemesis opens. Dragging a piece with a finger, and tap-to-move on touch.
- **You.** The first visit asks only for a name; connecting against a mocked Chess.com account shows the rating, reads a game in the background and turns its mistakes into positions, without keeping the game. The rating, its 30-day trend, the line and the two facts. Settings: board, pieces and appearance apply at once; a backup exports, a reset clears, the backup restores, and a file that is not a backup is refused. Data from 6.0 opens with its positions and rating, is offered whole as a download, and can be discarded.
- **The shell.** Three tabs, the back button, and old addresses landing on the nearest screen. Unreadable saved data kept and handed over in Settings. On a phone: no horizontal overflow on any screen, the board edge to edge, the buttons between the board and the tabs, the tabs at the bottom edge, and the settings sheet resting on it without opening the keyboard. Offline reload after the service worker installs, including a game answered by the engine.

`npm run typecheck` type-checks `src/` with TypeScript in `checkJs` mode.

CI runs the type check, both suites, and the browser suite again in Firefox, desktop Safari, iPhone and iPad (WebKit), on every pull request and before every Pages deployment. Two tests run only in Chromium: touch dragging, which injects touch events through the Chrome DevTools protocol, and the offline test, because Playwright controls service workers fully only in Chromium.

## Not covered automatically

- Installation on physical Android and iOS devices.
- The live Lichess and Chess.com APIs. The tests use recorded response shapes because the build environment cannot reach those sites.
- Engine speed on low-end phones, and Maia speed (about 85 ms per move on a laptop).
- Sound and vibration output, which browsers do not expose to tests.
