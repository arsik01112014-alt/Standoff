// Unified desktop + gamepad + touch input with rebindable keys.
import { getState, saveState } from './state.js';

export const DEFAULT_BINDS = {
  moveForward:'KeyW', moveBack:'KeyS', moveLeft:'KeyA', moveRight:'KeyD',
  jump:'Space', crouch:'ControlLeft', run:'ShiftLeft',
  reload:'KeyR', use:'KeyE', buy:'KeyB', inspect:'KeyF', drop:'KeyG',
  lastSlot:'KeyQ', scoreboard:'Tab', pause:'Escape',
  slot1:'Digit1', slot2:'Digit2', slot3:'Digit3', slot4:'Digit4'
};

export const REBIND_LABELS = {
  moveForward:'Вперёд', moveBack:'Назад', moveLeft:'Влево', moveRight:'Вправо',
  jump:'Прыжок', crouch:'Присед', run:'Бег', reload:'Перезарядка', use:'Действие',
  buy:'Магазин', inspect:'Осмотр', drop:'Выбросить', lastSlot:'Прошлый слот',
  scoreboard:'Счёт', pause:'Пауза'
};

const GAMEPAD_DEAD = 0.18;

export class Input {
  constructor(){
    this.keys = Object.create(null);
    this.move = { x:0, y:0 };
    this.look = { dx:0, dy:0 };
    this.fire = false;
    this.firePressed = false;
    this.aim = false;
    this.run = false;
    this.crouch = false;
    this.jumpPressed = false;
    this.jumpHeld = false;
    this.reloadPressed = false;
    this.slotRequest = 0;
    this.buyPressed = false;
    this.inspectPressed = false;
    this.dropPressed = false;
    this.use = false;
    this.usePressed = false;
    this.scoreboard = false;
    this.escapePressed = false;
    this.grenadeCycle = 0;
    this.spectateNext = false;
    this.spectatePrev = false;
    this.spectateFree = false;
    this._crouchHeld = false;
    this._mouseFire = false;
    this._touchFire = false;
    this._gpFire = false;
    this._gpAim = false;
    this._gpUse = false;
    this._gpScore = false;
    this._gpRun = false;
    this._gpJumpHeld = false;
    this._gpPrev = {};
    this.gamepadConnected = false;
    this.gamepadJustConnected = false;
    this.gamepadId = '';
    this.usingGamepad = false;
    this.pointerLocked = false;
    this.enabled = false;
    this.usingTouch = ('ontouchstart' in window);

    this._touchMove = { x:0, y:0 };
    this._touchAim = false;
    this._lookTouchId = null;
    this._lookLast = { x:0, y:0 };
    this._joyId = null;

    this._onKeyDown = (e) => this._keyDown(e);
    this._onKeyUp = (e) => this._keyUp(e);
    this._onMouseMove = (e) => this._mouseMove(e);
    this._onMouseDown = (e) => this._mouseDown(e);
    this._onMouseUp = (e) => this._mouseUp(e);
    this._onLockChange = () => { this.pointerLocked = document.pointerLockElement === this.canvas; };
    this._onWheel = (e) => {
      if(!this.enabled || this._lookTouchId !== null) return;
      if(e.target !== this.canvas && !this.pointerLocked) return;
      this.slotCycle = (e.deltaY > 0 ? 1 : -1);
      e.preventDefault();
    };
    this._onContext = (e) => { if(this.enabled) e.preventDefault(); };
    this._onBlur = () => {
      this.resetHeld();
      this.fire = false; this._mouseFire = false; this._touchFire = false; this._touchAim = false;
      this.keys = Object.create(null); this.scoreboard = false; this.use = false;
    };
  }

  attach(canvas){
    this.canvas = canvas;
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('pointerlockchange', this._onLockChange);
    this.canvas.addEventListener('wheel', this._onWheel, { passive:false });
    this.canvas.addEventListener('contextmenu', this._onContext);
    window.addEventListener('blur', this._onBlur);
    this._bindTouch();
  }

