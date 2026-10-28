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
import { evidence } from '../evidence.js';
import { habits } from '../debrief.js';
import { timeProfile, profileText, CLOCK_DRILLS } from '../timeprofile.js';
import { streakMode, diagnoseStreak, diagnose, LEAKS, MIN_COUNTED } from '../leak.js';
import { pointsProfile, profileLines, trend, adaptRule } from '../profile.js';
import { habitTrend, currentExperiment, experimentLine, PHASE_DAYS } from '../proof.js';
import { tiltProfile, sinceStop, sittings, ruleLine, MIN_BUCKET } from '../tilt.js';
import { safeStats } from '../safecheck.js';
import { pressureStats } from '../pressure.js';
import { rushedText } from '../clocks.js';

const DAY = 86400000;

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
    pointsHTML() +
    proofHTML() +
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
      ${safeLineHTML()}
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
  $('#clock-drill', main)?.addEventListener('click', e => {
    const d = e.target.dataset.clock;
    const own = app.activeMistakes().length >= 3;
    app.navigate('train', { mode: d === 'pause' && own ? 'mistakes' : 'daily', clock: d, limit: d === 'pause' ? 6 : 10 });
  });
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
/**
 * Where your points go: the leak and what every serious mistake of the last
 * 30 days says, costliest first, with how many losses have been read and
 * whether the two habits that matter most are moving.
 */
function pointsHTML() {
  const kOfN = x => `${x.k} of ${x.n}`;
  const s = app.state;
  const p = pointsProfile(s);
  if (!p.control || p.games < 10) return '';
  const d = streakMode(s) ? null : diagnose(s);
  const lines = profileLines(p);
  const t = trend(s);
  const moving = [];
  if (t.now.fast && t.before.fast)
    moving.push(`Fast mistakes: ${kOfN(t.now.fast)} in the last 14 days, ${kOfN(t.before.fast)} the 14 before.`);
  if (t.now.shortLosses && t.before.shortLosses)
    moving.push(`Games lost by move 30: ${kOfN(t.now.shortLosses)} in the last 14 days, ${kOfN(t.before.shortLosses)} the 14 before.`);
  return `<section class="panel points" aria-labelledby="points-head">
    <h2 id="points-head">Where your points go</h2>
    <p class="small">Last ${p.days} days of ${esc(p.control)}: ${p.games} games, ${Math.round(p.score * 100)}%. ${p.reviewedLosses} of your ${p.lost} losses read${p.reviewedLosses < p.lost ? '; the rest are being reviewed' : ''}.</p>
    ${d?.leak ? `<p class="points-lead">${esc(d.line)}</p>` : ''}
    ${lines.length ? `<ul class="points-list">${lines.map(l => `<li class="${l.flag ? 'flag' : ''}">${esc(l.text)}</li>`).join('')}</ul>` : '<p class="muted">Your reviews will show where the points go after a few more games.</p>'}
    ${moving.length ? `<h3>Is it moving</h3>${moving.map(m => `<p class="small">${esc(m)}</p>`).join('')}` : ''}
    <p class="small">Today’s plan is built from this.</p>
  </section>`;
}

/**
 * Proof: the habit the gate trains, measured in your real games (time on
 * captures and checks, hung pieces a game) now against the fortnight before,
 * and the experiment that decides whether the gate stays.
 */
