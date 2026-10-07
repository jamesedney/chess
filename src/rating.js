// A simple Elo-style training rating, updated on the first attempt of each puzzle.

export function expectedScore(rating, opponent) {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

/** Larger steps while the rating is still finding its level. */
export function kFactor(count) {
  if (count < 10) return 60;
  if (count < 30) return 40;
  if (count < 100) return 28;
  return 20;
}

export function updateRating(rating, count, puzzleRating, score) {
  const delta = Math.round(kFactor(count) * (score - expectedScore(rating, puzzleRating)));
  return { rating: Math.max(100, Math.min(3500, rating + delta)), delta };
}

/** Keep one rating point per day, most recent last, at most a year. */
export function pushHistory(history, date, rating) {
  const out = history.filter(h => h.date !== date);
  out.push({ date, rating });
  return out.slice(-365);
}

/** The theme with the lowest rating among those with enough attempts. */
export function weakestTheme(themes, minCount = 3) {
  let weakest = null;
  for (const [name, t] of Object.entries(themes)) {
    if (t.count < minCount) continue;
    if (!weakest || t.rating < themes[weakest].rating) weakest = name;
  }
  return weakest;
}