  setEnabled(v){
    this.enabled = v;
    if(!v){
      this.resetHeld();
      this.fire = false; this.aim = false; this.scoreboard = false;
      this.use = false; this._mouseFire = false; this._touchFire = false;
      this._touchAim = false; this.move.x = 0; this.move.y = 0;
    }
  }

  requestLock(){
    if(!this.usingTouch && this.canvas && this.canvas.requestPointerLock){
      try{ this.canvas.requestPointerLock(); }catch(e){}
    }
  }
  exitLock(){
    if(document.pointerLockElement){ try{ document.exitPointerLock(); }catch(e){} }
  }

  binds(){
    const b = getState().settings.keybinds;
    return b && typeof b === 'object' ? { ...DEFAULT_BINDS, ...b } : DEFAULT_BINDS;
  }
  actionFor(code){
    const b = this.binds();
    for(const k in b) if(b[k] === code) return k;
    return null;
  }
  codeFor(action){
    return this.binds()[action] || DEFAULT_BINDS[action] || '';
  }
  held(action){
    const code = this.codeFor(action);
    return !!(code && this.keys[code]);
  }

  // ---------------- keyboard ----------------
  _keyDown(e){
    const k = e.code;
    if(this.keys[k]) return;
    this.keys[k] = true;
    if(!this.enabled) return;
    const action = this.actionFor(k);
    if(action === 'reload') this.reloadPressed = true;
    if(action === 'inspect') this.inspectPressed = true;
    if(action === 'drop') this.dropPressed = true;
    if(action === 'use'){ this.use = true; this.usePressed = true; }
    if(action === 'jump'){ this.jumpPressed = true; this.jumpHeld = true; e.preventDefault(); }
    if(action === 'buy') this.buyPressed = true;
    if(action === 'slot1') this.slotRequest = 1;
    if(action === 'slot2') this.slotRequest = 2;
    if(action === 'slot3') this.slotRequest = 3;
    if(action === 'slot4') this.slotRequest = 4;
    if(action === 'lastSlot') this.lastSlotRequest = true;
    if(action === 'scoreboard'){ this.scoreboard = true; e.preventDefault(); }
    if(action === 'pause') this.escapePressed = true;
    if(action === 'run'){ /* sampled as held */ }
    if(action === 'crouch'){
      const toggle = getState().settings.toggleCrouch !== false;
      if(toggle) this.crouch = !this.crouch;
      else { this.crouch = true; this._crouchHeld = true; }
      e.preventDefault();
    }
    if(k === 'KeyC' && action !== 'crouch') this.crouch = !this.crouch;
    if(k === 'ArrowLeft') this.spectatePrev = true;
    if(k === 'ArrowRight') this.spectateNext = true;
    if(k === 'KeyV') this.spectateFree = true;
    if(k === 'KeyX') this.grenadeCycle = 1;
    if(k === 'KeyZ') this.grenadeCycle = -1;
    if(k === 'F1'){ this._toggleCheat('fly'); e.preventDefault(); return; }
    if(k === 'F2'){ this._toggleCheat('noclip'); e.preventDefault(); return; }
    if(k === 'F3'){ this._toggleCheat('infiniteAmmo'); e.preventDefault(); return; }
    if(k === 'F4'){ this._toggleCheat('esp'); e.preventDefault(); return; }
    if(k === 'F5'){ this._toggleCheat('god'); e.preventDefault(); return; }
    if(k === 'F6'){ this._toggleCheat('infiniteMoney'); e.preventDefault(); return; }
    if(k === 'F7'){ this._toggleCheat('speed'); e.preventDefault(); return; }
    if(k === 'F8'){ this._toggleCheat('freeCam'); e.preventDefault(); return; }
    if(k === 'F9'){ this._toggleCheat('wallbang'); e.preventDefault(); return; }
    if(k === 'F10'){ this._toggleCheat('aimbot'); e.preventDefault(); return; }
  }
  _toggleCheat(key){
    const settings = getState().settings;
    if(settings.modUnlocked !== true) return;
    settings.cheats = settings.cheats || {};
    settings.cheats[key] = !settings.cheats[key];
    saveState();
    this.cheatChanged = key;
  }
  _keyUp(e){
    this.keys[e.code] = false;
    const action = this.actionFor(e.code);
    if(action === 'jump') this.jumpHeld = false;
    if(action === 'scoreboard') this.scoreboard = false;
    if(action === 'use') this.use = false;
    if(action === 'crouch' && this._crouchHeld){
      this.crouch = false; this._crouchHeld = false;
    }
  }

