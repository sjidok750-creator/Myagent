/** 설정 시트 */

import * as store from '../store.js';
import { HONORIFICS } from '../persona.js';
import { esc } from '../format.js';
import { startConnect, disconnect, googleConfig } from '../google.js';
import * as push from '../push.js';

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
        <div class="row">
          <span class="row-label">헤뤼싀가 나를 부르는 말</span>
          <input type="text" id="honorific" value="${esc(s.honorific)}"
                 placeholder="${esc(HONORIFICS.join(' · '))}" maxlength="24">
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
      <div class="group-title">구글 연결</div>
      <div class="group-body" id="googleBox">
        <div class="row"><span class="row-label">확인 중…</span></div>
      </div>
      <div class="group-note">연결하면 헤뤼싀가 실제 캘린더에 일정을 넣고, 메일을 검색·정독하고, 답장 초안을 만듭니다.<br><b>메일은 대표님이 대화창에서 “보내기”를 눌러야만 나갑니다.</b> 헤뤼싀 혼자서는 보내지 못합니다.<br>토큰은 이 기기에만 저장되고 서버에는 남지 않습니다.</div>
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
      <div class="group-title">헤뤼싀가 먼저 말 걸기</div>
      <div class="group-body" id="pushBox">
        <div class="row"><span class="row-label">확인 중…</span></div>
      </div>
      <div class="group-note" id="pushNote"></div>
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
      root.querySelector('#honorific').addEventListener('input', (e) =>
        save({ honorific: e.target.value.trim() || '대표님' }));
      root.querySelector('#accessCode').addEventListener('input', (e) => save({ accessCode: e.target.value.trim() }));
      root.querySelector('#apiKey').addEventListener('input', (e) => save({ apiKey: e.target.value.trim() }));

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

      paintGoogle(root, ctx);
      paintPush(root, ctx);
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

async function paintGoogle(root, ctx) {
  const box = root.querySelector('#googleBox');
  if (!box) return;

  const cfg = await googleConfig();
  const g = store.getGoogle();
  const connected = store.googleConnected();

  if (!cfg.enabled) {
    box.innerHTML = `
      <div class="row">
        <span class="row-label" style="color:var(--label-2);font-size:15px;line-height:1.4">
          서버에 구글 클라이언트가 설정되지 않았습니다.<br>README 의 “구글 연결하기” 를 따라 주세요.
        </span>
      </div>`;
    return;
  }

  if (connected) {
    box.innerHTML = `
      <div class="row">
        <span class="row-label">연결됨</span>
        <span class="row-value">${esc(g.email || '구글 계정')}</span>
      </div>
      <button class="row is-danger" data-act="gdisconnect"><span class="row-label">연결 해제</span></button>`;
    box.querySelector('[data-act="gdisconnect"]').addEventListener('click', async () => {
      if (!confirm('구글 연결을 해제할까요? 헤뤼싀가 캘린더와 메일을 다루지 못하게 됩니다.')) return;
      await disconnect();
      ctx.toast('구글 연결을 해제했습니다.');
      paintGoogle(root, ctx);
      paintPush(root, ctx);
    });
    return;
  }

  box.innerHTML = `
    <button class="row is-button" data-act="gconnect">
      <span class="row-label">구글 계정 연결하기</span>
    </button>`;
  box.querySelector('[data-act="gconnect"]').addEventListener('click', async () => {
    try {
      await startConnect();
    } catch (err) {
      ctx.toast(err.message || '구글 연결을 시작하지 못했습니다.');
    }
  });
}

