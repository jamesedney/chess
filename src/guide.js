// The guided loop: the one thing to do next, chosen from your state.
// Play a game → it is reviewed → drill its mistakes → puzzles on what you
// missed → a lesson if a pattern keeps recurring → play again.
import { isDue, isMistake } from './srs.js';
import { TAG_LABELS } from './themes.js';
import { levelById } from './strength.js';
import { lessons } from '../data/lessons.js';
import { dateKey } from './state.js';

const DAY = 86400000;
const RECENT_DAYS = 14;

/** Puzzle tags that practise what a mistake kind or solution tag shows. */
const KIND_TAG = { 'hung-piece': 'hangingPiece', 'allowed-mate': 'mate', 'missed-mate': 'mate' };
const FOCUSABLE = [
  'fork',
  'pin',
  'skewer',
  'discoveredAttack',
  'doubleCheck',
  'hangingPiece',
  'mate',
  'backRankMate',
  'promotion',
  'sacrifice',
  'trappedPiece',
  'deflection',
  'attraction',
];

/** Lessons that teach the pattern behind a puzzle tag or mistake kind. */
export const TAG_LESSON = {
  fork: 'forks',
  pin: 'pins-skewers',
  skewer: 'pins-skewers',
  discoveredAttack: 'discovered-attacks',
  doubleCheck: 'discovered-attacks',
  hangingPiece: 'loose-pieces',
  mate: 'mating-net',
  backRankMate: 'mating-net',
  promotion: 'promotion',
  'allowed-mate': 'out-of-check',
  positional: 'calculate-reply',
  opening: 'opening-habits',
};

/** Mistakes saved in the last two weeks that still stand. */
function recent(state, now) {
  return state.mistakes.filter(m => !m.archived && (m.created || 0) >= now - RECENT_DAYS * DAY);
}

/**
 * The tactical tags your recent mistakes point at, most frequent first.
 * Returns [{ tag, count }].
 */
export function focusTags(state, now = Date.now()) {
  const counts = new Map();
  for (const m of recent(state, now)) {
    const tags = new Set((m.tags || []).filter(t => FOCUSABLE.includes(t)));
    if (KIND_TAG[m.kind]) tags.add(KIND_TAG[m.kind]);
    for (const t of tags) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || FOCUSABLE.indexOf(a.tag) - FOCUSABLE.indexOf(b.tag));
}

/** A lesson worth taking now: a pattern missed twice recently whose lesson is not done. */
export function recommendedLesson(state, now = Date.now()) {
  const counts = new Map();
  for (const m of recent(state, now)) {
    const keys = new Set((m.tags || []).filter(t => TAG_LESSON[t]));
    if (TAG_LESSON[m.kind]) keys.add(m.kind);
    for (const k of keys) counts.set(TAG_LESSON[k], (counts.get(TAG_LESSON[k]) || 0) + 1);
  }
  const ranked = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
  for (const [id] of ranked) {
    const lesson = lessons.find(l => l.id === id);
    if (lesson && !state.lessons[id]?.done) return lesson;
  }
  return null;
}

/** The newest reviewed game whose mistakes you have not yet attempted. */
function undrilledReview(state, now) {
  for (const r of state.reviews) {
    if (!r.complete || (r.created || 0) < now - 3 * DAY) continue;
    const ids = r.marks.filter(m => m.mistakeId && !m.cleared).map(m => m.mistakeId);
    // Attempted once counts as drilled: a failed position comes back through spaced recall.
    const open = ids.filter(id => {
      const m = state.mistakes.find(x => x.id === id);
      return m && !m.archived && !(state.records[id]?.tries > 0);
    });
    if (open.length) return { review: r, open: open.length };
  }
  return null;
}

/**
 * Choose the next step. ctx.queue is the import queue snapshot ({ pending, current }).
 * Returns { id, title, text, why, action: { page, params }, note? }.
 */
