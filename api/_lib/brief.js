/**
 * 헤뤼싀가 먼저 건네는 아침 브리핑을 만든다.
 *
 * 대화창의 헤뤼싀와 같은 인격을 쓴다 (js/persona.js 를 그대로 가져온다).
 * 저장해 둔 것만 본다: 켜 두신 경우의 할 일 스냅샷과 구글 캘린더.
 */

import Anthropic from '@anthropic-ai/sdk';
import { corePersona, situationBlock } from '../../js/persona.js';

const TZ_FALLBACK = 'Asia/Seoul';

/** 저장된 리프레시 토큰으로 액세스 토큰을 얻는다 */
async function googleAccessToken(refreshToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.access_token || null;
}

/** 오늘 일정을 한 줄씩 */
async function todayEvents(accessToken, timeZone) {
  const now = new Date();
  const end = new Date(now.getTime() + 24 * 3600 * 1000);
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '15',
    timeZone,
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));

  return (data.items || []).map((ev) => {
    if (ev.start?.date) return `${ev.summary || '(제목 없음)'} — 종일`;
    const t = new Intl.DateTimeFormat('ko-KR', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone,
    }).format(new Date(ev.start?.dateTime));
    return `${t} ${ev.summary || '(제목 없음)'}${ev.location ? ` (${ev.location})` : ''}`;
  });
}

/**
 * @param {object} rec  저장된 구독 기록
 * @returns {Promise<{text:string, hadCalendar:boolean}>}
 */
export async function makeBrief(rec) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 가 없습니다.');

  const timeZone = rec.timeZone || TZ_FALLBACK;
  const honorific = rec.honorific || '대표님';

  let events = null;
  if (rec.googleRefreshToken) {
    const token = await googleAccessToken(rec.googleRefreshToken).catch(() => null);
    if (token) events = await todayEvents(token, timeZone).catch(() => null);
  }

  const openTasks = (rec.tasks || []).filter((t) => t.title);

  const facts = [];
  if (events === null) {
    facts.push('- 캘린더는 연결되어 있지 않아 오늘 일정을 알 수 없다. 일정 이야기는 꺼내지 않는다.');
  } else if (!events.length) {
    facts.push('- 오늘 캘린더에 잡힌 일정이 없다.');
  } else {
    facts.push(`- 오늘 일정 ${events.length}건:\n${events.map((e) => `  · ${e}`).join('\n')}`);
  }

  if (!rec.tasks) {
    facts.push('- 자료실 할 일은 공유되지 않았다.');
  } else if (!openTasks.length) {
    facts.push('- 자료실에 미완료 할 일이 없다.');
  } else {
    facts.push(
      `- 미완료 할 일 ${openTasks.length}건:\n` +
        openTasks.slice(0, 15).map((t) => `  · ${t.title} (기한 ${t.due || '미정'}, ${t.owner || honorific})`).join('\n')
    );
  }

  const system =
    corePersona({ honorific, ownerName: rec.ownerName, ownerNote: rec.ownerNote }) +
    situationBlock(new Date()) +
    `

# 지금 하는 일: 아침 브리핑
${honorific}께서 아직 아무 말도 하지 않으셨다. 네가 먼저 말을 거는 것이다.

아래는 네가 지금 알고 있는 전부다.
${facts.join('\n')}

규칙
- 3~5문장. 알림으로 뜨는 짧은 메시지다. 길면 안 읽힌다.
- 첫 문장은 인사 한 마디. 그다음 오늘 가장 중요한 것 하나를 콕 집는다.
- 위에 없는 사실은 절대 지어내지 않는다. 모르는 것은 말하지 않는다.
- 마지막에 오늘 무엇부터 하면 좋을지 한 줄로 제안한다.
- 부서 태그(\`[[dept:...]]\`)는 쓰지 않는다.
- 정말 아무 정보도 없으면, 짧게 안부만 묻고 오늘 챙길 일이 있는지 물어본다.`;

  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: process.env.HERUSHI_MODEL || 'claude-opus-5',
    max_tokens: 700,
    system,
    messages: [{ role: 'user', content: '(아침 브리핑을 시작해 주세요)' }],
    output_config: { effort: 'low' },
  });

  const text = msg.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .replace(/^\s*\[\[dept:[^\]]*\]\]\s*/i, '')
    .trim();

  return { text, hadCalendar: Array.isArray(events) };
}
