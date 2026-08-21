/** 대화 목록 화면 — 메시지 앱 첫 화면 */

import { icons } from '../icons.js';
import { avatarMarkup } from '../avatar.js';
import { DEPARTMENTS } from '../departments.js';
import * as store from '../store.js';
import { listStamp, plain, esc } from '../format.js';

export function listScreen(ctx) {
  const el = document.createElement('div');
  el.className = 'screen';
  el.dataset.screen = 'list';

  el.innerHTML = `
    <header class="navbar is-transparent">
      <div class="navbar-row">
        <div class="navbar-left">
          <button class="nav-btn" data-act="settings" aria-label="설정">${icons.gear(22)}</button>
        </div>
        <div class="navbar-title" id="smallTitle" style="opacity:0;transition:opacity .18s">메시지</div>
        <div class="navbar-right">
          <button class="nav-icon-btn" data-act="vault" aria-label="비서실 자료실">${icons.folder(22)}</button>
          <button class="nav-icon-btn" data-act="org" aria-label="비서실 조직도">${icons.building(22)}</button>
        </div>
      </div>
      <div class="large-title" id="largeTitle">메시지</div>
      <div class="search-wrap">
        <div class="search-field" id="searchField">
          ${icons.search(17)}
          <input type="search" id="search" placeholder="검색" autocomplete="off" enterkeyhint="search">
          <button class="search-clear" type="button" aria-label="검색어 지우기">${icons.xCircle(17)}</button>
        </div>
      </div>
    </header>
    <div class="scroll" id="scroll"></div>
  `;

  const scrollEl = el.querySelector('#scroll');
  const searchEl = el.querySelector('#search');
  const searchField = el.querySelector('#searchField');
  const navbar = el.querySelector('.navbar');
  const largeTitle = el.querySelector('#largeTitle');
  const smallTitle = el.querySelector('#smallTitle');

  let query = '';

  function rows() {
    return DEPARTMENTS.map((d) => ({ dept: d, ...store.chatSummary(d.id) }))
      .sort((a, b) => {
        if (a.dept.pinned !== b.dept.pinned) return a.dept.pinned ? -1 : 1;
        if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
        return DEPARTMENTS.indexOf(a.dept) - DEPARTMENTS.indexOf(b.dept);
      });
  }

  function matches(r) {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      r.dept.name.toLowerCase().includes(q) ||
      r.dept.lead.toLowerCase().includes(q) ||
      r.dept.leadRomanized.toLowerCase().includes(q) ||
      r.dept.scope.toLowerCase().includes(q) ||
      r.preview.toLowerCase().includes(q)
    );
  }

  function render() {
    const all = rows();
    const visible = all.filter(matches);
    scrollEl.innerHTML = '';

    // 고정 대화 — 헤뤼싀 + 최근 활동 부서
    if (!query) {
      const pinnedItems = [
        all.find((r) => r.dept.pinned),
        ...all.filter((r) => !r.dept.pinned && r.updatedAt > 0).slice(0, 3),
      ].filter(Boolean);

      if (pinnedItems.length) {
        const pins = document.createElement('div');
        pins.className = 'pinned';
        pins.innerHTML = pinnedItems
          .map(
            (r) => `
          <button class="pin" data-dept="${r.dept.id}">
            <span class="pin-wrap">
              <span class="avatar">${avatarMarkup(r.dept, 66, 'pin-' + r.dept.id, store.getPhotos())}</span>
              ${r.unread ? '<span class="pin-dot"></span>' : ''}
            </span>
            <span class="pin-name">${esc(r.dept.id === 'chief' ? r.dept.lead : r.dept.shortName)}</span>
          </button>`
          )
          .join('');
        scrollEl.appendChild(pins);
      }
    }

    const title = document.createElement('div');
    title.className = 'list-section-title';
    title.textContent = query ? '검색 결과' : '비서실';
    scrollEl.appendChild(title);

    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = '검색 결과가 없습니다.';
      scrollEl.appendChild(empty);
    }

    for (const r of visible) {
      scrollEl.appendChild(chatRow(r));
    }

    const w = store.getWorkspace();
    const openTasks = w.tasks.filter((t) => !t.done).length;
    const footer = document.createElement('div');
    footer.className = 'list-footer';
    footer.innerHTML =
      `헤뤼싀 비서실 · ${DEPARTMENTS.length - 1}개 부서<br>` +
      `자료실: 할 일 ${openTasks} · 메모 ${w.notes.length} · 사람 ${w.people.length}<br>` +
      `모두 이 기기에만 저장됩니다.`;
    scrollEl.appendChild(footer);
  }

  function chatRow(r) {
    const d = r.dept;
    const btn = document.createElement('button');
    btn.className = 'chat-row' + (r.unread ? ' is-unread' : '');
    btn.dataset.dept = d.id;

    const preview = r.preview
      ? plain(r.preview)
      : `${d.lead} · ${d.scope}`;

    btn.innerHTML = `
      ${r.unread ? '<span class="chat-row-unread"></span>' : ''}
      <span class="avatar">${avatarMarkup(d, 56, 'row-' + d.id, store.getPhotos())}</span>
      <span class="chat-row-body">
        <span class="chat-row-top">
          <span class="chat-row-name">${esc(d.id === 'chief' ? `${d.lead} (비서실장)` : d.name)}</span>
          <span class="chat-row-time">${esc(listStamp(r.updatedAt))} ${icons.chevronRight(13)}</span>
        </span>
        <span class="chat-row-preview">${esc(preview)}</span>
        ${r.empty ? `<span class="chat-row-role">${d.emoji} ${esc(d.role)}</span>` : ''}
      </span>`;
    return btn;
  }

  scrollEl.addEventListener('click', (e) => {
    const target = e.target.closest('[data-dept]');
    if (!target) return;
    ctx.haptic(8);
    ctx.openChat(target.dataset.dept);
  });

  scrollEl.addEventListener('scroll', () => {
    const y = scrollEl.scrollTop;
    const collapsed = y > 26;
    largeTitle.style.opacity = collapsed ? '0' : '1';
    largeTitle.style.transform = `translateY(${Math.min(y, 30) * -0.4}px)`;
    smallTitle.style.opacity = collapsed ? '1' : '0';
    navbar.classList.toggle('is-transparent', y <= 2);
  }, { passive: true });

  searchEl.addEventListener('input', () => {
    query = searchEl.value.trim();
    searchField.classList.toggle('has-text', !!query);
    render();
  });
  el.querySelector('.search-clear').addEventListener('click', () => {
    searchEl.value = '';
    query = '';
    searchField.classList.remove('has-text');
    render();
  });

  el.querySelector('[data-act="settings"]').addEventListener('click', () => ctx.openSettings());
  el.querySelector('[data-act="org"]').addEventListener('click', () => ctx.openInfo('chief'));
  el.querySelector('[data-act="vault"]').addEventListener('click', () => ctx.openVault());

  el.__mount = render;
  el.__refresh = render;
  return el;
}
