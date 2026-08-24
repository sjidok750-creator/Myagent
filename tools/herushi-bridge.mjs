/**
 * 헤뤼싀 로컬 브릿지.
 *
 *   npm run herushi
 *
 * 회사컴(또는 집 컴)에서 이 서버를 켜 두면, 같은 네트워크의 아이폰이
 * iMessage 화면으로 접속해 대화한다. 뒤에서는 Anthropic API 가 아니라
 * 이 컴퓨터에 설치된 Claude Code CLI(구독 로그인)가 돈다. API 과금이 없다.
 *
 *   아이폰 화면 → 이 서버(/api/chat, SSE) → claude -p (stream-json)
 *
 * 화면 쪽 규약(js/api.js 의 delta/tool/file/done/error 이벤트)을 그대로
 * 흉내내므로 프런트엔드는 한 줄도 고치지 않는다.
 *
 * 환경변수:
 *   PORT                기본 5177
 *   HERUSHI_HOME        작업 폴더. 기본 ~/헤뤼싀비서실
 *                       (받은 첨부가 저장되고, 만들어진 파일이 폰으로 전송된다)
 *   HERUSHI_CODE        접속 코드. 넣으면 앱 설정의 접속 코드와 맞아야 한다.
 *                       공유기 밖에 노출할 생각이 없어도 넣어두기를 권한다.
 *   HERUSHI_MODEL       기본 모델 (비우면 CLI 기본값)
 *   HERUSHI_PERMISSION  CLI 권한 모드. 기본 acceptEdits
 *   HERUSHI_TOOLS       허용 도구 쉼표 목록. 기본은 아래 DEFAULT_TOOLS
 *
 * 주의: 기본 설정은 Bash 를 허용한다. 헤뤼싀가 이 컴퓨터에서 명령을 실행할
 * 수 있다는 뜻이다(한글 문서 스킬 등이 이것을 요구한다). 남과 같이 쓰는
 * 컴퓨터라면 HERUSHI_TOOLS 에서 Bash 를 빼라.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, stat, mkdir, readdir, rename } from 'node:fs/promises';
import { extname, join, normalize, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, networkInterfaces, tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DEPT_LABELS, deptLabel } from './herushi-depts.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || 5177);
const HOME = process.env.HERUSHI_HOME || join(homedir(), '헤뤼싀비서실');
const INBOX = join(HOME, '받은파일');
const SESSIONS_FILE = join(HOME, '.sessions.json');
const ACCESS_CODE = process.env.HERUSHI_CODE || '';
const DEFAULT_MODEL = process.env.HERUSHI_MODEL || '';
const PERMISSION = process.env.HERUSHI_PERMISSION || 'acceptEdits';
const DEFAULT_TOOLS = ['WebSearch', 'WebFetch', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'Task', 'Skill'];
const TOOLS = (process.env.HERUSHI_TOOLS || '').split(',').map((s) => s.trim()).filter(Boolean);
const ALLOWED_TOOLS = TOOLS.length ? TOOLS : DEFAULT_TOOLS;
const RUN_TIMEOUT_MS = 20 * 60 * 1000;

/* 검증 친구 — 헤뤼싀의 결과를 다른 회사 모델(OpenAI Codex CLI)이 검토한다.
 *   HERUSHI_VERIFY         auto(기본) | always | off
 *                          auto: 파일을 만들었거나 답이 실질적일 때만 검토
 *   HERUSHI_VERIFIER_CMD   기본 codex (ChatGPT 구독 로그인 필요: codex login)
 *   HERUSHI_VERIFIER_NAME  화면에 표시될 이름. 기본 코덱스
 */
const VERIFY = (process.env.HERUSHI_VERIFY || 'auto').toLowerCase();
const VERIFIER_CMD = process.env.HERUSHI_VERIFIER_CMD || 'codex';
const VERIFIER_NAME = process.env.HERUSHI_VERIFIER_NAME || '코덱스';
const VERIFY_TIMEOUT_MS = 5 * 60 * 1000;
// 합의될 때까지 주고받되, 끝없이 도는 것은 막는다 (HERUSHI_VERIFY_ROUNDS)
const MAX_ROUNDS = Math.max(1, Number(process.env.HERUSHI_VERIFY_ROUNDS || 4));
let verifierReady = false;

/* 화면에 보여줄 도구 활동 라벨 (CLI 도구 이름 기준) */
const TOOL_LABELS = {
  WebSearch: '웹을 찾아보는 중',
  WebFetch: '페이지를 읽는 중',
  Read: '파일을 읽는 중',
  Write: '파일을 만드는 중',
  Edit: '파일을 고치는 중',
  Glob: '자료를 찾는 중',
  Grep: '자료를 찾는 중',
  Bash: '작업을 실행하는 중',
  Task: '직원에게 맡기는 중',
  Skill: '작업 도구를 여는 중',
};

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/* 폰으로 보내는 파일의 MIME (확장자 기준) */
const FILE_TYPES = {
  '.hwpx': 'application/octet-stream',
  '.hwp': 'application/octet-stream',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
};
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 8;

/* ------------------------------------------------------------------ */
/* 방(부서)별 CLI 세션 기억                                              */
/* ------------------------------------------------------------------ */

