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

function spawnClaude(args) {
  if (process.platform === 'win32') {
    // Windows 에서 claude 는 .cmd 라 셸이 필요하고, 셸을 거치면 인용이 문제가
    // 된다. 인자를 직접 인용해 한 줄로 만든다. 긴 본문은 전부 stdin/파일로
    // 가므로 여기 오는 인자는 짧다.
    const line = ['claude', ...args].map((a) => '"' + String(a).replace(/"/g, '""') + '"').join(' ');
    return spawn(line, { shell: true, cwd: HOME, env: cliEnv() });
  }
  return spawn('claude', args, { cwd: HOME, env: cliEnv() });
}

/* ------------------------------------------------------------------ */
/* 프롬프트 조립                                                        */
/* ------------------------------------------------------------------ */

const BRIDGE_DOCTRINE = `
## 로컬 브릿지에서 일할 때

지금 대표님은 휴대폰 화면으로 대화하고 있고, 당신은 대표님 컴퓨터의 ${HOME} 폴더에서 일하고 있습니다.

- 완성한 파일(보고서·표·문서)은 이 폴더나 하위 폴더에 저장하세요. 저장된 파일은 자동으로 대표님 휴대폰 대화창에 전송됩니다.
- 대표님이 보낸 첨부는 받은파일/ 폴더에 있습니다. 경로가 본문에 적혀 있습니다.
- 휴대폰 화면이므로 답은 간결하게. 긴 내용은 파일로 만들어 전하세요.
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

async function collectNewFiles(since) {
  const found = [];
  async function walk(dir, depth) {
    if (depth > 3) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
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
  const send = (evt) => res.write(`data: ${JSON.stringify(evt)}\n\n`);

  const startedAt = Date.now();
  const sessions = await loadSessions();
  const prevSession = sessions[dept];

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
  const timer = setTimeout(() => child.kill('SIGTERM'), RUN_TIMEOUT_MS);
  req.on('close', () => {
    clearTimeout(timer);
    child.kill('SIGTERM');
  });

  child.stdin.on('error', () => {});
  child.stdin.end(buildPrompt(messages, !!prevSession, attachedPaths));

  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));

  let sessionId = null;
  let gotText = false;
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
        send({ type: 'delta', text: e.delta.text });
      }
    }
  }

  child.on('close', async (code) => {
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

    try {
      for (const f of await collectNewFiles(startedAt)) send({ type: 'file', ...f });
    } catch {}

    if (sessionId) await saveSession(dept, sessionId).catch(() => {});
    send({ type: 'done', usage: {} });
    res.write('data: [DONE]\n\n');
    res.end();
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

await mkdir(INBOX, { recursive: true });
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
});
