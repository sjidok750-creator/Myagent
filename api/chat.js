/**
 * 헤뤼싀 서버 — 에이전트 루프.
 *
 * 브라우저는 여기로만 요청을 보낸다. Anthropic API 키는 서버 환경변수에만 있다.
 *
 * 헤뤼싀가 쓰는 도구
 *  - 웹 검색 / 웹 페이지 읽기      : Anthropic 서버에서 실행
 *  - 코드 실행 (계산·분석·파일 생성): Anthropic 샌드박스에서 실행
 *  - Agent Skills (xlsx/pptx/docx/pdf)
 *  - 비서실 자료실 (메모·할일·인물) : 여기 서버에서 실행. 상태의 주인은 사용자 기기다.
 *
 * 응답은 SSE 로 흘려보낸다.
 *   {type:'delta', text}                  본문 조각
 *   {type:'tool', name, label, phase}     도구 활동 (화면에 "웹 검색 중…")
 *   {type:'file', name, mime, size, data} 만들어진 파일 (base64)
 *   {type:'workspace', workspace}         바뀐 자료실 상태
 *   {type:'done', usage, container}       끝
 *   {type:'error', error}                 오류
 *
 * 서버는 대화도 자료실도 저장하지 않는다. 받은 것을 처리해 돌려줄 뿐이다.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  WORKSPACE_TOOLS,
  WORKSPACE_TOOL_NAMES,
  runWorkspaceTool,
  normalizeWorkspace,
  workspaceDigest,
} from './_lib/workspace.js';
import {
  CALENDAR_TOOLS,
  GMAIL_TOOLS,
  GOOGLE_TOOL_NAMES,
  runGoogleTool,
} from './_lib/google.js';
import {
  normalizeAttachments,
  uploadAttachments,
  toContentBlocks,
  needsContainer,
} from './_lib/attachments.js';

const DEFAULT_MODEL = process.env.HERUSHI_MODEL || 'claude-opus-5';
const ALLOWED_MODELS = new Set(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']);
const ALLOWED_EFFORT = new Set(['low', 'medium', 'high']);

const BETAS = ['code-execution-2025-08-25', 'skills-2025-10-02', 'files-api-2025-04-14'];

/**
 * 웹 검색은 기본 변형(web_search_20250305)을 쓴다.
 * 최신 변형(_20260209)은 내부적으로 코드 실행을 돌리기 때문에
 * code_execution 을 따로 선언하면 실행 환경이 둘이 되어 모델이 헷갈린다.
 * 헤뤼싀에게는 파일 생성(엑셀·PPT)이 더 중요하므로 코드 실행을 살린다.
 */
const SERVER_TOOLS = [
  { type: 'web_search_20250305', name: 'web_search', max_uses: 8 },
  { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 6 },
  { type: 'code_execution_20260521', name: 'code_execution' },
];

const SKILLS = [
  { type: 'anthropic', skill_id: 'xlsx', version: 'latest' },
  { type: 'anthropic', skill_id: 'docx', version: 'latest' },
  { type: 'anthropic', skill_id: 'pptx', version: 'latest' },
  { type: 'anthropic', skill_id: 'pdf', version: 'latest' },
];

const TOOL_LABELS = {
  web_search: '웹을 찾아보는 중',
  web_fetch: '페이지를 읽는 중',
  code_execution: '계산하고 정리하는 중',
  bash_code_execution: '계산하고 정리하는 중',
  note_save: '자료실에 적어두는 중',
  note_search: '자료실을 뒤지는 중',
  note_delete: '메모를 지우는 중',
  task_add: '할 일을 등록하는 중',
  task_update: '할 일을 갱신하는 중',
  task_list: '할 일을 확인하는 중',
  person_save: '사람을 기록하는 중',
  person_find: '인맥을 찾아보는 중',
  calendar_list: '캘린더를 확인하는 중',
  calendar_create: '일정을 잡는 중',
  calendar_update: '일정을 고치는 중',
  calendar_delete: '일정을 지우는 중',
  gmail_search: '메일함을 뒤지는 중',
  gmail_read: '메일을 읽는 중',
  gmail_draft: '메일 초안을 쓰는 중',
};

