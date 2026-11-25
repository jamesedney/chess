# Rankup — a chess trainer built from your own games

A mobile-friendly, installable chess trainer that runs entirely in the browser. There is no server, account, API key or subscription. Stockfish runs on your device, and your progress stays in your browser.

Open it and you are on a board. There are three screens and nothing to configure.

## What it does

- **Train.** One position at a time. Positions from your own games come first: the moment you went wrong, with the move you played drawn on the board, and one question, what was better. Puzzles at your level fill in, two of yours to one of theirs while any of yours are waiting. You move a piece and the square tells you: a green tick, or a red cross and another go. A puzzle solved cleanly moves on by itself. A position you miss comes back in ten minutes; one you solve comes back after a day, then three, a week, two weeks and a month.
- **Play.** A game against Nemesis, an opponent that plays like a person of your level (the Maia network nearest your rating) and, when one of its natural moves leaves a position where your likely reply loses material, plays that one. Nothing is said about your play during the game, as in a real one. When it ends you are shown the one move that cost you most, and it joins the positions you train. Nemesis thinks while you do, so its reply is usually instant.
- **You.** Your real rating, read from Chess.com or Lichess, how it has moved in 30 days, and a line of the last three months. Below it, how many positions from your games are still to fix, and your puzzle rating. That is the whole screen.

The only setting up is the name you play under. With it, Rankup reads your public rated blitz, rapid and classical games of the last two months, losses first, in the background while the app is open. Each move of yours that threw away a clearly better one becomes a position. Later, with the engine idle, each position gets a second, much deeper look, and the ones where your move turns out to be fine are dropped.

## Publish on GitHub Pages

The app needs no build step: the repository root is the website.

**Option A: deploy from a branch (simplest).** In the repository's **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.

**Option B: GitHub Actions (recommended).** In **Settings → Pages**, choose **GitHub Actions**. Every push to `main` then runs the tests and deploys only the app files. The workflow is `.github/workflows/pages.yml`.

Open `https://YOUR-USERNAME.github.io/REPOSITORY/` on your phone and install it from the browser menu. On iPhone, use Safari → Share → Add to Home Screen. After the first online visit it works offline.

Opening `index.html` straight from disk does not work, because modules, the engine and offline storage need HTTP. For a local preview run `npm start` and open `http://localhost:8080/`.

## Keep your progress safe

Progress is stored in this browser only. **You → Settings → Export** downloads a JSON backup, and **Import** restores it on any device. Backups from any earlier version import fine. Clearing browser data or using private browsing removes progress, so export now and then.

Version 7 keeps far less than earlier versions did: your accounts, ratings, saved positions and when each is due, and how the board looks. Updating from an earlier version carries those over and sets the whole of the old data aside once; Settings offers it as a download until you discard it.

If saved data is ever unreadable, Rankup keeps a copy instead of overwriting it. Settings then offers it as a download.

## Privacy

Everything is analysed on your device. The only network requests after the first load go to `lichess.org` and `api.chess.com`, and only for the public games and ratings of a username you entered.

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

Where Playwright cannot download its own browser, point `PW_CHROMIUM` at a Chromium already on the machine.

### Project layout

| Path | What it holds |
|---|---|
| `index.html`, `styles/app.css` | The shell (three tabs) and every style, light and dark |
| `src/main.js`, `src/settings.js` | Routing, offline updates, the settings sheet |
| `src/pages/` | One module per screen: `train.js`, `play.js`, `you.js` |
| `src/srs.js`, `src/rating.js` | Which position comes next, when each returns, and the puzzle rating |
| `src/verify.js` | Decides whether a move other than the stored one is as good |
| `src/nemesis.js`, `src/maia.js`, `src/maia-core.js` | Nemesis's move choice, and the Maia networks run in a worker |
| `src/sync.js`, `src/queue.js`, `src/analyse.js` | Fetching your games, the background queue, and reading a game for mistakes |
| `src/mistakes.js`, `src/tagger.js`, `src/deep.js` | Saving a position, explaining it, and the deeper second look |
| `src/ratings.js`, `src/rating-sync.js` | Your real ratings from Lichess and Chess.com |
| `src/board.js` | Accessible board: tap, drag or keyboard, arrows and highlights |
| `src/engine.js` | Stockfish in a Web Worker, with a search queue |
| `src/state.js` | Saved progress: its shape, validation, and loading data from any earlier version |
| `data/puzzles.js` | The puzzle set (generated by the tools) |
| `tools/` | Puzzle generation and import, local server, site staging |
| `test/unit`, `test/e2e` | Unit tests and Playwright tests |

### Rebuilding the puzzles

```sh
node tools/generate-puzzles.mjs --minutes 60   # mine more puzzles from self-play (appends)
node tools/build-puzzles.mjs                   # tag, rate, balance and write data/puzzles.js
node tools/verify-puzzles.mjs --sample 50      # re-check a sample with a deeper search
```

The published set comes from the Lichess puzzle database. A GitHub Actions workflow (`.github/workflows/import-puzzles.yml`) downloads it, builds `data/puzzles.js` and commits it. Run it from the Actions tab, or push a commit whose message contains `[import-puzzles]`.

To import locally where Lichess is reachable:

```sh
node tools/import-lichess.mjs --download --count 3500   # or --input lichess_db_puzzle.csv.zst
node tools/build-puzzles.mjs --source lichess
```

Without `--source lichess`, the build uses the self-play puzzles in `tools/data/generated-raw.jsonl` instead. Their ratings are estimates. Lichess puzzles keep their Lichess ratings. The hand-picked starter set keeps its original ids, so progress from version 1.0 still applies.

### Releasing an update

1. Bump the version in `package.json`, `package-lock.json`, `sw.js` and `src/settings.js`. A unit test fails if they differ.
2. Add every new file the app loads to `FILES` in `sw.js`. A unit test fails if one is missing.
3. Commit and push. Open copies of the app show an "Update now" button once the new version has downloaded.

Saved progress uses the `rankup-v1` storage key with a version field inside (currently 12). `fromLegacy` in `src/state.js` reads every version before 7.0; a change to the shape after 7.0 needs its own step there and a bump of `CURRENT_VERSION`.

## Limitations

- Stockfish.js lite runs single-threaded so GitHub Pages needs no special headers. Searches use fixed node counts, which keeps results the same on every device but makes reading a game slower on old phones: a game without Lichess analysis takes a minute or two.
- Engine evaluations are estimates. A saved position is a candidate for practice, not a verdict; the deeper second look removes the weakest of them.
- Nemesis's level is the Maia network nearest your rating (1100, 1500 or 1900), which describes the players the network was trained on, not a calibrated rating.
- Chess.com's public data gives about two months of rating history; Lichess gives six.
- Progress stays in one browser: there is no sync between devices. Use the backup to move it.

See `THIRD-PARTY.md` and the accompanying licences for source, attribution and redistribution details.
