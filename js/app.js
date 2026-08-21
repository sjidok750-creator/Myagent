/**
 * 헤뤼싀 — 앱 셸.
 * 화면 스택, 키보드 대응, 시트, 토스트, 알림음.
 */

import { listScreen } from './ui/list.js';
import { chatScreen } from './ui/chat.js';
import { vaultScreen } from './ui/vault.js';
import { infoSheet } from './ui/info.js';
import { settingsSheet } from './ui/settings.js';
import * as store from './store.js';
import { getDept } from './departments.js';
import { esc } from './format.js';

const app = document.getElementById('app');
const stack = [];

/* ------------------------------------------------------------------ */
/* 컨텍스트 — 모든 화면에 넘겨주는 앱 기능 모음                          */
/* ------------------------------------------------------------------ */

const ctx = {
  openChat,
  openVault,
  openInfo,
  openSettings,
  pop,
  sheet,
  toast,
  haptic,
  ding,
  refresh,
};

/**
 * 아바타 사진처럼 화면 전체에 영향을 주는 변화가 있을 때 다시 그린다.
 * 뒤에 깔린 화면도 함께 갱신해야 뒤로 갔을 때 옛 사진이 남지 않는다.
 */
function refresh() {
  for (const screen of stack) {
    if (screen.__refresh) screen.__refresh();
    else screen.__mount?.();
  }
}

function push(el, { replace = false } = {}) {
  const current = stack[stack.length - 1];
  app.appendChild(el);
  el.__mount?.();

  if (current && !replace) {
    current.classList.add('is-leaving');
    el.classList.add('is-entering');
    setTimeout(() => {
      current.classList.remove('is-leaving');
      current.style.display = 'none';
      el.classList.remove('is-entering');
    }, 340);
  }
  stack.push(el);
}

function pop() {
  if (stack.length < 2) return;
  const top = stack.pop();
  const below = stack[stack.length - 1];
  below.style.display = '';
  below.__refresh?.();
  below.classList.add('is-unpopping');
  top.classList.add('is-popping');
  setTimeout(() => {
    top.__unmount?.();
    top.remove();
    below.classList.remove('is-unpopping');
  }, 320);
  syncHash();
}

function openChat(deptId) {
  const dept = getDept(deptId);
  // 이미 그 대화가 열려 있으면 새로 쌓지 않는다
  const top = stack[stack.length - 1];
  if (top?.dataset.screen === 'chat' && top.dataset.dept === dept.id) return;
  if (top?.dataset.screen === 'chat') pop();

  const el = chatScreen(ctx, dept.id);
  el.dataset.dept = dept.id;
  setTimeout(() => {
    push(el);
    location.hash = `#/chat/${dept.id}`;
  }, top?.dataset.screen === 'chat' ? 330 : 0);
}

function openVault() {
  const top = stack[stack.length - 1];
  if (top?.dataset.screen === 'vault') return;
  const el = vaultScreen(ctx);
  push(el);
  location.hash = '#/vault';
}

function syncHash() {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (top.dataset.screen === 'chat') location.hash = `#/chat/${top.dataset.dept}`;
  else if (top.dataset.screen === 'vault') location.hash = '#/vault';
  else location.hash = '#/';
}

/* ------------------------------------------------------------------ */
/* 시트                                                                */
/* ------------------------------------------------------------------ */

let openSheetEl = null;

function sheet({ title, body, onMount }) {
  closeSheet();

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';

  const el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = `
    <div class="sheet-grabber"></div>
    <div class="sheet-head">
      <h2>${esc(title)}</h2>
      <button class="sheet-done" type="button">완료</button>
    </div>
    <div class="sheet-body"></div>`;
  el.querySelector('.sheet-body').innerHTML = body;

  const close = () => closeSheet();
  backdrop.addEventListener('click', close);
  el.querySelector('.sheet-done').addEventListener('click', close);

  app.appendChild(backdrop);
  app.appendChild(el);
  openSheetEl = { el, backdrop };

  onMount?.(el, close);
  return close;
}

