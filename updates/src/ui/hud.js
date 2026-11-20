import { weaponArt } from './art.js';
// In-match HUD: vitals, ammo, timer, score, minimap, killfeed, buy menu, scoreboard.
import { BUY_CATEGORIES, WEAPONS, GRENADES, GEAR } from '../data/weapons.js';
import { formatTime } from '../core/utils.js';
import { getState } from '../core/state.js';
import { getAgent } from '../data/agents.js';
import * as THREE from '../../vendor/three.module.js';

export class HUD {
  constructor(){
    this.root = document.getElementById('gameHud');
    this.buyOpen = false;
    this.scoreboardOpen = false;
    this._build();
    this._lastKillCount = 0;
    this._cache = {};
  }

  _build(){
    this.root.innerHTML = `
      <div id="matchActions"><button id="pauseMatch" aria-label="Пауза">Ⅱ</button><button id="rosterMatch">СЧЁТ</button><button id="modsMatch">MOD</button></div>
      <div id="hudTop">
        <div id="scoreBar">
          <div class="teamScore ct"><span class="tn" id="scoreCTLabel">СПЕЦНАЗ</span><b id="scoreCT">0</b></div>
          <div id="roundBox"><div id="roundTimer">1:55</div><div id="roundPhase">РАЗМИНКА</div></div>
          <div class="teamScore t"><b id="scoreT">0</b><span class="tn" id="scoreTLabel">ТЕРРОРИСТЫ</span></div>
        </div>
      </div>

      <div id="hudTopRight">
        <canvas id="minimap" width="170" height="170"></canvas>
        <div id="allyList"></div>
        <div id="killfeed"></div>
      </div>

      <div id="hudBottomLeft">
        <div id="vitals">
          <div class="vrow"><span class="vicon hp">+</span><div class="vbar"><div id="hpFill"></div></div><b id="hpText">100</b></div>
          <div class="vrow"><span class="vicon ar">◈</span><div class="vbar"><div id="armorFill"></div></div><b id="armorText">0</b></div>
        </div>
        <div id="moneyBox">$<span id="moneyText">800</span></div>
        <div id="agentBadge"></div>
      </div>

      <div id="hudBottomRight">
        <div id="grenadeRow"></div>
        <div id="weaponName">НОЖ</div>
        <div id="ammoBox"><span id="ammoMag">∞</span><small id="ammoRes"></small></div>
      </div>

      <div id="espLayer"></div>
      <div id="crosshair"></div>
      <div id="damageNumber"></div><div id="hitmarker"><i></i><i></i><i></i><i></i></div>
      <div id="damageDirs"></div>

      <div id="centerMsg"></div>
      <div id="matchInfo"></div>
      <div id="hintText"></div>
      <div id="teamStatus"></div>

      <div id="flashOverlay"></div>
      <div id="damageOverlay"></div>
      <div id="scopeOverlay"></div>
      <div id="deathOverlay"><div class="deadTitle">ВЫ ПОГИБЛИ</div><div class="deadSub"></div></div>

      <div id="scoreboard" class="panel hidden"></div>
      <div id="buyMenu" class="panel hidden"></div>

      <div id="touchControls" class="hidden">
        <div id="joy"><div id="knob"></div></div>
        <div id="tbtns">
          <div class="tbtn fire" id="tFireLeft" aria-label="Левый огонь">◎</div>
          <div class="tbtn fire" id="tFire">◎<small>ОГОНЬ</small></div>
          <div class="tbtn" id="tAim">⊕</div>
          <div class="tbtn" id="tJump">↑</div>
          <div class="tbtn" id="tCrouch">↓</div>
          <div class="tbtn sm" id="tReload">↻</div>
          <div class="tbtn sm" id="tSwitch">⇄</div>
          <div class="tbtn sm" id="tInspect">ОСМОТР</div>
          <div class="tbtn sm use" id="tUse">E</div>
          <div class="tbtn sm buy" id="tBuy">МАГАЗИН</div>
        </div>
      </div>

      <div id="fps"></div>
      <div id="debugInfo"></div>
      <div id="spectateInfo"></div>
    `;
    this.el = id => this.root.querySelector('#'+id);
    this.crosshair = this.el('crosshair');
    this.minimap = this.el('minimap');
    this.espLayer = this.el('espLayer');
    this._espAccum = 0;
    this._espSnap = {};
    this.mmCtx = this.minimap.getContext('2d');
    this.buyMenu = this.el('buyMenu');
    this.scoreboard = this.el('scoreboard');
    this._buildCrosshair();
    this._applyTouchSettings();
    this.showTouch(getState().settings.touchControls && ('ontouchstart' in window));
  }

