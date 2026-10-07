import {Chess} from './vendor/chess.js';
import {spawn} from 'node:child_process';import fs from 'node:fs';
const sf=spawn(process.execPath,['node_modules/stockfish/src/stockfish-17.1-lite-single-03e3232.js']);let buffer='',listen=()=>{};sf.stdout.on('data',d=>{buffer+=d;let i;while((i=buffer.indexOf('\n'))>=0){let l=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);listen(l);}});sf.stderr.on('data',d=>process.stderr.write(d));
await new Promise(r=>{listen=l=>{if(l==='uciok')r()};sf.stdin.write('uci\n')});sf.stdin.write('setoption name Hash value 32\nsetoption name MultiPV value 2\n');
const evalFen=fen=>new Promise(r=>{let lines={};listen=l=>{let m=l.match(/multipv (\d+).*score (cp|mate) (-?\d+).* pv (.+)/);if(m)lines[m[1]]={score:m[2]==='mate'?(+m[3]>0?100000:-100000):+m[3],mate:m[2]==='mate'?+m[3]:null,pv:m[4].split(' ')};if(l.startsWith('bestmove'))r(lines)};sf.stdin.write('position fen '+fen+'\ngo depth 13\n');});
const seeds=[
['Back-rank finish','6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1','King safety',0,'A king trapped behind its pawns is vulnerable to a rook entering the back rank.'],
['Queen and king','7k/8/5KQ1/8/8/8/8/8 w - - 0 1','Endgames',0,'Use your king to protect your queen. Give check while covering every escape square.'],
['Knight fork','3q3k/6pp/8/4N3/8/8/6PP/R5K1 w - - 0 1','Tactics',1,'A check gains time. Look for a knight move that attacks the king and queen together.'],
['Remove the queen','6k1/5ppp/8/8/3q4/8/3R1PPP/6K1 w - - 0 1','Board vision',0,'Before calculating anything complicated, scan for an undefended piece you can capture.'],
['Promotion race','7k/P7/6K1/8/8/8/8/8 w - - 0 1','Endgames',0,'Passed pawns become stronger pieces. Check whether promotion comes with a forcing threat.'],
['Rook on the seventh','7k/5K2/8/8/8/8/R7/8 w - - 0 1','Endgames',1,'The attacking king cuts off escape squares. Find the rook check that finishes the job.'],
['Two-rook ladder','7k/8/8/8/8/8/R7/1R4K1 w - - 0 1','Endgames',1,'One rook takes away a rank while the other delivers check. Coordinate both rooks.'],
['Long diagonal','6k1/5ppp/8/8/8/2B5/8/6KQ w - - 0 1','King safety',1,'Trace the queen’s diagonal towards the king and check which squares are defended.'],
];
const games=[
['Opera game','1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8#'],
['Legal’s trap','1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5#'],
['Scholar’s attack','1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#'],
['Fool’s mate','1. f3 e5 2. g4 Qh4#'],
['Blackburne’s trap','1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3#'],
['Opening punishment','1. e4 e5 2. Nf3 f6 3. Nxe5 fxe5 4. Qh5+ Ke7 5. Qxe5+ Kf7 6. Bc4+ d5 7. Bxd5+ Kg6 8. h4 h5 9. Bxb7 Bxb7 10. Qf5+ Kh6 11. d4+ g5 12. Qf7'],
['Greco’s attack','1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. d4 exd4 6. e5 d5 7. exf6 dxc4 8. Re1+ Be6 9. Ng5 Qd5 10. Nc3 Qf5 11. g4 Qg6 12. Nce4 Bb6 13. fxg7 Rg8 14. Nxe6 fxe6 15. Ng5 Rxg7 16. Rxe6+'],
['Centre fork','1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Nc3 Nxe4 5. Nxe4 d5 6. Bd3 dxe4 7. Bxe4']
];
let candidates=seeds.map(([title,fen,theme,level,explanation])=>({title,fen,theme,level,explanation}));for(const [name,pgn] of games){const g=new Chess();try{g.loadPgn(pgn)}catch(e){console.log('skip invalid game',name,e.message);continue}const moves=g.history();g.reset();for(let n=0;n<moves.length;n++){if(n>=5)candidates.push({title:name+' · move '+(Math.floor(n/2)+1),fen:g.fen(),theme:n<14?'Opening habits':'Calculation',level:n<10?1:2,explanation:'Look at checks and captures first. Calculate the opponent’s strongest reply before committing.'});g.move(moves[n]);}}
const puzzles=[];for(const c of candidates){const g=new Chess(c.fen);if(g.isGameOver())continue;const a=await evalFen(c.fen);if(!a[1]||!a[2])continue;const best=a[1],second=a[2];let gap=best.score-second.score;const singleMate=best.mate===1;const uniqueMate=best.mate>0&&(!second.mate||second.mate>best.mate);if(!(singleMate||uniqueMate||(best.score>=100&&gap>=160)))continue;let length=(singleMate||c.theme==='Board vision')?1:Math.min(5,best.pv.length);if(length%2===0)length--;const line=[];for(const u of best.pv.slice(0,length)){try{const m=g.move({from:u.slice(0,2),to:u.slice(2,4),promotion:u[4]});if(!m)break;line.push(u);}catch{break;}}if(!line.length)continue;if(line.length%2===0)line.pop();c.line=line;c.level=singleMate?0:(best.mate&&best.mate<=3?1:c.level);c.goal=singleMate?'Deliver checkmate in one.':best.mate>0?'Find the forcing attack.':'Find the strongest continuation.';if(singleMate&&c.theme!=='Endgames')c.theme='King safety';c.id='p'+String(puzzles.length+1).padStart(3,'0');puzzles.push(c);console.log(c.id,c.title,best.score,best.mate,line.join(' '));}
// Colour-swapped reflections preserve every legal relationship and train Black too.
const originals=[...puzzles];for(const p of originals){const g=new Chess(p.fen),out=new Chess();out.clear();for(const row of g.board())for(const x of row)if(x)out.put({type:x.type,color:x.color==='w'?'b':'w'},x.square[0]+(9-Number(x.square[1])));const f=out.fen().split(' '),src=p.fen.split(' ');f[1]=src[1]==='w'?'b':'w';f[2]=src[2]==='-'?'-':src[2].split('').map(x=>x===x.toUpperCase()?x.toLowerCase():x.toUpperCase()).sort((a,b)=>'KQkq'.indexOf(a)-'KQkq'.indexOf(b)).join('');f[3]=src[3]==='-'?'-':src[3][0]+(9-Number(src[3][1]));const line=p.line.map(u=>u[0]+(9-Number(u[1]))+u[2]+(9-Number(u[3]))+(u[4]||''));puzzles.push({...p,id:p.id+'b',title:p.title+' · reversed colours',fen:f.join(' '),line});}
fs.writeFileSync('puzzles.js','export const puzzles = '+JSON.stringify(puzzles,null,2)+';\n');sf.stdin.write('quit\n');console.log('TOTAL',puzzles.length);
