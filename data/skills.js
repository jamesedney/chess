// The skills Rankup measures (one rating each, from puzzle tags and your
// games) and the one-line objective a practice game can carry for each.
// The curriculum that used to live here went in 6.0: training is planned from
// your games, not a ladder of units.

export const SKILLS = {
  safety: { label: 'Board safety', short: 'Safety' },
  tactics: { label: 'Tactics', short: 'Tactics' },
  mating: { label: 'Attacking the king', short: 'Mating' },
  calculation: { label: 'Calculation', short: 'Calculation' },
  strategy: { label: 'Strategy and judgement', short: 'Strategy' },
  endgames: { label: 'Endgames', short: 'Endgames' },
  openings: { label: 'Openings', short: 'Openings' },
};

export const OBJECTIVES = {
  safety: 'Before every move, check: after it, is any of my pieces undefended?',
  tactics: 'Each move, look for a fork, pin or loose piece for both sides.',
  mating: 'When their king is short of squares, look at every check first.',
  calculation: 'At every capture, calculate their best reply before you play.',
  strategy: 'When nothing is happening, improve your worst piece.',
  endgames: 'In the endgame, activate your king and push passed pawns.',
  openings: 'Develop every piece and castle before move ten.',
};
