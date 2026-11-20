import { WEAPONS, getSkin } from '../data/weapons.js';
// Offline vector art: recognizable weapon families, consistent with finish colors.
export function weaponArt(id, skinId = null){
  const w = WEAPONS[id] || WEAPONS.ak47;
  const s = getSkin(id, skinId) || {};
  const a = s.body || '#60717f', b = s.accent || '#bdcbd5';
  const paths = {
    pistol:'M35 38 L164 38 L175 48 L173 63 L119 63 L108 102 L77 100 L87 64 L37 62 Z',
    smg:'M20 43 L139 43 L146 48 L210 48 L210 57 L146 59 L133 72 L121 72 L119 106 L102 106 L100 72 L82 71 L71 94 L54 90 L61 65 L20 65 Z',
    rifle:'M8 45 L47 48 L57 38 L151 38 L161 44 L223 44 L223 52 L160 54 L149 64 L110 65 L121 96 L101 103 L86 67 L73 66 L63 91 L46 85 L51 62 L8 73 Z',
    sniper:'M8 49 L49 45 L74 44 L74 33 L90 33 L90 44 L170 44 L170 48 L231 48 L231 54 L167 54 L151 63 L91 64 L84 84 L64 83 L69 64 L8 79 Z M64 25 L115 25 L115 37 L64 37 Z',
    shotgun:'M8 50 L50 44 L151 43 L220 44 L220 51 L150 53 L137 64 L83 66 L64 88 L45 81 L52 65 L8 79 Z',
    lmg:'M8 44 L46 46 L57 35 L145 35 L158 43 L226 43 L226 52 L151 55 L145 82 L98 85 L86 63 L72 63 L62 91 L45 85 L51 62 L8 72 Z',
    knife:'M10 65 L79 59 L84 50 L91 50 L96 59 L220 39 L192 64 L97 75 L92 83 L84 82 L78 73 L10 77 Z'
  };
  const path = paths[w.type] || paths.rifle;
  return `<svg class="weaponArt" viewBox="0 0 240 120" role="img" aria-label="${w.name}"><path d="${path}" fill="${a}" stroke="${b}" stroke-width="2" stroke-linejoin="round"/><path d="M56 50 H140 M66 55 H126 M100 40 L119 61 M128 40 L147 59" fill="none" stroke="${b}" stroke-width="4" opacity=".7"/><path d="M42 59 H80 M140 47 H203" stroke="#eef6ff" opacity=".5"/><circle cx="65" cy="57" r="3" fill="#111820"/></svg>`;
}
export const AVATARS = ['falcon','ghost','viper','nova','wolf','ember'];
export function avatarArt(id = 'falcon'){
  const i = Math.max(0, AVATARS.indexOf(id));
  const colors = ['#63d8c9','#7caeff','#c6ed72','#c6a0ff','#e4c891','#ff926f'];
  const marks = ['M22 22 L48 36 L74 22 L61 58 L48 72 L35 58 Z','M29 64 V35 Q48 7 67 35 V64 L58 58 L48 67 L38 58 Z','M25 26 L71 26 L58 43 L66 61 L48 74 L30 61 L38 43 Z','M48 16 L58 37 L81 48 L58 59 L48 80 L37 59 L15 48 L37 37 Z','M22 20 L40 32 L56 32 L74 20 L68 61 L48 77 L28 61 Z','M48 15 Q77 44 63 65 Q48 82 33 65 Q20 48 40 33 L39 52 Z'];
  return `<svg viewBox="0 0 96 96" class="avatarArt" aria-label="Аватар ${AVATARS[i]}" role="img"><rect width="96" height="96" rx="22" fill="#152532"/><circle cx="48" cy="48" r="40" fill="none" stroke="${colors[i]}" opacity=".3"/><path d="${marks[i]}" fill="${colors[i]}"/><path d="M34 45 L43 49 M62 45 L53 49" stroke="#152532" stroke-width="4"/></svg>`;
}
