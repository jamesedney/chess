// Runs today's session: starts each block on the right page, notices when it
// is done, and moves on. The plan itself comes from program.js.
import { app } from './app-context.js';
import { planSession, baseline, blockDone } from './program.js';
import { refreshMastery } from './curriculum.js';
import { dateKey } from './state.js';
import { goalStatus } from './progress-model.js';

const listeners = new Set();

/** Today's plan, made once a day; blocks keep their status across reloads. */
export function todaysSession({ rebuild = false } = {}) {
  const s = app.state;
  const today = dateKey();
  if (!rebuild && s.session?.date === today) return s.session;
  const status = goalStatus(s);
  s.session = planSession(s, { puzzles: app.allPuzzles(), goalStatus: status?.status || null, target: s.target?.target || null });
  app.save();
  return s.session;
}

export function onSessionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed() {
  for (const fn of listeners) fn();
}

/** The block being worked on now, if a session is running today. */
export function activeBlock() {
  const s = app.state.session;
  if (!s || s.date !== dateKey()) return null;
  return s.blocks.find(b => b.status === 'active') || null;
}

/** Where each block type is trained. */
function route(block) {
  switch (block.type) {
    case 'lesson':
      return ['path', block.params];
    case 'drill':
      return block.params.mode === 'vision' ? ['train', block.params] : ['drills', block.params];
    case 'game':
      return ['play', block.params];
    default:
      return ['train', block.params];
  }
}

/**
 * A game reviewed after today's plan was made: add its block before the next
 * thing to do, leaving the rest of the plan as it is.
 */
export function mergeNewGames() {
  const s = app.state;
  const plan = s.session;
  if (!plan || plan.date !== dateKey()) return;
  if (plan.blocks.some(b => b.type === 'review' && b.status === 'todo')) return;
  const fresh = planSession(s, { puzzles: app.allPuzzles(), target: s.target?.target || null });
  const review = fresh.blocks.find(b => b.type === 'review');
  if (!review || plan.blocks.some(b => b.type === 'review' && b.params.review === review.params.review)) return;
  if (plan.blocks.some(b => b.id === review.id)) review.id = `review-${plan.blocks.length}`;
  const at = plan.blocks.findIndex(b => b.status === 'todo');
  plan.blocks.splice(at < 0 ? plan.blocks.length : at, 0, review);
  app.save();
  changed();
}

/** Start a block by index: remember the counters it is measured from, then open it. */
export function startBlock(i) {
  const s = todaysSession();
  for (const b of s.blocks) if (b.status === 'active') b.status = 'todo';
  const block = s.blocks[i];
  if (!block) return;
  block.status = 'active';
  block.base = baseline(app.state);
  app.save();
  changed();
  const [page, params] = route(block);
  app.navigate(page, { ...params, block: block.id });
}

/** The next block still to do, after the given index, wrapping to the start. */
function nextTodo(s, from = -1) {
  const n = s.blocks.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k + n) % n;
    if (s.blocks[i].status === 'todo') return i;
  }
  return -1;
}

/**
 * Check the running block. When its work is complete it is flagged, and stays
 * the active block so the page can offer to continue; `settle` (used by Today)
 * marks it done instead. Returns true if it just finished.
 */
export function checkSession({ settle = false } = {}) {
  const block = activeBlock();
  if (!block) return false;
  refreshMastery(app.state, dateKey());
  if (!block.complete && !blockDone(app.state, block)) return false;
  const fresh = !block.complete;
  block.complete = true;
  if (settle) block.status = 'done';
  if (fresh || settle) {
    app.save();
    changed();
  }
  return fresh;
}

/** Finish (or skip) the running block and open the next one, or return to Today. */
export function continueSession() {
  const s = todaysSession();
  const i = s.blocks.findIndex(b => b.status === 'active');
  if (i >= 0) s.blocks[i].status = s.blocks[i].complete || blockDone(app.state, s.blocks[i]) ? 'done' : 'skipped';
  app.save();
  changed();
  const next = nextTodo(s, i);
  if (next >= 0) startBlock(next);
  else app.navigate('today');
}

/** Leave the session for now; the plan stays for later today. */
export function pauseSession() {
  const block = activeBlock();
  if (block) block.status = block.complete || blockDone(app.state, block) ? 'done' : 'todo';
  app.save();
  changed();
  app.navigate('today');
}

/** Progress through today's session. */
export function sessionProgress(s = app.state.session) {
  if (!s || s.date !== dateKey()) return { done: 0, total: 0, complete: false, minutesLeft: 0 };
  const done = s.blocks.filter(b => b.status === 'done' || b.status === 'skipped' || b.complete).length;
  const minutesLeft = Math.round(
    s.blocks.filter(b => (b.status === 'todo' || b.status === 'active') && !b.complete).reduce((a, b) => a + b.est, 0),
  );
  return { done, total: s.blocks.length, complete: done === s.blocks.length, minutesLeft };
}
