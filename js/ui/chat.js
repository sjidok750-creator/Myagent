/** 대화 화면 — iMessage 스타일 말풍선 */

import { icons } from '../icons.js';
import { avatarMarkup } from '../avatar.js';
import { getDept, deptBadge } from '../departments.js';
import * as store from '../store.js';
import { sendChat, attachChat, parseDeptTag, ChatError } from '../api.js';
import { timeOf, sameDay, dayMark, richText, esc } from '../format.js';
import { saveFile, objectUrlFor, humanSize, fileIcon, makeAttachment } from '../files.js';
import { activeToken, sendDraft } from '../google.js';

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

    <div class="attach-tray" id="tray" hidden></div>

    <form class="composer" id="composer">
      <input type="file" id="picker" multiple hidden
             accept="image/*,application/pdf,text/*,.csv,.md,.json,.xlsx,.xls,.docx,.doc,.pptx,.ppt">
      <button type="button" class="composer-plus" data-act="attach" aria-label="첨부하기">${icons.plus(20)}</button>
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
  const trayEl = el.querySelector('#tray');
  const pickerEl = el.querySelector('#picker');
  const sendBtn = el.querySelector('#send');
  const formEl = el.querySelector('#composer');
  const navbar = el.querySelector('.navbar');

  let controller = null;   // 진행 중인 응답 중단용
  let streamingId = null;  // 스트리밍 중인 메시지 id
  let jumpBtn = null;
  let liveActs = [];       // 지금 돌아가는 도구 ("웹을 찾아보는 중")
  // 연결이 끊겨 미완으로 남겨 둔 말풍선. 다시 붙어 재생을 받으면 그 위에
  // 이어 그린다 — 새로 만들면 같은 답이 하나 더 쌓인다.
  let orphanId = null;
  let pending = [];        // 보내기 전 첨부

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

    if (controller && liveActs.length) messagesEl.appendChild(actEl(liveActs));
    if (controller && !streamingId && !liveActs.length) messagesEl.appendChild(typingEl(dept));

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
    const verifier = m.role === 'verifier';
    row.className = `msg ${out ? 'out' : 'in'}${verifier ? ' verifier' : ''}`;
    row.dataset.id = m.id;
    if (startsGroup) row.classList.add('group-start');
    if (endsGroup) row.classList.add('has-tail');
    row.classList.add(startsGroup && endsGroup ? 'g-solo' : startsGroup ? 'g-start' : endsGroup ? 'g-end' : 'g-mid');
    if (m.error) row.classList.add('is-error');

    const badge = verifier
      ? { tint: '#10a37f', emoji: '⚖️', label: m.vname || '검증', lead: '교차 검증' }
      : !out && m.dept ? deptBadge(m.dept) : null;
    const showAvatar = !out && endsGroup;
    if (showAvatar) row.classList.add('show-avatar');

    const speaker = !out && m.dept ? getDept(m.dept) : dept;
    const avatarHtml = verifier
      ? `<span class="avatar msg-avatar v-avatar">⚖️</span>`
      : `<span class="avatar msg-avatar">${avatarMarkup(speaker, 28, 'm-' + m.id, store.getPhotos())}</span>`;

    row.innerHTML = `
      ${out ? '' : avatarHtml}
      <div class="msg-stack">
        ${badge ? `<span class="dept-chip" style="background:${esc(badge.tint)}">${badge.emoji} ${esc(badge.label)} <span class="lead">${esc(badge.lead)}</span></span>` : ''}
        <div class="bubble${m.status === 'streaming' ? ' no-anim' : ''}">${richText(m.text)}</div>
        ${m.reaction ? `<span class="tapback">${esc(m.reaction)}</span>` : ''}
      </div>`;

    // 리액션은 말풍선 기준으로 위치해야 한다
    const tapback = row.querySelector('.tapback');
    if (tapback) row.querySelector('.bubble').appendChild(tapback);

    // 헤뤼싀가 쓴 도구 기록
    if (!out && m.acts?.length) {
      const acts = document.createElement('div');
      acts.className = 'act-done';
      acts.textContent = m.acts.join(' · ');
      row.querySelector('.msg-stack').prepend(acts);
    }

    // 대표님이 보낸 첨부
    if (m.attachments?.length) {
      const stack = row.querySelector('.msg-stack');
      const bubble = row.querySelector('.bubble');
      for (const a of m.attachments) {
        stack.insertBefore(sentAttachment(a), bubble);
      }
      if (!m.text.trim()) bubble.remove();
    }

    // 만들어진 파일
    if (m.files?.length) {
      for (const f of m.files) {
        row.querySelector('.msg-stack').appendChild(fileCard(f));
      }
    }

    // 발송 대기 중인 메일 초안
    if (m.draft) {
      row.querySelector('.msg-stack').appendChild(draftCard(m, m.draft));
    }

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

  function actEl(labels) {
    const row = document.createElement('div');
    row.className = 'act-live';
    row.innerHTML = `<span class="act-spin"></span><span>${esc(labels.join(' · '))}…</span>`;
    return row;
  }

  function sentAttachment(a) {
    if (a.thumb) {
      const img = document.createElement('img');
      img.className = 'sent-image';
      img.src = a.thumb;
      img.alt = a.name;
      img.loading = 'lazy';
      return img;
    }
    const box = document.createElement('span');
    box.className = 'file-card is-sent';
    box.innerHTML = `
      <span class="file-icon">${fileIcon(a.name)}</span>
      <span class="file-meta">
        <span class="file-name">${esc(a.name)}</span>
        <span class="file-size">${esc(humanSize(a.size))}</span>
      </span>`;
    return box;
  }

  function draftCard(msg, draft) {
    const card = document.createElement('div');
    card.className = 'draft-card' + (draft.sent ? ' is-sent' : '');
    card.innerHTML = `
      <div class="draft-head">✉️ 메일 초안 · 아직 보내지 않았습니다</div>
      <div class="draft-line"><b>받는이</b> ${esc(draft.to)}</div>
      ${draft.cc ? `<div class="draft-line"><b>참조</b> ${esc(draft.cc)}</div>` : ''}
      <div class="draft-line"><b>제목</b> ${esc(draft.subject)}</div>
      <div class="draft-body">${esc(draft.body).slice(0, 1200)}</div>
      <div class="draft-actions">
        <button type="button" class="draft-send">보내기</button>
        <span class="draft-note">지메일 임시보관함에도 저장되어 있습니다</span>
      </div>`;

    if (draft.sent) {
      card.querySelector('.draft-head').textContent = '✅ 보냈습니다';
      card.querySelector('.draft-actions').innerHTML =
        `<span class="draft-note">${esc(draft.sentAt || '')} 에 발송됨</span>`;
      return card;
    }

    const btn = card.querySelector('.draft-send');
    btn.addEventListener('click', async () => {
      if (!confirm(`${draft.to} 에게 메일을 보냅니다.\n제목: ${draft.subject}\n\n보낼까요?`)) return;
      btn.disabled = true;
      btn.textContent = '보내는 중…';
      try {
        await sendDraft(draft.id);
        store.patchMessage(deptId, msg.id, {
          draft: { ...draft, sent: true, sentAt: timeOf(Date.now()) },
        });
        ctx.haptic(12);
        ctx.toast('메일을 보냈습니다.');
        render({ keepScroll: true });
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '보내기';
        ctx.toast(err.message || '메일을 보내지 못했습니다.');
      }
    });
    return card;
  }

  function fileCard(f) {
    // 진짜 <a download> 여야 아이폰에서 공유 시트가 뜨고 파일명이 지켜진다.
    const card = document.createElement('a');
    card.className = 'file-card';
    card.download = f.name || 'file';
    card.rel = 'noopener';
    card.innerHTML = `
      <span class="file-icon">${fileIcon(f.name)}</span>
      <span class="file-meta">
        <span class="file-name">${esc(f.name)}</span>
        <span class="file-size">${esc(humanSize(f.size))} · 눌러서 저장</span>
      </span>`;

    objectUrlFor(f).then(
      (url) => { card.href = url; },
      () => {
        card.classList.add('is-gone');
        card.querySelector('.file-size').textContent = '파일이 남아 있지 않습니다';
      }
    );

    card.addEventListener('click', (e) => {
      if (!card.href) {
        e.preventDefault();
        ctx.toast('파일을 여는 중입니다. 잠시 후 다시 눌러 주세요.');
        return;
      }
      ctx.haptic(8);
    });
    return card;
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

  /* ---------------- 첨부 ---------------- */

  function renderTray() {
    trayEl.hidden = !pending.length;
    trayEl.innerHTML = pending
      .map(
        (a, idx) => `
        <div class="attach-chip">
          ${a.thumb
            ? `<img class="attach-thumb" src="${a.thumb}" alt="">`
            : `<span class="attach-thumb is-icon">${fileIcon(a.name)}</span>`}
          <span class="attach-name">${esc(a.name)}</span>
          <button type="button" class="attach-x" data-drop="${idx}" aria-label="빼기">&times;</button>
        </div>`
      )
      .join('');
    autogrow();
  }

  trayEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-drop]');
    if (!b) return;
    pending.splice(Number(b.dataset.drop), 1);
    renderTray();
  });

  el.querySelector('[data-act="attach"]').addEventListener('click', () => {
    ctx.haptic(6);
    pickerEl.click();
  });

  pickerEl.addEventListener('change', async () => {
    const files = [...(pickerEl.files || [])];
    pickerEl.value = '';
    for (const f of files.slice(0, 6 - pending.length)) {
      try {
        pending.push(await makeAttachment(f));
      } catch (err) {
        ctx.toast(err.message || '첨부하지 못했습니다.');
      }
    }
    renderTray();
    inputEl.focus();
  });

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
    sendBtn.disabled = !inputEl.value.trim() && !pending.length && !controller;
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
    const attachments = pending;
    if ((!text && !attachments.length) || controller) return;

    inputEl.value = '';
    pending = [];
    renderTray();
    store.setDraft(deptId, '');
    autogrow();
    ctx.haptic(10);

    store.addMessage(deptId, { role: 'user', text, attachments });
    render();
    await run();
  }

  async function retryLast(errorId) {
    if (controller) return;
    store.removeMessage(deptId, errorId);
    render();
    await run();
  }

  /**
   * @param {{attach?: boolean}} [mode] attach 면 새 메시지를 보내지 않고,
   *   그 방에서 돌고 있는 작업에 붙어 진행 상황을 이어 본다.
   */
  async function run(mode = {}) {
    const settings = store.getSettings();
    controller = new AbortController();
    setSendMode('stop');
    render();

    let placeholder = null;
    let raw = '';
    const acts = [];        // 이번 답변에서 쓴 도구
    const files = [];       // 이번 답변에서 만들어진 파일
    let draft = null;       // 발송 대기 메일 초안
    liveActs = [];

    // 구글이 연결돼 있으면 이번 요청에 쓸 토큰을 미리 받아 둔다
    let google;
    if (settings.tools !== false && store.googleConnected()) {
      try {
        const tok = await activeToken();
        if (tok) google = { accessToken: tok.accessToken, email: tok.email };
      } catch (err) {
        ctx.toast(err.message || '구글 연결이 만료되었습니다.');
      }
    }

    /* 서버에 붙을 작업이 있어서 재생이 시작될 때만 부른다(attach 이벤트).
     * 붙을 작업이 없으면 재생도 없으므로, 남겨 둔 말풍선은 손대지 않는다 —
     * 서버가 "이미 다 전했다"고 보관하지 않은 답이면 그게 유일한 사본이다. */
    const adoptOrphan = () => {
      if (placeholder || !orphanId) return;
      const kept = store.getChat(deptId).messages.find((m) => m.id === orphanId);
      orphanId = null;
      if (!kept) return;
      placeholder = kept;
      streamingId = kept.id;
      store.patchMessage(deptId, kept.id, { status: 'streaming', text: '' });
    };

    // 파일이 본문보다 먼저 도착할 수 있다. 말풍선은 하나만 만든다.
    const ensurePlaceholder = () => {
      if (!placeholder) {
        placeholder = store.addMessage(deptId, { role: 'assistant', text: '', status: 'streaming' });
        streamingId = placeholder.id;
      }
      return placeholder;
    };

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
      const full = await (mode.attach ? attachChat : sendChat)({
        deptId,
        messages: chat.messages,
        settings,
        workspace: settings.tools !== false ? store.getWorkspace() : undefined,
        container: chat.container || undefined,
        google,
        signal: controller.signal,
        onStart: () => {
          ensurePlaceholder();
          render();
        },
        onDelta: (t) => {
          raw += t;
          paint();
        },
        onReset: (info) => {
          // 로컬 브릿지 전용: 도구를 부르느라 이전 서술을 버리고 새로 쓴다.
          raw = '';
          if (info?.attached) adoptOrphan();
          paint();
        },
        onTool: (evt) => {
          if (evt.phase === 'start' && evt.label) {
            if (!liveActs.includes(evt.label)) liveActs.push(evt.label);
            if (!acts.includes(evt.label)) acts.push(evt.label);
            render({ keepScroll: true });
          } else if (evt.phase === 'end') {
            liveActs = liveActs.filter((l) => l !== evt.label);
            render({ keepScroll: true });
          } else if (evt.phase === 'note' && evt.label) {
            ctx.toast(evt.label);
          }
        },
        onFile: async (f) => {
          try {
            ensurePlaceholder();
            files.push(await saveFile(f));
            store.patchMessage(deptId, placeholder.id, { files: [...files] });
            render({ keepScroll: true });
          } catch (err) {
            ctx.toast('파일을 저장하지 못했습니다: ' + (err.message || ''));
          }
        },
        onWorkspace: (ws) => store.setWorkspace(ws),
        onAttachmentId: (evt) => store.rememberAttachmentId(deptId, evt.localId, evt.fileId),
        onDraft: (d) => {
          draft = d;
          ensurePlaceholder();
          store.patchMessage(deptId, placeholder.id, { draft });
          render({ keepScroll: true });
        },
        onRooms: (rooms) => {
          // 헤뤼싀가 방을 만들었거나 완료 처리했다 — 대화 목록이 바뀐다
          store.setRooms(rooms);
        },
        onVerifier: (evt) => {
          // 검증 친구의 검토 — 별도 말풍선. 대화 이력에는 넣지 않는다(role 필터).
          store.addMessage(deptId, { role: 'verifier', text: evt.text || '', vname: evt.name });
          render({ keepScroll: true });
          ctx.haptic(4);
        },
        onFollowup: (evt) => {
          // 검토를 받은 헤뤼싀의 답(수용 또는 반박), 또는 화면을 벗어난 사이
          // 못 전했던 답. 어느 쪽이든 맨 앞의 [[dept:...]] 태그를 떼고 그린다.
          const parsed = parseDeptTag(evt.text || '');
          const body = (parsed.text || '').trim();
          if (!body) return;
          // 못 받아 간 답이 통째로 왔다 — 남겨 둔 조각은 이걸로 대체된다
          if (evt.resumed && orphanId) {
            store.removeMessage(deptId, orphanId);
            orphanId = null;
          }
          store.addMessage(deptId, {
            role: 'assistant',
            status: 'done',
            dept: routedDept(parsed.dept),
            text: evt.resumed ? `📨 아까 화면을 벗어나서 전하지 못했던 답입니다.\n\n${body}` : body,
          });
          render({ keepScroll: true });
        },
        onDone: (info) => {
          if (info?.container) store.setContainer(deptId, info.container);
        },
      });

      const parsed = parseDeptTag(full);
      const finalText = (parsed.text || '').trim();

      // 붙어봤는데 돌고 있는 일도, 놓친 답도 없었다 — 조용히 끝낸다.
      if (mode.attach && !finalText && !files.length && !placeholder) return;

      ensurePlaceholder();
      store.patchMessage(deptId, placeholder.id, {
        text: finalText || (files.length ? '' : '(빈 응답입니다. 다시 물어봐 주세요.)'),
        dept: routedDept(parsed.dept),
        status: 'done',
        acts,
        files,
        ...(draft ? { draft } : {}),
      });
      orphanId = null;
      ctx.haptic(6);
      ctx.ding();
    } catch (err) {
      if (err?.name === 'AbortError') {
        if (placeholder) {
          const cur = parseDeptTag(raw).text.trim();
          if (cur) store.patchMessage(deptId, placeholder.id, { text: cur + ' …', status: 'done' });
          else store.removeMessage(deptId, placeholder.id);
        }
      } else if (err?.kind === 'dropped') {
        // 연결만 끊겼다. 서버는 계속 일한다 — 실패 말풍선을 띄우지 않는다.
        // 여기까지 받은 답은 지우지 않는다. 서버가 이미 다 보냈다고 판단하면
        // 보관하지 않으므로, 지우면 그 답은 어디에도 남지 않는다(실제로 그렇게
        // 사라졌다). 다시 붙어 재생이 오면 이 말풍선 위에 덮어 그린다.
        if (placeholder) {
          const cur = parseDeptTag(raw).text.trim();
          if (cur || files.length) {
            store.patchMessage(deptId, placeholder.id, { text: cur, status: 'done', acts, files });
            orphanId = placeholder.id;
          } else {
            store.removeMessage(deptId, placeholder.id);
          }
        }
        if (!mode.attach) ctx.toast('연결이 끊겼습니다 — 헤뤼싀는 계속 일하는 중입니다');
        scheduleResume();
      } else if (mode.attach && (err?.kind === 'network' || err?.kind === 'server')) {
        // 몰래 다시 붙어보다 실패했다. 대표님이 시킨 일이 아니므로 조용히
        // 물러나고 나중에 또 시도한다 — 빨간 말풍선을 띄울 일이 아니다.
        scheduleResume();
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
      liveActs = [];
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
      sendBtn.disabled = !inputEl.value.trim() && !pending.length;
    }
  }

  /* ---------------- 생명주기 ---------------- */

  /**
   * 화면으로 돌아왔을 때 그 방에서 돌고 있는 작업에 다시 붙는다.
   * 아직 일하는 중이면 진행 상황이 이어서 보이고, 이미 끝났으면 결과가 온다.
   * 아무 일도 없으면 조용히 끝난다. 이미 보고 있는 중이면 건드리지 않는다.
   */
  let resumeTimer = null;
  let resumeWait = 1500;

  function reattach() {
    if (controller) return;                       // 이미 보고 있다
    if (store.getSettings().mode === 'direct') return; // 브릿지 모드에서만
    resumeWait = 1500;
    run({ attach: true }).catch(() => {});
  }

  /**
   * 연결이 끊겼을 때 다시 붙기를 예약한다.
   * 화면을 벗어난 동안에는 브라우저가 타이머를 멈추므로, 깨어났을 때
   * 이미 지난 예약이면 그냥 넘기고 visibilitychange 쪽에 맡긴다.
   * 서버가 아직 안 살아났을 수도 있어 간격을 늘려 가며 시도한다.
   */
  function scheduleResume() {
    if (resumeTimer) return;
    const wait = resumeWait;
    resumeWait = Math.min(resumeWait * 2, 15000);
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      if (document.visibilityState !== 'visible') return;
      if (controller) return;
      if (store.getSettings().mode === 'direct') return;
      run({ attach: true }).catch(() => {});
    }, wait);
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') reattach();
  };

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
    // __refresh 가 __mount 를 다시 부르므로 중복 등록을 막는다
    document.removeEventListener('visibilitychange', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    reattach();
  };
  el.__refresh = el.__mount;
  el.__unmount = () => {
    document.removeEventListener('visibilitychange', onVisible);
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
    stop();
  };

  return el;
}
