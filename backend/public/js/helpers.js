// Barra de comodines que aparece bajo la pregunta.
// HelperBar.create(['fifty', 'time'], async (kind) => {...}) → { el, reset(), lock(kind), refresh() }
const HELPER_INFO = {
  fifty: { icon: '✂️', label: '50/50' },
  time: { icon: '⏱️', label: '+10s' },
  skip: { icon: '⏭️', label: 'Saltar' },
  hint: { icon: '💡', label: 'Pista' },
};

const HelperBar = {
  create(kinds, onUse) {
    const el = document.createElement('div');
    el.className = 'helper-bar';
    el.setAttribute('aria-label', 'Comodines');
    const buttons = {};
    const used = new Set();
    let busy = false;

    function paint() {
      for (const kind of kinds) {
        const b = buttons[kind];
        const n = Wallet.count(kind);
        b.querySelector('.n').textContent = n;
        b.classList.toggle('empty', n === 0);
        b.disabled = used.has(kind) || busy;
        b.classList.toggle('used', used.has(kind));
      }
    }

    function toast(text) {
      let t = el.querySelector('.helper-toast');
      if (!t) {
        t = document.createElement('a');
        t.className = 'helper-toast';
        t.href = '/tienda';
        el.appendChild(t);
      }
      t.textContent = text;
      t.hidden = false;
      clearTimeout(t.timer);
      t.timer = setTimeout(() => (t.hidden = true), 3200);
    }

    for (const kind of kinds) {
      const info = HELPER_INFO[kind];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'helper-btn';
      b.dataset.kind = kind;
      b.setAttribute('aria-label', `Comodín ${info.label}`);
      const i = document.createElement('span');
      i.className = 'i';
      i.textContent = info.icon;
      const l = document.createElement('span');
      l.className = 'l';
      l.textContent = info.label;
      const n = document.createElement('span');
      n.className = 'n';
      b.append(i, l, n);
      b.addEventListener('click', async () => {
        if (busy || used.has(kind)) return;
        if (Wallet.count(kind) === 0) {
          FX.shake(b);
          toast('No te quedan. Consíguelos en la tienda 🪙 →');
          return;
        }
        busy = true;
        used.add(kind);
        paint();
        try {
          const ok = await onUse(kind);
          if (ok === false) used.delete(kind);
          else {
            FX.play('streak');
            FX.burst(b, { amount: 16, power: 5 });
          }
        } catch (err) {
          used.delete(kind);
          toast(err.message || 'No se pudo usar el comodín');
        } finally {
          busy = false;
          paint();
        }
      });
      buttons[kind] = b;
      el.appendChild(b);
    }
    paint();

    return {
      el,
      // Nueva pregunta: se pueden volver a usar.
      reset() {
        used.clear();
        busy = false;
        paint();
      },
      lock(kind) {
        used.add(kind);
        paint();
      },
      refresh: paint,
      toast,
    };
  },

  // Tacha las opciones que quita el 50/50.
  applyFifty(buttons, remove) {
    for (const i of remove || []) {
      const b = buttons[i];
      if (!b) continue;
      b.disabled = true;
      b.classList.add('removed');
    }
  },
};

// Recuadro «+N monedas» al terminar una partida (duelo, sala, Conquista).
function coinReward(row) {
  const box = document.createElement('div');
  box.className = 'coins-won';
  const coins = row && row.coins ? row.coins : 0;
  box.innerHTML = '<span class="coin-big" aria-hidden="true">🪙</span><strong></strong><small>monedas</small><p class="coins-note"></p>';
  box.querySelector('strong').textContent = `+${coins}`;
  box.querySelector('.coins-note').textContent =
    row && row.coinsBonus ? `☀️ Incluye +${row.coinsBonus} por tu primera partida del día` : coins ? '' : 'Hoy ya has llegado al tope de monedas';
  if (coins > 0) {
    Wallet.load();
    setTimeout(() => {
      FX.burst(box.querySelector('strong'), { colors: ['#ffcb2b', '#ffe58a', '#fff'], amount: 28 });
      FX.bump(box);
    }, 900);
  }
  return box;
}
