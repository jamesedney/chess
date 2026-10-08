# Rankup — your chess training loop

A mobile-friendly, installable chess trainer that runs entirely in the browser. There is no server, account, API key or subscription. Stockfish runs on your device, and your progress stays in your browser.

It is built for improving players, roughly 600 to 1600, who want a daily routine that turns their own games into practice.

## What it does

### The loop
- **One next step.** The training page tells you what to do now: drill the mistakes from your latest game, revisit what is due, solve puzzles on the tactics you missed, take a lesson for a recurring pattern, or play a game. Finish a step and the next one is waiting.
- **Your games import themselves.** Link a Lichess or Chess.com username and new games are fetched whenever the app is open, then reviewed in the background. Games with Lichess analysis review almost instantly. Filters: rated only, time controls, a daily cap.
- **The opponent adapts.** Score well over five practice games and the next one is a rung higher on a ladder that interleaves Maia and Stockfish levels; struggle and it steps down.

### Coaching
- **A coach that reads your games.** Every saved mistake is classified: allowed a mating attack, left material en prise, missed a mate, missed a tactic, or a quieter slip. The Coach page shows which one you make most, in which phase of the game, how many blunders you make per game, and whether you rush critical moves or run short of time.
- **A weekly plan.** Each Monday brings a plan aimed at your main weakness: training days, focused puzzles, re-solving your own mistakes, reviewing games and one drill. Targets rise after a completed week and ease off after a missed one.
- **Lessons made from your mistakes.** When three or more of your mistakes share a cause, a lesson is built from your own positions. Any move Stockfish rates as just as good is accepted.
- **Honest trends.** This month is compared with last month. A change is only called when it is bigger than normal variation; otherwise it says steady, or that there is not enough data.

### Training
- **About 3,500 Lichess puzzles.** Real, crowd-rated puzzles from the Lichess database (CC0), chosen across 400–2400, plus the original starter set. Each is tagged and explained after you solve it.
- **Adaptive sessions and spaced recall.** Sessions mix due reviews, your own mistakes, your weakest theme and new puzzles near your rating. Clean solves return after 1, 3, 7, 14 and 30 days.
- **Fair answer checking.** A different move from the stored solution is checked by Stockfish and accepted when it is equally strong.
- **Endgame drills against Stockfish.** Queen, rook and two-rook mates, king and pawn wins and draws, Lucena and Philidor. Each has a goal and a move limit, and every position is verified with Stockfish.
- **Calculation drills.** Visualisation: follow a line of moves in your head and tap where a piece ends up, with lines that grow as you get them right. Find every check: play every checking move in a position.
- **Vision sprint.** One-minute drills: each position has exactly one free piece to win.
- **Interactive lessons.** Fifteen lessons played step by step on the board.

### Playing and review
- **Human-like opponents.** Maia networks at about 1100, 1500 and 1900, trained on millions of human games, run on your device and make the mistakes people make. Stockfish levels are there too, up to full strength.
- **Your games become the curriculum.** Fetch recent games from Lichess or Chess.com by username, or paste a PGN. The reviewer marks inaccuracies, mistakes and blunders, explains them and saves the important moments as exercises.
- **Richer review.** Each game is matched to its named opening, and a table shows your results and mistakes per opening. Clock data shows how long you spent on each move and flags critical moves played too fast. While the engine is idle, marked moves are re-checked with a much deeper search: wrong suggestions are corrected, and false alarms are cleared.

### Everything else
- **Themes and sound.** Seven board colours, five piece sets, synthesised move sounds and vibration on supported phones, all in Settings.
- **Honest progress.** A puzzle rating with trend chart, per-theme strength, a practice calendar and streak, and a separate log of your real online rating.
- **Works offline and installs as an app.** After the first visit, about 10 MB, everything including Stockfish works offline. Each Maia level downloads about 1.7 MB the first time you play it.

## Publish on GitHub Pages

The app needs no build step: the repository root is the website.

**Option A: deploy from a branch (simplest).** In the repository's **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.

**Option B: GitHub Actions (recommended).** In **Settings → Pages**, choose **GitHub Actions**. Every push to `main` then runs the tests and deploys only the app files. The workflow is `.github/workflows/pages.yml`.

Open `https://YOUR-USERNAME.github.io/REPOSITORY/` on your phone. When the header says "Offline training ready", install it from the browser menu. On iPhone, use Safari → Share → Add to Home Screen.

Opening `index.html` straight from disk does not work, because modules, the engine and offline storage need HTTP. For a local preview run `npm start` and open `http://localhost:8080/`.

## Keep your progress safe

Progress is stored in this browser only. **Settings → Export progress** downloads a JSON backup, and **Import backup** restores it on any device. Backups from any earlier version import fine. Clearing browser data or using private browsing removes progress, so export now and then.

If saved data is ever unreadable, Rankup keeps a copy instead of overwriting it. Settings then offers it as a download.

## Privacy

Games you paste are analysed locally. The only network requests after the first load go to `lichess.org` and `api.chess.com`, and only for the public games of a username you entered: on request, or automatically when a username is linked and automatic import is on. Turn it off in Settings at any time.

