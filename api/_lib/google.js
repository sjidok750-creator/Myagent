/**
 * 캘린더·지메일 도구.
 *
 * 액세스 토큰은 기기가 보관하고 요청마다 실어 보낸다. 서버는 그 토큰으로
 * 구글 API 를 대신 호출할 뿐 아무것도 저장하지 않는다.
 *
 * 메일 발송은 여기서 하지 않는다. 헤뤼싀는 초안까지만 만들고,
 * 실제 발송은 대표님이 화면에서 확인 버튼을 누를 때 이뤄진다.
 */

const CAL = 'https://www.googleapis.com/calendar/v3';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TZ = 'Asia/Seoul';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'openid',
  'email',
];

export const CALENDAR_TOOLS = [
  {
    name: 'calendar_list',
    description:
      '대표님 구글 캘린더에서 일정을 가져온다. 오늘 일정, 이번 주 일정, 특정 기간의 일정을 볼 때 쓴다. ' +
      '일정을 잡기 전에는 반드시 이걸로 빈 시간을 먼저 확인한다.',
    input_schema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: '조회 시작. ISO 8601 (2026-08-22T00:00:00+09:00). 생략하면 지금부터.' },
        end: { type: 'string', description: '조회 끝. ISO 8601. 생략하면 시작으로부터 7일.' },
        query: { type: 'string', description: '제목·설명에서 찾을 말 (선택)' },
        limit: { type: 'integer', description: '최대 개수 (기본 25)' },
      },
    },
  },
  {
    name: 'calendar_create',
    description:
      '구글 캘린더에 일정을 실제로 만든다. 만들기 전에 calendar_list 로 겹치는 일정이 없는지 확인한다. ' +
      '참석자를 넣으면 구글이 초대 메일을 보낸다 — 대표님이 참석자를 명시하지 않았다면 넣지 않는다.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '일정 제목' },
        start: { type: 'string', description: '시작. ISO 8601. 종일 일정이면 YYYY-MM-DD.' },
        end: { type: 'string', description: '끝. ISO 8601. 생략하면 시작 +1시간.' },
        description: { type: 'string', description: '설명 (선택)' },
        location: { type: 'string', description: '장소 (선택)' },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: '참석자 이메일. 대표님이 명시했을 때만 넣는다.',
        },
      },
      required: ['summary', 'start'],
    },
  },
  {
    name: 'calendar_update',
    description: '이미 있는 일정을 고친다. calendar_list 가 준 id 를 쓴다.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '일정 id' },
        summary: { type: 'string' },
        start: { type: 'string', description: 'ISO 8601' },
        end: { type: 'string', description: 'ISO 8601' },
        description: { type: 'string' },
        location: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'calendar_delete',
    description:
      '일정을 지운다. 되돌릴 수 없으므로 대표님이 분명히 지우라고 했을 때만 쓴다. ' +
      '애매하면 지우지 말고 먼저 확인한다.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: '일정 id' } },
      required: ['id'],
    },
  },
];

export const GMAIL_TOOLS = [
  {
    name: 'gmail_search',
    description:
      '대표님 지메일을 검색한다. 구글 검색 문법을 그대로 쓴다 ' +
      '(예: from:kim@abc.com, is:unread, newer_than:7d, subject:계약). ' +
      '제목·보낸사람·미리보기만 돌려준다. 본문이 필요하면 gmail_read 를 쓴다.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '지메일 검색어' },
        limit: { type: 'integer', description: '최대 개수 (기본 10, 최대 25)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'gmail_read',
    description: 'gmail_search 가 준 id 로 메일 본문을 읽는다.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: '메일 id' } },
      required: ['id'],
    },
  },
  {
    name: 'gmail_draft',
    description:
      '지메일에 보낼 메일 초안을 만든다. 초안은 만들어질 뿐 발송되지 않는다. ' +
      '대표님이 대화창에서 "보내기" 를 눌러야 나간다. ' +
      '초안을 만들었으면 무엇을 누구에게 쓰는 메일인지 한 줄로 알린다.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: '받는 사람. 쉼표로 여럿.' },
        subject: { type: 'string', description: '제목' },
        body: { type: 'string', description: '본문. 서명까지 완성된 형태로 쓴다.' },
        cc: { type: 'string', description: '참조 (선택)' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
];

export const GOOGLE_TOOL_NAMES = new Set(
  [...CALENDAR_TOOLS, ...GMAIL_TOOLS].map((t) => t.name)
);

/* ------------------------------------------------------------------ */

class GoogleError extends Error {}

async function api(token, url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });

  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data?.error?.message || `구글 API 오류 (${res.status})`;
    if (res.status === 401) throw new GoogleError('구글 연결이 만료되었습니다. 설정에서 다시 연결해 주세요.');
    if (res.status === 403) {
      throw new GoogleError(`구글이 거부했습니다: ${msg}. 연결할 때 권한을 모두 허용했는지 확인해 주세요.`);
    }
    if (res.status === 404) throw new GoogleError('그 항목을 찾을 수 없습니다. id 가 맞는지 확인해 주세요.');
    throw new GoogleError(msg);
  }
  return data;
}

