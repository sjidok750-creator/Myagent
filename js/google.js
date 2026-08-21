/**
 * 구글 계정 연결 (PKCE 인가 코드 흐름).
 *
 * 토큰은 이 기기에만 저장된다. 서버는 교환·갱신을 중계할 뿐 보관하지 않는다.
 * 클라이언트 시크릿은 브라우저가 가질 수 없으므로 교환은 /api/google/token 이 대신한다.
 */

import * as store from './store.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'openid',
  'email',
].join(' ');

const PENDING_KEY = 'herushi.google.pending';

let configPromise = null;

/** 서버에 구글 연결이 설정돼 있는지 (클라이언트 ID 존재 여부) */
export function googleConfig() {
  configPromise ||= fetch('/api/google/config')
    .then((r) => (r.ok ? r.json() : { enabled: false, clientId: '' }))
    .catch(() => ({ enabled: false, clientId: '' }));
  return configPromise;
}

export function redirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

/* ---------------- PKCE ---------------- */

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(len = 64) {
  return b64url(crypto.getRandomValues(new Uint8Array(len)));
}

async function challenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(digest);
}

/** 구글 동의 화면으로 보낸다. 돌아오면 completeConnect() 가 마무리한다. */
export async function startConnect() {
  const cfg = await googleConfig();
  if (!cfg.enabled) {
    throw new Error('서버에 구글 클라이언트가 설정되어 있지 않습니다. README 의 구글 설정 절차를 따라 주세요.');
  }

  const verifier = randomString(48);
  const state = randomString(16);
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state }));
  localStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state })); // 홈 화면 앱은 세션이 끊길 수 있다

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    code_challenge: await challenge(verifier),
    code_challenge_method: 'S256',
    state,
  });

  location.href = `${AUTH_URL}?${params}`;
}

/**
 * 리디렉션으로 돌아왔을 때 주소창의 code 를 토큰으로 바꾼다.
 * @returns {Promise<{connected:boolean, email?:string, error?:string}|null>} 인증 흐름이 아니면 null
 */
export async function completeConnect() {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');
  if (!code && !error) return null;

  // 주소창을 깨끗이 (코드가 히스토리에 남지 않게)
  history.replaceState(null, '', url.pathname + url.hash);

  const pendingRaw = sessionStorage.getItem(PENDING_KEY) || localStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  localStorage.removeItem(PENDING_KEY);

  if (error) return { connected: false, error: googleDenied(error) };
  if (!pendingRaw) return { connected: false, error: '인증 정보가 사라졌습니다. 다시 연결해 주세요.' };

  let pending;
  try {
    pending = JSON.parse(pendingRaw);
  } catch {
    return { connected: false, error: '인증 정보를 읽지 못했습니다. 다시 연결해 주세요.' };
  }
  if (state && pending.state && state !== pending.state) {
    return { connected: false, error: '인증 응답이 일치하지 않습니다. 다시 연결해 주세요.' };
  }

  try {
    const tok = await post({
      grant: 'code',
      code,
      code_verifier: pending.verifier,
      redirect_uri: redirectUri(),
    });
    const saved = saveTokens(tok);
    const email = await fetchEmail(saved.accessToken).catch(() => '');
    store.setGoogle({ ...saved, email });
    return { connected: true, email };
  } catch (e) {
    return { connected: false, error: e.message };
  }
}

function googleDenied(code) {
  if (code === 'access_denied') return '구글 연결을 취소하셨습니다.';
  return `구글 인증이 실패했습니다 (${code}).`;
}

function saveTokens(tok) {
  const prev = store.getGoogle();
  return {
    accessToken: tok.access_token || '',
    refreshToken: tok.refresh_token || prev.refreshToken || '',
    expiresAt: Date.now() + (Number(tok.expires_in) || 3000) * 1000 - 60_000,
    scope: tok.scope || prev.scope || '',
  };
}

async function post(payload) {
  const res = await fetch('/api/google/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(store.getSettings().accessCode ? { 'x-access-code': store.getSettings().accessCode } : {}),
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `구글 인증 오류 (${res.status})`);
  return data;
}

/**
 * 지금 쓸 수 있는 액세스 토큰. 만료가 가까우면 조용히 갱신한다.
 * @returns {Promise<{accessToken:string, email:string}|null>}
 */
export async function activeToken() {
  const g = store.getGoogle();
  if (!g.refreshToken && !g.accessToken) return null;

  if (g.accessToken && Date.now() < (g.expiresAt || 0)) {
    return { accessToken: g.accessToken, email: g.email || '' };
  }
  if (!g.refreshToken) {
    store.setGoogle({});
    return null;
  }

  try {
    const tok = await post({ grant: 'refresh', refresh_token: g.refreshToken });
    const saved = saveTokens(tok);
    store.setGoogle({ ...saved, email: g.email || '' });
    return { accessToken: saved.accessToken, email: g.email || '' };
  } catch (e) {
    // 갱신이 안 되면 연결이 끊긴 것이다
    store.setGoogle({});
    throw new Error(e.message || '구글 연결이 만료되었습니다. 다시 연결해 주세요.');
  }
}

export async function disconnect() {
  const g = store.getGoogle();
  const token = g.refreshToken || g.accessToken;
  store.setGoogle({});
  if (token) await post({ grant: 'revoke', token }).catch(() => {});
}

async function fetchEmail(accessToken) {
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return '';
  const d = await r.json();
  return d.emailAddress || '';
}

/** 초안을 실제로 발송한다. 화면의 확인 버튼만 이걸 부른다. */
export async function sendDraft(draftId) {
  const tok = await activeToken();
  if (!tok) throw new Error('구글 연결이 필요합니다.');

  const res = await fetch('/api/google/send', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(store.getSettings().accessCode ? { 'x-access-code': store.getSettings().accessCode } : {}),
    },
    body: JSON.stringify({ accessToken: tok.accessToken, draftId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '메일을 보내지 못했습니다.');
  return data;
}
