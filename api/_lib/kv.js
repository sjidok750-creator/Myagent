/**
 * 아주 작은 키-값 저장소 어댑터.
 *
 * 헤뤼싀가 먼저 말을 걸려면 기기가 꺼져 있을 때도 서버가 무언가를 알고 있어야 한다.
 * 그래서 여기가 이 앱에서 서버가 **유일하게** 저장을 하는 곳이다.
 * 저장되는 것은 푸시 구독과 대표님이 켜 둔 알림 설정뿐이다. 대화 내용은 들어오지 않는다.
 *
 * Upstash Redis 와 Vercel KV 는 같은 REST 규약을 쓴다. 둘 다 이 어댑터로 붙는다.
 * 별도 패키지 없이 fetch 로만 이야기한다.
 */

const URL_ENV = ['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL'];
const TOKEN_ENV = ['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN'];

function pick(names) {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return '';
}

export function kvConfigured() {
  return !!(pick(URL_ENV) && pick(TOKEN_ENV));
}

async function cmd(...args) {
  const base = pick(URL_ENV);
  const token = pick(TOKEN_ENV);
  if (!base || !token) throw new Error('알림 저장소가 설정되지 않았습니다.');

  const res = await fetch(base.replace(/\/$/, ''), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args.map(String)),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `저장소 오류 (${res.status})`);
  }
  return data.result;
}

export async function kvGet(key) {
  const raw = await cmd('GET', key);
  if (raw == null) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

export async function kvSet(key, value) {
  return cmd('SET', key, JSON.stringify(value));
}

export async function kvDel(key) {
  return cmd('DEL', key);
}

export async function kvSAdd(setKey, member) {
  return cmd('SADD', setKey, member);
}

export async function kvSRem(setKey, member) {
  return cmd('SREM', setKey, member);
}

export async function kvSMembers(setKey) {
  const r = await cmd('SMEMBERS', setKey);
  return Array.isArray(r) ? r : [];
}
