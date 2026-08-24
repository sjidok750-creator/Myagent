/**
 * 헤뤼싀 책상 이어받기.
 *
 *   npm run herushi:desk            방 목록에서 고른다
 *   npm run herushi:desk -- chief   바로 그 방으로
 *
 * 폰에서 하던 대화를 책상 CLI 로 그대로 이어서 한다. 브릿지가 남겨 둔
 * 세션 ID 와 페르소나를 찾아 `claude --resume` 을 대신 실행해 준다.
 *
 * 여는 동안 그 방에 자물쇠를 건다. 한 세션 파일을 폰과 책상이 동시에
 * 쓰면 기록이 깨지기 때문이다. 창을 닫으면 자물쇠는 풀린다.
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { DEPT_LABELS, deptLabel } from './herushi-depts.mjs';

const HOME = process.env.HERUSHI_HOME || join(homedir(), '헤뤼싀비서실');
const SESSIONS_FILE = join(HOME, '.sessions.json');
const STATE_DIR = join(HOME, '.herushi');
const LOCK_FILE = join(STATE_DIR, 'desk-lock.json');
const personaFile = (dept) => join(STATE_DIR, `persona-${dept}.txt`);

/* 세션 기록이 실제로 어디에 얼마나 쌓였는지 보여준다. 목록에서 제목만 보고
 * 고르면 엉뚱한 세션을 열게 된다 — 실제로 그랬다. 기록 파일의 크기와 시각,
 * 주고받은 횟수를 같이 보여주면 헤뤼싀 방인지 바로 안다.
 * 폴더 이름 규칙(경로를 -로 바꾼 것)에 기대지 않고 파일 이름으로 찾는다. */
const PROJECTS = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');

async function transcriptOf(id) {
  let dirs = [];
  try {
    dirs = await readdir(PROJECTS);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const p = join(PROJECTS, d, `${id}.jsonl`);
    const st = await stat(p).catch(() => null);
    if (!st) continue;
    return { path: p, size: st.size, at: st.mtime, turns: await countTurns(p) };
  }
  return null;
}

/* 주고받은 횟수. 기록이 수십MB 까지 자라므로 통째로 읽지 않고 한 줄씩 센다.
 * 사용자 줄은 {"parentUuid":...,"type":"user",...} 형태라 앞부분만 봐서는 못 찾는다. */
async function countTurns(p) {
  let n = 0;
  try {
    const rl = createInterface({ input: createReadStream(p, 'utf8'), crlfDelay: Infinity });
    for await (const line of rl) if (line.includes('"type":"user"')) n += 1;
  } catch {}
  return n;
}

