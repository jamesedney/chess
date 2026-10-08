// Strategy lessons: pawn structure, outposts, files, bishops, breaks, the
// worst piece, trading and king safety. Tap steps carry a `verify` rule from
// src/lesson-checks.js (backed by src/structure.js) and move steps are
// checked with Stockfish by tools/verify-lessons.mjs, like every lesson.
export const STRATEGY_SECTION = 'Strategy';

const STRUCTURE = 'r2q1rk1/pp3ppp/2p1pn2/2p5/3P4/5N2/PP3PPP/R2Q1RK1 w - - 0 12';
const PASSED = '8/5pk1/6p1/1P6/8/6P1/5PK1/8 w - - 0 1';
const OUTPOST = 'r2q1rk1/1b2bppp/p1n1pn2/1p1pN3/3P4/P1NBP3/1P3PPP/R2Q1RK1 w - - 0 1';
const TO_OUTPOST = 'r2q1rk1/1b2bppp/p3pn2/1p1p4/3P4/P2NPN2/1P1B1PPP/R2Q1RK1 w - - 0 1';
const OPEN_FILE = 'r4rk1/ppp1bppp/2n5/8/8/2N5/PPP1PPPP/R3R1K1 w - - 0 1';
const SEVENTH = '6k1/R4ppp/8/8/8/8/5PPP/6K1 w - - 0 1';
const BISHOPS = '6k1/6p1/2b2p1p/3pP3/2pP4/2P3P1/5P2/2B3K1 w - - 0 1';
const CHAIN = 'rnbqkbnr/ppp2ppp/4p3/3pP3/3P4/8/PPP2PPP/RNBQKBNR b KQkq - 0 3';
const RIM_KNIGHT = '2rr2k1/pp2bppp/2n1p3/3p4/N2P4/4P3/PP2BPPP/2RR2K1 w - - 0 1';
const AHEAD = '3q1rk1/pp3ppp/2n5/8/8/2N2B2/PP3PPP/3Q1RK1 w - - 0 1';
const WEAK_KING = 'r4rk1/pp3p2/2n3p1/8/2B5/2N5/PP3PPP/R3R1K1 w - - 0 1';

