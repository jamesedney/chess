// Training themes, puzzle tags and the text attached to them.

export const THEMES = ['Board vision', 'King safety', 'Tactics', 'Opening habits', 'Calculation', 'Endgames'];
export const PERSONAL = 'Personal mistakes';
export const ALL_THEMES = [...THEMES, PERSONAL];

/** Readable labels for Lichess-compatible puzzle tags. */
export const TAG_LABELS = {
  mate: 'Checkmate',
  mateIn1: 'Mate in 1',
  mateIn2: 'Mate in 2',
  mateIn3: 'Mate in 3',
  mateIn4: 'Mate in 4',
  mateIn5: 'Mate in 5',
  backRankMate: 'Back-rank mate',
  smotheredMate: 'Smothered mate',
  fork: 'Fork',
  pin: 'Pin',
  skewer: 'Skewer',
  discoveredAttack: 'Discovered attack',
  doubleCheck: 'Double check',
  hangingPiece: 'Free piece',
  sacrifice: 'Sacrifice',
  promotion: 'Promotion',
  underPromotion: 'Underpromotion',
  quietMove: 'Quiet move',
  endgame: 'Endgame',
  rookEndgame: 'Rook endgame',
  pawnEndgame: 'Pawn endgame',
  queenEndgame: 'Queen endgame',
  bishopEndgame: 'Bishop endgame',
  knightEndgame: 'Knight endgame',
  opening: 'Opening',
  middlegame: 'Middlegame',
  oneMove: 'One move',
  short: 'Two moves',
  long: 'Three moves',
  veryLong: 'Long line',
  advantage: 'Win material',
  crushing: 'Decisive',
  attackingF2F7: 'f2/f7 attack',
  enPassant: 'En passant',
  castling: 'Castling',
  trappedPiece: 'Trapped piece',
  deflection: 'Deflection',
  attraction: 'Attraction',
  capturingDefender: 'Remove the defender',
  intermezzo: 'In-between move',
  xRayAttack: 'X-ray',
  zugzwang: 'Zugzwang',
  defensiveMove: 'Defensive move',
  clearance: 'Clearance',
  interference: 'Interference',
  exposedKing: 'Exposed king',
  kingsideAttack: 'Kingside attack',
  queensideAttack: 'Queenside attack',
  anastasiaMate: 'Anastasia’s mate',
  arabianMate: 'Arabian mate',
  bodenMate: 'Boden’s mate',
  doubleBishopMate: 'Double-bishop mate',
  dovetailMate: 'Dovetail mate',
  hookMate: 'Hook mate',
  advancedPawn: 'Advanced pawn',
  equality: 'Hold the balance',
};

const MATE_TAGS = /^(mate|mateIn\d|backRankMate|smotheredMate|anastasiaMate|arabianMate|bodenMate|doubleBishopMate|dovetailMate|hookMate)$/;
const ENDGAME_TAGS = /Endgame$|^endgame$/;
const CALCULATION_TAGS = new Set(['long', 'veryLong', 'quietMove', 'defensiveMove', 'zugzwang', 'intermezzo']);

/** Pick the one training theme a puzzle belongs to, from its tags. */
export function primaryTheme(tags) {
  if (tags.some(t => MATE_TAGS.test(t))) return 'King safety';
  if (tags.includes('hangingPiece')) return 'Board vision';
  if (tags.includes('opening')) return 'Opening habits';
  if (tags.some(t => ENDGAME_TAGS.test(t))) return 'Endgames';
  if (tags.some(t => CALCULATION_TAGS.has(t))) return 'Calculation';
  return 'Tactics';
}

/** The tags worth showing, most specific first. */
export function displayTags(tags, limit = 3) {
  const order = [
    'smotheredMate',
    'backRankMate',
    'mateIn1',
    'mateIn2',
    'mateIn3',
    'mateIn4',
    'mateIn5',
    'fork',
    'pin',
    'skewer',
    'doubleCheck',
    'discoveredAttack',
    'hangingPiece',
    'sacrifice',
    'underPromotion',
    'promotion',
    'quietMove',
    'trappedPiece',
    'deflection',
    'attraction',
    'capturingDefender',
    'intermezzo',
    'attackingF2F7',
    'enPassant',
    'rookEndgame',
    'pawnEndgame',
    'queenEndgame',
    'bishopEndgame',
    'knightEndgame',
    'opening',
  ];
  return order
    .filter(t => tags.includes(t))
    .slice(0, limit)
    .map(t => TAG_LABELS[t] || t);
}

/** A spoiler-free nudge shown when the solver asks for a hint. */
export function hintForTags(tags) {
  if (tags.includes('mateIn1')) return 'There is a checkmate in one. Check every escape square.';
  if (tags.some(t => MATE_TAGS.test(t))) return 'Look for forcing checks that take away the king’s squares.';
  if (tags.includes('hangingPiece')) return 'Is every enemy piece defended?';
  if (tags.includes('fork')) return 'One move can attack two targets at once.';
  if (tags.includes('skewer')) return 'Attack a valuable piece that has something behind it.';
  if (tags.includes('pin')) return 'Something cannot move without exposing a bigger target.';
  if (tags.includes('doubleCheck') || tags.includes('discoveredAttack')) return 'Moving one piece can unleash another.';
  if (tags.includes('promotion')) return 'A pawn is close to becoming a new piece.';
  if (tags.includes('sacrifice')) return 'Be willing to give material for something bigger.';
  if (tags.includes('quietMove')) return 'The key move is not a check or a capture.';
  return 'Start with checks, captures and threats.';
}

export const STAGES = [
  { label: 'Foundation', rating: 800 },
  { label: 'Pattern builder', rating: 1100 },
  { label: 'Calculation', rating: 1400 },
  { label: 'Mixed practice', rating: 1600 },
];
