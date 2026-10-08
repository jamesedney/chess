// What kind of mistake a saved position records, and which game phase it came from.
// Pure: shared by the state migration, the coach and the tests.
import { Chess } from '../vendor/chess.js';

/**
 * Mistake kinds, ordered from most to least urgent.
 * theme is the training theme that practises the missing skill.
 */
export const KINDS = {
  'allowed-mate': {
    label: 'Allowed a mating attack',
    plural: 'times you allowed a mating attack',
    theme: 'King safety',
    habit: 'Before every move, ask what checks your opponent has after it.',
  },
  'hung-piece': {
    label: 'Left material en prise',
    plural: 'times you left material en prise',
    theme: 'Board vision',
    habit: 'Before you let go of a piece, check every square it leaves undefended.',
  },
  'missed-mate': {
    label: 'Missed a checkmate',
    plural: 'missed checkmates',
    theme: 'King safety',
    habit: 'When the enemy king is short of squares, look at every check first.',
  },
  'missed-tactic': {
    label: 'Missed a tactic',
    plural: 'missed tactics',
    theme: 'Tactics',
    habit: 'Scan checks, captures and threats for both sides before choosing.',
  },
  positional: {
    label: 'Drifted into a worse position',
    plural: 'quieter slips',
    theme: 'Strategy',
    habit: 'In quiet positions, compare two candidate moves before choosing.',
  },
};

export const KIND_IDS = Object.keys(KINDS);

/** Best-effort kind for positions saved before kinds were recorded. */
export function kindFromExplanation(text = '') {
  if (/allowed a forced mate/.test(text)) return 'allowed-mate';
  if (/You had a forced mate/.test(text)) return 'missed-mate';
  if (/exposed: .* wins material/.test(text)) return 'hung-piece';
  if (/forks|skewers|pins|uncovers|double check|undefended|makes a new|Material is given up/.test(text)) return 'missed-tactic';
  return 'positional';
}

/**
 * Game phase of a position. Opening: the first ten moves with most pieces on.
 * Endgame: six or fewer queens, rooks and minor pieces in total. Otherwise middlegame.
 */
export function phaseOf(fen) {
  let pieces = 0;
  try {
    for (const row of new Chess(fen).board()) for (const p of row) if (p && p.type !== 'k' && p.type !== 'p') pieces++;
  } catch {
    return 'middlegame';
  }
  const move = Number(fen.split(' ')[5]) || 1;
  if (pieces <= 6) return 'endgame';
  if (move <= 10 && pieces >= 10) return 'opening';
  return 'middlegame';
}