const MAX_STEPS = 12;          // 도구 왕복 상한
const MAX_MESSAGES = 60;
const MAX_CHARS = 200_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const RATE = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'POST 만 지원합니다.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: '서버에 ANTHROPIC_API_KEY 가 설정되어 있지 않습니다. 배포 환경변수를 확인해 주세요.',
    });
  }

  const required = process.env.ACCESS_CODE;
  if (required && req.headers['x-access-code'] !== required) {
    return res.status(401).json({ error: '접속 코드가 맞지 않습니다. 설정에서 다시 입력해 주세요.' });
  }

  if (!allowRate(clientKey(req))) {
    return res.status(429).json({ error: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: '요청 본문을 읽을 수 없습니다.' });
  }

  const check = validate(body);
  if (check.error) return res.status(check.status).json({ error: check.error });

  const { messages, systemBase, deptId } = check;
  const model = ALLOWED_MODELS.has(body.model) ? body.model : DEFAULT_MODEL;
  const effort = ALLOWED_EFFORT.has(body.effort) ? body.effort : 'low';
  const useTools = body.tools !== false;

  const workspace = normalizeWorkspace(body.workspace);
  const attachments = useTools ? normalizeAttachments(body.attachments) : {};
  const googleToken =
    useTools && body.google && typeof body.google.accessToken === 'string'
      ? body.google.accessToken
      : null;
  const googleEmail = typeof body.google?.email === 'string' ? body.google.email.slice(0, 200) : '';

  const system = useTools
    ? systemBase + toolRules(!!googleToken, googleEmail) + workspaceDigest(workspace)
    : systemBase;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (obj) => {
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    } catch {
      /* 연결이 끊긴 경우 */
    }
  };

  const client = new Anthropic({ apiKey });
  const controller = new AbortController();
  let closed = false;
  req.on('close', () => {
    closed = true;
    controller.abort();
  });

  try {
    await runAgent({
      client, send, controller, model, effort, system, messages,
      workspace, deptId, useTools, attachments, googleToken,
      containerIn: typeof body.container === 'string' ? body.container : null,
      isClosed: () => closed,
    });
  } catch (err) {
    if (!controller.signal.aborted) {
      console.error('[herushi]', err?.status, err?.message);
      send({ type: 'error', error: humanError(err) });
    }
  }
  try {
    res.end();
  } catch {
    /* 이미 닫힘 */
  }
}

/* ------------------------------------------------------------------ */
/* 에이전트 루프                                                       */
/* ------------------------------------------------------------------ */

export async function runAgent(ctx) {
  const {
    client, send, controller, model, effort, system, messages,
    workspace, deptId, useTools, containerIn, isClosed,
  } = ctx;
  const attachments = ctx.attachments || {};
  const googleToken = ctx.googleToken || null;

  // 첨부를 먼저 올려 두고, 메시지를 블록 배열로 바꾼다
  if (useTools && Object.keys(attachments).length) {
    await uploadAttachments(client, attachments, send);
  }
  const convo = messages.map((m) =>
    m.attachments?.length
      ? { role: m.role, content: toContentBlocks(m, attachments) }
      : { role: m.role, content: m.content }
  );
  const seenFiles = new Set();
  let container = containerIn;
  let workspaceChanged = false;
  let usage = null;
  let droppedContainer = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    if (isClosed()) return;

    const params = {
      model,
      max_tokens: 8192,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: convo,
      output_config: { effort },
    };

    if (useTools) {
      params.tools = [...SERVER_TOOLS, ...WORKSPACE_TOOLS];
      if (googleToken) params.tools.push(...CALENDAR_TOOLS, ...GMAIL_TOOLS);
      params.betas = BETAS;
      params.container = container ? container : { skills: SKILLS };
    }

    let message;
    try {
      message = await streamOnce(client, params, controller, send, useTools);
    } catch (err) {
      // 컨테이너가 만료됐으면 한 번은 새 컨테이너로 다시 시도한다
      if (!droppedContainer && container && isContainerError(err)) {
        droppedContainer = true;
        container = null;
        step--;
        continue;
      }
      throw err;
    }

    usage = message.usage || usage;
    if (message.container?.id) container = message.container.id;

    // 만들어진 파일 내보내기
    if (useTools) {
      await pushFiles({ client, send, content: message.content, seenFiles, isClosed });
    }

    if (message.stop_reason === 'refusal') {
      send({
        type: 'error',
        error: '이 요청은 처리할 수 없습니다. 다른 방식으로 물어봐 주세요.',
      });
      break;
    }

    // 서버 도구가 반복 상한에 걸린 경우 — 그대로 이어서 계속한다
    if (message.stop_reason === 'pause_turn') {
      convo.push({ role: 'assistant', content: message.content });
      continue;
    }

    if (message.stop_reason !== 'tool_use') break;

    const calls = message.content.filter(
      (b) =>
        b.type === 'tool_use' &&
        (WORKSPACE_TOOL_NAMES.has(b.name) || GOOGLE_TOOL_NAMES.has(b.name))
    );
    if (!calls.length) break; // 서버 도구만 있었다면 여기 오지 않는다

    convo.push({ role: 'assistant', content: message.content });

    const results = [];
    for (const call of calls) {
      let r;
      if (GOOGLE_TOOL_NAMES.has(call.name)) {
        r = await runGoogleTool(call.name, call.input, googleToken);
        // 메일 초안이 생기면 화면에 "보내기" 카드를 띄운다
        if (r.draft) send({ type: 'draft', draft: r.draft });
      } else {
        r = runWorkspaceTool(call.name, call.input, workspace, deptId);
        if (r.changed) workspaceChanged = true;
      }
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: r.text,
        ...(r.ok ? {} : { is_error: true }),
      });
    }

    convo.push({ role: 'user', content: results });

    if (step === MAX_STEPS - 1) {
      send({ type: 'delta', text: '\n\n(도구를 너무 많이 썼습니다. 여기까지 정리해 드립니다.)' });
    }
  }

  if (workspaceChanged) send({ type: 'workspace', workspace });
  send({ type: 'done', usage, container });
}