## Development

Node 22.15 or newer is needed for the tools and tests. The app itself has no runtime dependencies beyond the vendored files.

```sh
npm ci                 # dev dependencies: chess.js, Stockfish, Playwright
npm start              # local server on http://localhost:8080/
npm run typecheck      # tsc --checkJs over src/ (JSDoc types, no build step)
npm test               # unit tests (node:test)
npx playwright install chromium   # once, for the browser tests
npm run test:e2e       # end-to-end tests in Chromium, desktop and phone sizes
npm run test:browsers  # the same in Firefox, Safari, iPhone and iPad (needs those browsers installed)
```

### Project layout

| Path | What it holds |
|---|---|
| `index.html`, `styles/app.css` | Page shell and styles, including dark mode |
| `src/main.js` | Routing, settings, theme, service-worker updates |
| `src/pages/` | One module per screen: train, coach, path, play, review, progress, drills |
| `src/guide.js` | The guided loop: the next step, focus tags and lesson recommendations |
| `src/sync.js`, `src/queue.js`, `src/analyse.js` | Automatic import, the background analysis queue and shared game analysis |
| `src/coach.js` | Diagnosis, weekly plan and trends, as pure functions of the saved state |
| `src/personal-lessons.js` | Lessons built from your own mistakes |
| `src/maia.js`, `src/maia-core.js` | Human-like opponents: Maia networks run in a worker |
| `src/endgames.js`, `src/calc.js` | Endgame drill rules and calculation drills |
| `src/clocks.js`, `src/openings.js`, `src/deep.js` | Clock data, opening names, deep idle-time re-checks |
| `src/appearance.js`, `src/sound.js` | Board colours, piece sets, sounds and haptics |
| `src/board.js` | Accessible board: tap, drag or keyboard, arrows and highlights |
| `src/engine.js` | Stockfish in a Web Worker, with a search queue |
| `src/srs.js`, `src/rating.js` | Spaced repetition, puzzle selection and the puzzle rating |
| `src/tagger.js` | Recognises forks, pins, skewers, mates… and writes explanations |
| `src/verify.js` | Decides whether an alternative solution is good enough |
| `src/state.js` | Saved state, the migration chain, validation and recovery |
| `data/` | Puzzles, lessons, endgame drills and the opening table (all generated or checked by tools) |
| `tools/` | Puzzle generation and import, local server, site staging |
| `test/unit`, `test/e2e` | Unit tests and Playwright tests |

### Rebuilding the data

```sh
node tools/generate-puzzles.mjs --minutes 60   # mine more puzzles from self-play (appends)
node tools/build-puzzles.mjs                   # tag, rate, balance and write data/puzzles.js
node tools/verify-puzzles.mjs --sample 50      # re-check a sample with a deeper search
node tools/verify-lessons.mjs                  # check every lesson position with Stockfish
node tools/verify-endgames.mjs                 # check every endgame drill with Stockfish
node tools/build-openings.mjs                  # opening names from tools/data/openings/*.tsv
```

The published set comes from the Lichess puzzle database. The container that builds this project cannot reach Lichess, so a GitHub Actions workflow (`.github/workflows/import-puzzles.yml`) downloads it, builds `data/puzzles.js` and commits it. Run it from the Actions tab, or push a commit whose message contains `[import-puzzles]`.

To import locally where Lichess is reachable:

```sh
node tools/import-lichess.mjs --download --count 3500   # or --input lichess_db_puzzle.csv.zst
node tools/build-puzzles.mjs --source lichess
```

Without `--source lichess`, the build uses the self-play puzzles in `tools/data/generated-raw.jsonl` instead. Their ratings are estimates. Lichess puzzles keep their Lichess ratings. The hand-picked starter set keeps its original ids, so progress from version 1.0 still applies.

### Releasing an update

1. Bump the version in `package.json`, `sw.js` and `src/main.js`. A unit test fails if they differ.
2. Commit and push. Open copies of the app show an "Update now" button once the new version has downloaded.

Saved progress uses the `rankup-v1` storage key with a version field inside (currently 4). To change its shape, add a migration to the `MIGRATIONS` list in `src/state.js`, never edit a released one, and bump `CURRENT_VERSION`. Every older backup then upgrades step by step, and a test checks the chain has no gaps.

## Limitations

- Stockfish.js lite runs single-threaded so GitHub Pages needs no special headers. Searches use fixed node counts, which keeps results the same on every device but makes analysis slower on old phones.
- Engine evaluations are estimates. The reviewer flags candidates for practice, not verdicts.
- Strength labels for practice opponents are approximate and are not calibrated ratings. Maia levels describe the players each network was trained on.
- The coach's diagnosis is only as good as the games you review. With few games it says so.
- Personal data stays in one browser: there is no sync between devices. Use the backup to move progress.
- No app can promise 1500. Rankup helps you build habits and review evidence; rated games measure strength.

See `THIRD-PARTY.md` and the accompanying licences for source, attribution and redistribution details.
