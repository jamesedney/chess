// Shared application state and helpers used by every page.
import { loadState, saveState, recoveryKeys, dateKey } from './state.js';
import { puzzles } from '../data/puzzles.js';
import { toast } from './ui.js';

function safeStorage() {
  try {
    const s = window.localStorage;
    s.getItem('rankup-probe');
    return s;
  } catch {
    return null;
  }
}

const storage = safeStorage();
const loaded = loadState(
  storage ?? {
    getItem() {
      throw new Error('no storage');
    },
  },
);

export const app = {
  storage,
  state: loaded.state,
  storageOK: !!storage && loaded.storageOK,
  recovered: loaded.recovered,
  builtIn: puzzles,
  page: null,
  navigate: () => {},

  save() {
    try {
      if (!storage) throw new Error('no storage');
      saveState(storage, this.state);
    } catch {
      this.storageOK = false;
      toast('Progress could not be saved. Storage is unavailable or full. Export a backup in Settings.');
    }
  },

  recoveryKeys() {
    return storage ? recoveryKeys(storage) : [];
  },

  activeMistakes() {
    return this.state.mistakes.filter(m => !m.archived);
  },

  allPuzzles() {
    return [...this.activeMistakes(), ...puzzles];
  },

  findPuzzle(id) {
    return this.state.mistakes.find(m => m.id === id) || puzzles.find(p => p.id === id) || null;
  },

  today() {
    const k = dateKey();
    return (this.state.days[k] ||= { attempts: 0, clean: 0 });
  },
};