  _buildCrosshair(){
    const st = getState().settings;
    const color = st.crosshairColor || '#7dff9a';
    const thick = Math.max(1, Math.min(5, st.crosshairThickness ?? 2));
    const len = Math.max(2, Math.min(18, st.crosshairSize ?? 6));
    const opacity = Math.max(0.15, Math.min(1, st.crosshairOpacity ?? 0.92));
    const outline = st.crosshairOutline !== false;
    this.crossGap = Math.max(0, Math.min(16, st.crosshairGap ?? 4));
    this.crossLen = len;
    this.crossThick = thick;
    this.crossOpacity = opacity;
    this.crossDynamic = st.crosshairDynamic !== false;
    this.crosshair.style.display = st.crosshairEnabled === false ? 'none' : 'block';
    this.crosshair.style.setProperty('--chColor', color);
    this.crosshair.style.setProperty('--chThick', thick + 'px');
    this.crosshair.style.setProperty('--chLen', len + 'px');
    this.crosshair.style.setProperty('--chOpacity', String(opacity));
    this.crosshair.style.setProperty('--chShadow', outline
      ? '0 0 0 1px rgba(0,0,0,.72), 0 0 4px rgba(0,0,0,.55)'
      : '0 0 2px rgba(0,0,0,.35)');
    this.crosshair.innerHTML = `
      <div class="ch h chTop"></div>
      <div class="ch h chBottom"></div>
      <div class="ch v chLeft"></div>
      <div class="ch v chRight"></div>
      <div class="ch dot"></div>`;
    this.chParts = this.crosshair.querySelectorAll('.ch');
    this.chTop = this.crosshair.querySelector('.chTop');
    this.chBottom = this.crosshair.querySelector('.chBottom');
    this.chLeft = this.crosshair.querySelector('.chLeft');
    this.chRight = this.crosshair.querySelector('.chRight');
    this.chDot = this.crosshair.querySelector('.ch.dot');
    if(this.chDot) this.chDot.style.display = st.crosshairDot ? 'block' : 'none';
  }

  showTouch(v){ this.el('touchControls').classList.toggle('hidden', !v); }

  refreshSettings(){
    this._buildCrosshair();
    this._applyTouchSettings();
    this.showTouch(getState().settings.touchControls && ('ontouchstart' in window));
  }

  _applyTouchSettings(){
    const s = getState().settings;
    const tc = this.el('touchControls');
    if(!tc) return;
    tc.style.setProperty('--tScale', String(s.touchScale ?? 1));
    tc.style.setProperty('--tOpacity', String(s.touchOpacity ?? 0.82));
    tc.classList.toggle('left', !!s.touchLeftHanded);
    tc.classList.toggle('compact', s.touchLayout === 'compact');
    const defaults = {joy:{x:.13,y:.70,s:.85},tFire:{x:.86,y:.62,s:1},tFireLeft:{x:.11,y:.34,s:.7},tAim:{x:.75,y:.43,s:1},tJump:{x:.94,y:.43,s:1},tCrouch:{x:.94,y:.78,s:1},tReload:{x:.75,y:.79,s:1},tSwitch:{x:.63,y:.85,s:1},tInspect:{x:.47,y:.90,s:.85},tUse:{x:.60,y:.66,s:1},tBuy:{x:.34,y:.90,s:1}};
    const data = {...defaults,...(s.touchLayoutData || {})};
    tc.classList.toggle('custom', !!data);
    if(data){
      const base = { tFire:92, joy:130 };
      for(const [id, d] of Object.entries(data)){
        if(!d) continue;
        if(id === 'joy'){
          tc.style.setProperty('--joySize', (130 * (d.s || 1)).toFixed(0) + 'px');
          tc.style.setProperty('--jx', ((s.touchLeftHanded ? 1-(d.x ?? 0.14) : (d.x ?? 0.14)) * 100).toFixed(1) + '%');
          tc.style.setProperty('--jy', ((d.y ?? 0.78) * 100).toFixed(1) + '%');
          continue;
        }
        const el = this.el(id);
        if(!el) continue;
        const px = (base[id] || 52) * (d.s || 1) * (s.touchScale || 1);
        el.style.setProperty('--btnSize', px.toFixed(0) + 'px');
        el.style.setProperty('--bx', ((s.touchLeftHanded ? 1-(d.x ?? 0.5) : (d.x ?? 0.5)) * 100).toFixed(1) + '%');
        el.style.setProperty('--by', ((d.y ?? 0.5) * 100).toFixed(1) + '%');
      }
    }
  }