const human = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.round(n / 1024) + 'KB');
const when = (d) =>
  `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const readJSON = async (p) => {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return {};
  }
};

const alive = (pid) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function setLock(dept, on) {
  const all = await readJSON(LOCK_FILE);
  if (on) all[dept] = { pid: process.pid, at: Date.now() };
  else delete all[dept];
  await mkdir(STATE_DIR, { recursive: true }).catch(() => {});
  await writeFile(LOCK_FILE, JSON.stringify(all, null, 2), 'utf8').catch(() => {});
}

function bail(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */

const sessions = await readJSON(SESSIONS_FILE);
const rooms = Object.entries(sessions).filter(([, id]) => id);

if (!rooms.length) {
  bail(
    `이어받을 대화가 없습니다.\n` +
      `  작업 폴더: ${HOME}\n` +
      `  폰에서 헤뤼싀와 한 번 대화한 뒤에 다시 실행해 주세요.\n` +
      `  (작업 폴더가 다르면 set HERUSHI_HOME=D:\\ 처럼 맞춰 주세요)`
  );
}

let dept = process.argv[2];

if (!dept) {
  const locks = await readJSON(LOCK_FILE);
  console.log('\n  이어받을 방을 고르세요.\n');
  for (const [i, [d, id]] of rooms.entries()) {
    const t = await transcriptOf(id);
    const busy = alive(locks[d]?.pid) ? '  ← 지금 다른 창에서 열려 있음' : '';
    const info = t
      ? `${String(t.turns).padStart(3)}번 주고받음 · ${human(t.size).padStart(6)} · 마지막 ${when(t.at)}`
      : '기록을 찾지 못했습니다';
    console.log(`   ${String(i + 1).padStart(2)}. ${deptLabel(d).padEnd(8)}  ${info}${busy}`);
    console.log(`       ${id}`);
  }
  console.log('');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // 입력이 닫히면(파이프로 돌릴 때) question 은 영원히 안 끝난다 — 같이 기다린다
  const answer = (await Promise.race([
    rl.question('  번호: '),
    new Promise((r) => rl.once('close', () => r(''))),
  ])).trim();
  rl.close();
  if (!answer) bail('고르지 않으셨습니다.');
  const picked = rooms[Number(answer) - 1];
  if (!picked) bail('그런 번호는 없습니다.');
  dept = picked[0];
}

const sessionId = sessions[dept];
if (!sessionId) {
  bail(
    `${deptLabel(dept)}에는 이어받을 대화가 없습니다.\n` +
      `  있는 방: ${rooms.map(([d]) => `${d}(${deptLabel(d)})`).join(', ')}`
  );
}

// 기록이 없으면 claude 가 이어받지 못한다. 이유를 여기서 말해 주는 편이 낫다.
if (!(await transcriptOf(sessionId))) {
  bail(
    `${deptLabel(dept)}의 기록을 찾지 못했습니다 (세션 ${sessionId}).\n` +
      `  기록은 ${PROJECTS} 아래에 남습니다.\n` +
      `  30일이 지나 정리됐거나, 다른 계정·다른 설정 폴더로 대화했을 수 있습니다.`
  );
}

const locks = await readJSON(LOCK_FILE);
if (alive(locks[dept]?.pid)) {
  bail(`${deptLabel(dept)}은 이미 다른 창에서 열려 있습니다. 그 창을 쓰세요.`);
}

const persona = await stat(personaFile(dept)).then(() => personaFile(dept), () => null);
if (!persona) {
  console.log(`\n  ⚠ 페르소나 사본이 없어 성격 없이 붙습니다 (대화 기록은 그대로).`);
  console.log(`    폰에서 한 번 더 대화하면 다음부터는 붙습니다.`);
}

await setLock(dept, true);
const unlock = () => setLock(dept, false).catch(() => {});
process.on('exit', () => {
  // exit 훅은 동기만 돈다 — 위의 비동기 해제가 못 끝날 때를 대비한 최후 수단
  try {
    const all = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
    delete all[dept];
    writeFileSync(LOCK_FILE, JSON.stringify(all, null, 2));
  } catch {}
});

console.log(`\n  ${deptLabel(dept)} — 폰에서 하던 대화를 이어받습니다.`);
console.log(`  작업 폴더 ${HOME}`);
console.log(`  이 창이 열려 있는 동안 폰에서는 이 방에 말을 걸 수 없습니다.\n`);

const args = ['--resume', sessionId, '--name', `헤뤼싀 · ${deptLabel(dept)}`];
if (persona) args.push('--append-system-prompt-file', persona);

// 브릿지가 자식에게 CLAUDE* 를 물려주지 않는 것과 같은 이유로 여기서도 씻는다
const env = { ...process.env };
for (const k of Object.keys(env)) {
  if (k.startsWith('CLAUDE') && k !== 'CLAUDE_CONFIG_DIR') delete env[k];
}

const isWin = process.platform === 'win32';
const child = isWin
  ? spawn(['claude', ...args].map((a) => `"${String(a).replace(/"/g, '""')}"`).join(' '), {
      shell: true, cwd: HOME, stdio: 'inherit', env,
    })
  : spawn('claude', args, { cwd: HOME, stdio: 'inherit', env });

const done = (code) => {
  unlock();
  process.exit(code ?? 0);
};
child.on('close', done);
child.on('error', (e) => {
  console.error(`\n  claude 를 실행하지 못했습니다: ${e.message}\n`);
  done(1);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
