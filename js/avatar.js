/**
 * 인물 아바타를 인라인 SVG로 그린다.
 * 외부 이미지 없이 부서별로 다른 얼굴을 만들기 위한 최소한의 일러스트.
 */

const ESC = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * @param {object} a  아바타 설정 (departments.js 의 avatar 필드)
 * @param {{size?:number, id?:string}} opts
 * @returns {string} SVG 마크업
 */
export function avatarSVG(a, opts = {}) {
  const size = opts.size || 44;
  const uid = (opts.id || Math.random().toString(36).slice(2)) + '-av';

  return `<svg class="avatar-svg" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="bg-${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${ESC(a.topAlt)}"/>
      <stop offset="100%" stop-color="${ESC(a.top)}"/>
    </linearGradient>
    <clipPath id="clip-${uid}"><circle cx="50" cy="50" r="50"/></clipPath>
  </defs>
  <g clip-path="url(#clip-${uid})">
    <rect width="100" height="100" fill="url(#bg-${uid})"/>
    <!-- 어깨 / 사리 상의 -->
    <path d="M50 62c20 0 34 12 38 30v8H12v-8c4-18 18-30 38-30z" fill="${ESC(a.top)}"/>
    <path d="M50 64c-7 0-12 3-15 8l15 28 15-28c-3-5-8-8-15-8z" fill="${ESC(a.accent)}" opacity=".92"/>
    <!-- 사리 두파타 자락 -->
    <path d="M22 100c2-14 8-24 17-30l6 6-9 24z" fill="${ESC(a.topAlt)}" opacity=".75"/>
    <!-- 머리카락 뒤 -->
    <path d="M50 12c-17 0-27 12-27 29 0 12 2 22 5 32h44c3-10 5-20 5-32 0-17-10-29-27-29z" fill="${ESC(a.hair)}"/>
    <!-- 목 -->
    <path d="M42 55h16v14a8 8 0 0 1-16 0z" fill="${ESC(a.skinShadow)}"/>
    <!-- 얼굴 -->
    <ellipse cx="50" cy="42" rx="19" ry="22" fill="${ESC(a.skin)}"/>
    <!-- 앞머리 가르마 -->
    <path d="M50 18c-13 0-20 9-20 20 0 3 .4 5 1 7 1-9 5-14 10-16 3 4 8 6 15 6s10 3 12 10c.6-2 1-4 1-7 0-11-6-20-19-20z" fill="${ESC(a.hair)}"/>
    <!-- 귀걸이 -->
    <circle cx="30" cy="46" r="3" fill="${ESC(a.earring)}"/>
    <circle cx="70" cy="46" r="3" fill="${ESC(a.earring)}"/>
    <!-- 빈디 -->
    <circle cx="50" cy="27" r="2.4" fill="${ESC(a.bindi)}"/>
    <!-- 눈썹 -->
    <path d="M39 36c2-2 6-2 8 0M53 36c2-2 6-2 8 0" stroke="${ESC(a.hair)}" stroke-width="1.8" stroke-linecap="round" fill="none"/>
    <!-- 눈 -->
    <ellipse cx="43" cy="41" rx="3" ry="3.4" fill="#20161a"/>
    <ellipse cx="57" cy="41" rx="3" ry="3.4" fill="#20161a"/>
    <circle cx="44" cy="40" r="1" fill="#fff" opacity=".85"/>
    <circle cx="58" cy="40" r="1" fill="#fff" opacity=".85"/>
    <!-- 입 -->
    <path d="M45 51c2 2.4 8 2.4 10 0" stroke="#7a3b40" stroke-width="2" stroke-linecap="round" fill="none"/>
  </g>
</svg>`;
}

/** 목록에서 쓰는, 사람 없이 이니셜만 있는 대체 아바타 */
export function initialAvatar(text, tint, size = 44) {
  return `<svg class="avatar-svg" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="50" cy="50" r="50" fill="${ESC(tint)}"/>
    <text x="50" y="50" text-anchor="middle" dominant-baseline="central"
          font-size="42" font-weight="600" fill="#fff">${ESC(text)}</text>
  </svg>`;
}

/* ------------------------------------------------------------------ *
 * 사용자가 직접 올린 얼굴 사진
 * ------------------------------------------------------------------ */

/**
 * 부서의 아바타 마크업. 사용자가 사진을 지정했으면 그 사진을, 아니면 기본 일러스트를 쓴다.
 * @param {object} dept  departments.js 항목
 * @param {number} size
 * @param {string} idSuffix  SVG 내부 id 충돌 방지용
 * @param {object} photos  settings.photos (deptId -> data URL)
 */
export function avatarMarkup(dept, size, idSuffix, photos = {}) {
  const photo = photos?.[dept.id];
  if (photo) {
    return `<img class="avatar-photo" src="${photo}" width="${size}" height="${size}"
      alt="" aria-hidden="true" decoding="async">`;
  }
  return avatarSVG(dept.avatar, { size, id: idSuffix });
}

/**
 * 고른 사진을 정사각형으로 잘라 작게 줄인다.
 * localStorage 에 넣어야 하므로 256px JPEG 로 압축한다.
 * 인물 사진은 가운데를 그대로 자르면 머리가 잘리기 쉬워 위쪽으로 살짝 치우쳐 자른다.
 * @param {File} file
 * @param {number} size
 * @returns {Promise<string>} data URL
 */
export async function photoToDataURL(file, size = 256) {
  if (!file || !file.type?.startsWith('image/')) {
    throw new Error('이미지 파일이 아닙니다.');
  }

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('사진을 읽지 못했습니다.');

  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = bitmap.height > bitmap.width
    ? (bitmap.height - side) * 0.18   // 세로 사진은 얼굴이 위쪽에 있다
    : (bitmap.height - side) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d');
  c.imageSmoothingQuality = 'high';
  c.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close?.();

  return canvas.toDataURL('image/jpeg', 0.82);
}
