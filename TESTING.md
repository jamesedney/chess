# Testing

## Automated

`npm test` runs the unit tests with Node's built-in runner. They cover:

- **Puzzle content.** Every puzzle and lesson example is legal and ends correctly. Mates end in mate, themes are covered, ratings are in range, the original starter ids survive, and the data file stays under its size budget.
- **Training logic.** Spaced-repetition scheduling, puzzle selection order, puzzle rating updates, streaks, and the alternative-solution judge.
- **Analysis.** UCI parsing, win-percentage maths, mistake thresholds, the tactic tagger (fork, pin, skewer, discovered attack, double check, smothered and back-rank mate, free pieces) and mistake explanations.
- **Saved data.** The migration chain from version 1 to 3 with no gaps, kind inference for old mistakes, validation of every new field, the bounded attempt log, and recovery of unreadable data.
- **Coaching.** Diagnosis with no, little and enough data; time-trouble detection; Monday-based weeks; plan targets and progress from the log; adaptive targets; trend verdicts that stay "steady" within noise; personal lessons from three or more mistakes of one kind.
- **Review data.** Clock parsing and time per move, rushed and time-trouble thresholds, opening identification and per-opening scores, and deep re-checks that confirm, correct or clear a mark without touching positions already practised.
- **Drills.** Endgame judging for mate, promotion and defence goals, stalemate and move limits; visualisation questions that track a piece through the line; check finding.
- **The loop.** Lichess export URLs and filters, time-control classes, game acceptance rules, deduplication and the daily cap, Chess.com archive mapping, Lichess evaluation parsing, the opponent ladder, focus tags, lesson recommendations, next-step ordering, and focus tags steering puzzle choice.
- **Human-like opponents.** Maia input encoding, the network forward pass against a reference implementation, and move sampling.
- **Imports.** Multi-game PGN splitting, colour detection, Lichess and Chess.com fetching with fake responses, and the Lichess CSV importer with plain and zstd files.
- **Offline shell.** Versions agree, every precached file exists, and every module the app imports is in the offline cache.

`npm run test:e2e` runs Playwright in Chromium against the app served from a sub-path, as on GitHub Pages. It covers:

- Every page loads with no browser errors, and back-button navigation works.
- Solving a puzzle, a wrong move being rejected, and an alternative move being accepted by Stockfish.
- Hints, the animated solution, "play it out", and generated puzzles' opening move.
- Vision sprint scoring and interactive lessons, including the stalemate warning.
- A practice game with engine replies, takebacks and keyboard-only moves.
- Reviewing a PGN: marked mistakes, the viewer, practising saved positions, and removing and restoring them.
- Multi-game picking, and fetching from Lichess and Chess.com with mocked responses.
- Backup export, reset and restore, migration from 1.0 data, corrupted-data recovery, dark mode and the rating log.
- No horizontal overflow at phone width on every page.
- Offline reload after the service worker installs, including Stockfish.
- The Coach page with seeded mistakes: diagnosis, plan, trends, and a personal lesson including an engine-approved alternative move.
- Endgame drills played against Stockfish, a lost drill being recorded, visualisation and find every check.
- A review with clock data and an opening, and the per-opening table.
- A linked account synced against a mocked Lichess response: the game is queued, reviewed in the background from its Lichess evaluations, and becomes the next step; a second sync queues nothing; the next-step strip; the opponent ladder moving up after five wins.

`npm run typecheck` type-checks `src/` with TypeScript in `checkJs` mode.

CI runs the type check, both suites, and the browser suite again in Firefox, desktop Safari, iPhone and iPad (WebKit), on every pull request and before every Pages deployment. Two tests run only in Chromium: touch dragging, which injects touch events through the Chrome DevTools protocol, and the offline test, because Playwright controls service workers fully only in Chromium.

## Not covered automatically

- Installation on physical Android and iOS devices.
- The live Lichess and Chess.com APIs. The tests use recorded response shapes because the build environment cannot reach those sites.
- Engine speed on low-end phones, and Maia speed (about 85 ms per move on a laptop).
- Sound and vibration output, which browsers do not expose to tests.
