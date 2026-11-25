// Shared application state and helpers used by every screen.
import { loadState, saveState, recoveryKeys } from './state.js';
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
  restored: loaded.restored,
  puzzles,
  page: null,
  /** @type {(name: string, params?: Record<string, any>) => void} */
  navigate: () => {},

  save() {
    try {
      if (!storage) throw new Error('no storage');
      saveState(storage, this.state);
    } catch {
      if (this.storageOK) toast('Progress could not be saved. Storage is unavailable or full. Export a backup in Settings.');
      this.storageOK = false;
    }
  },

  recoveryKeys() {
    return storage ? recoveryKeys(storage) : [];
  },
};
