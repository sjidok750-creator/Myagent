/** 대화 화면 — iMessage 스타일 말풍선 */

import { icons } from '../icons.js';
import { avatarMarkup } from '../avatar.js';
import { getDept, deptBadge } from '../departments.js';
import * as store from '../store.js';
import { sendChat, parseDeptTag, ChatError } from '../api.js';
import { timeOf, sameDay, dayMark, richText, esc } from '../format.js';

const REACTIONS = ['❤️', '👍', '👎', '😂', '‼️', '❓'];
const GROUP_GAP_MS = 4 * 60 * 1000; // 이보다 벌어지면 새 묶음

export function chatScreen(ctx, deptId) {
  const dept = getDept(deptId);
  const el = document.createElement('div');
  el.className = 'screen';
  el.dataset.screen = 'chat';

  el.innerHTML = `
    <header class="navbar">
      <div class="navbar-row">
        <div class="navbar-left">
          <button class="nav-btn" data-act="back" aria-label="대화 목록으로">
            <span class="chev">${icons.chevronLeft(24)}</span>
          </button>
        </div>
        <button class="chat-nav-person" data-act="info">
          <span class="avatar" id="navAvatar">${avatarMarkup(dept, 32, 'nav-' + dept.id, store.getPhotos())}</span>
          <span class="who"><span>${esc(dept.name)}</span>${icons.chevronRight(11)}</span>
        </button>
        <div class="navbar-right">
          <button class="nav-icon-btn" data-act="info" aria-label="부서 정보">${icons.info(22)}</button>
        </div>
      </div>
    </header>

    <div class="messages" id="messages"></div>
    <div class="suggests" id="suggests" hidden></div>

    <form class="composer" id="composer">
      <button type="button" class="composer-plus" data-act="suggest" aria-label="추천 질문">${icons.plus(20)}</button>
      <div class="composer-field">
        <textarea class="composer-input" id="input" rows="1" placeholder="iMessage"
                  enterkeyhint="send" autocapitalize="sentences" autocomplete="off"></textarea>
        <button type="submit" class="send-btn" id="send" disabled aria-label="보내기">${icons.arrowUp(18)}</button>
      </div>
    </form>
  `;

  const messagesEl = el.querySelector('#messages');
  const suggestsEl = el.querySelector('#suggests');
  const inputEl = el.querySelector('#input');
  const sendBtn = el.querySelector('#send');
  const formEl = el.querySelector('#composer');
  const navbar = el.querySelector('.navbar');

  let controller = null;   // 진행 중인 응답 중단용
  let streamingId = null;  // 스트리밍 중인 메시지 id
  let jumpBtn = null;

  /* ---------------- 렌더 ---------------- */

  function render({ keepScroll = false } = {}) {
    const prevBottom = distanceFromBottom();
    const chat = store.getChat(deptId);
    const msgs = chat.messages;

    messagesEl.innerHTML = '';
    messagesEl.appendChild(introBlock(dept));

    let prev = null;
    msgs.forEach((m, i) => {
      const next = msgs[i + 1] || null;

      if (!prev || !sameDay(prev.at, m.at) || m.at - prev.at > 30 * 60 * 1000) {
        messagesEl.appendChild(dayMarkEl(m.at));
      }

      if (m.role === 'system') {
        messagesEl.appendChild(sysLine(m.text));
        prev = m;
        return;
      }

      const startsGroup = !prev || prev.role !== m.role || m.at - prev.at > GROUP_GAP_MS || prev.role === 'system';
      const endsGroup = !next || next.role !== m.role || next.at - m.at > GROUP_GAP_MS || next.role === 'system';

      messagesEl.appendChild(messageEl(m, { startsGroup, endsGroup }));

      // 마지막 내 메시지 아래 전달 상태
      if (m.role === 'user' && endsGroup && isLastUser(msgs, i)) {
        messagesEl.appendChild(receiptEl(m));
      }
      prev = m;
    });

    if (controller && !streamingId) messagesEl.appendChild(typingEl(dept));

    updateSuggests(msgs.length === 0);

    if (keepScroll && prevBottom > 80) restoreScroll(prevBottom);
    else scrollToBottom(false);
  }

  function isLastUser(msgs, i) {
    for (let k = msgs.length - 1; k >= 0; k--) {
      if (msgs[k].role === 'user') return k === i;
    }
    return false;
  }

  function introBlock(d) {
    const wrap = document.createElement('div');
    wrap.className = 'intro';
    wrap.innerHTML = `
      <span class="avatar">${avatarMarkup(d, 84, 'intro-' + d.id, store.getPhotos())}</span>
      <div class="intro-name">${esc(d.lead)}${d.id === 'chief' ? '' : ` <span style="opacity:.5;font-weight:400">· ${esc(d.name)}</span>`}</div>
      <div class="intro-role">${esc(d.role)}</div>
      <div class="intro-tagline">${esc(d.tagline)}</div>`;
    return wrap;
  }

  function dayMarkEl(ts) {
    const { main, time } = dayMark(ts);
    const div = document.createElement('div');
    div.className = 'daymark';
    div.innerHTML = `${esc(main)} <span class="light">${esc(time)}</span>`;
    return div;
  }

  function sysLine(text) {
    const div = document.createElement('div');
    div.className = 'sysline';
    div.textContent = text;
    return div;
  }

  function messageEl(m, { startsGroup, endsGroup }) {
    const row = document.createElement('div');
    const out = m.role === 'user';
    row.className = `msg ${out ? 'out' : 'in'}`;
    row.dataset.id = m.id;
    if (startsGroup) row.classList.add('group-start');
    if (endsGroup) row.classList.add('has-tail');
    row.classList.add(startsGroup && endsGroup ? 'g-solo' : startsGroup ? 'g-start' : endsGroup ? 'g-end' : 'g-mid');
    if (m.error) row.classList.add('is-error');

    const badge = !out && m.dept ? deptBadge(m.dept) : null;
    const showAvatar = !out && endsGroup;
    if (showAvatar) row.classList.add('show-avatar');

    const speaker = !out && m.dept ? getDept(m.dept) : dept;

    row.innerHTML = `
      ${out ? '' : `<span class="avatar msg-avatar">${avatarMarkup(speaker, 28, 'm-' + m.id, store.getPhotos())}</span>`}
      <div class="msg-stack">
        ${badge ? `<span class="dept-chip" style="background:${esc(badge.tint)}">${badge.emoji} ${esc(badge.label)} <span class="lead">${esc(badge.lead)}</span></span>` : ''}
        <div class="bubble${m.status === 'streaming' ? ' no-anim' : ''}">${richText(m.text)}</div>
        ${m.reaction ? `<span class="tapback">${esc(m.reaction)}</span>` : ''}
      </div>`;

    // 리액션은 말풍선 기준으로 위치해야 한다
    const tapback = row.querySelector('.tapback');
    if (tapback) row.querySelector('.bubble').appendChild(tapback);

    if (m.error) {
      const retry = document.createElement('button');
      retry.className = 'retry-btn';
      retry.textContent = '다시 시도';
      retry.addEventListener('click', () => retryLast(m.id));
      row.querySelector('.msg-stack').appendChild(retry);
    } else {
      attachTapback(row, m);
    }
    return row;
  }

  function receiptEl(m) {
    const div = document.createElement('div');
    div.className = 'receipt';
    div.style.alignSelf = 'flex-end';
    div.innerHTML = m.status === 'failed'
      ? '<span style="color:var(--red)">전송되지 않음</span>'
      : `<b>전달됨</b> ${esc(timeOf(m.at))}`;
    return div;
  }

  function typingEl(d) {
    const row = document.createElement('div');
    row.className = 'msg in typing show-avatar has-tail g-solo group-start';
    row.innerHTML = `
      <span class="avatar msg-avatar">${avatarMarkup(d, 28, 'typing-' + d.id, store.getPhotos())}</span>
      <div class="msg-stack">
        <div class="bubble"><i class="dot"></i><i class="dot"></i><i class="dot"></i></div>
      </div>`;
    return row;
  }

  /* ---------------- 탭백(리액션) ---------------- */

  function attachTapback(row, m) {
    const bubble = row.querySelector('.bubble');
    let timer = null;
    const start = () => {
      timer = setTimeout(() => {
        ctx.haptic(12);
        openTapbackMenu(m, bubble);
      }, 480);
    };
    const cancel = () => clearTimeout(timer);
    bubble.addEventListener('touchstart', start, { passive: true });
    bubble.addEventListener('touchend', cancel);
    bubble.addEventListener('touchmove', cancel, { passive: true });
    bubble.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openTapbackMenu(m, bubble);
    });
  }

  function openTapbackMenu(m, anchor) {
    const rect = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.style.cssText = `position:fixed;z-index:80;display:flex;gap:2px;padding:6px 8px;border-radius:22px;
      background:var(--bar-bg);-webkit-backdrop-filter:blur(24px);backdrop-filter:blur(24px);
      box-shadow:0 6px 24px rgba(0,0,0,.22);border:0.5px solid var(--bar-border)`;
    menu.innerHTML = REACTIONS.map(
      (r) => `<button data-r="${r}" style="font-size:24px;padding:4px 5px;line-height:1">${r}</button>`
    ).join('');

    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:79';
    const close = () => { menu.remove(); backdrop.remove(); };
    backdrop.addEventListener('click', close);

    menu.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-r]');
      if (!btn) return;
      store.setReaction(deptId, m.id, btn.dataset.r);
      ctx.haptic(8);
      close();
      render({ keepScroll: true });
    });

    el.appendChild(backdrop);
    el.appendChild(menu);
    const top = Math.max(rect.top - 54, 60);
    menu.style.top = top + 'px';
    const width = menu.offsetWidth;
    menu.style.left = Math.min(Math.max(rect.left, 10), window.innerWidth - width - 10) + 'px';
  }

  /* ---------------- 추천 질문 ---------------- */

  function updateSuggests(show) {
    if (!show || !dept.quick?.length) {
      suggestsEl.hidden = true;
      suggestsEl.innerHTML = '';
      return;
    }
    suggestsEl.hidden = false;
    suggestsEl.innerHTML = dept.quick
      .map((q) => `<button type="button" class="suggest">${esc(q)}</button>`)
      .join('');
  }

  suggestsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.suggest');
    if (!b) return;
    inputEl.value = b.textContent;
    autogrow();
    submit();
  });

  el.querySelector('[data-act="suggest"]').addEventListener('click', () => {
    updateSuggests(true);
    ctx.haptic(6);
  });

  /* ---------------- 스크롤 ---------------- */

  function distanceFromBottom() {
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  }
  function restoreScroll(d) {
    messagesEl.scrollTop = messagesEl.scrollHeight - messagesEl.clientHeight - d;
  }
  function scrollToBottom(smooth = true) {
    requestAnimationFrame(() => {
      messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    });
  }

  messagesEl.addEventListener('scroll', () => {
    navbar.classList.toggle('is-transparent', messagesEl.scrollTop <= 2);
    const far = distanceFromBottom() > 260;
    if (far && !jumpBtn) {
      jumpBtn = document.createElement('button');
      jumpBtn.className = 'jump-btn';
      jumpBtn.innerHTML = icons.chevronDown(18);
      jumpBtn.addEventListener('click', () => scrollToBottom(true));
      el.appendChild(jumpBtn);
    } else if (!far && jumpBtn) {
      jumpBtn.remove();
      jumpBtn = null;
    }
  }, { passive: true });

  /* ---------------- 입력 ---------------- */

  function autogrow() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 132) + 'px';
    sendBtn.disabled = !inputEl.value.trim() && !controller;
  }

  inputEl.addEventListener('input', () => {
    autogrow();
    store.setDraft(deptId, inputEl.value);
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });

  inputEl.addEventListener('focus', () => setTimeout(() => scrollToBottom(false), 250));

  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    if (controller) stop();
    else submit();
  });

  el.querySelector('[data-act="back"]').addEventListener('click', () => {
    stop();
    ctx.pop();
  });
  el.querySelectorAll('[data-act="info"]').forEach((b) =>
    b.addEventListener('click', () => ctx.openInfo(deptId))
  );

  /* ---------------- 전송 ---------------- */

  function stop() {
    if (!controller) return;
    controller.abort();
    controller = null;
  }

  async function submit() {
    const text = inputEl.value.trim();
    if (!text || controller) return;

    inputEl.value = '';
    store.setDraft(deptId, '');
    autogrow();
    ctx.haptic(10);

    store.addMessage(deptId, { role: 'user', text });
    render();
    await run();
  }

  async function retryLast(errorId) {
    if (controller) return;
    store.removeMessage(deptId, errorId);
    render();
    await run();
  }

  async function run() {
    const settings = store.getSettings();
    controller = new AbortController();
    setSendMode('stop');
    render();

    let placeholder = null;
    let raw = '';

    const paint = () => {
      if (!placeholder) return;
      const node = messagesEl.querySelector(`.msg[data-id="${placeholder.id}"]`);
      if (!node) { render({ keepScroll: true }); return; }
      const parsed = parseDeptTag(raw);
      const bubble = node.querySelector('.bubble');
      bubble.innerHTML = richText(parsed.text || '…');
      const nextDept = routedDept(parsed.dept);
      if (nextDept !== placeholder.dept) {
        placeholder.dept = nextDept;
        render({ keepScroll: true });
        return;
      }
      if (distanceFromBottom() < 220) scrollToBottom(false);
    };

    try {
      const chat = store.getChat(deptId);
      const full = await sendChat({
        deptId,
        messages: chat.messages,
        settings,
        signal: controller.signal,
        onStart: () => {
          placeholder = store.addMessage(deptId, { role: 'assistant', text: '', status: 'streaming' });
          streamingId = placeholder.id;
          render();
        },
        onDelta: (t) => {
          raw += t;
          paint();
        },
      });

      const parsed = parseDeptTag(full);
      const finalText = (parsed.text || '').trim();

      if (!placeholder) {
        placeholder = store.addMessage(deptId, { role: 'assistant', text: '', status: 'streaming' });
      }
      store.patchMessage(deptId, placeholder.id, {
        text: finalText || '(빈 응답입니다. 다시 물어봐 주세요.)',
        dept: routedDept(parsed.dept),
        status: 'done',
      });
      ctx.haptic(6);
      ctx.ding();
    } catch (err) {
      if (err?.name === 'AbortError') {
        if (placeholder) {
          const cur = parseDeptTag(raw).text.trim();
          if (cur) store.patchMessage(deptId, placeholder.id, { text: cur + ' …', status: 'done' });
          else store.removeMessage(deptId, placeholder.id);
        }
      } else {
        if (placeholder && !raw.trim()) store.removeMessage(deptId, placeholder.id);
        const msg = err instanceof ChatError ? err.message : '답장을 받지 못했습니다. 잠시 후 다시 시도해 주세요.';
        store.addMessage(deptId, { role: 'assistant', text: msg, error: true });
        if (err?.kind === 'no-key' || err?.kind === 'no-proxy' || err?.kind === 'auth') {
          ctx.openSettings();
        }
      }
    } finally {
      controller = null;
      streamingId = null;
      setSendMode('send');
      render();
    }
  }

  /**
   * 부서 배지는 헤뤼싀(비서실장) 방에서만 뜬다.
   * 부서 채팅방은 이미 그 팀 방이므로 태그가 와도 무시한다.
   */
  function routedDept(tag) {
    if (deptId !== 'chief') return null;
    if (!tag || tag === 'chief') return null;
    return getDept(tag).id === tag ? tag : null;
  }

  function setSendMode(mode) {
    if (mode === 'stop') {
      sendBtn.disabled = false;
      sendBtn.classList.add('is-stop');
      sendBtn.innerHTML = icons.stop(14);
      sendBtn.setAttribute('aria-label', '응답 중지');
    } else {
      sendBtn.classList.remove('is-stop');
      sendBtn.innerHTML = icons.arrowUp(18);
      sendBtn.setAttribute('aria-label', '보내기');
      sendBtn.disabled = !inputEl.value.trim();
    }
  }

  /* ---------------- 생명주기 ---------------- */

  el.__mount = () => {
    store.markRead(deptId);
    const chat = store.getChat(deptId);
    inputEl.value = chat.draft || '';
    autogrow();
    // 네비게이션 바 아바타는 화면을 만들 때 한 번 그려지므로 여기서 다시 맞춘다
    el.querySelector('#navAvatar').innerHTML =
      avatarMarkup(dept, 32, 'nav-' + dept.id, store.getPhotos());
    render();
    navbar.classList.toggle('is-transparent', messagesEl.scrollTop <= 2);
  };
  el.__refresh = el.__mount;
  el.__unmount = () => stop();

  return el;
}
