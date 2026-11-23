'use strict';

const PagesAuth = (() => {
  const origin = globalThis.CIP_PAGES_API_ORIGIN;
  const sessionKey = 'cip-tracker.pages.session';
  const verifierKey = 'cip-tracker.pages.login-verifier';
  const tokenPattern = /^[\w-]{43}$/;
  let session;
  let expirationTimer;

  function clear() {
    session = null;
    clearTimeout(expirationTimer);
    try { sessionStorage.removeItem(sessionKey); } catch { /* Storage can be disabled. */ }
  }
  function checkExpiration() {
    if (session && Date.now() >= session.expiresAt) {
      clear();
      location.reload();
    }
  }
  function restore(value) {
    if (typeof value?.token !== 'string' || !/^cip_[\w-]{43}$/.test(value.token)
        || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= Date.now()) {
      clear();
      return;
    }
    session = value;
    clearTimeout(expirationTimer);
    expirationTimer = setTimeout(checkExpiration, value.expiresAt - Date.now());
  }

  async function request(path, options) {
    const headers = new Headers(options.headers);
    if (session) headers.set('Authorization', 'Bearer ' + session.token);
    return fetch(new URL(path, origin), {...options, headers, credentials:'omit', redirect:'error'});
  }
  async function signIn() {
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    sessionStorage.setItem(verifierKey, verifier);
    const url = new URL('/auth/google', origin);
    url.searchParams.set('pages_challenge', challenge);
    location.assign(url.href);
  }
  function base64url(bytes) {
    return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  }
  async function completeSignIn() {
    const code = new URLSearchParams(location.hash.slice(1)).get('login_code');
    if (code === null) return;
    history.replaceState(history.state, '', location.pathname + location.search);
    const verifier = sessionStorage.getItem(verifierKey);
    sessionStorage.removeItem(verifierKey);
    if (!tokenPattern.test(code) || !tokenPattern.test(verifier || '')) throw new Error('이 탭에서 다시 로그인하세요.');
    const response = await request('/api/auth/pages', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({code, verifier}),
    });
    if (!response.ok) throw new Error('로그인을 완료하지 못했습니다. 다시 시도하세요.');
    const issued = await response.json();
    restore(issued);
    if (!session) throw new Error('로그인이 만료되었습니다. 다시 로그인하세요.');
    sessionStorage.setItem(sessionKey, JSON.stringify(issued));
  }

  if (!origin) return null;
  try { restore(JSON.parse(sessionStorage.getItem(sessionKey))); } catch { clear(); }
  for (const event of ['focus', 'pageshow']) window.addEventListener(event, checkExpiration);
  document.addEventListener('visibilitychange', checkExpiration);
  return {request, signIn, completeSignIn, clear, hasSession:() => Boolean(session)};
})();