  // ---------------- mouse ----------------
  _mouseMove(e){
    if(!this.enabled || !this.pointerLocked) return;
    this.look.dx += e.movementX || 0;
    this.look.dy += e.movementY || 0;
  }
  _mouseDown(e){
    if(!this.enabled) return;
    if(e.target !== this.canvas && !this.pointerLocked) return;
    if(e.button === 0){ this._mouseFire = true; this.fire = true; this.firePressed = true; }
    if(e.button === 2){ this._touchAim = false; this._mouseAim = true; e.preventDefault(); }
  }
  _mouseUp(e){
    if(e.button === 0){ this._mouseFire = false; if(!this._gpFire && !this._touchFire) this.fire = false; }
    if(e.button === 2) this._mouseAim = false;
  }

  // ---------------- gamepad ----------------
  gamepadSettings(){
    return getState().settings;
  }
  _pollGamepad(dt){
    if(!this.enabled) return;
    if(this.gamepadSettings().gamepadEnabled === false) return;
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if(!nav || typeof nav.getGamepads !== 'function') return;
    let pad = null;
    const pads = nav.getGamepads();
    for(let i=0;i<pads.length;i++){ if(pads[i]){ pad = pads[i]; break; } }
    if(!pad){
      if(this.gamepadConnected){ this.gamepadConnected = false; this.usingGamepad = false; }
      return;
    }
    if(!this.gamepadConnected){ this.gamepadJustConnected = true; }
    this.gamepadConnected = true;
    this.usingGamepad = true;
    this.gamepadId = pad.id || 'Gamepad';

    const buttons = pad.buttons || [];
    const pressed = i => !!(buttons[i] && (buttons[i].pressed || buttons[i].value > 0.5));
    const edge = i => pressed(i) && !this._gpPrev[i];
    for(let i=0;i<buttons.length;i++) this._gpPrev[i] = pressed(i);

    const s = this.gamepadSettings();
    const gs = Math.max(0.2, Math.min(3, s.gamepadSensitivity ?? 1));
    const dz = Math.max(0.05, Math.min(0.5, s.gamepadDeadzone ?? GAMEPAD_DEAD));
    let ax = pad.axes || [];
    let lx = ax[0] || 0, ly = ax[1] || 0, rx = ax[2] || 0, ry = ax[3] || 0;
    if(s.gamepadLayout === 'southpaw'){ [lx, rx] = [rx, lx]; [ly, ry] = [ry, ly]; }
    const shape = v => {
      const a = Math.abs(v);
      if(a < dz) return 0;
      const n = (a - dz) / (1 - dz);
      return Math.sign(v) * n * n * 1.25;
    };
    this._gpMove = { x: shape(lx), y: shape(ly) };
    this.look.dx += shape(rx) * gs * dt * 760;
    this.look.dy += shape(ry) * gs * dt * 760;

    if(edge(0)){ this.jumpPressed = true; this.jumpHeld = true; }
    this._gpJumpHeld = pressed(0);
    if(edge(1)) this.crouch = !this.crouch;
    if(edge(2)) this.reloadPressed = true;
    if(edge(3)) this.slotCycle = 1;
    if(edge(4)) this.lastSlotRequest = true;
    if(edge(5)) this.inspectPressed = true;
    if(edge(7)) this.firePressed = true;
    if(edge(8)) this.scoreboard = true;
    if(edge(9)) this.escapePressed = true;
    if(edge(12)) this.buyPressed = true;
    if(edge(13)) this.usePressed = true;
    if(edge(14)) this.grenadeCycle = -1;
    if(edge(15)) this.grenadeCycle = 1;
    this._gpFire = pressed(7);
    this._gpAim = pressed(6);
    this._gpScore = pressed(8);
    this._gpRun = pressed(10);
    this._gpUse = pressed(13);
    if(this._gpFire) this.fire = true;
    else if(!this._mouseFire && !this._touchFire) this.fire = false;
    if(this._gpUse) this.use = true;
    if(this._gpJumpHeld) this.jumpHeld = true;
  }
  rumble(strength = 0.55, duration = 120){
    if(!this.gamepadConnected || !this.enabled) return;
    if(this.gamepadSettings().gamepadVibration === false) return;
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if(!nav || typeof nav.getGamepads !== 'function') return;
    const pads = nav.getGamepads();
    for(const pad of pads){
      if(!pad) continue;
      const act = pad.vibrationActuator;
      if(act && act.playEffect){
        try{ act.playEffect('dual-rumble', { duration, strongMagnitude: Math.min(1,strength), weakMagnitude: Math.min(1,strength*0.6) }); }catch(e){}
      }
      break;
    }
  }

