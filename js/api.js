/**
 * 헤뤼싀 대화 전송.
 *
 * 두 가지 모드:
 *  - server : 같은 도메인의 /api/chat 서버리스 함수를 거친다. API 키는 서버에만 있다. (권장)
 *  - direct : 브라우저에서 Anthropic API를 직접 호출한다. 키가 이 기기에 저장된다.
 */

import { corePersona, routingRules, departmentRules, situationBlock, toolDoctrine } from './persona.js';
import { DEPARTMENTS, getDept } from './departments.js';
import { attachmentPayload } from './files.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TURNS = 40; // 최근 대화만 보낸다

/** 부서/설정에 맞는 시스템 프롬프트를 만든다. */
export function buildSystemPrompt(deptId, settings) {
  const dept = getDept(deptId);
  const ctx = {
    ownerName: settings.ownerName,
    honorific: settings.honorific,
    ownerNote: settings.ownerNote,
  };

  const parts = [corePersona(ctx)];
  if (dept.isRoom) {
    // 과업 방. 이 방이 무엇을 하는 방인지만 알려주면 됩니다 — 나머지 지침은
    // 그 과업 폴더의 CLAUDE.md 가 컴퓨터 쪽에서 자동으로 붙습니다.
    parts.push(
      `## 이 방

**${dept.name}** 과업 방입니다.` +
        (dept.scope ? ` 지금 하는 일: ${dept.scope}` : '') +
        `

이 방의 이야기는 이 과업으로 한정합니다. 다른 과업 이야기가 나오면 그 과업 방에서 하자고 말씀드리세요.`
    );
  } else if (dept.id === 'chief') {
    parts.push(routingRules(DEPARTMENTS));
  } else {
    parts.push(departmentRules(dept));
  }
  // 도구를 쓰는 모드일 때만 부서별 도구 지침을 붙인다
  if (settings.tools !== false && settings.mode !== 'direct' && !dept.isRoom) {
    parts.push(toolDoctrine(dept));
  }
  parts.push(situationBlock(new Date()));
  return parts.join('\n');
}

/**
 * 저장된 메시지를 Anthropic messages 배열로 변환.
 * 첨부가 붙은 사용자 메시지는 문자열 대신 블록 배열이 된다.
 */
export function buildMessages(chatMessages) {
  const usable = chatMessages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.error)
    .filter((m) => m.text.trim() || m.attachments?.length)
    .slice(-MAX_TURNS)
    .map((m) => {
      if (m.role === 'user' && m.attachments?.length) {
        return {
          role: 'user',
          content: m.text.trim() || '(첨부를 봐 주세요)',
          attachments: m.attachments.map((a) => a.id),
        };
      }
      return {
        role: m.role,
        content: m.role === 'assistant' && m.dept ? `[[dept:${m.dept}]]\n${m.text}` : m.text,
      };
    });

  // 첫 메시지는 반드시 user 여야 한다
  while (usable.length && usable[0].role !== 'user') usable.shift();

  // 같은 role 이 연속되면 합친다. 첨부가 붙은 쪽은 합치지 않는다.
  const merged = [];
  for (const m of usable) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role && !prev.attachments && !m.attachments) {
      prev.content += '\n\n' + m.content;
    } else {
      merged.push({ ...m });
    }
  }
  return merged;
}

export class ChatError extends Error {
  constructor(message, kind = 'unknown') {
    super(message);
    this.kind = kind;
  }
}

/**
 * 스트리밍으로 답장을 받는다.
 *
 * @param {object} opts
 * @param {string} opts.deptId
 * @param {Array}  opts.messages   저장된 대화
 * @param {object} opts.settings
 * @param {object} [opts.workspace] 비서실 자료실 (서버 모드에서만 쓰인다)
 * @param {string} [opts.container] 이어 쓸 코드 실행 컨테이너 id
 * @param {AbortSignal} opts.signal
 * @param {(t:string)=>void} opts.onDelta
 * @param {()=>void} [opts.onStart]
 * @param {(evt:{name:string,label?:string,phase:string})=>void} [opts.onTool] 도구 활동
 * @param {(file:{name:string,mime:string,size:number,data:string})=>void} [opts.onFile]
 * @param {(ws:object)=>void} [opts.onWorkspace]
 * @param {(info:{container?:string})=>void} [opts.onDone]
 * @param {(m:{localId:string, fileId:string})=>void} [opts.onAttachmentId] 서버가 올린 첨부의 file_id
 * @returns {Promise<string>} 전체 응답 텍스트
 */
/**
 * 로컬 브릿지 전용: 새 메시지를 보내지 않고, 그 방에서 돌고 있는 작업에 붙는다.
 * 화면으로 돌아왔을 때 진행 상황을 이어 보거나, 이미 끝난 결과를 받기 위한 것.
 * 브릿지가 아닌 배포(Vercel)에서는 그냥 done 만 오고 조용히 끝난다.
 */
