// Lessons for the learning path. Each practical lesson has worked examples the
// reader solves on a board. Example kinds:
//   answers: any listed first move is correct
//   mate:    any checkmating move is correct
//   line:    play the solver moves of `line`; replies are automatic
export const lessons = [
  {
    title: 'Stop giving pieces away',
    theme: 'Board vision',
    range: 'FOUNDATIONS',
    intro: 'Your first improvement is making every piece harder to win.',
    text: [
      'Before moving, ask what changed on the last move. A bishop may have opened a diagonal; a queen may now attack two pieces.',
      'Check the square you intend to use. Count attackers and defenders, but also compare their values: pawn 1, knight or bishop about 3, rook 5, queen 9. A defended pawn is not necessarily safe for your queen to capture.',
      'After choosing a move, imagine the opponent taking your most valuable exposed piece. If that works, look for a safer move.',
    ],
    rule: 'What can my opponent take after this move?',
    examples: [
      {
        fen: '6k1/5ppp/8/8/3q4/8/3R1PPP/6K1 w - - 0 1',
        kind: 'answers',
        answers: ['d2d4'],
        prompt: 'Black’s queen has wandered onto an undefended square. Win it.',
        explain: 'Rxd4 wins the queen: nothing defends d4. Always ask what your opponent left loose.',
      },
      {
        fen: 'rnbqkb1r/pppp1ppp/8/4n3/3P4/8/PPP2PPP/RNBQKBNR w KQkq - 0 4',
        kind: 'answers',
        answers: ['d4e5'],
        prompt: 'One black piece is attacked and has no defender. Take it.',
        explain: 'dxe5 wins a knight for nothing. The knight on e5 had no defender.',
      },
    ],
  },
  {
    title: 'Recognise the mating net',
    theme: 'King safety',
    range: 'FOUNDATIONS',
    intro: 'Checks matter when the king has nowhere useful to go.',
    text: [
      'A check forces an answer: capture the attacker, block the line, or move the king. Knight checks cannot be blocked.',
      'For back-rank mates, pawns imprison their own king. A rook or queen can finish the game if no defender can intervene.',
      'Always check every legal escape square. An attractive check is not checkmate if the king can capture the checking piece.',
    ],
    rule: 'Can the king capture, block, or escape?',
    examples: [
      {
        fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
        kind: 'mate',
        prompt: 'The black king is boxed in by its own pawns. Deliver mate.',
        explain: 'Re8# — the pawns on f7, g7 and h7 take away every escape square.',
      },
      {
        fen: '7k/8/5K2/8/8/8/8/6Q1 w - - 0 1',
        kind: 'mate',
        prompt: 'Mate in one, but beware of stalemate.',
        explain:
          'Qg7# is protected by the king. Careless moves such as Qg6 leave Black with no legal move and no check: stalemate, a draw.',
      },
    ],
  },
  {
    title: 'Win two targets at once',
    theme: 'Tactics',
    range: 'BUILD YOUR PATTERNS',
    intro: 'A forcing threat buys time for the second attack.',
    text: [
      'A fork attacks two targets. A knight fork with check is particularly forcing because the king must respond first.',
      'A pin discourages or prevents a defender from moving. If moving exposes the king to check, the pinned move is illegal. A skewer is the reverse: the valuable piece is in front and must step aside.',
      'Scan for loose pieces on the same rank, file or diagonal. Before starting a combination, check whether your attacking piece can simply be taken.',
    ],
    rule: 'Which two targets can one move attack?',
    examples: [
      {
        fen: '3q3k/6pp/8/4N3/8/8/6PP/R5K1 w - - 0 1',
        kind: 'line',
        line: ['e5f7', 'h8g8', 'f7d8'],
        prompt: 'Find the knight move that attacks the king and the queen together, then collect.',
        explain: 'Nf7+ forks king and queen. After the king moves, Nxd8 wins the queen.',
      },
      {
        fen: '8/1q6/8/3k4/8/8/8/5BK1 w - - 0 1',
        kind: 'line',
        line: ['f1g2', 'd5d4', 'g2b7'],
        prompt: 'King and queen stand on one diagonal. Skewer them.',
        explain: 'Bg2+ checks the king, which must step off the diagonal. Bxb7 then wins the queen behind it.',
      },
    ],
  },
  {
    title: 'Get out of the opening',
    theme: 'Opening habits',
    range: 'BUILD YOUR PATTERNS',
    intro: 'Aim for a playable position you understand.',
    text: [
      'Fight for the centre, develop your minor pieces and bring your king to safety. These are guides; immediate threats take priority.',
      'Moving the same piece repeatedly gives your opponent time to develop. Early queen adventures often give the opponent useful moves with tempo.',
      'Watch f2 and f7: initially only the king defends them. If your opponent brings out the queen and bishop, calculate the threat before making a routine developing move.',
    ],
    rule: 'What is the threat, and can I develop while meeting it?',
    examples: [
      {
        fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3',
        kind: 'answers',
        answers: ['g7g6', 'd8e7', 'd8f6', 'g8h6'],
        prompt: 'White threatens Qxf7 checkmate. Stop it.',
        explain: 'g6, Qe7, Qf6 and Nh6 all defend f7. The routine developing move Nf6?? loses at once to Qxf7#.',
      },
      {
        fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
        kind: 'mate',
        prompt: 'Black played Nf6?? and ignored the threat. Punish it.',
        explain: 'Qxf7#. The queen is protected by the bishop, and the king cannot capture it.',
      },
    ],
  },
  {
    title: 'Calculate the reply',
    theme: 'Calculation',
    range: 'THINK AHEAD',
    intro: 'A combination is only as good as the opponent’s best defence.',
    text: [
      'Choose two or three candidate moves. Start with forcing checks and captures, then consider direct threats.',
      'For each candidate, find the strongest reply for the opponent. Do not assume they take the bait. Continue until you reach a position you can assess.',
      'Compare the resulting positions, then do one final blunder check on the move you choose. Take the full time available rather than guessing from a familiar pattern.',
    ],
    rule: 'My move, their best reply, my next move.',
    examples: [
      {
        fen: '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16',
        kind: 'line',
        line: ['b3b8', 'd7b8', 'd1d8'],
        prompt: 'Morphy’s Opera Game, 1858. Sacrifice the queen and mate in two.',
        explain: 'Qb8+! forces Nxb8, and Rd8# follows: the knight left d7 and the bishop on g5 guards the escape square.',
      },
    ],
  },
  {
    title: 'Convert the advantage',
    theme: 'Endgames',
    range: 'FINISH THE JOB',
    intro: 'Winning material is only the beginning.',
    text: [
      'In a safe endgame, activate your king. It can help escort passed pawns and restrict the opposing king.',
      'With king and rook against king, use the rook to reduce the available space, then bring your king closer. Keep your rook far enough away that it cannot be captured.',
      'With a queen, keep checking for stalemate. If the opponent is not in check and has no legal move, the game is drawn.',
    ],
    rule: 'Improve my king, restrict theirs, avoid stalemate.',
    examples: [
      {
        fen: '7k/P7/6K1/8/8/8/8/8 w - - 0 1',
        kind: 'mate',
        prompt: 'Promote with checkmate.',
        explain: 'a8=Q# — the new queen checks along the back rank and your king covers g7 and h7.',
      },
      {
        fen: '7k/5K2/8/8/8/8/R7/8 w - - 0 1',
        kind: 'mate',
        prompt: 'Your king has done the work. Finish with the rook.',
        explain: 'Rh2# — the king on f7 covers g7 and g8, so the rook’s check is mate.',
      },
    ],
  },
  {
    title: 'Turn games into training',
    theme: 'Personal mistakes',
    range: 'THE 1500 HABIT',
    intro: 'Your own games reveal what to practise next.',
    text: [
      'Play a serious rapid game with time to think. Record the moments where you were uncertain before checking an engine.',
      'In Review a game, fetch your recent games from Lichess or Chess.com, or paste a PGN. The app saves significant missed opportunities as personal exercises and explains what went wrong. Engine evaluations are estimates, not a complete explanation of the position.',
      'Return to the saved positions without looking at the answer. Explain the threat to yourself, play your move, then check the continuation.',
    ],
    rule: 'One game, one useful lesson, one position to revisit.',
    examples: [],
  },
  {
    title: 'Build a repeatable routine',
    theme: 'Calculation',
    range: 'BEYOND THE BASICS',
    intro: 'Consistency is more useful than a one-off puzzle marathon.',
    text: [
      'Complete a short session most days. Prioritise due mistakes, then practise your weakest pattern. Use hints to learn, but solve without hints before calling a position mastered.',
      'Mix training with rated rapid games. Log your actual rating in Progress using one platform and time control so comparisons mean something.',
      'When improvement slows, inspect your losses: time pressure, opening confusion and endgame errors need different remedies. An app cannot guarantee a rating; use the evidence from your games to guide the next week.',
    ],
    rule: 'Train a weakness, test it in a game, review the result.',
    examples: [],
  },
];
