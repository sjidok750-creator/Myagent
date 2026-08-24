/**
 * 방 이름표. 브릿지와 책상 도구가 같은 이름을 쓰도록 한 곳에 둔다.
 * (화면 쪽 js/departments.js 와 짝을 이룬다 — 여긴 컴퓨터에서 도는 쪽이다.)
 */
export const DEPT_LABELS = {
  chief: '실장님 방',
  schedule: '일정·의전팀',
  intel: '정보분석팀',
  comms: '커뮤니케이션팀',
  finance: '재무·자산팀',
  ops: '프로젝트·실행팀',
  people: '인맥·관계팀',
  care: '건강·컨디션팀',
  growth: '학습·성장팀',
};

export const deptLabel = (dept) => DEPT_LABELS[dept] || dept;
