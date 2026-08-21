/** 비서실 자료실 — 헤뤼싀와 여덟 팀장이 함께 쌓은 기억 */

import { icons } from '../icons.js';
import * as store from '../store.js';
import { getDept } from '../departments.js';
import { esc, listStamp, plain } from '../format.js';

const TABS = [
  { id: 'tasks', label: '할 일' },
  { id: 'notes', label: '메모' },
  { id: 'people', label: '사람' },
];

export function vaultScreen(ctx) {
  const el = document.createElement('div');
  el.className = 'screen';
  el.dataset.screen = 'vault';

  el.innerHTML = `
    <header class="navbar">
      <div class="navbar-row">
        <div class="navbar-left">
          <button class="nav-btn" data-act="back" aria-label="뒤로">
            <span class="chev">${icons.chevronLeft(24)}</span>
          </button>
        </div>
        <div class="navbar-title">자료실</div>
        <div class="navbar-right"></div>
      </div>
      <div class="seg-tabs" id="tabs">
        ${TABS.map((t, i) => `<button data-tab="${t.id}" aria-pressed="${i === 0}">${t.label}</button>`).join('')}
      </div>
    </header>
    <div class="scroll" id="scroll"></div>
  `;

  const scrollEl = el.querySelector('#scroll');
  let tab = 'tasks';

  function render() {
    const w = store.getWorkspace();
    scrollEl.innerHTML = '';

    const list =
      tab === 'tasks' ? renderTasks(w.tasks) :
      tab === 'notes' ? renderNotes(w.notes) :
      renderPeople(w.people);

    scrollEl.appendChild(list);

    if (w.tasks.length || w.notes.length || w.people.length) {
      const wipe = document.createElement('div');
      wipe.className = 'group';
      wipe.innerHTML = `
        <div class="group-body">
          <button class="row is-danger" data-act="wipe"><span class="row-label">자료실 전체 비우기</span></button>
        </div>
        <div class="group-note">헤뤼싀가 기억한 내용이 모두 사라집니다. 대화 내용은 그대로 남습니다.</div>`;
      wipe.querySelector('[data-act="wipe"]').addEventListener('click', () => {
        if (!confirm('자료실을 전부 비웁니다. 되돌릴 수 없습니다. 계속할까요?')) return;
        store.clearWorkspace();
        ctx.toast('자료실을 비웠습니다.');
        render();
      });
      scrollEl.appendChild(wipe);
    }
  }

  function emptyBox(text) {
    const d = document.createElement('div');
    d.className = 'empty-state';
    d.innerHTML = text;
    return d;
  }

  function renderTasks(tasks) {
    if (!tasks.length) {
      return emptyBox('등록된 할 일이 없습니다.<br>헤뤼싀에게 "이거 해줘"라고 하면<br>여기에 기한과 함께 쌓입니다.');
    }
    const open = tasks.filter((t) => !t.done);
    const done = tasks.filter((t) => t.done);
    const wrap = document.createElement('div');

    for (const [title, list] of [['진행 중', open], ['완료', done]]) {
      if (!list.length) continue;
      const g = document.createElement('div');
      g.className = 'group';
      g.innerHTML = `<div class="group-title">${title} ${list.length}건</div><div class="group-body"></div>`;
      const body = g.querySelector('.group-body');

      for (const t of list) {
        const row = document.createElement('div');
        row.className = 'row vault-row';
        row.innerHTML = `
          <button class="check${t.done ? ' is-on' : ''}" data-toggle="${esc(t.id)}" aria-label="완료 표시"></button>
          <span class="dept-row-main">
            <span class="t${t.done ? ' is-done' : ''}">${esc(t.title)}</span>
            <span class="dept-row-sub">기한 ${esc(t.due || '미정')} · ${esc(t.owner || '대표님')} · ${esc(deptName(t.dept))}</span>
          </span>
          <button class="vault-del" data-del="tasks:${esc(t.id)}" aria-label="지우기">${icons.trash(17)}</button>`;
        body.appendChild(row);
      }
      wrap.appendChild(g);
    }
    return wrap;
  }

  function renderNotes(notes) {
    if (!notes.length) {
      return emptyBox('저장된 메모가 없습니다.<br>대화 중에 나온 사실을 헤뤼싀가<br>알아서 여기 적어둡니다.');
    }
    const wrap = document.createElement('div');
    const g = document.createElement('div');
    g.className = 'group';
    g.innerHTML = `<div class="group-title">메모 ${notes.length}건</div><div class="group-body"></div>`;
    const body = g.querySelector('.group-body');

    for (const n of [...notes].sort((a, b) => b.at - a.at)) {
      const row = document.createElement('div');
      row.className = 'row vault-row is-block';
      row.innerHTML = `
        <span class="dept-row-main">
          <span class="t">${esc(n.title)}</span>
          <span class="note-body">${esc(plain(n.body, 400))}</span>
          <span class="dept-row-sub">${esc(listStamp(n.at))} · ${esc(deptName(n.dept))}${n.tags?.length ? ` · ${esc(n.tags.join(', '))}` : ''}</span>
        </span>
        <button class="vault-del" data-del="notes:${esc(n.id)}" aria-label="지우기">${icons.trash(17)}</button>`;
      body.appendChild(row);
    }
    wrap.appendChild(g);
    return wrap;
  }

  function renderPeople(people) {
    if (!people.length) {
      return emptyBox('기록된 사람이 없습니다.<br>대화에 새 사람이 나오면<br>인맥·관계팀이 정리해 둡니다.');
    }
    const wrap = document.createElement('div');
    const g = document.createElement('div');
    g.className = 'group';
    g.innerHTML = `<div class="group-title">사람 ${people.length}명</div><div class="group-body"></div>`;
    const body = g.querySelector('.group-body');

    for (const p of [...people].sort((a, b) => b.at - a.at)) {
      const row = document.createElement('div');
      row.className = 'row vault-row is-block';
      row.innerHTML = `
        <span class="dept-row-main">
          <span class="t">${esc(p.name)}${p.org ? ` <span style="color:var(--label-2);font-size:14px">· ${esc(p.org)}</span>` : ''}</span>
          ${p.relation ? `<span class="note-body">${esc(p.relation)}</span>` : ''}
          ${p.note ? `<span class="note-body">${esc(plain(p.note, 300))}</span>` : ''}
          ${p.lastContact ? `<span class="dept-row-sub">마지막 접점 ${esc(p.lastContact)}</span>` : ''}
        </span>
        <button class="vault-del" data-del="people:${esc(p.id)}" aria-label="지우기">${icons.trash(17)}</button>`;
      body.appendChild(row);
    }
    wrap.appendChild(g);
    return wrap;
  }

  function deptName(id) {
    if (!id) return '비서실';
    const d = getDept(id);
    return d.id === 'chief' ? '헤뤼싀' : d.name;
  }

  scrollEl.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      store.toggleTask(toggle.dataset.toggle);
      ctx.haptic(8);
      render();
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const [kind, id] = del.dataset.del.split(':');
      store.removeWorkspaceItem(kind, id);
      ctx.haptic(8);
      render();
    }
  });

  el.querySelector('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    el.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    render();
  });

  el.querySelector('[data-act="back"]').addEventListener('click', () => ctx.pop());

  el.__mount = render;
  el.__refresh = render;
  return el;
}