  setVisible(v){ this.root.classList.toggle('hidden', !v); }

  resetGame(){
    this._cache = {};
    const dd = this.el('damageDirs'); if(dd) dd.innerHTML = '';
    this.closeBuy();
    this.scoreboardOpen = false;
    this.scoreboard.classList.add('hidden');
    const kf = this.el('killfeed'); if(kf) kf.innerHTML = '';
    if(this.espLayer) this.espLayer.innerHTML = '';
    this.el('deathOverlay').classList.remove('show');
    this.el('centerMsg').classList.remove('show');
    this.el('flashOverlay').style.opacity = 0;
    this.el('damageOverlay').style.opacity = 0;
    this.el('scopeOverlay').style.opacity = 0;
    this.el('hitmarker').classList.remove('show','kill','head');
    this._hitT = 0;
    this._dmg = 0;
  }

  // ------------- per-frame -------------
  _txt(id, value){
    const key = 't:'+id;
    if(this._cache[key] === value) return;
    this._cache[key] = value;
    const el = this.el(id);
    if(el) el.textContent = value;
  }
  _html(id, value){
    const key = 'h:'+id;
    if(this._cache[key] === value) return;
    this._cache[key] = value;
    const el = this.el(id);
    if(el) el.innerHTML = value;
  }

  _cheatToast(st){
    const c = st.settings.cheats || {};
    const labels = { fly:'ПОЛЁТ', noclip:'NOCLIP', infiniteAmmo:'ПАТРОНЫ', esp:'WALL VISION', wallbang:'ПРОСТРЕЛ', aimbot:'АВТОНАВОДКА', god:'БЕССМЕРТИЕ', infiniteMoney:'ДЕНЬГИ', speed:'УСКОРЕНИЕ', freeCam:'СВОБОДНАЯ КАМЕРА', debugInfo:'DEBUG' };
    if(!this._cheatPrev){
      this._cheatPrev = { ...c };
      return;
    }
    for(const k in labels){
      if(!!c[k] !== !!this._cheatPrev[k]) this.message('ЧИТ ' + (c[k] ? 'ВКЛ' : 'ВЫКЛ'), labels[k], 1100);
    }
    this._cheatPrev = { ...c };
  }

