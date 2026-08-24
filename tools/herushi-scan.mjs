/**
 * 헤뤼싀 기록 찾기.
 *
 *   npm run herushi:scan          작업 폴더에서 만들어진 대화만
 *   npm run herushi:scan -- 전부   이 컴퓨터의 모든 대화
 *
 * "CLI 에서 헤뤼싀 대화가 안 보인다"를 짐작이 아니라 사실로 답하기 위한 도구다.
 * 이어받기 목록의 제목은 첫 질문에서 자동으로 지어져 구별이 안 되므로,
 * 기록 파일을 직접 읽어 어디서(cwd) 무엇으로(entrypoint) 만들어졌는지 보여준다.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { findRoom } from './herushi-rooms.mjs';

const HOME = process.env.HERUSHI_HOME || join(homedir(), '헤뤼싀비서실');
const CONFIG = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const PROJECTS = join(CONFIG, 'projects');
const ALL = process.argv.slice(2).some((a) => /^(전부|all|--all)$/i.test(a));

/** 윈도우는 대소문자를 가리지 않고, 끝의 \ 가 있기도 없기도 하다. */
const norm = (p) => String(p || '').replace(/[\\/]+$/, '').toLowerCase().replace(/\\/g, '/');

/** 방마다 작업 폴더가 다르다(과업 폴더). 작업 폴더 아래면 전부 "여기 것"이다. */
const underHome = (cwd) => {
  const a = norm(cwd), b = norm(HOME);
  return a === b || a.startsWith(b + '/');
};

const human = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.round(n / 1024) + 'KB');
const when = (d) =>
  `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((b) => b?.type === 'text').map((b) => b.text).join(' ');
  }
  return '';
};

/** 기록 하나를 훑는다. 수십MB 까지 자라므로 한 줄씩 읽는다. */
async function readTranscript(path) {
  const st = await stat(path);
  const info = { path, size: st.size, at: st.mtime, turns: 0, title: '', first: '', cwd: '', entry: '' };
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.type === 'custom-title' && d.customTitle) info.title = d.customTitle;
    if (d.type !== 'user') continue;
    if (!info.cwd) info.cwd = d.cwd || '';
    if (!info.entry) info.entry = d.entrypoint || '';
    // 도구 결과도 type:"user" 로 기록된다. 사람이 실제로 친 것만 센다.
    if (d.isSidechain) continue;
    const said = textOf(d.message?.content).replace(/\s+/g, ' ').trim();
    if (!said) continue;
    info.turns += 1;
    if (!info.first) info.first = said.slice(0, 60);
  }
  return info;
}

async function collect() {
  let dirs;
  try {
    dirs = await readdir(PROJECTS);
  } catch {
    console.error(`\n  기록 폴더를 찾지 못했습니다: ${PROJECTS}\n  (CLAUDE_CONFIG_DIR 를 따로 쓰신다면 그 값을 맞춰 주세요)\n`);
    process.exit(1);
  }
  const out = [];
  for (const d of dirs) {
    let files = [];
    try {
      files = (await readdir(join(PROJECTS, d))).filter((f) => f.endsWith('.jsonl'));
    } catch {}
    for (const f of files) {
      try {
        const info = await readTranscript(join(PROJECTS, d, f));
        info.id = f.replace(/\.jsonl$/, '');
        out.push(info);
      } catch {}
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

/* ------------------------------------------------------------------ */

const sessions = await readFile(join(HOME, '.sessions.json'), 'utf8').then(JSON.parse, () => ({}));
const roomOf = new Map();
for (const [key, id] of Object.entries(sessions)) {
  if (!id) continue;
  const r = await findRoom(HOME, key);
  roomOf.set(id, r ? r.name : `${key} (없어진 방)`);
}

const all = await collect();
const here = all.filter((t) => underHome(t.cwd));
const others = all.filter((t) => !underHome(t.cwd));

console.log(`\n  작업 폴더   ${HOME}`);
console.log(`  기록 폴더   ${PROJECTS}`);
console.log(`  찾은 대화   전체 ${all.length}개 · 작업 폴더에서 만들어진 것 ${here.length}개\n`);

function show(list) {
  for (const t of list) {
    const roomName = roomOf.get(t.id);
    const mark = roomName ? '★' : ' ';
    // -p(브릿지)로 만든 것과 사람이 직접 연 것을 구분한다
    const from = /print|sdk/i.test(t.entry) ? '폰' : t.entry ? '책상' : '?';
    console.log(`  ${mark} ${(t.title || '(제목 없음)').padEnd(24)} ${String(t.turns).padStart(4)}번  ${human(t.size).padStart(7)}  ${when(t.at)}  [${from}]`);
    console.log(`      ${t.id}`);
    if (t.first) console.log(`      첫 질문: ${t.first}`);
    if (roomName) console.log(`      → ${roomName}  ·  헤뤼싀책상.bat 로 이어받습니다`);
    console.log(`      폴더: ${t.cwd}`);
    console.log('');
  }
}

if (here.length) {
  console.log(`  ── ${HOME} 아래에서 만들어진 대화 ──\n`);
  show(here);
} else {
  console.log(`  ⚠ ${HOME} 아래에서 만들어진 대화가 하나도 없습니다.`);
  console.log(`    브릿지가 다른 폴더에서 돌았거나, 기록이 다른 설정 폴더에 있습니다.\n`);
}

if (others.length) {
  if (ALL) {
    console.log(`  ── 다른 폴더에서 만들어진 대화 ──\n`);
    show(others);
  } else {
    console.log(`  다른 폴더에서 만들어진 대화가 ${others.length}개 더 있습니다. 보시려면:`);
    console.log(`     npm run herushi:scan -- 전부\n`);
  }
}

const missing = [...roomOf].filter(([id]) => !all.some((t) => t.id === id));
if (missing.length) {
  console.log(`  ⚠ .sessions.json 에 적힌 세션 중 기록을 못 찾은 것:`);
  for (const [id, name] of missing) console.log(`     ${name}  ${id}`);
  console.log('');
}
