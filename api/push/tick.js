/**
 * 크론이 부르는 곳. 예약 시각이 된 구독에 헤뤼싀의 브리핑을 보낸다.
 *
 * vercel.json 의 crons 가 주기적으로 여기를 친다.
 * CRON_SECRET 을 설정해 두면 그 토큰이 있는 요청만 받는다.
 */

import { allSubscriptions, isDue, sendPush, markSent, localParts, pushReady } from '../_lib/push.js';
import { makeBrief } from '../_lib/brief.js';

const MAX_PER_TICK = 25;

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: '인증되지 않은 요청입니다.' });
    }
  }

  if (!pushReady()) {
    return res.status(503).json({ error: '알림이 설정되지 않았습니다.' });
  }

  const now = new Date();
  const report = { checked: 0, sent: 0, skipped: 0, gone: 0, failed: 0 };

  let subs;
  try {
    subs = await allSubscriptions();
  } catch (err) {
    console.error('[herushi] 구독 목록을 읽지 못했습니다', err?.message);
    return res.status(502).json({ error: '저장소를 읽지 못했습니다.' });
  }

  for (const rec of subs.slice(0, MAX_PER_TICK)) {
    report.checked++;
    if (!isDue(rec, now)) {
      report.skipped++;
      continue;
    }

    const day = localParts(now, rec.timeZone || 'Asia/Seoul')?.day;

    try {
      const { text } = await makeBrief(rec);
      if (!text) {
        report.failed++;
        continue;
      }

      const result = await sendPush(rec, {
        title: '헤뤼싀',
        body: preview(text),
        text,
        dept: 'chief',
        at: Date.now(),
      });

      if (result.gone) {
        report.gone++;
        continue;
      }
      if (!result.ok) {
        report.failed++;
        console.error('[herushi] 푸시 실패', result.error);
        continue;
      }

      // 같은 날 두 번 보내지 않도록 표시
      await markSent(rec, { lastSentDay: day });
      report.sent++;
    } catch (err) {
      report.failed++;
      console.error('[herushi] 브리핑 실패', err?.message);
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, at: now.toISOString(), ...report });
}

/** 알림 본문은 짧아야 한다. 첫 문단만 잘라 쓴다. */
function preview(text, limit = 140) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > limit ? flat.slice(0, limit - 1) + '…' : flat;
}
