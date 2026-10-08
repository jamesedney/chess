# Changelog

## 2.1.2

- Fixed: drilling a game's mistakes (or My mistakes) repeated the same position to fill the session goal when there were only a few. A mistakes session is now one pass over its positions, the progress line shows that count, and the next step moves on to another game once each position has been attempted. A failed position still returns through spaced recall.

## 2.1.1

- Fixed: the "game reviewed" notification could not be tapped while the Settings dialog was open (the dialog makes everything behind it inert), and only its small button was tappable. Notifications now appear inside an open dialog, the whole notification is tappable, those with an action stay for 20 seconds, and opening a page from one closes the dialog.

## 2.1.0

### The guided loop
- The training page now shows the one thing to do next: drill the mistakes from your latest game, revisit positions that are due, solve puzzles on the tactics you missed, take a lesson for a pattern that keeps recurring, or play a game. The strip steps aside while you are doing what it suggests, and the session-complete screen leads straight to the next step.
- New puzzles lean towards the tactics behind your recent mistakes (forks, pins, hanging pieces, mates…), not only your weakest theme.
- The practice opponent adapts: score 60% or better over five games at a level and the next game is one rung up the ladder; 30% or worse steps down. The ladder interleaves Maia and Stockfish levels so each step is small. It can be turned off in Settings.

### Automatic import
- Link your Lichess or Chess.com username and your new games are fetched when the app opens, comes back online or returns to the foreground, then reviewed one at a time in the background. Finished reviews appear as a toast and their mistakes become your next drill.
- Filters in Settings: rated games only, which time controls, and a daily cap. Unfinished games, variants, short games and games you did not play are skipped.
- Games that carry Lichess analysis are reviewed almost instantly: Stockfish only looks at the moves Lichess already marked.
- The game picker gains "queue them all" for pasted or fetched multi-game files.
- Background analysis gives way to anything you are waiting for, and the queue survives a reload.

### Engineering
- Game analysis moved into a shared module used by the Review page and the import queue.
- Saved data moves to version 4 (sync settings and the practice-game log) through the migration chain.

## 2.0.0

### Coaching
- New Coach page. It diagnoses your recurring mistakes from your own games: allowed mating attacks, material left en prise, missed mates, missed tactics and quieter slips, plus the game phase and whether clock trouble or rushing played a part.
- A weekly plan aimed at that weakness, with progress tracked from your training and targets that adapt to how the last week went.
- Lessons built from your own mistakes, played in the lesson player. Moves Stockfish rates as just as good are accepted.
- Trends compare the last 30 days with the 30 before for puzzle accuracy, puzzle rating, mistakes per game and your real rating. Changes within normal variation are reported as steady, and thin data as not enough data.

### Chess
- About 3,500 puzzles from the Lichess puzzle database (CC0) replace the self-play set, imported by a GitHub Actions workflow.
- Human-like opponents: Maia networks at about 1100, 1500 and 1900, run on your device. The 1100 level is the new default opponent.
- Endgame drills against Stockfish: seven endings with goals and move limits, each verified with Stockfish.
- Calculation drills: visualisation and find every check.
- Review: opening names and per-opening results, time spent per move from clock data, rushed critical moves flagged, and deeper idle-time re-checks that correct or clear marked moves. Background analysis always gives way to anything you are waiting for.

### Look and feel
- Seven board colours and five piece sets (cburnett, merida, chessnut, kiwen-suwi, mpchess).
- Synthesised move, capture, check, success and error sounds, and vibration on supported phones. Both can be turned off.

### Engineering
- Saved data moves to version 3 through a chain of versioned migrations. Every older backup upgrades step by step.
- The app source is type-checked with TypeScript (`npm run typecheck`), using JSDoc so there is still no build step.
- CI runs the browser tests in Chromium, Firefox and WebKit, at desktop, iPhone, iPad and Android sizes.

## 1.4.0

- Motion: pieces slide to their squares, captured pieces fade out, a piece dropped off target glides back, and highlights and legal-move dots ease in. Pages, dialogs, toasts and status messages fade rather than flash. Everything is disabled when the device asks for reduced motion.

## 1.3.1

- Fixed two lesson positions whose tap questions were wrong (a defended bishop called loose; a pin blocked by a pawn). Every tap step is now verified against the rules of chess in the tests.

## 1.3.0

- Learning path rebuilt as interactive lessons: 15 lessons in five sections, each a sequence of steps on the board. Steps ask you to tap a square, find a move, play a line or decide between answers, with a Show answer fallback. Progress is saved per lesson and shown as a ring on the path.
- New lessons on getting out of check, discovered attacks, opening traps, counting attackers and defenders, and mating with king and rook.
- Every lesson position is checked by tests and by Stockfish (`tools/verify-lessons.mjs`).

## 1.2.0

- Training screen redesigned around the board: a thin progress line, the board, one feedback line and an action bar fixed to the bottom on phones. Stats and modes live behind a Mode menu. A Skip button moves on without recording an attempt.
- New colour scheme, Walnut: a wooden board on warm paper with an amber accent, in light and dark.
- Pieces replaced with the cburnett vector set (Lichess's default), with solid outlines that read on any square.
- Pieces can be dragged, with the piece following the finger, or moved by tapping; a tap off target just clears the selection.
- Filler panels removed from the training page.

## 1.1.0

### Training
- 555 new rated, tagged puzzles (607 in total) mined from Stockfish self-play, with a one-command importer for the Lichess puzzle database.
- A puzzle rating, updated on first attempts, that selects puzzles near your level. A difficulty setting can aim easier or harder.
- Moves that differ from the stored solution are checked by Stockfish and accepted when equally strong.
- Hints escalate from an idea, to the piece, to an arrow. The solution animates.
- Explanations after each puzzle name the tactic, such as "Nf7+ forks the king and queen".
- "Play it out" continues any solved puzzle against the engine.
- Vision sprint: one-minute free-piece drills.
- Interactive examples in every practical lesson.

### Your games
- Fetch recent games from Lichess or Chess.com by username.
- Multi-game PGN files show a picker; your colour is detected from your usernames.
- Mistakes are judged by win-percentage loss, so shrinking a big advantage is no longer flagged while a drawn-to-lost swing is.
- Searches use node counts, so the same game gives the same review on any device.
- Each mistake is explained (hung piece, allowed mate, missed fork…) and asks only for the reliable best move.
- A game viewer with evaluation bar, evaluation graph, arrows and marked moves.
- Saved positions can be removed, restored or deleted, and takebacks remove mistakes saved for those moves.

### Practice games
- Opponent levels from about 800 to full strength, using Stockfish's strength limit from 1400 and deliberate noise below.
- The coach analyses while you think, so feedback arrives sooner.
- The current game survives a reload and can be sent straight to review.

### Progress and app
- Puzzle-rating trend, practice calendar, streaks, per-theme strength, and a real-rating trend with deletable entries.
- Dark mode, following the device or a setting.
- Keyboard play on every board, focus kept after each move, screen-reader announcements.
- Back-button navigation and shareable links such as `#train?puzzle=p001`.
- "Update now" when a new version is ready; offline navigation fallback.
- Unreadable saved data is kept for recovery instead of being overwritten. Backups from 1.0 import.
- Confirmations use in-app dialogs that work in installed apps.

### Engineering
- Source split into readable modules. Unit tests and Playwright tests run in CI and gate Pages deployment, which now publishes only app files.
- Fixed: a timed-out engine search could resolve the next search with the wrong result.
