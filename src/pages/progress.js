// Progress: training rating, streaks, theme strengths and logged real ratings.
import { app } from '../app-context.js';
import { $, esc, pageHead, toast, plural, formatDate, confirmDialog } from '../ui.js';
import { THEMES, PERSONAL } from '../themes.js';
import { themeStats } from '../srs.js';
import { dateKey, streaks } from '../state.js';
import { lineChart, hydrateLineChart, activityGrid, barList } from '../charts.js';
import { calibration } from '../assess.js';
import { skillMap } from '../skills.js';
import { goalStatus, goalSeries, PUZZLE_PERF } from '../progress-model.js';
import { pathSummary } from '../curriculum.js';

let platformFilter = null;
let ratingsOpen = false;

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
    pageHead('', 'You', '', '<a class="button-link" href="#coach">Coach</a>') +
    youHTML() +
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
      <details class="panel ratings-log" ${ratingsOpen || !s.ratings.length ? 'open' : ''}>
        <summary><h2>Ratings</h2></summary>
        <p class="small">Synced automatically from your account. Add one by hand for another site or over-the-board.</p>
        <form id="rating-form">
          <div class="field"><label for="platform">Platform / time control</label><input id="platform" maxlength="60" list="platforms" placeholder="e.g. Chess.com rapid" value="${esc(platform || '')}"><datalist id="platforms">${platforms.map(p => `<option value="${esc(p)}">`).join('')}</datalist></div>
          <div class="field"><label for="rating">Current rating</label><input id="rating" type="number" inputmode="numeric" min="100" max="3500" placeholder="Your actual rating"></div>
          <button type="submit" class="primary">Log rating</button>
        </form>
        ${platforms.length > 1 ? `<div class="field"><label for="platform-filter">Show trend for</label><select id="platform-filter">${platforms.map(p => `<option ${p === platform ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div>` : ''}
        ${platform && platform !== s.target?.perf ? lineChart('real-chart', realPoints, { title: `${platform} rating` }) : ''}
        <div class="rating-list">${s.ratings
          .map((r, i) => ({ r, i }))
          .slice(-8)
          .reverse()
          .map(
            ({ r, i }) =>
              `<span><strong>${r.rating}</strong> · ${esc(r.platform)}<br><small>${esc(formatDate(r.date))}</small><button type="button" class="icon-button" data-remove-rating="${i}" aria-label="Delete ${r.rating} logged on ${esc(formatDate(r.date))}">✕</button></span>`,
          )
          .join('')}</div>
      </details>
    </div>
    <section class="panel"><h2>Judgement</h2>
      <p>${esc(calibration(s.calc.assess?.last || []).text)}</p>
      <p class="small">${
        s.candidates?.asked
          ? `Candidate moves: the engine's best was among your candidates ${Math.round((s.candidates.hit / s.candidates.asked) * 100)}% of the time, over ${plural(s.candidates.asked, 'check')}.`
          : 'Turn on candidate moves in a practice game’s options to measure how often the engine’s best move is among the moves you consider.'
      }</p>
      <div class="actions"><button type="button" id="go-assess">Assess the position</button></div>
    </section>
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
  if ($('#real-chart', main)) hydrateLineChart(main, 'real-chart', realPoints);
  const gs = goalSeries(s);
  if (gs.length > 1)
    hydrateLineChart(
      main,
      'goal-chart',
      gs.map(p => ({ date: p.date, value: p.rating })),
    );
  $('#platform-filter', main)?.addEventListener('change', e => {
    platformFilter = e.target.value;
    render(main);
  });
  $('.ratings-log', main).addEventListener('toggle', e => (ratingsOpen = e.target.open));
  $('#go-assess', main).onclick = () => app.navigate('drills', { drill: 'assess' });
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

/** Goal, skills and milestones: the top of the You page. */
function youHTML() {
  const s = app.state;
  const g = goalStatus(s);
  const path = pathSummary(s);
  const target = s.target?.target || s.puzzle.rating + 200;
  const skills = skillMap(s, target);
  const max = Math.max(target, ...skills.map(k => k.effective)) + 50;
  const min = Math.min(...skills.map(k => k.effective)) - 100;
  const label = s.target ? (s.target.perf === PUZZLE_PERF ? 'Rankup rating' : s.target.perf) : '';
  return `<div class="two-col">
    <section class="panel">
      <h2>Goal</h2>
      ${
        g
          ? `<p class="goal-numbers"><strong>${g.current}</strong><span aria-hidden="true">→</span><strong>${s.target.target}</strong></p>
             <p class="small">${esc(label)} · by ${esc(formatDate(s.target.by))} · ${g.status === 'on-track' ? `on track, projected ${g.projected}` : g.status === 'reached' ? 'reached' : `projected ${g.projected}: the plan is pushing harder`}</p>
             ${
               goalSeries(s).length > 1
                 ? lineChart(
                     'goal-chart',
                     goalSeries(s).map(p => ({ date: p.date, value: p.rating })),
                     { title: label },
                   )
                 : ''
             }`
          : '<p class="muted">Your goal appears after setup on the Today page.</p>'
      }
      <p class="small">${esc(path.band.label)} · ${path.done} of ${path.total} curriculum units mastered.</p>
      ${s.milestones.length ? `<p class="small">Targets reached: ${s.milestones.map(m => `${m.target} (${esc(formatDate(m.date))})`).join(', ')}</p>` : ''}
    </section>
    <section class="panel">
      <h2>Skills</h2>
      <p class="small">Each skill as a rating, after what your games show. The line is your target, ${target}.</p>
      <div class="skill-bars">${skills
        .map(
          k => `<div class="skill-bar"><span class="bar-label">${esc(k.short)}</span>
          <span class="skill-track"><span class="skill-fill ${k.effective >= target ? 'ahead' : ''}" style="width:${Math.max(3, ((k.effective - min) / (max - min)) * 100)}%"></span><span class="skill-target" style="left:${((target - min) / (max - min)) * 100}%"></span></span>
          <span class="bar-value">${k.effective}${k.leak >= 0.3 ? ' ↓' : ''}</span></div>`,
        )
        .join('')}</div>
      <p class="small muted">↓ means your recent games lose points in this skill more than your puzzles suggest.</p>
    </section>
  </div>`;
}
