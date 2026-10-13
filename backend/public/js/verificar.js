// Enlaces de los correos: /verificar#v=… (confirmar cuenta) y /verificar#r=… (nueva contraseña).
(function () {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', '/verificar');
  const show = (id) => {
    for (const s of ['v-wait', 'v-ok', 'v-reset', 'v-error']) $(s).hidden = s !== id;
  };
  const fail = (text) => {
    $('v-error-text').textContent = text;
    show('v-error');
  };

  async function verify(token) {
    try {
      const res = await api.post('/api/auth/verify', { token });
      Player.save(res.player, res.token);
      show('v-ok');
      FX.confetti && FX.confetti(120);
      FX.play('streak');
      setTimeout(() => location.replace('/heroe?next=%2F'), 2000);
    } catch (err) {
      fail(err.message);
    }
  }

  function reset(token) {
    show('v-reset');
    $('v-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('v-msg').hidden = true;
      if ($('v-pass').value !== $('v-pass2').value) {
        $('v-msg').textContent = 'Las contraseñas no coinciden';
        $('v-msg').hidden = false;
        return;
      }
      try {
        const res = await api.post('/api/auth/reset', { token, password: $('v-pass').value });
        Player.save(res.player, res.token);
        location.replace('/');
      } catch (err) {
        $('v-msg').textContent = err.message;
        $('v-msg').hidden = false;
      }
    });
  }

  if (params.get('v')) verify(params.get('v'));
  else if (params.get('r')) reset(params.get('r'));
  else fail('Este enlace no es válido.');
})();
