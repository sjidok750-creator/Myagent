/**
 * 비서실 자료실 — 헤뤼싀와 여덟 팀장이 함께 쓰는 기억.
 *
 * 상태의 주인은 사용자 기기다. 요청마다 기기에서 통째로 받아 메모리에서
 * 도구로 조작하고, 끝나면 통째로 돌려준다. 서버는 아무것도 저장하지 않는다.
 */

const LIMITS = {
  notes: 300,
  tasks: 300,
  people: 300,
  text: 4000,
  title: 200,
};

export function emptyWorkspace() {
  return { notes: [], tasks: [], people: [] };
}

/** 기기에서 받은 값을 신뢰하지 않고 정규화한다. */
export function normalizeWorkspace(raw) {
  const ws = emptyWorkspace();
  if (!raw || typeof raw !== 'object') return ws;

  ws.notes = arr(raw.notes).slice(-LIMITS.notes).map((n) => ({
    id: str(n?.id) || newId(),
    at: num(n?.at),
    title: clip(n?.title, LIMITS.title),
    body: clip(n?.body, LIMITS.text),
    tags: arr(n?.tags).slice(0, 8).map((t) => clip(t, 40)).filter(Boolean),
    dept: clip(n?.dept, 40),
  }));

  ws.tasks = arr(raw.tasks).slice(-LIMITS.tasks).map((t) => ({
    id: str(t?.id) || newId(),
    at: num(t?.at),
    title: clip(t?.title, LIMITS.title),
    due: clip(t?.due, 40),
    owner: clip(t?.owner, 60),
    note: clip(t?.note, 600),
    dept: clip(t?.dept, 40),
    done: !!t?.done,
    doneAt: num(t?.doneAt),
  }));

  ws.people = arr(raw.people).slice(-LIMITS.people).map((p) => ({
    id: str(p?.id) || newId(),
    at: num(p?.at),
    name: clip(p?.name, 80),
    org: clip(p?.org, 120),
    relation: clip(p?.relation, 200),
    note: clip(p?.note, LIMITS.text),
    lastContact: clip(p?.lastContact, 40),
  }));

  return ws;
}

/* ------------------------------------------------------------------ */
/* 도구 정의                                                           */
/* ------------------------------------------------------------------ */

export const WORKSPACE_TOOLS = [
  {
    name: 'note_save',
    description:
      '비서실 자료실에 메모를 남긴다. 대표님이 알려준 사실, 결정된 내용, 회의 결과처럼 ' +
      '나중에 다시 꺼내 써야 할 것을 적어 둔다. 모든 부서가 이 메모를 함께 읽는다. ' +
      '같은 제목의 메모가 이미 있으면 덮어쓴다. 잡담이나 한 번 쓰고 버릴 내용은 저장하지 않는다.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '한 줄 제목. 나중에 검색할 말로 짓는다.' },
        body: { type: 'string', description: '내용. 사실 위주로 간결하게.' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '분류용 짧은 꼬리표 (예: 투자, 계약, 건강)',
        },
      },
      required: ['title', 'body'],
    },
  },
  {
    name: 'note_search',
    description:
      '자료실 메모를 검색한다. 제목·내용·꼬리표를 모두 뒤진다. ' +
      '시스템 프롬프트의 자료실 요약에 제목만 보이는 메모의 본문이 필요할 때 쓴다.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '찾을 말. 비워두면 최근 메모를 준다.' },
        limit: { type: 'integer', description: '최대 개수 (기본 8)' },
      },
    },
  },
  {
    name: 'note_delete',
    description: '자료실 메모를 지운다. 대표님이 지우라고 했을 때만 쓴다.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: '메모 id' } },
      required: ['id'],
    },
  },
  {
    name: 'task_add',
    description:
      '할 일을 자료실에 등록한다. 기한 없는 할 일은 만들지 않는다. ' +
      '대표님이 "해줘"라고 한 일, 내가 하기로 한 일, 대표님이 하셔야 할 일을 모두 여기 넣는다.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '할 일 한 줄' },
        due: { type: 'string', description: '기한. YYYY-MM-DD 또는 "3월 5일 오전"처럼 사람이 읽는 형태' },
        owner: { type: 'string', description: '담당. "대표님" 또는 팀장 이름' },
        note: { type: 'string', description: '보충 설명 (선택)' },
      },
      required: ['title', 'due'],
    },
  },
  {
    name: 'task_update',
    description: '할 일을 완료 처리하거나 내용·기한을 고친다.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '할 일 id' },
        done: { type: 'boolean', description: 'true면 완료 처리' },
        title: { type: 'string' },
        due: { type: 'string' },
        owner: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'task_list',
    description:
      '할 일 목록을 본다. 시스템 프롬프트의 요약에는 미완료만 보이므로, ' +
      '완료한 일까지 봐야 할 때 쓴다.',
    input_schema: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['open', 'done', 'all'], description: '기본 open' },
        limit: { type: 'integer', description: '최대 개수 (기본 20)' },
      },
    },
  },
  {
    name: 'person_save',
    description:
      '사람을 자료실에 기록한다. 대화에 새로 등장한 사람은 이름·소속·관계·마지막 접점을 남긴다. ' +
      '같은 이름이 이미 있으면 정보를 합쳐서 갱신한다.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '이름' },
        org: { type: 'string', description: '소속·직함' },
        relation: { type: 'string', description: '대표님과의 관계' },
        note: { type: 'string', description: '기억해 둘 것 (선호, 가족, 최근 근황 등)' },
        lastContact: { type: 'string', description: '마지막으로 만나거나 연락한 시점' },
      },
      required: ['name'],
    },
  },
  {
    name: 'person_find',
    description: '자료실에서 사람을 찾는다. 이름·소속·메모를 모두 뒤진다.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '찾을 말. 비워두면 최근 기록순으로 준다.' },
        limit: { type: 'integer', description: '최대 개수 (기본 8)' },
      },
    },
  },
];

