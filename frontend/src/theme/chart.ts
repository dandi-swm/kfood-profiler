/**
 * 차트 토큰 — tokens.css의 값과 1:1로 맞춰 둔 JS 사본.
 * Recharts는 CSS 변수를 fill/stroke로 못 받는 구간이 있어서 리터럴로 들고 있는다.
 * 값을 바꿀 때는 tokens.css와 반드시 같이 바꾼다.
 */

/** A/B 비교용 2계열. 슬롯 순서 고정 — A는 항상 Blue Ivy, B는 항상 Clay. */
export const SERIES = ['#4b8cca', '#964d09'] as const

/**
 * 오답 카테고리 분포용 categorical 7색 + "기타" 회색.
 * 슬롯 순서 고정이며 절대 순환시키지 않는다 (8번째 계열은 "기타"로 접는다).
 * 검증 결과 (light, surface #FFFFFF, adjacent pairs):
 *   명도 band PASS · 채도 floor PASS · CVD 분리 ΔE 14.2 (deutan) PASS
 *   normal-vision floor ΔE 22.5 PASS · 표면 대비 전 슬롯 3:1↑ PASS
 */
export const CATEGORICAL = [
  '#4b8cca', // Blue Ivy
  '#964d09', // Clay
  '#a67ad6', // Lilac
  '#36a467', // Fern
  '#9d3b60', // Plum
  '#199eaa', // Teal
  '#7d5e07', // Olive
] as const

/** 팔레트 밖 — "기타" 묶음 전용 (식별 정보를 담지 않는 색) */
export const CATEGORICAL_OTHER = '#979ead' // Dark Gray

/** 양극(A 우세 ↔ B 우세) 발산 스케일. 중앙은 색 없음(표면) = 중립. */
export const DIVERGING = {
  pos: SERIES[0],
  neg: SERIES[1],
  posRgb: '75, 140, 202',
  negRgb: '150, 77, 9',
} as const

/** 단일 계열 순차 스케일 (정확도 낮을수록 진하게) */
export const SEQUENTIAL_RGB = '75, 140, 202'

/** 차트 크롬 */
export const INK = {
  grid: '#e1e7f0',
  axis: '#cbd3e0',
  tick: '#6a7284',
  text: '#3c4658',
  strong: '#1a2644',
  muted: '#6a7284',
  faint: '#979ead',
  surface: '#fbfbfb',
} as const

/** 상태색 — 계열색과 절대 섞어 쓰지 않는다 */
export const STATUS = {
  ok: '#1f7a55',
  warn: '#8a5a12',
  danger: '#b23b2e',
  neutral: '#6a7284',
} as const

/** Recharts 공통 props */
export const gridProps = {
  stroke: INK.grid,
  strokeDasharray: '2 4',
  vertical: false,
} as const

export const axisProps = {
  stroke: INK.axis,
  tick: { fontSize: 11, fill: INK.tick },
  tickLine: false,
} as const

export const tooltipProps = {
  cursor: { fill: 'rgba(75, 140, 202, 0.07)' },
  contentStyle: {
    background: '#ffffff',
    border: '1px solid #e1e7f0',
    borderRadius: 8,
    boxShadow: '0 2px 4px rgba(26,38,68,0.04), 0 8px 24px rgba(26,38,68,0.07)',
    fontSize: 12,
    padding: '8px 10px',
  },
  labelStyle: { color: INK.strong, fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: INK.text, padding: 0 },
} as const

export const legendProps = {
  wrapperStyle: { fontSize: 12, paddingTop: 8 },
  iconType: 'circle' as const,
  iconSize: 8,
}

/** 세로 막대: 데이터 끝만 4px 라운드, 막대 사이 2px 표면 간격 */
export const BAR_RADIUS_V: [number, number, number, number] = [4, 4, 0, 0]
/** 가로 막대 */
export const BAR_RADIUS_H: [number, number, number, number] = [0, 4, 4, 0]
export const BAR_GAP = 2
export const BAR_CATEGORY_GAP = '28%'
