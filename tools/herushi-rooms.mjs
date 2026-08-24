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

/** _방.md 첫 문단을 방 설명으로 쓴다 (제목 줄은 뺀다) */
function noteOf(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim());
  for (const l of lines) {
    if (!l || l.startsWith('#')) continue;
    return l.slice(0, 120);
  }
  return '';
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
      found.push({
        id: roomId(home, dir),
        name: basename(dir),
        dir,
        note: noteOf(text),
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
    return { id: CHIEF, name: '실장님 방', dir: home, note: '', done: false, chief: true };
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
