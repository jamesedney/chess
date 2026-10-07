# Rankup — your chess training loop

A mobile-friendly, installable chess trainer for GitHub Pages. No server, account, API key, subscription or build step. Everything runs on your device.

## Publish on GitHub — simplest route

1. Create a GitHub repository, for example `rankup-chess`. A public repository works with free GitHub Pages.
2. Unzip this download. Upload the **contents** of the `Rankup-Chess` folder into the repository. `index.html` must be in the repository root, not inside another folder. Keep `vendor`, `pieces` and `icons` alongside it.
3. Open repository **Settings → Pages**. Under **Build and deployment**, select **Deploy from a branch**, then branch **main**, folder **/(root)**, and Save.
4. Wait for the Pages deployment to finish. Open `https://YOUR-USERNAME.github.io/rankup-chess/` (replace the username and repository name).
5. On your phone, open that address in your browser. Once “Offline training ready” appears, install through the browser menu. On iPhone use Safari → Share → Add to Home Screen.

Alternatively, if you upload the included `.github/workflows/pages.yml`, select **GitHub Actions** as the Pages source. Each push to `main` then deploys automatically. Choose one deployment method. No npm command is required to publish.

Opening `index.html` directly as a file will not work: browser modules, the engine and offline storage need HTTP/HTTPS. For a local preview, run `python3 -m http.server 8080` in the extracted folder, then open `http://localhost:8080`.

## What makes it different

- **Adaptive sessions:** due reviews, personal mistakes and weak themes receive priority. Start at Foundation or change the training stage in Settings.
- **Spaced recall:** unassisted solutions return after 1, 3, 7, 14 and 30 days. Hints and errors reset the interval to ten minutes. Positions can still appear as extra practice before due when you exhaust the available pool.
- **Your games become the curriculum:** paste a PGN, select your colour and analyse. Significant missed opportunities become board exercises in My mistakes.
- **Stockfish practice games:** choose your colour and engine strength. Optional coach analysis captures missed opportunities during play. Takebacks and PGN export are included.
- **Eight short lessons:** board vision, mating nets, tactics, opening habits, calculation, endgames, game review and a repeatable routine.
- **Honest progress:** training mastery and self-reported online ratings are separate. Ratings from different platforms/time controls should not be compared directly.
- **Offline support:** board, lessons, exercises and local Stockfish analysis are cached after the first successful load (about 8 MB).

The starter set contains 52 exercises: 26 positions plus their colour-swapped reflections. These include composed fundamentals and positions from historical miniature games. Your imported/practice games add individualised exercises. The built-in set is deliberately compact; it is not a comprehensive tactics database.

## Suggested routine

Complete eight positions most days, including due mistakes. Play thoughtful rated rapid games on your normal platform. Import a game, work through the missed opportunities and revisit them later. Log your real rating with the same platform and time control.

No app can guarantee 1500. This is a tool for building habits and reviewing evidence, not a rating prediction or a substitute for playing rated opponents.

## Analysis and exercise limitations

Stockfish.js 17.1 lite runs in a local single-threaded Web Worker, so GitHub Pages does not need special isolation headers. Short searches are used for responsiveness on phones. Engine scores and selected lines are approximate, especially in complex positions. The computer's strength labels are not calibrated Elo values.

PGN review examines up to the first 160 half-moves of one game. It flags evaluation losses of at least 130 centipawns. Positions ending immediately in a draw or checkmate are skipped in the current reviewer. Review candidates should be treated as learning prompts. The trainer expects the selected engine line, while accepting any immediate checkmate; other good alternatives may exist. Personal exercises play a short engine continuation rather than an entire conversion.

## Keep your progress safe

Settings → Export progress produces a JSON backup. Import that backup on another device. Progress does not sync between browsers or devices. Clearing browser data, changing the website address or using a private browsing session can remove it. Export regularly. PGNs are analysed locally and are not uploaded.

## Update your app

Replace the repository files with the newer version and commit. For each new release, change `CACHE` in `sw.js` (for example `rankup-v1.0.1`). The browser installs the updated cache; close all app tabs/windows and reopen to activate it. Progress uses the separate `rankup-v1` storage key and is retained. Never change that key without a migration.

## Development and checks

`npm ci` installs the pinned development dependencies. `npm test` validates all puzzle lines, lesson coverage, castling, en passant and promotion. `node build-content.mjs` regenerates engine-checked exercises (may choose slightly different principal variations). The deployed app already includes the required vendor files; do not upload `node_modules`.

See `THIRD-PARTY.md` and the accompanying licences for source, attribution and redistribution details.