export const WORKSPACE_TOOL_NAMES = new Set(WORKSPACE_TOOLS.map((t) => t.name));

/* ------------------------------------------------------------------ */
/* 도구 실행                                                           */
/* ------------------------------------------------------------------ */

/**
 * @param {string} name  도구 이름
 * @param {object} input 모델이 준 인자
 * @param {object} ws    normalizeWorkspace 를 거친 상태 (제자리에서 수정된다)
 * @param {string} deptId
 * @returns {{ok:boolean, text:string, changed:boolean}}
 */
export function runWorkspaceTool(name, input, ws, deptId) {
  const i = input && typeof input === 'object' ? input : {};

  switch (name) {
    case 'note_save': {
      const title = clip(i.title, LIMITS.title);
      const body = clip(i.body, LIMITS.text);
      if (!title || !body) return fail('제목과 내용이 모두 필요합니다.');

      const existing = ws.notes.find((n) => n.title.toLowerCase() === title.toLowerCase());
      const tags = arr(i.tags).slice(0, 8).map((t) => clip(t, 40)).filter(Boolean);

      if (existing) {
        existing.body = body;
        existing.tags = tags.length ? tags : existing.tags;
        existing.at = Date.now();
        existing.dept = deptId;
        return ok(`메모를 갱신했습니다. id=${existing.id} "${title}"`, true);
      }

      const note = { id: newId(), at: Date.now(), title, body, tags, dept: deptId };
      ws.notes.push(note);
      trim(ws.notes, LIMITS.notes);
      return ok(`메모를 저장했습니다. id=${note.id} "${title}"`, true);
    }

    case 'note_search': {
      const q = clip(i.query, 200).toLowerCase();
      const limit = clampInt(i.limit, 8, 1, 30);
      let hits = [...ws.notes].sort((a, b) => b.at - a.at);
      if (q) {
        hits = hits.filter((n) =>
          `${n.title} ${n.body} ${n.tags.join(' ')}`.toLowerCase().includes(q)
        );
      }
      if (!hits.length) return ok(q ? `"${i.query}" 와 맞는 메모가 없습니다.` : '메모가 아직 없습니다.');
      return ok(
        hits.slice(0, limit)
          .map((n) => `[${n.id}] ${n.title}\n${n.body}${n.tags.length ? `\n태그: ${n.tags.join(', ')}` : ''}`)
          .join('\n\n')
      );
    }

    case 'note_delete': {
      const idx = ws.notes.findIndex((n) => n.id === clip(i.id, 40));
      if (idx < 0) return fail('그 id 의 메모가 없습니다.');
      const [gone] = ws.notes.splice(idx, 1);
      return ok(`"${gone.title}" 메모를 지웠습니다.`, true);
    }

    case 'task_add': {
      const title = clip(i.title, LIMITS.title);
      const due = clip(i.due, 40);
      if (!title) return fail('할 일 제목이 필요합니다.');
      if (!due) return fail('기한이 필요합니다. 기한 없는 할 일은 만들지 않습니다.');

      const task = {
        id: newId(),
        at: Date.now(),
        title,
        due,
        owner: clip(i.owner, 60) || '대표님',
        note: clip(i.note, 600),
        dept: deptId,
        done: false,
        doneAt: 0,
      };
      ws.tasks.push(task);
      trim(ws.tasks, LIMITS.tasks);
      return ok(`할 일을 등록했습니다. id=${task.id} "${title}" (${due}, ${task.owner})`, true);
    }

    case 'task_update': {
      const t = ws.tasks.find((x) => x.id === clip(i.id, 40));
      if (!t) return fail('그 id 의 할 일이 없습니다.');
      if (typeof i.done === 'boolean') {
        t.done = i.done;
        t.doneAt = i.done ? Date.now() : 0;
      }
      if (i.title) t.title = clip(i.title, LIMITS.title);
      if (i.due) t.due = clip(i.due, 40);
      if (i.owner) t.owner = clip(i.owner, 60);
      return ok(`할 일을 고쳤습니다. [${t.id}] ${t.title} — ${t.done ? '완료' : t.due}`, true);
    }

    case 'task_list': {
      const filter = ['open', 'done', 'all'].includes(i.filter) ? i.filter : 'open';
      const limit = clampInt(i.limit, 20, 1, 60);
      let list = [...ws.tasks];
      if (filter === 'open') list = list.filter((t) => !t.done);
      if (filter === 'done') list = list.filter((t) => t.done);
      list.sort((a, b) => (a.done === b.done ? b.at - a.at : a.done ? 1 : -1));
      if (!list.length) return ok('해당하는 할 일이 없습니다.');
      return ok(
        list.slice(0, limit)
          .map((t) => `[${t.id}] ${t.done ? '완료' : '진행'} · ${t.title} · 기한 ${t.due} · ${t.owner}`)
          .join('\n')
      );
    }

    case 'person_save': {
      const name = clip(i.name, 80);
      if (!name) return fail('이름이 필요합니다.');
      let p = ws.people.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!p) {
        p = { id: newId(), at: Date.now(), name, org: '', relation: '', note: '', lastContact: '' };
        ws.people.push(p);
        trim(ws.people, LIMITS.people);
      }
      if (i.org) p.org = clip(i.org, 120);
      if (i.relation) p.relation = clip(i.relation, 200);
      if (i.note) p.note = mergeNote(p.note, clip(i.note, LIMITS.text));
      if (i.lastContact) p.lastContact = clip(i.lastContact, 40);
      p.at = Date.now();
      return ok(`${p.name} 님을 기록했습니다. id=${p.id}`, true);
    }

    case 'person_find': {
      const q = clip(i.query, 200).toLowerCase();
      const limit = clampInt(i.limit, 8, 1, 30);
      let hits = [...ws.people].sort((a, b) => b.at - a.at);
      if (q) {
        hits = hits.filter((p) =>
          `${p.name} ${p.org} ${p.relation} ${p.note}`.toLowerCase().includes(q)
        );
      }
      if (!hits.length) return ok('기록된 사람이 없습니다.');
      return ok(
        hits.slice(0, limit)
          .map((p) =>
            `[${p.id}] ${p.name}${p.org ? ` · ${p.org}` : ''}` +
            `${p.relation ? `\n관계: ${p.relation}` : ''}` +
            `${p.lastContact ? `\n마지막 접점: ${p.lastContact}` : ''}` +
            `${p.note ? `\n메모: ${p.note}` : ''}`
          )
          .join('\n\n')
      );
    }

    default:
      return fail(`모르는 도구입니다: ${name}`);
  }
}