  // ---------------- touch ----------------
  resetHeld(){
    this.keys = Object.create(null);
    this.fire = this.firePressed = this.aim = this.use = this.jumpHeld = false;
    this._mouseFire = this._mouseAim = this._touchFire = this._touchAim = this._touchJump = false;
    this._touchMove.x = this._touchMove.y = this.move.x = this.move.y = 0;
    this._lookTouchId = this._joyId = null;
    this._firePointers?.clear();
    this.look.dx = this.look.dy = 0;
    document.getElementById('knob')?.style.setProperty('transform','translate(0px,0px)');
    document.querySelectorAll('.tbtn.pressed').forEach(el=>el.classList.remove('pressed'));
  }

  _bindTouch(){
    const joy = document.getElementById('joy'), knob = document.getElementById('knob');
    this._firePointers = new Map();
    const capture = (el,e) => { el.setPointerCapture?.(e.pointerId); e.preventDefault(); e.stopPropagation(); };
    const lookDelta = (dx,dy) => {
      const scale = 2.0 * (getState().settings.touchSensitivity ?? 1);
      this.look.dx += dx*scale; this.look.dy += dy*scale;
    };
    if(joy){
      const move = e => {
        const r=joy.getBoundingClientRect(), radius=r.width*0.38;
        let x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2;
        const len=Math.hypot(x,y); if(len>radius){ x*=radius/len; y*=radius/len; }
        const magnitude=Math.hypot(x,y)/radius;
        this._touchMove.x=magnitude<0.12?0:x/radius;
        this._touchMove.y=magnitude<0.12?0:y/radius;
        if(knob) knob.style.transform=`translate(${x}px,${y}px)`;
      };
      joy.onpointerdown=e=>{ if(!this.enabled || this._joyId!==null)return; this._joyId=e.pointerId; capture(joy,e); move(e); };
      joy.onpointermove=e=>{ if(this.enabled && this._joyId===e.pointerId)move(e); };
      const end=e=>{ if(this._joyId!==e.pointerId)return; this._joyId=null; this._touchMove.x=this._touchMove.y=0; if(knob)knob.style.transform='translate(0px,0px)'; };
      joy.onpointerup=end; joy.onpointercancel=end; joy.onlostpointercapture=end;
    }
    if(this.canvas){
      this.canvas.addEventListener('pointerdown',e=>{
        if(!this.enabled || e.pointerType==='mouse' || this._lookTouchId!==null)return;
        this._lookTouchId=e.pointerId; this._lookLast={x:e.clientX,y:e.clientY}; capture(this.canvas,e);
      });
      this.canvas.addEventListener('pointermove',e=>{
        if(!this.enabled || e.pointerId!==this._lookTouchId)return;
        lookDelta(e.clientX-this._lookLast.x,e.clientY-this._lookLast.y);
        this._lookLast={x:e.clientX,y:e.clientY};
      });
      const end=e=>{ if(this._lookTouchId===e.pointerId)this._lookTouchId=null; };
      for(const name of ['pointerup','pointercancel','lostpointercapture'])this.canvas.addEventListener(name,end);
    }
    const bind=(id,down,up)=>{
      const el=document.getElementById(id); if(!el)return;
      let owner=null;
      el.onpointerdown=e=>{ if(!this.enabled || owner!==null)return; owner=e.pointerId; capture(el,e); el.classList.add('pressed'); down(e); };
      const end=e=>{ if(owner!==e.pointerId)return; owner=null; el.classList.remove('pressed'); up?.(e); };
      el.onpointerup=end; el.onpointercancel=end; el.onlostpointercapture=end;
    };
    for(const id of ['tFire','tFireLeft']){
      bind(id,e=>{ this._firePointers.set(e.pointerId,{x:e.clientX,y:e.clientY}); this._touchFire=true; this.fire=true; this.firePressed=true; },e=>{
        this._firePointers.delete(e.pointerId); this._touchFire=this._firePointers.size>0;
        this.fire=this._touchFire || this._mouseFire || this._gpFire;
      });
      const el=document.getElementById(id);
      if(el)el.onpointermove=e=>{ const prev=this._firePointers.get(e.pointerId); if(!prev || !this.enabled)return; lookDelta(e.clientX-prev.x,e.clientY-prev.y); prev.x=e.clientX; prev.y=e.clientY; };
    }
    bind('tAim',()=>{ this._touchAim=!this._touchAim; });
    bind('tJump',()=>{ this.jumpPressed=true; this._touchJump=this.jumpHeld=true; },()=>{this._touchJump=this.jumpHeld=false;});
    bind('tCrouch',()=>{this.crouch=!this.crouch;});
    bind('tReload',()=>{this.reloadPressed=true;});
    bind('tSwitch',()=>{this.slotCycle=1;});
    bind('tBuy',()=>{this.buyPressed=true;});
    bind('tInspect',()=>{this.inspectPressed=true;});
    bind('tUse',()=>{this.use=this.usePressed=true;},()=>{this.use=false;});
  }

