/**
 * 헤뤼싀가 먼저 말을 걸게 하기.
 *
 * 아이폰에서는 **홈 화면에 추가한 뒤** 열어야 알림을 켤 수 있다 (iOS 16.4 이상).
 * 사파리 탭에서는 권한 요청 자체가 불가능하다.
 *
 * 서버에 저장되는 것은 푸시 구독과 알림 설정뿐이다. 대화 내용은 올라가지 않는다.
 * 할 일 목록과 구글 리프레시 토큰은 대표님이 따로 켰을 때만 올라간다.
 */

import * as store from './store.js';

let configPromise = null;

export function pushConfig() {
  configPromise ||= fetch('/api/push/subscribe')
    .then((r) => (r.ok ? r.json() : { enabled: false, publicKey: '', missing: ['서버 응답 없음'] }))
    .catch(() => ({ enabled: false, publicKey: '', missing: ['서버에 연결하지 못했습니다'] }));
  return configPromise;
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** 아이폰 사파리 탭에서는 알림을 켤 수 없다 */
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

export function isIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** 지금 이 기기에서 알림을 켤 수 있는지, 안 되면 왜인지 */
export function readiness() {
  if (!pushSupported()) return { ok: false, why: '이 브라우저는 알림을 지원하지 않습니다.' };
  if (isIOS() && !isStandalone()) {
    return {
      ok: false,
      why: '아이폰에서는 홈 화면에 추가한 뒤 그 아이콘으로 열어야 알림을 켤 수 있습니다.\n공유 버튼 → “홈 화면에 추가”',
    };
  }
  if (Notification.permission === 'denied') {
    return { ok: false, why: '알림이 차단되어 있습니다. 설정 → 알림에서 허용해 주세요.' };
  }
  return { ok: true };
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg || navigator.serviceWorker.register('./sw.js');
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

/**
 * 알림을 켠다. 권한 요청은 반드시 사용자가 누른 직후에 불러야 한다.
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function enable(options = {}) {
  const ready = readiness();
  if (!ready.ok) return { ok: false, error: ready.why };

  const cfg = await pushConfig();
  if (!cfg.enabled) {
    return {
      ok: false,
      error:
        '이 배포에는 알림이 설정되어 있지 않습니다.\n필요한 것: ' +
        (cfg.missing || []).join(', '),
    };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, error: '알림 권한이 허용되지 않았습니다.' };
  }

  const reg = await registration();
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cfg.publicKey),
    });
  }

  store.updateSettings({ pushEnabled: true });
  return sync({ subscription: sub, ...options });
}

/** 알림 설정을 서버에 다시 올린다 (시각 변경, 할 일 공유 토글 등) */
export async function sync(options = {}) {
  const s = store.getSettings();
  if (!s.pushEnabled) return { ok: true };

  const sub = options.subscription || (await currentSubscription());
  if (!sub) return { ok: false, error: '구독 정보가 없습니다. 알림을 다시 켜 주세요.' };

  const body = {
    subscription: sub.toJSON ? sub.toJSON() : sub,
    enabled: true,
    time: s.pushTime || '08:00',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul',
    weekdaysOnly: !!s.pushWeekdaysOnly,
    honorific: s.honorific || '대표님',
    ownerName: s.ownerName || '',
    ownerNote: s.ownerNote || '',
  };

  // 대표님이 켰을 때만 보낸다
  if (s.pushShareTasks) {
    body.tasks = store
      .getWorkspace()
      .tasks.filter((t) => !t.done)
      .slice(0, 40)
      .map((t) => ({ title: t.title, due: t.due, owner: t.owner }));
  }
  if (s.pushShareCalendar) {
    const g = store.getGoogle();
    if (g.refreshToken) body.googleRefreshToken = g.refreshToken;
  }

  return post('/api/push/subscribe', 'POST', body);
}

export async function disable() {
  const sub = await currentSubscription();
  store.updateSettings({ pushEnabled: false });

  if (sub) {
    await post('/api/push/subscribe', 'DELETE', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return { ok: true };
}

export async function sendTest() {
  const sub = await currentSubscription();
  if (!sub) return { ok: false, error: '알림이 켜져 있지 않습니다.' };
  return post('/api/push/test', 'POST', { endpoint: sub.endpoint });
}

async function post(url, method, body) {
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(store.getSettings().accessCode ? { 'x-access-code': store.getSettings().accessCode } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `요청 실패 (${res.status})` };
    return { ok: true, ...data };
  } catch {
    return { ok: false, error: '서버에 연결하지 못했습니다.' };
  }
}
