/**
 * 웹 푸시 발송과 구독 저장.
 *
 * 저장되는 것은 이것뿐이다:
 *  - 푸시 구독 (브라우저가 준 주소와 암호화 키)
 *  - 알림 시각과 시간대
 *  - 대표님이 켠 경우에만: 자료실의 할 일 스냅샷 / 구글 리프레시 토큰
 *
 * 대화 내용은 절대 저장하지 않는다.
 */

import webpush from 'web-push';
import { kvGet, kvSet, kvDel, kvSAdd, kvSRem, kvSMembers, kvConfigured } from './kv.js';

const SET_KEY = 'herushi:subs';
const KEY = (id) => `herushi:sub:${id}`;

export { kvConfigured };

export function vapidConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function pushReady() {
  return kvConfigured() && vapidConfigured();
}

export function vapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || '';
}

function configureVapid() {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:herushi@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

/** 구독 주소로 안정적인 id 를 만든다 (같은 기기는 늘 같은 id) */
export async function subscriptionId(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Buffer.from(digest).toString('hex').slice(0, 32);
}

export async function saveSubscription(record) {
  const id = await subscriptionId(record.subscription.endpoint);
  await kvSet(KEY(id), { ...record, id, updatedAt: Date.now() });
  await kvSAdd(SET_KEY, id);
  return id;
}

export async function removeSubscription(endpoint) {
  const id = await subscriptionId(endpoint);
  await kvDel(KEY(id));
  await kvSRem(SET_KEY, id);
  return id;
}

export async function getSubscription(id) {
  return kvGet(KEY(id));
}

export async function allSubscriptions() {
  const ids = await kvSMembers(SET_KEY);
  const out = [];
  for (const id of ids) {
    const rec = await kvGet(KEY(id));
    if (rec) out.push(rec);
    else await kvSRem(SET_KEY, id); // 죽은 항목 정리
  }
  return out;
}

export async function markSent(rec, patch) {
  await kvSet(KEY(rec.id), { ...rec, ...patch, updatedAt: Date.now() });
}

/**
 * 알림을 보낸다. 구독이 죽었으면 지운다.
 * @returns {Promise<{ok:boolean, gone?:boolean, error?:string}>}
 */
export async function sendPush(rec, payload) {
  configureVapid();
  try {
    await webpush.sendNotification(rec.subscription, JSON.stringify(payload), {
      TTL: 3600,
      urgency: 'normal',
    });
    return { ok: true };
  } catch (err) {
    const status = err?.statusCode;
    if (status === 404 || status === 410) {
      // 브라우저가 구독을 폐기했다
      await kvDel(KEY(rec.id));
      await kvSRem(SET_KEY, rec.id);
      return { ok: false, gone: true };
    }
    return { ok: false, error: err?.body || err?.message || '푸시 발송 실패' };
  }
}

/**
 * 지금 이 구독에 브리핑을 보낼 때인지 판단한다.
 * 크론이 몇 분 늦게 돌아도 하루 한 번만 나가도록 마지막 발송일을 본다.
 */
export function isDue(rec, now = new Date()) {
  if (!rec?.enabled || !rec.subscription) return false;

  const tz = rec.timeZone || 'Asia/Seoul';
  const local = localParts(now, tz);
  if (!local) return false;

  // 주말 제외 옵션
  if (rec.weekdaysOnly && (local.weekday === 0 || local.weekday === 6)) return false;

  const [h, m] = String(rec.time || '08:00').split(':').map((n) => parseInt(n, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false;

  const target = h * 60 + m;
  const nowMin = local.hour * 60 + local.minute;

  // 예약 시각을 지났고, 오늘 아직 안 보냈으면 보낸다.
  // 90분이 지나도록 크론이 못 돌았다면 그날은 거른다 (한밤중에 아침 인사를 하지 않는다).
  if (nowMin < target || nowMin - target > 90) return false;
  return rec.lastSentDay !== local.day;
}

/** 특정 시간대의 날짜/시각을 뽑는다 */
export function localParts(date, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
      weekday: 'short',
    });
    const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
    const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      day: `${parts.year}-${parts.month}-${parts.day}`,
      hour: parseInt(parts.hour === '24' ? '0' : parts.hour, 10),
      minute: parseInt(parts.minute, 10),
      weekday: weekdayMap[parts.weekday] ?? 1,
    };
  } catch {
    return null;
  }
}
