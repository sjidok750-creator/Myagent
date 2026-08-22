/**
 * 지금 바로 시험 알림을 보낸다. 설정 화면의 "시험 알림 보내기" 가 부른다.
 * 예약 시각과 무관하게 한 번만 보내고, lastSentDay 는 건드리지 않는다.
 */

import { subscriptionId, getSubscription, sendPush, pushReady } from '../_lib/push.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST 만 지원합니다.' });
  }

  const required = process.env.ACCESS_CODE;
  if (required && req.headers['x-access-code'] !== required) {
    return res.status(401).json({ error: '접속 코드가 맞지 않습니다.' });
  }
  if (!pushReady()) {
    return res.status(503).json({ error: '이 배포에는 알림이 설정되어 있지 않습니다.' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: '요청 본문을 읽을 수 없습니다.' });
  }

  const endpoint = body?.endpoint;
  if (!endpoint) return res.status(400).json({ error: '구독 주소가 없습니다.' });

  try {
    const rec = await getSubscription(await subscriptionId(String(endpoint)));
    if (!rec) return res.status(404).json({ error: '등록된 구독이 없습니다. 알림을 다시 켜 주세요.' });

    const honorific = rec.honorific || '대표님';
    const result = await sendPush(rec, {
      title: '헤뤼싀',
      body: `${honorific}, 알림이 잘 갑니다. 예약하신 시각에 오늘의 브리핑을 올려드리겠습니다.`,
      text: `${honorific}, 알림 시험입니다. 잘 도착했네요.\n\n예약하신 시각에 오늘 일정과 챙길 일을 정리해서 먼저 올려드리겠습니다. 틱 해(theek hai)?`,
      dept: 'chief',
      at: Date.now(),
      test: true,
    });

    if (result.gone) return res.status(410).json({ error: '구독이 만료되었습니다. 알림을 다시 켜 주세요.' });
    if (!result.ok) return res.status(502).json({ error: result.error || '알림을 보내지 못했습니다.' });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[herushi] 시험 알림 실패', err?.message);
    return res.status(502).json({ error: '알림을 보내지 못했습니다.' });
  }
}
