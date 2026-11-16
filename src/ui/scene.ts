/*
 * The felt: dealer, table, community cards and player avatars. Everything here is drawn
 * into the same 800x420 artboard, which the view scales to its frame (see observe()).
 */

/** DealerScene (head cropped by the frame); 'lobby' variant has red bow tie and brass studs. */
export function dealerSVG(variant: 'lobby' | 'table'): string {
  const L = variant === 'lobby';
  const vest = L ? '#0c100e' : '#141a17', bow = L ? '#B8432F' : '#141a17', stud = L ? '#E3C35A' : '#141a17';
  return `<svg class="abs" width="800" height="420" viewBox="0 0 800 420" style="left:0;top:0" aria-hidden="true"><g transform="translate(80 0) scale(0.8)">
    <rect x="380" y="0" width="40" height="56" fill="#CEC181"/>
    <path d="M380 26 Q400 38 420 26 L420 44 L380 44Z" fill="#b5a967"/>
    <path d="M300 92 Q262 110 258 180 Q258 214 290 230 L334 230 L334 204 L302 194 Q298 160 314 120Z" fill="#E3E7D8"/>
    <path d="M500 92 Q538 110 542 180 Q542 214 510 230 L466 230 L466 204 L498 194 Q502 160 486 120Z" fill="#E3E7D8"/>
    ${L ? '' : '<path d="M270 168 Q272 204 296 222 L284 224 Q264 206 264 172Z" fill="#d0d5c2"/><path d="M530 168 Q528 204 504 222 L516 224 Q536 206 536 172Z" fill="#d0d5c2"/>'}
    <path d="M292 240 L294 118 Q300 66 352 54 L380 46 L420 46 L448 54 Q500 66 506 118 L508 240Z" fill="#E3E7D8"/>
    <path d="M338 62 L384 54 L400 172 L416 54 L462 62 Q476 150 480 240 L320 240 Q324 150 338 62Z" fill="${vest}"/>
    <path d="M384 46 L400 70 L388 86 L370 54Z" fill="#d0d5c2"/>
    <path d="M416 46 L400 70 L412 86 L430 54Z" fill="#d0d5c2"/>
    <path d="M376 56 L398 65 L376 76Z M424 56 L402 65 L424 76Z" fill="${bow}"/>
    <rect x="393" y="60" width="14" height="10" rx="3" fill="${bow}"/>
    <circle cx="400" cy="100" r="3.5" fill="${stud}"/><circle cx="400" cy="124" r="3.5" fill="${stud}"/><circle cx="400" cy="148" r="3.5" fill="${stud}"/>
  </g></svg>`;
}

export const handsSVG = `<svg class="abs" width="800" height="420" viewBox="0 0 800 420" style="left:0;top:0" aria-hidden="true"><g transform="translate(80 0) scale(0.8)">
    <path d="M314 214 Q334 206 352 214 Q360 222 352 230 Q334 236 316 230 Q308 222 314 214Z" fill="#CEC181"/>
    <path d="M486 214 Q466 206 448 214 Q440 222 448 230 Q466 236 484 230 Q492 222 486 214Z" fill="#CEC181"/></g></svg>`;

export const tableHTML = `<div class="abs" style="left:-160px;top:170px;width:1120px;height:460px;border-radius:50%;background:#2A4B40"></div>
  <div class="abs" style="left:-142px;top:188px;width:1084px;height:424px;border-radius:50%;background:radial-gradient(ellipse at 50% 25%,#4a8a63 0%,#3B7955 45%,#336a4b 100%)"></div>
  <div class="abs" style="left:-90px;top:226px;width:980px;height:360px;border-radius:50%;border:2px solid rgba(227,195,90,.4);box-sizing:border-box"></div>`;

const BOARD_SLOTS = 5;
/**
 * The community cards, drawn as backs — the cards are physical, so the app never learns
 * their values. Persistent on purpose: the announcement only reaches whoever is looking
 * the moment a street closes, whereas this answers "where are we?" at any point in a hand.
 * Undealt slots stay visible so it is clear more cards are still coming.
 */
export function boardHTML(dealt: number): string {
  let out = '';
  for (let i = 0; i < BOARD_SLOTS; i++) out += `<div class="${i < dealt ? 'bcard' : 'bslot'}"></div>`;
  return out;
}

export const avatarHTML = (color: string, dealer?: boolean, glyph?: string): string =>
  `<div class="avwrap"><div class="av" style="background:${color}${glyph ? ';--glyph:' + glyph : ''}"></div>${dealer ? '<div class="dbadge">D</div>' : ''}</div>`;