/**
 * 로컬 브릿지에서 지금 열려 있는 과업 방 목록.
 * 브릿지가 아닌 배포(Vercel)에서는 빈 목록이 옵니다 — 방은 폴더에 매인 개념이라
 * 컴퓨터가 있어야 성립합니다.
 */
export async function fetchRooms(settings = {}) {
  try {
    const res = await fetch('/api/rooms', {
      headers: settings.accessCode ? { 'x-access-code': settings.accessCode } : {},
    });
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j.rooms) ? j.rooms : [];
  } catch {
    return [];
  }
}

export async function attachChat(opts) {
  const { deptId, settings } = opts;
  return streamServer({ ...opts, system: '', payload: [], attach: true });
}

export async function sendChat(opts) {
  const { deptId, messages, settings } = opts;
  const system = buildSystemPrompt(deptId, settings);
  const payload = buildMessages(messages);
  if (!payload.length) throw new ChatError('보낼 메시지가 없습니다.', 'empty');

  if (settings.mode === 'direct') {
    if (payload.some((m) => m.attachments?.length)) {
      throw new ChatError('직접 연결 모드에서는 첨부를 보낼 수 없습니다. 설정에서 서버 프록시로 바꿔 주세요.', 'no-attach');
    }
    return streamDirect({ ...opts, system, payload });
  }
  return streamServer({ ...opts, system, payload, attachments: await collectAttachments(payload, messages) });
}

/** 보낼 메시지에 걸린 첨부만 골라 실제 내용(또는 이미 올린 file_id)을 챙긴다. */
async function collectAttachments(payload, messages) {
  const needed = new Set(payload.flatMap((m) => m.attachments || []));
  if (!needed.size) return undefined;

  const refs = new Map();
  for (const m of messages) {
    for (const a of m.attachments || []) {
      if (needed.has(a.id)) refs.set(a.id, a);
    }
  }

  const out = {};
  for (const [id, ref] of refs) {
    const p = await attachmentPayload(ref).catch(() => null);
    if (p) out[id] = p;
  }
  return Object.keys(out).length ? out : undefined;
}

/* ------------------------------------------------------------------ */
/* 서버 프록시 모드                                                     */
/* ------------------------------------------------------------------ */

async function streamServer(opts) {
  const { deptId, system, payload, settings, signal } = opts;
  let res;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(settings.accessCode ? { 'x-access-code': settings.accessCode } : {}),
      },
      body: JSON.stringify({
        dept: deptId,
        system,
        messages: payload,
        model: settings.model,
        effort: settings.effort,
        tools: settings.tools !== false,
        workspace: opts.workspace || undefined,
        container: opts.container || undefined,
        attachments: opts.attachments,
        google: opts.google || undefined,
        attach: opts.attach || undefined,
      }),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ChatError('서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.', 'network');
  }

  if (!res.ok) {
    const detail = await safeJSON(res);
    if (res.status === 404 || res.status === 405) {
      throw new ChatError(
        '서버 프록시(/api/chat)가 없습니다. Vercel 같은 곳에 배포했거나, 설정에서 “직접 연결”로 바꿔야 합니다.',
        'no-proxy'
      );
    }
    if (res.status === 401) throw new ChatError(detail?.error || '접속 코드가 맞지 않습니다.', 'auth');
    if (res.status === 429) throw new ChatError('요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.', 'rate');
    throw new ChatError(detail?.error || `서버 오류 (${res.status})`, 'server');
  }

  // 로컬 브릿지는 done 이벤트로 끝을 알린다. 그게 없이 스트림이 끊겼다면
  // 서버가 죽은 게 아니라 연결만 끊긴 것이다(폰이 화면을 벗어날 때 iOS 가
  // 끊는다). 일은 서버에서 계속되므로 실패가 아니라 '끊김'으로 알린다.
  return consumeSSE(res, { ...opts, resumable: true });
}

/* ------------------------------------------------------------------ */
/* 브라우저 직접 호출 모드                                              */
/* ------------------------------------------------------------------ */

async function streamDirect(opts) {
  const { system, payload, settings, signal } = opts;
  if (!settings.apiKey) {
    throw new ChatError('직접 연결 모드입니다. 설정에서 Anthropic API 키를 넣어 주세요.', 'no-key');
  }

  const body = {
    model: settings.model || 'claude-opus-5',
    max_tokens: 4096,
    system,
    messages: payload,
    stream: true,
    output_config: { effort: settings.effort || 'low' },
  };

  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ChatError('Anthropic API에 연결하지 못했습니다.', 'network');
  }

  if (!res.ok) {
    const detail = await safeJSON(res);
    const msg = detail?.error?.message || `API 오류 (${res.status})`;
    if (res.status === 401) throw new ChatError('API 키가 올바르지 않습니다.', 'auth');
    if (res.status === 429) throw new ChatError('요청 한도를 넘었습니다. 잠시 후 다시 시도해 주세요.', 'rate');
    throw new ChatError(msg, 'api');
  }

  return consumeSSE(res, opts);
}