async function paintPush(root, ctx) {
  const box = root.querySelector('#pushBox');
  const note = root.querySelector('#pushNote');
  if (!box) return;

  const s = store.getSettings();
  const cfg = await push.pushConfig();
  const ready = push.readiness();

  if (!cfg.enabled) {
    box.innerHTML = `
      <div class="row">
        <span class="row-label" style="color:var(--label-2);font-size:15px;line-height:1.4">
          이 배포에는 알림이 설정되지 않았습니다.<br>README 의 “먼저 말 걸게 하기” 를 따라 주세요.
        </span>
      </div>`;
    note.textContent = (cfg.missing || []).length ? `필요한 것: ${cfg.missing.join(', ')}` : '';
    return;
  }

  if (!ready.ok && !s.pushEnabled) {
    box.innerHTML = `
      <div class="row">
        <span class="row-label" style="color:var(--label-2);font-size:15px;line-height:1.45;white-space:pre-line">${esc(ready.why)}</span>
      </div>`;
    note.textContent = '';
    return;
  }

  box.innerHTML = `
    <div class="row">
      <span class="row-label">아침 브리핑</span>
      <button type="button" class="switch" id="pushOn" role="switch" aria-checked="${!!s.pushEnabled}"></button>
    </div>
    <div class="row" id="pushRows" ${s.pushEnabled ? '' : 'hidden'}>
      <span class="row-label">시각</span>
      <input type="time" id="pushTime" value="${esc(s.pushTime || '08:00')}" style="text-align:right;border:0;background:transparent;outline:none;font-size:17px;margin-left:auto">
    </div>
    <div class="row" id="pushRows2" ${s.pushEnabled ? '' : 'hidden'}>
      <span class="row-label">주말은 쉬기</span>
      <button type="button" class="switch" id="pushWeekdays" role="switch" aria-checked="${!!s.pushWeekdaysOnly}"></button>
    </div>
    <div class="row" id="pushRows3" ${s.pushEnabled ? '' : 'hidden'}>
      <span class="row-label">오늘 일정 참고</span>
      <button type="button" class="switch" id="pushCal" role="switch" aria-checked="${!!s.pushShareCalendar}"></button>
    </div>
    <div class="row" id="pushRows4" ${s.pushEnabled ? '' : 'hidden'}>
      <span class="row-label">할 일 참고</span>
      <button type="button" class="switch" id="pushTasks" role="switch" aria-checked="${!!s.pushShareTasks}"></button>
    </div>
    <button class="row is-button" id="pushTest" ${s.pushEnabled ? '' : 'hidden'}>
      <span class="row-label">시험 알림 보내기</span>
    </button>`;

  note.innerHTML = s.pushEnabled
    ? '예약한 시각에 헤뤼싀가 먼저 오늘의 브리핑을 보냅니다.<br>' +
      '이때만 서버가 저장합니다: 알림 주소와 시각' +
      (s.pushShareCalendar ? ', <b>구글 갱신 토큰</b>' : '') +
      (s.pushShareTasks ? ', <b>미완료 할 일 목록</b>' : '') +
      '.<br>대화 내용은 저장되지 않습니다. 끄면 서버에서 지워집니다.'
    : '켜면 헤뤼싀가 예약한 시각에 먼저 말을 겁니다. 이 기능만 서버가 무언가를 저장합니다 — 무엇을 저장할지는 아래 스위치로 고르실 수 있습니다.';

  const rows = () => root.querySelectorAll('#pushRows, #pushRows2, #pushRows3, #pushRows4, #pushTest');

  root.querySelector('#pushOn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const turningOn = btn.getAttribute('aria-checked') !== 'true';
    btn.setAttribute('aria-checked', String(turningOn));
    rows().forEach((r) => { r.hidden = !turningOn; });

    if (turningOn) {
      const r = await push.enable();
      if (!r.ok) {
        btn.setAttribute('aria-checked', 'false');
        rows().forEach((x) => { x.hidden = true; });
        store.updateSettings({ pushEnabled: false });
        alert(r.error || '알림을 켜지 못했습니다.');
      } else {
        ctx.toast('헤뤼싀가 먼저 말을 걸도록 했습니다.');
      }
    } else {
      await push.disable();
      ctx.toast('알림을 껐습니다.');
    }
    paintPush(root, ctx);
  });

  const resync = async (patch) => {
    store.updateSettings(patch);
    const r = await push.sync();
    if (!r.ok && r.error) ctx.toast(r.error);
    paintPush(root, ctx);
  };

  root.querySelector('#pushTime')?.addEventListener('change', (e) => resync({ pushTime: e.target.value }));
  bindSwitch(root, '#pushWeekdays', (on) => resync({ pushWeekdaysOnly: on }));
  bindSwitch(root, '#pushCal', (on) => resync({ pushShareCalendar: on }));
  bindSwitch(root, '#pushTasks', (on) => resync({ pushShareTasks: on }));

  root.querySelector('#pushTest')?.addEventListener('click', async () => {
    ctx.toast('시험 알림을 보냅니다…');
    const r = await push.sendTest();
    ctx.toast(r.ok ? '보냈습니다. 잠시 후 알림이 뜹니다.' : r.error || '보내지 못했습니다.');
  });
}

function bindSwitch(root, sel, onChange) {
  const b = root.querySelector(sel);
  if (!b) return;
  b.addEventListener('click', () => {
    const on = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(on));
    onChange(on);
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
