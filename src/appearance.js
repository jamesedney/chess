// Board colours and piece sets the user can choose in Settings.

/** Square colours: light, dark, and the coordinate colours that sit on them. */
export const BOARD_THEMES = {
  walnut: { label: 'Walnut', light: '#f0d9b5', dark: '#b58863' },
  slate: { label: 'Slate', light: '#dee3e6', dark: '#8ca2ad' },
  ink: { label: 'Ink', light: '#e8e4dc', dark: '#6f7380' },
  ocean: { label: 'Ocean', light: '#dbe7ef', dark: '#5f8fb0' },
  plum: { label: 'Plum', light: '#ece2ea', dark: '#9a7495' },
  terracotta: { label: 'Terracotta', light: '#f3e1cf', dark: '#c27a55' },
  green: { label: 'Tournament green', light: '#eeeed2', dark: '#769656' },
};

export const PIECE_SETS = {
  cburnett: { label: 'Cburnett' },
  merida: { label: 'Merida' },
  chessnut: { label: 'Chessnut' },
  'kiwen-suwi': { label: 'Kiwen-suwi' },
  mpchess: { label: 'MPChess' },
};

export const DEFAULT_APPEARANCE = { board: 'walnut', pieces: 'cburnett' };

let pieceSet = DEFAULT_APPEARANCE.pieces;

/** The image path for a piece, e.g. pieceUrl('w', 'n'). */
export function pieceUrl(color, type) {
  return `./pieces/${pieceSet}/${color}${type.toUpperCase()}.svg`;
}

export function setPieceSet(id) {
  pieceSet = PIECE_SETS[id] ? id : DEFAULT_APPEARANCE.pieces;
}

const PROPS = ['--sq-light', '--sq-dark', '--sq-light-hover', '--sq-dark-hover', '--coord-light', '--coord-dark'];

/**
 * Apply a board colour scheme through CSS custom properties. Walnut is the
 * stylesheet's own palette; other schemes are dimmed the same way in dark mode.
 */
export function applyBoardTheme(id, dark = false, root = document.documentElement) {
  const key = BOARD_THEMES[id] ? id : 'walnut';
  root.dataset.board = key;
  if (key === 'walnut') {
    for (const p of PROPS) root.style.removeProperty(p);
    return;
  }
  const t = BOARD_THEMES[key];
  const light = dark ? shade(t.light, -0.1) : t.light;
  const darkSq = dark ? shade(t.dark, -0.23) : t.dark;
  const values = [light, darkSq, shade(light, -0.05), shade(darkSq, -0.07), darkSq, light];
  PROPS.forEach((p, i) => root.style.setProperty(p, values[i]));
}

/** Lighten (positive) or darken (negative) a #rrggbb colour by a fraction. */
export function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c =>
    Math.round(Math.max(0, Math.min(255, amount < 0 ? c * (1 + amount) : c + (255 - c) * amount))),
  );
  return '#' + ch.map(c => c.toString(16).padStart(2, '0')).join('');
}
