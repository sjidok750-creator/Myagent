/** 시간 표기와 말풍선 안 간단한 서식 처리 */

const TZ = 'Asia/Seoul';

const timeFmt = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: true });
const weekdayFmt = new Intl.DateTimeFormat('ko-KR', { weekday: 'long' });
const dateFmt = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
const shortDateFmt = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' });

export function timeOf(ts) {
  return timeFmt.format(new Date(ts));
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function sameDay(a, b) {
  return dayKey(a) === dayKey(b);
}

/** 대화 목록 오른쪽에 뜨는 시간 */
export function listStamp(ts) {
  if (!ts) return '';
  const now = Date.now();
  const d = new Date(ts);
  if (sameDay(ts, now)) return timeFmt.format(d);
  if (sameDay(ts, now - 86400000)) return '어제';
  if (now - ts < 6 * 86400000) return weekdayFmt.format(d).replace('요일', '');
  return shortDateFmt.format(d);
}

/** 대화 안 날짜 구분선 */
export function dayMark(ts) {
  const now = Date.now();
  const d = new Date(ts);
  const t = timeFmt.format(d);
  if (sameDay(ts, now)) return { main: '오늘', time: t };
  if (sameDay(ts, now - 86400000)) return { main: '어제', time: t };
  if (now - ts < 6 * 86400000) return { main: weekdayFmt.format(d), time: t };
  return { main: dateFmt.format(d), time: t };
}

const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => escapeMap[c]);
}

/**
 * 말풍선용 최소 서식.
 * 메신저 화면이라 헤딩·표는 지원하지 않는다. 굵게 / 인라인코드 / 불릿 / 링크만.
 */
export function richText(raw) {
  const lines = String(raw ?? '').split('\n');
  let out = '';
  let prevWasBlock = false;

  lines.forEach((line, i) => {
    const bullet = line.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/);
    const body = bullet ? bullet[2] : line;
    let html = esc(body);

    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    html = html.replace(
      /(https?:\/\/[^\s<]+[^\s<.,;:!?)"'])/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    if (bullet) {
      const marker = /^\d/.test(bullet[1]) ? esc(bullet[1]) : '•';
      html = `<span class="li">${marker} ${html}</span>`;
    }

    // .li 는 블록이라 스스로 줄을 바꾼다. 앞에 줄바꿈을 또 넣으면 빈 줄이 생긴다.
    if (i > 0 && !prevWasBlock) out += '\n';
    out += html;
    prevWasBlock = !!bullet;
  });

  return out;
}

/** 대화 목록 미리보기용 — 서식 기호를 걷어낸 순수 텍스트 */
export function plain(raw, limit = 120) {
  const t = String(raw ?? '')
    .replace(/\[\[dept:[^\]]*\]\]/gi, '')
    .replace(/[`*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > limit ? t.slice(0, limit) + '…' : t;
}
