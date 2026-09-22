// 데이터셋 이미지가 미포함(라이선스)일 때 표시하는 플레이스홀더
export const IMG_FALLBACK =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="192" viewBox="0 0 260 192">` +
      `<rect width="100%" height="100%" fill="#e4e6ef"/>` +
      `<text x="130" y="86" text-anchor="middle" font-size="44">\u{1F35A}</text>` +
      `<text x="130" y="122" text-anchor="middle" fill="#667" font-size="13" font-family="sans-serif">저작권 문제로</text>` +
      `<text x="130" y="140" text-anchor="middle" fill="#667" font-size="13" font-family="sans-serif">공개할 수 없습니다</text>` +
    `</svg>`,
  )
