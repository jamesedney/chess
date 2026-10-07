// Small SVG charts: rating trend, evaluation graph, activity grid and bars.
// Single-series charts carry one hue and no legend; every chart has a hover
// and keyboard readout plus a table view so no value is hover-only.
import { esc, formatDate } from './ui.js';

const W = 440; // line charts: drawn near 1:1 so text stays legible
const EW = 480; // evaluation graph width

function niceTicks(min, max, count = 4) {
  const span = Math.max(1, max - min);
  const step = [10, 20, 25, 50, 100, 200, 250, 500].find(s => span / s <= count) || 1000;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi; v += step) ticks.push(v);
  return ticks;
}

/** Attach crosshair + tooltip behaviour to a chart wrapper. */
function attachReadout(wrap, { count, xAt, describe, onPick = null, width = W }) {
  const svg = wrap.querySelector('svg');
  const cross = wrap.querySelector('.crosshair');
  const tip = wrap.querySelector('.chart-tip');
  let index = count - 1;
  const show = i => {
    index = Math.max(0, Math.min(count - 1, i));
    const x = xAt(index);
    cross.setAttribute('x1', x);
    cross.setAttribute('x2', x);
    cross.style.opacity = 1;
    const { value, label } = describe(index);
    tip.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = value;
    const span = document.createElement('span');
    span.textContent = label;
    tip.append(strong, span);
    tip.hidden = false;
    const pct = (x / width) * 100;
    tip.style.left = `clamp(0px, calc(${pct}% - 60px), calc(100% - 130px))`;
    svg.setAttribute('aria-valuetext', `${label}: ${value}`);
  };
  const hide = () => {
    cross.style.opacity = 0;
    tip.hidden = true;
  };
  const nearest = e => {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * width;
    let best = 0;
    for (let i = 1; i < count; i++) if (Math.abs(xAt(i) - x) < Math.abs(xAt(best) - x)) best = i;
    return best;
  };
  svg.addEventListener('pointermove', e => show(nearest(e)));
  svg.addEventListener('pointerleave', () => document.activeElement !== svg && hide());
  svg.addEventListener('focus', () => show(index));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      show(index + (e.key === 'ArrowRight' ? 1 : -1));
      if (onPick) onPick(index);
    } else if ((e.key === 'Enter' || e.key === ' ') && onPick) {
      e.preventDefault();
      onPick(index);
    }
  });
  if (onPick) svg.addEventListener('click', e => onPick(nearest(e)));
}

/**
 * Line chart for one series of {date, value}.
 * Returns HTML; call `hydrate(root)` afterwards to enable the readout.
 */
export function lineChart(id, points, { title, unit = '', height = 200 } = {}) {
  if (points.length < 2) {
    return `<p class="muted small">${esc(title)}: the trend appears after two days of data.</p>`;
  }
  const H = height;
  const pad = { l: 40, r: 50, t: 14, b: 26 };
  const values = points.map(p => p.value);
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const lo = ticks[0];
  const hi = ticks.at(-1);
  const x = i => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
  const y = v => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const area = `${path}L${x(points.length - 1).toFixed(1)},${H - pad.b}L${x(0).toFixed(1)},${H - pad.b}Z`;
  const last = points.at(-1);
  const grid = ticks
    .map(
      t =>
        `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${t.toLocaleString()}</text>`,
    )
    .join('');
  const firstLabel = formatDate(points[0].date);
  const lastLabel = formatDate(last.date);
  const rows = points.map(p => `<tr><td>${esc(formatDate(p.date))}</td><td>${p.value.toLocaleString()}${unit}</td></tr>`).join('');
  return `<figure class="chart" id="${id}" data-chart="line">
    <figcaption>${esc(title)}</figcaption>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" role="slider" tabindex="0" aria-label="${esc(title)}. Use left and right arrows to read values." aria-valuemin="0" aria-valuemax="${points.length - 1}">
        ${grid}
        <path class="area" d="${area}"/>
        <path class="line" d="${path}"/>
        <line class="crosshair" y1="${pad.t}" y2="${H - pad.b}" x1="0" x2="0" style="opacity:0"/>
        <circle class="end-dot" cx="${x(points.length - 1)}" cy="${y(last.value)}" r="4"/>
        <text class="end-label" x="${x(points.length - 1) + 10}" y="${y(last.value) + 4}">${last.value.toLocaleString()}${unit}</text>
        <text class="tick" x="${pad.l}" y="${H - 6}">${esc(firstLabel)}</text>
        <text class="tick" x="${W - pad.r}" y="${H - 6}" text-anchor="end">${esc(lastLabel)}</text>
      </svg>
      <div class="chart-tip" hidden></div>
    </div>
    <details class="chart-table"><summary>Show as table</summary><table><thead><tr><th>Date</th><th>${esc(title)}</th></tr></thead><tbody>${rows}</tbody></table></details>
  </figure>`;
}

export function hydrateLineChart(root, id, points, { unit = '' } = {}) {
  const wrap = root.querySelector(`#${id} .chart-wrap`);
  if (!wrap || points.length < 2) return;
  const pad = { l: 40, r: 50 };
  attachReadout(wrap, {
    count: points.length,
    xAt: i => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r),
    describe: i => ({ value: points[i].value.toLocaleString() + unit, label: formatDate(points[i].date) }),
  });
}

