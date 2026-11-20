import { weaponArt, avatarArt, AVATARS } from './art.js';
// Main menu, team select, arsenal, inventory, settings, profile. With 3D background scene.
import * as THREE from '../../vendor/three.module.js';
import { createCharacter } from '../world/characters.js';
import { makeGunMesh } from '../world/guns.js';
import { WEAPONS, SKIN_STYLES, BUY_CATEGORIES, getSkin, skinIdFor, GRENADES, RARITIES, RARITY_ORDER } from '../data/weapons.js';
import { MAP_INFO } from '../data/maps.js';
import { TEAM_AGENTS, getAgent } from '../data/agents.js';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../data/difficulty.js';
import { CRATES, crateById, cratePool, crateOdds, crateRarityList, openCrate, buildReel } from '../data/crates.js';
import { ModelPreview } from './preview3d.js';
import { getState, saveState, getRank, xpForLevel, resetState, equipSkin, equippedSkin, ownsSkin, selectAgent, selectedAgent, crateTokens, addCrateTokens, spendCrateTokens, recordCaseOpen, canClaimDaily, claimDaily, unequipSkin, grantSkin } from '../core/state.js';
import { audio } from '../core/audio.js';
import { login as authLogin, register as authRegister, logout as authLogout, currentSession, renameAccount } from '../core/accounts.js';
import { DEFAULT_BINDS, REBIND_LABELS } from '../core/input.js';

export const MODE_CARDS = [
  { id:'competitive', name:'Competitive', sub:'5 на 5 · до 13 побед', desc:'Полноценный матч с экономикой, раундами и бомбой.', cls:'comp' },
  { id:'casual', name:'Casual', sub:'5 на 5 · до 8 побед', desc:'Быстрые раунды и меньшее давление.', cls:'casual' },
  { id:'deathmatch', name:'Deathmatch', sub:'Все против всех', desc:'Возрождения и перестрелки без раундов.', cls:'dm' },
  { id:'tdm', name:'Team Deathmatch', sub:'5 на 5 · до 75 убийств', desc:'Командные бои на счёт.', cls:'tdm' },
  { id:'training', name:'Тренировка', sub:'Против ботов', desc:'Спокойная песочница для разминки прицела.', cls:'train' }
];

export class Menu {
  constructor(opts){
    this.opts = opts || {};
    this.root = document.getElementById('menuRoot');
    this.screen = 'home';
    const st = getState();
    const lm = st.lastMatch || {};
    this.config = {
      mode: lm.mode || 'competitive',
      map: lm.map || 'city',
      team: lm.team || 'CT',
      teamSize: lm.teamSize || 5,
      difficulty: lm.difficulty || st.settings.botDifficulty || 'normal',
      matchMinutes: lm.matchMinutes || 8,
      roundsToWin: lm.roundsToWin || 13,
      privateMatch: !!lm.privateMatch,
      customMap: null
    };
    this.arsenalCat = 'rifles';
    this.invTab = 'weapons';
    this.invSearch = '';
    this.invRarity = 'all';
    this.invSort = 'rarity';
    this.caseBusy = false;
    this.lastCaseResult = null;
    this.touchSelected = 'tFire';
    this.preview = new ModelPreview();
    this._hintTimer = 0;
    this.rebindAction = null;
    this.editor = this._newEditor();
    this.customMaps = this._loadCustomMaps();
    this._onRebindKey = (e) => this._captureBind(e);
    window.addEventListener('keydown', this._onRebindKey, true);
    this._buildScene();
    this._bindOnce();
    this.render();
  }

  _buildScene(){
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0a0f16');
    scene.fog = new THREE.Fog('#0a0f16', 8, 22);
    this.scene = scene;

    const cam = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    cam.position.set(0, 2.1, 6.2);
    cam.lookAt(0, 1.15, 0);
    this.camera = cam;

    const hemi = new THREE.HemisphereLight(0x88aacc, 0x101418, 0.8);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffe0b0, 1.6); key.position.set(-4,6,4); scene.add(key);
    const rimCT = new THREE.PointLight(0x4fa3ff, 6, 12); rimCT.position.set(-2.2,1.6,1); scene.add(rimCT);
    const rimT = new THREE.PointLight(0xffa030, 6, 12); rimT.position.set(2.2,1.6,1); scene.add(rimT);

