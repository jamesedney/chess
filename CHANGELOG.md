# Changelog

## 5.3.1

- Training on a phone: the Next, Hint and Solution buttons were hidden under the new tab bar. They sit above it now, and so does the Play button on Today.
- One ground colour from the header to the tab bar, softer text and card colours in both themes, and feedback shown as a card with a coloured edge instead of a tinted box.
- The default board is tournament green, which suits the new look; a grey board chosen before changes with it, any other choice stays. Boards keep more of their colour in dark mode.
- Today: the streak sits in a card, the rating tiles wait until there are at least two, and finished blocks are greyed rather than struck through.

## 5.3.0

- A new look, in the style of a chess game app: a charcoal background (or warm light, in light mode), rounded raised cards, a rounded heavy typeface (Nunito, replacing Archivo), and buttons that press down. Buttons are blue, and the next thing to do is gold, so green still only means a good move.
- On phones the pages are in a tab bar along the bottom, with an icon for each.
- Today opens with the session as a card: the next block, a progress bar and one button. Then your goal rating with its trend, tiles for your other ratings (each time control on the same site, and puzzles), the day's plan as cards, shortcuts to drills, and a large Play button that stays in reach.
- A ratings sync now keeps your current rating in every time control you play, for the tiles.

## 5.2.0

- Openings you struggle with, in Training: the lines from your reviewed games where you scored under 40% in at least three games, with your record in each. Play starts a practice game from the point the line goes wrong. Your opponent answers with the moves your real opponents played there, then plays on at your level.
- The same list replaces "Lines that go badly" on the repertoire drill, with one entry per line rather than one per move of it.

## 5.1.9

- The last move is marked with a thin ink frame instead of a coloured square: no colour, in keeping with the black-and-white design, and green still only means a good move.

## 5.1.8

- The last move is highlighted in a neutral yellow instead of green, so green on the board only ever means a good move.

## 5.1.7

- Lessons fact-checked against the positions with chess.js and Stockfish. Twenty claims that were false or overstated are corrected, among them:
  - The outpost lessons no longer say a knight on c5 can never be removed: a bishop can take it, and in one lesson ...b6 chases it.
  - "Answer the check" now starts from a position that really is check, and Nd2 is accepted too.
  - A pinned knight is described as unable to move, not "can still move".
  - Squares said to be defended once are defended twice; "wins a pawn" where the opponent simply takes back is now called a trade.
  - In the king-and-pawn ending, Kd5 and Kf5 are accepted along with Kf6.
- Lesson move steps no longer name the move twice ("Nc5. Nc5.").

## 5.1.6

- Your rating updates as soon as the app finds a new game, not only when that game is queued for review. The regular rating check now runs every 10 minutes instead of every 30.

## 5.1.5

- The visualisation drill is no longer part of the daily plan. The two calculation units that required it ("See it before you play it" and "Long lines") are now mastered on their long-line puzzles alone. The drill stays in the Training menu.

## 5.1.4

- Visualisation drill: the board always has White at the bottom instead of flipping between rounds, and the ring on the piece to follow clears once the line starts playing out.

## 5.1.3

- Visualisation drill: pressing Next while the last line was still playing out no longer lets it keep moving pieces on the new round's board.

## 5.1.2

- The visualisation drill says what to do: "Play these moves in your head. The board stays still. Where does the black king on f6 end up?" The piece to follow is ringed, the moves are numbered from 1, and after you answer the line plays out on the board move by move.

## 5.1.1

- Safe or hanging? keeps the answer on screen until you tap Next; nothing moves on by itself any more.

## 5.1.0

- Today is one screen, one message: the rating, the streak paragraph and the session. The "Is it working?" tiles live on the You page only.
- The streak reads one window. "Losing 6 of your last 10. 2 of them began with a game started within two minutes of a loss." Every number on the line is about those ten games.
- "Score" is now "Points per game, all games" (or "reviewed games") on the You page: wins 1, draws ½, losses 0, over the games played.

## 5.0.2

- The repertoire drill no longer jumps: the answer's feedback appears under the board instead of pushing it down.

## 5.0.1

- The leak tile says the plain thing: "6 of 13 losses began with a piece hung in one move, was 4 of 9". A count of losses, never coloured: fewer is the only good news.

## 5.0.0

The losing-streak release. Rankup now reads every game you play, names the one thing that started most of your recent losses, trains it on your own positions in five seconds a go and on the clock you really had, tells you tonight when to stop, and shows you in two weeks whether the losses that leak caused went down. Every number comes with its count; nothing speaks below its minimum.

