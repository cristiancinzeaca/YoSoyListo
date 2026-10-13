// Vuelta de Google: termina el inicio de sesión y lleva al jugador donde estaba.
(function () {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.hash.slice(1));
  const nextRaw = new URLSearchParams(location.search).get('next');
  const nextPage = nextRaw && nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/';
  history.replaceState(null, '', '/entrar');

  const ERRORS = {
    cancel: 'Has cancelado el acceso con Google.',
    state: 'El acceso ha caducado. Vuelve a intentarlo.',
    google: 'Google no ha podido confirmar tu cuenta. Inténtalo de nuevo.',
    config: 'El acceso con Google todavía no está configurado en el servidor.',
  };

  function fail(text) {
    $('e-spinner').hidden = true;
    $('e-title').textContent = 'No se ha podido entrar';
    $('e-text').textContent = text;
    $('e-google').href = Player.loginUrl('/');
    $('e-google').hidden = false;
    $('e-home').hidden = false;
    showLogin(text, nextPage);
  }

  async function complete(code) {
    try {
      const res = await api.post('/api/auth/complete', { code, guestToken: storage.get('ysl:token') || undefined });
      Player.save(res.player, res.token);
      $('e-spinner').hidden = true;
      $('e-title').textContent = res.created ? `¡Bienvenido, ${res.player.name}!` : `¡Hola otra vez, ${res.player.name}!`;
      $('e-text').textContent = res.created ? 'Te regalamos 100 monedas y un comodín de cada tipo. ¡A jugar!' : 'Volvemos a tu partida…';
      if (res.created) {
        FX.confetti(120);
        FX.play('streak');
      }
      // Cuenta nueva (o sin héroe todavía): primero se crea el héroe.
      const next = res.next || '/';
      const go = res.created || !res.player.hero ? `/heroe?next=${encodeURIComponent(next)}` : next;
      setTimeout(() => location.replace(go), res.created ? 2200 : 600);
    } catch (err) {
      fail(err.message);
    }
  }

  if (params.get('code')) complete(params.get('code'));
  else if (params.get('error')) fail(ERRORS[params.get('error')] || 'Algo ha fallado. Inténtalo de nuevo.');
  else if (Player.has()) location.replace('/');
  else {
    $('e-spinner').hidden = true;
    $('e-title').textContent = 'Entra para jugar';
    $('e-text').textContent = 'Entra con Google o con tu correo: guardamos tus monedas, tu héroe y tus estadísticas.';
    $('e-google').href = Player.loginUrl(nextPage);
    $('e-google').hidden = false;
    // También con correo y contraseña.
    showLogin('Entra con Google o con tu correo y contraseña.', nextPage);
  }
})();