async function loadSessions() {
  try {
    return JSON.parse(await readFile(SESSIONS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function saveSession(dept, sessionId) {
  const all = await loadSessions();
  all[dept] = sessionId;
  await writeFile(SESSIONS_FILE, JSON.stringify(all, null, 2));
}

/* 폰이 화면을 벗어나면 iOS 가 연결을 끊는다. 그래도 일은 끝까지 하고,
 * 완성된 답을 여기 적어 두었다가 같은 방의 다음 요청 때 먼저 배달한다. */
const PENDING_FILE = join(HOME, '.pending.json');

async function loadPending() {
  try {
    return JSON.parse(await readFile(PENDING_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function savePending(dept, entry) {
  const all = await loadPending();
  if (entry) all[dept] = entry;
  else delete all[dept];
  await writeFile(PENDING_FILE, JSON.stringify(all, null, 2)).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* 책상에서 이어받기 — 페르소나 사본과 자물쇠                            */
/* ------------------------------------------------------------------ */

/* 책상에서 이어받는 동안 그 방에 거는 자물쇠. 한 세션 파일을 폰과 책상이
 * 동시에 쓰면 기록이 뒤섞인다. tools/herushi-desk.mjs 가 걸고 푼다.
 * (페르소나는 넘기지 않는다 — 책상에서는 비서가 아니라 클로드 코드와
 *  직접 일하기 때문이다.) */
const STATE_DIR = join(HOME, '.herushi');
const LOCK_FILE = join(STATE_DIR, 'desk-lock.json');

async function loadLocks() {
  try {
    return JSON.parse(await readFile(LOCK_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** 그 방을 지금 책상에서 쓰고 있나. 죽은 자물쇠(꺼진 창)는 무시한다. */
async function deskHolding(dept) {
  const lock = (await loadLocks())[dept];
  if (!lock?.pid) return null;
  try {
    process.kill(lock.pid, 0);   // 살아 있나만 본다 — 신호 0 은 아무 일도 안 한다
    return lock;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 작업 일지 — 데스크톱 앱 목록에 이 방(-p 세션)이 뜨지 않는 것을 메운다   */
/* ------------------------------------------------------------------ */

const JOURNAL_DIR = join(HOME, '_헤뤼싀일지');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function journalDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 방·시각·주고받은 내용을 그날 파일에 한 단락 덧붙인다. 실패해도 본 요청은 막지 않는다. */
async function appendJournal(dept, ask, answer, fileNames) {
  const now = new Date();
  const dateStr = journalDateStr(now);
  const time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const room = deptLabel(dept);

  let block = `## ${time} · ${room}\n\n`;
  block += `**대표님:** ${(ask || '').trim() || '(첨부만 보냄)'}\n\n`;
  block += `**헤뤼싀:** ${(answer || '').trim() || '(파일만 전달)'}\n`;
  if (fileNames.length) block += `\n만든 파일: ${fileNames.join(', ')}\n`;
  block += '\n---\n\n';

  await mkdir(JOURNAL_DIR, { recursive: true });
  const file = join(JOURNAL_DIR, `${dateStr}.md`);
  let existing = '';
  try {
    existing = await readFile(file, 'utf8');
  } catch {}
  if (!existing) existing = `# ${dateStr} 헤뤼싀 작업 일지\n\n`;
  await writeFile(file, existing + block, 'utf8');
}

/** 놓쳐 둔 답이 있으면 배달하고 보관함을 비운다. 일지에는 다시 적지 않는다 —
 *  원래 그 턴이 끝날 때(화면이 없었어도) 이미 기록됐기 때문이다. */
async function deliverPending(dept, send) {
  try {
    const pending = (await loadPending())[dept];
    if (!pending) return;
    await savePending(dept, undefined);
    if (pending.text) {
      // 안내 문구는 화면이 붙인다. 여기서 앞에 붙이면 답 맨 앞의 [[dept:...]]
      // 태그가 문장 중간이 되어 화면이 떼어내지 못하고 그대로 노출된다.
      send({ type: 'followup', text: pending.text, resumed: true });
    }
    for (const p of pending.files || []) {
      const s = await stat(p).catch(() => null);
      if (!s || !s.size || s.size > MAX_FILE_BYTES) continue;
      const data = await readFile(p).catch(() => null);
      if (!data) continue;
      send({
        type: 'file',
        name: basename(p),
        mime: FILE_TYPES[extname(p).toLowerCase()] || 'application/octet-stream',
        size: s.size,
        data: data.toString('base64'),
      });
    }
  } catch {}
}

/* ------------------------------------------------------------------ */
/* 진행 중인 작업 — 요청과 분리해서 붙잡아 둔다                            */
/* ------------------------------------------------------------------ */

/*
 * 폰은 화면을 벗어나면 연결을 끊는다. 작업을 "요청"에 매어 두면 그 순간
 * 작업을 다시 붙잡을 방법이 없어진다 — 돌아와도 진행 상황을 볼 수 없고,
 * 결과를 받으려면 새 메시지를 보내야 하고, 그 새 메시지는 아직 돌고 있는
 * 작업 위에 두 번째 프로세스를 띄워 같은 세션 기록을 뒤섞는다.
 *
 * 그래서 작업을 방(dept)에 매어 둔다. 요청은 그 작업을 "구독"할 뿐이다.
 * 구독자가 0명이어도 작업은 계속 돌고, 지금까지 일어난 일을 events 에
 * 쌓아 둔다. 돌아온 폰은 그 기록을 그대로 재생받고 이어서 실시간으로 본다.
 *
 * 코덱스가 붙으면 이 구조가 더 중요해진다 — 검증 왕복은 몇 분씩 걸리고
 * 그 사이 폰은 거의 확실히 화면을 벗어나기 때문이다.
 */
const runs = new Map(); // dept -> run

function createRun(dept) {
  const run = {
    dept,
    events: [],          // 지금까지 내보낸 모든 이벤트 (재생용)
    subs: new Set(),     // 지금 보고 있는 응답 스트림들
    finished: false,
    startedAt: Date.now(),
    kids: new Set(),     // 이 작업이 낳은 자식 프로세스들
    // 여기까지는 폰이 실제로 받아 갔다. 끝날 때 이 뒤의 것만 보관한다 —
    // 다 본 답을 나중에 📨 로 또 배달하면 같은 말이 두 번 뜬다.
    seenUpTo: -1,

    emit(evt) {
      run.events.push(evt);
      for (const res of run.subs) writeEvent(res, evt);
      if (run.subs.size) run.seenUpTo = run.events.length - 1;
    },
    track(child) {
      run.kids.add(child);
      child.on('close', () => run.kids.delete(child));
    },
    killAll() {
      for (const c of run.kids) c.kill('SIGTERM');
    },
  };
  runs.set(dept, run);
  return run;
}

function writeEvent(res, evt) {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  } catch {}
}

/** 이 응답 스트림을 작업에 붙인다. 지금까지의 기록을 재생한 뒤 실시간으로 잇는다. */
function subscribe(run, res) {
  // 재생 전에 화면을 비우라고 알린다 — 이미 본 조각 위에 겹쳐 쌓이지 않게.
  writeEvent(res, { type: 'attach', at: run.startedAt });
  for (const evt of run.events) writeEvent(res, evt);
  if (run.finished) {
    writeEvent(res, { type: 'done', usage: {} });
    try {
      res.write('data: [DONE]\n\n');
      res.end();
    } catch {}
    return;
  }
  run.subs.add(res);
  run.seenUpTo = run.events.length - 1;   // 방금 재생해 줬으니 여기까지는 본 것이다
  const beat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {}
  }, 15000);
  const detach = () => {
    clearInterval(beat);
    run.subs.delete(res);
  };
  res.on('close', detach);
  res.on('error', detach);
}

/* ------------------------------------------------------------------ */
/* claude CLI 실행                                                      */
/* ------------------------------------------------------------------ */

function cliEnv() {
  // 다른 Claude Code 안에서 이 서버를 띄운 경우, 물려받은 CLAUDE* 변수가
  // CLI 를 부모 세션에 끼워 넣는다 (CLAUDE_CODE_SESSION_ID 등). 전부 걷어낸다.
  // 사용자가 직접 잡은 설정 위치만 남긴다.
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('CLAUDE') && k !== 'CLAUDE_CONFIG_DIR') continue;
    env[k] = v;
  }
  return env;
}

function spawnCli(cmd, args) {
  if (process.platform === 'win32') {
    // Windows 에서 CLI 는 .cmd 라 셸이 필요하고, 셸을 거치면 인용이 문제가
    // 된다. 인자를 직접 인용해 한 줄로 만든다. 긴 본문은 전부 stdin/파일로
    // 가므로 여기 오는 인자는 짧다.
    const line = [cmd, ...args].map((a) => '"' + String(a).replace(/"/g, '""') + '"').join(' ');
    return spawn(line, { shell: true, cwd: HOME, env: cliEnv() });
  }
  return spawn(cmd, args, { cwd: HOME, env: cliEnv() });
}
const spawnClaude = (args) => spawnCli('claude', args);

/* ------------------------------------------------------------------ */
/* 프롬프트 조립                                                        */
/* ------------------------------------------------------------------ */

const BRIDGE_DOCTRINE = `
## 로컬 브릿지에서 일할 때

지금 대표님은 휴대폰 화면으로 대화하고 있고, 당신은 대표님 컴퓨터의 ${HOME} 폴더에서 일하고 있습니다.

- 완성한 파일(보고서·표·문서)은 이 폴더나 프로젝트의 하위 폴더에 저장하세요. 저장된 파일은 자동으로 대표님 휴대폰 대화창에 전송됩니다.
- **받은파일/ 폴더에는 아무것도 저장하지 마세요.** 대표님이 보낸 첨부만 있는 곳입니다(경로는 본문에 적혀 있습니다). 결과물을 여기 섞으면 나중에 무엇을 받았고 무엇을 만들었는지 구분이 안 됩니다. 그래도 여기에 저장하면 브릿지가 ${HOME} 로 도로 옮깁니다 — 그러면 답에 적어 둔 경로가 틀린 경로가 되니, 처음부터 다른 폴더에 저장하세요.
- 휴대폰 화면이므로 답은 간결하게. 긴 내용은 파일로 만들어 전하세요.

## 문서 산출 규약 — 근본은 HWPX, 검수는 PDF

대표님은 밖에서 폰으로 지시하고 PDF로 내용을 검수한 뒤, 책상에서 HWPX 원본을 한글로 최종 확인합니다. 그래서 보고서·공문 등 문서를 만들면 **같은 초안에서 두 파일**을 냅니다:

1. \`문서명.hwpx\` — 근본 파일. hwp 스킬로 생성해 프로젝트 폴더에 저장
2. \`문서명.pdf\` — 검수용. 폰 화면에서 읽기 좋게
3. \`문서명.md\` — **초안 원본. 지우지 마세요.** HWPX 는 압축된 XML 이라 사람도 검증자도 직접 읽지 못합니다. 이 마크다운이 내용을 확인할 수 있는 유일한 평문이고, 다음에 고칠 때 출발점입니다.

PDF 는 초안(markdown)을 간결한 HTML 로 만들어 Edge 의 headless 인쇄로 뽑습니다. Windows 에서:

\`\`\`
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless --disable-gpu --no-margins --print-to-pdf="C:\\경로\\문서명.pdf" "file:///C:/경로/문서명.html"
\`\`\`

(Edge 가 그 경로에 없으면 \`Program Files\` 쪽도 확인. HTML 에는 \`<meta charset="utf-8">\` 과 본문 폰트 \`font-family:'Malgun Gothic',sans-serif\` 를 넣어 한글이 깨지지 않게. 표는 테두리를 넣어 읽기 좋게.)

PDF 를 만들 수 없는 환경이면 그 사실을 말하고 HWPX 만 냅니다. 조판은 두 파일이 다를 수 있음을 알고, 내용은 반드시 같게 하세요.

이 모드에 **없는** 기능 — 있다고 말하거나 제안하지 마세요:
- 자료실(메모·할 일·사람 도구) — 대신 기억할 것은 이 폴더에 파일로 적으세요
- 구글 캘린더·지메일 — 조회도 발송도 못 합니다
- 먼저 말 걸기(알림) — 대표님이 말을 걸어야 응답할 수 있습니다
`;

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return '';
}

/**
 * 보낼 프롬프트를 만든다.
 * 이어지는 세션(resume)이면 마지막 사용자 발화만, 새 세션이면 최근 대화를
 * 요약 형태로 앞에 붙인다 — 폰에서 대화를 지웠거나 세션이 유실됐을 때도
 * 맥락이 끊기지 않게.
 */
function buildPrompt(messages, resuming, attachedPaths) {
  const last = messages[messages.length - 1];
  let prompt = textOf(last?.content) || '(첨부를 봐 주세요)';

  if (attachedPaths.length) {
    prompt += '\n\n[첨부된 파일]\n' + attachedPaths.map((p) => `- ${p}`).join('\n');
  }

  if (!resuming && messages.length > 1) {
    const recap = messages
      .slice(0, -1)
      .slice(-12)
      .map((m) => `[${m.role === 'user' ? '대표' : '헤뤼싀'}] ${textOf(m.content)}`)
      .join('\n');
    prompt = `(지금까지의 대화입니다. 이어서 답하세요.)\n${recap}\n\n[대표] ${prompt}`;
  }
  return prompt;
}

/* ------------------------------------------------------------------ */
/* 검증 친구 (문맥 분리 — docflow 5단계와 같은 원칙)                       */
/* ------------------------------------------------------------------ */

/**
 * 검증자에게는 요청·결과·파일만 준다. 과정이나 의도는 주지 않는다 —
 * 과정을 알면 그 과정을 따라 읽게 되고, 그러면 분리한 의미가 없다.
 * --ephemeral 이라 검증자는 매번 백지에서 시작한다.
 */
function verifierPrompt(userAsk, answer, filePaths, history) {
  const prior = history.length
    ? `\n[지난 라운드 — 당신이 지적했고 작성자가 답했습니다]\n${history
        .map((h, i) => `${i + 1}회차\n· 당신의 지적: ${h.verdict}\n· 작성자의 답: ${h.reply}`)
        .join('\n\n')}\n\n**이번에는 그 지적이 실제로 해결됐는지 파일을 다시 열어 확인하세요.** 해결됐으면 "문제 없음"이라고 하세요. 작성자가 당신의 지적을 반박했다면, 그 반박이 맞는지 원본으로 판단하세요 — 당신이 틀렸으면 인정하고 "문제 없음"이라고 하세요. 같은 지적을 근거 없이 되풀이하지 마세요.\n`
    : '';

  return `당신은 문서 검증자입니다. 이 답을 만든 사람과 대화한 적이 없고 의도를 모릅니다. 그게 이 일에 필요한 조건입니다.

[사용자의 요청]
${userAsk}

[작성자의 현재 답]
${answer}
${filePaths.length ? `\n[작성자가 만든 파일 — 직접 열어 확인하세요]\n${filePaths.map((p) => '- ' + p).join('\n')}\n` : ''}${prior}
## 할 일

답 속의 사실 주장(숫자·날짜·이름·계산·단정 서술)을 하나씩 검토하세요. 파일이 있으면 열어서 내용이 요청·답과 일치하는지 보세요. 계산이 있으면 실제로 계산해 보세요.

파일을 읽을 때:
- **\`.hwpx\` 는 압축된 XML 이라 그대로는 못 읽습니다.** 같은 이름의 \`.md\` 나 \`.pdf\` 를 대신 읽으세요. 둘 다 없으면 그 파일은 확인하지 못했다고 밝히고, 없는 근거로 지적하지 마세요.
- 넘겨받은 파일 외에도 같은 폴더의 **원본 양식·출처대장(\`출처대장.md\`)·이전 문서**를 찾아 읽어도 됩니다. 출처대장이 있으면 본문의 숫자를 그 표와 대조하는 것이 가장 확실한 검증입니다.
- 읽기 전용이라 파일을 고칠 수는 없습니다. 지적만 하세요.

## 반드시 지킬 것

- 지적할 때는 위치와 원문을 인용하세요. 인용 없는 지적은 쓰지 마세요.
- 추측("좀 높아 보인다")과 문체 트집은 검증이 아닙니다. 사실만 보세요.
- 문제가 없으면 "문제 없음" 한 줄만 쓰세요. 억지로 찾아내지 마세요.
- 한국어로, 요점만 5줄 이내로 쓰세요.`;
}

function runVerifier(userAsk, answer, filePaths, history, track) {
  return new Promise(async (resolve) => {
    const outFile = join(tmpdir(), `herushi-verify-${randomUUID()}.txt`);
    const child = spawnCli(VERIFIER_CMD, [
      'exec',
      '--sandbox', 'read-only',
      '--cd', HOME,
      '--skip-git-repo-check',
      '--ephemeral',
      '--color', 'never',
      '--output-last-message', outFile,
    ]);
    track?.(child);
    const timer = setTimeout(() => child.kill('SIGTERM'), VERIFY_TIMEOUT_MS);
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.stdout.resume(); // 진행 로그는 버린다. 최종 답은 outFile 로 온다.
    child.stdin.on('error', () => {});
    child.stdin.end(verifierPrompt(userAsk, answer, filePaths, history || []));
    child.on('error', () => { clearTimeout(timer); resolve({ ok: false, why: 'spawn' }); });
    child.on('close', async (code) => {
      clearTimeout(timer);
      const text = (await readFile(outFile, 'utf8').catch(() => '')).trim();
      if (code === 0 && text) return resolve({ ok: true, text });
      console.error(`[herushi] 검증자(${VERIFIER_CMD}) 종료 코드 ${code}\n${stderr.slice(0, 1200)}`);
      resolve({ ok: false, why: /login|auth|api key/i.test(stderr) ? 'login' : 'run' });
    });
  });
}

/** 토큰 사용량을 사람이 읽게 한 줄로. 실제 소모를 눈으로 보라고 남긴다. */
function usageLine(who, u) {
  if (!u) return null;
  const k = (n) => (n >= 1000 ? Math.round(n / 100) / 10 + 'k' : String(n || 0));
  const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  return `[herushi] ${who} — 입력 ${k(inTok)}(캐시적중 ${k(u.cache_read_input_tokens)}) 출력 ${k(u.output_tokens)}`;
}

/** 검증 결과를 헤뤼싀에게 돌려주고 짧은 답(수용/반박)을 받는다. */
function runFollowup(sessionId, verdict, track) {
  return new Promise((resolve) => {
    const child = spawnClaude([
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode', PERMISSION,
      '--allowedTools', ...ALLOWED_TOOLS,
      '--resume', sessionId,
    ]);
    track?.(child);
    const timer = setTimeout(() => child.kill('SIGTERM'), VERIFY_TIMEOUT_MS);
    let text = '', buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.parent_tool_use_id) continue;
          if (obj.type === 'result' && obj.usage) {
            const l = usageLine('헤뤼싀(수정)', obj.usage);
            if (l) console.log(l);
          }
          const e = obj.type === 'stream_event' ? obj.event : null;
          if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') text += e.delta.text;
        } catch {}
      }
    });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.stdin.end(
      `검증 친구 ${VERIFIER_NAME}가 방금 당신의 답을 검토했다. 결과:\n\n${verdict}\n\n` +
      `원본과 파일을 다시 보고 판단하라. 맞는 지적이면 고치고 무엇을 고쳤는지 말하라. ` +
      `틀린 지적이면 근거를 인용해 반박하라. 확인 없이 시인하지 마라. 4문장 이내로.`
    );
    child.on('error', () => { clearTimeout(timer); resolve(''); });
    child.on('close', () => { clearTimeout(timer); resolve(text.trim()); });
  });
}

function safeName(name) {
  const base = basename(String(name || '파일')).replace(/[\\/:*?"<>|]/g, '_');
  return base.startsWith('.') ? '_' + base.slice(1) : base;
}

async function writeAttachments(attachments) {
  if (!attachments) return [];
  await mkdir(INBOX, { recursive: true });
  const paths = [];
  for (const a of Object.values(attachments)) {
    if (!a?.data) continue;
    const p = join(INBOX, safeName(a.name));
    await writeFile(p, Buffer.from(a.data, 'base64'));
    paths.push(p);
  }
  return paths;
}

/* ------------------------------------------------------------------ */
/* 만들어진 파일 회수                                                    */
/* ------------------------------------------------------------------ */

/* 작업 폴더가 드라이브 루트(D:\ 등)일 수 있다. 시스템·프로그램 폴더는
 * 건너뛰고, 훑는 양과 시간에 상한을 둔다 — 파일 회수가 몇 초 늦는 것은
 * 괜찮지만 몇 분씩 도는 것은 안 된다. */
const SKIP_DIRS = new Set([
  'node_modules', '$recycle.bin', 'system volume information', 'windows',
  'program files', 'program files (x86)', 'programdata', 'appdata',
  '$windows.~bt', 'recovery', 'perflogs',
]);
const SCAN_BUDGET_MS = 8000;
const SCAN_DIR_CAP = 4000;

/** 받은파일/ 안(하위 폴더 포함)인가. 폴더 자신은 아니다. */
function insideInbox(p) {
  return p.startsWith(INBOX + sep);
}

/**
 * 결과물이 받은파일/ 안에 저장됐으면 작업 폴더 바로 밑으로 옮긴다.
 *
 * 받은파일/ 은 대표님이 보낸 첨부만 두는 곳이다. 지침(BRIDGE_DOCTRINE)에도
 * 적어 두었지만 실제로 어긴 적이 있어서 — 받은 것과 만든 것이 한 폴더에
 * 섞이면 나중에 탐색기에서 구분이 안 된다 — 코드로 되돌린다.
 *
 * 첨부 자체는 여기까지 오지 않는다(skipPaths 에서 이미 걸러진다).
 * 옮기지 못하면(잠김 등) 원래 자리에 두고 그대로 보낸다 — 배달이 우선이다.
 */
async function evictFromInbox(p) {
  if (!insideInbox(p)) return { path: p, moved: false };
  const name = basename(p);
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let dest = join(HOME, name);
  for (let i = 2; i <= 50 && (await stat(dest).catch(() => null)); i += 1) {
    dest = join(HOME, `${stem}-${i}${ext}`);
  }
  try {
    await rename(p, dest);
    return { path: dest, moved: true, from: p };
  } catch {
    return { path: p, moved: false };
  }
}

/**
 * @param {number} since 이 시각 이후 바뀐 파일만 줍는다
 * @param {Set<string>} skipPaths 이번에 받은 첨부의 절대경로 — 되보내지 않는다.
 *   받은파일/ 폴더 전체를 눈감지는 않는다. 헤뤼싀가 (지침을 어기고) 그
 *   폴더 안에 결과물을 저장해도 여기서는 찾아낸다 — 첨부 자체가 아닌
 *   한 새 파일은 어디에 있든 폰으로 보내는 것이 안전하다. 다만 보내기 전에
 *   작업 폴더로 옮겨서 받은파일/ 은 받은 것만 남게 한다.
 */
async function collectNewFiles(since, skipPaths = new Set()) {
  const found = [];
  const deadline = Date.now() + SCAN_BUDGET_MS;
  let visited = 0;
  async function walk(dir, depth) {
    if (depth > 3 || ++visited > SCAN_DIR_CAP || Date.now() > deadline) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name.toLowerCase())) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (p === JOURNAL_DIR) continue; // 작업 일지 — 대표님께 보낼 결과물이 아니라 내부 기록
        await walk(p, depth + 1);
      } else if (e.isFile()) {
        if (skipPaths.has(p)) continue;
        const s = await stat(p).catch(() => null);
        if (s && s.mtimeMs >= since - 1000 && s.size > 0 && s.size <= MAX_FILE_BYTES) {
          found.push({ path: p, size: s.size, mtime: s.mtimeMs });
        }
      }
    }
  }
  await walk(HOME, 0);
  found.sort((a, b) => a.mtime - b.mtime);

  const out = [];
  let total = 0;
  for (const f of found.slice(0, MAX_FILES)) {
    if (total + f.size > MAX_TOTAL_BYTES) break;
    const placed = await evictFromInbox(f.path);
    const data = await readFile(placed.path).catch(() => null);
    if (!data) continue;
    total += f.size;
    out.push({
      path: placed.path,
      movedFrom: placed.moved ? placed.from : undefined,
      name: basename(placed.path),
      mime: FILE_TYPES[extname(placed.path).toLowerCase()] || 'application/octet-stream',
      size: f.size,
      data: data.toString('base64'),
    });
  }
  return out;
}

/** 모아 온 파일을 폰으로 보낸다. 받은파일/ 에서 꺼내 온 것은 그 사실도 알린다 —
 *  헤뤼싀가 답 본문에 적은 경로가 옮기기 전 경로일 수 있기 때문이다. */
function sendFiles(send, files) {
  for (const f of files) {
    send({ type: 'file', name: f.name, mime: f.mime, size: f.size, data: f.data });
    if (f.movedFrom) {
      send({
        type: 'tool',
        name: 'move',
        phase: 'note',
        label: `${f.name} 은(는) 받은파일/ 에 저장돼 있어 ${HOME} 로 옮겼습니다`,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* /api/chat — 화면 규약(SSE) 그대로                                     */
/* ------------------------------------------------------------------ */

async function handleChat(req, res, body) {
  const { dept = 'chief', system = '', messages = [], attachments, model, attach } = body;
  const active = runs.get(dept);

  const openStream = () => {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    // 폰이 먼저 끊겨도(와이파이 이탈, 화면 잠김) 서버는 죽으면 안 된다.
    res.on('error', () => {});
  };

  // 돌아와서 "지금 뭐 하고 있나" 확인하러 온 요청 — 새 일을 시키지 않는다.
  if (attach) {
    openStream();
    if (active) return subscribe(active, res);
    // 도는 작업이 없으면, 놓쳐 둔 답이 있는지만 보고 끝낸다.
    await deliverPending(dept, (evt) => writeEvent(res, evt));
    writeEvent(res, { type: 'done', usage: {} });
    try {
      res.write('data: [DONE]\n\n');
      res.end();
    } catch {}
    return;
  }

  // 책상에서 그 방을 열어 두었다 — 같은 세션 파일을 둘이 쓰면 기록이 깨진다.
  // 폰을 막는 쪽이 맞다. 책상 창을 닫으면 자물쇠가 풀린다.
  if (!attach) {
    const held = await deskHolding(dept);
    if (held) {
      openStream();
      const run = createRun(dept);
      subscribe(run, res);
      run.emit({
        type: 'delta',
        text: `지금 ${deptLabel(dept)}을 책상 컴퓨터에서 열어 두셨습니다. `
          + `한 대화를 두 곳에서 동시에 쓰면 기록이 깨져서, 여기서는 받지 않겠습니다.\n\n`
          + `책상 창을 닫으시면 바로 이어서 하겠습니다.`,
      });
      run.emit({ type: 'done', usage: {} });
      run.finished = true;
      runs.delete(dept);
      for (const sub of run.subs) {
        try {
          sub.write('data: [DONE]\n\n');
          sub.end();
        } catch {}
      }
      return;
    }
  }

  // 아직 돌고 있는데 새 메시지가 왔다 — 두 번째 프로세스를 띄우면 같은 세션
  // 기록이 뒤섞인다. 새로 시키지 말고 지금 하는 일을 보여준다.
  if (active && !active.finished) {
    openStream();
    active.emit({
      type: 'tool',
      name: 'busy',
      label: '아직 앞의 일을 하는 중입니다 — 끝나면 바로 이어서 답하겠습니다',
      phase: 'note',
    });
    return subscribe(active, res);
  }

  if (!Array.isArray(messages) || !messages.length) {
    res.writeHead(400, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: '보낼 메시지가 없습니다.' }));
  }

  openStream();
  const run = createRun(dept);
  const send = (evt) => run.emit(evt);
  subscribe(run, res);

  const startedAt = run.startedAt;
  const sessions = await loadSessions();
  const prevSession = sessions[dept];

  await deliverPending(dept, send);

  let attachedPaths = [];
  try {
    attachedPaths = await writeAttachments(attachments);
  } catch {
    send({ type: 'tool', name: 'attach', label: '첨부를 저장하지 못했습니다', phase: 'note' });
  }
  const attachedSet = new Set(attachedPaths);

  const sysFile = join(tmpdir(), `herushi-sys-${randomUUID()}.txt`);
  await writeFile(sysFile, system + '\n' + BRIDGE_DOCTRINE);

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--append-system-prompt-file', sysFile,
    '--permission-mode', PERMISSION,
    // CLI 의 /resume 목록에 뜰 제목. 안 주면 첫 질문에서 자동으로 지어진
    // 제목("D드라이브 구조 확인" 같은)이 붙어서 헤뤼싀 방인지 알아보기 어렵다.
    // --resume 과 같이 써도 되고, 그때는 제목만 바뀌고 대화는 이어진다(실측).
    '--name', `헤뤼싀 · ${deptLabel(dept)}`,
    '--allowedTools', ...ALLOWED_TOOLS,
  ];
  const wantModel = model || DEFAULT_MODEL;
  if (wantModel) args.push('--model', wantModel);
  if (prevSession) args.push('--resume', prevSession);

  const child = spawnClaude(args);
  run.track(child);
  const track = (c) => run.track(c);
  const timer = setTimeout(() => run.killAll(), RUN_TIMEOUT_MS);
  // 폰이 화면을 벗어나도 일은 계속한다. 이제 작업은 요청이 아니라 방에
  // 매여 있으므로, 돌아온 폰은 지금까지의 기록을 재생받고 이어서 볼 수 있다.
  // 그래서 화면의 멈춤 버튼은 "그만 보기"이지 "그만 하기"가 아니다.
  res.on('close', () => {
    if (!res.writableEnded) {
      console.log('[herushi] 폰이 화면을 벗어났습니다 — 일은 계속합니다');
    }
  });

  child.stdin.on('error', () => {});
  child.stdin.end(buildPrompt(messages, !!prevSession, attachedPaths));

  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));

  let sessionId = null;
  let savedSession = prevSession || null;   // .sessions.json 에 이미 적힌 값
  let gotText = false;
  let fullText = '';
  // 도구를 여러 번 부르는 동안 클로드는 매번 새 "내부 턴"을 시작하고, 턴마다
  // 자기 진행 상황을 영어로 짧게 서술하곤 한다("Let me check the folder...").
  // 그 서술들을 다 이어붙이면 마지막 진짜 답 앞에 잡동사니가 줄줄이 붙는다.
  // 그래서 새 내부 턴이 시작될 때마다(message_start) 지금까지 쌓인 걸 버리고
  // 처음부터 다시 쓴다 — 남는 건 항상 마지막 턴, 즉 최종 답뿐이다.
  let sawFirstTurn = false;
  const activeTools = new Set();
  const endTools = () => {
    for (const name of activeTools) send({ type: 'tool', name, phase: 'end' });
    activeTools.clear();
  };

  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      handleCliEvent(obj);
    }
  });

  function handleCliEvent(obj) {
    if (obj.parent_tool_use_id) return; // 서브에이전트 내부 활동은 조용히
    if (obj.type === 'system' && obj.subtype === 'init' && obj.session_id) {
      sessionId = obj.session_id;
      // 끝까지 못 가더라도(중간에 죽거나 멈추거나) 이 방의 세션은 이것이다.
      // 성공했을 때만 적어 두면, 실패한 턴 뒤에 새 세션이 만들어지고 앱의
      // 대화가 통째로 다시 밀려 들어간다 — 그렇게 버려진 세션들이 있었다.
      if (sessionId !== savedSession) {
        savedSession = sessionId;
        saveSession(dept, sessionId).catch(() => {});
      }
      return;
    }
    if (obj.type === 'result' && obj.usage) {
      const l = usageLine('헤뤼싀', obj.usage);
      if (l) console.log(l);
      return;
    }
    if (obj.type === 'stream_event') {
      const e = obj.event;
      if (e?.type === 'message_start') {
        if (sawFirstTurn && fullText) {
          // 도구를 더 부르려고 새 턴을 시작했다 — 지금까지의 서술은 버린다.
          fullText = '';
          send({ type: 'reset' });
        }
        sawFirstTurn = true;
      } else if (e?.type === 'content_block_start' && e.content_block?.type === 'tool_use') {
        const name = e.content_block.name;
        const label = TOOL_LABELS[name] || '일하는 중';
        if (!activeTools.has(name)) {
          activeTools.add(name);
          send({ type: 'tool', name, label, phase: 'start' });
        }
      } else if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
        if (activeTools.size) endTools();
        gotText = true;
        fullText += e.delta.text;
        send({ type: 'delta', text: e.delta.text });
      }
    }
  }

  child.on('close', async (code) => {
    try {
    clearTimeout(timer);
    endTools();

    if (code !== 0 && !gotText) {
      const hint = /resume|session/i.test(stderr) && prevSession
        ? '이전 대화를 이어받지 못했습니다. 한 번 더 보내면 새로 시작합니다.'
        : /login|auth|credential/i.test(stderr)
          ? '이 컴퓨터의 Claude Code 에 로그인이 필요합니다. 터미널에서 claude 를 한 번 실행해 로그인해 주세요.'
          : 'Claude Code 실행에 실패했습니다. 서버 창의 로그를 확인해 주세요.';
      // 이어받기 실패였다면 다음 요청은 새 세션으로 가게 기억을 지운다
      if (/resume|session/i.test(stderr) && prevSession && sessionId === null) {
        await saveSession(dept, undefined);
        savedSession = null;
      }
      console.error(`[herushi] claude 종료 코드 ${code}\n${stderr.slice(0, 2000)}`);
      send({ type: 'error', error: hint });
      return; // finally 에서 작업을 정리하고 구독자들을 닫는다
    }

    let newFiles = [];
    try {
      newFiles = await collectNewFiles(startedAt, attachedSet);
      sendFiles(send, newFiles);
    } catch {}

    if (sessionId && sessionId !== savedSession) await saveSession(dept, sessionId).catch(() => {});

    const lastAsk = textOf(messages[messages.length - 1]?.content) || '';

    // 데스크톱 앱은 -p 로 만든 이 방의 대화를 목록에 보여주지 않는다(실측 확인).
    // 그래서 사람이 읽을 수 있는 기록을 폴더에 남긴다 — 어느 파일 탐색기로도 열리고,
    // 필요 없는 날은 파일째 지우면 되고, 헤뤼싀 자신도 다음에 이 파일을 읽을 수 있다.
    await appendJournal(dept, lastAsk, fullText.trim(), newFiles.map((f) => f.name)).catch(() => {});

    /* 검증 친구 차례 — 파일을 만들었거나 실질적인 답일 때.
     * 폰이 보고 있든 아니든 검증은 한다. 검증 왕복은 몇 분씩 걸려서 그
     * 사이 폰은 거의 확실히 화면을 벗어나는데, 그때마다 건너뛰면 정작
     * 검증이 가장 필요한 긴 작업에서만 검증이 빠진다. 돌아온 폰은 이
     * 과정을 재생으로 다 볼 수 있다. */
    const wantVerify =
      verifierReady &&
      VERIFY !== 'off' &&
      (VERIFY === 'always' || newFiles.length > 0 || fullText.trim().length >= 350);

    if (wantVerify) {
      let filePaths = newFiles.map((f) => f.path);
      let answer = fullText.trim();
      const history = [];      // [{verdict, reply}] — 지난 라운드
      let agreed = false;
      let stopWhy = '';

      for (let round = 1; round <= MAX_ROUNDS; round++) {
        const label = round === 1
          ? `${VERIFIER_NAME}가 검토하는 중`
          : `${VERIFIER_NAME}가 다시 확인하는 중 (${round}회차)`;
        send({ type: 'tool', name: 'verify', label, phase: 'start' });
        const v = await runVerifier(lastAsk, answer, filePaths, history, track);
        send({ type: 'tool', name: 'verify', phase: 'end' });

        if (!v.ok) {
          send({
            type: 'tool', name: 'verify', phase: 'note',
            label: v.why === 'login'
              ? `${VERIFIER_NAME}에 로그인이 필요합니다 (터미널에서 ${VERIFIER_CMD} login)`
              : `${VERIFIER_NAME}를 부르지 못했습니다`,
          });
          stopWhy = 'error';
          break;
        }

        send({ type: 'verifier', name: VERIFIER_NAME, text: v.text });

        if (/^문제\s*없음/.test(v.text.trim())) { agreed = true; break; }
        if (!sessionId) { stopWhy = 'nosession'; break; }

        // 같은 지적을 되풀이하면 평행선이다. 더 돌려도 소용없다.
        const norm = (s) => s.replace(/\s+/g, '').slice(0, 200);
        if (history.some((h) => norm(h.verdict) === norm(v.text))) { stopWhy = 'deadlock'; break; }

        send({ type: 'tool', name: 'fix', label: '헤뤼싀가 검토에 답하는 중', phase: 'start' });
        const fixStart = Date.now();
        const reply = await runFollowup(sessionId, v.text, track);
        send({ type: 'tool', name: 'fix', phase: 'end' });
        if (!reply) { stopWhy = 'noreply'; break; }

        send({ type: 'followup', text: reply });
        try {
          const fixed = await collectNewFiles(fixStart, attachedSet);
          sendFiles(send, fixed);
          if (fixed.length) filePaths = fixed.map((f) => f.path);
        } catch {}

        history.push({ verdict: v.text, reply });
        answer = reply;
        if (round === MAX_ROUNDS) stopWhy = 'maxrounds';
      }

      // 합의 없이 끝났으면 대표님이 판단하시도록 그 사실을 알린다
      if (!agreed && (stopWhy === 'deadlock' || stopWhy === 'maxrounds')) {
        send({
          type: 'verifier', name: VERIFIER_NAME,
          text: stopWhy === 'deadlock'
            ? `⚠️ 헤뤼싀와 제 의견이 갈립니다. 위 내용을 보시고 대표님이 판단해 주세요.`
            : `⚠️ ${MAX_ROUNDS}회를 주고받았지만 합의하지 못했습니다. 위 내용을 보시고 대표님이 판단해 주세요.`,
        });
      }
      console.log(`[herushi] 검증 종료 — ${agreed ? '합의됨' : stopWhy || '중단'} (${history.length + 1}회차)`);
    }

    // 끝나는 순간 아무도 안 보고 있으면 답을 적어 둔다. 나중에 이 방을 다시
    // 열면 배달된다. 보고 있으면 방금 다 봤으니 보관할 필요가 없다.
    // 다만 "아무도 안 봤다"가 아니라 "받아 가지 못한 부분"만 보관한다.
    // 답을 다 읽고 화면을 벗어난 뒤(파일 수집·검증이 남아 몇 초 더 걸린다)
    // 끝나는 경우가 흔한데, 그때 통째로 보관하면 다음에 들어올 때 같은
    // 답이 📨 로 한 번 더 뜬다 — 실제로 그렇게 두 번 떴다.
    const unseen = run.events.slice(run.seenUpTo + 1);
    const textUnseen = unseen.some((e) => e.type === 'delta');
    const filesUnseen = new Set(unseen.filter((e) => e.type === 'file').map((e) => e.name));
    const keepText = textUnseen ? fullText.trim() : '';
    const keepFiles = newFiles.filter((f) => filesUnseen.has(f.name)).map((f) => f.path);

    if (run.subs.size === 0 && (keepText || keepFiles.length)) {
      await savePending(dept, { ask: lastAsk, text: keepText, files: keepFiles, at: Date.now() });
      console.log(
        `[herushi] ${dept} 방: 못 전한 부분을 보관합니다 — ` +
          `${keepText ? '답' : '답 없음'}, 파일 ${keepFiles.length}건`
      );
    } else if (run.subs.size === 0) {
      console.log(`[herushi] ${dept} 방: 화면은 벗어났지만 답은 이미 전달됐습니다 — 보관하지 않습니다`);
    }

    send({ type: 'done', usage: {} });
    } catch (err) {
      console.error('[herushi] 마무리 중 오류:', err);
      send({ type: 'error', error: '마무리 중 서버 오류가 났습니다. 서버 창 로그를 확인해 주세요.' });
    } finally {
      clearTimeout(timer);
      run.finished = true;
      runs.delete(dept);
      for (const sub of run.subs) {
        try { sub.write('data: [DONE]\n\n'); } catch {}
        try { sub.end(); } catch {}
      }
      run.subs.clear();
    }
  });
}