/**
 * @returns {Promise<{ok:boolean, text:string, draft?:object}>}
 */
export async function runGoogleTool(name, input, token) {
  const i = input && typeof input === 'object' ? input : {};
  if (!token) {
    return {
      ok: false,
      text: '구글 계정이 연결되어 있지 않습니다. 대표님께 설정 화면에서 구글 연결을 부탁드리세요.',
    };
  }

  try {
    switch (name) {
      case 'calendar_list': return await calendarList(i, token);
      case 'calendar_create': return await calendarCreate(i, token);
      case 'calendar_update': return await calendarUpdate(i, token);
      case 'calendar_delete': return await calendarDelete(i, token);
      case 'gmail_search': return await gmailSearch(i, token);
      case 'gmail_read': return await gmailRead(i, token);
      case 'gmail_draft': return await gmailDraft(i, token);
      default: return { ok: false, text: `모르는 도구입니다: ${name}` };
    }
  } catch (err) {
    if (err instanceof GoogleError) return { ok: false, text: err.message };
    console.error('[herushi] google tool', name, err?.message);
    return { ok: false, text: '구글에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  }
}

/* ---------------- 캘린더 ---------------- */

async function calendarList(i, token) {
  const now = new Date();
  const timeMin = isoOr(i.start, now);
  const timeMax = isoOr(i.end, new Date(new Date(timeMin).getTime() + 7 * 86400000));

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(clampInt(i.limit, 25, 1, 50)),
    timeZone: TZ,
  });
  if (i.query) params.set('q', String(i.query).slice(0, 200));

  const data = await api(token, `${CAL}/calendars/primary/events?${params}`);
  const items = data.items || [];
  if (!items.length) return { ok: true, text: '그 기간에는 일정이 없습니다.' };

  return {
    ok: true,
    text: items.map(describeEvent).join('\n'),
  };
}