  // called at start of frame
  sample(dt = 0.016){
    this._pollGamepad(dt);
    let x = 0, y = 0;
    if(this.held('moveForward')) y -= 1;
    if(this.held('moveBack')) y += 1;
    if(this.held('moveLeft')) x -= 1;
    if(this.held('moveRight')) x += 1;
    if(this._gpMove && !this._gpScore){
      if(Math.abs(this._gpMove.x) > 0.02 || Math.abs(this._gpMove.y) > 0.02){
        x = this._gpMove.x; y = this._gpMove.y;
      }
    }
    if(Math.abs(this._touchMove.x) > 0.08 || Math.abs(this._touchMove.y) > 0.08){
      x = this._touchMove.x; y = this._touchMove.y;
    }
    this.move.x = x; this.move.y = y;
    this.run = !!(this.held('run') || this._gpRun || Math.hypot(this._touchMove.x,this._touchMove.y) > 0.92);
    this.aim = !!(this._mouseAim || this._touchAim || this._gpAim);
    this.scoreboard = !!(this.held('scoreboard') || this._gpScore);
    if(!this._gpJumpHeld && !this._touchJump && !this.held('jump')) this.jumpHeld = false;
  }

  endFrame(){
    this.firePressed = false;
    this.jumpPressed = false;
    this.reloadPressed = false;
    this.buyPressed = false;
    this.inspectPressed = false;
    this.dropPressed = false;
    this.usePressed = false;
    this.lastSlotRequest = false;
    this.slotRequest = 0;
    this.slotCycle = 0;
    this.grenadeCycle = 0;
    this.escapePressed = false;
    this.spectateNext = false;
    this.spectatePrev = false;
    this.spectateFree = false;
    this.cheatChanged = null;
    this.gamepadJustConnected = false;
    this.look.dx = 0;
    this.look.dy = 0;
  }
}
