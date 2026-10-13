// Envío de correos con Brevo (API HTTP, sin dependencias).
// Variables: BREVO_API_KEY y MAIL_FROM (el remitente verificado en Brevo, p. ej. yosoylisto@gmail.com).
// Sin ellas, los enlaces se escriben en el registro del servidor (útil en local).

const configured = () => !!(process.env.BREVO_API_KEY && process.env.MAIL_FROM);

async function sendMail({ to, subject, html, text }) {
  if (!configured()) {
    console.log(`[correo] (sin BREVO_API_KEY) Para ${to}: ${subject}\n${text}`);
    return { sent: false };
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: process.env.MAIL_FROM, name: 'Yo Soy Listo' },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brevo ${res.status}: ${body.slice(0, 200)}`);
  }
  return { sent: true };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function layout(title, intro, buttonText, url, outro) {
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#1b1035;font-family:Arial,sans-serif;color:#f5f1ff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#2a1a52;border:2px solid #ffcb2b;border-radius:18px" cellpadding="0" cellspacing="0">
<tr><td style="padding:28px 24px;text-align:center">
<h1 style="margin:0 0 6px;font-size:26px;color:#ffcb2b">Yo Soy Listo</h1>
<h2 style="margin:0 0 16px;font-size:20px;color:#ffffff">${esc(title)}</h2>
<p style="margin:0 0 22px;font-size:16px;line-height:1.5">${esc(intro)}</p>
<a href="${esc(url)}" style="display:inline-block;background:#ffcb2b;color:#3b2300;text-decoration:none;font-weight:bold;font-size:17px;padding:14px 26px;border-radius:12px">${esc(buttonText)}</a>
<p style="margin:22px 0 0;font-size:13px;line-height:1.5;color:#c3b6ec">${esc(outro)}</p>
<p style="margin:14px 0 0;font-size:12px;color:#c3b6ec;word-break:break-all">${esc(url)}</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `${title}\n\n${intro}\n\n${buttonText}: ${url}\n\n${outro}`;
  return { html, text };
}

function verifyMail(to, name, url) {
  const { html, text } = layout(
    `¡Hola, ${name}!`,
    'Confirma tu correo para activar tu cuenta y empezar a jugar.',
    'Confirmar mi correo',
    url,
    'El enlace caduca en 48 horas. Si no has creado ninguna cuenta, ignora este mensaje.'
  );
  return sendMail({ to, subject: 'Confirma tu cuenta de Yo Soy Listo', html, text });
}

function resetMail(to, name, url) {
  const { html, text } = layout(
    `Hola, ${name}`,
    'Has pedido cambiar tu contraseña. Pulsa el botón para elegir una nueva.',
    'Cambiar mi contraseña',
    url,
    'El enlace caduca en 1 hora. Si no lo has pedido tú, ignora este mensaje: tu contraseña sigue igual.'
  );
  return sendMail({ to, subject: 'Cambia tu contraseña de Yo Soy Listo', html, text });
}

module.exports = { configured, sendMail, verifyMail, resetMail };
