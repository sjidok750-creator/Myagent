/**
 * 대표님이 보낸 첨부를 Anthropic 이 읽을 수 있는 블록으로 바꾼다.
 *
 * 처음 보내는 파일은 Files API 에 올리고 file_id 를 돌려준다.
 * 기기가 그 id 를 기억해 두면 다음 턴부터는 내용을 다시 올리지 않는다.
 */

import { toFile } from '@anthropic-ai/sdk';

const MAX_ATTACH_BYTES = 20 * 1024 * 1024;
const MAX_PER_MESSAGE = 6;

/** 사진은 mime 이 정확해야 image 블록이 통과한다. */
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export function normalizeAttachments(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [id, a] of Object.entries(raw).slice(0, 40)) {
    if (!a || typeof a !== 'object') continue;
    const kind = ['image', 'pdf', 'text', 'data'].includes(a.kind) ? a.kind : 'data';
    out[String(id).slice(0, 64)] = {
      name: String(a.name || '첨부').slice(0, 200),
      mime: String(a.mime || 'application/octet-stream').slice(0, 120),
      kind,
      fileId: typeof a.fileId === 'string' ? a.fileId.slice(0, 128) : null,
      data: typeof a.data === 'string' ? a.data : null,
    };
  }
  return out;
}

/**
 * 첨부를 Files API 에 올린다 (아직 안 올린 것만).
 * @returns {Promise<Array<{localId:string, fileId:string}>>} 새로 올린 것들
 */
export async function uploadAttachments(client, attachments, send) {
  const fresh = [];
  for (const [localId, a] of Object.entries(attachments)) {
    if (a.fileId || !a.data) continue;

    const bytes = Buffer.from(a.data, 'base64');
    if (!bytes.length || bytes.length > MAX_ATTACH_BYTES) {
      a.error = '파일이 비었거나 너무 큽니다.';
      continue;
    }

    try {
      const uploaded = await client.beta.files.upload({
        file: await toFile(bytes, a.name, { type: uploadMime(a) }),
        betas: ['files-api-2025-04-14'],
      });
      a.fileId = uploaded.id;
      a.data = null; // 다 썼으면 메모리에서 버린다
      fresh.push({ localId, fileId: uploaded.id });
      send?.({ type: 'attachment_id', localId, fileId: uploaded.id });
    } catch (err) {
      console.error('[herushi] 첨부 업로드 실패', a.name, err?.message);
      a.error = '첨부를 올리지 못했습니다.';
    }
  }
  return fresh;
}

function uploadMime(a) {
  if (a.kind === 'image') return IMAGE_MIME.has(a.mime) ? a.mime : 'image/jpeg';
  if (a.kind === 'pdf') return 'application/pdf';
  if (a.kind === 'text') return 'text/plain';
  return a.mime || 'application/octet-stream';
}

/**
 * 메시지의 attachments(id 배열) 를 실제 content 블록으로 바꾼다.
 * @param {{role:string, content:string, attachments?:string[]}} msg
 * @param {object} attachments  normalizeAttachments 결과
 */
export function toContentBlocks(msg, attachments) {
  const ids = (msg.attachments || []).slice(0, MAX_PER_MESSAGE);
  if (!ids.length) return msg.content;

  const blocks = [];
  const failed = [];

  for (const id of ids) {
    const a = attachments[id];
    if (!a) continue;
    if (!a.fileId) {
      failed.push(a.name + (a.error ? ` (${a.error})` : ''));
      continue;
    }

    if (a.kind === 'image') {
      blocks.push({ type: 'image', source: { type: 'file', file_id: a.fileId } });
    } else if (a.kind === 'pdf' || a.kind === 'text') {
      blocks.push({
        type: 'document',
        source: { type: 'file', file_id: a.fileId },
        title: a.name,
      });
    } else {
      // 엑셀·워드 등은 코드 실행 컨테이너에 올려 직접 열어 보게 한다
      blocks.push({ type: 'container_upload', file_id: a.fileId });
    }
  }

  const names = ids.map((id) => attachments[id]?.name).filter(Boolean);
  let text = msg.content || '';
  if (names.length) {
    text = `${text}\n\n(첨부: ${names.join(', ')})`;
  }
  if (failed.length) {
    text += `\n(다음 첨부는 전달되지 못했습니다: ${failed.join(', ')})`;
  }

  blocks.push({ type: 'text', text: text.trim() || '이 첨부를 봐 주세요.' });
  return blocks;
}

/** 코드 실행으로 열어야 하는 첨부가 하나라도 있는지 */
export function needsContainer(attachments) {
  return Object.values(attachments).some((a) => a.kind === 'data');
}