- **The game ledger.** Every game the sync fetches, reviewed or not, keeps one small row: when it ended, how long it took, the result, how it ended (mate, resignation, time, abandoned, draw), both ratings and the control. The first sync after this update reaches back 60 days (200 games on Lichess, two months of Chess.com archives); 400 rows are kept. Opening the app checks for a game you just finished, at most once a minute.
- **One leak.** When you are losing (eight or more of your last ten in your main control at 40% or less, or three losses in a row), Rankup reads your last ten losses and names the first decisive error in each: a move played in under five seconds, a piece hung in one move, the clock, a game queued straight after a loss, a won position thrown away, the opening, or a miscalculation. One category owning at least 40% of four or more losses is the leak. Today says it in one line with one habit, and the day is rebuilt around it: Safe or hanging? with the pause drill behind it, the pace drill, Play it again, your repertoire or Same clock, then a game whose objective is the habit. Streak mode ends itself when the results recover, with a note of the leak's share then and now.
- **The stop line.** Within twenty minutes of a loss, Today leads with a black STOP card, your own number for the game straight after a loss, and a four-minute reset (four of your positions, a short pause drill or a vision sprint). Two losses in a row put the reset first in the plan and drop the game block for tonight. The play rule is fixed: four games, stop after two losses in a row, two minutes between games. Verdicts speak only with eight games in each bucket and a 15-point gap. You shows your evenings: the score straight after a loss against the rest, games five and later in a sitting, the longest run, losses on time, and how things have gone since the stop line.
- **Safe or hanging?** Ten of your own positions, the move you played drawn on the board, five seconds each: safe, or hanging? "Hanging" is a real blunder from one of your games with the refutation the review found; "safe" is a tense position where your move held. The refutation plays when you are wrong. Scored as hits minus false alarms, so answering "hanging" every time scores nothing. The planner uses it as the leak block and as a warm-up when your games leak safety.
- **A real clock in practice.** Session games run on your most played blitz control against your practice opponent; Play it again runs with the seconds you actually had before the mistake; a checkbox in Options puts the clock on free games. The clock runs only on your turn, the engine's thinking is never charged, and running out is a loss, logged with the blunders and fast blunders the coach saw.
- **Same clock, better move.** Your decisive positions with the seconds you had on the clock when you got them wrong (five to sixty), until you find the better move inside that time; clockless games get fifteen seconds.
- **Is it working?** gains four rows: score straight after a loss, the longest loss run, the share of losses that began with the leak, and blunders played in under four seconds per game. Score now counts every game in the ledger, not only the reviewed ones.
- Every review keeps the opponent's punishment of each mistake, so the drill needs no extra engine time; the deep pass refreshes it. Saved data is version 9 (ledger, stop line, streak, two drill records, the clock setting); older data upgrades in place.

## 4.1.4

- Practice games give you White or Black at random by default, and the engine opens when you get Black. Choose White or Black under Options to fix it; the choice is remembered.
- Repertoire drill, clearer: your opening line and record come first, then a plain question ("You played 5… Bc5 here. Find a better move." or "What do you play here as Black?"). The result appears above the board: "Correct: 5… Qd4. In your game you played 5… Bc5, which cost you 11% winning chances. Next review in 3 days." The board shows the move played, and moves keep their numbers.

## 4.1.3

- Play it again says plainly how it went: "Passed. In your game you lost from here; this time after 30 moves Stockfish has it at +3.1 for you." or "Not passed: … To pass, …". The goal stays above the board after the result, "Your move" no longer follows it, and the board stops taking moves once the challenge is decided.

## 4.1.2

- Fixed: the app could reset itself. 4.0 recorded debriefs, "Play it again" attempts and repertoire drills in your history, but the check that runs when the app opens did not know those entries, so the next launch treated your saved progress as unreadable, set it aside and started fresh. Those entries are now accepted, and progress that was set aside this way is brought back automatically on the next launch (the state it replaces is kept as a recovery copy).
- Unreadable saved data is copied aside once, not again on every launch.
- Tests: every end-to-end test now reloads the app at the end and fails if saved data was set aside.

## 4.1.1

- Today fits on one phone screen: a smaller rating number, a shorter trend line, the goal and "on track" beside the number, and one line per block, with the description only for the next one.

## 4.1.0

A new look: black and white, square corners, large numbers.