  update(match, fps){
    const p = match.player;
    const st = getState();
    this._cheatToast(st);
    const hp = Math.max(0, Math.ceil(p.health));
    const armor = Math.max(0, Math.ceil(p.armor));
    this._txt('hpText', String(hp));
    this._txt('armorText', armor + (p.helmet ? ' ⛑' : ''));
    const hpW = Math.max(0, p.health) + '%';
    if(this._cache.hpW !== hpW){ this._cache.hpW = hpW; this.el('hpFill').style.width = hpW; }
    const arW = Math.min(100, p.armor) + '%';
    if(this._cache.arW !== arW){ this._cache.arW = arW; this.el('armorFill').style.width = arW; }
    this._txt('moneyText', String(p.money));
    if(p.agentId){
      const a = getAgent(p.team, p.agentId);
      this._html('agentBadge', `<b>${a.name}</b><span>${a.role}</span>`);
    } else this._html('agentBadge', '');

    const w = p.getActiveWeapon();
    if(w && w.id === 'grenade'){
      const g = GRENADES[w.grenade];
      this._txt('weaponName', g ? g.name : 'ГРАНАТА');
      this._txt('ammoMag', String(p.grenades[w.grenade] || 0));
      this._txt('ammoRes', '');
    } else if(w && w.def){
      this._txt('weaponName', w.def.name);
      if(w.id === 'knife'){ this._txt('ammoMag', '∞'); this._txt('ammoRes', ''); }
      else {
        this._txt('ammoMag', String(w.ammo));
        this._txt('ammoRes', '/ ' + w.reserve);
      }
    } else {
      this._txt('weaponName', 'НЕТ ОРУЖИЯ');
      this._txt('ammoMag', '-');
      this._txt('ammoRes', '');
    }

    // grenades (only rebuild when the inventory selection changes)
    const gr = p.grenades;
    const grenHtml = ['he','flash','smoke','molotov']
      .filter(k => gr[k] > 0)
      .map(k => `<span class="gren ${p.currentGrenade===k&&p.currentSlot===4?'active':''}">${GRENADES[k].icon}${gr[k]}</span>`)
      .join('');
    this._html('grenadeRow', grenHtml);

    // scores (FFA modes rank the player against the best bot, not teams)
    if(match.ffa){
      const topBot = match.bots.reduce((m,b)=>Math.max(m, b.kills||0), 0);
      this._txt('scoreCT', String(p.kills||0));
      this._txt('scoreT', String(topBot));
      this._txt('scoreCTLabel', 'ВЫ');
      this._txt('scoreTLabel', 'ЛИДЕР БОТОВ');
    } else {
      this._txt('scoreCT', String(match.score.CT));
      this._txt('scoreT', String(match.score.T));
      this._txt('scoreCTLabel', 'СПЕЦНАЗ');
      this._txt('scoreTLabel', 'ТЕРРОРИСТЫ');
    }
    this._txt('roundTimer', formatTime(match.clock));
    this._txt('roundPhase', match.phaseLabel());
    const urgent = match.clock <= 10 && match.phase === 'live';
    if(this._cache.urgent !== urgent){ this._cache.urgent = urgent; this.el('roundBox').classList.toggle('urgent', urgent); }

    const mapName = match.level.map.info ? match.level.map.info.name : '';
    this._txt('matchInfo', `${match.modeLabel()} · ${mapName} · ${match.difficultyLabel()}`);

    // team alive counts (FFA shows player kills + living bots instead)
    if(match.ffa){
      this._html('teamStatus', `<span class="ctdot"></span>${p.kills||0} УБИЙСТВ &nbsp; <span class="tdot"></span>${match.bots.filter(b=>b.alive).length} ЖИВЫХ`);
    } else {
      const aliveCT = match.aliveCount('CT'), aliveT = match.aliveCount('T');
      this._html('teamStatus', `<span class="ctdot"></span>${aliveCT} &nbsp; <span class="tdot"></span>${aliveT}`);
    }

    // squad markers: real names, agent and health of every teammate
    if(!match.ffa){
      const allies = match.bots.filter(b=>b.team === p.team);
      const allyHtml = allies.map(b=>{
        const a = getAgent(b.team, b.agentId);
        const hp = b.alive ? Math.max(0, Math.ceil(b.health)) : 0;
        return `<div class="allyRow ${b.alive?'':'dead'}">
          <span class="allyDot" style="background:${b.team==='CT'?'#4fa3ff':'#ffb03a'}"></span>
          <span class="allyName">${a.name}</span>
          <span class="allyHp"><i style="width:${hp}%"></i></span>
          <b>${b.alive?hp:'✕'}</b>
        </div>`;
      }).join('');
      this._html('allyList', allyHtml);
    } else {
      this._html('allyList', '');
    }

    // contextual hint
    let hint = '';
    if(!p.alive) hint = match.playerRespawnTimer > 0 ? 'Возрождение…' : (match.spectate && match.spectate.active ? 'Наблюдение за командой' : '');
    else if(match.phase === 'buy') hint = 'B — магазин · 1–4 — оружие · R — перезарядка';
    else if(match.bomb && match.bomb.state === 'carried' && match.bomb.carrier === p){
      const sites = match.level.map.sites;
      const inSite = sites.find(s => Math.hypot(p.x-s.x, p.z-s.z) < match.level.map.tile*2.4);
      if(inSite) hint = 'Удерживайте E — установить бомбу';
    } else if(match.bomb && match.bomb.state === 'planted' && p.team === 'CT'){
      if(Math.hypot(p.x-match.bomb.x, p.z-match.bomb.z) < 2.5) hint = 'Удерживайте E — обезвредить бомбу';
    } else if(p.team === 'T' && match.bomb && match.bomb.state === 'dropped'){
      hint = 'Подберите бомбу';
    } else if(match.pickupHint){
      hint = `E — подобрать ${match.pickupHint} (заменит текущее)`;
    }
    this._txt('hintText', st.settings.showHints === false ? '' : hint);

    // crosshair spread: static mode keeps a fixed gap, dynamic reflects bloom
    const spread = match.crosshairSpread();
    const gap = this.crossGap + (this.crossDynamic ? spread : 0);
    const half = this.crossLen * 0.5;
    if(this.chTop){
      this.chTop.style.transform = `translate(-50%,-50%) translateY(${-gap - half}px)`;
      this.chBottom.style.transform = `translate(-50%,-50%) translateY(${gap + half}px)`;
      this.chLeft.style.transform = `translate(-50%,-50%) translateX(${-gap - half}px)`;
      this.chRight.style.transform = `translate(-50%,-50%) translateX(${gap + half}px)`;
    }

    this.el('fps').textContent = st.settings.showFps ? fps + ' FPS' : '';
    this.el('fps').style.display = st.settings.showFps ? 'block' : 'none';
    const dbg = match.debugInfo || '';
    this._txt('debugInfo', dbg);
    this.el('debugInfo').style.display = dbg ? 'block' : 'none';
    const sp = match.spectate;
    let specTxt = '';
    if(sp && sp.active){
      const tgt = sp.target;
      specTxt = sp.free
        ? 'РЕЖИМ НАБЛЮДАТЕЛЯ · СВОБОДНАЯ КАМЕРА · V — вернуться · ЛКМ/ПКМ'
        : `РЕЖИМ НАБЛЮДАТЕЛЯ · ${tgt ? tgt.name : '—'} · ←/→ — сменить · V — свободная камера`;
    }
    this._txt('spectateInfo', specTxt);
    this.el('spectateInfo').style.display = specTxt ? 'block' : 'none';

    this._drawMinimap(match);
    this._updateESP(match, st);

    // overlays
    this._updateFlash(match);
    this._updateDamage();
    this._updateScope(match);
    this._updateDeath(match);
  }

