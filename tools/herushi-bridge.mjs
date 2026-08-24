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
import { readFile, writeFile, stat, mkdir, readdir } from 'node:fs/promises';
import { extname, join, normalize, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, networkInterfaces, tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

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

- 완성한 파일(보고서·표·문서)은 이 폴더나 하위 폴더에 저장하세요. 저장된 파일은 자동으로 대표님 휴대폰 대화창에 전송됩니다.
- 대표님이 보낸 첨부는 받은파일/ 폴더에 있습니다. 경로가 본문에 적혀 있습니다.
- 휴대폰 화면이므로 답은 간결하게. 긴 내용은 파일로 만들어 전하세요.

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
function verifierPrompt(userAsk, answer, filePaths) {
  return `당신은 문서 검증자입니다. 이 답을 만든 사람과 대화한 적이 없고 의도를 모릅니다. 그게 이 일에 필요한 조건입니다.

[사용자의 요청]
${userAsk}

[작성자의 답]
${answer}
${filePaths.length ? `\n[작성자가 만든 파일 — 직접 열어 확인하세요]\n${filePaths.map((p) => '- ' + p).join('\n')}\n` : ''}
## 할 일

답 속의 사실 주장(숫자·날짜·이름·계산·단정 서술)을 하나씩 검토하세요. 파일이 있으면 열어서 내용이 요청·답과 일치하는지 보세요. 계산이 있으면 실제로 계산해 보세요.

## 반드시 지킬 것

- 지적할 때는 위치와 원문을 인용하세요. 인용 없는 지적은 쓰지 마세요.
- 추측("좀 높아 보인다")과 문체 트집은 검증이 아닙니다. 사실만 보세요.
- 문제가 없으면 "문제 없음" 한 줄만 쓰세요. 억지로 찾아내지 마세요.
- 한국어로, 요점만 5줄 이내로 쓰세요.`;
}

function runVerifier(userAsk, answer, filePaths, track) {
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
    child.stdin.end(verifierPrompt(userAsk, answer, filePaths));
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

async function collectNewFiles(since) {
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
        if (p === INBOX) continue; // 받은 것을 되보내지 않는다
        await walk(p, depth + 1);
      } else if (e.isFile()) {
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
    const data = await readFile(f.path).catch(() => null);
    if (!data) continue;
    total += f.size;
    out.push({
      path: f.path,
      name: basename(f.path),
      mime: FILE_TYPES[extname(f.path).toLowerCase()] || 'application/octet-stream',
      size: f.size,
      data: data.toString('base64'),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* /api/chat — 화면 규약(SSE) 그대로                                     */
/* ------------------------------------------------------------------ */

async function handleChat(req, res, body) {
  const { dept = 'chief', system = '', messages = [], attachments, model } = body;
  if (!Array.isArray(messages) || !messages.length) {
    res.writeHead(400, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: '보낼 메시지가 없습니다.' }));
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  // 폰이 먼저 끊겨도(와이파이 이탈, 화면 잠김) 서버는 죽으면 안 된다.
  // 죽은 소켓에 쓰는 순간 예외가 나므로 모든 쓰기를 감싼다.
  res.on('error', () => {});
  const send = (evt) => {
    if (res.writableEnded || res.destroyed) return;
    try { res.write(`data: ${JSON.stringify(evt)}\n\n`); } catch {}
  };
  // 검증자가 도는 동안은 데이터가 몇 분씩 조용할 수 있다. 중간 장비가
  // 유휴 연결로 보고 끊지 않도록 SSE 주석을 심장박동으로 보낸다.
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, 15000);
  res.on('close', () => clearInterval(heartbeat));

  const startedAt = Date.now();
  const sessions = await loadSessions();
  const prevSession = sessions[dept];

  // 지난번에 화면을 벗어나 전하지 못한 답이 있으면 먼저 배달한다
  try {
    const pending = (await loadPending())[dept];
    if (pending) {
      await savePending(dept, undefined);
      if (pending.text) {
        send({ type: 'followup', text: `📨 아까 화면을 벗어나서 전하지 못했던 답입니다.\n\n${pending.text}` });
      }
      for (const p of pending.files || []) {
        const s = await stat(p).catch(() => null);
        if (!s || !s.size || s.size > MAX_FILE_BYTES) continue;
        const data = await readFile(p).catch(() => null);
        if (data) {
          send({
            type: 'file',
            name: basename(p),
            mime: FILE_TYPES[extname(p).toLowerCase()] || 'application/octet-stream',
            size: s.size,
            data: data.toString('base64'),
          });
        }
      }
    }
  } catch {}

  let attachedPaths = [];
  try {
    attachedPaths = await writeAttachments(attachments);
  } catch {
    send({ type: 'tool', name: 'attach', label: '첨부를 저장하지 못했습니다', phase: 'note' });
  }

  const sysFile = join(tmpdir(), `herushi-sys-${randomUUID()}.txt`);
  await writeFile(sysFile, system + '\n' + BRIDGE_DOCTRINE);

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--append-system-prompt-file', sysFile,
    '--permission-mode', PERMISSION,
    '--allowedTools', ...ALLOWED_TOOLS,
  ];
  const wantModel = model || DEFAULT_MODEL;
  if (wantModel) args.push('--model', wantModel);
  if (prevSession) args.push('--resume', prevSession);

  const child = spawnClaude(args);
  const kids = new Set([child]);
  const track = (c) => { kids.add(c); c.on('close', () => kids.delete(c)); };
  const timer = setTimeout(() => { for (const c of kids) c.kill('SIGTERM'); }, RUN_TIMEOUT_MS);
  // 폰이 화면을 벗어나면 iOS 가 연결을 끊지만, 일부러 일을 계속한다.
  // 완성되면 답을 적어 두었다가 다음 요청 때 배달한다 (아래 clientGone 처리).
  // 그래서 화면의 멈춤 버튼은 "그만 보기"이지 "그만 하기"가 아니다.
  // 주의: req 의 'close' 는 Node 버전에 따라 본문 수신 완료 때도 울린다.
  // 진짜 "폰이 떠났다"는 소켓이 닫힐 때이므로 res 쪽에서 듣는다 —
  // res 'close' 는 응답을 우리가 끝냈든 상대가 끊었든 울리니,
  // 우리가 끝내기(res.end) 전에 울렸다면 상대가 끊은 것이다.
  let clientGone = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      clientGone = true;
      console.log('[herushi] 폰이 화면을 벗어났습니다 — 일은 계속합니다');
    }
  });

  child.stdin.on('error', () => {});
  child.stdin.end(buildPrompt(messages, !!prevSession, attachedPaths));

  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));

  let sessionId = null;
  let gotText = false;
  let fullText = '';
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
      return;
    }
    if (obj.type === 'stream_event') {
      const e = obj.event;
      if (e?.type === 'content_block_start' && e.content_block?.type === 'tool_use') {
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
      if (/resume|session/i.test(stderr) && prevSession) await saveSession(dept, undefined);
      console.error(`[herushi] claude 종료 코드 ${code}\n${stderr.slice(0, 2000)}`);
      send({ type: 'error', error: hint });
      return res.end();
    }

    let newFiles = [];
    try {
      newFiles = await collectNewFiles(startedAt);
      for (const f of newFiles) send({ type: 'file', name: f.name, mime: f.mime, size: f.size, data: f.data });
    } catch {}

    if (sessionId) await saveSession(dept, sessionId).catch(() => {});

    /* 검증 친구 차례 — 파일을 만들었거나 실질적인 답일 때.
     * 폰이 이미 떠났으면 건너뛴다 (보는 사람 없는 검토에 한도를 쓰지 않는다). */
    const wantVerify =
      verifierReady &&
      !clientGone &&
      VERIFY !== 'off' &&
      (VERIFY === 'always' || newFiles.length > 0 || fullText.trim().length >= 350);

    if (wantVerify) {
      send({ type: 'tool', name: 'verify', label: `${VERIFIER_NAME}가 검토하는 중`, phase: 'start' });
      const lastAsk = textOf(messages[messages.length - 1]?.content) || '';
      const filePaths = newFiles.map((f) => f.path);
      const v = await runVerifier(lastAsk, fullText.trim(), filePaths, track);
      send({ type: 'tool', name: 'verify', phase: 'end' });

      if (!v.ok) {
        send({
          type: 'tool', name: 'verify', phase: 'note',
          label: v.why === 'login'
            ? `${VERIFIER_NAME}에 로그인이 필요합니다 (터미널에서 ${VERIFIER_CMD} login)`
            : `${VERIFIER_NAME}를 부르지 못했습니다`,
        });
      } else {
        send({ type: 'verifier', name: VERIFIER_NAME, text: v.text });
        const clean = /^문제\s*없음/.test(v.text.trim());
        if (!clean && sessionId) {
          send({ type: 'tool', name: 'fix', label: '헤뤼싀가 검토에 답하는 중', phase: 'start' });
          const fixStart = Date.now();
          const reply = await runFollowup(sessionId, v.text, track);
          send({ type: 'tool', name: 'fix', phase: 'end' });
          if (reply) send({ type: 'followup', text: reply });
          try {
            for (const f of await collectNewFiles(fixStart))
              send({ type: 'file', name: f.name, mime: f.mime, size: f.size, data: f.data });
          } catch {}
        }
      }
    }

    // 폰이 떠난 채 끝났으면 답을 적어 두었다가 다음 요청 때 배달한다
    if (clientGone && (fullText.trim() || newFiles.length)) {
      await savePending(dept, {
        text: fullText.trim(),
        files: newFiles.map((f) => f.path),
        at: Date.now(),
      });
      console.log(`[herushi] ${dept} 방: 화면 이탈 — 답을 보관했다가 다음에 배달합니다`);
    }

    send({ type: 'done', usage: {} });
    } catch (err) {
      console.error('[herushi] 마무리 중 오류:', err);
      send({ type: 'error', error: '마무리 중 서버 오류가 났습니다. 서버 창 로그를 확인해 주세요.' });
    } finally {
      clearInterval(heartbeat);
      try { res.write('data: [DONE]\n\n'); } catch {}
      try { res.end(); } catch {}
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