/* ------------------------------------------------------------------ */
/* HTTP 서버                                                            */
/* ------------------------------------------------------------------ */

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (path.startsWith('/api/')) {
    if (ACCESS_CODE && req.headers['x-access-code'] !== ACCESS_CODE && path === '/api/chat') {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: '접속 코드가 맞지 않습니다. 앱 설정에서 입력해 주세요.' }));
    }
    if (path === '/api/chat' && req.method === 'POST') {
      let body;
      try {
        body = JSON.parse((await readBody(req)).toString('utf8'));
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: '요청을 읽지 못했습니다.' }));
      }
      return handleChat(req, res, body);
    }
    if (path === '/api/google/config') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ enabled: false, clientId: '' }));
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: '로컬 브릿지 모드에서는 지원하지 않는 기능입니다.' }));
  }

  // 정적 파일
  let rel = path === '/' ? '/index.html' : path;
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': STATIC_TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('없는 경로입니다: ' + path);
  }
});

/** 검증 친구가 실제로 부를 수 있는 상태인지 켤 때 한 번 확인한다. */
function checkVerifier() {
  return new Promise((resolve) => {
    if (VERIFY === 'off') return resolve(false);
    // codex 는 --version 이 로그인 없이도 성공한다. 미로그인 상태로 exec 를
    // 부르면 브라우저 인증을 기다리며 매달리므로, 로그인까지 확인한다.
    const args = VERIFIER_CMD === 'codex' ? ['login', 'status'] : ['--version'];
    const c = spawnCli(VERIFIER_CMD, args);
    c.on('error', () => resolve(false));
    c.stdout.resume(); c.stderr.resume();
    c.on('close', (code) => resolve(code === 0));
  });
}