    const floorGeo = new THREE.CircleGeometry(9, 40);
    const floorMat = new THREE.MeshStandardMaterial({ color:0x121a22, roughness:0.4, metalness:0.6 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI/2; scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 2.75, 48), new THREE.MeshBasicMaterial({ color:0x2a4a66, transparent:true, opacity:0.6 }));
    ring.rotation.x = -Math.PI/2; ring.position.y = 0.01; scene.add(ring);
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(4.4, 4.5, 48), new THREE.MeshBasicMaterial({ color:0x664a2a, transparent:true, opacity:0.35 }));
    ring2.rotation.x = -Math.PI/2; ring2.position.y = 0.01; scene.add(ring2);

    this._buildSceneChars();
    this.charT = 0;

    // floating weapon display
    this.gunHolder = new THREE.Group();
    this.gunHolder.position.set(0, 2.35, 1.2);
    scene.add(this.gunHolder);
    this._setShowcaseGun('ak47');
    const glow = new THREE.PointLight(0xffcf7a, 2, 6); glow.position.set(0,1.8,1.2); scene.add(glow);

    this.rims = [rimCT, rimT];
  }

  _buildSceneChars(){
    if(this.chars){
      for(const c of this.chars){ this.scene.remove(c.root); if(c.dispose) c.dispose(); }
      this.chars = null;
    }
    const st = getState();
    const ct = createCharacter('CT', 'm4a1', null, selectedAgent('CT'));
    ct.root.position.set(-1.9, 0, 0.4); ct.root.rotation.y = 0.35; ct.root.scale.setScalar(1.05);
    this.scene.add(ct.root);
    const t = createCharacter('T', 'ak47', null, selectedAgent('T'));
    t.root.position.set(1.9, 0, 0.4); t.root.rotation.y = -0.35; t.root.scale.setScalar(1.05);
    this.scene.add(t.root);
    this.chars = [ct, t];
  }

  _setShowcaseGun(id){
    if(this._showcase){ this.gunHolder.remove(this._showcase); }
    const g = makeGunMesh(id, equippedSkin(id));
    g.scale.setScalar(1.4);
    this._showcase = g;
    this.gunHolder.add(g);
  }

  update(dt){
    this.charT += dt;
    if(this.chars){
      this.chars[0].animate(dt, 0, 0, false);
      this.chars[1].animate(dt, 0, 0, false);
      this.chars[0].root.rotation.y = 0.35 + Math.sin(this.charT*0.4)*0.12;
      this.chars[1].root.rotation.y = -0.35 - Math.sin(this.charT*0.4)*0.12;
    }
    if(this.gunHolder){
      this.gunHolder.rotation.y += dt*0.9;
      this.gunHolder.position.y = 2.35 + Math.sin(this.charT*1.2)*0.05;
    }
  }

  _bindOnce(){
    // no persistent listeners; screens re-render
  }

  resize(w,h){
    if(this.camera){ this.camera.aspect = w/h; this.camera.updateProjectionMatrix(); }
  }

  show(){ this.root.classList.remove('hidden'); }
  hide(){ this.root.classList.add('hidden'); }

  go(screen){
    if(this.preview) this.preview.close();
    this.screen = screen;
    audio.click();
    this.render();
  }

  render(){
    const st = getState();
    const p = st.profile;
    const rank = getRank();
    let body = '';
    if(this.screen === 'home') body = this._home(st,p,rank);
    else if(this.screen === 'play') body = this._play();
    else if(this.screen === 'agents') body = this._agents(st);
    else if(this.screen === 'arsenal') body = this._arsenal();
    else if(this.screen === 'inventory') body = this._inventory();
    else if(this.screen === 'cases') body = this._cases(st);
    else if(this.screen === 'controls') body = this._controls(st);
    else if(this.screen === 'settings') body = this._settings(st);
    else if(this.screen === 'mods') body = this._mods(st);
    else if(this.screen === 'editor') body = this._editor();
    else if(this.screen === 'profile') body = this._profile(st,p,rank);
    else if(this.screen === 'account') body = this._account(st,p);

    this.root.innerHTML = `
      <div class="menuShell">
        <aside class="menuSide">
          <div class="logo"><div class="logoMark"><span>S</span><b>3</b></div><div class="logoText"><b>STANDOFF</b><i>3 · MOBILE REFORGED 6.0</i></div></div>
          <nav class="nav">
            ${this._navBtn('home','⌂','ГЛАВНАЯ')}
            ${this._navBtn('play','▶','ИГРАТЬ')}
            ${this._navBtn('cases','◈','КЕЙСЫ')}
            ${this._navBtn('arsenal','⌖','АРСЕНАЛ')}
            ${this._navBtn('inventory','▣','ИНВЕНТАРЬ')}
            ${this._navBtn('agents','◉','АГЕНТЫ')}
            ${this._navBtn('editor','▦','РЕДАКТОР')}
            ${this._navBtn('settings','⚙','НАСТРОЙКИ')}
            ${this._navBtn('mods', st.settings.modUnlocked ? '✦' : '🔒','MOD MENU')}
            ${this._navBtn('profile','☺','ПРОФИЛЬ')}
            ${this._navBtn('account','⚿','АККАУНТ')}
          </nav>
          <div class="sideFoot">
            <div class="miniProfile">
              <div class="mpLevel">${p.level}</div>
              <div><div class="mpName">${esc(p.name)}</div><div class="mpRank">${rank.name}</div></div>
            </div>
            <div class="build">STANDOFF 3 · MOBILE REFORGED 6.0</div>
          </div>
        </aside>
        <section class="menuMain">
          ${body}
        </section>
      </div>`;

    this._wire();
    if(this.screen === 'inventory'){
      this._filterInventory();
      this._sortInventory();
    }
  }

  _navBtn(id, icon, label){
    return `<button class="navBtn ${this.screen===id?'active':''}" data-go="${id}"><span class="navIcon">${icon}</span>${label}</button>`;
  }

  _home(st,p,rank){
    const kd = p.deaths ? (p.kills/p.deaths).toFixed(2) : p.kills.toFixed(2);
    const xpNeed = xpForLevel(p.level);
    const xpPct = Math.min(100, Math.round(p.xp/xpNeed*100));
    return `
    <div class="homeGrid">
      <div class="heroCard">
        <div class="heroTag">STANDOFF 3 · MOBILE REFORGED 6.0</div>
        <h1>STANDOFF<br><span>3</span></h1>
        <p class="heroSub">${Object.keys(WEAPONS).length-1} стволов · 8 карт · 3D-предпросмотр · ${Object.keys(SKIN_STYLES).length} finishes · кейсы · геймпад</p>
        <button class="bigPlay" data-go="play"><span>▶</span> ИГРАТЬ</button>
        <div class="heroStats">
          <div><b>${p.matches}</b><span>матчей</span></div>
          <div><b>${p.wins}</b><span>побед</span></div>
          <div><b>${kd}</b><span>K/D</span></div>
          <div><b>${p.crateTokens ?? 0}</b><span>кейсов</span></div>
        </div>
      </div>
      <div class="sideCards">
        <div class="profileCard">
          <div class="pcTop"><div class="pcAvatar">${avatarArt(p.avatar)}</div>
            <div><div class="pcName">${esc(p.name)}</div><div class="pcRank">${rank.name}</div></div>
            <div class="pcLevel">УР. ${p.level}</div>
          </div>
          <div class="xpBar"><div style="width:${xpPct}%"></div></div>
          <div class="xpText">${p.xp} / ${xpNeed} XP</div>
        </div>
        <div class="quickGrid">
          <button class="quickBtn" data-go="cases"><span>◈</span><b>КЕЙСЫ</b><i>${st.profile.crateTokens ?? 0} жетонов · честные шансы</i></button>
          <button class="quickBtn" data-go="arsenal"><span>⌖</span><b>АРСЕНАЛ</b><i>${Object.keys(WEAPONS).length-1} единиц оружия · 3D</i></button>
          <button class="quickBtn" data-go="inventory"><span>▣</span><b>ИНВЕНТАРЬ</b><i>${st.inventory.owned.length} предметов</i></button>
          <button class="quickBtn" data-go="editor"><span>▦</span><b>РЕДАКТОР КАРТ</b><i>Создайте свою арену</i></button>
          <button class="quickBtn" data-go="controls"><span>⌨</span><b>УПРАВЛЕНИЕ</b><i>Раскладка, размер и прозрачность</i></button>
          <button class="quickBtn" data-go="settings"><span>⚙</span><b>НАСТРОЙКИ</b><i>Графика, клавиши и геймпад</i></button>
          <button class="quickBtn" data-go="mods"><span>${st.settings.modUnlocked ? '✦' : '🔒'}</span><b>MOD MENU</b><i>${'Тренировка и приватный матч'}</i></button>
          <button class="quickBtn" data-go="profile"><span>☺</span><b>ПРОФИЛЬ</b><i>Статистика и ранг</i></button>
          <button class="quickBtn" data-go="account"><span>⚿</span><b>АККАУНТ</b><i>${currentSession() ? 'Вход выполнен' : 'Регистрация и вход'}</i></button>
        </div>
      </div>
    </div>`;
  }

  _play(){
    const c = this.config;
    const modes = MODE_CARDS.map(m=>`
      <button class="modeCard ${c.mode===m.id?'sel':''}" data-mode="${m.id}">
        <div class="mcTag ${m.cls}">${m.sub}</div>
        <div class="mcName">${m.name}</div>
        <div class="mcDesc">${m.desc}</div>
      </button>`).join('');
    const custom = this.customMaps || [];
    const maps = MAP_INFO.map(m=>`
      <button class="mapCard ${c.map===m.id?'sel':''}" data-map="${m.id}">
        <div class="mapThumb ${m.id}"><span>${m.tag}</span></div>
        <div class="mapName">${m.name}</div>
        <div class="mapDesc">${m.desc}</div>
      </button>`).join('') + custom.map(m=>`
      <button class="mapCard ${c.map==='custom' && c.customMap && c.customMap.id===m.id?'sel':''}" data-map="custom:${m.id}">
        <div class="mapThumb custom"><span>СВОЯ</span></div>
        <div class="mapName">${esc(m.name)}</div>
        <div class="mapDesc">${m.w}×${m.h} · редактор</div>
      </button>`).join('');
    const selMapName = c.customMap ? (c.customMap.name || 'Моя карта') : (MAP_INFO.find(m=>m.id===c.map)?.name || 'Карта');
    const isRound = c.mode === 'competitive' || c.mode === 'casual';
    return `
    <div class="playScreen">
      <div class="phead"><button class="backBtn" data-go="home">‹ НАЗАД</button><h2>СОЗДАНИЕ МАТЧА</h2><span class="headHint">STANDOFF 3 · MOBILE REFORGED 6.0</span></div>
      <div class="pstep"><div class="pstepTitle"><i>1</i> Режим игры</div><div class="modeGrid">${modes}</div></div>
      <div class="pstep"><div class="pstepTitle"><i>2</i> Карта</div><div class="mapGrid">${maps}</div></div>
      <div class="pstep"><div class="pstepTitle"><i>3</i> Команда</div>
        <div class="teamPick">
          <button class="teamCard ct ${c.team==='CT'?'sel':''}" data-team="CT">
            <div class="tcEmblem">◈</div>
            <div class="tcName">СПЕЦНАЗ</div>
            <div class="tcSub">Штурм · Броня · Точность</div>
            <div class="tcDesc">Обезвредьте бомбу и остановите террористов.</div>
          </button>
          <button class="teamCard t ${c.team==='T'?'sel':''}" data-team="T">
            <div class="tcEmblem">☠</div>
            <div class="tcName">ТЕРРОРИСТЫ</div>
            <div class="tcSub">Натиск · Засады · Урон</div>
            <div class="tcDesc">Заложите бомбу на точке A или B.</div>
          </button>
        </div>
      </div>
      <div class="pstep"><div class="pstepTitle"><i>4</i> Сложность ботов</div>
        <div class="diffGrid">${DIFFICULTY_ORDER.map(id=>{
          const d = DIFFICULTIES[id];
          return `<button class="diffCard ${c.difficulty===id?'sel':''}" data-diff="${id}">
            <div class="diffTag">${d.tag}</div>
            <div class="diffName">${d.name}</div>
            <div class="diffDesc">${d.desc}</div>
            <div class="diffStats"><span>Реакция ${Math.round((d.reaction[0]+d.reaction[1])*500)} мс</span><span>Скилл ${Math.round(d.skill*100)}</span></div>
          </button>`;
        }).join('')}</div>
      </div>
      <div class="pstep"><div class="pstepTitle"><i>5</i> Формат матча</div>
        <div class="formatRow">
          <div class="formatBox"><span>Размер команды</span>
            <div class="chipRow">${[1,2,3,4,5,6,7,8].map(n=>`<button class="fmtChip ${c.teamSize===n?'sel':''}" data-teamsize="${n}">${n}v${n}</button>`).join('')}</div>
          </div>
          <div class="formatBox"><span>${isRound?'Побед до':'Длительность'}</span>
            <div class="chipRow">${isRound
              ? [5,8,13,16].map(n=>`<button class="fmtChip ${c.roundsToWin===n?'sel':''}" data-rounds="${n}">${n}</button>`).join('')
              : [5,8,12,20].map(n=>`<button class="fmtChip ${c.matchMinutes===n?'sel':''}" data-minutes="${n}">${n} мин</button>`).join('')}</div>
          </div>
          <div class="formatBox"><span>Приватный матч</span>
            <div class="chipRow"><button class="fmtChip ${c.privateMatch?'sel':''}" data-private="1">${c.privateMatch?'ВКЛ':'ВЫКЛ'}</button></div>
            <small class="fmtNote">Разрешает MOD MENU в соревновательных режимах.</small>
          </div>
        </div>
      </div>
      <div class="pstart">
        <div class="pstartInfo">${MODE_CARDS.find(m=>m.id===c.mode).name} · ${selMapName} · ${c.team==='CT'?'Спецназ':'Террористы'} · ${getAgent(c.team, selectedAgent(c.team)).name} · ${(DIFFICULTIES[c.difficulty] || DIFFICULTIES.normal).name} · ${c.teamSize}v${c.teamSize}${c.privateMatch?' · ПРИВАТНЫЙ':''}</div>
        <button class="bigPlay" id="startMatch"><span>▶</span> В БОЙ</button>
      </div>
    </div>`;
  }

  _statBar(val, max, color){
    const pct = Math.min(100, Math.round(val/max*100));
    return `<div class="statBar"><div style="width:${pct}%;background:${color}"></div></div>`;
  }

  _agents(st){
    const sel = st.selectedAgents || {};
    const teamBlock = (team, title, sub, cls)=>`
      <div class="agentTeamBlock ${cls}">
        <div class="agentTeamHead"><div><b>${title}</b><span>${sub}</span></div><div class="agentTeamTag">${team}</div></div>
        <div class="agentGrid">
          ${(TEAM_AGENTS[team]||[]).map(a=>{
            const active = (sel[team] || (team==='T'?'scorpion':'aegis')) === a.id;
            const p = a.palette;
            return `<div class="agentCard ${active?'sel':''}" data-agent="${a.id}" data-agentteam="${team}" role="button" tabindex="0">
              <button class="agentPreviewBtn" data-apreview="${team}:${a.id}" title="3D-предпросмотр">3D</button>
              <div class="agentArt" style="--c1:${p.cloth};--c2:${p.vest};--ac:${p.accent}">
                <div class="agentHead" style="background:${p.helmet}"></div>
                <div class="agentVisor" style="background:${p.visor}"></div>
                <div class="agentBody" style="background:${p.cloth}"></div>
                <div class="agentVest" style="background:${p.vest}"></div>
                <div class="agentAccent" style="background:${p.accent}"></div>
              </div>
              <div class="agentInfo">
                <div class="agentTop"><b>${a.name}</b><span>${a.tag}</span></div>
                <div class="agentRole">${a.role}</div>
                <div class="agentDesc">${a.desc}</div>
                <div class="agentSwatches"><i style="background:${p.cloth}"></i><i style="background:${p.vest}"></i><i style="background:${p.accent}"></i></div>
              </div>
              ${active?'<div class="agentCheck">ВЫБРАН</div>':''}
            </div>`;
          }).join('')}
        </div>
      </div>`;
    return `
    <div class="screenPad">
      <div class="phead"><h2>АГЕНТЫ</h2><span class="headHint">Выберите оперативника · нажмите 3D для осмотра модели</span></div>
      <div class="agentsWrap">
        ${teamBlock('CT','СПЕЦНАЗ','Штурм · Поддержка · Разведка','ct')}
        ${teamBlock('T','ТЕРРОРИСТЫ','Натиск · Засада · Саботаж','t')}
      </div>
      <div class="agentNote">Выбор применяется к вашей команде и сохраняется между матчами. 3D-просмотр вращается и масштабируется.</div>
    </div>`;
  }

  _arsenal(){
    const st = getState();
    const cats = [
      { id:'pistols', name:'Пистолеты' }, { id:'smgs', name:'ПП' },
      { id:'rifles', name:'Винтовки' }, { id:'snipers', name:'Снайперские' },
      { id:'heavy', name:'Тяжёлое' }, { id:'knife', name:'Ножи' }
    ];
    if(!cats.some(c=>c.id===this.arsenalCat)) this.arsenalCat = 'rifles';
    const defs = this.arsenalCat === 'knife' ? { items:['knife'] } : BUY_CATEGORIES.find(x=>x.id===this.arsenalCat);
    const cards = (defs ? defs.items : []).map(id=>{
      const w = WEAPONS[id];
      if(!w) return '';
      const eq = equippedSkin(id);
      const eqSkin = getSkin(id, eq);
      const rar = eqSkin.rarityInfo || RARITIES.common;
      const skins = st.inventory.owned.filter(s=>s.startsWith(id+':'));
      return `<div class="wcard">
        <div class="wcTop">
          <button class="wcPreview" data-wpreview="${id}" title="3D-предпросмотр">3D</button>
          <div class="wcTitle"><div class="wcName">${w.name}</div><div class="wcType">${w.type.toUpperCase()} · $${w.price}</div></div>
          <span class="rarityDot" style="--rc:${rar.color}" title="${rar.name}"></span>
        </div>
        <div class="wcEquipped" style="--rc:${rar.color}"><span>${rar.short}</span><b>${eqSkin.name}</b><i>${eqSkin.styleKey==='stock'?'СТАНДАРТ':'СКИН'}</i></div>
        <div class="wcStats">
          <div class="statRow"><span>Урон</span>${this._statBar(w.dmg,120,'#e05555')}<b>${w.dmg}</b></div>
          <div class="statRow"><span>Темп</span>${this._statBar(1000/w.fireDelay,14,'#e0a040')}<b>${Math.round(1000/w.fireDelay)}/с</b></div>
          <div class="statRow"><span>Точность</span>${this._statBar(0.08-w.spread,0.08,'#4fa3ff')}<b>${Math.round((1-w.spread/0.08)*100)}</b></div>
          <div class="statRow"><span>Дальность</span>${this._statBar(w.range,120,'#7dff8c')}<b>${w.range}</b></div>
          <div class="statRow"><span>Магазин</span>${this._statBar(w.mag===Infinity?30:w.mag,150,'#c8a0ff')}<b>${w.mag===Infinity?'∞':w.mag}</b></div>
        </div>
        <div class="skinRow">${skins.slice(0,4).map(s=>{
          const sk = getSkin(id,s);
          const sel = eq===s;
          const rr = sk.rarityInfo || RARITIES.common;
          return `<button class="skinChip ${sel?'sel':''}" data-equip="${id}" data-skin="${s}" title="${sk.name}" style="--rc:${rr.color}">
            <span class="swDot" style="background:${sk.body||'#555'};border-color:${rr.color}"></span>${sk.name}</button>`;
        }).join('')}<button class="skinChip more" data-invweapon="${id}">ВСЕ СКИНЫ ›</button></div>
      </div>`;
    }).join('');
    return `
    <div class="screenPad">
      <div class="phead"><h2>АРСЕНАЛ</h2><div class="catTabs">${cats.map(c=>`<button class="catTab ${this.arsenalCat===c.id?'active':''}" data-acat="${c.id}">${c.name}</button>`).join('')}</div></div>
      <div class="arsenalNote">3D-модели · применённые finishes подсвечены редкостью · в инвентаре доступны фильтры и поиск</div>
      <div class="wgrid">${cards}</div>
    </div>`;
  }

  _touchMeta(){
    return [
      { id:'joy', label:'Джойстик', cls:'joy', x:0.14, y:0.78, s:1.0 },
      { id:'tFire', label:'ОГОНЬ', cls:'fire', x:0.86, y:0.82, s:1.0 },
      { id:'tAim', label:'ПРИЦЕЛ', cls:'', x:0.73, y:0.72, s:0.78 },
      { id:'tJump', label:'ПРЫЖОК', cls:'', x:0.93, y:0.64, s:0.74 },
      { id:'tCrouch', label:'ПРИСЕД', cls:'', x:0.72, y:0.52, s:0.7 },
      { id:'tReload', label:'ПЕРЕЗАР.', cls:'sm', x:0.62, y:0.66, s:0.66 },
      { id:'tSwitch', label:'ОРУЖИЕ', cls:'sm', x:0.65, y:0.46, s:0.66 },
      { id:'tInspect', label:'ОСМОТР', cls:'sm', x:0.55, y:0.66, s:0.66 },
      { id:'tUse', label:'E', cls:'sm', x:0.55, y:0.82, s:0.66 },
      { id:'tBuy', label:'МАГАЗИН', cls:'sm', x:0.64, y:0.9, s:0.7 }
    ];
  }

  _touchLayout(){
    const data = getState().settings.touchLayoutData;
    const out = {};
    for(const m of this._touchMeta()){
      const d = data && data[m.id];
      const sz = d && Number.isFinite(d.s) ? Math.max(0.45, Math.min(1.5, d.s)) : m.s;
      out[m.id] = { x: freshNum(d && d.x, m.x), y: freshNum(d && d.y, m.y), s: sz };
    }
    return out;
  }

  _inventory(){
    const st = getState();
    const tabs = [
      { id:'weapons', name:'ОРУЖИЕ' },
      { id:'skins', name:'СКИНЫ' },
      { id:'knives', name:'НОЖИ' },
      { id:'agents', name:'АГЕНТЫ' },
      { id:'cases', name:'КЕЙСЫ' }
    ];
    if(!tabs.some(t=>t.id===this.invTab)) this.invTab = 'weapons';
    const countSkins = st.inventory.owned.length;
    const countWeapons = Object.keys(WEAPONS).length;
    let body = '';
    if(this.invTab === 'weapons' || this.invTab === 'knives'){
      const ids = Object.keys(WEAPONS).filter(id => this.invTab === 'knives' ? id === 'knife' : id !== 'knife');
      body = `<div class="invGrid">${ids.map(id=>{
        const w = WEAPONS[id];
        const eq = equippedSkin(id);
        const sk = getSkin(id, eq);
        const rar = sk.rarityInfo || RARITIES.common;
        const mine = st.inventory.owned.filter(x=>x.startsWith(id+':')).length;
        const search = (w.name + ' ' + w.type + ' ' + sk.name + ' ' + rar.name).toLowerCase();
        return `<article class="invWeaponCard" data-search="${esc(search)}" data-rarity="${rar.id}" data-weapon="${id}">
          <button class="invPreview" data-wpreview="${id}"><span>3D</span><i>ОСМОТРЕТЬ</i></button>
          <div class="iwcBody">
            <div class="iwcTop"><b>${w.name}</b><span>${w.type.toUpperCase()}</span></div>
            <div class="iwcSkin" style="--rc:${rar.color}"><span>${rar.short}</span><b>${sk.name}</b></div>
            <div class="iwcMeta">$${w.price} · ${w.dmg} урона · ${w.mag===Infinity?'∞':w.mag} патронов · ${mine} скинов</div>
            <div class="iwcActions"><button class="miniBtn" data-invweapon="${id}">СКИНЫ</button><button class="miniBtn ghost" data-unequip="${id}">СНЯТЬ</button></div>
          </div>
        </article>`;
      }).join('')}</div>`;
    } else if(this.invTab === 'skins'){
      const owned = st.inventory.owned.map(id=>{
        const wid = id.split(':')[0];
        const sk = getSkin(wid, id);
        if(!sk) return null;
        const w = WEAPONS[wid];
        const rar = sk.rarityInfo || RARITIES.common;
        return { id, wid, sk, w, rar, equipped: equippedSkin(wid)===id };
      }).filter(Boolean);
      body = owned.length ? `<div class="invGrid skinsGrid">${owned.map(o=>this._skinCard(o)).join('')}</div>` : '<div class="emptyState">Инвентарь пуст. Откройте кейс, чтобы получить первый скин.</div>';
    } else if(this.invTab === 'agents'){
      body = `<div class="invAgents">${['CT','T'].map(team=>`
        <div class="invAgentTeam">
          <div class="invAgentHead ${team==='CT'?'ct':'t'}"><b>${team==='CT'?'СПЕЦНАЗ':'ТЕРРОРИСТЫ'}</b><span>${team==='CT'?'голубая гамма · броня и шлемы':'оранжевая гамма · тактическая одежда'}</span></div>
          <div class="invAgentGrid">${TEAM_AGENTS[team].map(a=>{
            const sel = selectedAgent(team) === a.id;
            return `<div class="invAgentCard ${sel?'sel':''}" data-rarity="common">
              <button class="invPreview agent" data-apreview="${team}:${a.id}"><span>3D</span><i>ОСМОТРЕТЬ</i></button>
              <div class="iacBody"><div class="iacArt" style="--c1:${a.palette.cloth};--c2:${a.palette.vest};--ac:${a.palette.accent}"></div>
                <b>${a.name}</b><span>${a.role} · ${a.tag}</span><p>${a.desc}</p>
                <button class="miniBtn" data-agent="${a.id}" data-agentteam="${team}">${sel?'ВЫБРАН':'ПРИМЕНИТЬ'}</button>
              </div></div>`;
          }).join('')}</div>
        </div>`).join('')}</div>`;
    } else {
      body = `<div class="invCaseGrid">${CRATES.map(c=>{
        const odds = crateOdds(c.id);
        const pool = cratePool(c.id).length;
        const top = Object.entries(odds).sort((a,b)=>b[1]-a[1]).slice(0,3);
        return `<button class="invCaseCard" data-case="${c.id}" style="--acc:${c.color}">
          <span class="iccIcon">${c.icon}</span><b>${c.name}</b><i>${c.desc}</i>
          <span class="iccOdds">${top.map(([r,p])=>`${RARITIES[r].short} ${p}%`).join(' · ')}</span>
          <span class="iccPool">${pool} предметов · ${c.price===0?'БЕСПЛАТНО':c.price+' жетон'+(c.price>1?'а':'')}</span>
        </button>`;
      }).join('')}</div>`;
    }
    const showFilters = this.invTab === 'weapons' || this.invTab === 'knives' || this.invTab === 'skins';
    return `
    <div class="screenPad">
      <div class="phead"><h2>ИНВЕНТАРЬ</h2><div class="invCount">${countSkins} предметов · ${countWeapons} оружий · ${st.profile.crateTokens||0} жетонов</div></div>
      <div class="invTabs">${tabs.map(t=>`<button class="invTab ${this.invTab===t.id?'active':''}" data-invtab="${t.id}">${t.name}</button>`).join('')}</div>
      ${showFilters ? `<div class="invTools">
        <input id="invSearch" class="invSearch" placeholder="Поиск по названию, оружию, редкости…" value="${esc(this.invSearch)}" autocomplete="off">
        <select id="invRarity" class="invSelect">
          <option value="all">Все редкости</option>
          ${RARITY_ORDER.map(id=>`<option value="${id}" ${this.invRarity===id?'selected':''}>${RARITIES[id].name}</option>`).join('')}
        </select>
        <select id="invSort" class="invSelect">
          <option value="rarity" ${this.invSort==='rarity'?'selected':''}>По редкости</option>
          <option value="name" ${this.invSort==='name'?'selected':''}>По названию</option>
          <option value="weapon" ${this.invSort==='weapon'?'selected':''}>По оружию</option>
        </select>
      </div>` : ''}
      ${body}
      <div class="invFoot">Скины и ножи применяются к оружию в матче. Предметы хранятся локально и переживают перезапуск.</div>
    </div>`;
  }

  _skinCard(o){
    const rar = o.rar;
    const search = (o.sk.name + ' ' + o.w.name + ' ' + rar.name + ' ' + o.sk.styleKey).toLowerCase();
    return `<article class="skinCard" data-search="${esc(search)}" data-rarity="${rar.id}" data-weapon="${o.wid}" style="--rc:${rar.color}">
      <div class="skinArt" style="--c1:${o.sk.body||'#333'};--c2:${o.sk.accent||'#888'};--c3:${o.sk.metal||'#111'}">
        <span class="skinWeaponType">${o.w.type.toUpperCase()}</span>
        <span class="skinRarity">${rar.short}</span>
        ${weaponArt(o.wid, o.id)}
      </div>
      <div class="skinBody">
        <h4>${esc(o.w.name)}</h4>
        <div class="skinFinish">${esc(o.sk.name)}</div>
        <div class="skinMeta">${rar.name} · ${o.sk.styleKey}</div>
        <div class="skinActions">
          <button class="miniBtn" data-spreview="${o.id}">3D</button>
          ${o.equipped ? `<button class="miniBtn done" data-unequip="${o.wid}">СНЯТЬ</button>` : `<button class="miniBtn accent" data-equip="${o.wid}" data-skin="${o.id}">ПРИМЕНИТЬ</button>`}
        </div>
      </div>
    </article>`;
  }

  _cases(st){
    const tokens = st.profile.crateTokens || 0;
    const today = new Date().toISOString().slice(0,10);
    const daily = canClaimDaily(today);
    const card = (c)=>{
      const odds = crateOdds(c.id);
      const pool = cratePool(c.id).length;
      const rarities = crateRarityList(c.id);
      const price = c.id === 'starter' && (st.profile.casesOpened||0) === 0 ? 0 : c.price;
      const can = price === 0 || tokens >= price;
      return `<article class="caseCard" style="--acc:${c.color}" data-casecard="${c.id}">
        <div class="caseCover">
          <span class="caseTag">${c.tag}</span>
          <span class="caseIcon">${c.icon}</span>
          <div class="caseGlow"></div>
        </div>
        <div class="caseBody">
          <h3>${c.name}</h3>
          <p>${c.desc}</p>
          <div class="caseOdds">${rarities.map(r=>`<div><span style="background:${r.color}"></span><b>${r.name}</b><i>${odds[r.id]||0}%</i></div>`).join('')}</div>
          <div class="caseFoot">
            <span class="casePool">${pool} предметов</span>
            <span class="casePrice ${can?'':'no'}">${price===0?'БЕСПЛАТНО':price+' ЖЕТОН'+(price>1?'А':'')}</span>
            <button class="caseOpen" data-case="${c.id}" ${can?'':'disabled'}>ОТКРЫТЬ</button>
          </div>
        </div>
      </article>`;
    };
    return `
    <div class="screenPad">
      <div class="phead"><h2>КЕЙСЫ</h2><div class="caseTokenBox"><span>ЖЕТОНЫ</span><b>${tokens}</b></div></div>
      <div class="caseTop">
        <div class="caseIntro">
          <h3>ЧЕСТНЫЕ ШАНСЫ. БЕЗ РЕАЛЬНЫХ ДЕНЕГ.</h3>
          <p>Жетоны выдаются за завершённые матчи, победы и тренировочные задания (10+ убийств). Один бесплатный кейс доступен каждый день: ежедневная награда — 2 жетона, этого хватает на самый доступный кейс. Вероятности указаны для каждой коллекции и рассчитываются из весов редкостей.</p>
          <div class="caseTopBtns">
            <button class="miniBtn accent" id="dailyCase" ${daily?'':'disabled'}>${daily?'ЗАБРАТЬ БЕСПЛАТНЫЙ КЕЙС':'БЕСПЛАТНЫЙ КЕЙС УЖЕ ПОЛУЧЕН'}</button>
            <span class="caseHint">Следующий бесплатный: завтра</span>
          </div>
        </div>
        <div class="caseLast">${this.lastCaseResult ? `<span>ПОСЛЕДНИЙ ДРОП</span><b style="color:${this.lastCaseResult.rarityInfo.color}">${esc(this.lastCaseResult.name)}</b><i>${this.lastCaseResult.rarityInfo.name}</i>` : '<span>ПОСЛЕДНИЙ ДРОП</span><b>—</b><i>Откройте первый кейс</i>'}</div>
      </div>
      <div class="caseGrid">${CRATES.map(card).join('')}</div>
      <div class="invFoot">Стартовый кейс бесплатен один раз. Остальные кейсы стоят жетоны, которые нельзя купить за деньги.</div>
    </div>`;
  }

  _controls(st){
    const layout = this._touchLayout();
    const meta = this._touchMeta();
    const s = st.settings;
    const selected = meta.find(m=>m.id===this.touchSelected) || meta[0];
    return `
    <div class="screenPad">
      <div class="phead"><button class="backBtn" data-go="settings">‹ НАСТРОЙКИ</button><h2>УПРАВЛЕНИЕ</h2><span class="headHint">Перетащите кнопки · размер · прозрачность · чувствительность</span></div>
      <div class="controlsWrap">
        <div class="touchPreview" id="touchPreview">
          <div class="tpSafe">ЭКРАН УСТРОЙСТВА</div>
          ${meta.map(m=>`<div class="tpBtn ${m.cls} ${this.touchSelected===m.id?'sel':''}" data-tid="${m.id}" style="left:${layout[m.id].x*100}%;top:${layout[m.id].y*100}%;--s:${layout[m.id].s}">${m.label}</div>`).join('')}
          <div class="tpCross"></div>
        </div>
        <div class="controlsPanel">
          <div class="setCard">
            <h3>Раскладка</h3>
            <p class="setNote">Выберите кнопку, перетащите её по экрану. Изменения сохраняются автоматически.</p>
            <label class="setRow"><span>Выбранная кнопка</span><b>${selected.label}</b></label>
            <label class="setRow"><span>Размер кнопки</span><input type="range" id="ctlSize" min="0.45" max="1.5" step="0.05" value="${layout[selected.id].s}"><b id="ctlSizeVal">${Math.round(layout[selected.id].s*100)}%</b></label>
            <label class="setRow"><span>Прозрачность</span><input type="range" id="ctlOpacity" min="0.25" max="1" step="0.05" value="${s.touchOpacity??0.82}"><b id="ctlOpacityVal">${Math.round((s.touchOpacity??0.82)*100)}%</b></label>
            <label class="setRow"><span>Чувствительность камеры</span><input type="range" id="ctlSens" min="0.2" max="3" step="0.05" value="${s.sensitivity}"><b id="ctlSensVal">${s.sensitivity.toFixed(2)}</b></label>
            <label class="setRow"><span>Чувствительность в прицеле</span><input type="range" id="ctlAimSens" min="0.3" max="1.5" step="0.02" value="${s.aimSensitivity??0.78}"><b id="ctlAimVal">${Math.round((s.aimSensitivity??0.78)*100)}%</b></label>
            <label class="setRow"><span>Ускорение камеры</span><select id="ctlAccel"><option value="0" ${!s.cameraAcceleration?'selected':''}>Выключено</option><option value="1" ${s.cameraAcceleration?'selected':''}>Плавное</option></select><b></b></label>
            <div class="ctlBtns"><button class="ghostBtn" id="ctlReset">СБРОСИТЬ РАСКЛАДКУ</button><button class="miniBtn accent" id="ctlClose">ГОТОВО</button></div>
          </div>
          <div class="setCard infoCard">
            <h3>Сенсорные кнопки</h3>
            <p>Слева — джойстик движения, справа — огонь, прицел, прыжок и присед. Кнопки работают одновременно: можно двигаться, стрелять и целиться.</p>
            <p>Для ПК: WASD, Shift, Ctrl, Space, ЛКМ, ПКМ, R, B, E, Tab. Клавиши переназначаются в настройках.</p>
          </div>
        </div>
      </div>
    </div>`;
  }

  _keyName(code){
    if(!code) return '—';
    const names = {
      Space:'SPACE', ShiftLeft:'SHIFT', ShiftRight:'R-SHIFT', ControlLeft:'CTRL', ControlRight:'R-CTRL',
      AltLeft:'ALT', AltRight:'R-ALT', Escape:'ESC', Tab:'TAB', Enter:'ENTER', Backspace:'BACKSPACE',
      ArrowUp:'↑', ArrowDown:'↓', ArrowLeft:'←', ArrowRight:'→', CapsLock:'CAPS',
      Semicolon:';', Quote:"'", Comma:',', Period:'.', Slash:'/', Backslash:'\\', BracketLeft:'[', BracketRight:']'
    };
    if(names[code]) return names[code];
    if(code.startsWith('Key')) return code.slice(3);
    if(code.startsWith('Digit')) return code.slice(5);
    if(code.startsWith('Numpad')) return 'NUM ' + code.slice(6);
    return code.toUpperCase();
  }

  _settings(st){
    const s = st.settings;
    const binds = { ...DEFAULT_BINDS, ...(s.keybinds || {}) };
    const bindRows = Object.keys(REBIND_LABELS).map(action=>`
      <button class="bindRow ${this.rebindAction===action?'listening':''}" data-bind="${action}">
        <span>${REBIND_LABELS[action]}</span><kbd>${this.rebindAction===action ? 'НАЖМИТЕ КЛАВИШУ…' : this._keyName(binds[action])}</kbd>
      </button>`).join('');
    const gp = this._gamepadStatus();
    return `
    <div class="screenPad">
      <div class="phead"><h2>НАСТРОЙКИ</h2><button class="miniBtn accent" data-go="controls">РЕДАКТОР РАСКЛАДКИ</button><div class="catTabs">
        <span class="catTab active">STANDOFF 3</span><span class="catTab">ULTIMATE 5.0</span>
      </div></div>
      <div class="settingsGrid">
        <div class="setCard">
          <h3>Управление</h3>
          <label class="setRow"><span>Чувствительность мыши</span><input type="range" min="0.2" max="3" step="0.05" value="${s.sensitivity}" data-set="sensitivity"><b>${s.sensitivity.toFixed(2)}</b></label>
          <label class="setRow"><span>Чувствительность в прицеле</span><input type="range" min="0.3" max="1.5" step="0.02" value="${s.aimSensitivity??0.78}" data-set="aimSensitivity"><b>${Math.round((s.aimSensitivity??0.78)*100)}%</b></label>
          <label class="setRow"><span>Поле зрения (FOV)</span><input type="range" min="60" max="105" step="1" value="${s.fov}" data-set="fov"><b>${s.fov}°</b></label>
          <label class="setRow"><span>Инверсия мыши</span><input type="checkbox" ${s.invertY?'checked':''} data-set="invertY"><b></b></label>
          <label class="setRow"><span>Присед переключателем</span><input type="checkbox" ${s.toggleCrouch!==false?'checked':''} data-set="toggleCrouch"><b></b></label>
          <label class="setRow"><span>Индикаторы урона</span><input type="checkbox" ${s.damageDirections!==false?'checked':''} data-set="damageDirections"><b></b></label>
          <label class="setRow"><span>Подсказки в бою</span><input type="checkbox" ${s.showHints!==false?'checked':''} data-set="showHints"><b></b></label>
        </div>
        <div class="setCard">
          <h3>Геймпад</h3>
          <div class="gamepadStatus ${gp.connected?'on':''}"><span class="gpDot"></span><b>${gp.connected?'ПОДКЛЮЧЁН':'НЕ НАЙДЕН'}</b><i>${esc(gp.id)}</i></div>
          <label class="setRow"><span>Включить геймпад</span><input type="checkbox" ${s.gamepadEnabled!==false?'checked':''} data-set="gamepadEnabled"><b></b></label>
          <label class="setRow"><span>Чувствительность стика</span><input type="range" min="0.3" max="2.5" step="0.05" value="${s.gamepadSensitivity??1}" data-set="gamepadSensitivity"><b>${(s.gamepadSensitivity??1).toFixed(2)}</b></label>
          <label class="setRow"><span>Мёртвая зона</span><input type="range" min="0.05" max="0.4" step="0.01" value="${s.gamepadDeadzone??0.18}" data-set="gamepadDeadzone"><b>${Math.round((s.gamepadDeadzone??0.18)*100)}%</b></label>
          <label class="setRow"><span>Вибрация</span><input type="checkbox" ${s.gamepadVibration!==false?'checked':''} data-set="gamepadVibration"><b></b></label>
          <label class="setRow"><span>Раскладка стиков</span>
            <select data-set="gamepadLayout">
              <option value="standard" ${(s.gamepadLayout||'standard')==='standard'?'selected':''}>Стандартная</option>
              <option value="southpaw" ${s.gamepadLayout==='southpaw'?'selected':''}>Southpaw (зеркальная)</option>
            </select><b></b></label>
          <label class="setRow"><span>Сенсорное управление</span><input type="checkbox" ${s.touchControls?'checked':''} data-set="touchControls"><b></b></label>
          <label class="setRow"><span>Размер сенсорных кнопок</span><input type="range" min="0.7" max="1.35" step="0.05" value="${s.touchScale??1}" data-set="touchScale"><b>${Math.round((s.touchScale??1)*100)}%</b></label>
          <label class="setRow"><span>Прозрачность кнопок</span><input type="range" min="0.35" max="0.95" step="0.05" value="${s.touchOpacity??0.82}" data-set="touchOpacity"><b>${Math.round((s.touchOpacity??0.82)*100)}%</b></label>
          <label class="setRow"><span>Кнопки слева</span><input type="checkbox" ${s.touchLeftHanded?'checked':''} data-set="touchLeftHanded"><b></b></label>
          <label class="setRow"><span>Пресет сенсорных кнопок</span>
            <select data-set="touchLayout">
              <option value="standard" ${(s.touchLayout||'standard')==='standard'?'selected':''}>Стандартная</option>
              <option value="compact" ${s.touchLayout==='compact'?'selected':''}>Компактная</option>
            </select><b></b></label>
        </div>
        <div class="setCard bindsCard">
          <h3>Клавиши</h3>
          <p class="setNote">Нажмите на действие и затем нужную клавишу. Изменения сохраняются сразу.</p>
          <div class="bindGrid">${bindRows}</div>
          <button class="ghostBtn" id="resetBinds">СБРОСИТЬ КЛАВИШИ</button>
        </div>
        <div class="setCard">
          <h3>Графика</h3>
          <label class="setRow"><span>Качество</span>
            <select data-set="quality">
              <option value="verylow" ${s.quality==='verylow'?'selected':''}>Очень низкое</option>
              <option value="low" ${s.quality==='low'?'selected':''}>Низкое</option>
              <option value="medium" ${s.quality==='medium'?'selected':''}>Среднее</option>
              <option value="high" ${s.quality==='high'?'selected':''}>Высокое</option>
              <option value="ultra" ${s.quality==='ultra'?'selected':''}>Ультра</option>
            </select><b></b></label>
          <label class="setRow"><span>Качество текстур</span>
            <select data-set="textureQuality">
              <option value="low" ${s.textureQuality==='low'?'selected':''}>Низкое</option>
              <option value="medium" ${(s.textureQuality||'high')==='medium'?'selected':''}>Среднее</option>
              <option value="high" ${(!s.textureQuality||s.textureQuality==='high')?'selected':''}>Высокое</option>
            </select><b></b></label>
          <label class="setRow"><span>Тени</span><input type="checkbox" ${s.shadows?'checked':''} data-set="shadows"><b></b></label>
          <label class="setRow"><span>Сглаживание MSAA</span><input type="checkbox" ${s.msaa!==false?'checked':''} data-set="msaa"><b></b></label>
          <label class="setRow"><span>Частицы и пыль</span><input type="checkbox" ${s.particles!==false?'checked':''} data-set="particles"><b></b></label>
          <label class="setRow"><span>Динамическое разрешение</span><input type="checkbox" ${s.dynamicResolution!==false?'checked':''} data-set="dynamicResolution"><b></b></label>
          <label class="setRow"><span>Масштаб рендера</span><input type="range" min="0.5" max="1" step="0.05" value="${s.renderScale||1}" data-set="renderScale"><b>${Math.round((s.renderScale||1)*100)}%</b></label>
          <label class="setRow"><span>Разрешение</span><input type="range" min="0.5" max="1" step="0.05" value="${s.resolutionScale||1}" data-set="resolutionScale"><b>${Math.round((s.resolutionScale||1)*100)}%</b></label>
          <label class="setRow"><span>Дальность прорисовки</span><input type="range" min="80" max="320" step="10" value="${s.viewDistance||240}" data-set="viewDistance"><b>${s.viewDistance||240} м</b></label>
          <label class="setRow"><span>Лимит FPS</span>
            <select data-set="maxFps">
              ${[0,30,60,90,120,144,240].map(n=>`<option value="${n}" ${Number(s.maxFps||0)===n?'selected':''}>${n?n:'Без лимита'}</option>`).join('')}
            </select><b></b></label>
          <label class="setRow"><span>Вертикальная синхронизация</span><input type="checkbox" ${s.vsync!==false?'checked':''} data-set="vsync"><b></b></label>
          <label class="setRow"><span>Яркость</span><input type="range" min="0.6" max="1.4" step="0.02" value="${s.brightness||1}" data-set="brightness"><b>${Math.round((s.brightness||1)*100)}%</b></label>
          <label class="setRow"><span>Масштаб HUD</span><input type="range" min="0.8" max="1.3" step="0.05" value="${s.hudScale||1}" data-set="hudScale"><b>${Math.round((s.hudScale||1)*100)}%</b></label>
          <label class="setRow"><span>Показывать FPS</span><input type="checkbox" ${s.showFps?'checked':''} data-set="showFps"><b></b></label>
        </div>
        <div class="setCard">
          <h3>Прицел</h3>
          <label class="setRow"><span>Прицел включён</span><input type="checkbox" ${s.crosshairEnabled!==false?'checked':''} data-set="crosshairEnabled"><b></b></label>
          <label class="setRow"><span>Цвет прицела</span><input type="color" value="${s.crosshairColor}" data-set="crosshairColor"><b></b></label>
          <label class="setRow"><span>Длина линий</span><input type="range" min="2" max="18" step="1" value="${s.crosshairSize}" data-set="crosshairSize"><b>${s.crosshairSize}</b></label>
          <label class="setRow"><span>Толщина линий</span><input type="range" min="1" max="5" step="1" value="${s.crosshairThickness??2}" data-set="crosshairThickness"><b>${s.crosshairThickness??2}</b></label>
          <label class="setRow"><span>Зазор от центра</span><input type="range" min="0" max="16" step="1" value="${s.crosshairGap??4}" data-set="crosshairGap"><b>${s.crosshairGap??4}</b></label>
          <label class="setRow"><span>Прозрачность</span><input type="range" min="0.15" max="1" step="0.05" value="${s.crosshairOpacity??0.92}" data-set="crosshairOpacity"><b>${Math.round((s.crosshairOpacity??0.92)*100)}%</b></label>
          <label class="setRow"><span>Точка в центре</span><input type="checkbox" ${s.crosshairDot?'checked':''} data-set="crosshairDot"><b></b></label>
          <label class="setRow"><span>Обводка прицела</span><input type="checkbox" ${s.crosshairOutline!==false?'checked':''} data-set="crosshairOutline"><b></b></label>
          <label class="setRow"><span>Динамический разброс</span><input type="checkbox" ${s.crosshairDynamic!==false?'checked':''} data-set="crosshairDynamic"><b></b></label>
          <div class="chPreview"><div class="chPreviewInner" style="--pColor:${s.crosshairColor};--pLen:${s.crosshairSize}px;--pThick:${s.crosshairThickness??2}px;--pGap:${(s.crosshairGap??4)+4}px;--pOpacity:${s.crosshairOpacity??0.92}">
            <span class="chp h top"></span><span class="chp h bottom"></span><span class="chp v left"></span><span class="chp v right"></span><span class="chp dot" style="display:${s.crosshairDot?'block':'none'}"></span>
          </div></div>
        </div>
        <div class="setCard">
          <h3>Звук</h3>
          <label class="setRow"><span>Громкость</span><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-set="volume"><b>${Math.round(s.volume*100)}%</b></label>
        </div>
        <div class="setCard infoCard">
          <h3>Управление в бою</h3>
          <div class="keyList">
            <div><kbd>W A S D</kbd> движение</div><div><kbd>SHIFT</kbd> бег</div>
            <div><kbd>CTRL</kbd> присед</div><div><kbd>SPACE</kbd> прыжок</div>
            <div><kbd>ЛКМ</kbd> огонь</div><div><kbd>ПКМ</kbd> прицел</div>
            <div><kbd>R</kbd> перезарядка</div><div><kbd>1-4</kbd> оружие/гранаты</div>
            <div><kbd>B</kbd> магазин</div><div><kbd>TAB</kbd> счёт</div>
            <div><kbd>ESC</kbd> пауза</div><div><kbd>E</kbd> закладка/обезвреживание</div>
            <div><kbd>F</kbd> осмотр оружия</div><div><kbd>G</kbd> выбросить оружие</div>
            <div><kbd>Q</kbd> последний слот</div><div><kbd>Колесо</kbd> смена оружия</div>
            <div><kbd>← / →</kbd> наблюдение</div><div><kbd>V</kbd> свободная камера</div>
            <div><kbd>F1-F8</kbd> функции MOD MENU</div><div><kbd>E</kbd> подобрать/заменить</div>
          </div>
          <p class="setNote">Геймпад: A — прыжок, B — присед, X — перезарядка, Y — смена оружия, LT/RT — прицел/огонь, Start — пауза.</p>
        </div>
      </div>
    </div>`;
  }

  _gamepadStatus(){
    let id = '';
    try{
      if(typeof navigator !== 'undefined' && navigator.getGamepads){
        const pads = navigator.getGamepads();
        for(const p of pads){ if(p){ id = p.id || 'Gamepad'; break; } }
      }
    }catch(e){}
    return { connected: !!id, id: id || 'Подключите контроллер и нажмите кнопку' };
  }

  _mods(st){
    const s = st.settings;
    if(!s.modUnlocked){s.modUnlocked=true;saveState();}
    const c = s.cheats || {};
    return `
    <div class="screenPad">
      <div class="phead"><h2>STANDOFF 3 MOD MENU</h2><span class="headHint">Доступ открыт · только одиночная игра</span></div>
      <div class="modBanner"><b>MOD MENU</b><span>Функции ограничены тренировкой, редактором и приватным матчем.</span></div>
      <div class="settingsGrid">
        <div class="setCard modCard">
          <h3>Движение</h3>
          <label class="setRow"><span>Полёт</span><input type="checkbox" ${c.fly?'checked':''} data-set="cheats.fly"><b>F1</b></label>
          <label class="setRow"><span>Noclip · сквозь стены</span><input type="checkbox" ${c.noclip?'checked':''} data-set="cheats.noclip"><b>F2</b></label>
          <label class="setRow"><span>Свободная камера</span><input type="checkbox" ${c.freeCam?'checked':''} data-set="cheats.freeCam"><b>F8</b></label>
          <label class="setRow"><span>Множитель скорости</span><input type="range" min="0.5" max="5" step="0.1" value="${c.speedControl??1.6}" data-set="cheats.speedControl"><b>${(c.speedControl??1.6).toFixed(1)}x</b></label>
          <label class="setRow"><span>Ускорение (F7)</span><input type="checkbox" ${c.speed?'checked':''} data-set="cheats.speed"><b>F7</b></label>
          <label class="setRow"><span>Сила прыжка</span><input type="range" min="0.5" max="3" step="0.1" value="${c.jumpPower??1}" data-set="cheats.jumpPower"><b>${(c.jumpPower??1).toFixed(1)}x</b></label>
        </div>
        <div class="setCard modCard">
          <h3>Бой и информация</h3>
          <label class="setRow"><span>Wall Vision · видеть врагов</span><input type="checkbox" ${c.esp?'checked':''} data-set="cheats.esp"><b>F4</b></label>
          <label class="setRow"><span>Прострел сквозь стены</span><input type="checkbox" ${c.wallbang?'checked':''} data-set="cheats.wallbang"><b>F9</b></label>
          <label class="setRow"><span>Автонаводка</span><input type="checkbox" ${c.aimbot?'checked':''} data-set="cheats.aimbot"><b>F10</b></label>
          <label class="setRow"><span>Бессмертие</span><input type="checkbox" ${c.god?'checked':''} data-set="cheats.god"><b>F5</b></label>
          <label class="setRow"><span>Бесконечные патроны</span><input type="checkbox" ${c.infiniteAmmo?'checked':''} data-set="cheats.infiniteAmmo"><b>F3</b></label>
          <label class="setRow"><span>Бесконечные деньги</span><input type="checkbox" ${c.infiniteMoney?'checked':''} data-set="cheats.infiniteMoney"><b>F6</b></label>
          <label class="setRow"><span>Debug-информация</span><input type="checkbox" ${c.debugInfo?'checked':''} data-set="cheats.debugInfo"><b></b></label>
        </div>
        <div class="setCard infoCard">
          <h3>Правила</h3>
          <p>MOD MENU открывается без кода. В матче нажмите MOD.</p>
          <p>ESP отображается через Wall Vision. В соревновательном матче без приватного флага все функции игнорируются сервером матча.</p>
          <p>Используйте F1–F10 для быстрого переключения. Клавиши можно переназначить в настройках.</p>
        </div>
      </div>
    </div>`;
  }

  _newEditor(){
    const w = 32, h = 32;
    const grid = Array.from({length:h}, (_,y)=>Array.from({length:w}, (_,x)=>(x===0||y===0||x===w-1||y===h-1)?1:0));
    return {
      name:'Моя арена', w, h, theme:'city', light:'day',
      grid,
      sites:[{name:'A', x:24, y:9},{name:'B', x:8, y:23}],
      spawns:{ CT:[{x:4,y:16},{x:5,y:17},{x:4,y:18}], T:[{x:27,y:16},{x:26,y:17},{x:27,y:18}] },
      tool:'wall', brush:1, editId:null
    };
  }
  _loadCustomMaps(){
    try{
      const raw = localStorage.getItem('standoff3_custom_maps');
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    }catch(e){ return []; }
  }
  _saveCustomMaps(){
    try{ localStorage.setItem('standoff3_custom_maps', JSON.stringify(this.customMaps || [])); }catch(e){}
  }
  _editorMapData(){
    const ed = this.editor;
    return {
      name: ed.name, w: ed.w, h: ed.h, grid: ed.grid,
      sites: ed.sites.map(s=>({ name:s.name, x:s.x, y:s.y })),
      spawns: { CT: ed.spawns.CT.map(s=>({x:s.x,y:s.y})), T: ed.spawns.T.map(s=>({x:s.x,y:s.y})) },
      theme: ed.theme, light: ed.light
    };
  }
  _editor(){
    const ed = this.editor;
    const tool = (id,label)=>`<button class="etool ${ed.tool===id?'active':''}" data-etool="${id}">${label}</button>`;
    const saved = (this.customMaps || []).map(m=>`<option value="${esc(m.id)}" ${ed.editId===m.id?'selected':''}>${esc(m.name)} · ${m.w}×${m.h}</option>`).join('');
    return `
    <div class="screenPad editorScreen">
      <div class="phead"><h2>РЕДАКТОР КАРТ</h2><span class="headHint">Рисуйте арену, ставьте A/B и тестируйте в бою</span></div>
      <div class="editorWrap">
        <div class="editorSide">
          <div class="setCard">
            <h3>Инструменты</h3>
            <div class="editorTools">
              ${tool('wall','Стена')}${tool('crate','Ящик')}${tool('low','Низкая стена')}${tool('erase','Ластик')}
              ${tool('siteA','Точка A')}${tool('siteB','Точка B')}${tool('ct','Спавн CT')}${tool('t','Спавн T')}
            </div>
            <label class="setRow"><span>Кисть</span>
              <select id="editorBrush">${[1,2,3].map(n=>`<option value="${n}" ${ed.brush===n?'selected':''}>${n}×${n}</option>`).join('')}</select><b></b></label>
            <label class="setRow"><span>Тема</span>
              <select id="editorTheme">
                ${[['city','Город'],['harbor','Порт'],['office','Офис'],['dust','Пыль'],['desert','Пустыня'],['industrial','Завод']].map(([v,n])=>`<option value="${v}" ${ed.theme===v?'selected':''}>${n}</option>`).join('')}
              </select><b></b></label>
            <label class="setRow"><span>Освещение</span>
              <select id="editorLight">
                ${[['day','День'],['dusk','Закат'],['night','Ночь']].map(([v,n])=>`<option value="${v}" ${ed.light===v?'selected':''}>${n}</option>`).join('')}
              </select><b></b></label>
            <label class="setRow"><span>Название</span><input id="editorName" maxlength="26" value="${esc(ed.name)}"><b></b></label>
          </div>
          <div class="setCard">
            <h3>Файл</h3>
            <div class="editorBtns">
              <button class="ghostBtn" id="editorNew">НОВАЯ</button>
              <button class="ghostBtn" id="editorSave">СОХРАНИТЬ</button>
              <button class="ghostBtn" id="editorDelete">УДАЛИТЬ</button>
            </div>
            <label class="setRow"><span>Загрузить</span>
              <select id="editorLoad"><option value="">— выберите карту —</option>${saved}</select><b></b></label>
            <button class="bigPlay small" id="editorPlay"><span>▶</span> ИГРАТЬ НА КАРТЕ</button>
            <p class="setNote">ЛКМ — рисовать, ПКМ — стирать. Сохранение хранится локально на устройстве.</p>
          </div>
        </div>
        <div class="editorCanvasWrap">
          <canvas id="mapEditor" width="640" height="640"></canvas>
          <div id="editorStatus" class="editorStatus"></div>
        </div>
      </div>
    </div>`;
  }
  _saveEditor(silent){
    const ed = this.editor;
    if(!ed.editId) ed.editId = 'custom-' + Date.now().toString(36);
    const data = { id: ed.editId, ...this._editorMapData() };
    const idx = (this.customMaps || []).findIndex(m=>String(m.id) === String(ed.editId));
    if(idx >= 0) this.customMaps[idx] = data;
    else (this.customMaps = this.customMaps || []).push(data);
    this._saveCustomMaps();
    return data;
  }
  _initEditorCanvas(){
    const cv = this.root.querySelector('#mapEditor');
    if(!cv) return;
    this._editorCanvas = cv;
    this._editorCtx = cv.getContext('2d');
    this._editorPainting = false;
    const cellFromEvent = (e) => {
      const r = cv.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left) / r.width * this.editor.w);
      const y = Math.floor((e.clientY - r.top) / r.height * this.editor.h);
      return { x, y };
    };
    cv.onpointerdown = (e) => {
      e.preventDefault();
      this._editorPainting = true;
      const c = cellFromEvent(e);
      this._paintEditorCell(c.x, c.y, e.button === 2);
      if(cv.setPointerCapture){ try{ cv.setPointerCapture(e.pointerId); }catch(err){} }
    };
    cv.onpointermove = (e) => {
      if(!this._editorPainting) return;
      const c = cellFromEvent(e);
      this._paintEditorCell(c.x, c.y, e.buttons === 2);
    };
    const stop = () => { this._editorPainting = false; };
    cv.onpointerup = stop; cv.onpointercancel = stop; cv.onpointerleave = stop;
    cv.oncontextmenu = (e)=>e.preventDefault();
    this._drawEditor();
  }
  _paintEditorCell(cx, cy, erase){
    const ed = this.editor;
    if(cx < 1 || cy < 1 || cx >= ed.w-1 || cy >= ed.h-1) return;
    const tool = erase ? 'erase' : ed.tool;
    if(tool === 'siteA' || tool === 'siteB'){
      const idx = tool === 'siteA' ? 0 : 1;
      ed.sites[idx] = { name: tool === 'siteA' ? 'A' : 'B', x:cx, y:cy };
    } else if(tool === 'ct' || tool === 't'){
      const list = ed.spawns[tool === 'ct' ? 'CT' : 'T'];
      if(list.length >= 8) list.shift();
      if(!list.some(s=>s.x===cx && s.y===cy)) list.push({ x:cx, y:cy });
    } else {
      const val = tool === 'erase' ? 0 : (tool === 'wall' ? 1 : (tool === 'crate' ? 2 : 3));
      const b = Math.max(1, Math.min(3, ed.brush || 1));
      const off = Math.floor(b/2);
      for(let y=cy-off; y<cy-off+b; y++) for(let x=cx-off; x<cx-off+b; x++){
        if(x < 1 || y < 1 || x >= ed.w-1 || y >= ed.h-1) continue;
        ed.grid[y][x] = val;
      }
    }
    this._drawEditor();
  }
  _drawEditor(){
    const cv = this._editorCanvas, c = this._editorCtx;
    if(!cv || !c) return;
    const ed = this.editor;
    const S = cv.width, cell = S / ed.w;
    c.clearRect(0,0,S,S);
    c.fillStyle = '#0b1117'; c.fillRect(0,0,S,S);
    for(let y=0;y<ed.h;y++){
      for(let x=0;x<ed.w;x++){
        const v = ed.grid[y] ? ed.grid[y][x] : 0;
        if(v === 1) c.fillStyle = '#65727d';
        else if(v === 2) c.fillStyle = '#9a7238';
        else if(v === 3) c.fillStyle = '#4b5a62';
        else c.fillStyle = ((x+y)%2) ? '#111a21' : '#0e161c';
        c.fillRect(x*cell, y*cell, cell+0.5, cell+0.5);
      }
    }
    c.strokeStyle = 'rgba(120,170,200,.12)'; c.lineWidth = 1;
    for(let x=0;x<=ed.w;x++){ c.beginPath(); c.moveTo(x*cell,0); c.lineTo(x*cell,S); c.stroke(); }
    for(let y=0;y<=ed.h;y++){ c.beginPath(); c.moveTo(0,y*cell); c.lineTo(S,y*cell); c.stroke(); }
    for(const s of ed.sites){
      c.fillStyle = 'rgba(255,207,90,.22)';
      c.beginPath(); c.arc(s.x*cell+cell/2, s.y*cell+cell/2, cell*1.7, 0, 6.283); c.fill();
      c.fillStyle = '#ffcf5a'; c.font = `bold ${Math.floor(cell*1.2)}px Arial`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(s.name, s.x*cell+cell/2, s.y*cell+cell/2);
    }
    for(const [team,color] of [['CT','#4fa3ff'],['T','#ffb03a']]){
      for(const s of ed.spawns[team]){
        c.fillStyle = color;
        c.beginPath(); c.arc(s.x*cell+cell/2, s.y*cell+cell/2, cell*0.42, 0, 6.283); c.fill();
      }
    }
    c.strokeStyle = 'rgba(120,220,255,.6)'; c.lineWidth = 2; c.strokeRect(1,1,S-2,S-2);
    const status = this.root.querySelector('#editorStatus');
    if(status) status.textContent = `${ed.name} · ${ed.w}×${ed.h} · ${ed.theme} / ${ed.light} · точка ${ed.tool}`;
  }

  _profile(st,p,rank){
    const kd = p.deaths ? (p.kills/p.deaths).toFixed(2) : p.kills.toFixed(2);
    const hs = p.kills ? Math.round(p.headshots/p.kills*100) : 0;
    const winrate = p.matches ? Math.round(p.wins/p.matches*100) : 0;
    const xpNeed = xpForLevel(p.level);
    return `
    <div class="screenPad">
      <div class="phead"><h2>ПРОФИЛЬ</h2></div>
      <div class="profGrid">
        <div class="profCard">
          <div class="profTop"><div class="profAvatar">${avatarArt(p.avatar)}</div>
            <div><div class="profName">${esc(p.name)}</div><div class="profRank">${rank.name} · MMR ${p.mmr}</div></div>
          </div>
          <div class="avatarPicker">${AVATARS.map(id=>`<button data-avatar="${id}" aria-label="${id}">${avatarArt(id)}</button>`).join('')}</div><div class="nameEdit"><input id="nameInput" maxlength="14" value="${esc(p.name)}"><button id="saveName">СОХРАНИТЬ</button></div>
          <div class="xpBar"><div style="width:${Math.min(100,Math.round(p.xp/xpNeed*100))}%"></div></div>
          <div class="xpText">Уровень ${p.level} · ${p.xp}/${xpNeed} XP</div>
        </div>
        <div class="statGrid">
          <div class="statBox"><b>${p.matches}</b><span>Матчей</span></div>
          <div class="statBox"><b>${p.wins}</b><span>Побед</span></div>
          <div class="statBox"><b>${p.losses}</b><span>Поражений</span></div>
          <div class="statBox"><b>${winrate}%</b><span>Winrate</span></div>
          <div class="statBox"><b>${p.kills}</b><span>Убийств</span></div>
          <div class="statBox"><b>${p.deaths}</b><span>Смертей</span></div>
          <div class="statBox"><b>${kd}</b><span>K/D</span></div>
          <div class="statBox"><b>${hs}%</b><span>Хедшотов</span></div>
          <div class="statBox"><b>${Math.round(p.playtime/60)}</b><span>Минут в бою</span></div>
        </div>
        <div class="dangerCard">
          <h3>Опасная зона</h3>
          <p>Сброс прогресса удалит уровень, статистику и инвентарь.</p>
          <button id="resetProgress" class="dangerBtn">СБРОСИТЬ ПРОГРЕСС</button>
        </div>
      </div>
    </div>`;
  }

  _account(st,p){
    const sess = currentSession();
    const acc = sess && sess.account;
    if(acc){
      const created = new Date(acc.createdAt || Date.now()).toLocaleDateString('ru-RU');
      const last = acc.lastLogin ? new Date(acc.lastLogin).toLocaleString('ru-RU') : '—';
      return `
      <div class="screenPad">
        <div class="phead"><h2>АККАУНТ</h2><span class="headNote">Локальный профиль на этом устройстве</span></div>
        <div class="accountGrid">
          <div class="authCard signed">
            <div class="accAvatar">${esc(acc.displayName || acc.username || '?')[0].toUpperCase()}</div>
            <h3>${esc(acc.displayName || acc.username)}</h3>
            <div class="accLogin">@${esc(acc.username)}</div>
            <div class="accMeta"><span>Создан</span><b>${created}</b></div>
            <div class="accMeta"><span>Последний вход</span><b>${last}</b></div>
            <div class="accMeta"><span>Матчей</span><b>${acc.matches || 0}</b></div>
            <div class="accMeta"><span>Побед</span><b>${acc.wins || 0}</b></div>
            <div class="nameEdit"><input id="accNameInput" maxlength="16" value="${esc(acc.displayName || acc.username)}"><button id="accRename">СОХРАНИТЬ ИМЯ</button></div>
            <p class="authNote">Пароль хранится как PBKDF2-хеш (SHA-256, 120 000 итераций). Прогресс синхронизируется с аккаунтом при каждом сохранении.</p>
            <button class="authBtn ghost" id="accLogout">ВЫЙТИ ИЗ АККАУНТА</button>
          </div>
          <div class="authCard">
            <h3>СЕССИЯ</h3>
            <p class="authNote">Вы вошли на этом устройстве. Сессия действует 14 дней и восстанавливается при запуске игры.</p>
            <div class="accStat"><b>${p.matches}</b><span>матчей</span><b>${p.wins}</b><span>побед</span></div>
            <div class="accStat"><b>${p.kills}</b><span>убийств</span><b>${p.level}</b><span>уровень</span></div>
            <button class="authBtn" data-go="profile">ОТКРЫТЬ ПРОФИЛЬ</button>
            <button class="authBtn ghost" data-go="play">В БОЙ</button>
          </div>
        </div>
      </div>`;
    }
    return `
    <div class="screenPad">
      <div class="phead"><h2>АККАУНТ</h2><span class="headNote">Регистрация и вход без интернета</span></div>
      <div class="accountGrid">
        <div class="authCard">
          <h3>ВХОД</h3>
          <label class="authField"><span>Логин</span><input id="loginUser" autocomplete="username" maxlength="18" placeholder="Ваш логин"></label>
          <label class="authField"><span>Пароль</span><input id="loginPass" type="password" autocomplete="current-password" maxlength="128" placeholder="••••••"></label>
          <button class="authBtn" data-auth="login">ВОЙТИ</button>
          <p class="authNote">Аккаунт хранится только на этом устройстве.</p>
        </div>
        <div class="authCard">
          <h3>РЕГИСТРАЦИЯ</h3>
          <label class="authField"><span>Логин</span><input id="regUser" autocomplete="username" maxlength="18" placeholder="3–18 символов"></label>
          <label class="authField"><span>Имя игрока</span><input id="regName" maxlength="16" placeholder="Отображаемое имя"></label>
          <label class="authField"><span>Пароль</span><input id="regPass" type="password" autocomplete="new-password" maxlength="128" placeholder="Минимум 6 символов"></label>
          <label class="authField"><span>Повтор пароля</span><input id="regConfirm" type="password" autocomplete="new-password" maxlength="128" placeholder="Ещё раз"></label>
          <button class="authBtn" data-auth="register">СОЗДАТЬ АККАУНТ</button>
          <p class="authNote">Пароль должен содержать буквы и цифры.</p>
        </div>
      </div>
      <div id="authMsg" class="authMsg" role="status"></div>
    </div>`;
  }

  async _doAuth(kind){
    if(this._authBusy) return;
    const msg = this.root.querySelector('#authMsg');
    const val = id => { const el = this.root.querySelector('#'+id); return el ? el.value : ''; };
    const btn = this.root.querySelector(`[data-auth="${kind}"]`);
    this._authBusy = true;
    if(btn){ btn.disabled = true; btn.textContent = kind === 'login' ? 'ПРОВЕРКА…' : 'СОЗДАНИЕ…'; }
    if(msg){ msg.className = 'authMsg'; msg.textContent = 'Обработка…'; }
    let res;
    try{
      if(kind === 'login') res = await authLogin({ username: val('loginUser'), password: val('loginPass') });
      else res = await authRegister({ username: val('regUser'), displayName: val('regName'), password: val('regPass'), confirm: val('regConfirm') });
    }catch(e){ res = { ok:false, error:e.message || 'Ошибка авторизации' }; }
    this._authBusy = false;
    if(res && res.ok){
      audio.pickup();
      this.render();
      const m = this.root.querySelector('#authMsg');
      if(m){ m.className = 'authMsg ok'; m.textContent = kind === 'login' ? 'Вход выполнен' : 'Аккаунт создан'; }
    } else {
      if(btn){ btn.disabled = false; btn.textContent = kind === 'login' ? 'ВОЙТИ' : 'СОЗДАТЬ АККАУНТ'; }
      if(msg){
        msg.className = 'authMsg err';
        msg.textContent = (res && res.error) || 'Не удалось выполнить вход';
      }
    }
  }

  _captureBind(e){
    if(!this.rebindAction) return;
    if(e.code === 'Escape'){ this.rebindAction = null; this.render(); return; }
    if(['ShiftLeft','ShiftRight','ControlLeft','ControlRight','AltLeft','AltRight','MetaLeft','MetaRight'].includes(e.code)){
      e.preventDefault(); e.stopImmediatePropagation(); return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    const st = getState();
    const binds = { ...DEFAULT_BINDS, ...(st.settings.keybinds || {}) };
    for(const k of Object.keys(binds)){
      if(k !== this.rebindAction && binds[k] === e.code) binds[k] = '';
    }
    binds[this.rebindAction] = e.code;
    st.settings.keybinds = binds;
    saveState();
    this.rebindAction = null;
    if(this.opts.onSettingsChanged) this.opts.onSettingsChanged(st.settings);
    this.render();
  }

  _filterInventory(){
    const q = (this.invSearch || '').trim().toLowerCase();
    const r = this.invRarity || 'all';
    this.root.querySelectorAll('[data-search]').forEach(el=>{
      const matchQ = !q || (el.dataset.search || '').includes(q);
      const matchR = r === 'all' || el.dataset.rarity === r;
      el.classList.toggle('invHidden', !(matchQ && matchR));
    });
  }
  _sortInventory(){
    const grid = this.root.querySelector('.invGrid');
    if(!grid) return;
    const cards = [...grid.children];
    const rank = id => RARITY_ORDER.indexOf(id);
    cards.sort((a,b)=>{
      if(this.invSort === 'name') return (a.dataset.search||'').localeCompare(b.dataset.search||'');
      if(this.invSort === 'weapon') return (a.dataset.weapon||'').localeCompare(b.dataset.weapon||'') || (a.dataset.search||'').localeCompare(b.dataset.search||'');
      return rank(b.dataset.rarity) - rank(a.dataset.rarity);
    });
    for(const c of cards) grid.appendChild(c);
  }

  _openCase(crateId){
    if(this.caseBusy) return;
    const crate = crateById(crateId);
    if(!crate) return;
    const st = getState();
    const freeFirst = crate.id === 'starter' && (st.profile.casesOpened || 0) === 0;
    const price = freeFirst ? 0 : crate.price;
    if(price > 0 && !spendCrateTokens(price)){
      audio.error ? audio.error() : audio.click();
      this.render();
      return;
    }
    const winner = openCrate(crateId);
    if(!winner){ this.render(); return; }
    this.caseBusy = true;
    const granted = recordCaseOpen(crateId, winner.id, winner.rarity);
    this.lastCaseResult = winner;
    const reel = buildReel(crateId, winner.id, 42);
    const rc = winner.rarityInfo;
    const overlay = document.createElement('div');
    overlay.className = 'caseOverlay';
    overlay.innerHTML = `
      <div class="caseModal" style="--acc:${rc.color}">
        <div class="caseModalHead"><div><span>${esc(crate.name)}</span><b>ОТКРЫТИЕ КЕЙСА</b></div><button class="previewClose" id="caseClose">✕</button></div>
        <div class="caseReelWrap"><div class="caseReelPointer"></div><div class="caseReel" id="caseReel">
          ${reel.items.map((it,i)=>`<div class="reelItem ${i===reel.index?'win':''}" style="--rc:${it.rarityInfo.color}">
            <span class="reelRarity">${it.rarityInfo.short}</span>
            ${weaponArt(it.weaponId,it.id)}
            <b>${esc(it.weaponName)}</b><small>${esc(it.name.split('|')[1]||it.name)}</small>
          </div>`).join('')}
        </div></div>
        <button class="miniBtn" id="caseSkip">ПРОПУСТИТЬ</button><div class="caseResult hidden" id="caseResult">
          <div class="caseResultArt" style="--rc:${rc.color};--c1:${winner.body||'#333'};--c2:${winner.accent||'#888'}">${weaponArt(winner.weaponId,winner.id)}</div>
          <div class="caseResultInfo">
            <span>ВЫПАЛ ПРЕДМЕТ${granted.duplicate?' · ДУБЛИКАТ':''}</span>
            <h3>${esc(winner.name)}</h3>
            <p>${rc.name} · ${esc(crate.name)}${granted.duplicate?' · уже был в инвентаре':''}</p>
          </div>
          <div class="caseResultBtns">
            <button class="miniBtn" data-spreview="${winner.id}">ОСМОТРЕТЬ 3D</button>
            <button class="miniBtn accent" id="caseEquip">ПРИМЕНИТЬ</button><button class="miniBtn ghost" id="caseAgain">ЕЩЁ РАЗ</button>
            <button class="miniBtn accent" id="caseDone">В ИНВЕНТАРЬ</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    let timer, frame, closed=false, finished=false;
    const reelEl=overlay.querySelector('#caseReel');
    const center=()=>{const wrap=overlay.querySelector('.caseReelWrap'),item=reelEl.children[reel.index];return wrap.clientWidth/2-item.offsetLeft-item.offsetWidth/2;};
    const close=()=>{closed=true;clearTimeout(timer);cancelAnimationFrame(frame);window.removeEventListener('resize',resize);overlay.remove();this.caseBusy=false;this.render();};
    const reveal=()=>{
      if(closed||finished)return;finished=true;clearTimeout(timer);
      reelEl.style.transition='none';reelEl.style.transform=`translateX(${center()}px)`;
      overlay.querySelector('#caseResult').classList.remove('hidden');overlay.querySelector('#caseSkip').classList.add('hidden');
      overlay.querySelector('#caseAgain').onclick=()=>{close();this._openCase(crateId);};
      overlay.querySelector('#caseDone').onclick=()=>{this.screen='inventory';this.invTab='skins';close();};
      overlay.querySelector('#caseEquip').onclick=e=>{equipSkin(winner.weaponId,winner.id);e.target.textContent='ПРИМЕНЕНО';e.target.disabled=true;this._setShowcaseGun(winner.weaponId);};
      overlay.querySelector('[data-spreview]').onclick=()=>this.preview.showWeapon(winner.weaponId,winner.id,{rarityInfo:rc,info:winner.name});audio.pickup?.();
    };
    const resize=()=>{if(finished)reelEl.style.transform=`translateX(${center()}px)`;else reveal();};
    window.addEventListener('resize',resize);overlay.querySelector('#caseClose').onclick=close;overlay.querySelector('#caseSkip').onclick=reveal;
    frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{if(closed||finished)return;reelEl.style.transition='transform 4.2s cubic-bezier(.08,.65,.12,1)';reelEl.style.transform=`translateX(${center()}px)`;timer=setTimeout(reveal,4250);});});
  }

  _initTouchEditor(){
    const pv = this.root.querySelector('#touchPreview');
    if(!pv) return;
    const layout = this._touchLayout();
    const btns = [...pv.querySelectorAll('.tpBtn')];
    const persist = () => {
      getState().settings.touchLayoutData = layout;
      saveState();
    };
    const select = (id) => {
      this.touchSelected = id;
      btns.forEach(b=>b.classList.toggle('sel', b.dataset.tid === id));
      const meta = this._touchMeta().find(m=>m.id===id);
      const sz = this.root.querySelector('#ctlSize');
      if(sz){ sz.value = String(layout[id].s); }
      const sv = this.root.querySelector('#ctlSizeVal');
      if(sv) sv.textContent = Math.round(layout[id].s*100)+'%';
      const lbl = this.root.querySelector('.controlsPanel .setRow b');
      const mm = this._touchMeta().find(m=>m.id===id);
      if(lbl && mm) lbl.textContent = mm.label;
    };
    btns.forEach(b=>{
      let drag = null;
      b.addEventListener('pointerdown', e=>{
        e.preventDefault();
        select(b.dataset.tid);
        drag = { id:b.dataset.tid, move:false };
        if(b.setPointerCapture){ try{ b.setPointerCapture(e.pointerId); }catch(err){} }
      });
      b.addEventListener('pointermove', e=>{
        if(!drag) return;
        const r = pv.getBoundingClientRect();
        const x = Math.max(0.05, Math.min(0.95, (e.clientX - r.left) / r.width));
        const y = Math.max(0.07, Math.min(0.94, (e.clientY - r.top) / r.height));
        layout[drag.id].x = Math.round(x*1000)/1000;
        layout[drag.id].y = Math.round(y*1000)/1000;
        b.style.left = (layout[drag.id].x*100)+'%';
        b.style.top = (layout[drag.id].y*100)+'%';
        drag.move = true;
        persist();
      });
      const end = ()=>{
        if(drag && drag.move){ audio.click(); }
        drag = null;
      };
      b.addEventListener('pointerup', end);
      b.addEventListener('pointercancel', end);
      b.addEventListener('pointerleave', ()=>{ if(drag) drag = null; });
    });
    const size = this.root.querySelector('#ctlSize');
    if(size) size.oninput = ()=>{
      const id = this.touchSelected;
      layout[id].s = parseFloat(size.value) || 1;
      const el = pv.querySelector(`[data-tid="${id}"]`);
      if(el) el.style.setProperty('--s', layout[id].s);
      const sv = this.root.querySelector('#ctlSizeVal');
      if(sv) sv.textContent = Math.round(layout[id].s*100)+'%';
      persist();
    };
    const opacity = this.root.querySelector('#ctlOpacity');
    if(opacity) opacity.oninput = ()=>{
      getState().settings.touchOpacity = parseFloat(opacity.value);
      const v = this.root.querySelector('#ctlOpacityVal');
      if(v) v.textContent = Math.round(parseFloat(opacity.value)*100)+'%';
      pv.style.setProperty('--op', getState().settings.touchOpacity);
      saveState();
    };
    const sens = this.root.querySelector('#ctlSens');
    if(sens) sens.oninput = ()=>{
      getState().settings.sensitivity = parseFloat(sens.value);
      const v = this.root.querySelector('#ctlSensVal');
      if(v) v.textContent = getState().settings.sensitivity.toFixed(2);
      saveState();
    };
    const aim = this.root.querySelector('#ctlAimSens');
    if(aim) aim.oninput = ()=>{
      getState().settings.aimSensitivity = parseFloat(aim.value);
      const v = this.root.querySelector('#ctlAimVal');
      if(v) v.textContent = Math.round(getState().settings.aimSensitivity*100)+'%';
      saveState();
    };
    const accel = this.root.querySelector('#ctlAccel');
    if(accel) accel.onchange = ()=>{
      getState().settings.cameraAcceleration = accel.value === '1';
      saveState();
    };
    const reset = this.root.querySelector('#ctlReset');
    if(reset) reset.onclick = ()=>{
      getState().settings.touchLayoutData = null;
      saveState();
      this.render();
    };
    const done = this.root.querySelector('#ctlClose');
    if(done) done.onclick = ()=>this.go('settings');
  }

  _wire(){
    this.root.querySelectorAll('[data-avatar]').forEach(el=>el.onclick=()=>{getState().profile.avatar=el.dataset.avatar;saveState();this.render();});
    this.root.querySelectorAll('[data-go]').forEach(el=>{
      el.onclick = ()=>this.go(el.dataset.go);
    });
    this.root.querySelectorAll('[data-mode]').forEach(el=>{
      el.onclick = ()=>{ this.config.mode = el.dataset.mode; audio.click(); this.render(); };
    });
    this.root.querySelectorAll('[data-map]').forEach(el=>{
      el.onclick = ()=>{
        const raw = el.dataset.map;
        if(raw.indexOf('custom:') === 0){
          const id = raw.slice(7);
          const found = (this.customMaps || []).find(m=>String(m.id) === String(id));
          if(found){
            this.config.map = 'custom';
            this.config.customMap = JSON.parse(JSON.stringify(found));
          }
        } else {
          this.config.map = raw;
          this.config.customMap = null;
        }
        audio.click(); this.render();
      };
    });
    this.root.querySelectorAll('[data-private]').forEach(el=>{
      el.onclick = ()=>{ this.config.privateMatch = !this.config.privateMatch; audio.click(); this.render(); };
    });
    this.root.querySelectorAll('[data-team]').forEach(el=>{
      el.onclick = ()=>{ this.config.team = el.dataset.team; audio.click(); this.render(); };
    });
    this.root.querySelectorAll('[data-diff]').forEach(el=>{
      el.onclick = ()=>{ this.config.difficulty = el.dataset.diff; audio.click(); this.render(); };
    });
    this.root.querySelectorAll('[data-agent]').forEach(el=>{
      el.onclick = ()=>{
        selectAgent(el.dataset.agentteam, el.dataset.agent);
        this._buildSceneChars();
        audio.pickup(); this.render();
      };
    });
    this.root.querySelectorAll('[data-teamsize]').forEach(el=>{
      el.onclick = ()=>{ this.config.teamSize = parseInt(el.dataset.teamsize,10); audio.click(); this.render(); };
    });
    this.root.querySelectorAll('[data-rounds]').forEach(el=>{
      el.onclick = ()=>{ this.config.roundsToWin = parseInt(el.dataset.rounds,10); audio.click(); this.render(); };
    });
    this.root.querySelectorAll('[data-minutes]').forEach(el=>{
      el.onclick = ()=>{ this.config.matchMinutes = parseInt(el.dataset.minutes,10); audio.click(); this.render(); };
    });
    const start = this.root.querySelector('#startMatch');
    if(start) start.onclick = ()=>{
      audio.click();
      const st = getState();
      st.lastMatch = { ...st.lastMatch, ...this.config };
      st.settings.botDifficulty = this.config.difficulty;
      saveState();
      const out = { ...this.config };
      if(out.map !== 'custom') out.customMap = null;
      if(this.opts.onStart) this.opts.onStart(out);
    };

    this.root.querySelectorAll('[data-acat]').forEach(el=>{
      el.onclick = ()=>{ this.arsenalCat = el.dataset.acat; audio.click(); this.render(); };
    });
    this.root.querySelectorAll('[data-equip]').forEach(el=>{
      el.onclick = ()=>{
        const wid = el.dataset.equip, skin = el.dataset.skin;
        equipSkin(wid, skin);
        this._setShowcaseGun(wid);
        audio.pickup();
        this.render();
      };
    });

    this.root.querySelectorAll('[data-set]').forEach(el=>{
      const key = el.dataset.set;
      const apply = ()=>{
        const s = getState().settings;
        if(key.indexOf('cheats.') === 0){
          s.cheats = s.cheats || {};
          s.cheats[key.slice(7)] = el.checked;
        } else if(el.type === 'checkbox') s[key] = el.checked;
        else if(el.type === 'range') s[key] = parseFloat(el.value);
        else if(el.type === 'color') s[key] = el.value;
        else s[key] = el.value;
        if(key === 'volume') audio.setVolume(s.volume);
        saveState();
        if(this.opts.onSettingsChanged) this.opts.onSettingsChanged(s);
        this.render();
      };
      el.onchange = apply;
      if(el.type === 'range'){
        el.oninput = ()=>{
          const b = el.parentElement.querySelector('b');
          if(b && key.indexOf('cheats.') !== 0){
            if(['volume','renderScale','resolutionScale','hudScale','brightness','crosshairOpacity'].includes(key)) b.textContent = Math.round(parseFloat(el.value)*100)+'%';
            else if(key==='viewDistance') b.textContent = el.value+' м';
            else if(key==='fov') b.textContent = el.value+'°';
            else if(key==='sensitivity' || key==='gamepadSensitivity') b.textContent = parseFloat(el.value).toFixed(2);
            else if(key==='gamepadDeadzone') b.textContent = Math.round(parseFloat(el.value)*100)+'%';
            else b.textContent = el.value;
          }
        };
      }
    });

    this.root.querySelectorAll('[data-bind]').forEach(el=>{
      el.onclick = ()=>{ this.rebindAction = el.dataset.bind; audio.click(); this.render(); };
    });
    const resetBinds = this.root.querySelector('#resetBinds');
    if(resetBinds) resetBinds.onclick = ()=>{
      getState().settings.keybinds = { ...DEFAULT_BINDS };
      saveState();
      audio.click();
      if(this.opts.onSettingsChanged) this.opts.onSettingsChanged(getState().settings);
      this.render();
    };
    const unlock = this.root.querySelector('#unlockMod');
    if(unlock) unlock.onclick = ()=>{
      const input = this.root.querySelector('#modCode');
      const msg = this.root.querySelector('#modMsg');
      const code = (input ? input.value : '').replace(/\D/g,'');
      audio.click();
      if(code === '675242'){
        getState().settings.modUnlocked = true;
        saveState();
        this.render();
      } else if(msg){
        msg.className = 'modMsg err';
        msg.textContent = 'НЕВЕРНЫЙ КОД ДОСТУПА';
      }
    };
    const lockMod = this.root.querySelector('#lockMod');
    if(lockMod) lockMod.onclick = ()=>{
      getState().settings.modUnlocked = false;
      saveState();
      audio.click();
      this.render();
    };

    this.root.querySelectorAll('[data-etool]').forEach(el=>{
      el.onclick = ()=>{ this.editor.tool = el.dataset.etool; audio.click(); this.render(); };
    });
    const eBrush = this.root.querySelector('#editorBrush');
    if(eBrush) eBrush.onchange = ()=>{ this.editor.brush = parseInt(eBrush.value,10) || 1; };
    const eTheme = this.root.querySelector('#editorTheme');
    if(eTheme) eTheme.onchange = ()=>{ this.editor.theme = eTheme.value; this.render(); };
    const eLight = this.root.querySelector('#editorLight');
    if(eLight) eLight.onchange = ()=>{ this.editor.light = eLight.value; this.render(); };
    const eName = this.root.querySelector('#editorName');
    if(eName) eName.oninput = ()=>{ this.editor.name = eName.value.trim().slice(0,26) || 'Моя арена'; };
    const eNew = this.root.querySelector('#editorNew');
    if(eNew) eNew.onclick = ()=>{ this.editor = this._newEditor(); audio.click(); this.render(); };
    const eSave = this.root.querySelector('#editorSave');
    if(eSave) eSave.onclick = ()=>{ this._saveEditor(); audio.click(); this.render(); };
    const eDelete = this.root.querySelector('#editorDelete');
    if(eDelete) eDelete.onclick = ()=>{
      if(this.editor.editId){
        this.customMaps = (this.customMaps || []).filter(m=>String(m.id) !== String(this.editor.editId));
        this._saveCustomMaps();
        this.editor = this._newEditor();
      }
      audio.click(); this.render();
    };
    const eLoad = this.root.querySelector('#editorLoad');
    if(eLoad) eLoad.onchange = ()=>{
      const found = (this.customMaps || []).find(m=>String(m.id) === String(eLoad.value));
      if(found){
        const data = JSON.parse(JSON.stringify(found));
        this.editor = Object.assign(this._newEditor(), data, {
          tool:this.editor.tool, brush:this.editor.brush, editId:data.id,
          grid:data.grid.map(row=>row.slice()), sites:data.sites.map(s=>({...s})),
          spawns:{ CT:(data.spawns?.CT||[]).map(s=>({...s})), T:(data.spawns?.T||[]).map(s=>({...s})) }
        });
        audio.click(); this.render();
      }
    };
    const ePlay = this.root.querySelector('#editorPlay');
    if(ePlay) ePlay.onclick = ()=>{
      audio.click();
      this._saveEditor(true);
      const data = (this.customMaps || []).find(m=>String(m.id) === String(this.editor.editId));
      if(!data) return;
      this.config.map = 'custom';
      this.config.customMap = JSON.parse(JSON.stringify(data));
      const st = getState();
      st.lastMatch = { ...st.lastMatch, ...this.config };
      saveState();
      if(this.opts.onStart) this.opts.onStart({ ...this.config });
    };
    if(this.screen === 'editor') this._initEditorCanvas();

    this.root.querySelectorAll('[data-auth]').forEach(el=>{
      el.onclick = ()=>this._doAuth(el.dataset.auth);
    });
    const accLogout = this.root.querySelector('#accLogout');
    if(accLogout) accLogout.onclick = ()=>{
      authLogout();
      audio.click();
      this.render();
    };
    const accRename = this.root.querySelector('#accRename');
    if(accRename) accRename.onclick = ()=>{
      const v = this.root.querySelector('#accNameInput').value;
      const res = renameAccount(v);
      const msg = this.root.querySelector('#authMsg');
      audio.click();
      if(res.ok) this.render();
      else if(msg){ msg.className='authMsg err'; msg.textContent=res.error; }
    };

    this.root.querySelectorAll('[data-invtab]').forEach(el=>{
      el.onclick = ()=>{ this.invTab = el.dataset.invtab; audio.click(); this.render(); };
    });
    this.root.querySelectorAll('[data-wpreview]').forEach(el=>{
      el.onclick = (e)=>{
        e.preventDefault(); e.stopPropagation();
        const id = el.dataset.wpreview;
        this.preview.showWeapon(id, equippedSkin(id), { title: WEAPONS[id].name + ' | ' + getSkin(id, equippedSkin(id)).name });
      };
    });
    this.root.querySelectorAll('[data-spreview]').forEach(el=>{
      el.onclick = (e)=>{
        e.preventDefault(); e.stopPropagation();
        const skinId = el.dataset.spreview;
        const wid = skinId.split(':')[0];
        const sk = getSkin(wid, skinId);
        this.preview.showWeapon(wid, skinId, { title: sk.weaponName + ' | ' + sk.name, rarityInfo: sk.rarityInfo, info: `${sk.weaponName} · ${sk.rarityInfo.name} · ${sk.styleKey}` });
      };
    });
    this.root.querySelectorAll('[data-apreview]').forEach(el=>{
      el.onclick = (e)=>{
        e.preventDefault(); e.stopPropagation();
        const [team, id] = el.dataset.apreview.split(':');
        this.preview.showAgent(team, id);
      };
    });
    this.root.querySelectorAll('[data-invweapon]').forEach(el=>{
      el.onclick = (e)=>{
        e.stopPropagation();
        this.screen = 'inventory';
        this.invTab = 'skins';
        this.invSearch = WEAPONS[el.dataset.invweapon] ? WEAPONS[el.dataset.invweapon].name : '';
        audio.click(); this.render();
      };
    });
    this.root.querySelectorAll('[data-unequip]').forEach(el=>{
      el.onclick = (e)=>{
        e.stopPropagation();
        unequipSkin(el.dataset.unequip);
        audio.click(); this.render();
      };
    });
    const invSearch = this.root.querySelector('#invSearch');
    if(invSearch){
      invSearch.oninput = ()=>{
        this.invSearch = invSearch.value;
        this._filterInventory();
      };
    }
    const invRarity = this.root.querySelector('#invRarity');
    if(invRarity) invRarity.onchange = ()=>{ this.invRarity = invRarity.value; this._filterInventory(); };
    const invSort = this.root.querySelector('#invSort');
    if(invSort) invSort.onchange = ()=>{ this.invSort = invSort.value; this._sortInventory(); };
    this.root.querySelectorAll('[data-case]').forEach(el=>{
      el.onclick = (e)=>{
        e.stopPropagation();
        this._openCase(el.dataset.case);
      };
    });
    const daily = this.root.querySelector('#dailyCase');
    if(daily) daily.onclick = ()=>{
      const today = new Date().toISOString().slice(0,10);
      if(claimDaily(today)){ audio.pickup && audio.pickup(); this.render(); }
    };
    if(this.screen === 'controls') this._initTouchEditor();

    const saveName = this.root.querySelector('#saveName');
    if(saveName) saveName.onclick = ()=>{
      const v = this.root.querySelector('#nameInput').value.trim().slice(0,14) || 'PLAYER';
      if(currentSession()) renameAccount(v);
      else { getState().profile.name = v; saveState(); }
      audio.click(); this.render();
    };
    const reset = this.root.querySelector('#resetProgress');
    if(reset) reset.onclick = ()=>{
      if(confirm('Сбросить весь прогресс?')){ resetState(); this.render(); }
    };
  }
}

function freshNum(v, fallback){ return Number.isFinite(v) ? Math.max(0.05, Math.min(0.96, v)) : fallback; }

function esc(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
