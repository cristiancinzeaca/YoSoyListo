// Reto diario: 10 preguntas iguales para todos, una vez al día, con racha y clasificación.
(async function () {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  await Player.ensure('Entra con Google o con tu correo para jugar el reto diario.');

  let bannerTimer;
  function banner(text, warn = false) {
    const b = $('banner');
    clearTimeout(bannerTimer);
    b.textContent = text;
    b.className = warn ? 'banner warn' : 'banner';
    b.hidden = false;
    bannerTimer = setTimeout(() => (b.hidden = true), 3200);
  }

  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const prettyDay = (d) => {
    const [y, m, day] = d.split('-').map(Number);
    return `${day} de ${MONTHS[m - 1]} de ${y}`;
  };
  const shortDay = (d) => d.split('-').reverse().slice(0, 2).join('/');

  let state = null;
  let run = { id: null, q: null, busy: false, timer: 0, deadline: 0, answers: [] };

  function paintStreak(s) {
    $('r-streak-n').textContent = s.streak;
    $('r-streak-txt').textContent = s.streak === 1 ? 'día seguido' : 'días seguidos';
    $('r-streak').classList.toggle('cold', !s.streak);
    $('r-streak').title = `Mejor racha: ${s.best} días`;
  }

  function paintBoard(list) {
    const me = Player.data && Player.data.id;
    const box = $('r-board');
    box.replaceChildren();
    $('r-board-empty').hidden = list.length > 0;
    for (const r of list) {
      const li = el('li', r.playerId === me ? 'me' : '');
      li.append(
        el('span', 'pos', r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : String(r.rank)),
        Hero.face({ name: r.name, avatar: r.avatar, hero: r.hero }),
        el('span', 'name', r.name),
        el('span', 'reto-board-ok', `${r.correct}/10`),
        el('span', 'pts', r.score.toLocaleString('es-ES'))
      );
      box.appendChild(li);
    }
  }

  function untilTomorrow() {
    // Medianoche en Madrid.
    const now = new Date();
    const madrid = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
    const next = new Date(madrid);
    next.setHours(24, 0, 0, 0);
    const ms = next - madrid;
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `${h} h ${m} min`;
  }

  function showResult(result, extra = {}) {
    $('r-intro').hidden = true;
    $('r-play').hidden = true;
    $('r-result').hidden = false;
    const c = result.correct;
    $('r-res-title').textContent = c === 10 ? '🤯 ¡Perfecto! 10 de 10' : c >= 8 ? '🏆 ¡Muy bien!' : c >= 5 ? '👍 ¡Nada mal!' : '💪 Mañana más';
    $('r-grid').replaceChildren(...result.answers.map((ok) => el('span', ok ? 'ok' : 'ko', ok ? '🟩' : '🟥')));
    $('r-res-score').textContent = result.score.toLocaleString('es-ES');
    $('r-res-correct').textContent = `${c}/${result.total}`;
    $('r-res-rank').textContent = `#${result.rank}`;
    if (extra.rewards) {
      const parts = [`+${extra.rewards.coins} 🪙`];
      if (extra.streak && extra.streak.milestone) parts.push(`🎉 ¡${extra.streak.streak} días seguidos! (incluye +${extra.streak.milestone})`);
      $('r-rewards').textContent = parts.join(' · ');
      $('r-rewards').hidden = false;
      if (extra.rewards.balance !== null && extra.rewards.balance !== undefined) Wallet.setCoins(extra.rewards.balance);
      if (extra.rewards.xp) $('r-xp').replaceChildren(Hero.xpResult(extra.rewards.xp));
    }
    $('r-next').textContent = `Nuevo reto en ${untilTomorrow()}`;
    FX.screen($('r-result'));
  }

  $('r-share').addEventListener('click', async () => {
    const r = state.result;
    const grid = r.answers.map((ok) => (ok ? '🟩' : '🟥')).join('');
    const text = `Reto diario Yo Soy Listo · ${shortDay(state.day)}${state.streak.streak ? ` · 🔥${state.streak.streak}` : ''}\n${grid}\n${r.correct}/10 · ${r.score.toLocaleString('es-ES')} puntos · puesto #${r.rank}\n¿Me superas?`;
    const url = `${location.origin}/reto`;
    try {
      if (navigator.share) await navigator.share({ title: 'Reto diario', text, url });
      else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        banner('Resultado copiado: pégalo en WhatsApp');
      }
    } catch {
      // compartir cancelado
    }
  });

  // ---------- jugar ----------
  function paintProgress(index, total) {
    const box = $('r-progress');
    box.replaceChildren();
    for (let i = 0; i < total; i++) {
      const cls = i < run.answers.length ? (run.answers[i] ? 'ok' : 'ko') : i === index ? 'now' : '';
      box.appendChild(el('span', cls));
    }
  }

  function ask(q) {
    run.q = q;
    run.busy = false;
    paintProgress(q.index, q.total);
    $('r-cat').textContent = categoryLabel(q.category);
    $('r-q').textContent = q.text;
    const opts = $('r-options');
    opts.replaceChildren();
    q.options.forEach((text, i) => {
      const b = el('button', 'option', text);
      b.type = 'button';
      b.addEventListener('click', () => answer(i, b));
      opts.appendChild(b);
    });
    FX.enter($('r-play'));
    run.deadline = performance.now() + q.ms;
    cancelAnimationFrame(run.timer);
    const tick = () => {
      const left = Math.max(0, run.deadline - performance.now());
      $('r-timer').style.transform = `scaleX(${left / 15000})`;
      $('r-timer').classList.toggle('low', left < 4000);
      if (left <= 0 && !run.busy) return answer(-1, null);
      if (!run.busy) run.timer = requestAnimationFrame(tick);
    };
    run.timer = requestAnimationFrame(tick);
  }

  async function answer(option, button) {
    if (run.busy) return;
    run.busy = true;
    cancelAnimationFrame(run.timer);
    const buttons = [...$('r-options').children];
    for (const b of buttons) b.disabled = true;
    if (button) button.classList.add('picked');
    let res;
    try {
      res = await api.post(`/api/daily/runs/${run.id}/answer`, { index: run.q.index, option });
    } catch (err) {
      banner(err.message, true);
      return load();
    }
    afterAnswer(res, button, buttons);
  }

  function afterAnswer(res, button, buttons) {
    run.answers.push(res.right);
    if (buttons && buttons[res.correctIndex]) buttons[res.correctIndex].classList.add('correct');
    if (!res.right && button) button.classList.add('wrong');
    $('r-score').textContent = res.score.toLocaleString('es-ES');
    if (res.right) {
      FX.play('correct');
      if (button) FX.float && FX.float(`+${res.gained}`, button, 'gold');
    } else {
      FX.play('wrong');
      if (res.late) banner('⏰ ¡Se acabó el tiempo!', true);
    }
    setTimeout(() => {
      if (!res.done) {
        run.id = res.runId;
        return ask(res.question);
      }
      state.played = true;
      state.result = res.result;
      state.streak = { ...state.streak, streak: res.streak.streak, best: res.streak.best };
      paintStreak(state.streak);
      paintBoard(res.leaderboard);
      if (res.result.correct >= 8) {
        FX.play('victory');
        FX.confetti && FX.confetti(160);
      } else FX.play('streak');
      showResult(res.result, res);
    }, 1200);
  }

  $('r-start').addEventListener('click', async () => {
    $('r-start').disabled = true;
    try {
      const s = await api.post('/api/daily/start', {});
      $('r-intro').hidden = true;
      $('r-play').hidden = false;
      // Si volvía a una pregunta caducada, el servidor ya la ha contado como fallo.
      if (s.resumed) {
        run.answers.push(false);
        run.id = s.runId;
        $('r-score').textContent = s.score.toLocaleString('es-ES');
        if (s.done) return load();
        return ask(s.question);
      }
      run.id = s.runId;
      $('r-score').textContent = (s.score || 0).toLocaleString('es-ES');
      FX.play('go');
      ask(s.question);
    } catch (err) {
      banner(err.message, true);
      $('r-start').disabled = false;
    }
  });

  async function load() {
    try {
      state = await api.get('/api/daily');
    } catch (err) {
      if (err.status === 401) return Player.ensure('Tu sesión ha caducado. Vuelve a entrar.');
      return banner(err.message, true);
    }
    $('r-date').textContent = prettyDay(state.day);
    paintStreak(state.streak);
    paintBoard(state.leaderboard);
    if (state.played) return showResult(state.result);
    $('r-intro').hidden = false;
    $('r-start').textContent = state.inProgress ? 'Seguir con el reto' : '¡Empezar el reto!';
  }

  load();
})();
