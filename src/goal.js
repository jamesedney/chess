// The rating goal: a target set automatically from your current rating, the
// pace it should take, and a projection from your real results.
import { dateKey } from './state.js';

const DAY = 86400000;

/** Typical points a month for a player training 20 minutes a day, five days a week. */
export function monthlyPace(rating) {
  if (rating < 1000) return 60;
  if (rating < 1400) return 40;
  if (rating < 1800) return 25;
  return 15;
}

/** Scale the pace for daily minutes: more time helps, with diminishing returns. */
export function paceFor(rating, minutes = 20) {
  return monthlyPace(rating) * Math.sqrt(Math.max(5, minutes) / 20);
}

/** The next target: the next round hundred at least 150 points up. */
export function nextTarget(rating) {
  return Math.ceil((rating + 150) / 100) * 100;
}

/** A goal from a current rating, with a deadline from the expected pace. */
export function makeGoal({ perf, rating, minutes = 20, now = new Date() }) {
  const target = nextTarget(rating);
  const months = (target - rating) / paceFor(rating, minutes);
  const by = new Date(now.getTime() + Math.round((months * 30.4) / 7) * 7 * DAY);
  return { perf, start: { rating, date: dateKey(now) }, target, by: dateKey(by), minutes };
}

/** Points per day from a least-squares line through dated ratings. */
export function trendSlope(points) {
  if (points.length < 2) return null;
  const xs = points.map(p => new Date(p.date + 'T12:00:00').getTime() / DAY);
  const x0 = xs[0];
  const n = points.length;
  const mx = xs.reduce((a, x) => a + (x - x0), 0) / n;
  const my = points.reduce((a, p) => a + p.rating, 0) / n;
  let num = 0;
  let den = 0;
  points.forEach((p, i) => {
    num += (xs[i] - x0 - mx) * (p.rating - my);
    den += (xs[i] - x0 - mx) ** 2;
  });
  return den ? num / den : null;
}

/**
 * Where the goal stands. series: [{ date, rating }] of the goal's rating.
 * Blends the observed trend with the expected pace until there are about two
 * months of data. Returns { current, target, by, daysLeft, projected, status,
 * weeksBehind, slope } where status is reached | on-track | behind.
 */
export function projection(goal, series, now = new Date()) {
  // Progress is measured from the day the plan started; earlier history is
  // how you improved before it, not what the plan is doing.
  const since = [{ date: goal.start.date, rating: goal.start.rating }, ...series.filter(p => p.date > goal.start.date)];
  const recent = since.filter(p => p.date >= dateKey(new Date(now.getTime() - 120 * DAY)));
  const current = series.at(-1)?.rating ?? goal.start.rating;
  const daysLeft = Math.max(0, Math.round((new Date(goal.by + 'T12:00:00').getTime() - now.getTime()) / DAY));
  const expected = paceFor(current, goal.minutes) / 30.4;
  const observed = trendSlope(recent);
  const span = recent.length > 1 ? (new Date(recent.at(-1).date).getTime() - new Date(recent[0].date).getTime()) / DAY : 0;
  const weight = observed === null ? 0 : Math.min(1, span / 60);
  const slope = weight * observed + (1 - weight) * expected;
  const projected = Math.round(current + slope * daysLeft);
  let status = 'on-track';
  let weeksBehind = 0;
  if (current >= goal.target) status = 'reached';
  else if (projected < goal.target) {
    status = 'behind';
    weeksBehind = slope > 0 ? Math.ceil((goal.target - projected) / slope / 7) : null;
  }
  return { current, target: goal.target, by: goal.by, daysLeft, projected, status, weeksBehind, slope };
}
