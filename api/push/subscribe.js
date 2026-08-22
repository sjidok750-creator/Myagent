/**
 * 푸시 구독 등록·해제.
 *
 *   GET    → 이 배포에서 알림이 가능한지, VAPID 공개키
 *   POST   → 구독과 알림 설정 저장
 *   DELETE → 구독 삭제
 */

import {
  pushReady,
  vapidPublicKey,
  saveSubscription,
  removeSubscription,
  kvConfigured,
  vapidConfigured,
} from '../_lib/push.js';

const MAX_TASKS = 40;

export default async function handler(req, res) {
  const required = process.env.ACCESS_CODE;
  if (required && req.method !== 'GET' && req.headers['x-access-code'] !== required) {
    return res.status(401).json({ error: '접속 코드가 맞지 않습니다.' });
  }

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      enabled: pushReady(),
      publicKey: vapidPublicKey(),
      missing: [
        ...(kvConfigured() ? [] : ['저장소(KV_REST_API_URL / KV_REST_API_TOKEN)']),
        ...(vapidConfigured() ? [] : ['VAPID 키(VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)']),
      ],
    });
  }

  if (!pushReady()) {
    return res.status(503).json({
      error: '이 배포에는 알림이 설정되어 있지 않습니다. README 의 “먼저 말 걸게 하기” 를 따라 주세요.',
    });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: '요청 본문을 읽을 수 없습니다.' });
  }

  if (req.method === 'DELETE') {
    const endpoint = body?.endpoint || body?.subscription?.endpoint;
    if (!endpoint) return res.status(400).json({ error: '구독 주소가 없습니다.' });
    try {
      await removeSubscription(String(endpoint));
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[herushi] 구독 해제 실패', err?.message);
      return res.status(502).json({ error: '구독을 해제하지 못했습니다.' });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'GET / POST / DELETE 만 지원합니다.' });
  }

  const sub = body.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return res.status(400).json({ error: '구독 정보가 올바르지 않습니다.' });
  }

  const record = {
    subscription: {
      endpoint: String(sub.endpoint).slice(0, 800),
      keys: { p256dh: String(sub.keys.p256dh).slice(0, 200), auth: String(sub.keys.auth).slice(0, 100) },
    },
    enabled: body.enabled !== false,
    time: /^\d{2}:\d{2}$/.test(body.time) ? body.time : '08:00',
    timeZone: String(body.timeZone || 'Asia/Seoul').slice(0, 60),
    weekdaysOnly: !!body.weekdaysOnly,
    honorific: String(body.honorific || '대표님').slice(0, 20),
    ownerName: String(body.ownerName || '').slice(0, 40),
    ownerNote: String(body.ownerNote || '').slice(0, 1200),

    // 대표님이 켰을 때만 들어온다
    tasks: Array.isArray(body.tasks)
      ? body.tasks.slice(0, MAX_TASKS).map((t) => ({
          title: String(t?.title || '').slice(0, 200),
          due: String(t?.due || '').slice(0, 40),
          owner: String(t?.owner || '').slice(0, 60),
        }))
      : [],
    googleRefreshToken:
      typeof body.googleRefreshToken === 'string' && body.googleRefreshToken
        ? body.googleRefreshToken.slice(0, 512)
        : null,
  };

  try {
    const id = await saveSubscription(record);
    return res.status(200).json({ ok: true, id });
  } catch (err) {
    console.error('[herushi] 구독 저장 실패', err?.message);
    return res.status(502).json({ error: '구독을 저장하지 못했습니다. 저장소 설정을 확인해 주세요.' });
  }
}
