import assert from 'node:assert/strict';
import {Chess} from './vendor/chess.js';
import {puzzles} from './puzzles.js';
import {lessons} from './lessons.js';
const ids=new Set();
for(const p of puzzles){assert(!ids.has(p.id));ids.add(p.id);const g=new Chess(p.fen);assert(p.line.length%2===1);for(const u of p.line)assert(g.move({from:u.slice(0,2),to:u.slice(2,4),promotion:u[4]}));if(p.goal==='Deliver checkmate in one.')assert(g.isCheckmate(),p.title);}
for(const l of lessons.filter(l=>l.theme!=='Personal mistakes'))assert(puzzles.some(p=>p.theme===l.theme),'No exercise for '+l.theme);
let g=new Chess();g.loadPgn('1. e4 e5 2. Nf3 Nc6');assert.equal(g.history().length,4);
g=new Chess('7k/P7/6K1/8/8/8/8/8 w - - 0 1');assert(g.move({from:'a7',to:'a8',promotion:'q'}));assert(g.isCheckmate());
g=new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');assert(g.move('O-O'));assert.equal(g.get('f1').type,'r');
g=new Chess('7k/8/8/3pP3/8/8/8/6K1 w - d6 0 1');assert(g.move('exd6'));assert.equal(g.get('d5'),undefined);
console.log(`${puzzles.length} puzzle lines legal; mating positions, lesson coverage, PGN, castling, en passant and promotion verified.`);
