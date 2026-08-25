/**
 * 과업 방.
 *
 * 방은 등록 장부가 아니라 **파일 하나**로 존재한다.
 *
 *   D:\2026년 과업\D. 숙골교등 6개소\_방.md      ← 이게 있으면 방이 있다
 *   D:\2026년 과업\D. 숙골교등 6개소\_방.완료.md  ← 완료. 목록에서 내려간다
 *
 * 헤뤼싀가 Write 로 만들고 이름을 바꾼다. 새 장치가 필요 없고, 탐색기에서
 * 사람 눈으로도 어느 과업이 돌아가는 중인지 보인다.
 *
 * 지우지 않고 이름만 바꾸는 이유: 방을 지우면 폰에 쌓인 그 대화도 같이
 * 사라진다. 두 달 뒤 발주처가 "그때 왜 C등급이었나" 물으면 늦다.
 */

import { readdir, readFile, stat, rename } from 'node:fs/promises';
import { join, relative, basename } from 'node:path';
import { createHash } from 'node:crypto';

export const ROOM_FILE = '_방.md';
export const DONE_FILE = '_방.완료.md';

/** 실장님 방 — 항상 있고, 작업 폴더 전체를 본다 */
export const CHIEF = 'chief';

const SKIP = new Set([
  'node_modules', '$recycle.bin', 'system volume information', 'windows',
  'program files', 'program files (x86)', 'programdata', 'appdata',
  'recovery', 'perflogs', '받은파일', '_헤뤼싀일지',
]);
const MAX_DEPTH = 3;      // D:\2026년 과업\D. 숙골교등 6개소\  까지
const SCAN_CAP = 3000;    // 훑을 폴더 수 상한

/** 폴더 경로 하나에 방 id 하나. 경로가 그대로면 id 도 그대로다. */
export function roomId(home, dir) {
  const rel = relative(home, dir).replace(/\\/g, '/').toLowerCase();
  return 'p' + createHash('sha1').update(rel).digest('hex').slice(0, 8);
}

/** _방.md 첫 문단을 방 설명으로 쓴다 (제목 줄과 담당 줄은 뺀다) */
function noteOf(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim());
  for (const l of lines) {
    if (!l || l.startsWith('#') || /^담당\s*:/.test(l)) continue;
    return l.slice(0, 120);
  }
  return '';
}

/* 이 방을 맡은 사람.
 *
 * 헤뤼싀가 뽑아 온 사람들이라 헤뤼싀와 같은 인도 출신이다. 부서 팀장으로
 * 이미 쓰고 있는 이름(프리야·디비야 등)은 넣지 않는다 — 같은 사람이
 * 두 군데 있으면 이상하다.
 */
const STAFF = [
  { name: '아난야', romanized: 'Ananya Rao', tint: '#0a84ff' },
  { name: '카비야', romanized: 'Kavya Menon', tint: '#30d158' },
  { name: '리아', romanized: 'Riya Nair', tint: '#ff9f0a' },
  { name: '니키타', romanized: 'Nikita Bose', tint: '#bf5af2' },
  { name: '이샤', romanized: 'Isha Kulkarni', tint: '#ff453a' },
  { name: '메가', romanized: 'Megha Iyer', tint: '#64d2ff' },
  { name: '아르준', romanized: 'Arjun Desai', tint: '#5e5ce6' },
  { name: '로힛', romanized: 'Rohit Verma', tint: '#ac8e68' },
  { name: '산제이', romanized: 'Sanjay Pillai', tint: '#ff375f' },
  { name: '니샤', romanized: 'Nisha Chandra', tint: '#40c8e0' },
];

const DEFAULT_ROLE = '과업 책임';

/**
 * _방.md 의 `담당: 이름 · 직책` 줄을 읽는다.
 * 없으면 방 id 에서 정한다 — 폴더 경로가 그대로면 사람도 그대로다.
 */
function staffOf(text, id) {
  const line = String(text || '').split('\n').map((l) => l.trim())
    .find((l) => /^담당\s*:/.test(l));
  if (line) {
    const body = line.replace(/^담당\s*:/, '').trim();
    // "아난야 · 과업 책임" / "아난야 - 과업 책임" / "아난야"
    const [rawName, ...rest] = body.split(/\s*[·\-—|]\s*/);
    const name = (rawName || '').trim();
    if (name) {
      const known = STAFF.find((p) => p.name === name);
      return {
        lead: name,
        leadRomanized: known ? known.romanized : '',
        role: rest.join(' ').trim() || DEFAULT_ROLE,
        tint: known ? known.tint : pickStaff(id).tint,
      };
    }
  }
  const p = pickStaff(id);
  return { lead: p.name, leadRomanized: p.romanized, role: DEFAULT_ROLE, tint: p.tint };
}

/** 헤뤼싀에게 알려 줄, 쓸 수 있는 사람 이름들 */
export function staffNames() {
  return STAFF.map((p) => p.name);
}

/** 방 id 는 경로의 해시다. 그 앞자리를 그대로 쓰면 늘 같은 사람이 나온다. */
function pickStaff(id) {
  const n = parseInt(String(id).replace(/^p/, '').slice(0, 6), 16);
  return STAFF[(Number.isFinite(n) ? n : 0) % STAFF.length];
}

/**
 * 작업 폴더 아래에서 방을 찾는다.
 * @returns {Promise<Array<{id,name,dir,note,at,done}>>} 최근 것부터
 */
export async function scanRooms(home, { includeDone = false } = {}) {
  const found = [];
  let visited = 0;

  async function walk(dir, depth) {
    if (depth > MAX_DEPTH || visited > SCAN_CAP) return;
    visited += 1;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const names = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
    const isRoom = names.has(ROOM_FILE);
    const isDone = !isRoom && names.has(DONE_FILE);

    if (isRoom || (isDone && includeDone)) {
      const file = join(dir, isRoom ? ROOM_FILE : DONE_FILE);
      const [text, st] = await Promise.all([
        readFile(file, 'utf8').catch(() => ''),
        stat(file).catch(() => null),
      ]);
      const id = roomId(home, dir);
      found.push({
        id,
        name: basename(dir),
        dir,
        note: noteOf(text),
        ...staffOf(text, id),
        at: st ? st.mtimeMs : 0,
        done: !isRoom,
      });
      return;   // 방 안쪽은 더 훑지 않는다 — 방 안의 방은 없다
    }

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.') || e.name.startsWith('$')) continue;
      if (SKIP.has(e.name.toLowerCase())) continue;
      await walk(join(dir, e.name), depth + 1);
    }
  }

  await walk(home, 0);
  return found.sort((a, b) => b.at - a.at);
}

/** id 로 방을 찾는다. 실장님 방은 작업 폴더 자체다. */
export async function findRoom(home, id) {
  if (!id || id === CHIEF) {
    return {
      id: CHIEF, name: '실장님 방', dir: home, note: '', done: false, chief: true,
      lead: '헤뤼싀', leadRomanized: 'Harshi', role: '비서실장', tint: '#c2185b',
    };
  }
  const rooms = await scanRooms(home, { includeDone: true });
  return rooms.find((r) => r.id === id) || null;
}

/** 방을 완료 처리한다(이름만 바꾼다). 되돌리려면 back=true. */
export async function markDone(dir, done = true) {
  const from = join(dir, done ? ROOM_FILE : DONE_FILE);
  const to = join(dir, done ? DONE_FILE : ROOM_FILE);
  await rename(from, to);
  return to;
}
