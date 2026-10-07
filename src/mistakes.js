// Turning engine findings into personal exercises.
import { Chess } from '../vendor/chess.js';
import { playUci, tryUci } from './chess-utils.js';
import { explainMistake, analyseLine } from './tagger.js';
import { PERSONAL } from './themes.js';
import { app } from './app-context.js';

/**
 * Save a missed opportunity as a personal exercise.
 * The exercise asks only for the best first move (deeper engine lines from a
 * short search are unreliable), except for forced mates, which run to mate.
 */
export function createMistake({ fen, played, before, after, loss, source = null }) {
  if (!before?.pv?.length || !before.best) return null;
  const existing = app.state.mistakes.find(p => p.fen === fen);
  if (existing) {
    existing.archived = false;
    return existing;
  }
  let line = [before.pv[0]];
  if (before.mate > 0 && before.mate <= 4) {
    const g = new Chess(fen);
    const mateLine = [];
    for (const u of before.pv.slice(0, before.mate * 2 - 1)) {
      if (!tryUci(g, u)) break;
      mateLine.push(u);
    }
    if (g.isCheckmate() && mateLine.length % 2 === 1) line = mateLine;
  }
  try {
    playUci(new Chess(fen), line[0]);
  } catch {
    return null;
  }
  const { tags } = analyseLine(fen, line);
  const mateIn = tags.includes('mate') ? Math.ceil(line.length / 2) : 0;
  const mistake = {
    id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: 'Instead of ' + played,
    fen,
    line,
    theme: PERSONAL,
    tags,
    goal: mateIn ? (mateIn === 1 ? 'Deliver checkmate in one.' : `Deliver checkmate in ${mateIn}.`) : 'Find the improvement.',
    explanation: explainMistake({ fen, played, before, after }),
    played,
    loss: Math.round(loss),
    created: Date.now(),
    ...(source ? { source } : {}),
  };
  app.state.mistakes.unshift(mistake);
  app.save();
  return mistake;
}

export function archiveMistake(id, archived = true) {
  const m = app.state.mistakes.find(x => x.id === id);
  if (m) m.archived = archived;
  app.save();
}

export function deleteMistake(id) {
  app.state.mistakes = app.state.mistakes.filter(x => x.id !== id);
  delete app.state.records[id];
  for (const r of app.state.reviews) for (const mark of r.marks) if (mark.mistakeId === id) delete mark.mistakeId;
  app.save();
}
