// Runs Maia off the main thread. Networks are fetched on first use and kept.
import { loadWeights, forward, encode, moveProbabilities } from './maia-core.js';

const nets = new Map();
let tables = null;

async function net(level) {
  if (!nets.has(level)) {
    const res = await fetch(new URL(`../maia/maia-${level}.bin`, import.meta.url));
    if (!res.ok) throw new Error(`Could not load the Maia ${level} network.`);
    nets.set(level, loadWeights(await res.arrayBuffer()));
  }
  return nets.get(level);
}

self.onmessage = async e => {
  const { id, level, fens, legal } = e.data;
  try {
    if (!tables) {
      const res = await fetch(new URL('../maia/tables.json', import.meta.url));
      if (!res.ok) throw new Error('Could not load the Maia move tables.');
      tables = await res.json();
    }
    const { policy, wdl } = forward(await net(level), encode(fens));
    const black = fens[fens.length - 1].split(' ')[1] === 'b';
    self.postMessage({ id, probs: moveProbabilities(policy, legal, black, tables), wdl });
  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};