- **Today** opens with your rating in large type, the change over the last two weeks, a 60-day trend line (with your goal when it is near) and three "Is it working?" numbers: last two weeks against the six before, the better ones in green. The day's blocks are numbered 01, 02 …, and the next one is highlighted.
- **Puzzles** show the count large (04/12), still read out as "4 of 12".
- **Debriefs** list the reasons likeliest first, each with how often your past debriefs gave it.
- Archivo typeface, bundled so it works offline (SIL Open Font License). Sections sit under rules instead of in boxes; one signal colour marks improvement.
- New black icon, under new file names so installed apps on Android and desktop pick it up. On iPhone and iPad, remove Rankup from the home screen and add it again to see it. A grey board is the default; if you had the old default (Walnut) you now get grey, and Walnut is still in Settings.
- State version 8.

## 4.0.0

Your games are the curriculum.

- **Post-game debrief.** Each newly imported game opens as a debrief of the moments that decided it: find the better move, then say what went wrong with one tap. A likely reason is suggested from your clock and the kind of mistake. Today's plan starts with it, and the background-review message opens it.
- **Play it again.** Positions from your games where a win slipped away or a draw was there to hold, replayed from the Play page against your opponent's strength (Maia near 1100, 1500 or 1900, otherwise Stockfish). Win, or stay clearly winning, or hold, within 30 moves; Judge position asks the engine sooner. Attempts are kept, and unsolved positions return.
- **Your repertoire.** A drill of the positions you reach in your openings: your move, or the engine's better move where your usual one cost you, on a spaced-repetition schedule. Lines you score under 40% in are listed.
- **Clock skills.** A clock profile from your games' %clk data: critical moves played in a hurry, time trouble before move 30, losses on time. Two drills: Pause (the board stays locked for eight seconds on your own critical positions) and Pace (easier positions, 15 seconds each; when time runs out it says so at once and plays the line).
- **Is it working?** The You page compares your last two weeks of reviewed games with the six weeks before, on blunders, missed threats, rushed critical moves, conversion of winning positions and score, and lists what you trained. Today shows the clearest change.
- **The plan uses all of it.** Today's session can include a debrief, a clock drill when your clock is the problem, the skill your debriefs keep naming, a position to play again and repertoire positions due.
- The Games page opens with Train on your games: debriefs waiting, positions to play again and your repertoire.
- Tapping the tab you are on goes back to its main screen; a finished debrief no longer reopens when you return to Games.
- Reviews keep the opponent's rating. Saved data moves to version 7; games reviewed before this version are not asked about again.


## 3.0.6

- Assess the position explains itself better. The answer now starts with the material ("Black is up a piece for a pawn"), says when material does not explain the engine's verdict (look for threats, a weak king or better pieces), says who controls an open file, and only calls a bishop hemmed in when it really has little room: a bishop on the same colour as its pawns can still be active, as one on d7 attacking g4 was in a reported position.
- Lists read as lists ("passed pawns on d3, e2 and f3"), and open files are grouped into one sentence.


## 3.0.5

- Your rating now keeps itself current. It is checked when the app opens and whenever it comes back to the foreground or back online (at most every 30 minutes), straight after new games are imported, after "Check for new games now", and when you change a username in Settings. Before, it was read only when the app started from scratch and at most every six hours, so an installed app that was only ever resumed could go days without an update.
- Chess.com: the current rating is taken from your most recent rated game when it is newer than Chess.com's stats page, and up to two months of rating history is read from your games, so the projection has real data from day one.
- The goal card says when the rating was last updated.


## 3.0.4

- Fixed: the human-like Maia opponents never loaded on the published site. Their networks are cached on first use rather than at install, and the deploy only copied the install-time file list, so GitHub Pages answered "not found" and every move quietly fell back to Stockfish. The networks are now deployed, and the licences page linked from Settings, which had the same problem, is too.
- The status line names the opponent you are playing: "Maia is thinking…" for the human-like levels.
- The browser tests now run against the staged site (the exact files GitHub Pages publishes), and a new test checks that Maia downloads its network and plays the reply.


## 3.0.3

- Fixed: on phones, a puzzle block over several tags (for example a Strategy block) showed every tag in one unbreakable line above the board, which made the page wider than the screen and shrank everything. The line now shows the unit name, or two tag names and a count, and is hidden during a session block because the bar at the top already names it. Raw tag ids such as "advancedPawn" now show as readable names.
- The phone layout test now fails if anything sticks out past the screen edge, and covers a many-tag puzzle block.
- Fixed: taps could stop working on a page after switching tabs. The page-enter animation ran on the page container, and when the page re-rendered mid-animation (for example Today updating as a reviewed game joined the plan) Chromium kept hit-testing stale geometry, so buttons did nothing until a dialog was opened. The animation now runs on the freshly rendered page instead.
- Messages shown while a dialog is open use the dialog's own message area instead of moving one element in and out of the dialog.