async function calendarCreate(i, token) {
  const summary = String(i.summary || '').slice(0, 300);
  if (!summary) return { ok: false, text: '일정 제목이 필요합니다.' };
  if (!i.start) return { ok: false, text: '시작 시각이 필요합니다.' };

  const body = { summary, ...timeFields(i.start, i.end) };
  if (i.description) body.description = String(i.description).slice(0, 4000);
  if (i.location) body.location = String(i.location).slice(0, 300);

  const attendees = (Array.isArray(i.attendees) ? i.attendees : [])
    .map((e) => String(e).trim())
    .filter((e) => e.includes('@'))
    .slice(0, 20);
  if (attendees.length) body.attendees = attendees.map((email) => ({ email }));

  const params = attendees.length ? '?sendUpdates=all' : '';
  const ev = await api(token, `${CAL}/calendars/primary/events${params}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return {
    ok: true,
    text:
      `일정을 만들었습니다.\n${describeEvent(ev)}` +
      (attendees.length ? `\n초대 메일이 ${attendees.join(', ')} 로 나갔습니다.` : ''),
  };
}

async function calendarUpdate(i, token) {
  const id = String(i.id || '').trim();
  if (!id) return { ok: false, text: '일정 id 가 필요합니다.' };

  const patch = {};
  if (i.summary) patch.summary = String(i.summary).slice(0, 300);
  if (i.description) patch.description = String(i.description).slice(0, 4000);
  if (i.location) patch.location = String(i.location).slice(0, 300);
  if (i.start || i.end) Object.assign(patch, timeFields(i.start, i.end));
  if (!Object.keys(patch).length) return { ok: false, text: '고칠 내용이 없습니다.' };

  const ev = await api(token, `${CAL}/calendars/primary/events/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return { ok: true, text: `일정을 고쳤습니다.\n${describeEvent(ev)}` };
}

async function calendarDelete(i, token) {
  const id = String(i.id || '').trim();
  if (!id) return { ok: false, text: '일정 id 가 필요합니다.' };
  await api(token, `${CAL}/calendars/primary/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { ok: true, text: '일정을 지웠습니다.' };
}

function timeFields(start, end) {
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(String(start || ''));
  if (allDay) {
    const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(end || '')) ? end : nextDay(start);
    return { start: { date: start }, end: { date: endDate } };
  }
  const s = new Date(start);
  const e = end ? new Date(end) : new Date(s.getTime() + 3600000);
  return {
    start: { dateTime: s.toISOString(), timeZone: TZ },
    end: { dateTime: e.toISOString(), timeZone: TZ },
  };
}

function nextDay(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function describeEvent(ev) {
  const when = ev.start?.date
    ? `${ev.start.date} (종일)`
    : `${fmt(ev.start?.dateTime)} ~ ${fmt(ev.end?.dateTime, true)}`;
  const bits = [`[${ev.id}] ${ev.summary || '(제목 없음)'} · ${when}`];
  if (ev.location) bits.push(`  장소: ${ev.location}`);
  const guests = (ev.attendees || []).map((a) => a.email).filter(Boolean);
  if (guests.length) bits.push(`  참석: ${guests.slice(0, 8).join(', ')}`);
  return bits.join('\n');
}

function fmt(iso, timeOnly = false) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Intl.DateTimeFormat('ko-KR', {
    ...(timeOnly ? {} : { month: 'numeric', day: 'numeric', weekday: 'short' }),
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: TZ,
  }).format(d);
}

/* ---------------- 지메일 ---------------- */

async function gmailSearch(i, token) {
  const q = String(i.query || '').slice(0, 300);
  if (!q) return { ok: false, text: '검색어가 필요합니다.' };

  const params = new URLSearchParams({ q, maxResults: String(clampInt(i.limit, 10, 1, 25)) });
  const list = await api(token, `${GMAIL}/messages?${params}`);
  const ids = (list.messages || []).map((m) => m.id);
  if (!ids.length) return { ok: true, text: `"${q}" 에 맞는 메일이 없습니다.` };

  const rows = [];
  for (const id of ids) {
    const m = await api(
      token,
      `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`
    );
    const h = headerMap(m.payload?.headers);
    rows.push(
      `[${id}] ${h.subject || '(제목 없음)'}\n  보낸이: ${h.from || '?'} · ${h.date || ''}\n  ${(m.snippet || '').slice(0, 160)}`
    );
  }
  return { ok: true, text: rows.join('\n\n') };
}

async function gmailRead(i, token) {
  const id = String(i.id || '').trim();
  if (!id) return { ok: false, text: '메일 id 가 필요합니다.' };

  const m = await api(token, `${GMAIL}/messages/${encodeURIComponent(id)}?format=full`);
  const h = headerMap(m.payload?.headers);
  const body = extractBody(m.payload).slice(0, 12000);

  return {
    ok: true,
    text:
      `제목: ${h.subject || '(제목 없음)'}\n보낸이: ${h.from || '?'}\n받는이: ${h.to || '?'}\n날짜: ${h.date || ''}\n\n${body || '(본문을 읽지 못했습니다)'}`,
  };
}

async function gmailDraft(i, token) {
  const to = String(i.to || '').trim();
  const subject = String(i.subject || '').trim();
  const bodyText = String(i.body || '');
  if (!to || !subject || !bodyText) {
    return { ok: false, text: '받는 사람·제목·본문이 모두 필요합니다.' };
  }

  const raw = buildMime({ to, cc: String(i.cc || '').trim(), subject, body: bodyText });
  const draft = await api(token, `${GMAIL}/drafts`, {
    method: 'POST',
    body: JSON.stringify({ message: { raw } }),
  });

  return {
    ok: true,
    text:
      `초안을 만들었습니다. 아직 보내지 않았습니다.\n` +
      `받는이: ${to}\n제목: ${subject}\n` +
      `대표님이 대화창의 "보내기" 를 누르면 발송됩니다.`,
    draft: { id: draft.id, to, cc: String(i.cc || '').trim(), subject, body: bodyText },
  };
}

function headerMap(headers) {
  const out = {};
  for (const h of headers || []) out[String(h.name).toLowerCase()] = h.value;
  return out;
}

function extractBody(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return decodeB64Url(part.body.data);
  if (part.parts) {
    for (const p of part.parts) {
      const t = extractBody(p);
      if (t) return t;
    }
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return decodeB64Url(part.body.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  }
  return '';
}

function decodeB64Url(s) {
  try {
    return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

/** 한글 제목·본문이 깨지지 않도록 RFC 2047 / base64 로 감싼다. */
export function buildMime({ to, cc, subject, body }) {
  const lines = [
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** 실제 발송 — 화면에서 대표님이 확인 버튼을 눌렀을 때만 호출된다. */
export async function sendDraft(token, draftId) {
  return api(token, `${GMAIL}/drafts/send`, {
    method: 'POST',
    body: JSON.stringify({ id: draftId }),
  });
}

export async function whoAmI(token) {
  const data = await api(token, `${GMAIL}/profile`);
  return data.emailAddress || '';
}

function isoOr(v, fallback) {
  const d = v ? new Date(v) : fallback;
  return Number.isNaN(d.getTime()) ? fallback.toISOString() : d.toISOString();
}
function clampInt(v, def, min, max) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}
