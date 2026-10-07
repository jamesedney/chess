// Lessons built from your own games: one per recurring kind of mistake,
// using the positions where you made it. They play in the lesson player.
import { Chess } from '../vendor/chess.js';
import { KINDS, KIND_IDS } from './mistake-kinds.js';
import { recentMistakes } from './coach.js';
import { PERSONAL } from './themes.js';

export const PERSONAL_SECTION = 'Made from your games';
export const MIN_POSITIONS = 3;
const MAX_POSITIONS = 4;

const WHY = {
  'allowed-mate': 'It let the opponent start a forced mate.',
  'hung-piece': 'It left material that could simply be taken.',
  'missed-mate': 'There was a forced checkmate available.',
  'missed-tactic': 'A tactic won material or the game.',
  positional: 'It was a quieter slip: a better plan was available.',
};

function legalFirstMove(m) {
  try {
    const g = new Chess(m.fen);
    const u = m.line[0];
    g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    return true;
  } catch {
    return false;
  }
}

/** The lessons, most frequent kind first. Each has an id of the form my-<kind>. */
export function personalLessons(state, now = Date.now()) {
  const byKind = new Map();
  for (const m of recentMistakes(state, now, 365)) {
    if (!m.kind || !legalFirstMove(m)) continue;
    if (!byKind.has(m.kind)) byKind.set(m.kind, []);
    byKind.get(m.kind).push(m);
  }
  const lessons = [];
  for (const kind of KIND_IDS) {
    const list = byKind.get(kind) || [];
    if (list.length < MIN_POSITIONS) continue;
    lessons.push(buildLesson(kind, list));
  }
  return lessons.sort((a, b) => b.count - a.count);
}

function buildLesson(kind, mistakes) {
  const meta = KINDS[kind];
  // Newest first: recent habits are the ones to fix.
  const chosen = [...mistakes].sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, MAX_POSITIONS);
  const first = chosen[0];
  const others = KIND_IDS.filter(k => k !== kind).slice(0, 2);
  const options = [kind, ...others]
    .sort((a, b) => a.localeCompare(b))
    .map(k => ({
      label: WHY[k],
      correct: k === kind,
      why:
        k === kind
          ? first.explanation
          : 'Not this time. Look at what the opponent could do after your move, and what you could have done instead.',
    }));
  const steps = [
    {
      kind: 'read',
      text: `This lesson is built from your own games. ${mistakes.length} of your saved mistakes have the same cause: ${meta.label.toLowerCase()}. The positions are yours. ${meta.habit}`,
    },
    {
      kind: 'choice',
      fen: first.fen,
      text: `You played ${first.played} here. What went wrong?`,
      options,
    },
    ...chosen.map((m, i) => ({
      kind: 'move',
      fen: m.fen,
      text: `${i === 0 ? 'Now find the better move.' : `Another of your games. You played ${m.played}.`} ${m.goal || 'Find the improvement.'}`,
      answers: [m.line[0]],
      engine: true,
      explain: m.explanation,
    })),
    {
      kind: 'cta',
      text: `Keep the habit: ${meta.habit} These positions also come back in My mistakes until you solve them cleanly.`,
      label: 'Practise my mistakes',
      page: 'train',
      params: { mode: 'mistakes' },
    },
  ];
  return {
    id: 'my-' + kind,
    personal: true,
    section: PERSONAL_SECTION,
    title: `Your pattern: ${meta.label.toLowerCase()}`,
    intro: `${mistakes.length} times in your games. Work through your own positions.`,
    rule: meta.habit,
    theme: PERSONAL,
    count: mistakes.length,
    steps,
  };
}