export const STRATEGY_LESSONS = [
  {
    id: 'pawn-structure',
    title: 'Read the pawn structure',
    theme: 'Strategy',
    section: STRATEGY_SECTION,
    intro: 'Pawns cannot move backwards, so their shape decides the long game. Learn to spot isolated, doubled and passed pawns.',
    rule: 'Before you plan, look at the pawns: which are weak, which are strong?',
    steps: [
      {
        kind: 'read',
        fen: STRUCTURE,
        highlight: ['d4', 'c6', 'c5'],
        text: 'Three pawn facts. White’s d-pawn has no neighbour on the c- or e-file: it is isolated, and only pieces can ever defend it. Black’s c-pawns stand on the same file: doubled, so the back one can never be defended by a pawn either. Weak pawns are targets for the rest of the game.',
      },
      {
        kind: 'tap',
        fen: STRUCTURE,
        verify: 'isolated:w',
        targets: ['d4'],
        text: 'Tap White’s isolated pawn.',
        explain: 'No white pawn on the c- or e-file can ever support d4. Black can pile up on it with rooks and a knight.',
      },
      {
        kind: 'tap',
        fen: STRUCTURE,
        verify: 'doubled:b',
        targets: ['c6', 'c5'],
        text: 'Tap one of Black’s doubled pawns.',
        explain:
          'c6 and c5 share a file. The front one blocks the back one, and together they control fewer squares than two healthy pawns would.',
      },
      {
        kind: 'tap',
        fen: PASSED,
        verify: 'passed:w',
        targets: ['b5'],
        text: 'Now a strong pawn. Tap White’s passed pawn: no enemy pawn can stop it on its file or the files beside it.',
        explain:
          'Nothing on the a-, b- or c-file can ever block or capture the b-pawn. Passed pawns tie the opponent down and win endgames.',
      },
      {
        kind: 'choice',
        text: 'Why is an isolated pawn a long-term weakness?',
        options: [
          {
            label: 'No pawn can ever defend it, so pieces have to',
            correct: true,
            why: 'Pieces tied to guarding a pawn are pieces not doing anything else. That is the real cost.',
          },
          {
            label: 'It cannot move',
            correct: false,
            why: 'It can move. Advancing it sometimes even frees your position. The problem is that nothing can protect it.',
          },
          {
            label: 'It is always lost',
            correct: false,
            why: 'Often it survives. But defending it costs activity all game long.',
          },
        ],
      },
      {
        kind: 'move',
        fen: '8/1P3pk1/6p1/8/8/6P1/5PK1/8 w - - 0 1',
        answers: ['b7b8q'],
        text: 'Passed pawns must be pushed. Finish the job.',
        explain: 'b8=Q. A passed pawn is a plan on its own: every move it advances, the opponent has to answer.',
      },
    ],
  },
  {
    id: 'outposts',
    title: 'Find the outpost',
    theme: 'Strategy',
    section: STRATEGY_SECTION,
    intro:
      'An outpost is a square in the enemy half that your pawn defends and no enemy pawn can ever attack. A knight there is a monster.',
    rule: 'Is there a square deep in their position that a pawn can never chase me from?',
    steps: [
      {
        kind: 'read',
        fen: OUTPOST,
        highlight: ['c5'],
        text: 'Look at c5. The d4-pawn defends it. Black’s b- and d-pawns have already passed it, so no black pawn can ever attack it. That makes c5 an outpost: a piece placed there stays for good.',
      },
      {
        kind: 'tap',
        fen: OUTPOST,
        verify: 'outpost:w',
        targets: ['c5'],
        text: 'Tap the outpost square for a white piece.',
        explain:
          'c5: defended by the d4-pawn, out of reach of every black pawn. The knight on e5 is not on an outpost, because the f-pawn can one day play ...f6.',
      },
      {
        kind: 'move',
        fen: TO_OUTPOST,
        answers: ['d3c5'],
        text: 'Put the knight on the outpost.',
        explain: 'Nc5. From there it hits b7, e6 and a6, and nothing can remove it. A knight on an outpost is worth more than a bishop.',
      },
      {
        kind: 'choice',
        text: 'What makes a square an outpost?',
        options: [
          {
            label: 'Your pawn defends it and no enemy pawn can ever attack it',
            correct: true,
            why: 'Both parts matter. Pawn protection keeps your piece safe; no enemy pawn means it will not be chased away.',
          },
          {
            label: 'Any square in the centre',
            correct: false,
            why: 'A central square an enemy pawn can attack is only a visit, not a home.',
          },
          {
            label: 'A square next to the enemy king',
            correct: false,
            why: 'Nice if you can get it, but an outpost is about pawns, not kings.',
          },
        ],
      },
    ],
  },
  {
    id: 'open-files',
    title: 'Rooks belong on open files',
    theme: 'Strategy',
    section: STRATEGY_SECTION,
    intro: 'Rooks need open lines. Find the file with no pawns, own it, and aim for the seventh rank.',
    rule: 'Where is the open file, and whose rook gets there first?',
    steps: [
      {
        kind: 'read',
        fen: OPEN_FILE,
        highlight: ['d1', 'd8'],
        text: 'Neither side has a pawn on the d-file, so it is open. Whoever puts a rook there first controls the only highway into the other camp.',
      },
      {
        kind: 'tap',
        fen: OPEN_FILE,
        verify: 'open-file',
        targets: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'],
        text: 'Tap any square on the open file.',
        explain: 'The d-file. Every other file has a pawn on it somewhere.',
      },
      {
        kind: 'move',
        fen: OPEN_FILE,
        answers: ['e1d1', 'a1d1'],
        text: 'Take the open file before Black does.',
        explain: 'Rd1. If Black answers with a rook on d8, trade or double up. If not, the rook goes to d7 and feasts on pawns.',
      },
      {
        kind: 'read',
        fen: SEVENTH,
        highlight: ['a7'],
        text: 'The seventh rank is the prize. A rook there attacks the pawns from the side and traps the king on the back rank. Two rooks on the seventh usually win.',
      },
      {
        kind: 'choice',
        text: 'Your rook is on an open file but the opponent’s rook faces it. What next?',
        options: [
          {
            label: 'Double rooks on the file, or trade if the resulting endgame suits you',
            correct: true,
            why: 'Doubling wins the file by force. Trading is fine when what is left favours you.',
          },
          {
            label: 'Leave the file to avoid a trade',
            correct: false,
            why: 'Giving up the file hands them the highway. Contest it.',
          },
          {
            label: 'Push the pawn next to it',
            correct: false,
            why: 'That may create a new weakness and does nothing for the file.',
          },
        ],
      },
    ],
  },
  {
    id: 'bishops',
    title: 'Good bishop, bad bishop',
    theme: 'Strategy',
    section: STRATEGY_SECTION,
    intro: 'A bishop whose own pawns sit on its colour is a tall pawn. Learn to tell them apart and what to do about it.',
    rule: 'Are my pawns on my bishop’s colour? If so, trade it or move them.',
    steps: [
      {
        kind: 'read',
        fen: BISHOPS,
        highlight: ['c1', 'c6'],
        text: 'White’s pawns on c3, d4, e5, f2 and g3 all stand on dark squares, the colour of White’s bishop. It has nowhere to go: a bad bishop. Black’s pawns mostly sit on dark squares too, the opposite colour of Black’s light-squared bishop, which roams freely: a good bishop.',
      },
      {
        kind: 'tap',
        fen: BISHOPS,
        verify: 'bad-bishop:w',
        targets: ['c1'],
        text: 'Tap the bad bishop.',
        explain: 'The bishop on c1 is boxed in by its own dark-squared pawns. Count the pawns on its colour: five out of five.',
      },
      {
        kind: 'choice',
        text: 'Which bishop would you rather have here?',
        options: [
          {
            label: 'Black’s: its pawns are on the other colour, so its diagonals are open',
            correct: true,
            why: 'A bishop is as good as its diagonals. Pawns on the opposite colour keep them clear.',
          },
          {
            label: 'White’s: it defends its own pawns',
            correct: false,
            why: 'Defending pawns that block it is all it will ever do. That is a tall pawn.',
          },
          {
            label: 'They are equal, both are bishops',
            correct: false,
            why: 'Same piece, very different life. The pawns decide.',
          },
        ],
      },
      {
        kind: 'choice',
        text: 'You have a bad bishop. What is the plan?',
        options: [
          {
            label: 'Trade it, or get it outside the pawn chain, or move pawns off its colour',
            correct: true,
            why: 'Any of the three works. Trading a bad bishop for a good piece is one of the best deals in chess.',
          },
          {
            label: 'Keep it as a defender and never trade it',
            correct: false,
            why: 'That keeps the weakness forever. Bad bishops should be swapped or freed.',
          },
          {
            label: 'Put more pawns on its colour to protect them',
            correct: false,
            why: 'That makes it worse: even fewer squares.',
          },
        ],
      },
    ],
  },
  {
    id: 'pawn-breaks',
    title: 'Pawn breaks and space',
    theme: 'Strategy',
    section: STRATEGY_SECTION,
    intro: 'A locked pawn chain is attacked at its base, with a pawn. That break is the plan behind many openings.',
    rule: 'Which pawn move opens the position in my favour?',
    steps: [
      {
        kind: 'read',
        fen: CHAIN,
        highlight: ['d4', 'e5'],
        arrows: [{ from: 'c7', to: 'c5' }],
        text: 'White’s chain d4–e5 cramps Black. Its base is d4: the pawn that holds the rest up. Black attacks the base with ...c5, the pawn break. Capturing on d4 later opens the c-file and the long diagonal.',
      },
      {
        kind: 'move',
        fen: CHAIN,
        answers: ['c7c5'],
        text: 'Play the pawn break against the base of the chain.',
        explain:
          '...c5. This is the French Defence’s main plan: hit d4, then bring the knight to c6 and the queen to b6 against the same point.',
      },
      {
        kind: 'choice',
        text: 'Where do you attack a pawn chain?',
        options: [
          {
            label: 'At its base, the rearmost pawn that supports the rest',
            correct: true,
            why: 'Remove the base and the chain collapses. Attacking the head only trades a pawn that is already defended.',
          },
          {
            label: 'At its head, the most advanced pawn',
            correct: false,
            why: 'The head is defended by the pawn behind it. The base is where the chain is weak.',
          },
          {
            label: 'Never: a chain cannot be attacked',
            correct: false,
            why: 'Every chain has a base, and a pawn break aims at it.',
          },
        ],
      },
      {
        kind: 'choice',
        text: 'You have more space. What should you avoid?',
        options: [
          {
            label: 'Trading pieces: the cramped side wants trades, because it has less room for its pieces',
            correct: true,
            why: 'Space is worth more with pieces on the board. Keep them and prepare your own break.',
          },
          {
            label: 'Developing your pieces',
            correct: false,
            why: 'Always develop. Space is only useful when pieces fill it.',
          },
          {
            label: 'Castling',
            correct: false,
            why: 'King safety matters whatever the space count.',
          },
        ],
      },
    ],
  },
  {
    id: 'worst-piece',
    title: 'Improve your worst piece',
    theme: 'Strategy',
    section: STRATEGY_SECTION,
    intro: 'When there is no tactic, find your worst-placed piece and give it a better square. That is a plan you can always use.',
    rule: 'No tactic? Improve the piece doing the least.',
    steps: [
      {
        kind: 'read',
        fen: RIM_KNIGHT,
        highlight: ['a4'],
        text: 'Nothing is hanging and there is no attack. So ask: which white piece is doing the least? The knight on a4 is on the rim, where it controls only four squares and none of them matter.',
      },
      {
        kind: 'choice',
        text: 'Which white piece is the worst placed?',
        options: [
          {
            label: 'The knight on a4: on the edge, far from the centre',
            correct: true,
            why: 'A knight on the rim is dim. Bringing it to c5 doubles its reach.',
          },
          {
            label: 'The bishop on e2',
            correct: false,
            why: 'It is modest but it watches both diagonals and can come to f3 or d3.',
          },
          {
            label: 'The rook on d1',
            correct: false,
            why: 'It already stands on a half-open file, exactly where a rook belongs.',
          },
        ],
      },
      {
        kind: 'choice',
        fen: RIM_KNIGHT,
        text: 'Where should the knight go?',
        options: [
          {
            label: 'c5: protected by the d4-pawn, and no black pawn can ever chase it away',
            correct: true,
            why: 'Nc5 turns the worst piece into the best one. From c5 it hits b7 and e6 and sits on an outpost.',
          },
          {
            label: 'b6, attacking the rook on c8',
            correct: false,
            why: 'The a7-pawn simply takes it. A threat that loses a piece is not a threat.',
          },
          {
            label: 'Leave it: it defends the queenside',
            correct: false,
            why: 'On a4 it defends nothing that matters. Every move it stays there is a move wasted.',
          },
        ],
      },
      {
        kind: 'choice',
        text: 'A quiet position, no tactics, nothing to attack. What do you do?',
        options: [
          {
            label: 'Find the piece doing the least and give it a better square',
            correct: true,
            why: 'Small improvements add up. Strong players spend quiet moves rearranging pieces until the position plays itself.',
          },
          {
            label: 'Push a pawn in front of your king to start something',
            correct: false,
            why: 'Pawn moves cannot be taken back, and the king behind them gets weaker.',
          },
          {
            label: 'Offer a draw',
            correct: false,
            why: 'Quiet is not equal. The side that keeps improving usually wins.',
          },
        ],
      },
    ],
  },
  {
    id: 'trade-when-ahead',
    title: 'Trade pieces when ahead',
    theme: 'Strategy',
    section: STRATEGY_SECTION,
    intro: 'Up material, you want fewer pieces on the board, not fewer pawns. Each trade makes your extra piece count for more.',
    rule: 'Ahead: trade pieces. Behind: keep pieces, trade pawns.',
    steps: [
      {
        kind: 'read',
        fen: AHEAD,
        highlight: ['f3'],
        text: 'White is a bishop up. With queens on, Black still has swindles: checks, threats against the king, counterplay. Trade the queens and the extra bishop decides the endgame on its own.',
      },
      {
        kind: 'move',
        fen: AHEAD,
        answers: ['d1d8'],
        text: 'You are a piece up. Simplify.',
        explain: 'Qxd8 Rxd8. Without queens there is nothing for Black to hope for, and the bishop plus rook will pick off pawns.',
      },
      {
        kind: 'choice',
        text: 'You are a piece up. Which trade should you avoid?',
        options: [
          {
            label: 'Trading pawns: fewer pawns means fewer winning chances and more drawing tricks',
            correct: true,
            why: 'Your extra piece needs pawns to win with. Trade pieces, keep pawns.',
          },
          {
            label: 'Trading queens',
            correct: false,
            why: 'Trading queens is usually exactly right when ahead: it removes their counterplay.',
          },
          {
            label: 'Trading rooks',
            correct: false,
            why: 'Fewer pieces, bigger extra piece. Rook trades help too.',
          },
        ],
      },
    ],
  },
  {
    id: 'king-plan',
    title: 'Plan around the king',
    theme: 'Strategy',
    section: STRATEGY_SECTION,
    intro: 'Weak squares around a king are a plan in themselves. Spot them, then bring enough pieces before you strike.',
    rule: 'Which squares next to the king does nothing defend, and how many pieces can I bring?',
    steps: [
      {
        kind: 'read',
        fen: WEAK_KING,
        highlight: ['h7', 'g7', 'h8'],
        text: 'Black has pushed ...g6 and the h-pawn is gone. The squares h7, g7 and h8 are defended by nothing but the king. That is where a white queen and bishop or rook would like to land.',
      },
      {
        kind: 'tap',
        fen: WEAK_KING,
        verify: 'loose-king:b',
        targets: ['g7', 'h7', 'h8'],
        text: 'Tap a square next to Black’s king that no black piece defends.',
        explain: 'g7, h7 and h8 are held by the king alone. One more attacker than defender on any of them and the king is in trouble.',
      },
      {
        kind: 'choice',
        text: 'The enemy king looks weak but most of your pieces are far away. What is the plan?',
        options: [
          {
            label: 'Bring more pieces towards the king first, then attack',
            correct: true,
            why: 'Attacks fail when they run out of attackers. Count: you need more pieces near the king than they have defenders.',
          },
          {
            label: 'Throw in a sacrifice now before they defend',
            correct: false,
            why: 'A sacrifice with nothing behind it is just a lost piece. Build up first.',
          },
          {
            label: 'Push your own king-side pawns to open lines',
            correct: false,
            why: 'That weakens your own king and takes many moves. Pieces attack; pawns help later.',
          },
        ],
      },
      {
        kind: 'choice',
        text: 'Your own king is the exposed one, and you are not attacking. What helps most?',
        options: [
          {
            label: 'Trade queens',
            correct: true,
            why: 'Without the enemy queen, an exposed king is rarely in danger. Trade it off and the weakness stops mattering.',
          },
          {
            label: 'Keep the queen to counter-attack',
            correct: false,
            why: 'With no attack of your own, the queen only gives the opponent a target to aim at.',
          },
          {
            label: 'Advance the pawns in front of your king',
            correct: false,
            why: 'Moving the shelter forward opens more lines against the king.',
          },
        ],
      },
    ],
  },
];