/* ------------------------------------------------------------------ */
/* SSE 파서 — 서버 프록시와 Anthropic 원본 이벤트를 모두 처리한다        */
/* ------------------------------------------------------------------ */

async function consumeSSE(res, handlers) {
  if (!res.body) throw new ChatError('응답 본문을 읽을 수 없습니다.', 'stream');

  const { onDelta, onStart, onTool, onFile, onWorkspace, onDone, onAttachmentId, onDraft, onVerifier, onFollowup, onReset, onRooms, resumable } = handlers;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let started = false;
  let closed = false;   // 서버가 done 으로 제대로 끝맺었나

  const push = (t) => {
    if (!t) return;
    if (!started) {
      started = true;
      onStart?.();
    }
    full += t;
    onDelta?.(t);
  };

  const handle = (evt) => {
    switch (evt.type) {
      // 서버 프록시가 보내는 형태
      case 'delta':
        if (typeof evt.text === 'string') push(evt.text);
        break;
      case 'tool':
        onTool?.(evt);
        break;
      case 'file':
        onFile?.(evt);
        break;
      case 'workspace':
        onWorkspace?.(evt.workspace);
        break;
      case 'attachment_id':
        onAttachmentId?.(evt);
        break;
      case 'draft':
        onDraft?.(evt.draft);
        break;
      // 로컬 브릿지 전용: 검증 친구의 검토와, 그에 대한 헤뤼싀의 답
      case 'verifier':
        onVerifier?.(evt);
        break;
      case 'followup':
        onFollowup?.(evt);
        break;
      // 로컬 브릿지 전용: 도구를 부르느라 새 내부 턴이 시작됐다. 지금까지
      // 이어붙인 진행 서술을 버리고 처음부터 다시 쓴다 — 최종 답만 남기려고.
      case 'reset':
        full = '';
        onReset?.();
        break;
      // 로컬 브릿지 전용: 방이 새로 생겼거나 완료 처리됐다
      case 'rooms':
        onRooms?.(evt.rooms || []);
        break;
      // 로컬 브릿지 전용: 돌고 있던 작업에 붙었다. 이어서 지금까지의 기록이
      // 재생되므로, 화면에 남아 있던 조각 위에 겹쳐 쌓이지 않게 먼저 비운다.
      case 'attach':
        full = '';
        // attached: 서버에 정말로 돌고 있는(또는 방금 끝난) 작업이 있어서
        // 이제부터 재생이 온다는 뜻. 붙을 작업이 없으면 이 이벤트 자체가 없다.
        onReset?.({ attached: true });
        break;
      case 'done':
        closed = true;
        onDone?.(evt);
        break;
      case 'error': {
        const msg = typeof evt.error === 'string' ? evt.error : evt.error?.message;
        throw new ChatError(msg || '응답 중 오류가 발생했습니다.', 'stream');
      }
      // Anthropic 원본 이벤트 (직접 연결 모드)
      case 'content_block_delta':
        if (evt.delta?.type === 'text_delta') push(evt.delta.text);
        break;
      default:
        break;
    }
  };

  // 끊김은 실패가 아니다 — 로컬 브릿지에서는 서버가 계속 일하고 있고,
  // 화면으로 돌아가면 다시 붙어서 그 뒤를 이어 볼 수 있다.
  const dropped = () => new ChatError('연결이 끊겼습니다. 서버는 계속 일하는 중입니다.', 'dropped');

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        const dataLines = raw
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim());
        if (!dataLines.length) continue;

        const data = dataLines.join('\n');
        if (data === '[DONE]') continue;

        let evt;
        try {
          evt = JSON.parse(data);
        } catch {
          continue;
        }
        handle(evt);
      }
    }
  } catch (err) {
    if (err instanceof ChatError || err?.name === 'AbortError') throw err;
    if (resumable && !closed) throw dropped();
    throw err;
  }

  // 서버가 done 을 보내기 전에 스트림이 닫혔다 (iOS 가 백그라운드에서 끊는 경우)
  if (resumable && !closed) throw dropped();

  return full;
}

async function safeJSON(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * 응답 맨 앞의 [[dept:xxx]] 태그를 떼어낸다.
 * 스트리밍 중에도 안전하게 쓸 수 있도록, 태그가 아직 덜 도착했으면 보류한다.
 * @returns {{dept:string|null, text:string, pending:boolean}}
 */
export function parseDeptTag(raw) {
  const s = raw.replace(/^\s+/, '');
  const done = s.match(/^\[\[dept:\s*([a-z_-]+)\s*\]\]\s*/i);
  if (done) {
    return { dept: done[1].toLowerCase(), text: s.slice(done[0].length), pending: false };
  }
  // 태그가 절반쯤 도착한 상태
  if (/^\[?\[?d?e?p?t?:?[a-z_-]*\]?\]?$/i.test(s) && s.length < 24 && s.startsWith('[')) {
    return { dept: null, text: '', pending: true };
  }
  return { dept: null, text: s, pending: false };
}
