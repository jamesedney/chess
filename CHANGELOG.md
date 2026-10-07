# Changelog

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
