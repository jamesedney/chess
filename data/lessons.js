// Interactive lessons for the learning path. Every lesson is a sequence of
// steps played on the board. Step kinds:
//   read    text, optionally with a position, highlighted squares and arrows
//   tap     tap one of the target squares
//   move    play one move: any of `answers` (UCI), or any checkmate when mate: true
//   line    play the solver's moves of `line`; the replies are automatic
//   choice  pick the one correct option
//   cta     a button that leads elsewhere in the app
// Positions are checked by tests (legality, mates) and by tools/verify-lessons.mjs (Stockfish).

export const SECTIONS = ['Foundations', 'Build your patterns', 'Think ahead', 'Finish the job', 'The 1500 habit'];

export const lessons = [
  {
    id: 'loose-pieces',
    title: 'Stop giving pieces away',
    theme: 'Board vision',
    section: 'Foundations',
    intro: 'Most games below 1500 are decided by pieces left undefended. Learn to see them, on both sides.',
    rule: 'What can my opponent take after this move?',
    steps: [
      {
        kind: 'read',
        fen: '6k1/5ppp/8/8/3q4/8/3R1PPP/6K1 w - - 0 1',
        highlight: ['d4'],
        text: 'A piece is loose when nothing of its own colour guards its square. The black queen on d4 is loose: no black piece could recapture if it were taken.',
      },
      {
        kind: 'move',
        fen: '6k1/5ppp/8/8/3q4/8/3R1PPP/6K1 w - - 0 1',
        answers: ['d2d4'],
        text: 'Take the loose queen.',
        explain: 'Rxd4. Before any deeper thinking, a quick scan for loose pieces often finds free material.',
      },
      {
        kind: 'tap',
        fen: 'r2qkb1r/ppp2ppp/2np1n2/4p3/2B1P1b1/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 6',
        targets: ['g4'],
        text: 'Tap the black piece (not a pawn) that no other black piece defends.',
        explain:
          'The bishop on g4 is loose. It is not attacked yet, but a move like h3 would ask it a question, and a tactic later could win it for nothing.',
      },
      {
        kind: 'tap',
        fen: 'rnbqkb1r/pppp1ppp/5n2/4p3/3PP3/8/PPP2PPP/RNBQKBNR b KQkq - 0 3',
        targets: ['e4'],
        text: 'Now the other side. It is Black to move. Tap the white pawn that Black can take for free.',
        explain:
          'The e4 pawn is attacked by the knight on f6 and defended by nothing. Looking at your own loose pieces is as important as spotting theirs.',
      },
      {
        kind: 'move',
        fen: 'rnbqkb1r/pppp1ppp/5n2/4p3/3PP3/8/PPP2PPP/RNBQKBNR b KQkq - 0 3',
        answers: ['f6e4', 'e5d4'],
        text: 'Win a pawn.',
        explain: 'Nxe4 takes the undefended pawn. Taking on d4 with the e-pawn also wins one. Either way, you saw what was free.',
      },
      {
        kind: 'choice',
        text: 'Rough values: pawn 1, knight 3, bishop 3, rook 5, queen 9. You can trade your knight for two of their pawns. Good deal?',
        options: [
          {
            label: 'Yes, two pieces for one',
            correct: false,
            why: 'Two pawns are worth about 2. A knight is worth about 3. You would lose a point of material.',
          },
          {
            label: 'No, I would be a point down',
            correct: true,
            why: 'Right. Count value, not pieces. Two pawns (2) for a knight (3) loses material.',
          },
          {
            label: 'It depends on the colour of the squares',
            correct: false,
            why: 'Square colour matters for bishops, not for this count. Two pawns for a knight loses a point.',
          },
        ],
      },
    ],
  },
  {
    id: 'checks-captures-threats',
    title: 'Checks, captures, threats',
    theme: 'Calculation',
    section: 'Foundations',
    intro: 'The scanning order strong players use on every move. Forcing moves first.',
    rule: 'Checks, then captures, then threats. Theirs and mine.',
    steps: [
      {
        kind: 'read',
        text: 'Before you move, list the forcing moves in order: every check, every capture, every threat. Do it for your opponent too. Forcing moves limit the replies, so they are the easiest to calculate and the most likely to win something.',
      },
      {
        kind: 'line',
        fen: '8/5ppk/7p/8/8/1n6/5PPP/3Q2K1 w - - 0 1',
        line: ['d1d3', 'h7g8', 'd3b3'],
        text: 'Checks first. Find the check that also attacks the loose knight, then collect it.',
        explain:
          'Qd3+ hits the king and the knight at once. Black must deal with the check, and the knight falls next move. Qc2+ works the same way.',
      },
      {
        kind: 'choice',
        fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
        text: 'Captures next, but check the recapture. Can White safely play Nxe5?',
        options: [
          {
            label: 'Yes, it wins a pawn',
            correct: false,
            why: 'The e5 pawn is defended by the knight on c6. After Nxe5 Nxe5, White has given a knight for a pawn.',
          },
          {
            label: 'No, Nc6 recaptures and White loses a knight for a pawn',
            correct: true,
            why: 'Exactly. A capture is only free when the recapture does not cost you more.',
          },
          {
            label: 'Yes, because the knight is defended by the queen',
            correct: false,
            why: 'The queen does not reach e5 from d1. Nxe5 Nxe5 simply loses a knight for a pawn.',
          },
        ],
      },
      {
        kind: 'tap',
        fen: 'r1bqk2r/pppp1ppp/2n5/2b1p3/2B1P1n1/5N2/PPPP1PPP/RNBQ1RK1 w kq - 0 6',
        targets: ['f2'],
        text: 'Threats last, and their threats before yours. Tap the square Black is attacking twice.',
        explain: 'The bishop on c5 and the knight on g4 both aim at f2, which only the king defends. Black threatens Bxf2+ or Nxf2.',
      },
      {
        kind: 'move',
        fen: 'r1bqk2r/pppp1ppp/2n5/2b1p3/2B1P1n1/5N2/PPPP1PPP/RNBQ1RK1 w kq - 0 6',
        answers: ['d2d4', 'd1e2', 'c2c3'],
        text: 'Meet the threat against f2.',
        explain:
          'd4 blocks the bishop’s diagonal and attacks it at the same time; c3 prepares the same push; Qe2 adds a second defender of f2. The point is that you looked at their threat before making your own plan.',
      },
    ],
  },
  {
    id: 'mating-net',
    title: 'Recognise the mating net',
    theme: 'King safety',
    section: 'Foundations',
    intro: 'A check is only mate when the king has no capture, no block and no escape square.',
    rule: 'Can the king capture, block, or escape?',
    steps: [
      {
        kind: 'read',
        fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
        highlight: ['f8', 'h8'],
        arrows: [{ from: 'e1', to: 'e8' }],
        text: 'The black king’s own pawns take away f7, g7 and h7. Its only squares are f8 and h8, and a rook on e8 covers both. That is a mating net: the check Re8 cannot be answered.',
      },
      {
        kind: 'tap',
        fen: '4R1k1/5p1p/8/8/8/8/5PPP/6K1 b - - 0 1',
        targets: ['g7'],
        text: 'Here the g-pawn has gone. The rook gives check. Tap the only square the black king can escape to.',
        explain: 'g7. The rook covers f8, and h8 is still on the rook’s line. With one hole in the pawn wall, the check is not mate.',
      },
      {
        kind: 'move',
        fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
        mate: true,
        text: 'Pawns intact. Deliver mate.',
        explain: 'Re8#. Always check the three escapes before you celebrate: capture, block, move. None works here.',
      },
      {
        kind: 'move',
        fen: '7k/8/5KQ1/8/8/8/8/8 w - - 0 1',
        mate: true,
        text: 'Queen and king against king. Mate in one, but one tempting move is stalemate.',
        explain:
          'Qg7#, protected by the king on f6. Qf7 or Qg6 would leave Black with no legal move and no check: stalemate, a draw from a won position.',
      },
      {
        kind: 'move',
        fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
        mate: true,
        text: 'Scholar’s mate. The queen needs a guard. Finish it.',
        explain: 'Qxf7#. The bishop on c4 protects the queen, so the king cannot capture, and every other square is covered.',
      },
      {
        kind: 'choice',
        text: 'A check is checkmate when…',
        options: [
          {
            label: 'the king cannot capture the checking piece, block the check, or move to a safe square',
            correct: true,
            why: 'All three must fail. Check them in that order every time.',
          },
          {
            label: 'the king cannot move',
            correct: false,
            why: 'The king might still capture the checking piece or have a block available.',
          },
          {
            label: 'two pieces give check at once',
            correct: false,
            why: 'Double check is strong, but the king may still have an escape square.',
          },
        ],
      },
    ],
  },
  {
    id: 'out-of-check',
    title: 'Get out of check well',
    theme: 'King safety',
    section: 'Foundations',
    intro: 'There are only three answers to a check. Pick the one that costs nothing, or gains time.',
    rule: 'Capture, block, or move. Which one loses nothing?',
    steps: [
      {
        kind: 'read',
        text: 'When you are in check you may capture the checking piece, put something in the way, or move the king. Knight checks cannot be blocked. The best answer usually improves your position too, for example a block that attacks the checking piece.',
      },
      {
        kind: 'move',
        fen: 'rnbqk1nr/pppp1ppp/8/4p3/1b2P3/8/PPPP1PPP/RNBQKBNR w KQkq - 2 3',
        answers: ['c2c3', 'b1c3'],
        text: 'The bishop checks from b4. Answer the check without losing anything.',
        explain:
          'c3 blocks and attacks the bishop, gaining time. Nc3 and Bd2 also block safely. Moving the king would give up castling for nothing.',
      },
      {
        kind: 'move',
        fen: '6k1/5ppp/8/8/8/5n2/5PPP/3R2K1 w - - 0 1',
        answers: ['g2f3'],
        text: 'A knight checks from f3. It cannot be blocked. Find the best answer.',
        explain: 'gxf3. The checking piece is simply captured. Moving the king would leave the knight alive.',
      },
      {
        kind: 'move',
        fen: '8/8/8/8/8/2k5/8/r3K3 w - - 0 1',
        answers: ['e1e2', 'e1f2'],
        text: 'Rook check along the first rank, nothing to block with. Move the king to a safe square.',
        explain: 'Ke2 or Kf2. The squares d1 and f1 are still on the rook’s line, and d2 is covered by the black king.',
      },
      {
        kind: 'choice',
        text: 'A knight gives check. Which of the three defences is never available?',
        options: [
          { label: 'Blocking', correct: true, why: 'A knight jumps, so nothing can stand in the way. Capture it or move the king.' },
          {
            label: 'Capturing',
            correct: false,
            why: 'If a piece covers the knight’s square you can capture it. Blocking is the one that never works.',
          },
          {
            label: 'Moving the king',
            correct: false,
            why: 'The king can usually move. Blocking is the one that never works against a knight.',
          },
        ],
      },
    ],
  },
  {
    id: 'forks',
    title: 'Win two targets at once',
    theme: 'Tactics',
    section: 'Build your patterns',
    intro: 'A fork attacks two things with one move. The opponent can save only one.',
    rule: 'Which two targets can one move attack?',
    steps: [
      {
        kind: 'read',
        fen: '3q3k/6pp/8/4N3/8/8/6PP/R5K1 w - - 0 1',
        highlight: ['d8', 'h8'],
        arrows: [{ from: 'e5', to: 'f7' }],
        text: 'From f7 a knight would attack both the king on h8 and the queen on d8. Because it is check, Black has no time to save the queen. Knight forks with check are the most forcing of all.',
      },
      {
        kind: 'line',
        fen: '3q3k/6pp/8/4N3/8/8/6PP/R5K1 w - - 0 1',
        line: ['e5f7', 'h8g8', 'f7d8'],
        text: 'Play the fork and collect the queen.',
        explain: 'Nf7+ Kg8 Nxd8. Look for squares a knight can reach that touch two valuable pieces.',
      },
      {
        kind: 'move',
        fen: '4k3/8/2n1n3/8/3P4/8/8/4K3 w - - 0 1',
        answers: ['d4d5'],
        text: 'Pawns fork too. Attack both knights.',
        explain: 'd5 attacks c6 and e6 at once. A pawn is worth 1; whichever knight stays is worth 3.',
      },
      {
        kind: 'move',
        fen: '4r1k1/5p1p/6p1/8/6N1/8/5PPP/6K1 w - - 0 1',
        answers: ['g4f6'],
        text: 'Find the knight check that also attacks the rook.',
        explain: 'Nf6+ forks the king and the rook on e8. After the king moves, Nxe8 wins the exchange.',
      },
      {
        kind: 'move',
        fen: '8/5ppk/7p/8/8/1n6/5PPP/3Q2K1 w - - 0 1',
        answers: ['d1d3', 'd1c2'],
        text: 'Queen fork: give check and attack the loose knight with the same move.',
        explain:
          'Qd3+ or Qc2+. The queen hits the king and b3 along two lines at once. Loose pieces are fork targets, and the queen reaches further than any other piece.',
      },
      {
        kind: 'choice',
        text: 'Before playing a fork, what should you check?',
        options: [
          {
            label: 'Whether the forking piece can simply be captured on its new square',
            correct: true,
            why: 'A fork on a defended square is just a blunder. Count defenders of the forking square first.',
          },
          {
            label: 'Whether the opponent has a knight',
            correct: false,
            why: 'Any piece can be forked. What matters is whether your forking piece is safe.',
          },
          {
            label: 'Whether it is a knight fork',
            correct: false,
            why: 'Pawns, bishops, rooks, queens and kings fork too. Check the safety of the forking square.',
          },
        ],
      },
    ],
  },
  {
    id: 'pins-skewers',
    title: 'Pins and skewers',
    theme: 'Tactics',
    section: 'Build your patterns',
    intro: 'Two pieces on one line. In a pin the small piece is in front; in a skewer the big one is.',
    rule: 'Two enemy pieces on one line: attack the line.',
    steps: [
      {
        kind: 'read',
        fen: '4k3/pp6/2n5/1B6/3P4/8/8/4K3 w - - 0 1',
        highlight: ['c6', 'e8'],
        arrows: [{ from: 'b5', to: 'e8' }],
        text: 'The bishop on b5 attacks through the knight to the king. The knight may not move, because that would expose the king to check. It is pinned, and a pinned piece is a target.',
      },
      {
        kind: 'line',
        fen: '4k3/pp6/2n5/1B6/3P4/8/8/4K3 w - - 0 1',
        line: ['d4d5', 'a7a6', 'd5c6'],
        text: 'Attack the pinned knight with a pawn, then take it.',
        explain: 'd5 attacks a knight that cannot run. Black can only attack the bishop; dxc6 wins the knight for a pawn.',
      },
      {
        kind: 'line',
        fen: '8/1q6/8/3k4/8/8/8/5BK1 w - - 0 1',
        line: ['f1g2', 'd5d4', 'g2b7'],
        text: 'King and queen stand on one diagonal, king in front. Skewer them.',
        explain: 'Bg2+ checks the king, which must step off the diagonal. Bxb7 then wins the queen behind it.',
      },
      {
        kind: 'tap',
        fen: 'r1bqk2r/pppp1ppp/2n2n2/4p3/1bB1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5',
        targets: ['c3'],
        text: 'Tap the white piece that is pinned.',
        explain:
          'The knight on c3 is pinned by the bishop on b4 against the king on e1. It can still move, because the king is not in check, but moving it would be illegal.',
      },
      {
        kind: 'choice',
        text: 'Your knight is pinned against your king. Can it move?',
        options: [
          {
            label: 'No. Moving it would expose the king to check, which is illegal',
            correct: true,
            why: 'An absolute pin, against the king, makes the pinned piece immobile.',
          },
          {
            label: 'Yes, if it captures something',
            correct: false,
            why: 'Even a capture would expose the king. Moving the pinned piece is illegal.',
          },
          {
            label: 'Yes, pins are only advice',
            correct: false,
            why: 'A pin against the king is a rule of the game: the piece cannot legally move.',
          },
        ],
      },
    ],
  },
  {
    id: 'discovered-attacks',
    title: 'Discovered attacks',
    theme: 'Tactics',
    section: 'Build your patterns',
    intro: 'Move one piece and unleash another. Two attacks at once, and the front piece can go anywhere.',
    rule: 'What is behind the piece I am moving?',
    steps: [
      {
        kind: 'read',
        fen: '1k5q/8/8/8/3N4/8/1B6/6K1 w - - 0 1',
        highlight: ['h8'],
        arrows: [{ from: 'b2', to: 'h8' }],
        text: 'The bishop on b2 looks along the long diagonal at the black queen, but the knight on d4 is in the way. Any knight move uncovers the attack. If the knight move is also a check, Black cannot save the queen.',
      },
      {
        kind: 'line',
        fen: '1k5q/8/8/8/3N4/8/1B6/6K1 w - - 0 1',
        line: ['d4c6', 'b8c8', 'b2h8'],
        text: 'Move the knight with check to uncover the bishop, then take the queen.',
        explain: 'Nc6+ checks the king and opens the diagonal. After the king moves, Bxh8 wins the queen.',
      },
      {
        kind: 'move',
        fen: '3rkb2/3p1p2/8/8/4N3/8/8/4R1K1 w - - 0 1',
        mate: true,
        text: 'Double check: the moving knight checks and uncovers the rook. The king cannot block or capture two attackers. Find the mate.',
        explain: 'Nf6# or Nd6#. In a double check only a king move helps, and here the king has no square.',
      },
      {
        kind: 'choice',
        text: 'Why is a discovered check so strong?',
        options: [
          {
            label: 'The front piece can move anywhere, even to an undefended square, because the opponent must answer the check first',
            correct: true,
            why: 'The check buys a free move for the front piece. That is why it can capture or attack with impunity.',
          },
          {
            label: 'It always wins the queen',
            correct: false,
            why: 'Often it wins material, but not always the queen. Its strength is the free move for the front piece.',
          },
          {
            label: 'It cannot be answered',
            correct: false,
            why: 'The king can still move or the check can be blocked. The point is the front piece’s free move.',
          },
        ],
      },
    ],
  },
  {
    id: 'opening-habits',
    title: 'Get out of the opening',
    theme: 'Opening habits',
    section: 'Build your patterns',
    intro: 'Aim for a position you understand: centre, development, king safety. Threats first.',
    rule: 'What is the threat, and can I develop while meeting it?',
    steps: [
      {
        kind: 'read',
        text: 'Three guides for the first ten moves: take space in the centre with pawns, bring knights and bishops out, castle. Move each piece once. These are guides, not rules: an immediate threat always comes first.',
      },
      {
        kind: 'choice',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
        text: 'White attacks the e5 pawn with the knight. Which reply is best?',
        options: [
          {
            label: 'Nc6: defends e5 and develops a piece',
            correct: true,
            why: 'One move that does two jobs. This is the most common move in chess for a reason.',
          },
          {
            label: 'f6: defends e5 with a pawn',
            correct: false,
            why: 'f6 weakens the king’s diagonal and takes the knight’s best square. Nxe5 is already a strong sacrifice against it.',
          },
          {
            label: 'Qe7: defends e5 with the queen',
            correct: false,
            why: 'The queen blocks the bishop on f8 and will be chased later. Nc6 does the job while developing.',
          },
        ],
      },
      {
        kind: 'move',
        fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p1N1/2B1P3/8/PPPP1PPP/RNBQK2R b KQkq - 0 4',
        answers: ['d7d5'],
        text: 'White’s knight and bishop both aim at f7. Find the move that blocks the bishop and fights for the centre.',
        explain:
          'd5! The pawn blocks the c4 bishop so that Nxf7 no longer works, and it attacks the bishop. The routine move h6 would be met by Nxf7.',
      },
      {
        kind: 'move',
        fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5',
        answers: ['e1g1'],
        text: 'Development is done on the kingside. Put the king somewhere safe.',
        explain: 'Castle. The king leaves the centre before the files open, and the rook joins the game.',
      },
      {
        kind: 'choice',
        text: 'Your opponent brings the queen out on move two. What is the best attitude?',
        options: [
          {
            label: 'Develop with threats against the queen, gaining time',
            correct: true,
            why: 'Every move that attacks the queen is a free developing move. Early queen trips usually hand the opponent the initiative.',
          },
          {
            label: 'Panic and trade queens as fast as possible',
            correct: false,
            why: 'No need. Develop pieces that attack the queen and she will have to move again and again.',
          },
          {
            label: 'Bring your own queen out to match',
            correct: false,
            why: 'Then both sides lose time. Develop minor pieces with tempo instead.',
          },
        ],
      },
    ],
  },
  {
    id: 'opening-traps',
    title: 'Traps every improver meets',
    theme: 'Opening habits',
    section: 'Build your patterns',
    intro: 'Three patterns that decide thousands of games a day. Know them from both sides.',
    rule: 'What does f7 (or f2) look like right now?',
    steps: [
      {
        kind: 'choice',
        fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3',
        text: 'White has played Bc4 and Qh5. What is the threat?',
        options: [
          {
            label: 'Qxf7 checkmate',
            correct: true,
            why: 'The queen takes f7 protected by the bishop, and the king has no escape. Only f7 is attacked twice and defended once.',
          },
          {
            label: 'Qxe5 winning a pawn',
            correct: false,
            why: 'Qxe5+ is a threat too, but the big one is Qxf7#. Always find the worst threat first.',
          },
          { label: 'Nothing serious', correct: false, why: 'Qxf7 is mate next move. Thousands of games end this way.' },
        ],
      },
      {
        kind: 'move',
        fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3',
        answers: ['g7g6', 'd8e7', 'd8f6', 'g8h6'],
        text: 'Stop the mate.',
        explain: 'g6 chases the queen and defends; Qe7, Qf6 and Nh6 also cover f7. The natural developing move Nf6?? loses to Qxf7#.',
      },
      {
        kind: 'line',
        fen: 'rn1qkbnr/ppp2p1p/3p2p1/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 5',
        line: ['f3e5', 'g4d1', 'c4f7', 'e8e7', 'c3d5'],
        text: 'Légal’s mate. Black has pinned your knight and played the careless g6. Sacrifice the queen and mate in three.',
        explain:
          'Nxe5! Bxd1 Bxf7+ Ke7 Nd5#. If Black declines with dxe5, Qxg4 simply wins a pawn. The pin was never real: the knight could move.',
      },
      {
        kind: 'choice',
        fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R b KQkq - 5 4',
        text: 'Can Black take the e4 pawn with the knight, even though Nc3 defends it?',
        options: [
          {
            label: 'Yes: after Nxe4 Nxe4 d5 forks the bishop and knight, winning the piece back',
            correct: true,
            why: 'The fork trick. Count the whole sequence, not just the first recapture.',
          },
          {
            label: 'No, the pawn is defended so the knight is lost',
            correct: false,
            why: 'It looks that way, but d5 next move forks two pieces and regains the material.',
          },
          { label: 'No, it is illegal', correct: false, why: 'It is perfectly legal, and good: Nxe4 Nxe4 d5 regains the piece.' },
        ],
      },
    ],
  },
  {
    id: 'calculate-reply',
    title: 'Calculate the reply',
    theme: 'Calculation',
    section: 'Think ahead',
    intro: 'A combination is only as good as the opponent’s best defence. Find their move before you play yours.',
    rule: 'My move, their best reply, my next move.',
    steps: [
      {
        kind: 'read',
        text: 'Pick two or three candidate moves, forcing ones first. For each, find the opponent’s strongest reply, not the one you hope for. Follow the line until the position is quiet enough to judge, then compare. Finally, blunder-check the move you chose.',
      },
      {
        kind: 'choice',
        fen: '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16',
        text: 'Morphy’s Opera Game, 1858. Three candidate moves. Which one wins by force?',
        options: [
          {
            label: 'Qb8+, sacrificing the queen',
            correct: true,
            why: 'Qb8+ Nxb8 Rd8#. The knight is dragged away from d7 and the bishop on g5 covers e7.',
          },
          { label: 'Rxd7, winning the knight', correct: false, why: 'Rxd7 Kxd7 and Black is still alive. Qb8+ mates instead.' },
          {
            label: 'Qxe6+, trading queens',
            correct: false,
            why: 'Qxe6 is not even possible safely, and trading would throw away a mate in two.',
          },
        ],
      },
      {
        kind: 'line',
        fen: '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16',
        line: ['b3b8', 'd7b8', 'd1d8'],
        text: 'Play it.',
        explain: 'Qb8+! Nxb8 Rd8#. Morphy saw Black’s only reply and the mate that followed before giving up his queen.',
      },
      {
        kind: 'choice',
        fen: 'rnbqkbnr/ppp2ppp/8/3pp3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3',
        text: 'Count before you take. The e5 pawn: how many attackers and defenders?',
        options: [
          {
            label: 'One attacker (Nf3), no defenders: Nxe5 wins a pawn',
            correct: true,
            why: 'Nothing guards e5. Taking is safe. Counting attackers and defenders is the fastest calculation there is.',
          },
          {
            label: 'One attacker, one defender: taking loses the knight',
            correct: false,
            why: 'Look again: the d5 pawn defends e4, not e5, and no black piece covers e5.',
          },
          { label: 'Two attackers, two defenders: even trade', correct: false, why: 'Only the knight attacks e5, and nothing defends it.' },
        ],
      },
      {
        kind: 'move',
        fen: 'rnbqkbnr/ppp2ppp/8/3pp3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3',
        answers: ['f3e5', 'e4d5'],
        text: 'Win a pawn.',
        explain: 'Nxe5 takes the undefended pawn. exd5 also wins one. Either way, you counted first.',
      },
    ],
  },
  {
    id: 'counting',
    title: 'Count attackers and defenders',
    theme: 'Calculation',
    section: 'Think ahead',
    intro: 'Most captures can be judged by counting. Equal numbers favour the defender.',
    rule: 'Count them, then count the values.',
    steps: [
      {
        kind: 'read',
        fen: 'rnbqkb1r/ppp1pppp/5n2/3p4/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 2 3',
        highlight: ['d5'],
        arrows: [
          { from: 'e4', to: 'd5' },
          { from: 'c3', to: 'd5' },
        ],
        text: 'The pawn on d5 is attacked twice, by the e4 pawn and the c3 knight. It is defended twice, by the knight on f6 and the queen on d8.',
      },
      {
        kind: 'choice',
        fen: 'rnbqkb1r/ppp1pppp/5n2/3p4/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 2 3',
        text: 'Two attackers against two defenders. Does exd5 win a pawn?',
        options: [
          {
            label: 'No. exd5 Nxd5 Nxd5 Qxd5 trades evenly',
            correct: true,
            why: 'Each capture is answered. With equal numbers the attacker runs out first, so nothing is won.',
          },
          {
            label: 'Yes, the pawn is taken first',
            correct: false,
            why: 'It is recaptured. Play the whole sequence: pawn, knight, knight, queen. Material ends level.',
          },
          {
            label: 'Yes, because the queen cannot recapture',
            correct: false,
            why: 'The queen on d8 does reach d5 once the knight is gone.',
          },
        ],
      },
      {
        kind: 'tap',
        fen: 'rnbqkb1r/ppp1pppp/5n2/3p4/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 2 3',
        targets: ['f6'],
        text: 'Tap the piece, other than the queen, that defends d5.',
        explain: 'The knight on f6. To win d5, White would need a third attacker or a way to remove this defender.',
      },
      {
        kind: 'choice',
        text: 'Attackers and defenders are equal in number, but the first attacker is a queen and the defender is a pawn. Should you capture?',
        options: [
          {
            label: 'No. Order matters: you would lose the queen for a pawn on the first exchange',
            correct: true,
            why: 'Count values as well as numbers. Capture with your least valuable piece first.',
          },
          {
            label: 'Yes, equal numbers means an even trade',
            correct: false,
            why: 'Only if the values are comparable. A queen taking a defended pawn loses nine for one.',
          },
          {
            label: 'Yes, the queen is the strongest piece',
            correct: false,
            why: 'Strength is why you should not spend her on a defended pawn.',
          },
        ],
      },
    ],
  },
  {
    id: 'promotion',
    title: 'Promote the pawn',
    theme: 'Endgames',
    section: 'Finish the job',
    intro: 'In king and pawn endings the king leads and the pawn follows. One tempo decides.',
    rule: 'King in front of the pawn, then take the opposition.',
    steps: [
      {
        kind: 'read',
        fen: '8/4k3/8/4K3/4P3/8/8/8 w - - 0 1',
        highlight: ['e5', 'e7'],
        text: 'Kings face each other with one square between: the opposition. Whoever must move gives way. Here it is White to move, so White must step aside and the pawn cannot be escorted through. With Black to move, White would win.',
      },
      {
        kind: 'move',
        fen: '8/3k4/8/4K3/4P3/8/8/8 w - - 0 1',
        answers: ['e5f6'],
        text: 'Black has stepped aside to d7. Go around the pawn with your king.',
        explain:
          'Kf6! The king takes the square in front of the pawn’s path and keeps the opposition. Pushing the pawn or going to d5 lets Black hold the draw.',
      },
      {
        kind: 'move',
        fen: '7k/P7/6K1/8/8/8/8/8 w - - 0 1',
        mate: true,
        text: 'Promote with checkmate.',
        explain: 'a8=Q#. The new queen checks along the rank and your king covers g7 and h7.',
      },
      {
        kind: 'move',
        fen: '7k/8/6QK/8/8/8/8/8 w - - 0 1',
        mate: true,
        text: 'Mate in one. One natural move is stalemate instead.',
        explain: 'Qg7#, guarded by the king. Qf7 leaves Black with no legal move and no check: stalemate and a draw.',
      },
      {
        kind: 'line',
        fen: '7k/8/8/8/8/8/R7/1R4K1 w - - 0 1',
        line: ['a2a7', 'h8g8', 'b1b8'],
        text: 'Two rooks. Take away the seventh rank, then mate on the eighth.',
        explain: 'Ra7 confines the king to the back rank, then Rb8#. The ladder: one rook cuts, the other checks.',
      },
    ],
  },
  {
    id: 'rook-mate',
    title: 'Mate with king and rook',
    theme: 'Endgames',
    section: 'Finish the job',
    intro: 'The rook builds a box, the king shrinks it. The mate comes on the edge.',
    rule: 'Cut off, bring the king, give check only when it shrinks the box.',
    steps: [
      {
        kind: 'read',
        fen: '8/8/8/3k4/8/8/8/R3K3 w - - 0 1',
        text: 'A lone king cannot be mated in the middle. The rook cuts it off along a rank or file, the attacking king walks up to face it, and a rook check drives it back one line at a time until it reaches the edge.',
      },
      {
        kind: 'move',
        fen: '8/8/8/3k4/8/8/8/R3K3 w - - 0 1',
        answers: ['a1a4', 'a1d1'],
        text: 'Cut the king off: take away a rank or a file with the rook.',
        explain:
          'Ra4 fences the king into the top half of the board. Rd1+ does the same job on a file, pushing it towards one side. Then the white king comes up.',
      },
      {
        kind: 'move',
        fen: '7k/5K2/8/8/8/8/R7/8 w - - 0 1',
        mate: true,
        text: 'The king has done the work. Finish with the rook.',
        explain: 'Rh2#. The king on f7 covers g7 and g8, so the rook check on the h-file is mate.',
      },
      {
        kind: 'choice',
        text: 'Your rook is next to the enemy king and nothing defends it. What happens?',
        options: [
          {
            label: 'The king takes it, and the game is a draw',
            correct: true,
            why: 'Keep the rook at least two squares away from the enemy king unless your own king protects it.',
          },
          {
            label: 'Nothing, kings cannot capture rooks',
            correct: false,
            why: 'Kings capture any undefended piece. Keep the rook at a distance.',
          },
          { label: 'It is stalemate', correct: false, why: 'Stalemate needs no legal moves. Here the king simply captures the rook.' },
        ],
      },
    ],
  },
  {
    id: 'games-into-training',
    title: 'Turn games into training',
    theme: 'Personal mistakes',
    section: 'The 1500 habit',
    intro: 'Your own games reveal what to practise next. Review them and let the mistakes become exercises.',
    rule: 'One game, one useful lesson, one position to revisit.',
    steps: [
      {
        kind: 'read',
        text: 'Play a serious rapid game with time to think. Afterwards, bring it to Review a game: fetch it from Lichess or Chess.com, or paste the PGN. Stockfish marks the moments that cost you winning chances and explains what went wrong.',
      },
      {
        kind: 'choice',
        text: 'The reviewer marks a move as a blunder and a move as an inaccuracy. Which deserves your attention first?',
        options: [
          {
            label: 'The blunder: it cost the most winning chances and will be saved as an exercise',
            correct: true,
            why: 'Fix the big leaks first. Inaccuracies matter later, once blunders are rare.',
          },
          {
            label: 'The inaccuracy: small errors are harder to see',
            correct: false,
            why: 'True, but one blunder outweighs ten inaccuracies at this level.',
          },
          {
            label: 'Neither; engines are always right so there is nothing to learn',
            correct: false,
            why: 'The engine finds the moment. Understanding why your move failed is the lesson.',
          },
        ],
      },
      {
        kind: 'read',
        text: 'Saved positions appear in My mistakes. Solve them again without looking at the answer: say the threat out loud, play your move, then compare with the engine’s. They return on a schedule until you get them right without help.',
      },
      { kind: 'cta', text: 'Review one of your games now.', label: 'Open Review a game', page: 'review' },
    ],
  },
  {
    id: 'routine',
    title: 'Build a repeatable routine',
    theme: 'Calculation',
    section: 'The 1500 habit',
    intro: 'Consistency beats intensity. A short session most days moves a rating; a marathon once a month does not.',
    rule: 'Train a weakness, test it in a game, review the result.',
    steps: [
      {
        kind: 'choice',
        text: 'Which schedule improves a rating more over a year?',
        options: [
          {
            label: 'Eight positions a day, most days',
            correct: true,
            why: 'Daily repetition is how patterns become automatic. Spaced reviews only work if you come back.',
          },
          {
            label: 'Sixty positions every Sunday',
            correct: false,
            why: 'Cramming fades by midweek. Short daily sessions keep the patterns fresh.',
          },
          {
            label: 'Only playing, never puzzles',
            correct: false,
            why: 'Games test you; puzzles and review are how you learn from the tests.',
          },
        ],
      },
      {
        kind: 'read',
        text: 'A good week: a short adaptive session most days, with due mistakes first. Two or three thoughtful rapid games. One game reviewed properly. Log your real rating on one platform and time control so the trend means something.',
      },
      {
        kind: 'choice',
        text: 'Your puzzle rating is climbing but your game rating is not. What is the most likely reason?',
        options: [
          {
            label: 'In games you are not spending time on the opponent’s threats and replies',
            correct: true,
            why: 'Puzzles tell you a tactic exists. In games nobody does, so the scanning habit from lesson two has to run on every move.',
          },
          {
            label: 'The puzzles are too easy',
            correct: false,
            why: 'A rising puzzle rating means they are getting harder. The gap is usually about habits in play, not puzzle strength.',
          },
          {
            label: 'Ratings are random',
            correct: false,
            why: 'Over a few dozen games they are a fair measure. Look at your losses for the pattern.',
          },
        ],
      },
      { kind: 'cta', text: 'Start today’s session.', label: 'Go to training', page: 'train' },
    ],
  },
];