/**
 * 시스템 프롬프트에 넣을 자료실 요약.
 * 이게 있어서 헤뤼싀는 도구를 부르지 않고도 무엇이 있는지 안다.
 */
export function workspaceDigest(ws) {
  const open = ws.tasks.filter((t) => !t.done);
  const notes = [...ws.notes].sort((a, b) => b.at - a.at).slice(0, 12);
  const people = [...ws.people].sort((a, b) => b.at - a.at).slice(0, 20);

  if (!open.length && !notes.length && !people.length) {
    return `
# 비서실 자료실
아직 비어 있다. 대표님이 알려주는 사실·할 일·사람을 도구로 차곡차곡 쌓아라.`;
  }

  const parts = ['\n# 비서실 자료실 (모든 부서가 공유한다)'];

  if (open.length) {
    parts.push(
      `\n## 미완료 할 일 ${open.length}건`,
      open.slice(0, 25)
        .map((t) => `- [${t.id}] ${t.title} · 기한 ${t.due} · ${t.owner}`)
        .join('\n')
    );
  }
  if (notes.length) {
    parts.push(
      `\n## 최근 메모 (제목만 · 본문은 note_search 로)`,
      notes.map((n) => `- [${n.id}] ${n.title}${n.tags.length ? ` (${n.tags.join(', ')})` : ''}`).join('\n')
    );
  }
  if (people.length) {
    parts.push(
      `\n## 기록된 사람`,
      people.map((p) => `- ${p.name}${p.org ? ` (${p.org})` : ''}`).join(', ')
    );
  }
  parts.push(
    '\n이 요약은 매번 자동으로 갱신된다. 여기 보이는 것은 이미 아는 내용이니 다시 물어보지 않는다.'
  );
  return parts.join('\n');
}

/* ------------------------------------------------------------------ */

function ok(text, changed = false) {
  return { ok: true, text, changed };
}
function fail(text) {
  return { ok: false, text, changed: false };
}
function mergeNote(oldNote, add) {
  if (!oldNote) return add;
  if (!add || oldNote.includes(add)) return oldNote;
  return clip(`${oldNote}\n${add}`, LIMITS.text);
}
function trim(list, max) {
  if (list.length > max) list.splice(0, list.length - max);
}
function arr(v) {
  return Array.isArray(v) ? v : [];
}
function str(v) {
  return typeof v === 'string' ? v : '';
}
function num(v) {
  return Number.isFinite(v) ? v : Date.now();
}
function clip(v, max) {
  return str(v).trim().slice(0, max);
}
function clampInt(v, def, min, max) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}
let counter = 0;
function newId() {
  counter = (counter + 1) % 4096;
  return Date.now().toString(36).slice(-5) + counter.toString(36) + Math.random().toString(36).slice(2, 5);
}
