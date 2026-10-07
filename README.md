# Rankup — your chess training loop

A mobile-friendly, installable chess trainer that runs entirely in the browser. There is no server, account, API key or subscription. Stockfish runs on your device, and your progress stays in your browser.

It is built for improving players, roughly 600 to 1600, who want a daily routine that turns their own games into practice.

## What it does

- **Adaptive puzzle sessions.** Each session mixes due reviews, your own mistakes, your weakest theme and new puzzles chosen near your puzzle rating.
- **About 600 rated puzzles.** They are mined from Stockfish self-play, keeping only positions where the winning move is clearly the only good one, the same idea Lichess uses. Each one is tagged (fork, pin, skewer, back-rank mate…) and explained after you solve it. You can swap in a slice of the real Lichess puzzle database with one command (see below).
- **Fair answer checking.** If you play a different move from the stored solution, Stockfish checks it. An equally strong move is accepted, and the puzzle continues from your move.
- **Spaced recall.** Clean solves return after 1, 3, 7, 14 and 30 days. Hints and errors bring a position back in ten minutes.
- **Your games become the curriculum.** Fetch your recent games from Lichess or Chess.com by username, or paste a PGN (multi-game files are fine). The reviewer marks inaccuracies, mistakes and blunders using win-percentage loss. It explains what went wrong, such as a piece left hanging, a missed fork or an allowed mate, and saves the important moments as exercises.
- **Game viewer.** Step through a reviewed game with an evaluation bar and graph. Marked moves show the better move as an arrow.
- **Practice games.** Opponents from about 800 to full strength. Levels from 1400 up use Stockfish's own strength limit; lower levels pick among the engine's candidates with deliberate noise. An optional coach saves your missed opportunities. You can also play any solved puzzle out against the engine.
- **Vision sprint.** One-minute drills: each position has exactly one free piece to win.
- **Interactive lessons.** Eight short lessons, each with positions to solve on the board.
- **Honest progress.** A puzzle rating with trend chart, per-theme strength, a practice calendar and streak, and a separate log of your real online rating.
- **Works offline and installs as an app.** After the first visit, about 9 MB, everything including Stockfish works offline. Light and dark themes follow your device or a setting.

## Publish on GitHub Pages

The app needs no build step: the repository root is the website.

**Option A: deploy from a branch (simplest).** In the repository's **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.

**Option B: GitHub Actions (recommended).** In **Settings → Pages**, choose **GitHub Actions**. Every push to `main` then runs the tests and deploys only the app files. The workflow is `.github/workflows/pages.yml`.

Open `https://YOUR-USERNAME.github.io/REPOSITORY/` on your phone. When the header says "Offline training ready", install it from the browser menu. On iPhone, use Safari → Share → Add to Home Screen.

Opening `index.html` straight from disk does not work, because modules, the engine and offline storage need HTTP. For a local preview run `npm start` and open `http://localhost:8080/`.

## Keep your progress safe

Progress is stored in this browser only. **Settings → Export progress** downloads a JSON backup, and **Import backup** restores it on any device. Backups from version 1.0 import fine. Clearing browser data or using private browsing removes progress, so export now and then.

If saved data is ever unreadable, Rankup keeps a copy instead of overwriting it. Settings then offers it as a download.

## Privacy

Games you paste are analysed locally. The only network requests after the first load are the ones you ask for: fetching your recent games from `lichess.org` or `api.chess.com`.

## Development

Node 22.15 or newer is needed for the tools and tests. The app itself has no runtime dependencies beyond the vendored files.

```sh
npm ci                 # dev dependencies: chess.js, Stockfish, Playwright
npm start              # local server on http://localhost:8080/
npm test               # unit tests (node:test)
npx playwright install chromium   # once, for the browser tests
npm run test:e2e       # end-to-end tests in Chromium, desktop and phone sizes
```

### Project layout

| Path | What it holds |
|---|---|
| `index.html`, `styles/app.css` | Page shell and styles, including dark mode |
| `src/main.js` | Routing, settings, theme, service-worker updates |
| `src/pages/` | One module per screen: train, path, play, review, progress |
| `src/board.js` | Accessible board: tap, drag or keyboard, arrows and highlights |
| `src/engine.js` | Stockfish in a Web Worker, with a search queue |
| `src/srs.js`, `src/rating.js` | Spaced repetition, puzzle selection and the puzzle rating |
| `src/tagger.js` | Recognises forks, pins, skewers, mates… and writes explanations |
| `src/verify.js` | Decides whether an alternative solution is good enough |
| `src/state.js` | Saved state, migrations from 1.0, validation and recovery |
| `data/puzzles.js`, `data/lessons.js` | Puzzle set (generated) and lessons |
| `tools/` | Puzzle generation and import, local server, site staging |
| `test/unit`, `test/e2e` | Unit tests and Playwright tests |

### Rebuilding the puzzle set

```sh
node tools/generate-puzzles.mjs --minutes 60   # mine more puzzles from self-play (appends)
node tools/build-puzzles.mjs                   # tag, rate, balance and write data/puzzles.js
node tools/verify-puzzles.mjs --sample 50      # re-check a sample with a deeper search
```

To use real, crowd-rated Lichess puzzles (CC0) instead of the generated ones:

```sh
node tools/import-lichess.mjs --download --count 3000   # or --input lichess_db_puzzle.csv.zst
node tools/build-puzzles.mjs                            # uses tools/data/lichess.json when present
```

Generated puzzles carry an estimated difficulty, so their ratings are only comparable with each other. Lichess puzzles keep their Lichess ratings. The hand-picked starter set keeps its original ids, so progress from version 1.0 still applies.

### Releasing an update

1. Bump the version in `package.json`, `sw.js` and `src/main.js`. A unit test fails if they differ.
2. Commit and push. Open copies of the app show an "Update now" button once the new version has downloaded.

Saved progress uses the `rankup-v1` storage key with a version field inside. Change the shape only together with a migration in `src/state.js`.

## Limitations

- Stockfish.js lite runs single-threaded so GitHub Pages needs no special headers. Searches use fixed node counts, which keeps results the same on every device but makes analysis slower on old phones.
- Engine evaluations are estimates. The reviewer flags candidates for practice, not verdicts.
- Strength labels for practice opponents are approximate and are not calibrated ratings.
- No app can promise 1500. Rankup helps you build habits and review evidence; rated games measure strength.

See `THIRD-PARTY.md` and the accompanying licences for source, attribution and redistribution details.
