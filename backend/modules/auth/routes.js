const crypto = require('crypto');
const express = require('express');
const { httpError } = require('../../core/http');
const { rateLimit } = require('../../core/rateLimit');
const google = require('./google');
const players = require('../players/service');
const shop = require('../shop/service');
const { bearer } = require('../players/auth');

const COOKIE = 'ysl_oauth';

function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

const redirectUri = (req) => `${baseUrl(req)}/auth/google/callback`;

function readCookie(req, name) {
  for (const part of (req.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setCookie(req, res, value, maxAgeSec) {
  const secure = req.secure || baseUrl(req).startsWith('https://');
  res.append(
    'Set-Cookie',
    `${COOKIE}=${encodeURIComponent(value)}; Path=/auth; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
  );
}

// Páginas de redirección: /auth/google y /auth/google/callback
const pages = express.Router();

pages.get('/google', rateLimit({ windowMs: 60_000, max: 30 }), (req, res) => {
  const next = google.safeNext(req.query.next);
  if (!google.configured()) return res.redirect('/entrar#error=config');
  const state = crypto.randomBytes(16).toString('base64url');
  setCookie(req, res, `${state}|${next}`, 600);
  if (google.fakeMode()) {
    const name = String(req.query.dev || 'Probador').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 20);
    return res.redirect(`/auth/google/callback?state=${state}&code=dev:${encodeURIComponent(name)}`);
  }
  res.redirect(google.authUrl(redirectUri(req), state));
});

pages.get('/google/callback', rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  const saved = readCookie(req, COOKIE) || '';
  setCookie(req, res, '', 0);
  const [state, next] = saved.split('|');
  if (req.query.error) return res.redirect('/entrar#error=cancel');
  if (!state || state !== req.query.state || typeof req.query.code !== 'string') {
    return res.redirect('/entrar#error=state');
  }
  try {
    const identity = await google.exchangeCode(req.query.code, redirectUri(req));
    const code = google.createLoginCode(identity, google.safeNext(next));
    res.redirect(`/entrar#code=${encodeURIComponent(code)}`);
  } catch (err) {
    console.error('[auth] Google', err.message);
    res.redirect('/entrar#error=google');
  }
});

// API: terminar el inicio de sesión y cerrar sesión.
const api = express.Router();

api.get('/config', (req, res) => {
  res.json({ google: google.configured() });
});

api.post('/complete', rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  const entry = google.consumeLoginCode(req.body?.code);
  if (!entry) throw httpError(400, 'El enlace de acceso ha caducado. Vuelve a entrar con Google.');
  const result = await players.loginWithGoogle(entry.identity, req.body?.guestToken, { onCreated: shop.grantWelcome });
  res.json({ ...result, next: entry.next });
});

api.post('/logout', async (req, res) => {
  await players.logout(bearer(req));
  res.json({ ok: true });
});

module.exports = { pages, api };
