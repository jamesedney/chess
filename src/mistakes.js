// Turning engine findings into positions to train: the moments in your own
// games where a clearly better move was there.
import { Chess } from '../vendor/chess.js';
import { playUci, tryUci } from './chess-utils.js';
import { diagnoseMistake } from './tagger.js';
import { app } from './app-context.js';
import { MAX_MISTAKES } from './state.js';

/**
 * Save a missed opportunity as a position to train. The position asks only
 * for the best first move (deeper engine lines from a short search are
 * unreliable), except for forced mates, which run to mate. `game` says where
 * it came from: { opp, date } for an online game, null for a game against
 * Nemesis. Returns { mistake, created } or null; created is false when the
 * position was already saved.
 */
export function createMistake({ fen, played, before, after, loss, game = null }) {
  if (!before?.pv?.length || !before.best) return null;
  const existing = app.state.mistakes.find(p => p.fen === fen);
  if (existing) {
    delete existing.archived;
    return { mistake: existing, created: false };
  }
  let line = [before.pv[0]];
  let mate = 0;
  if (before.mate > 0 && before.mate <= 4) {
    const g = new Chess(fen);
    const mateLine = [];
    for (const u of before.pv.slice(0, before.mate * 2 - 1)) {
      if (!tryUci(g, u)) break;
      mateLine.push(u);
    }
    if (g.isCheckmate() && mateLine.length % 2 === 1) {
      line = mateLine;
      mate = Math.ceil(line.length / 2);
    }
  }
  try {
    playUci(new Chess(fen), line[0]);
  } catch {
    return null;
  }
  const mistake = {
    id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    fen,
    line,
    played,
    explanation: diagnoseMistake({ fen, played, before, after }).text,
    loss: Math.round(loss),
    created: Date.now(),
    game,
    ...(mate ? { mate } : {}),
  };
  app.state.mistakes.unshift(mistake);
  trimMistakes(app.state);
  app.save();
  return { mistake, created: true };
}

/** Past the limit, set-aside positions go first, then the oldest. Their records go with them. */
export function trimMistakes(state, max = MAX_MISTAKES) {
  while (state.mistakes.length > max) {
    let i = state.mistakes.findLastIndex(m => m.archived);
    if (i < 0) i = state.mistakes.length - 1;
    delete state.records[state.mistakes[i].id];
    state.mistakes.splice(i, 1);
  }
}

export function deleteMistake(id) {
  app.state.mistakes = app.state.mistakes.filter(x => x.id !== id);
  delete app.state.records[id];
  app.save();
}