  _updateESP(match, st){
    const on = match && match.modActive ? match.modActive('esp') : !!(st.settings.cheats && st.settings.cheats.esp);
    this._espAccum += 1;
    if(!on){
      if(this._cache.espOn !== false){ this._cache.espOn = false; this.espLayer.innerHTML = ''; }
      return;
    }
    if(this._espAccum % 2 !== 0) return;
    this._cache.espOn = true;
    const p = match.player;
    const cam = match.camera;
    const w = this.root.clientWidth || window.innerWidth || 1;
    const h = this.root.clientHeight || window.innerHeight || 1;
    const dir = this._espDir || (this._espDir = new THREE.Vector3());
    const pos = this._espPos || (this._espPos = new THREE.Vector3());
    const proj = this._espProj || (this._espProj = new THREE.Vector3());
    const proj2 = this._espProj2 || (this._espProj2 = new THREE.Vector3());
    cam.updateMatrixWorld(true);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    cam.getWorldDirection(dir);
    const enemies = match.ffa
      ? match.bots.filter(b => b !== p)
      : match.bots.filter(b => b.team !== p.team);
    let html = '';
    for(const b of enemies){
      if(!b.alive) continue;
      const bx = b.pos.x, bz = b.pos.z, by = b.pos.y;
      const headY = by + (b.crouching ? 1.02 : 1.62);
      const footY = by + 0.06;
      pos.set(bx, headY, bz);
      const to = pos.clone().sub(cam.position);
      if(to.dot(dir) <= 0.15) continue;
      proj.copy(pos).project(cam);
      proj2.set(bx, footY, bz).project(cam);
      if(proj.x < -1.4 || proj.x > 1.4 || proj.y < -1.4 || proj.y > 1.4) continue;
      const dist = Math.hypot(bx - p.x, bz - p.z);
      const sx = (proj.x*0.5 + 0.5) * w;
      const top = (-proj.y*0.5 + 0.5) * h;
      const bottom = (-proj2.y*0.5 + 0.5) * h;
      const bh = Math.max(24, Math.min(260, Math.abs(bottom - top)));
      const bw = Math.max(12, bh * 0.46);
      const hp = Math.max(0, Math.min(100, b.health));
      html += `<div class="espBox" style="left:${(sx-bw/2).toFixed(1)}px;top:${Math.min(top,bottom).toFixed(1)}px;width:${bw.toFixed(1)}px;height:${bh.toFixed(1)}px">`
        + `<span class="espName">${b.name} · ${Math.round(dist)}м</span>`
        + `<span class="espHp"><i style="width:${hp}%"></i></span></div>`;
    }
    if(this._espSnap.html !== html){
      this._espSnap.html = html;
      this.espLayer.innerHTML = html;
    }
  }