function proofHTML() {
  const s = app.state;
  const t = habitTrend(s);
  const e = currentExperiment(s) || (s.experiments || []).filter(x => x.phase === 'done').at(-1) || null;
  if (!t.control && !e) return '';
  const pct = h => (h.critical.n >= 10 ? `${Math.round((100 * h.critical.fast) / h.critical.n)}%` : null);
  const lines = [];
  const fNow = pct(t.now);
  const fBefore = pct(t.before);
  if (fNow)
    lines.push(
      `Captures and checks played fast: ${fNow} of ${t.now.critical.n} in the last ${PHASE_DAYS} days${fBefore ? `, ${fBefore} of ${t.before.critical.n} the ${PHASE_DAYS} before` : ''}.`,
    );
  if (t.now.games >= 5)
    lines.push(
      `Hung pieces: ${t.now.hung.perGame.toFixed(1)} a game over ${t.now.games} games${t.before.games >= 5 ? `, ${t.before.hung.perGame.toFixed(1)} the ${PHASE_DAYS} before` : ''}.`,
    );
  const past = (s.experiments || []).filter(x => x.phase === 'done' && x.verdict?.text);
  return `<section class="panel" aria-labelledby="proof-head">
    <h2 id="proof-head">Proof</h2>
    <p class="small">The gate trains one thing: time on captures and checks. This is that habit in the games you play online, read from their clocks.</p>
    ${lines.length ? lines.map(l => `<p>${esc(l)}</p>`).join('') : `<p class="muted">Needs reviewed games with clocks from the last ${PHASE_DAYS} days.</p>`}
    ${e && e.phase !== 'done' ? `<p class="small"><strong>Experiment:</strong> ${esc(experimentLine(e))}</p>` : ''}
    ${
      past.length
        ? `<h3>Verdicts</h3>${past
            .slice(-3)
            .reverse()
            .map(x => `<p class="small">${esc(formatDate(new Date(x.end).toISOString().slice(0, 10)))}: ${esc(x.verdict.text)}</p>`)
            .join('')}`
        : ''
    }
    ${s.gate?.set === 'you' ? '<p class="small">The gate is set by hand in Play options; Proof measures but does not move it.</p>' : ''}
  </section>`;
}

