// Progress: training rating, streaks, theme strengths and logged real ratings.
import { app } from '../app-context.js';
import { $, esc, pageHead, toast, plural, formatDate, confirmDialog } from '../ui.js';
import { THEMES, PERSONAL } from '../themes.js';
import { themeStats } from '../srs.js';
import { dateKey, streaks } from '../state.js';
import { lineChart, hydrateLineChart, activityGrid, barList } from '../charts.js';

let platformFilter = null;

export function render(main) {
  const s = app.state;
  const days = Object.values(s.days);
  const attempts = days.reduce((a, d) => a + (d.attempts || 0), 0);
  const clean = days.reduce((a, d) => a + (d.clean || 0), 0);
  const streak = streaks(s.days);
  const history = s.puzzle.history;
  const weekAgo = history.filter(h => h.date <= dateKey(new Date(Date.now() - 7 * 86400000))).at(-1);
  const weekDelta = weekAgo ? s.puzzle.rating - weekAgo.rating : null;
  const stats = themeStats(app.allPuzzles(), s.records);
  const platforms = [...new Set(s.ratings.map(r => r.platform))];
  const platform = platforms.includes(platformFilter) ? platformFilter : s.ratings.at(-1)?.platform || null;
  const realPoints = s.ratings.filter(r => r.platform === platform).map(r => ({ date: r.date, value: r.rating }));

  main.innerHTML =
    pageHead(
      'THE WORK ADDS UP',
      'Your progress, honestly measured.',
      'Puzzle rating tracks training. Your rated games measure playing strength.',
    ) +
    `<div class="stat-row four">
      <div class="stat"><small>Puzzle rating</small><strong>${s.puzzle.rating}</strong>${weekDelta !== null ? `<span class="delta ${weekDelta >= 0 ? 'up' : 'down'}">${weekDelta >= 0 ? '▲' : '▼'} ${Math.abs(weekDelta)} in 7 days</span>` : `<span class="small">${plural(s.puzzle.count, 'rated puzzle')}</span>`}</div>
      <div class="stat"><small>Current streak</small><strong>${plural(streak.current, 'day')}</strong><span class="small">Best ${plural(streak.best, 'day')}</span></div>
      <div class="stat"><small>Total reps</small><strong>${attempts}</strong><span class="small">${attempts ? Math.round((clean / attempts) * 100) : 0}% unassisted</span></div>
      <div class="stat"><small>Vision sprint best</small><strong>${s.vision.best}</strong><span class="small">${plural(s.vision.runs, 'sprint')}</span></div>
    </div>
    <div class="two-col">
      <section class="panel">
        <h2>Puzzle rating</h2>
        <p class="small">Updated on the first attempt at each rated puzzle. Generated puzzles use an estimated difficulty scale, so compare it only with itself.</p>
        ${lineChart(
          'rating-chart',
          history.map(h => ({ date: h.date, value: h.rating })),
          { title: 'Puzzle rating' },
        )}
      </section>
      <section class="panel">
        <h2>Practice calendar</h2>
        <p class="small">Each square is a day. Your daily goal is ${s.goal} positions.</p>
        ${activityGrid(s.days, s.goal)}
      </section>
    </div>
    <div class="two-col">
      <section class="panel">
        <h2>Pattern strength</h2>
        <p class="small">Rating per theme from first attempts, and recall: how far solved positions have climbed the review schedule.</p>
        ${barList(
          [...THEMES, PERSONAL].map(t => {
            const tr = s.themes[t];
            const st = stats[t] || { attempted: 0, recall: 0 };
            return {
              label: t,
              value: st.recall,
              max: 100,
              text: `${st.recall}% recall${tr ? ` · ${tr.rating}` : ''} · ${st.attempted} tried`,
            };
          }),
        )}
        <div class="actions"><button type="button" id="train-weak">Train my weakest theme</button></div>
      </section>
      <section class="panel">
        <h2>Your real rating</h2>
        <p class="muted">Use the same platform and time control for a meaningful trend. Target: above 1500.</p>
        <form id="rating-form">
          <div class="field"><label for="platform">Platform / time control</label><input id="platform" maxlength="60" list="platforms" placeholder="e.g. Chess.com rapid" value="${esc(platform || '')}"><datalist id="platforms">${platforms.map(p => `<option value="${esc(p)}">`).join('')}</datalist></div>
          <div class="field"><label for="rating">Current rating</label><input id="rating" type="number" inputmode="numeric" min="100" max="3500" placeholder="Your actual rating"></div>
          <button type="submit" class="primary">Log rating</button>
        </form>
        ${platforms.length > 1 ? `<div class="field"><label for="platform-filter">Show trend for</label><select id="platform-filter">${platforms.map(p => `<option ${p === platform ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div>` : ''}
        ${platform ? lineChart('real-chart', realPoints, { title: `${platform} rating` }) : ''}
        <div class="rating-list">${s.ratings
          .map((r, i) => ({ r, i }))
          .slice(-8)
          .reverse()
          .map(
            ({ r, i }) =>
              `<span><strong>${r.rating}</strong> · ${esc(r.platform)}<br><small>${esc(formatDate(r.date))}</small><button type="button" class="icon-button" data-remove-rating="${i}" aria-label="Delete ${r.rating} logged on ${esc(formatDate(r.date))}">✕</button></span>`,
          )
          .join('')}</div>
        <p class="footer-note">No training app can promise 1500. Combine these drills with thoughtful rated games and review.</p>
      </section>
    </div>
    <section class="panel"><h2>Recent days</h2>${
      Object.keys(s.days).length
        ? Object.entries(s.days)
            .sort((a, b) => b[0].localeCompare(a[0]))
            .slice(0, 10)
            .map(
              ([d, v]) =>
                `<div class="skill-row"><span>${esc(formatDate(d))}</span><span>${plural(v.attempts || 0, 'position')} · ${v.clean || 0} unassisted${v.vision ? ` · ${plural(v.vision, 'sprint')}` : ''}</span></div>`,
            )
            .join('')
        : '<p class="muted">Finish a position to start your history.</p>'
    }</section>`;

  hydrateLineChart(
    main,
    'rating-chart',
    history.map(h => ({ date: h.date, value: h.rating })),
  );
  if (platform) hydrateLineChart(main, 'real-chart', realPoints);
  $('#platform-filter', main)?.addEventListener('change', e => {
    platformFilter = e.target.value;
    render(main);
  });
  $('#train-weak', main).onclick = () => {
    const tried = THEMES.filter(t => s.themes[t]?.count >= 3);
    const weakest = tried.sort((a, b) => s.themes[a].rating - s.themes[b].rating)[0];
    const fallback = THEMES.map(t => [t, stats[t]?.recall ?? 0]).sort((a, b) => a[1] - b[1])[0][0];
    app.navigate('train', { mode: 'daily', theme: weakest || fallback });
  };
  $('#rating-form', main).onsubmit = e => {
    e.preventDefault();
    const rating = Number($('#rating').value);
    const plat = $('#platform').value.trim();
    if (!Number.isInteger(rating) || rating < 100 || rating > 3500 || !plat)
      return toast('Enter a platform and a whole-number rating from 100 to 3500.');
    s.ratings.push({ rating, platform: plat, date: dateKey() });
    platformFilter = plat;
    app.save();
    render(main);
    toast('Rating logged.');
  };
  main.querySelectorAll('[data-remove-rating]').forEach(
    b =>
      (b.onclick = async () => {
        const r = s.ratings[Number(b.dataset.removeRating)];
        if (!(await confirmDialog({ title: `Delete the ${r.rating} entry?`, confirm: 'Delete', danger: true }))) return;
        s.ratings.splice(Number(b.dataset.removeRating), 1);
        app.save();
        render(main);
      }),
  );
}