/** Win chances for White in [-1, 1] from a White-POV centipawn score. */
const chances = cp => (cp === null || cp === undefined ? null : 2 / (1 + Math.exp(-0.00368208 * Math.max(-1000, Math.min(1000, cp)))) - 1);

/**
 * Evaluation graph for a reviewed game. evals[i] is White's score before ply i.
 * marks: [{ply, cls}] for the reviewed side's inaccuracies, mistakes, blunders.
 */
export function evalGraph(id, evals, marks, { current = 0, height = 150 } = {}) {
  const H = height;
  const n = evals.length;
  const x = i => (n <= 1 ? 0 : (i / (n - 1)) * EW);
  const mid = H / 2;
  const y = c => mid - c * (mid - 6);
  // Carry the last known value across gaps so the line stays continuous.
  let lastKnown = 0;
  const filled = evals.map(v => {
    const c = chances(v);
    if (c !== null) lastKnown = c;
    return lastKnown;
  });
  const path = filled.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(c).toFixed(1)}`).join('');
  const area = `${path}L${EW},${mid}L0,${mid}Z`;
  const dots = marks
    .filter(m => m.cls === 'mistake' || m.cls === 'blunder')
    .map(
      m =>
        `<circle class="eval-mark ${m.cls}" cx="${x(m.ply + 1)}" cy="${y(filled[m.ply + 1] ?? 0)}" r="${m.cls === 'blunder' ? 6.5 : 4.5}"/>`,
    )
    .join('');
  return `<figure class="chart eval-chart" id="${id}" data-chart="eval">
    <figcaption>Evaluation · White above the line, Black below <span class="legend-inline"><span class="key mistake"></span>Mistake <span class="key blunder"></span>Blunder</span></figcaption>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${EW} ${H}" role="slider" tabindex="0" aria-label="Evaluation graph. Use left and right arrows to step through the game." aria-valuemin="0" aria-valuemax="${n - 1}" aria-valuenow="${current}">
        <rect class="eval-black" x="0" y="${mid}" width="${EW}" height="${mid}"/>
        <path class="eval-white" d="${area}"/>
        <line class="grid" x1="0" x2="${EW}" y1="${mid}" y2="${mid}"/>
        <path class="eval-line" d="${path}" vector-effect="non-scaling-stroke"/>
        <line class="current" x1="${x(current)}" x2="${x(current)}" y1="0" y2="${H}" vector-effect="non-scaling-stroke"/>
        <line class="crosshair" y1="0" y2="${H}" x1="0" x2="0" style="opacity:0" vector-effect="non-scaling-stroke"/>
        ${dots}
      </svg>
      <div class="chart-tip" hidden></div>
    </div>
  </figure>`;
}

export function hydrateEvalGraph(root, id, evals, labels, onPick) {
  const wrap = root.querySelector(`#${id} .chart-wrap`);
  if (!wrap) return;
  const n = evals.length;
  attachReadout(wrap, {
    count: n,
    xAt: i => (n <= 1 ? 0 : (i / (n - 1)) * EW),
    describe: i => {
      const v = evals[i];
      const value =
        v === null || v === undefined
          ? 'not analysed'
          : Math.abs(v) >= 10000
            ? v > 0
              ? 'White is mating'
              : 'Black is mating'
            : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v / 100).toFixed(1);
      const label = i === 0 ? 'Start' : labels[i - 1];
      return { value, label };
    },
    onPick,
  });
}

/** Last N weeks of practice as a grid of days. 0 = none, 1 = practised, 2 = goal met. */
export function activityGrid(days, goal, { weeks = 12, today = new Date() } = {}) {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // Columns are weeks starting on Monday; the last column holds today.
  const start = new Date(end);
  start.setDate(start.getDate() - (weeks - 1) * 7 - ((end.getDay() + 6) % 7));
  const cells = [];
  const key = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const k = key(d);
    const v = days[k];
    const reps = (v?.attempts || 0) + (v?.vision || 0);
    const level = !reps ? 0 : (v?.attempts || 0) >= goal ? 2 : 1;
    const text = `${formatDate(k)}: ${reps ? `${v?.attempts || 0} positions${v?.vision ? `, ${v.vision} vision sprint${v.vision > 1 ? 's' : ''}` : ''}` : 'no practice'}`;
    cells.push(`<span class="day l${level}" title="${esc(text)}" aria-label="${esc(text)}" role="img"></span>`);
  }
  return `<div class="activity" role="group" aria-label="Practice over the last ${weeks} weeks">${cells.join('')}</div>
  <div class="activity-legend small"><span class="day l0"></span> None <span class="day l1"></span> Practised <span class="day l2"></span> Daily goal met</div>`;
}

/** Horizontal bars with the value at the tip. items: [{label, value, max, text}] */
export function barList(items) {
  return `<div class="bar-list">${items
    .map(
      it =>
        `<div class="bar-row"><span class="bar-label">${esc(it.label)}</span><span class="bar-track"><span class="bar-fill" style="width:${Math.max(0, Math.min(100, (it.value / (it.max || 100)) * 100))}%"></span></span><span class="bar-value">${esc(it.text ?? it.value)}</span></div>`,
    )
    .join('')}</div>`;
}
