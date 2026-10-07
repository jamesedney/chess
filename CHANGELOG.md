# Changelog

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
