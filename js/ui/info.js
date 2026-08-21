/** 부서 정보 / 비서실 조직도 시트 */

import { icons } from '../icons.js';
import { avatarMarkup, photoToDataURL } from '../avatar.js';
import { DEPARTMENTS, getDept } from '../departments.js';
import * as store from '../store.js';
import { esc } from '../format.js';

export function infoSheet(ctx, deptId) {
  const dept = getDept(deptId);
  const isChief = dept.id === 'chief';

  const body = `
    <div class="profile">
      <button class="avatar photo-pick" type="button" data-act="pick-photo" aria-label="${esc(dept.lead)} 얼굴 사진 바꾸기">
        ${avatarMarkup(dept, 104, 'info-' + dept.id, store.getPhotos())}
        <span class="photo-pick-hint">사진</span>
      </button>
      <input type="file" accept="image/*" id="photoInput" hidden>
      <div class="profile-name">${esc(dept.lead)}</div>
      <div class="profile-role">${esc(dept.role)}</div>
      <div class="profile-tagline">${esc(dept.tagline)}</div>
    </div>

    ${isChief ? chiefChips() : ''}

    <div class="group">
      <div class="group-title">${isChief ? '인물' : '부서'}</div>
      <div class="group-body">
        <div class="row"><span class="row-label">이름</span><span class="row-value">${esc(dept.lead)} · ${esc(dept.leadRomanized)}</span></div>
        <div class="row"><span class="row-label">담당</span><span class="row-value" style="text-align:right;max-width:62%">${esc(dept.scope)}</span></div>
        ${isChief ? `
        <div class="row"><span class="row-label">출신</span><span class="row-value">인도 케랄라 · 뭄바이</span></div>
        <div class="row"><span class="row-label">언어</span><span class="row-value">한국어 · English · हिन्दी</span></div>` : `
        <div class="row"><span class="row-label">보고 라인</span><span class="row-value">헤뤼싀 비서실장</span></div>`}
      </div>
    </div>

    ${dept.doctrine ? `
    <div class="group">
      <div class="group-title">일하는 원칙</div>
      <div class="group-body">
        <div class="row" style="display:block;padding:12px 16px">
          <div style="font-size:15px;line-height:1.55;color:var(--label-2);white-space:pre-wrap">${esc(dept.doctrine.replace(/^- /gm, '· '))}</div>
        </div>
      </div>
    </div>` : ''}

    <div class="group">
      <div class="group-title">비서실 조직도</div>
      <div class="group-body" id="orgList">
        ${DEPARTMENTS.map((d) => orgRow(d, d.id === dept.id)).join('')}
      </div>
      <div class="group-note">부서를 누르면 그 팀장과의 대화방으로 바로 들어갑니다. 헤뤼싀 방에서 이야기하면 실장이 알맞은 팀으로 넘겨 처리합니다.</div>
    </div>

    <div class="group">
      <div class="group-title">얼굴 사진</div>
      <div class="group-body">
        <button class="row is-button" data-act="pick-photo">
          <span class="row-label">${esc(dept.lead)} 사진 바꾸기</span>
        </button>
        <button class="row is-button" data-act="reset-photo" ${store.getPhotos()[dept.id] ? '' : 'hidden'}>
          <span class="row-label">기본 일러스트로 되돌리기</span>
        </button>
      </div>
      <div class="group-note">폰 사진첩에서 고른 사진이 대화 목록·말풍선·프로필에 함께 쓰입니다. 사진은 이 기기 안에만 저장되고 서버로 올라가지 않습니다.</div>
    </div>

    <div class="group">
      <div class="group-body">
        <button class="row is-danger" data-act="clear">
          ${icons.trash(20)}<span class="row-label">이 대화 내용 지우기</span>
        </button>
      </div>
    </div>
  `;

  return ctx.sheet({
    title: isChief ? '비서실' : dept.name,
    body,
    onMount(root, close) {
      root.querySelector('#orgList').addEventListener('click', (e) => {
        const row = e.target.closest('[data-dept]');
        if (!row) return;
        close();
        ctx.haptic(8);
        setTimeout(() => ctx.openChat(row.dataset.dept), 180);
      });

      const fileInput = root.querySelector('#photoInput');
      root.querySelectorAll('[data-act="pick-photo"]').forEach((b) =>
        b.addEventListener('click', () => fileInput.click())
      );

      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;
        try {
          const dataURL = await photoToDataURL(file);
          store.setPhoto(dept.id, dataURL);
          close();
          ctx.haptic(10);
          ctx.toast(`${dept.lead} 얼굴을 바꿨습니다.`);
          ctx.refresh();
        } catch (err) {
          ctx.toast(err.message || '사진을 넣지 못했습니다.');
        }
      });

      root.querySelector('[data-act="reset-photo"]').addEventListener('click', () => {
        store.setPhoto(dept.id, null);
        close();
        ctx.toast('기본 일러스트로 되돌렸습니다.');
        ctx.refresh();
      });

      root.querySelector('[data-act="clear"]').addEventListener('click', () => {
        if (!confirm(`${dept.name} 대화 내용을 모두 지울까요?`)) return;
        store.clearChat(dept.id);
        close();
        ctx.toast('대화 내용을 지웠습니다.');
      });
    },
  });
}

function chiefChips() {
  return `<div class="chip-row">
    <span class="chip">비서실장</span>
    <span class="chip">34세</span>
    <span class="chip">🇮🇳 인도</span>
    <span class="chip">전략 컨설턴트 출신</span>
    <span class="chip">${DEPARTMENTS.length - 1}개 팀 총괄</span>
  </div>`;
}

function orgRow(d, active) {
  const summary = store.chatSummary(d.id);
  return `
    <button class="row" data-dept="${d.id}" style="width:100%;text-align:left">
      <span class="dept-row-icon" style="background:${esc(d.tint)}22;color:${esc(d.tint)}">${d.emoji}</span>
      <span class="dept-row-main">
        <span class="t">${esc(d.id === 'chief' ? '비서실장실' : d.name)}${active ? ' <span style="color:var(--label-2);font-size:13px">· 지금 여기</span>' : ''}</span>
        <span class="dept-row-sub">${esc(d.lead)} · ${esc(d.scope)}</span>
      </span>
      ${summary.unread ? `<span class="badge-count">${summary.unread}</span>` : ''}
      <span style="color:var(--label-3);display:flex">${icons.chevronRight(15)}</span>
    </button>`;
}