function closeSheet() {
  if (!openSheetEl) return;
  const { el, backdrop } = openSheetEl;
  openSheetEl = null;
  el.classList.add('is-closing');
  backdrop.style.opacity = '0';
  backdrop.style.transition = 'opacity .24s';
  setTimeout(() => { el.remove(); backdrop.remove(); }, 280);
}

function openInfo(deptId) {
  infoSheet(ctx, deptId);
}
function openSettings() {
  settingsSheet(ctx);
}

/* ------------------------------------------------------------------ */
/* 토스트 / 햅틱 / 소리                                                 */
/* ------------------------------------------------------------------ */

let toastTimer = null;
function toast(text) {
  const old = app.querySelector('.toast');
  old?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  app.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.add('is-closing');
    setTimeout(() => t.remove(), 240);
  }, 2200);
}

function haptic(ms = 8) {
  if (!store.getSettings().haptics) return;
  navigator.vibrate?.(ms);
}

let audioCtx = null;
function ding() {
  if (!store.getSettings().sound) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    // 짧은 두 음 — 메시지 도착음 느낌
    [880, 1320].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.16, now + i * 0.09 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.2);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + i * 0.09);
      osc.stop(now + i * 0.09 + 0.24);
    });
  } catch {
    /* 소리는 없어도 그만 */
  }
}

/* ------------------------------------------------------------------ */
/* 키보드 대응 (iOS Safari)                                             */
/* ------------------------------------------------------------------ */

function trackKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const gap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', gap + 'px');
    app.style.bottom = gap + 'px';
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

/* ------------------------------------------------------------------ */
/* 첫 인사 — 대화가 비어 있으면 헤뤼싀가 먼저 말을 건다                  */
/* ------------------------------------------------------------------ */

function seedGreeting() {
  const chief = store.getChat('chief');
  if (chief.messages.length) return;
  const s = store.getSettings();
  const honorific = s.honorific || '대표님';
  store.addMessage('chief', {
    role: 'assistant',
    text:
      `나마스테, ${honorific}. 헤뤼싀입니다.\n` +
      `오늘부터 제가 ${honorific}의 비서실을 맡습니다.\n\n` +
      `여덟 개 팀이 저를 돕습니다.\n` +
      `• 일정·의전 · 정보분석 · 커뮤니케이션 · 재무\n` +
      `• 실행 · 인맥 · 컨디션 · 성장\n\n` +
      `말만 하는 비서실은 아닙니다. 웹을 직접 찾아보고, 계산하고, ` +
      `엑셀·문서·발표자료를 만들어 드립니다. ${honorific}께서 알려주신 것은 ` +
      `자료실에 적어두고 여덟 팀이 함께 봅니다.\n\n` +
      `무슨 일이든 여기에 던져 주세요. 제가 맡을 팀을 정해서 처리하고 결과만 보고드리겠습니다.\n` +
      `먼저 설정에서 성함과 지금 신경 쓰시는 일을 한 줄 적어 주시면 훨씬 잘 움직입니다.`,
  });
}

/* ------------------------------------------------------------------ */
/* 시작                                                                */
/* ------------------------------------------------------------------ */

function boot() {
  seedGreeting();
  trackKeyboard();

  const list = listScreen(ctx);
  app.appendChild(list);
  list.__mount?.();
  stack.push(list);

  // 딥링크 (#/chat/schedule)
  const m = location.hash.match(/^#\/chat\/([a-z]+)$/);
  if (m) openChat(m[1]);
  else if (location.hash === '#/vault') openVault();
  else location.hash = '#/';

  // 뒤로가기 제스처 / 하드웨어 뒤로가기
  window.addEventListener('hashchange', () => {
    const top = stack[stack.length - 1];
    if (location.hash === '#/' && top && top.dataset.screen !== 'list') pop();
  });

  // 설정을 아직 안 봤으면 한 번 열어준다
  if (!store.getSettings().onboarded) {
    store.updateSettings({ onboarded: true });
    setTimeout(() => openSettings(), 900);
  }

  document.body.classList.add('is-ready');

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
