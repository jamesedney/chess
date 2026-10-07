# Validation — 7 October 2026

Verified locally in headless Chromium, served from a repository-style subdirectory:

- All 52 puzzle solution lines are legal; all mate-in-one exercises finish in checkmate.
- Every practical lesson has matching exercise content.
- Chess rules: promotion, castling and en passant.
- Solve an exercise and persist the result.
- Play e4 and receive a legal Stockfish reply.
- Import Fool's Mate as White; detect and save a missed opportunity.
- Open a lesson and log an actual rating.
- Responsive layout at 1440 px and 390 px; no horizontal page overflow on mobile.
- Reload offline after service-worker activation and run Stockfish analysis offline.
- No uncaught browser errors in the tested flow.

Desktop and mobile screenshots were visually inspected. Physical Android/iOS installation and a live GitHub Pages deployment have not been tested in this environment. The package is ready for the user's repository; no repository or public deployment was created.
