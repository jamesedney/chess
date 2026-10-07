// The coach: a diagnosis from your games, this week's plan, honest trends and
// lessons made from your own mistakes.
import { app } from '../app-context.js';
import { $, esc, pageHead, plural, formatDate } from '../ui.js';
import { diagnose, ensurePlan, planProgress, trends } from '../coach.js';
import { personalLessons } from '../personal-lessons.js';
import { openingStats } from '../openings.js';
import { KINDS } from '../mistake-kinds.js';
import { barList } from '../charts.js';

const VERDICT = { better: '▲ Better', worse: '▼ Worse', flat: '– Steady', unknown: 'Not enough data' };

export function render(main) {
  const s = app.state;
  if (ensurePlan(s)) app.save();
  const d = diagnose(s);
  const plan = planProgress(s, s.plan);
  const last = s.plan.history?.at(-1);
  const rows = trends(s);
  const lessons = personalLessons(s);
  const openings = openingStats(s.reviews)
    .filter(o => o.games >= 2)
    .slice(0, 4);

  main.innerHTML =
    pageHead(
      'YOUR COACH',
      'What to work on, and why.',
      'Built from your own games and training. The more you review, the sharper it gets.',
    ) +
    `<div class="two-col">
      <section class="panel" aria-labelledby="plan-title">
        <div class="eyebrow">WEEK OF ${esc(formatDate(s.plan.week).toUpperCase())}</div>
        <h2 id="plan-title">This week’s plan</h2>
        ${last ? `<p class="small">Last week: ${Math.round(last.ratio * 100)}% done. ${last.ratio >= 1 ? 'Targets are a little higher this week.' : last.ratio < 0.5 ? 'Targets are lighter this week so the plan stays doable.' : 'Targets stay the same.'}</p>` : '<p class="small">A new plan arrives every Monday and adapts to how the last one went.</p>'}
        <ol class="plan-list">${plan.items
          .map(
            (it, i) => `<li class="plan-item ${it.complete ? 'complete' : ''}">
              <div class="plan-text"><strong>${esc(it.label)}</strong>${it.detail ? `<span class="small">${esc(it.detail)}</span>` : ''}
                <span class="plan-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${it.target}" aria-valuenow="${it.done}" aria-label="${esc(it.label)}"><span style="width:${Math.round((it.done / it.target) * 100)}%"></span></span>
                <span class="small">${it.done} of ${it.target}${it.complete ? ' · done' : ''}</span></div>
              ${it.complete ? '<span class="plan-check" aria-hidden="true">✓</span>' : `<button type="button" data-plan="${i}">Start</button>`}
            </li>`,
          )
          .join('')}</ol>
      </section>
      <section class="panel" aria-labelledby="diag-title">
        <div class="eyebrow">DIAGNOSIS · LAST 90 DAYS</div>
        <h2 id="diag-title">What your games say</h2>
        ${diagnosisHTML(d)}
      </section>
    </div>
    <section class="panel" aria-labelledby="trend-title">
      <div class="eyebrow">THIS MONTH VS LAST MONTH</div>
      <h2 id="trend-title">Is it working?</h2>
      <p class="small">A change is only called when it is bigger than normal variation. Small samples say “not enough data” rather than guess.</p>
      <div class="table-wrap"><table class="data-table trend-table">
        <thead><tr><th scope="col">Measure</th><th scope="col">Last 30 days</th><th scope="col">30 days before</th><th scope="col">Verdict</th></tr></thead>
        <tbody>${rows
          .map(
            r =>
              `<tr><th scope="row">${esc(r.label)}</th><td data-label="Last 30 days">${esc(r.now ?? '–')}</td><td data-label="30 days before">${esc(r.before ?? '–')}</td><td data-label="Verdict"><span class="verdict ${r.verdict}">${VERDICT[r.verdict]}</span><br><span class="small">${esc(r.text)}</span></td></tr>`,
          )
          .join('')}</tbody>
      </table></div>
    </section>
    <div class="two-col">
      <section class="panel" aria-labelledby="mine-title">
        <div class="eyebrow">LESSONS FROM YOUR GAMES</div>
        <h2 id="mine-title">Your own positions, as lessons</h2>
        ${
          lessons.length
            ? `<div class="drill-list">${lessons
                .map(
                  l =>
                    `<article class="drill"><div><h3>${esc(l.title)}</h3><p class="small">${esc(l.intro)}</p></div><button type="button" class="primary" data-lesson="${l.id}">Open</button></article>`,
                )
                .join('')}</div>`
            : `<p class="muted">When three or more of your saved mistakes share a cause, a lesson is built from them here. ${s.mistakes.length ? `You have ${plural(s.mistakes.length, 'saved mistake')} so far.` : 'Review a game or play with the coach on to start.'}</p>`
        }
      </section>
      <section class="panel" aria-labelledby="open-title">
        <div class="eyebrow">OPENINGS</div>
        <h2 id="open-title">Where your games start</h2>
        ${
          openings.length
            ? barList(
                openings.map(o => ({
                  label: o.family,
                  value: o.score ?? 0,
                  max: 100,
                  text: `${o.score === null ? '–' : o.score + '%'} · ${plural(o.games, 'game')}`,
                })),
              ) + '<p class="small">Score from your side: a win is 100%, a draw 50%. Full table under Review a game.</p>'
            : '<p class="muted">Review at least two games in the same opening to see how it is going for you.</p>'
        }
      </section>
    </div>`;

  main.querySelectorAll('[data-plan]').forEach(
    b =>
      (b.onclick = () => {
        const it = plan.items[Number(b.dataset.plan)];
        app.navigate(it.action.page, it.action.params || {});
      }),
  );
  main.querySelectorAll('[data-lesson]').forEach(b => (b.onclick = () => app.navigate('path', { lesson: b.dataset.lesson })));
  $('#diag-review', main)?.addEventListener('click', () => app.navigate('review'));
}

function diagnosisHTML(d) {
  if (d.confidence === 'none')
    return `<p class="muted">Not enough data yet. Review two or three of your recent games, or play practice games with the coach on, and a diagnosis appears here.</p>
      <div class="actions"><button type="button" class="primary" id="diag-review">Review a game</button></div>`;
  const focus = d.focus ? KINDS[d.focus] : null;
  return `${d.confidence === 'early' ? `<p class="status warning">An early read from ${plural(d.mistakes, 'mistake')} and ${plural(d.games, 'reviewed game')}. It will firm up with more games.</p>` : ''}
    ${focus ? `<div class="callout"><strong>Focus: ${esc(focus.label.toLowerCase())}.</strong> ${esc(focus.habit)}</div>` : ''}
    ${barList(d.kinds.map(k => ({ label: k.label, value: Math.round(k.share * 100), max: 100, text: `${k.count}` })))}
    <ul class="findings">${d.findings.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
    <p class="small">Phase of your mistakes: ${d.phases.opening} opening · ${d.phases.middlegame} middlegame · ${d.phases.endgame} endgame.${d.time.known ? ` Clock data for ${plural(d.time.known, 'serious mistake')}.` : ''}</p>`;
}