  // ------------- minimap -------------
  _drawMinimap(match){
    const c = this.mmCtx, S = this.minimap.width;
    const map = match.level.map;
    const tile = map.tile;
    const worldW = map.w*tile, worldH = map.h*tile;
    c.clearRect(0,0,S,S);
    c.fillStyle = 'rgba(10,16,22,.72)';
    c.fillRect(0,0,S,S);
    const sx = S/worldW, sz = S/worldH;
    // walls
    for(let y=0;y<map.h;y++){
      for(let x=0;x<map.w;x++){
        const t = map.grid[y*map.w+x];
        if(!t) continue;
        if(t===1) c.fillStyle = 'rgba(140,160,180,.55)';
        else if(t===2) c.fillStyle = 'rgba(160,130,80,.6)';
        else c.fillStyle = 'rgba(120,120,120,.5)';
        c.fillRect(x*tile*sx, y*tile*sz, Math.ceil(tile*sx), Math.ceil(tile*sz));
      }
    }
    // sites
    c.font = 'bold 11px Arial'; c.textAlign='center'; c.textBaseline='middle';
    for(const s of map.sites){
      c.fillStyle = 'rgba(255,200,60,.9)';
      c.fillText(s.name, s.x*sx, s.z*sz);
    }
    // bots: friendlies get a heading ring and name, enemies stay minimal
    c.font = 'bold 9px Arial'; c.textAlign='center'; c.textBaseline='middle';
    for(const b of match.bots){
      if(!b.alive) continue;
      const friendly = !match.ffa && b.team === match.player.team;
      const visible = friendly || match.botVisibleToPlayer(b);
      if(!visible) continue;
      const bx = b.pos.x*sx, bz = b.pos.z*sz;
      c.fillStyle = b.team === 'CT' ? '#4fa3ff' : '#ffb03a';
      if(friendly){
        c.globalAlpha = 0.28;
        c.beginPath(); c.arc(bx,bz,7,0,6.283); c.fill();
        c.globalAlpha = 1;
        c.strokeStyle = c.fillStyle; c.lineWidth = 1.5;
        c.beginPath(); c.arc(bx,bz,5,0,6.283); c.stroke();
        c.save(); c.translate(bx,bz); c.rotate(-b.yaw);
        c.beginPath(); c.moveTo(0,-4.5); c.lineTo(3,2); c.lineTo(-3,2); c.closePath(); c.fill();
        c.restore();
        c.fillStyle = 'rgba(220,238,255,.92)';
        c.fillText((getAgent(b.team,b.agentId).name||'').slice(0,6), bx, bz+12);
      } else {
        c.beginPath(); c.arc(bx,bz,2.5,0,6.283); c.fill();
      }
    }
    // player
    const px = match.player.x*sx, pz = match.player.z*sz;
    c.save();
    c.translate(px, pz);
    c.rotate(-match.player.yaw);
    c.fillStyle = '#7dff8c';
    c.beginPath(); c.moveTo(0,-6); c.lineTo(4,4); c.lineTo(-4,4); c.closePath(); c.fill();
    c.restore();
    // border
    c.strokeStyle = 'rgba(120,160,200,.5)'; c.lineWidth = 2; c.strokeRect(1,1,S-2,S-2);
  }

  // ------------- killfeed -------------
  addKill(killerName, victimName, weaponName, headshot, sameTeam){
    const kf = this.el('killfeed');
    const div = document.createElement('div');
    div.className = 'kf' + (sameTeam ? ' tk' : '');
    div.innerHTML = `<span class="kname">${escapeHtml(killerName)}</span>
      <span class="kw">${headshot?'🎯 ':''}${escapeHtml(weaponName)}</span>
      <span class="kname">${escapeHtml(victimName)}</span>`;
    kf.appendChild(div);
    setTimeout(()=>{ div.classList.add('out'); setTimeout(()=>div.remove(), 400); }, 4200);
    while(kf.children.length > 6) kf.firstChild.remove();
  }

  // ------------- messages -------------
  message(text, sub='', duration=2200){
    const el = this.el('centerMsg');
    el.innerHTML = `<div class="cmain">${text}</div>${sub?`<div class="csub">${sub}</div>`:''}`;
    el.classList.add('show');
    clearTimeout(this._msgT);
    this._msgT = setTimeout(()=>el.classList.remove('show'), duration);
  }

