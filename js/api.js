/**
 * 헤뤼싀 대화 전송.
 *
 * 두 가지 모드:
 *  - server : 같은 도메인의 /api/chat 서버리스 함수를 거친다. API 키는 서버에만 있다. (권장)
 *  - direct : 브라우저에서 Anthropic API를 직접 호출한다. 키가 이 기기에 저장된다.
 */

import { corePersona, routingRules, departmentRules, situationBlock } from './persona.js';
import { DEPARTMENTS, getDept } from './departments.js';

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
  if (dept.id === 'chief') {
    parts.push(routingRules(DEPARTMENTS));
  } else {
    parts.push(departmentRules(dept));
  }
  parts.push(situationBlock(new Date()));
  return parts.join('\n');
}

/** 저장된 메시지를 Anthropic messages 배열로 변환 */
export function buildMessages(chatMessages) {
  const usable = chatMessages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text.trim() && !m.error)
    .slice(-MAX_TURNS)
    .map((m) => ({
      role: m.role,
      content: m.role === 'assistant' && m.dept ? `[[dept:${m.dept}]]\n${m.text}` : m.text,
    }));

  // 첫 메시지는 반드시 user 여야 한다
  while (usable.length && usable[0].role !== 'user') usable.shift();

  // 같은 role 이 연속되면 합친다
  const merged = [];
  for (const m of usable) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) prev.content += '\n\n' + m.content;
    else merged.push({ ...m });
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
 * @param {{deptId:string, messages:Array, settings:object, signal:AbortSignal,
 *          onDelta:(t:string)=>void, onStart?:()=>void}} opts
 * @returns {Promise<string>} 전체 응답 텍스트
 */
export async function sendChat({ deptId, messages, settings, signal, onDelta, onStart }) {
  const system = buildSystemPrompt(deptId, settings);
  const payload = buildMessages(messages);
  if (!payload.length) throw new ChatError('보낼 메시지가 없습니다.', 'empty');

  if (settings.mode === 'direct') {
    return streamDirect({ system, payload, settings, signal, onDelta, onStart });
  }
  return streamServer({ deptId, system, payload, settings, signal, onDelta, onStart });
}

/* ------------------------------------------------------------------ */
/* 서버 프록시 모드                                                     */
/* ------------------------------------------------------------------ */

async function streamServer({ deptId, system, payload, settings, signal, onDelta, onStart }) {
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

  return consumeSSE(res, onDelta, onStart);
}

/* ------------------------------------------------------------------ */
/* 브라우저 직접 호출 모드                                              */
/* ------------------------------------------------------------------ */

async function streamDirect({ system, payload, settings, signal, onDelta, onStart }) {
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

  return consumeSSE(res, onDelta, onStart);
}

/* ------------------------------------------------------------------ */
/* SSE 파서 — 서버 프록시와 Anthropic 원본 이벤트를 모두 처리한다        */
/* ------------------------------------------------------------------ */

async function consumeSSE(res, onDelta, onStart) {
  if (!res.body) throw new ChatError('응답 본문을 읽을 수 없습니다.', 'stream');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let started = false;

  const push = (t) => {
    if (!t) return;
    if (!started) {
      started = true;
      onStart?.();
    }
    full += t;
    onDelta?.(t);
  };

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

      // 서버 프록시가 보내는 단순한 형태
      if (evt.type === 'delta' && typeof evt.text === 'string') push(evt.text);
      // Anthropic 원본 이벤트 (direct 모드)
      else if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') push(evt.delta.text);
      else if (evt.type === 'error') {
        const msg = typeof evt.error === 'string' ? evt.error : evt.error?.message;
        throw new ChatError(msg || '응답 중 오류가 발생했습니다.', 'stream');
      }
    }
  }

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