export function nextStep(state, { queue = { pending: 0, current: null }, now = Date.now(), puzzles = [] } = {}) {
  const today = state.days[dateKey(new Date(now))] || { attempts: 0, clean: 0 };
  const remaining = Math.max(0, state.goal - (today.attempts || 0));
  const busy =
    queue.current || queue.pending ? `A game is being reviewed in the background${queue.current ? `: ${queue.current.label}` : ''}.` : null;
  const finish = step => (busy ? { ...step, note: busy } : step);

  const drill = undrilledReview(state, now);
  if (drill) {
    const opp = drill.review.colour === 'w' ? drill.review.black : drill.review.white;
    return finish({
      id: 'drill',
      title: `Drill the ${drill.open === 1 ? 'mistake' : drill.open + ' mistakes'} from your game against ${opp}`,
      text: 'Find the better move in each position while the game is fresh.',
      why: 'Positions from your own games are the fastest way to fix a habit.',
      action: { page: 'train', params: { mode: 'mistakes', review: drill.review.id } },
    });
  }

  const due = puzzles.filter(p => !p.archived && isDue(state.records[p.id], now));
  if (due.length && remaining > 0) {
    const mine = due.filter(isMistake).length;
    return finish({
      id: 'due',
      title: `Revisit ${due.length === 1 ? 'one position' : due.length + ' positions'} due today`,
      text: mine
        ? `${mine} of them ${mine === 1 ? 'is one of your own mistakes' : 'are your own mistakes'}.`
        : 'Spaced recall: solve them again before they fade.',
      why: 'Recall sticks when it is tested just before you forget.',
      action: { page: 'train', params: { mode: 'daily' } },
    });
  }

  if (remaining > 0) {
    const focus = focusTags(state, now).slice(0, 2);
    const tags = focus.map(f => f.tag);
    const label = tags.length ? tags.map(t => (TAG_LABELS[t] || t).toLowerCase()).join(' and ') : null;
    return finish({
      id: 'puzzles',
      title: label ? `${remaining} ${label} puzzles` : `${remaining} puzzles at your level`,
      text: label
        ? `You missed ${label} in your recent games, so today’s puzzles lean that way.`
        : 'An adaptive session near your puzzle rating.',
      why: label ? 'Patterns you miss in games are the ones to drill in puzzles.' : 'Daily reps build pattern recognition.',
      action: { page: 'train', params: { mode: 'daily', tags } },
    });
  }

  const lesson = recommendedLesson(state, now);
  if (lesson) {
    return finish({
      id: 'lesson',
      title: `Lesson: ${lesson.title}`,
      text: lesson.intro,
      why: 'This pattern has cost you more than once recently.',
      action: { page: 'path', params: { lesson: lesson.id } },
    });
  }

  const linked = !!(state.profiles.lichess || state.profiles.chesscom);
  const playedToday = state.games.some(g => g.d === dateKey(new Date(now))) || state.reviews.some(r => (r.created || 0) >= now - DAY);
  if (!playedToday) {
    return finish({
      id: 'play',
      title: `Play a game against ${levelById(state.strength).label.replace(/\s*\(Maia\)$/, '')}`,
      text: linked
        ? 'Or play online: your new games are imported and reviewed here by themselves.'
        : 'With the coach on, your missed chances become tomorrow’s drills.',
      why: 'The loop needs games: they show what to train next.',
      action: { page: 'play', params: {} },
    });
  }

  if (!linked && !state.reviews.length) {
    return finish({
      id: 'setup',
      title: 'Link your Lichess or Chess.com account',
      text: 'Add your username in Settings and your online games are reviewed here automatically.',
      why: 'Your real games are the best source of training material.',
      action: { page: 'settings', params: {} },
    });
  }

  return finish({
    id: 'done',
    title: 'Done for today',
    text: 'Puzzles finished and a game played. An endgame or calculation drill is a good extra.',
    why: 'Rest is part of training. Tomorrow’s plan is ready.',
    action: { page: 'drills', params: { drill: 'endgames' } },
  });
}
