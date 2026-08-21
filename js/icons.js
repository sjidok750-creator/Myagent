/** SF Symbols 느낌의 인라인 SVG 아이콘 모음 */

const svg = (d, o = {}) =>
  `<svg viewBox="0 0 24 24" width="${o.size || 22}" height="${o.size || 22}" fill="none" aria-hidden="true">${d}</svg>`;

let uid = 0;

export const icons = {
  chevronLeft: (s = 24) =>
    svg('<path d="M15 5 8.5 12 15 19" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>', { size: s }),

  chevronRight: (s = 16) =>
    svg('<path d="M9.5 5 16 12l-6.5 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>', { size: s }),

  chevronDown: (s = 18) =>
    svg('<path d="M5 9.5 12 16l7-6.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>', { size: s }),

  compose: (s = 24) =>
    svg(`<path d="M16.8 3.6a2.1 2.1 0 0 1 3 3L10 16.4l-4 1 1-4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
         <path d="M20 13.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`, { size: s }),

  search: (s = 17) =>
    svg('<circle cx="10.5" cy="10.5" r="6.2" stroke="currentColor" stroke-width="2"/><path d="m15.3 15.3 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>', { size: s }),

  xCircle: (s = 17) =>
    svg('<circle cx="12" cy="12" r="9" fill="currentColor" opacity=".45"/><path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6" stroke="var(--bg)" stroke-width="2" stroke-linecap="round"/>', { size: s }),

  arrowUp: (s = 18) =>
    svg('<path d="M12 19V6M6.5 11.5 12 5.6l5.5 5.9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>', { size: s }),

  stop: (s = 14) =>
    svg('<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>', { size: s }),

  plus: (s = 20) =>
    svg('<path d="M12 5.5v13M5.5 12h13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>', { size: s }),

  info: (s = 22) =>
    svg('<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 11v5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="7.8" r="1.15" fill="currentColor"/>', { size: s }),

  gear: (s = 22) => {
    const id = `gear-${++uid}`;
    return svg(`<defs><mask id="${id}">
        <rect width="24" height="24" fill="#fff"/>
        <circle cx="12" cy="12" r="3.5" fill="#000"/>
      </mask></defs>
      <g mask="url(#${id})" fill="currentColor">
        <circle cx="12" cy="12" r="7.3"/>
        <g>
          <rect x="3.4" y="10" width="17.2" height="4" rx="1.6"/>
          <rect x="3.4" y="10" width="17.2" height="4" rx="1.6" transform="rotate(45 12 12)"/>
          <rect x="3.4" y="10" width="17.2" height="4" rx="1.6" transform="rotate(90 12 12)"/>
          <rect x="3.4" y="10" width="17.2" height="4" rx="1.6" transform="rotate(135 12 12)"/>
        </g>
      </g>`, { size: s });
  },

  building: (s = 22) =>
    svg(`<rect x="4" y="4" width="10" height="16" rx="1.6" stroke="currentColor" stroke-width="1.7"/>
         <path d="M14 10h5a1 1 0 0 1 1 1v9H14" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
         <path d="M7 8h4M7 11.5h4M7 15h4M16.5 13.5h1M16.5 17h1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`, { size: s }),

  trash: (s = 20) =>
    svg('<path d="M4.5 6.5h15M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5M6.5 6.5 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>', { size: s }),

  video: (s = 22) =>
    svg('<rect x="3" y="6.5" width="12.5" height="11" rx="2.6" stroke="currentColor" stroke-width="1.8"/><path d="m15.5 11 4.2-2.6a.7.7 0 0 1 1.1.6v6a.7.7 0 0 1-1.1.6L15.5 13z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>', { size: s }),

  checks: (s = 14) =>
    svg('<path d="M3 12.6 6.6 16 13 8.6M11 15.4 12.6 17 21 7.4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>', { size: s }),
};