## 3.0.2

- Background game reviews no longer send a notification per game. One message covers everything reviewed together ("3 games reviewed: 5 new positions to practise"), and it has a close button and clears after ten seconds.
- A game reviewed after today's plan was made is added to the plan, before the next thing to do, so it appears on Today without a reload.


## 3.0.1

- Choose which rating your goal follows: Auto, Bullet, Blitz, Rapid or Classical. Pick it at setup, from Rating on Today, or in Settings; the goal moves to that rating straight away. Auto now follows the time control you play most (it used to prefer rapid whenever you had ten rapid games).
- Fixed: a brand-new goal could say it was a week behind, because its deadline was rounded down to whole weeks.
- The setup screen keeps your username when you switch between Lichess and Chess.com.


## 3.0.0

Rankup now plans everything. Enter a username and it sets your goal, places you on a curriculum and builds each day's session.

- **Today** is the new home: your goal (rating → target, deadline, projection), your level, and one button that runs today's session block by block. Choose 10 to 60 minutes a day; the plan fits it.
- **Zero-effort setup.** A Lichess or Chess.com username, or one tap on a rough level. Ratings and Lichess rating history are synced automatically every six hours.
- **Automatic goal.** The next target and deadline come from your rating and daily time; the projection uses your results since the plan started. Reaching a target records a milestone and sets the next one.
- **Curriculum.** Seven rating bands, about 45 units, each with a mastery gate. Placement marks the bands below your level as known. The Path tab is now the curriculum map; tap a unit for its concept, gate and training.
- **Skill model.** Seven skill ratings updated by every rated puzzle and corrected by the mistakes in your reviewed games. The planner trains the widest gap; refreshers bring back an old unit when your games show it leaking.
- **You** replaces Progress: goal chart, path, milestones and skill bars first. Manual rating entry folds away under Ratings.
- Navigation: Today, Path, Play, Games, You. Puzzles, drills and the Coach open from the plan, the path and the You page.
- New app icon in the Rankup colours; the installed app opens on Today.
- Redesigned interface: one sans typeface throughout, cooler neutrals with the icon's rust as the only accent, grouped lists instead of stacked cards, line icons in the navigation, underline tabs on phones, a compact header with the app icon, and plainer feedback boxes. Uppercase labels, stripe callouts and glyph icons are gone.
- Saved data moves to version 6; earlier backups import as before.


## 2.4.0

### Strategy
- Eight strategy lessons: pawn structure, outposts, open files and the seventh rank, good and bad bishops, pawn breaks and space, the worst piece, trading when ahead, and planning around the king. Tap steps are verified by pawn-structure rules in code; move steps by Stockfish.
- Assess the position: a drill built from your reviewed games. You say who is better and by how much; the engine's evaluation is the answer, with the structural facts shown. Over several runs the Progress and Coach pages say whether you overrate or underrate your own positions.
- Candidate moves: an option in practice games. Before you move, name up to three squares you are considering; the coach reports whether the engine's best was among them and keeps the hit rate.
- A Strategy puzzle theme: about 280 Lichess puzzles whose answer is a quiet move, a defensive move or zugzwang.
- Positional mistakes now point to Strategy puzzles and the assessment drill in the weekly plan, and to the worst-piece lesson.

## 2.3.0

- Practice game rebuilt in the board-first layout: the board, a one-line move record, a status line and three buttons. Opponent, colour, coach, export and review live behind one Options button.
- Every page lost its slogan and subtitle. Page titles are one word, the sidebar keeps only the puzzle-rating line, and the games page drops its how-to blurb.
- Vision sprint: a three-second countdown before the clock starts, a large clock next to the board title that turns red in the last ten seconds, and a draining time bar under the board.

## 2.2.0

- Game review rebuilt around the board. The page shows the board, the move controls, one line of feedback and a Next mistake button; the evaluation graph, move list and game details fold away under "Graph, moves and details".
- At each mistake the viewer asks you to find the better move before showing it. The stored move or any move Stockfish rates as just as good counts; Show answer reveals it. Solving a mistake here counts as drilling it, so the guided loop moves on and the position is scheduled like any other attempt.

## 2.1.3

- Sessions no longer stop you: the session-complete screen has a Keep going button that runs another block of positions, and a mistakes session then repeats its pool so you can cram.
- Fixed: when nothing was due, every My mistakes session opened with the same position, because the fallback always took the least recently seen one in a fixed order. It now prefers positions not yet solved cleanly and varies the order.

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
