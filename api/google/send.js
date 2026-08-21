/**
 * 메일 발송 — 대표님이 대화창에서 "보내기" 를 눌렀을 때만 호출된다.
 *
 * 헤뤼싀는 초안까지만 만든다. 이 엔드포인트는 모델이 부를 수 없고,
 * 화면의 버튼만 부를 수 있다. 사람의 확인 없이 메일이 나가는 일은 없다.
 */

import { sendDraft } from '../_lib/google.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST 만 지원합니다.' });
  }

  const required = process.env.ACCESS_CODE;
  if (required && req.headers['x-access-code'] !== required) {
    return res.status(401).json({ error: '접속 코드가 맞지 않습니다.' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: '요청 본문을 읽을 수 없습니다.' });
  }

  const token = typeof body.accessToken === 'string' ? body.accessToken : '';
  const draftId = typeof body.draftId === 'string' ? body.draftId : '';
  if (!token) return res.status(400).json({ error: '구글 연결이 필요합니다.' });
  if (!draftId) return res.status(400).json({ error: '보낼 초안이 없습니다.' });

  try {
    const sent = await sendDraft(token, draftId);
    return res.status(200).json({ ok: true, id: sent?.id || draftId });
  } catch (err) {
    console.error('[herushi] 메일 발송 실패', err?.message);
    return res.status(502).json({ error: err?.message || '메일을 보내지 못했습니다.' });
  }
}
