// PGN helpers: split multi-game files, read headers, guess the user's colour.
import { Chess } from '../vendor/chess.js';

const HEADER = /^\[[A-Za-z0-9_]+\s+"/;

/** Split text containing one or more games into separate PGN strings. */
export function splitPgn(text) {
  const lines = String(text || '')
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const games = [];
  let current = [];
  let inMoves = false;
  for (const line of lines) {
    const t = line.trim();
    if (HEADER.test(t) && inMoves) {
      games.push(current.join('\n').trim());
      current = [];
      inMoves = false;
    }
    if (t && !HEADER.test(t)) inMoves = true;
    current.push(line);
  }
  const last = current.join('\n').trim();
  if (last) games.push(last);
  return games.filter(g => g.length);
}

export function readHeaders(pgn) {
  const headers = {};
  for (const m of pgn.matchAll(/^\[([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm)) headers[m[1]] = m[2].replace(/\\"/g, '"');
  return headers;
}

/** Load one game. Throws an Error with a user-facing message on failure. */
export function loadGame(pgn) {
  const game = new Chess();
  try {
    game.loadPgn(pgn);
  } catch (e) {
    throw new Error('Could not read that PGN. Export one complete game and try again.');
  }
  if (!game.history().length) throw new Error('That PGN has no moves.');
  return game;
}

export function summarise(pgn) {
  const h = readHeaders(pgn);
  const clean = v => (v && v !== '?' && !/^\?+/.test(v) ? v : '');
  return {
    white: clean(h.White) || 'White',
    black: clean(h.Black) || 'Black',
    result: h.Result && h.Result !== '*' ? h.Result : '',
    date: clean((h.UTCDate || h.Date || '').replace(/\./g, '-')),
    event: clean(h.Event),
    timeControl: clean(h.TimeControl),
    site: clean(h.Site),
    whiteElo: clean(h.WhiteElo),
    blackElo: clean(h.BlackElo),
  };
}

/** 'w' or 'b' when one of the usernames matches a player, else null. */
export function detectColour(pgn, usernames) {
  const h = readHeaders(pgn);
  const names = usernames.filter(Boolean).map(u => u.trim().toLowerCase());
  if (!names.length) return null;
  if (names.includes((h.White || '').toLowerCase())) return 'w';
  if (names.includes((h.Black || '').toLowerCase())) return 'b';
  return null;
}

export function describeGame(pgn) {
  const s = summarise(pgn);
  const players = `${s.white}${s.whiteElo ? ` (${s.whiteElo})` : ''} – ${s.black}${s.blackElo ? ` (${s.blackElo})` : ''}`;
  return { ...s, players, detail: [s.result, s.date, s.event].filter(Boolean).join(' · ') };
}
