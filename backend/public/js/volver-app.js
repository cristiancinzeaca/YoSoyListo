// Tras entrar con Google en el navegador del móvil, devuelve el código a la app de Android.
(function () {
  const params = new URLSearchParams(location.hash.slice(1));
  const code = params.get('code');
  const error = params.get('error');
  const query = code ? `code=${encodeURIComponent(code)}` : `error=${encodeURIComponent(error || 'google')}`;
  const url = `intent://login?${query}#Intent;scheme=yosoylisto;package=es.yosoylisto.app;end`;
  history.replaceState(null, '', '/volver-app');
  const btn = document.getElementById('v-btn');
  btn.href = url;
  if (!code) {
    document.getElementById('v-title').textContent = 'No se ha podido entrar';
    document.getElementById('v-text').textContent = 'Vuelve a la app e inténtalo otra vez.';
  }
  location.href = url;
})();