  // ------------- buy menu -------------
  openBuy(match){
    this.buyOpen = true;
    this.buyMenu.classList.remove('hidden');
    this._renderBuy(match);
  }
  closeBuy(){
    this.buyOpen = false;
    this.buyMenu.classList.add('hidden');
  }
  toggleBuy(match){
    if(this.buyOpen) this.closeBuy(); else this.openBuy(match);
  }
  _renderBuy(match){
    const p = match.player;
    let cat = this._buyCat || 'rifles';
    const catDef0 = BUY_CATEGORIES.find(c=>c.id===cat) || BUY_CATEGORIES[0];
    if(!catDef0) return;
    const canBuy = match.canBuy();
    let html = `<div class="buyHead"><div class="buyTitle"><span class="buyLogo">S3</span><div><b>STANDOFF 3</b><i>МАГАЗИН · ${catDef0.name.toUpperCase()}</i></div></div><span class="buyMoney">$${p.money}</span>
      <button id="buyClose">✕</button></div>`;
    html += `<div class="buyBody"><div class="buyTabs">`;
    for(const c of BUY_CATEGORIES){
      html += `<div class="buyTab ${c.id===cat?'active':''}" data-cat="${c.id}">${c.name}</div>`;
    }
    html += `</div><div class="buyItems">`;
    const catDef = catDef0;
    for(const itemId of catDef.items){
      let name='', price=0, owned=false, count='', icon='▣', typeLabel='', stats='';
      if(itemId === 'armor'){ name = GEAR.armor.name; price = GEAR.armor.price; owned = p.armor >= 100; icon='🛡️'; typeLabel='СНАРЯЖЕНИЕ'; }
      else if(itemId === 'helmet'){ name = GEAR.helmet.name; price = GEAR.helmet.price; owned = p.helmet; icon='⛑️'; typeLabel='СНАРЯЖЕНИЕ'; }
      else if(GRENADES[itemId]){ const g = GRENADES[itemId]; name = g.name; price = g.price; count = p.grenades[itemId] ? ' ×'+p.grenades[itemId] : ''; icon=g.icon; typeLabel='ГРАНАТА'; }
      else {
        const w = WEAPONS[itemId]; if(!w) continue;
        name = w.name; price = w.price; owned = !!(p.loadout[w.slot] && p.loadout[w.slot].id === itemId);
        icon = weaponArt(itemId, getState().inventory.equipped[itemId]); typeLabel = ({pistol:'ПИСТОЛЕТ',smg:'ПП',rifle:'ВИНТОВКА',sniper:'СНАЙПЕРСКАЯ',lmg:'ПУЛЕМЁТ',shotgun:'ДРОБОВИК',knife:'НОЖ'})[w.type] || w.type.toUpperCase();
        const acc = Math.max(0, Math.min(100, Math.round((1 - (w.spread||0)/0.09)*100)));
        const rate = Math.max(0, Math.min(100, Math.round((1 - (w.fireDelay||100)/1600)*100)));
        stats = `<span class="biStats"><i style="width:${Math.min(100,w.dmg)}%"></i></span><span class="biMeta"><em>УРОН ${w.dmg}</em><em>ТЕМП ${rate}</em><em>ТОЧН ${acc}</em><em>MAG ${w.mag}</em></span>`;
      }
      const disabled = !canBuy || owned || p.money < price;
      html += `<button class="buyItem ${owned?'owned':''} ${stats?'weapon':''}" data-item="${itemId}" ${disabled?'disabled':''}>
        <span class="biIcon">${icon}</span>
        <span class="biBody"><span class="biTop"><span class="biName">${name}${count}</span><span class="biType">${typeLabel}</span></span>${stats}</span>
        <span class="biPrice">${owned?'КУПЛЕНО':'$'+price}</span>
      </button>`;
    }
    html += `</div></div>`;
    html += `<div class="buyFoot">${canBuy ? 'Фаза закупки · карточки показывают урон, темп и точность' : 'Закупка недоступна вне фазы'} · B / ESC — закрыть</div>`;
    this.buyMenu.innerHTML = html;

    this.buyMenu.querySelector('#buyClose').onclick = ()=>this.closeBuy();
    for(const tab of this.buyMenu.querySelectorAll('.buyTab')){
      tab.onclick = ()=>{ this._buyCat = tab.dataset.cat; this._renderBuy(match); };
    }
    for(const btn of this.buyMenu.querySelectorAll('.buyItem')){
      btn.onclick = ()=>{
        if(btn.disabled) return;
        const ok = match.buy(btn.dataset.item);
        if(ok){ this._renderBuy(match); }
      };
    }
  }