function youHTML() {
  const s = app.state;
  const g = goalStatus(s);
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
  </div>
  ${workingHTML()}`;
}

const VERDICT_WORD = { better: 'Better', worse: 'Worse', steady: 'Steady', unknown: '' };

/** Is it working: your last two weeks against the six before, what you trained, your habits and your clock. */
function workingHTML() {
  const s = app.state;
  const ev = evidence(s);
  const h = habits(s);
  const p = timeProfile(s);
  const t = ev.recent.training;
  const trained = [
    [t.debriefs, 'debriefed moment'],
    [t.replays, 'replay'],
    [t.repertoire, 'repertoire position'],
    [t.clock, 'clock-drill position'],
    [t.safe, 'Safe or hanging? position'],
    [t.real, 'Same clock position'],
    [t.puzzles - t.clock - t.safe - t.real, 'puzzle'],
    [t.ownMistakes, 'own mistake'],
  ]
    .filter(([n]) => n > 0)
    .map(([n, w]) => plural(n, w));
  return `<div class="two-col">
    <section class="panel" aria-labelledby="working-title">
      <h2 id="working-title">Is it working? <span class="h2-note">last two weeks against the six before</span></h2>
      ${
        ev.rows.every(r => r.verdict === 'unknown')
          ? `<p class="muted">Comparisons start with three reviewed games in the last two weeks and three in the six before. So far: ${ev.recent.games} and ${ev.before.games}.</p>`
          : ''
      }
      <ul class="evidence-list" ${ev.rows.every(r => r.verdict === 'unknown') ? 'hidden' : ''}>${ev.rows
        .map(
          r => `<li class="evidence ${r.verdict}"><span class="evidence-label">${esc(r.label)}</span>
            <span class="evidence-value">${esc(r.text)}</span>${VERDICT_WORD[r.verdict] ? `<span class="verdict ${r.verdict}">${VERDICT_WORD[r.verdict]}</span>` : ''}</li>`,
        )
        .join('')}</ul>
      <p class="small">${trained.length ? `You trained: ${esc(trained.join(', '))}.` : 'No training logged in the last two weeks yet.'} ${ev.recent.games} reviewed ${ev.recent.games === 1 ? 'game' : 'games'} in the last two weeks, ${ev.before.games} in the six before.</p>
    </section>
    <section class="panel" aria-labelledby="habits-title">
      <h2 id="habits-title">Your habits</h2>
      ${
        h.total
          ? `<div class="skill-bars">${h.list
              .map(
                r => `<div class="skill-bar"><span class="bar-label">${esc(r.label)}</span>
                <span class="skill-track"><span class="skill-fill" style="width:${Math.max(4, r.share * 100)}%"></span></span>
                <span class="bar-value">${r.count}</span></div>`,
              )
              .join('')}</div>
             <p class="small">What went wrong in your last ${h.total} debriefed ${h.total === 1 ? 'moment' : 'moments'}.</p>`
          : '<p class="muted">Debrief a game to start: after each one you note why its decisive moments went wrong.</p>'
      }
      <h3>Your clock</h3>
      <p class="small">${esc(profileText(p))}</p>
      ${clockLinesHTML()}
      ${p.drill ? `<div class="actions"><button type="button" id="clock-drill" data-clock="${p.drill}">${esc(CLOCK_DRILLS[p.drill].title)}</button></div>` : ''}
    </section>
  </div>
  ${streakHTML()}${eveningsHTML()}`;
}

const pct = x => `${Math.round(x * 100)}%`;
/** "5 of 16": the points (wins plus half-draws) over a bucket's games. */
const ofText = b => `${Math.round(b.score * b.n * 2) / 2} of ${b.n}`;
/** Counts alone under 10 games; the percentage joins from 10 on. */
const bucketText = b => (b.n >= 10 ? `${ofText(b)} · ${pct(b.score)}` : ofText(b));
const sideText = b => (b.n >= 10 ? pct(b.score) : ofText(b));
const tile = (value, label, small = '') =>
  `<div class="metric"><strong>${esc(value)}</strong><span>${esc(label)}</span>${small ? `<small class="muted">${esc(small)}</small>` : ''}</div>`;
/** A bucket against its complement, or "–" with the minimum it needs. */
const bucketTile = (b, other, label, otherLabel) =>
  b.n >= MIN_BUCKET
    ? tile(bucketText(b), label, other.n ? `${otherLabel} ${sideText(other)}` : '')
    : tile('–', label, `needs ${MIN_BUCKET} games`);

/** Your streak: the last ten games, the leak's share of the losses read, and the longest loss run. Streak mode only. */
function streakHTML() {
  const s = app.state;
  if (!streakMode(s)) return '';
  const d = diagnoseStreak(s);
  const profile = tiltProfile(s.ledger || []);
  const points = Math.round((d.score10 || 0) * d.games10 * 2) / 2;
  const leakTile = d.leak
    ? tile(`${d.counts[d.leak]} of ${d.counted}`, d.label || LEAKS[d.leak].label, `${d.losses.length} losses read`)
    : tile('–', `the leak appears at ${MIN_COUNTED} losses`, `${d.counted} of ${d.losses.length} losses classified`);
  const notes = [d.habit ? `Habit: ${d.habit}` : '', s.streak ? `Since ${formatDate(s.streak.since)}.` : ''].filter(Boolean);
  return `<section class="panel" aria-labelledby="streak-title">
    <h2 id="streak-title">Your streak <span class="h2-note">last 10 games in ${esc(d.control || '')}</span></h2>
    <div class="metrics counts">
      ${tile(`${points} of ${d.games10}`, 'Last 10 games', `${d.lost10} lost`)}
      ${leakTile}
      ${tile(String(profile.runs.longest14), 'Longest loss run · 14 days', `current run ${profile.runs.current}`)}
    </div>
    ${notes.length ? `<p class="small">${esc(notes.join(' '))}</p>` : ''}
  </section>`;
}

/** Your evenings: games straight after a loss and late in a sitting against the rest, the loss runs, the rule and the sittings. From 10 ledger rows. */
function eveningsHTML() {
  const s = app.state;
  const ledger = s.ledger || [];
  if (ledger.length < 10) return '';
  const now = Date.now();
  const profile = adaptRule(tiltProfile(ledger, { now }), pointsProfile(s, { now }));
  const recent = sittings(ledger).filter(x => x.end >= now - 14 * DAY);
  const games = recent.reduce((a, x) => a + x.games.length, 0);
  const stop = sinceStop(s, now);
  const lines = [
    `${ruleLine(profile)} (${profile.rule.label.toLowerCase()}).`,
    stop ? stop.text : '',
    recent.length ? `Sittings: ${(games / recent.length).toFixed(1)} games on average, 14 days.` : 'Sittings: 0 in the last 14 days.',
    `Lost on time: ${profile.flagged.onTime} of ${profile.flagged.losses} losses.`,
  ].filter(Boolean);
  return `<section class="panel" aria-labelledby="evenings-title">
    <h2 id="evenings-title">Your evenings <span class="h2-note">${profile.games} games · last 42 days</span></h2>
    <div class="metrics counts">
      ${bucketTile(profile.afterLoss.quick, profile.afterLoss.rest, 'Straight after a loss', 'other games')}
      ${bucketTile(profile.deep.late, profile.deep.early, 'Games 5+ in a sitting', 'games 1–4')}
      ${tile(String(profile.runs.longest14), 'Longest loss run', 'last 14 days')}
    </div>
    <p class="small">${esc(lines.join(' '))}</p>
  </section>`;
}

/** Safe or hanging?: accuracy and median time over the last 50 positions against the 50 before. Empty without a run. */
function safeLineHTML() {
  const st = safeStats(app.state);
  if (!st.items) return '';
  const time = st.medianMs !== null ? ` in ${(st.medianMs / 1000).toFixed(1)} s` : '';
  const was = st.before.items ? ` (was ${st.before.accuracy}% over the ${st.before.items} before)` : '';
  return `<p class="small">Safe or hanging: ${st.accuracy}%${time} over the last ${plural(st.items, 'position')}${was}.</p>`;
}

/** Your clock in the app: clocked practice games, replays on the real clock and Same-clock runs. Each line waits for its data. */
function clockLinesHTML() {
  const s = app.state;
  const lines = [];
  const clocked = (s.games || []).filter(g => typeof g.tc === 'string');
  if (clocked.length) {
    const n = clocked.length;
    const counts = {};
    for (const g of clocked) counts[g.tc] = (counts[g.tc] || 0) + 1;
    const [base, inc] = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])[0][0]
      .split('+')
      .map(Number);
    const rushed = rushedText({ base: base || 300, inc: inc || 0 });
    const avg = key => (clocked.reduce((a, g) => a + (g[key] || 0), 0) / n).toFixed(1);
    const flagged = clocked.reduce((a, g) => a + (g.fl || 0), 0);
    lines.push(`Practice on the clock: ${plural(n, 'game')}, ${avg('b')} blunders a game, ${avg('f')} in ${rushed}, flagged ${flagged}.`);
  }
  const replays = Object.values(s.replays || {}).filter(r => r && (r.left !== undefined || r.flagged !== undefined));
  if (replays.length) {
    const converted = replays.filter(r => r.success).length;
    const onTime = replays.reduce((a, r) => a + (r.flagged || 0), 0);
    lines.push(`Play it again on the real clock: ${converted} of ${replays.length} converted, ${onTime} lost on time.`);
  }
  const ps = pressureStats(s);
  if (ps.tries > 0) {
    const rate = ps.tries >= 10 ? ` (${ps.rate}%)` : '';
    lines.push(
      `Under your real clock: ${ps.inTime} of ${ps.tries} in time${rate}; first attempts ${ps.first.inTime} of ${ps.first.tries}.`,
    );
  }
  return lines.map(l => `<p class="small">${esc(l)}</p>`).join('');
}
