import { test } from 'node:test';
import assert from 'node:assert/strict';
import { winPercent, winPercentLoss, classifyLoss, isTrainableMistake, formatScore, whitePov } from '../../src/evaluation.js';
import { parseInfo, parseBestMove, mateScore } from '../../src/uci-parse.js';

test('win percentage is symmetric and monotonic', () => {
  assert.equal(Math.round(winPercent(0)), 50);
  assert.ok(Math.abs(winPercent(300) + winPercent(-300) - 100) < 1e-9);
  assert.ok(winPercent(100) < winPercent(200));
  assert.equal(winPercent(5000), winPercent(1000), 'clamped at ±1000');
});

test('large advantages that shrink are not flagged, drawn-to-lost swings are', () => {
  assert.equal(isTrainableMistake(900, -700), false, '+9 to +7 still winning');
  assert.equal(isTrainableMistake(0, 250), true, 'equal to −2.5 is a mistake');
  assert.equal(isTrainableMistake(-900, 1200), false, 'already lost');
  assert.ok(winPercentLoss(0, 250) >= 20);
});

test('loss classification thresholds', () => {
  assert.equal(classifyLoss(5), 'good');
  assert.equal(classifyLoss(12), 'inaccuracy');
  assert.equal(classifyLoss(22), 'mistake');
  assert.equal(classifyLoss(45), 'blunder');
});

test('score formatting and point of view', () => {
  assert.equal(formatScore(140), '+1.4');
  assert.equal(formatScore(-30), '−0.3');
  assert.equal(formatScore(0), '0.0');
  assert.equal(formatScore(99998, 2), 'M2');
  assert.equal(whitePov(120, 'b'), -120);
});

test('UCI info lines parse into scores and principal variations', () => {
  const cp = parseInfo('info depth 14 seldepth 18 multipv 2 score cp -46 nodes 54270 nps 1 pv h2h3 f8e8 a2a3');
  assert.deepEqual({ ...cp, pv: cp.pv.join(' ') }, { multipv: 2, depth: 14, nodes: 54270, mate: null, score: -46, pv: 'h2h3 f8e8 a2a3' });
  const mate = parseInfo('info depth 8 seldepth 2 multipv 1 score mate 1 nodes 348 nps 43500 pv h5f7');
  assert.equal(mate.mate, 1);
  assert.equal(mate.score, mateScore(1));
  assert.ok(mateScore(1) > mateScore(3), 'shorter mates score higher');
  assert.ok(mateScore(-1) < mateScore(-3), 'being mated sooner is worse');
  assert.equal(parseInfo('info depth 10 score cp 20 lowerbound nodes 5 pv e2e4'), null);
  assert.equal(parseInfo('info string NNUE enabled'), null);
  assert.equal(parseBestMove('bestmove e2e4 ponder e7e5'), 'e2e4');
  assert.equal(parseBestMove('info depth 1'), null);
});
