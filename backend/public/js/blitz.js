(function () {
  const $ = (id) => document.getElementById(id);
  const screens = { countdown: $('screen-countdown'), game: $('screen-game'), result: $('screen-result') };

  const category = new URLSearchParams(location.search).get('cat') || '';
  $('again-btn').href = category ? `/blitz?cat=${encodeURIComponent(category)}` : '/blitz';

  const state = {
    sessionId: null,
    questions: [],
    index: 0,
    score: 0,
    streak: 0,
    durationMs: 60000,
    endAt: 0,
    busy: false,
    ended: false,
    pending: null,
    mistakes: [],
  };

  function show(name) {
    for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
    FX.screen(screens[name]);
  }

  function showError(message) {
    const box = $('error-box');
    box.textContent = message;
    box.hidden = false;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function countdown() {
    show('countdown');
    for (const n of ['3', '2', '1']) {
      const span = document.createElement('span');
      span.textContent = n;
      screens.countdown.replaceChildren(span);
      FX.play('tick');
      await wait(800);
    }
    FX.play('go');
  }

  // Comodines: 50/50, tiempo extra y saltar.
  const helperBar = HelperBar.create(['fifty', 'time', 'skip'], async (kind) => {
    if (state.busy || state.ended) return false;
    const q = state.questions[state.index];
    const res = await api.post(`/api/blitz/${state.sessionId}/helper`, { kind, questionId: q.id });
    Wallet.setCount(kind, res.left);
    if (state.questions[state.index] !== q) return true;
    const buttons = [...$('options').children];
    if (kind === 'fifty') HelperBar.applyFifty(buttons, res.remove);
    if (kind === 'time') {
      state.endAt += res.extraMs;
      FX.float('+10 s', $('timer-text'), 'big');
    }
    if (kind === 'skip') {
      FX.float('⏭️', $('question-card'));
      state.index += 1;
      if (state.index >= state.questions.length) end();
      else renderQuestion();
    }
    return true;
  });
  $('question-card').appendChild(helperBar.el);

  async function begin() {
    await Player.ensure();
    await Wallet.load();
    helperBar.refresh();
    await countdown();
    let data;
    try {
      data = await api.post('/api/blitz/start', { category: category || undefined });
    } catch (err) {
      screens.countdown.replaceChildren();
      if (err.status === 401) {
        Player.forget();
        return Player.ensure();
      }
      showError(`${err.message}. `);
      const link = document.createElement('a');
      link.href = '/';
      link.textContent = 'Volver al inicio';
      $('error-box').appendChild(link);
      return;
    }
    state.sessionId = data.sessionId;
    state.questions = data.questions;
    state.durationMs = data.durationMs;
    state.endAt = performance.now() + data.durationMs;
    show('game');
    renderQuestion();
    tick();
  }

  function tick() {
    if (state.ended) return;
    const left = Math.max(0, state.endAt - performance.now());
    $('timer-bar').style.transform = `scaleX(${left / state.durationMs})`;
    $('timer-bar').classList.toggle('low', left < 10000);
    const secs = Math.ceil(left / 1000);
    $('timer-text').textContent = secs;
    if (secs <= 5 && secs > 0 && secs !== state.lastTick) {
      state.lastTick = secs;
      FX.play('tick');
    }
    if (left <= 0) {
      end();
      return;
    }
    requestAnimationFrame(tick);
  }

  function renderQuestion() {
    const q = state.questions[state.index];
    $('question-cat').textContent = categoryLabel(q.category);
    $('question-text').textContent = q.text;
    FX.enter($('question-card'));
    helperBar.reset();
    const options = $('options');
    options.replaceChildren();
    q.options.forEach((text, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option';
      btn.textContent = text;
      btn.addEventListener('click', () => choose(i));
      options.appendChild(btn);
    });
  }

  async function choose(optionIndex) {
    if (state.busy || state.ended) return;
    state.busy = true;
    const q = state.questions[state.index];
    const buttons = [...$('options').children];
    buttons.forEach((b) => (b.disabled = true));

    state.pending = api.post(`/api/blitz/${state.sessionId}/answer`, { questionId: q.id, optionIndex });
    let res;
    try {
      res = await state.pending;
    } catch (err) {
      state.pending = null;
      if (err.status === 409) return end();
      showError(err.message);
      state.busy = false;
      buttons.forEach((b) => (b.disabled = false));
      return;
    }
    state.pending = null;

    buttons[res.correctIndex].classList.add('correct');
    if (!res.correct) {
      buttons[optionIndex].classList.add('wrong');
      state.mistakes.push({
        id: q.id,
        text: q.text,
        yours: q.options[optionIndex],
        right: q.options[res.correctIndex],
        explanation: res.explanation,
      });
    }
    const card = $('question-card');
    if (res.correct) {
      FX.play('correct');
      FX.vibrate(25);
      FX.burst(buttons[res.correctIndex], { amount: res.multiplier > 1 ? 36 : 22 });
      FX.float(`+${res.points}${res.multiplier > 1 ? ` x${res.multiplier}` : ''}`, buttons[res.correctIndex], res.multiplier > 1 ? 'big' : '');
      FX.bump($('score'));
      if (res.streak === 3 || res.streak === 6) {
        FX.mascot('gana');
        FX.play('streak');
        FX.bigText(res.streak === 3 ? '🔥 ¡Racha x2!' : '🔥🔥 ¡Racha x3!');
      }
    } else {
      FX.play('wrong');
      FX.vibrate([60, 40, 60]);
      FX.shake(card);
      if (state.streak >= 3) FX.mascot('falla');
      FX.float('✗', buttons[optionIndex], 'bad');
    }

    state.score = res.score;
    state.streak = res.streak;
    $('score').textContent = state.score;
    $('streak').textContent = state.streak;
    $('streak-box').classList.toggle('hot', state.streak >= 3);

    await wait(res.correct ? 450 : 900);
    if (state.ended) return;

    state.index += 1;
    state.busy = false;
    if (state.index >= state.questions.length) return end();
    renderQuestion();
  }

  async function end() {
    if (state.ended) return;
    state.ended = true;
    // Si había una respuesta en camino, esperamos a que cuente.
    if (state.pending) await state.pending.catch(() => {});

    let result;
    try {
      result = await api.post(`/api/blitz/${state.sessionId}/finish`, {});
    } catch (err) {
      showError(err.message);
      return;
    }
    renderResult(result);
  }

  // Monedas ganadas en la partida.
  function renderCoins(result) {
    const c = result.coins || {};
    const total = (c.awarded || 0) + (c.bonus || 0);
    const box = $('result-coins');
    if (!box) return;
    box.hidden = false;
    $('coins-won').textContent = `+${total}`;
    const notes = [];
    if (c.personalBest) notes.push('🎯 ¡Nuevo récord personal!');
    if (c.bonus) notes.push(`☀️ +${c.bonus} por tu primera partida del día`);
    $('coins-note').textContent = notes.join(' · ');
    if (c.balance !== null && c.balance !== undefined) Wallet.setCoins(c.balance);
    if (total > 0) setTimeout(() => {
      FX.burst($('coins-won'), { colors: ['#ffcb2b', '#ffe58a', '#fff'], amount: 30 });
      FX.bump(box);
    }, 900);
  }

  function renderResult(result) {
    show('result');
    FX.endMascot($('screen-result').querySelector('.card'), result.score > 0);
    FX.countUp($('result-score'), result.score, 1200);
    if (result.score > 0) {
      FX.play('victory');
      setTimeout(() => FX.confetti(Math.min(220, 60 + result.correctCount * 12)), 300);
    } else {
      FX.play('defeat');
    }
    $('result-correct').textContent = result.correctCount;
    $('result-answered').textContent = result.answeredCount;
    $('result-streak').textContent = result.bestStreak;

    renderCoins(result);
    if (result.rank) {
      $('rank-msg').textContent = `🏆 Puesto ${result.rank} del ranking histórico`;
      $('rank-msg').hidden = false;
    }

    if (state.mistakes.length > 0) {
      const list = $('review');
      for (const m of state.mistakes) {
        const li = document.createElement('li');
        const q = document.createElement('div');
        q.className = 'q';
        q.textContent = m.text;
        const yours = document.createElement('div');
        yours.className = 'yours';
        yours.textContent = `Tu respuesta: ${m.yours}`;
        const right = document.createElement('div');
        right.className = 'right';
        right.textContent = `Correcta: ${m.right}`;
        li.append(q, yours, right);
        const report = document.createElement('button');
        report.type = 'button';
        report.className = 'link-btn';
        report.textContent = '⚑ Avisar de un error';
        report.addEventListener('click', () => reportQuestion(m.id));
        if (m.explanation) {
          const expl = document.createElement('div');
          expl.className = 'expl';
          expl.textContent = m.explanation;
          li.appendChild(expl);
        }
        li.appendChild(report);
        list.appendChild(li);
      }
      $('review-card').hidden = false;
    }
  }

  begin();
})();