/** 한 번의 API 호출을 스트리밍하며 본문과 도구 활동을 흘려보낸다. */
async function streamOnce(client, params, controller, send, useTools) {
  const endpoint = useTools ? client.beta.messages : client.messages;
  const stream = endpoint.stream(params, { signal: controller.signal });

  const active = new Set();

  stream.on('streamEvent', (event) => {
    if (event.type !== 'content_block_start') return;
    const block = event.content_block;
    if (!block) return;

    if (block.type === 'tool_use' || block.type === 'server_tool_use') {
      const label = TOOL_LABELS[block.name];
      if (label && !active.has(block.name)) {
        active.add(block.name);
        send({ type: 'tool', name: block.name, label, phase: 'start' });
      }
    } else if (block.type === 'text' && active.size) {
      for (const name of active) send({ type: 'tool', name, phase: 'end' });
      active.clear();
    }
  });

  stream.on('text', (delta) => {
    if (delta) send({ type: 'delta', text: delta });
  });

  const message = await stream.finalMessage();
  for (const name of active) send({ type: 'tool', name, phase: 'end' });
  return message;
}

/** 코드 실행이 만든 파일을 찾아 내려받아 클라이언트로 보낸다. */
async function pushFiles({ client, send, content, seenFiles, isClosed }) {
  for (const block of content) {
    if (block.type !== 'bash_code_execution_tool_result') continue;
    const result = block.content;
    if (!result || result.type !== 'bash_code_execution_result') continue;
    for (const ref of result.content || []) {
      if (ref?.type !== 'bash_code_execution_output' || !ref.file_id) continue;
      if (seenFiles.has(ref.file_id)) continue;
      seenFiles.add(ref.file_id);
      if (isClosed()) return;

      try {
        const meta = await client.beta.files.retrieveMetadata(ref.file_id, {
          betas: ['files-api-2025-04-14'],
        });
        if (meta.size_bytes && meta.size_bytes > MAX_FILE_BYTES) {
          send({ type: 'tool', name: 'file_too_big', label: `${meta.filename} 은 너무 커서 보내지 못했습니다`, phase: 'note' });
          continue;
        }
        const dl = await client.beta.files.download(ref.file_id, {
          betas: ['files-api-2025-04-14'],
        });
        const bytes = Buffer.from(await dl.arrayBuffer());
        if (bytes.length > MAX_FILE_BYTES) continue;

        send({
          type: 'file',
          name: safeName(meta.filename),
          mime: meta.mime_type || 'application/octet-stream',
          size: bytes.length,
          data: bytes.toString('base64'),
        });
      } catch (err) {
        console.error('[herushi] 파일 내려받기 실패', ref.file_id, err?.message);
      }
    }
  }
}

/* ------------------------------------------------------------------ */

