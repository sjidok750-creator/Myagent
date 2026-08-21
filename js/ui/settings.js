/** 설정 시트 */

import * as store from '../store.js';
import { HONORIFICS } from '../persona.js';
import { esc } from '../format.js';

const MODELS = [
  { id: 'claude-opus-5', label: 'Opus 5', note: '가장 똑똑함 (기본)' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', note: '빠르고 저렴' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', note: '가장 빠름' },
];

export function settingsSheet(ctx) {
  const s = store.getSettings();

  const body = `
    <div class="group">
      <div class="group-title">나에 대하여</div>
      <div class="group-body">
        <div class="row">
          <span class="row-label">이름</span>
          <input type="text" id="ownerName" value="${esc(s.ownerName)}" placeholder="예: 김성진" maxlength="24">
        </div>
        <div class="row is-stacked">
          <span class="row-label">헤뤼싀가 나를 부르는 말</span>
          <span class="seg" id="honorific">
            ${HONORIFICS.map((h) => `<button type="button" data-v="${esc(h)}" aria-pressed="${s.honorific === h}">${esc(h)}</button>`).join('')}
          </span>
        </div>
        <div class="row" style="align-items:flex-start;flex-direction:column;gap:4px">
          <span class="row-label" style="color:var(--label-2);font-size:13px">헤뤼싀가 기억할 것</span>
          <textarea id="ownerNote" rows="4" maxlength="1200"
            placeholder="하는 일, 중요한 사람, 지금 신경 쓰는 목표…">${esc(s.ownerNote)}</textarea>
        </div>
      </div>
      <div class="group-note">이 내용은 이 기기에 저장되고, 대화할 때마다 헤뤼싀와 각 팀장에게 전달됩니다.</div>
    </div>

    <div class="group">
      <div class="group-title">연결 방식</div>
      <div class="group-body">
        <div class="row is-stacked">
          <span class="row-label">연결 모드</span>
          <span class="seg" id="mode">
            <button type="button" data-v="server" aria-pressed="${s.mode === 'server'}">서버 프록시</button>
            <button type="button" data-v="direct" aria-pressed="${s.mode === 'direct'}">직접 연결</button>
          </span>
        </div>
        <div class="row" id="accessRow" ${s.mode === 'server' ? '' : 'hidden'}>
          <span class="row-label">접속 코드</span>
          <input type="password" id="accessCode" value="${esc(s.accessCode)}" placeholder="설정했다면 입력" autocomplete="off">
        </div>
        <div class="row" id="keyRow" ${s.mode === 'direct' ? '' : 'hidden'}>
          <span class="row-label">API 키</span>
          <input type="password" id="apiKey" value="${esc(s.apiKey)}" placeholder="sk-ant-..." autocomplete="off" spellcheck="false">
        </div>
      </div>
      <div class="group-note" id="modeNote"></div>
    </div>

    <div class="group">
      <div class="group-title">헤뤼싀가 쓸 수 있는 것</div>
      <div class="group-body">
        <div class="row">
          <span class="row-label">도구 사용</span>
          <button type="button" class="switch" id="tools" role="switch" aria-checked="${s.tools !== false}"></button>
        </div>
        <button class="row is-button" data-act="vault">
          <span class="row-label">비서실 자료실 열기</span>
        </button>
      </div>
      <div class="group-note">켜면 헤뤼싀가 웹을 검색하고, 계산하고, 엑셀·문서·발표자료를 만들고, 메모·할 일·사람을 자료실에 기록합니다. 끄면 대화만 합니다(빠르고 저렴).<br>직접 연결 모드에서는 도구를 쓸 수 없습니다.</div>
    </div>

    <div class="group">
      <div class="group-title">모델</div>
      <div class="group-body" id="models">
        ${MODELS.map(
          (m) => `<button type="button" class="row" data-model="${m.id}" style="width:100%;text-align:left">
            <span class="dept-row-main">
              <span class="t">${m.label}</span>
              <span class="dept-row-sub">${m.note}</span>
            </span>
            <span class="row-value" data-check="${m.id}" style="color:var(--blue);font-weight:600">${s.model === m.id ? '✓' : ''}</span>
          </button>`
        ).join('')}
      </div>
      <div class="group-body" style="margin-top:22px">
        <div class="row is-stacked">
          <span class="row-label">응답 깊이</span>
          <span class="seg" id="effort">
            <button type="button" data-v="low" aria-pressed="${s.effort === 'low'}">빠르게</button>
            <button type="button" data-v="medium" aria-pressed="${s.effort === 'medium'}">보통</button>
            <button type="button" data-v="high" aria-pressed="${s.effort === 'high'}">깊게</button>
          </span>
        </div>
      </div>
      <div class="group-note">깊게 둘수록 생각을 오래 하고 답이 느려집니다. 메신저 대화는 “빠르게”가 알맞습니다.</div>
    </div>

    <div class="group">
      <div class="group-title">헤뤼싀 얼굴</div>
      <div class="group-body">
        <button class="row is-button" data-act="face">
          <span class="row-label">사진 고르기 · 조직도에서 팀장 사진도 바꾸기</span>
        </button>
      </div>
      <div class="group-note">사진은 이 기기에만 저장됩니다.</div>
    </div>

    <div class="group">
      <div class="group-title">앱</div>
      <div class="group-body">
        <div class="row">
          <span class="row-label">받은 메시지 소리</span>
          <button type="button" class="switch" id="sound" role="switch" aria-checked="${!!s.sound}"></button>
        </div>
        <div class="row">
          <span class="row-label">진동</span>
          <button type="button" class="switch" id="haptics" role="switch" aria-checked="${!!s.haptics}"></button>
        </div>
      </div>
    </div>

    <div class="group">
      <div class="group-body">
        <button class="row is-danger" data-act="wipe"><span class="row-label">모든 대화와 설정 지우기</span></button>
      </div>
      <div class="group-note">헤뤼싀 · 아이폰 홈 화면에 추가하면 앱처럼 열립니다.<br>공유 버튼 → “홈 화면에 추가”</div>
    </div>
  `;

  return ctx.sheet({
    title: '설정',
    body,
    onMount(root, close) {
      const save = (patch) => store.updateSettings(patch);

      root.querySelector('#ownerName').addEventListener('input', (e) => save({ ownerName: e.target.value }));
      root.querySelector('#ownerNote').addEventListener('input', (e) => save({ ownerNote: e.target.value }));
      root.querySelector('#accessCode').addEventListener('input', (e) => save({ accessCode: e.target.value.trim() }));
      root.querySelector('#apiKey').addEventListener('input', (e) => save({ apiKey: e.target.value.trim() }));

      seg(root, '#honorific', (v) => save({ honorific: v }));
      seg(root, '#effort', (v) => save({ effort: v }));
      seg(root, '#mode', (v) => {
        save({ mode: v });
        root.querySelector('#accessRow').hidden = v !== 'server';
        root.querySelector('#keyRow').hidden = v !== 'direct';
        paintNote(root, v);
      });
      paintNote(root, store.getSettings().mode);

      root.querySelector('#models').addEventListener('click', (e) => {
        const b = e.target.closest('[data-model]');
        if (!b) return;
        save({ model: b.dataset.model });
        root.querySelectorAll('[data-check]').forEach((c) => {
          c.textContent = c.dataset.check === b.dataset.model ? '✓' : '';
        });
        ctx.haptic(6);
      });

      toggle(root, '#tools', (on) => save({ tools: on }));
      toggle(root, '#sound', (on) => save({ sound: on }));

      root.querySelector('[data-act="vault"]').addEventListener('click', () => {
        close();
        setTimeout(() => ctx.openVault(), 200);
      });
      toggle(root, '#haptics', (on) => save({ haptics: on }));

      root.querySelector('[data-act="face"]').addEventListener('click', () => {
        close();
        setTimeout(() => ctx.openInfo('chief'), 200);
      });

      root.querySelector('[data-act="wipe"]').addEventListener('click', () => {
        if (!confirm('모든 대화와 설정을 지웁니다. 되돌릴 수 없습니다. 계속할까요?')) return;
        store.clearEverything();
        close();
        ctx.toast('전부 지웠습니다.');
      });
    },
  });
}

function paintNote(root, mode) {
  const note = root.querySelector('#modeNote');
  note.innerHTML =
    mode === 'server'
      ? '이 웹앱을 배포한 서버(<code>/api/chat</code>)를 거칩니다. API 키는 서버 환경변수에만 있고 이 기기에는 남지 않습니다. 권장 방식입니다.'
      : '이 브라우저가 Anthropic API를 직접 호출합니다. API 키가 이 기기에 저장됩니다. 서버 없이 쓸 수 있지만, 남의 기기에서는 쓰지 마세요.';
}

function seg(root, sel, onPick) {
  const wrap = root.querySelector(sel);
  if (!wrap) return;
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    wrap.querySelectorAll('[data-v]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    onPick(b.dataset.v);
  });
}

function toggle(root, sel, onChange) {
  const b = root.querySelector(sel);
  if (!b) return;
  b.addEventListener('click', () => {
    const on = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(on));
    onChange(on);
  });
}
