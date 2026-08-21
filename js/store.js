/**
 * localStorage 기반 저장소.
 * 대화는 이 기기 안에만 남는다. 서버는 대화를 저장하지 않는다.
 */

const KEY = 'herushi.v1';
const MAX_MESSAGES_PER_CHAT = 400;

const DEFAULT_STATE = {
  version: 1,
  settings: {
    ownerName: '',
    honorific: '대표님',
    ownerNote: '',
    model: 'claude-opus-5',
    effort: 'low',
    mode: 'server', // 'server' = /api/chat 프록시, 'direct' = 브라우저에서 직접 호출
    apiKey: '',
    accessCode: '',
    sound: true,
    haptics: true,
    tools: true, // 웹 검색·코드 실행·파일 생성·자료실 사용
    onboarded: false,
  },
  photos: {}, // deptId -> data URL (사용자가 지정한 얼굴 사진)
  workspace: { notes: [], tasks: [], people: [] }, // 모든 부서가 공유하는 비서실 자료실
  chats: {}, // deptId -> { messages: [], unread: number, updatedAt: number }
};

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) },
      photos: parsed.photos || {},
      workspace: {
        notes: parsed.workspace?.notes || [],
        tasks: parsed.workspace?.tasks || [],
        people: parsed.workspace?.people || [],
      },
      chats: parsed.chats || {},
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('저장 실패 (용량 초과일 수 있습니다)', e);
    }
  }, 120);
}

function emit() {
  persist();
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return state;
}

export function getSettings() {
  return state.settings;
}

export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  emit();
  return state.settings;
}

export function getPhotos() {
  return state.photos || (state.photos = {});
}

/** 부서 얼굴 사진 지정. dataURL 이 없으면 기본 일러스트로 되돌린다. */
export function setPhoto(deptId, dataURL) {
  const photos = getPhotos();
  if (dataURL) photos[deptId] = dataURL;
  else delete photos[deptId];
  emit();
}

/* ---------------- 비서실 자료실 ---------------- */

export function getWorkspace() {
  if (!state.workspace) state.workspace = { notes: [], tasks: [], people: [] };
  const w = state.workspace;
  if (!Array.isArray(w.notes)) w.notes = [];
  if (!Array.isArray(w.tasks)) w.tasks = [];
  if (!Array.isArray(w.people)) w.people = [];
  return w;
}

/** 서버가 도구로 갱신한 자료실을 통째로 받아 저장한다. */
export function setWorkspace(next) {
  if (!next || typeof next !== 'object') return;
  state.workspace = {
    notes: Array.isArray(next.notes) ? next.notes : [],
    tasks: Array.isArray(next.tasks) ? next.tasks : [],
    people: Array.isArray(next.people) ? next.people : [],
  };
  emit();
}

export function removeWorkspaceItem(kind, id) {
  const w = getWorkspace();
  if (!Array.isArray(w[kind])) return;
  const i = w[kind].findIndex((x) => x.id === id);
  if (i >= 0) {
    w[kind].splice(i, 1);
    emit();
  }
}

export function toggleTask(id) {
  const w = getWorkspace();
  const t = w.tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : 0;
  emit();
}

export function clearWorkspace() {
  state.workspace = { notes: [], tasks: [], people: [] };
  emit();
}

/* ---------------- 대화 ---------------- */

export function getChat(deptId) {
  if (!state.chats[deptId]) {
    state.chats[deptId] = { messages: [], unread: 0, updatedAt: 0, draft: '', container: null };
  }
  const c = state.chats[deptId];
  if (!Array.isArray(c.messages)) c.messages = [];
  return c;
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * @param {string} deptId
 * @param {{role:'user'|'assistant'|'system', text:string, dept?:string, status?:string, error?:boolean}} msg
 */
export function addMessage(deptId, msg) {
  const chat = getChat(deptId);
  const full = {
    id: newId(),
    at: Date.now(),
    role: msg.role,
    text: msg.text ?? '',
    dept: msg.dept || null,
    status: msg.status || (msg.role === 'user' ? 'sent' : 'done'),
    error: !!msg.error,
    reaction: null,
    files: Array.isArray(msg.files) ? msg.files : [],  // 헤뤼싀가 만든 첨부파일 참조
    acts: Array.isArray(msg.acts) ? msg.acts : [],     // 쓴 도구 기록
  };
  chat.messages.push(full);
  if (chat.messages.length > MAX_MESSAGES_PER_CHAT) {
    chat.messages.splice(0, chat.messages.length - MAX_MESSAGES_PER_CHAT);
  }
  chat.updatedAt = full.at;
  emit();
  return full;
}

export function patchMessage(deptId, id, patch) {
  const chat = getChat(deptId);
  const m = chat.messages.find((x) => x.id === id);
  if (!m) return null;
  Object.assign(m, patch);
  chat.updatedAt = Date.now();
  emit();
  return m;
}

export function removeMessage(deptId, id) {
  const chat = getChat(deptId);
  const i = chat.messages.findIndex((x) => x.id === id);
  if (i >= 0) {
    chat.messages.splice(i, 1);
    emit();
  }
}

export function setReaction(deptId, id, reaction) {
  const chat = getChat(deptId);
  const m = chat.messages.find((x) => x.id === id);
  if (!m) return;
  m.reaction = m.reaction === reaction ? null : reaction;
  emit();
}

export function markRead(deptId) {
  const chat = getChat(deptId);
  if (chat.unread) {
    chat.unread = 0;
    emit();
  }
}

export function bumpUnread(deptId) {
  const chat = getChat(deptId);
  chat.unread = (chat.unread || 0) + 1;
  emit();
}

export function setDraft(deptId, text) {
  const chat = getChat(deptId);
  chat.draft = text;
  persist();
}

export function clearChat(deptId) {
  state.chats[deptId] = { messages: [], unread: 0, updatedAt: 0, draft: '', container: null };
  emit();
}

/** 코드 실행 컨테이너는 대화방마다 이어 쓴다 ("그 엑셀에 한 줄 더 넣어줘") */
export function setContainer(deptId, id) {
  getChat(deptId).container = id || null;
  persist();
}

export function clearEverything() {
  state = structuredClone(DEFAULT_STATE);
  emit();
}

/** 대화 목록 정렬용 요약 */
export function chatSummary(deptId) {
  const chat = getChat(deptId);
  const last = [...chat.messages].reverse().find((m) => m.role !== 'system');
  return {
    updatedAt: chat.updatedAt || 0,
    unread: chat.unread || 0,
    preview: last
      ? (last.role === 'user' ? `나: ${last.text}` : last.text) ||
        (last.files?.length ? `첨부 ${last.files.length}개` : '')
      : '',
    lastRole: last?.role || null,
    empty: chat.messages.length === 0,
  };
}
