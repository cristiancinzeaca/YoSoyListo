// Fecha de nacimiento obligatoria (una sola vez).
(async function () {
  const $ = (id) => document.getElementById(id);
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const nextRaw = new URLSearchParams(location.search).get('next');
  const next = nextRaw && nextRaw.startsWith('/') && !nextRaw.startsWith('//') && !nextRaw.startsWith('/edad') ? nextRaw : '/';

  await Player.ensure('Entra con Google para continuar.', location.pathname + location.search);
  if (Player.data && Player.data.birthdateSet) return location.replace(next);

  const opt = (sel, value, label) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    sel.appendChild(o);
  };
  opt($('a-day'), '', '—');
  for (let d = 1; d <= 31; d++) opt($('a-day'), String(d).padStart(2, '0'), String(d));
  opt($('a-month'), '', '—');
  MONTHS.forEach((m, i) => opt($('a-month'), String(i + 1).padStart(2, '0'), m));
  opt($('a-year'), '', '—');
  const thisYear = new Date().getFullYear();
  for (let y = thisYear; y >= thisYear - 100; y--) opt($('a-year'), String(y), String(y));

  const value = () => `${$('a-year').value}-${$('a-month').value}-${$('a-day').value}`;
  const valid = () => {
    if (!$('a-year').value || !$('a-month').value || !$('a-day').value) return false;
    const [y, m, d] = value().split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && dt <= new Date();
  };
  const age = () => {
    const [y, m, d] = value().split('-').map(Number);
    const now = new Date();
    let a = now.getFullYear() - y;
    if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a -= 1;
    return a;
  };
  for (const id of ['a-day', 'a-month', 'a-year']) {
    $(id).addEventListener('change', () => {
      $('a-next').disabled = !valid();
      $('a-error').hidden = valid() || !$('a-year').value || !$('a-month').value || !$('a-day').value;
      $('a-error').textContent = 'Esa fecha no existe';
    });
  }

  $('a-next').addEventListener('click', () => {
    const [y, m, d] = value().split('-').map(Number);
    $('a-summary').textContent = `${d} de ${MONTHS[m - 1]} de ${y} · ${age()} años`;
    $('a-form').hidden = true;
    $('a-confirm').hidden = false;
    FX.screen($('a-confirm'));
  });
  $('a-back').addEventListener('click', () => {
    $('a-confirm').hidden = true;
    $('a-form').hidden = false;
  });
  $('a-save').addEventListener('click', async () => {
    $('a-save').disabled = true;
    $('a-error2').hidden = true;
    try {
      const me = await api.post('/api/players/birthdate', { date: value() });
      Player.save(me);
      if (me.birthdayGift) {
        FX.confetti && FX.confetti(220);
        FX.play('victory');
        $('a-confirm').replaceChildren(
          Object.assign(document.createElement('div'), { className: 'age-cake', textContent: '🎂' }),
          Object.assign(document.createElement('h1'), { textContent: '¡Feliz cumpleaños!' }),
          Object.assign(document.createElement('p'), { textContent: `¡Qué casualidad! Hoy es tu día: te regalamos ${me.birthdayGift} monedas 🪙` })
        );
        setTimeout(() => location.replace(next), 3500);
      } else {
        location.replace(next);
      }
    } catch (err) {
      if (err.status === 409) {
        await Player.refresh().catch(() => {});
        return location.replace(next);
      }
      if (err.status === 403) {
        Player.clear();
        $('a-confirm').hidden = true;
        $('a-bye').hidden = false;
        $('a-bye-text').textContent = err.message;
        return;
      }
      $('a-error2').textContent = err.message;
      $('a-error2').hidden = false;
      $('a-save').disabled = false;
    }
  });
})();