  // ------------- scoreboard -------------
  toggleScoreboard(match){
    this.scoreboardOpen = !this.scoreboardOpen;
    this.scoreboard.classList.toggle('hidden', !this.scoreboardOpen);
    if(this.scoreboardOpen) this.renderScoreboard(match);
  }
  renderScoreboard(match){
    const rows = [];
    const p = match.player;
    rows.push({ name:p.name, team:p.team, kills:p.kills, deaths:p.deaths, money:p.money, you:true });
    for(const b of match.bots) rows.push({ name:b.name, team:b.team, kills:b.kills, deaths:b.deaths, money:b.money, alive:b.alive });
    const teamRows = (team) => rows.filter(r=>r.team===team).sort((a,b)=>b.kills-a.kills);
    const team = (name, arr, cls) => `<div class="sbTeam ${cls}"><h3>${name} <span>${arr.length}</span></h3>
      <div class="sbHead"><span>Игрок</span><span>У</span><span>С</span></div>
      ${arr.map(r=>`<div class="sbRow ${r.you?'you':''} ${r.alive===false?'dead':''}">
        <span>${escapeHtml(r.name)}</span><span>${r.kills}</span><span>${r.deaths}</span></div>`).join('')}</div>`;
    if(match.ffa){
      const ranked = [...rows].sort((a,b)=>b.kills-a.kills || a.deaths-b.deaths);
      this.scoreboard.innerHTML = `<div class="sbWrap">
        ${team('ВСЕ ИГРОКИ', ranked, 'ct')}
        <div class="sbFoot">${match.modeLabel()} · ${match.level.map.info ? match.level.map.info.name : ''} · Вы: ${p.kills} убийств · лидер: ${ranked[0] ? escapeHtml(ranked[0].name) : '—'}</div>
      </div>`;
      return;
    }
    this.scoreboard.innerHTML = `<div class="sbWrap">
      ${team('СПЕЦНАЗ', teamRows('CT'), 'ct')}
      ${team('ТЕРРОРИСТЫ', teamRows('T'), 't')}
      <div class="sbFoot">${match.modeLabel()} · ${match.level.map.info ? match.level.map.info.name : ''} · Счёт ${match.score.CT} : ${match.score.T}</div>
    </div>`;
  }

  // ------------- overlays -------------
  _updateFlash(match){
    const el = this.el('flashOverlay');
    el.style.opacity = Math.min(1, match.playerFlash || 0).toFixed(3);
  }
  _updateDamage(){
    if(this._dmg > 0){
      this.el('damageOverlay').style.opacity = Math.min(0.7, this._dmg).toFixed(3);
    } else {
      this.el('damageOverlay').style.opacity = 0;
    }
  }
  hitDamage(){ this._dmg = Math.min(1, (this._dmg||0) + 0.35); }
  damageIndicator(angle=0, strength=0.6){
    const host = this.el('damageDirs');
    if(!host) return;
    const d = document.createElement('div');
    d.className = 'dmgDir';
    d.style.transform = `rotate(${angle}rad)`;
    d.style.opacity = String(Math.max(0.15, Math.min(1, strength)));
    host.appendChild(d);
    setTimeout(()=>{ d.style.opacity = '0'; setTimeout(()=>d.remove(), 260); }, 380);
  }
  hitMark(kill=false, head=false, damage=0){
    const number=this.el('damageNumber');
    if(number && damage>0){ number.textContent=(head?'ГОЛОВА · ':'')+Math.round(damage); number.classList.add('show'); }
    this._hitT = 0.22;
    const el = this.el('hitmarker');
    if(el){ el.classList.toggle('kill', !!kill); el.classList.toggle('head', !!head && !kill); el.classList.add('show'); }
  }
  tick(dt){
    this._dmg = Math.max(0, (this._dmg||0) - dt*1.8);
    if(this._hitT > 0){
      this._hitT = Math.max(0, this._hitT - dt);
      const el = this.el('hitmarker');
      if(el && this._hitT <= 0){ el.classList.remove('show'); this.el('damageNumber')?.classList.remove('show'); }
    }
  }
  _updateScope(match){
    const el = this.el('scopeOverlay');
    const zoom = match.playerZoom || 0;
    el.style.opacity = zoom > 0 ? 1 : 0;
    if(zoom > 0){
      const size = zoom >= 4 ? 34 : 46;
      el.style.background = `radial-gradient(circle at 50% 50%, transparent ${size}%, rgba(0,0,0,0.98) ${size+4}%)`;
      el.style.setProperty('--scope', size+'%');
    }
    const enabled = getState().settings.crosshairEnabled !== false;
    this.crosshair.style.display = (zoom > 0 || !enabled) ? 'none' : 'block';
  }
  _updateDeath(match){
    const el = this.el('deathOverlay');
    if(!match.player.alive && match.phase !== 'live' || (!match.player.alive && match.mode === 'competitive')){
      el.classList.toggle('show', !match.player.alive);
    } else {
      el.classList.toggle('show', !match.player.alive && match.playerRespawnTimer > 0);
    }
    const sub = el.querySelector('.deadSub');
    if(sub) sub.textContent = match.playerRespawnTimer > 0 ? 'Возрождение через ' + Math.ceil(match.playerRespawnTimer) + '…' : 'Ожидание следующего раунда';
  }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
