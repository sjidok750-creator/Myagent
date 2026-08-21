/**
 * 헤뤼싀 서버 프록시.
 *
 * 브라우저는 여기로만 요청을 보내고, Anthropic API 키는 서버 환경변수에만 있다.
 * 응답은 SSE 로 흘려보낸다: data: {"type":"delta","text":"..."}
 *
 * 대화 내용은 저장하지 않는다. 그대로 전달만 한다.
 */

import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_MODEL = process.env.HERUSHI_MODEL || 'claude-opus-5';
const ALLOWED_MODELS = new Set([
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5',
]);
const ALLOWED_EFFORT = new Set(['low', 'medium', 'high']);

const MAX_MESSAGES = 60;
const MAX_CHARS = 120_000;

// 아주 단순한 인스턴스 단위 레이트 리밋 (서버리스라 완벽하진 않지만 실수 폭주는 막는다)
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

  // 접속 코드가 설정된 배포라면 확인한다
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

  const system = typeof body.system === 'string' ? body.system : '';
  const messages = Array.isArray(body.messages) ? body.messages : [];

  if (!system) return res.status(400).json({ error: 'system 프롬프트가 없습니다.' });
  if (!messages.length) return res.status(400).json({ error: '메시지가 없습니다.' });
  if (messages.length > MAX_MESSAGES) return res.status(400).json({ error: '대화가 너무 깁니다.' });

  const clean = [];
  let total = system.length;
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) {
      return res.status(400).json({ error: '메시지 형식이 올바르지 않습니다.' });
    }
    const content = typeof m.content === 'string' ? m.content : '';
    if (!content.trim()) continue;
    total += content.length;
    clean.push({ role: m.role, content });
  }
  if (!clean.length) return res.status(400).json({ error: '메시지가 비어 있습니다.' });
  if (clean[0].role !== 'user') return res.status(400).json({ error: '대화는 사용자 메시지로 시작해야 합니다.' });
  if (total > MAX_CHARS) return res.status(413).json({ error: '대화가 너무 깁니다. 대화를 정리한 뒤 다시 시도해 주세요.' });

  const model = ALLOWED_MODELS.has(body.model) ? body.model : DEFAULT_MODEL;
  const effort = ALLOWED_EFFORT.has(body.effort) ? body.effort : 'low';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  const client = new Anthropic({ apiKey });
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  try {
    const stream = client.messages.stream(
      {
        model,
        max_tokens: 4096,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: clean,
        output_config: { effort },
      },
      { signal: controller.signal }
    );

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        send({ type: 'delta', text: event.delta.text });
      }
    }

    const final = await stream.finalMessage();
    send({ type: 'done', stop_reason: final.stop_reason, usage: final.usage });
    res.end();
  } catch (err) {
    if (controller.signal.aborted) {
      try { res.end(); } catch {}
      return;
    }
    console.error('[herushi] chat error:', err?.status, err?.message);
    send({ type: 'error', error: humanError(err) });
    res.end();
  }
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
