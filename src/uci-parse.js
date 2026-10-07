// Pure helpers for reading Stockfish's UCI output. Shared by the browser
// engine wrapper and the Node build tools, and covered by unit tests.

/**
 * Parse one `info ... pv ...` line.
 * Returns null for lines that carry no scored principal variation.
 * `score` is from the side to move's point of view, in centipawns.
 * Mates map to ±(100000 - distance) so that shorter mates sort higher.
 */
export function parseInfo(line) {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null;
  const score = line.match(/ score (cp|mate) (-?\d+)/);
  if (!score) return null;
  if (/ (lowerbound|upperbound)/.test(line)) return null;
  const value = Number(score[2]);
  const mate = score[1] === 'mate' ? value : null;
  const num = name => {
    const m = line.match(new RegExp(` ${name} (\\d+)`));
    return m ? Number(m[1]) : 0;
  };
  return {
    multipv: num('multipv') || 1,
    depth: num('depth'),
    nodes: num('nodes'),
    mate,
    score: mate === null ? value : mateScore(mate),
    pv: line
      .slice(line.indexOf(' pv ') + 4)
      .trim()
      .split(/\s+/),
  };
}

/** Score used for sorting and arithmetic when a line is a forced mate. */
export function mateScore(mate) {
  if (mate === 0) return -100000;
  return mate > 0 ? 100000 - mate : -100000 - mate;
}

/** Parse `bestmove e2e4 ponder e7e5`. */
export function parseBestMove(line) {
  if (!line.startsWith('bestmove')) return null;
  return line.split(/\s+/)[1] || null;
}