function toolRules(hasGoogle, googleEmail) {
  const google = hasGoogle
    ? `
- **구글 캘린더** — 대표님 실제 캘린더${googleEmail ? ` (${googleEmail})` : ''} 를 읽고 쓴다.
  일정을 잡기 전에는 반드시 \`calendar_list\` 로 그 시간이 비었는지 먼저 본다.
  겹치면 잡지 말고 대안을 두 개 낸다. 일정을 지우는 것은 되돌릴 수 없으니 분명한 지시가 있을 때만 한다.
- **지메일** — 메일을 검색하고 읽는다. 답장·발송은 \`gmail_draft\` 로 **초안까지만** 만든다.
  네가 메일을 직접 보낼 수는 없다. 초안을 만들면 대화창에 "보내기" 버튼이 뜨고,
  대표님이 그걸 눌러야 나간다. 초안을 만든 뒤에는 "확인하시고 보내기를 눌러 주세요" 라고 안내한다.`
    : `
- 구글 캘린더와 지메일은 아직 연결되어 있지 않다. 일정이나 메일 관련 부탁을 받으면
  자료실에 할 일로 적어 두고, 설정 화면에서 구글 계정을 연결하시면 실제 캘린더와 메일함을
  직접 다룰 수 있다고 한 줄로 안내한다.`;

  return `

# 네가 쓸 수 있는 도구
- **웹 검색 / 페이지 읽기** — 오늘의 사실이 필요하면 반드시 찾아본다. 기억에 의존해 최신 정보를 말하지 않는다.
  찾아본 내용을 전할 땐 출처를 한 줄로 밝힌다.
- **코드 실행** — 계산, 표 정리, 데이터 분석. 암산으로 어림잡지 말고 실제로 계산한다.
- **파일 만들기** — 코드 실행 안에서 엑셀(xlsx)·워드(docx)·발표자료(pptx)·PDF 를 만들 수 있다.
  대표님이 "정리해줘", "표로", "문서로", "자료 만들어줘" 라고 하면 말로만 답하지 말고 파일로 만들어 드린다.
  파일을 만들었으면 무엇을 담았는지 두 줄로 설명한다. 파일은 대화창에 자동으로 첨부된다.
- **파일 읽기** — 대표님이 보낸 사진·PDF·문서는 대화에 그대로 들어온다. 엑셀·워드처럼 바로 못 읽는 형식은
  코드 실행 컨테이너에 올라와 있으니 코드로 열어서 본다.
- **비서실 자료실** — 메모·할 일·사람을 적고 찾는다. 여덟 팀이 같은 자료실을 본다.${google}

# 도구를 쓰는 원칙
1. 대표님이 알려준 사실 중 나중에 또 필요할 것은 그 자리에서 \`note_save\` 로 남긴다. 묻지 않고 그냥 한다.
2. "해줘/하기로 했다/까지 해야 한다" 가 나오면 \`task_add\` 로 등록한다. 기한을 모르면 물어본다.
3. 새 사람이 등장하면 \`person_save\` 로 기록한다.
4. 도구를 쓴 사실을 장황하게 보고하지 않는다. "적어뒀습니다" 한마디면 충분하다.
5. 도구가 실패하면 실패했다고 말한다. 성공한 척하지 않는다.
6. 되돌리기 어려운 일(일정 삭제, 참석자 초대, 메일 발송)은 실행 전에 반드시 한 번 확인한다.`;
}

function validate(body) {
  const system = typeof body.system === 'string' ? body.system : '';
  const raw = Array.isArray(body.messages) ? body.messages : [];

  if (!system) return { status: 400, error: 'system 프롬프트가 없습니다.' };
  if (!raw.length) return { status: 400, error: '메시지가 없습니다.' };
  if (raw.length > MAX_MESSAGES) return { status: 400, error: '대화가 너무 깁니다.' };

  const messages = [];
  let total = system.length;
  for (const m of raw) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) {
      return { status: 400, error: '메시지 형식이 올바르지 않습니다.' };
    }
    const content = typeof m.content === 'string' ? m.content : '';
    const atts = Array.isArray(m.attachments)
      ? m.attachments.filter((x) => typeof x === 'string').slice(0, 6)
      : [];
    if (!content.trim() && !atts.length) continue;
    total += content.length;
    messages.push({ role: m.role, content, ...(atts.length ? { attachments: atts } : {}) });
  }

  if (!messages.length) return { status: 400, error: '메시지가 비어 있습니다.' };
  if (messages[0].role !== 'user') return { status: 400, error: '대화는 사용자 메시지로 시작해야 합니다.' };
  if (total > MAX_CHARS) return { status: 413, error: '대화가 너무 깁니다. 대화를 정리한 뒤 다시 시도해 주세요.' };

  return {
    messages,
    systemBase: system,
    deptId: typeof body.dept === 'string' ? body.dept.slice(0, 32) : 'chief',
  };
}

function isContainerError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return err?.status === 404 || msg.includes('container');
}

function safeName(name) {
  const base = String(name || 'file').split(/[\\/]/).pop().trim();
  if (!base || base === '.' || base === '..') return 'file';
  return base.slice(0, 120);
}

function humanError(err) {
  const status = err?.status;
  if (status === 401) return 'Anthropic API 키가 올바르지 않습니다. 서버 환경변수를 확인해 주세요.';
  if (status === 429) return 'Anthropic 요청 한도를 넘었습니다. 잠시 후 다시 시도해 주세요.';
  if (status === 400) return `요청이 거부되었습니다: ${err?.message || '알 수 없는 이유'}`;
  if (status >= 500) return 'Anthropic 서버에 문제가 있습니다. 잠시 후 다시 시도해 주세요.';
  return err?.message || '알 수 없는 오류가 발생했습니다.';
}

function clientKey(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function allowRate(key) {
  const now = Date.now();
  const hits = (RATE.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    RATE.set(key, hits);
    return false;
  }
  hits.push(now);
  RATE.set(key, hits);
  if (RATE.size > 500) RATE.clear();
  return true;
}
