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
      await wait(800);
    }
  }

  async function begin() {
    await countdown();
    let data;
    try {
      data = await api.post('/api/blitz/start', { category: category || undefined });
    } catch (err) {
      screens.countdown.replaceChildren();
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
    $('timer-text').textContent = Math.ceil(left / 1000);
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

  function popPoints(text, miss) {
    const pop = document.createElement('div');
    pop.className = miss ? 'points-pop miss' : 'points-pop';
    pop.textContent = text;
    $('question-card').appendChild(pop);
    setTimeout(() => pop.remove(), 700);
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
        text: q.text,
        yours: q.options[optionIndex],
        right: q.options[res.correctIndex],
        explanation: res.explanation,
      });
    }
    popPoints(res.correct ? `+${res.points}${res.multiplier > 1 ? ` x${res.multiplier}` : ''}` : '✗', !res.correct);

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

  function renderResult(result) {
    show('result');
    $('result-score').textContent = result.score;
    $('result-correct').textContent = result.correctCount;
    $('result-answered').textContent = result.answeredCount;
    $('result-streak').textContent = result.bestStreak;

    const lastName = storage.get('ysl:name');
    if (lastName) $('player-name').value = lastName;
    if (result.score === 0) $('name-form').hidden = true;

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
        if (m.explanation) {
          const expl = document.createElement('div');
          expl.className = 'expl';
          expl.textContent = m.explanation;
          li.appendChild(expl);
        }
        list.appendChild(li);
      }
      $('review-card').hidden = false;
    }
  }

  $('name-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('player-name').value.trim();
    const errorEl = $('name-error');
    errorEl.hidden = true;
    if (name.length < 2) {
      errorEl.textContent = 'El nombre debe tener al menos 2 caracteres';
      errorEl.hidden = false;
      return;
    }
    $('save-btn').disabled = true;
    try {
      const result = await api.post(`/api/blitz/${state.sessionId}/finish`, { name });
      storage.set('ysl:name', result.playerName);
      $('name-form').hidden = true;
      $('rank-msg').textContent = `¡Guardado! Estás en el puesto ${result.rank} del ranking histórico.`;
      $('rank-msg').hidden = false;
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      $('save-btn').disabled = false;
    }
  });

  begin();
})();