// 요청 하나가 잘못돼도 서버 전체가 내려가면 안 된다. 원인은 로그로 남긴다.
process.on('unhandledRejection', (e) => console.error('[herushi] 처리 안 된 거부:', e));
process.on('uncaughtException', (e) => console.error('[herushi] 잡히지 않은 예외:', e));

await mkdir(INBOX, { recursive: true });
verifierReady = await checkVerifier();
server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log('헤뤼싀 로컬 브릿지가 켜졌습니다. (구독으로 돕니다 — API 과금 없음)');
  console.log(`  작업 폴더   ${HOME}`);
  console.log(`  이 컴퓨터   http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  휴대폰에서  http://${ip}:${PORT}   (같은 와이파이)`);
  console.log(`  권한 모드   ${PERMISSION} · 허용 도구: ${ALLOWED_TOOLS.join(', ')}`);
  console.log(ACCESS_CODE ? '  접속 코드   설정됨' : '  접속 코드   없음 — HERUSHI_CODE 로 설정을 권합니다');
  console.log(
    verifierReady
      ? `  검증 친구   ${VERIFIER_NAME} (${VERIFIER_CMD}) — 결과를 교차 검토합니다`
      : VERIFY === 'off'
        ? '  검증 친구   껐음 (HERUSHI_VERIFY=off)'
        : `  검증 친구   없음 — ${VERIFIER_CMD} 설치·로그인하면 결과를 교차 검토합니다`
  );
});
