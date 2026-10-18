'use strict';
/* =====================================================================
   GOLAZO 26 — футбольный симулятор на HTML5 Canvas
   Разделы: утилиты · хранилище · звук · данные клубов · рендер ·
            физика · футболисты · ИИ · матч и правила · ввод · меню · Легенда
   ===================================================================== */

// ============================ УТИЛИТЫ ============================
const PITCH_L = 105, PITCH_W = 68, GOAL_W = 7.32, GOAL_H = 2.44, GOAL_D = 2.2;
const CX = PITCH_L / 2, CY = PITCH_W / 2;
const GRAV = 9.81, BALL_R = 0.11;
const PEN_DIST = 11, BOX_L = 16.5, BOX_W = 40.32, SIX_L = 5.5, SIX_W = 18.32;

const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const sgn = v => (v < 0 ? -1 : 1);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const $ = id => document.getElementById(id);
const angWrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const angDiff = (a, b) => angWrap(b - a);
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function seeded(seed) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function hexRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbHex(r, g, b) { return '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join(''); }
function shade(hex, amt) { const [r, g, b] = hexRgb(hex); return amt >= 0 ? rgbHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt) : rgbHex(r * (1 + amt), g * (1 + amt), b * (1 + amt)); }
function colorDist(a, b) { const x = hexRgb(a), y = hexRgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); }
function luma(hex) { const [r, g, b] = hexRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
function fmtClock(sec) { const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function plural(n, one, few, many) { const a = Math.abs(n) % 100, b = a % 10; if (a > 10 && a < 20) return many; if (b > 1 && b < 5) return few; if (b === 1) return one; return many; }

// ============================ ХРАНИЛИЩЕ ============================
const Store = {
  get(k, def) { try { const v = localStorage.getItem('golazo26_' + k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem('golazo26_' + k, JSON.stringify(v)); } catch (e) { /* хранилище недоступно */ } },
  del(k) { try { localStorage.removeItem('golazo26_' + k); } catch (e) { /* ignore */ } }
};
const DEFAULT_SETTINGS = { diff: 1, half: 3, cam: 1, sound: 1, auto: 1, names: 1, radar: 1, replay: 1 };
const Settings = Object.assign({}, DEFAULT_SETTINGS, Store.get('settings', {}));
function saveSettings() { Store.set('settings', Settings); }

// ============================ ЗВУК (WebAudio) ============================
const Sfx = {
  ctx: null, master: null, crowd: null, crowdHi: null, noise: null, level: 0.25,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.gain.value = Settings.sound ? 0.8 : 0; this.master.connect(c.destination);
      const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5 + w * 0.15; }
      this.noise = buf;
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.5;
      this.crowd = c.createGain(); this.crowd.gain.value = 0;
      src.connect(bp); bp.connect(this.crowd); this.crowd.connect(this.master); src.start();
      const src2 = c.createBufferSource(); src2.buffer = buf; src2.loop = true; src2.playbackRate.value = 1.7;
      const hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 1400; hp.Q.value = 0.7;
      this.crowdHi = c.createGain(); this.crowdHi.gain.value = 0;
      src2.connect(hp); hp.connect(this.crowdHi); this.crowdHi.connect(this.master); src2.start();
    } catch (e) { this.ctx = null; }
  },
  setEnabled(on) { if (this.master) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05); },
  setCrowd(level, excite = 0) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.crowd.gain.setTargetAtTime(level * 0.55, t, 0.6);
    this.crowdHi.gain.setTargetAtTime(excite * 0.3, t, 0.25);
  },
  env(node, t, a, peak, dur) { node.gain.setValueAtTime(0.0001, t); node.gain.exponentialRampToValueAtTime(peak, t + a); node.gain.exponentialRampToValueAtTime(0.0001, t + dur); },
  whistle(kind = 'short') {
    if (!this.ctx || Match.mode === 'demo') return; const c = this.ctx, t0 = c.currentTime;
    const parts = kind === 'long' ? [[0, 0.9]] : kind === 'end' ? [[0, 0.35], [0.5, 0.35], [1.0, 1.0]] : kind === 'double' ? [[0, 0.2], [0.3, 0.45]] : [[0, 0.28]];
    for (const [st, du] of parts) {
      const o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
      o.type = 'sine'; o.frequency.value = 2950; lfo.frequency.value = 34; lg.gain.value = 140;
      lfo.connect(lg); lg.connect(o.frequency); o.connect(g); g.connect(this.master);
      const t = t0 + st; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      g.gain.setValueAtTime(0.22, t + du - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + du);
      o.start(t); lfo.start(t); o.stop(t + du + 0.05); lfo.stop(t + du + 0.05);
    }
  },
  kick(power = 0.5) {
    if (!this.ctx || Match.mode === 'demo') return; const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    o.connect(g); g.connect(this.master); this.env(g, t, 0.005, 0.25 + power * 0.45, 0.16); o.start(t); o.stop(t + 0.2);
    const n = c.createBufferSource(), f = c.createBiquadFilter(), g2 = c.createGain(); n.buffer = this.noise;
    f.type = 'lowpass'; f.frequency.value = 1800; n.connect(f); f.connect(g2); g2.connect(this.master);
    this.env(g2, t, 0.002, 0.15 + power * 0.25, 0.06); n.start(t, Math.random()); n.stop(t + 0.08);
  },
  thud() { this.kick(0.15); },
  net() {
    if (!this.ctx || Match.mode === 'demo') return; const c = this.ctx, t = c.currentTime;
    const n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); n.buffer = this.noise;
    f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.8; n.connect(f); f.connect(g); g.connect(this.master);
    this.env(g, t, 0.01, 0.35, 0.45); n.start(t, Math.random()); n.stop(t + 0.5);
  },
  post() {
    if (!this.ctx || Match.mode === 'demo') return; const c = this.ctx, t = c.currentTime;
    for (const fr of [880, 1320, 2210]) { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = fr; o.connect(g); g.connect(this.master); this.env(g, t, 0.003, 0.12, 0.9); o.start(t); o.stop(t + 1); }
  },
  roar(intensity = 1, dur = 4) {
    if (!this.ctx || Match.mode === 'demo') return; const c = this.ctx, t = c.currentTime;
    const n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); n.buffer = this.noise; n.loop = true;
    f.type = 'bandpass'; f.frequency.value = 800; f.Q.value = 0.4; n.connect(f); f.connect(g); g.connect(this.master);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9 * intensity, t + 0.35);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.6, dur * 0.25); n.start(t); n.stop(t + dur + 1);
  },
  ooh() {
    if (!this.ctx || Match.mode === 'demo') return; const c = this.ctx, t = c.currentTime;
    const n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); n.buffer = this.noise; n.loop = true;
    f.type = 'bandpass'; f.Q.value = 2.5; f.frequency.setValueAtTime(350, t); f.frequency.linearRampToValueAtTime(700, t + 0.6); f.frequency.linearRampToValueAtTime(300, t + 1.6);
    n.connect(f); f.connect(g); g.connect(this.master); this.env(g, t, 0.25, 0.7, 1.8); n.start(t); n.stop(t + 2);
  },
  boo() {
    if (!this.ctx || Match.mode === 'demo') return; const c = this.ctx, t = c.currentTime;
    const n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); n.buffer = this.noise; n.loop = true;
    f.type = 'lowpass'; f.frequency.value = 380; n.connect(f); f.connect(g); g.connect(this.master); this.env(g, t, 0.3, 0.6, 1.6); n.start(t); n.stop(t + 1.8);
  },
  click() {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = 660; o.connect(g); g.connect(this.master); this.env(g, t, 0.003, 0.08, 0.07); o.start(t); o.stop(t + 0.09);
  }
};

// ============================ ДАННЫЕ: ПОЗИЦИИ И ТАКТИКИ ============================
// Шаблоны атрибутов по позиции: смещение от общего рейтинга
const POS_T = {
  GK: { pac: -38, sho: -60, pas: -30, dri: -40, def: -50, phy: -15 },
  CB: { pac: -14, sho: -42, pas: -14, dri: -18, def: 3, phy: 2 },
  FB: { pac: 3, sho: -30, pas: -6, dri: -6, def: -3, phy: -6 },
  DM: { pac: -10, sho: -16, pas: -1, dri: -6, def: 2, phy: 1 },
  CM: { pac: -8, sho: -7, pas: 2, dri: 0, def: -12, phy: -5 },
  AM: { pac: -4, sho: -2, pas: 3, dri: 3, def: -36, phy: -14 },
  W: { pac: 5, sho: -3, pas: -3, dri: 3, def: -45, phy: -12 },
  ST: { pac: 1, sho: 4, pas: -9, dri: -1, def: -48, phy: 0 }
};
const POS_GROUP = { GK: 'GK', CB: 'CB', LB: 'FB', RB: 'FB', LWB: 'FB', RWB: 'FB', CDM: 'DM', CM: 'CM', CAM: 'AM', LM: 'W', RM: 'W', LW: 'W', RW: 'W', ST: 'ST' };
const POS_RU = { GK: 'ВРТ', CB: 'ЦЗ', LB: 'ЛЗ', RB: 'ПЗ', LWB: 'ЛФЗ', RWB: 'ПФЗ', CDM: 'ОП', CM: 'ЦП', CAM: 'ЦАП', LM: 'ЛП', RM: 'ПП', LW: 'ЛВ', RW: 'ПВ', ST: 'ФРВ' };
const POS_NAME_RU = { GK: 'Вратарь', CB: 'Центральный защитник', LB: 'Левый защитник', RB: 'Правый защитник', LWB: 'Левый латераль', RWB: 'Правый латераль', CDM: 'Опорный полузащитник', CM: 'Центральный полузащитник', CAM: 'Атакующий полузащитник', LM: 'Левый полузащитник', RM: 'Правый полузащитник', LW: 'Левый вингер', RW: 'Правый вингер', ST: 'Нападающий' };
const ATTR_RU = { pac: 'Скорость', sho: 'Удар', pas: 'Пас', dri: 'Дриблинг', def: 'Защита', phy: 'Физика' };

function posPenalty(p, s) {
  if (p === s) return 0;
  const pair = p + '>' + s, sides = { LB: 'LWB', LWB: 'LB', RB: 'RWB', RWB: 'RB', LW: 'LM', LM: 'LW', RW: 'RM', RM: 'RW' };
  if (sides[p] === s) return 0;
  if (p === 'GK' || s === 'GK') return 60;
  const g1 = POS_GROUP[p], g2 = POS_GROUP[s];
  if (g1 === g2) return g1 === 'FB' || g1 === 'W' ? 4 : 2;
  const near = { 'DM>CM': 2, 'CM>DM': 3, 'CM>AM': 3, 'AM>CM': 3, 'AM>ST': 5, 'ST>AM': 6, 'W>AM': 5, 'AM>W': 4, 'W>ST': 5, 'ST>W': 6, 'CB>DM': 7, 'DM>CB': 6, 'FB>CB': 7, 'CB>FB': 8, 'FB>W': 8, 'W>FB': 12, 'CM>W': 7 };
  return near[g1 + '>' + g2] ?? (pair ? 16 : 16);
}

// Схемы: [позиция, fx (0 — свои ворота, 1 — чужие), fy (0 — правый фланг, 1 — левый)]
const FORMATIONS = {
  '4-3-3': [['GK', .03, .5], ['RB', .24, .12], ['CB', .2, .37], ['CB', .2, .63], ['LB', .24, .88], ['CDM', .35, .5], ['CM', .44, .3], ['CM', .44, .7], ['RW', .62, .14], ['ST', .67, .5], ['LW', .62, .86]],
  '4-2-3-1': [['GK', .03, .5], ['RB', .24, .12], ['CB', .2, .37], ['CB', .2, .63], ['LB', .24, .88], ['CDM', .35, .38], ['CDM', .35, .62], ['RW', .56, .14], ['CAM', .53, .5], ['LW', .56, .86], ['ST', .68, .5]],
  '4-4-2': [['GK', .03, .5], ['RB', .24, .12], ['CB', .2, .37], ['CB', .2, .63], ['LB', .24, .88], ['RM', .44, .12], ['CM', .4, .38], ['CM', .4, .62], ['LM', .44, .88], ['ST', .64, .4], ['ST', .64, .6]],
  '4-1-4-1': [['GK', .03, .5], ['RB', .24, .12], ['CB', .2, .37], ['CB', .2, .63], ['LB', .24, .88], ['CDM', .32, .5], ['RM', .48, .13], ['CM', .46, .38], ['CM', .46, .62], ['LM', .48, .87], ['ST', .67, .5]],
  '3-5-2': [['GK', .03, .5], ['CB', .2, .28], ['CB', .18, .5], ['CB', .2, .72], ['RWB', .38, .08], ['CDM', .35, .5], ['CM', .44, .32], ['CM', .44, .68], ['LWB', .38, .92], ['ST', .64, .4], ['ST', .64, .6]],
  '3-4-2-1': [['GK', .03, .5], ['CB', .2, .28], ['CB', .18, .5], ['CB', .2, .72], ['RWB', .38, .08], ['CM', .37, .4], ['CM', .37, .6], ['LWB', .38, .92], ['CAM', .55, .3], ['CAM', .55, .7], ['ST', .68, .5]],
  '5-3-2': [['GK', .03, .5], ['RWB', .26, .08], ['CB', .18, .3], ['CB', .16, .5], ['CB', .18, .7], ['LWB', .26, .92], ['CM', .37, .3], ['CDM', .34, .5], ['CM', .37, .7], ['ST', .58, .42], ['ST', .58, .58]]
};
const STYLES = {
  balanced: { name: 'Баланс', line: 50, width: 55, press: 50, tempo: 55, counter: 0.4, cross: 0.4, desc: 'Команда держит компактный блок, атакует при удобном моменте и не рискует понапрасну.' },
  pressing: { name: 'Высокий прессинг', line: 78, width: 60, press: 88, tempo: 70, counter: 0.6, cross: 0.4, desc: 'Агрессивный отбор на чужой половине. Мяч отнимают быстро, но за спиной защитников остаётся пространство.' },
  possession: { name: 'Владение', line: 66, width: 72, press: 62, tempo: 30, counter: 0.15, cross: 0.25, desc: 'Короткий пас и терпеливый розыгрыш. Риск минимальный, мяч у своих ног как можно дольше.' },
  counter: { name: 'Контратаки', line: 30, width: 45, press: 35, tempo: 85, counter: 1, cross: 0.45, desc: 'Глубокая оборона и молниеносный выход в атаку после отбора, нападающие сразу уходят в прорыв.' },
  wings: { name: 'Игра через фланги', line: 55, width: 88, press: 55, tempo: 60, counter: 0.45, cross: 0.85, desc: 'Широкая атака, крайние уходят к лицевой и навешивают в штрафную.' },
  bus: { name: 'Автобус', line: 10, width: 35, press: 18, tempo: 60, counter: 0.7, cross: 0.3, desc: 'Все за линией мяча. Минимум пространства у своих ворот и редкие выпады вперёд.' }
};

// ============================ ДАННЫЕ: КЛУБЫ И ИГРОКИ ============================
// Игрок: [фамилия, позиция, номер, рейтинг, кожа 0-5, причёска, цвет волос, борода 0-2, сильные стороны, рост]
// Причёски: bz — ёжик, sh — короткая, cu — кудри, af — афро, lo — длинные, lc — длинные кудри, bd — лысый,
//           bn — пучок, dr — дреды/косички, mo — андеркат, pt — зачёс.  Цвет: k чёрный, d тёмно-каштан., b русый, l блонд, r рыжий, w платина, g седой
// Сильные стороны: p скорость, s удар, k пас, d дриблинг, t отбор, h физика
const KIT = (s, s2, p, sh, so, n) => ({ s, s2, p, sh, so, n });
const TEAMS = [
  { id: 'rma', name: 'Реал Мадрид', short: 'RMA', league: 'Ла Лига · Испания', stadium: 'Сантьяго Бернабеу', formation: '4-3-3', style: 'balanced',
    home: KIT('#f6f6f4', '#d4af37', 'plain', '#f6f6f4', '#f6f6f4', '#1c2a4a'), away: KIT('#1c2a48', '#c9a24a', 'plain', '#1c2a48', '#1c2a48', '#e8d38d'), gk: '#2fa46a',
    players: [
      ['Куртуа', 'GK', 1, 89, 1, 'sh', 'd', 1, '', 200], ['Лунин', 'GK', 13, 80, 1, 'sh', 'l', 0],
      ['Карвахаль', 'RB', 2, 84, 1, 'sh', 'd', 1, 't'], ['Александер-Арнольд', 'RB', 12, 86, 3, 'bz', 'k', 1, 'k'],
      ['Милитао', 'CB', 3, 85, 3, 'bz', 'k', 1, 'p'], ['Хёйсен', 'CB', 24, 83, 1, 'sh', 'd', 0, 'k', 196], ['Рюдигер', 'CB', 22, 85, 5, 'bz', 'k', 2, 'h', 190],
      ['Каррерас', 'LB', 18, 82, 1, 'sh', 'd', 1, 'p'], ['Менди', 'LB', 23, 80, 5, 'bz', 'k', 1, 't'],
      ['Чуамени', 'CDM', 14, 86, 5, 'bz', 'k', 0, 'th', 188], ['Вальверде', 'CM', 8, 89, 1, 'sh', 'd', 1, 'ps'], ['Камавинга', 'CM', 6, 83, 5, 'dr', 'k', 0, 'd'],
      ['Беллингем', 'CAM', 5, 89, 4, 'sh', 'k', 0, 'sd', 186], ['Гюлер', 'CAM', 15, 84, 1, 'sh', 'd', 0, 'k'], ['Себальос', 'CM', 19, 79, 1, 'sh', 'd', 1, 'k'],
      ['Винисиус', 'LW', 7, 89, 5, 'sp', 'k', 0, 'pd'], ['Мбаппе', 'ST', 10, 91, 4, 'bz', 'k', 0, 'psd'], ['Родриго', 'RW', 11, 84, 4, 'sh', 'k', 0, 'd'],
      ['Мастантуоно', 'RW', 30, 78, 1, 'lo', 'd', 0, 'd'], ['Браим', 'CAM', 21, 80, 2, 'sh', 'k', 1, 'd'], ['Гонсало', 'ST', 16, 76, 1, 'sh', 'd', 0, 's']
    ] },
  { id: 'bar', name: 'Барселона', short: 'BAR', league: 'Ла Лига · Испания', stadium: 'Камп Ноу', formation: '4-2-3-1', style: 'pressing',
    home: KIT('#a50044', '#0b4ea2', 'stripes', '#0b3b80', '#0b3b80', '#ffd23f'), away: KIT('#171717', '#d4a017', 'plain', '#171717', '#171717', '#d4a017'), gk: '#f07c1b',
    players: [
      ['Жоан Гарсия', 'GK', 13, 85, 1, 'sh', 'd', 1], ['Тер Штеген', 'GK', 1, 85, 1, 'sh', 'l', 1],
      ['Кунде', 'RB', 23, 85, 4, 'af', 'k', 1, 'p'], ['Араухо', 'CB', 4, 83, 4, 'sh', 'k', 1, 'h', 188], ['Кубарси', 'CB', 5, 84, 1, 'sh', 'd', 0, 'k'],
      ['Эрик Гарсия', 'CB', 24, 80, 1, 'sh', 'd', 1, 'k'], ['Бальде', 'LB', 3, 82, 5, 'cu', 'k', 0, 'p'], ['Жерар Мартин', 'LB', 18, 76, 1, 'sh', 'd', 0],
      ['Педри', 'CM', 8, 90, 1, 'sh', 'd', 0, 'kd'], ['Френки де Йонг', 'CM', 21, 86, 1, 'pt', 'b', 0, 'kd'], ['Гави', 'CM', 6, 82, 1, 'sh', 'd', 0, 't'],
      ['Касадо', 'CDM', 17, 78, 1, 'sh', 'd', 0, 'k'], ['Фермин', 'CAM', 16, 82, 1, 'cu', 'd', 0, 's'], ['Ольмо', 'CAM', 20, 84, 1, 'sh', 'd', 1, 'd'],
      ['Ламин Ямаль', 'RW', 10, 91, 4, 'cu', 'k', 0, 'dkp'], ['Рафинья', 'LW', 11, 88, 3, 'bn', 'k', 1, 'sp'], ['Рэшфорд', 'LW', 14, 82, 4, 'bz', 'k', 1, 'p'],
      ['Левандовски', 'ST', 9, 86, 1, 'sh', 'd', 0, 'sh', 185], ['Ферран Торрес', 'ST', 7, 81, 1, 'sh', 'd', 1, 's']
    ] },
  { id: 'mci', name: 'Манчестер Сити', short: 'MCI', league: 'Премьер-лига · Англия', stadium: 'Этихад', formation: '4-1-4-1', style: 'possession',
    home: KIT('#6cabdd', '#1c2c5b', 'plain', '#ffffff', '#6cabdd', '#1c2c5b'), away: KIT('#13233f', '#6cabdd', 'plain', '#13233f', '#13233f', '#ffffff'), gk: '#e8e84a',
    players: [
      ['Доннарумма', 'GK', 25, 89, 1, 'sh', 'k', 1, '', 196], ['Трэффорд', 'GK', 1, 80, 1, 'sh', 'b', 0],
      ['Матеус Нунес', 'RB', 27, 82, 3, 'sh', 'k', 1, 'p'], ['Диаш', 'CB', 3, 88, 1, 'sh', 'd', 2, 'th'], ['Гвардиол', 'CB', 24, 87, 1, 'sh', 'd', 0, 'k'],
      ['Хусанов', 'CB', 45, 79, 1, 'sh', 'k', 0, 'p'], ['Аке', 'CB', 6, 82, 4, 'bz', 'k', 0], ['Стоунз', 'CB', 5, 83, 1, 'sh', 'b', 0, 'k'], ['О’Райли', 'LB', 33, 78, 3, 'cu', 'k', 0],
      ['Родри', 'CDM', 16, 90, 1, 'sh', 'd', 1, 'kt', 191], ['Рейндерс', 'CM', 4, 85, 2, 'sh', 'k', 1, 's'], ['Бернарду Силва', 'CM', 20, 86, 1, 'cu', 'd', 1, 'dk'],
      ['Ковачич', 'CM', 8, 83, 1, 'sh', 'd', 1, 'd'], ['Фоден', 'CAM', 47, 87, 1, 'bz', 'b', 0, 'ds'], ['Шерки', 'CAM', 10, 83, 3, 'cu', 'k', 0, 'dk'],
      ['Доку', 'LW', 11, 84, 5, 'bz', 'k', 0, 'pd'], ['Савиньо', 'RW', 26, 82, 4, 'sh', 'k', 0, 'd'],
      ['Холанд', 'ST', 9, 91, 0, 'bn', 'l', 0, 'sph', 195], ['Мармуш', 'ST', 7, 84, 2, 'cu', 'k', 1, 's']
    ] },
  { id: 'liv', name: 'Ливерпуль', short: 'LIV', league: 'Премьер-лига · Англия', stadium: 'Энфилд', formation: '4-2-3-1', style: 'pressing',
    home: KIT('#c8102e', '#f6eb61', 'plain', '#c8102e', '#c8102e', '#ffffff'), away: KIT('#f4f4f4', '#c8102e', 'plain', '#f4f4f4', '#f4f4f4', '#c8102e'), gk: '#11b5a5',
    players: [
      ['Алиссон', 'GK', 1, 89, 1, 'sh', 'd', 2, '', 193], ['Мамардашвили', 'GK', 25, 81, 1, 'sh', 'd', 0],
      ['Фримпонг', 'RB', 30, 83, 5, 'cu', 'k', 0, 'p'], ['Брэдли', 'RB', 12, 79, 1, 'sh', 'd', 0], ['Ван Дейк', 'CB', 4, 89, 4, 'sh', 'k', 2, 'th', 193],
      ['Конате', 'CB', 5, 85, 5, 'bz', 'k', 1, 'ph', 192], ['Керкез', 'LB', 6, 81, 1, 'pt', 'd', 0, 'p'], ['Робертсон', 'LB', 26, 83, 0, 'sh', 'b', 1, 'k'],
      ['Гравенберх', 'CDM', 38, 86, 4, 'dr', 'k', 0, 'd'], ['Макаллистер', 'CM', 10, 87, 1, 'cu', 'b', 0, 'k'], ['Собослаи', 'CM', 8, 86, 1, 'pt', 'b', 0, 'sk'],
      ['Джонс', 'CM', 17, 80, 4, 'cu', 'k', 0], ['Вирц', 'CAM', 7, 89, 1, 'sh', 'b', 0, 'dk'],
      ['Салах', 'RW', 11, 90, 3, 'lc', 'k', 2, 'psd'], ['Гакпо', 'LW', 18, 85, 4, 'bz', 'k', 0, 's'], ['Кьеза', 'RW', 14, 79, 1, 'sh', 'd', 0],
      ['Исак', 'ST', 9, 89, 4, 'sh', 'k', 1, 'sd', 192], ['Экитике', 'ST', 22, 85, 4, 'cu', 'k', 0, 'pd']
    ] },
  { id: 'ars', name: 'Арсенал', short: 'ARS', league: 'Премьер-лига · Англия', stadium: 'Эмирейтс', formation: '4-3-3', style: 'pressing',
    home: KIT('#db0007', '#ffffff', 'sleeves', '#ffffff', '#db0007', '#ffffff'), away: KIT('#18264a', '#c9b26d', 'plain', '#18264a', '#18264a', '#c9b26d'), gk: '#7c3aed',
    players: [
      ['Райя', 'GK', 1, 87, 1, 'sh', 'k', 1], ['Кепа', 'GK', 13, 80, 1, 'sh', 'd', 1],
      ['Тимбер', 'RB', 12, 84, 4, 'bz', 'k', 0, 't'], ['Салиба', 'CB', 2, 89, 5, 'bz', 'k', 0, 'tp', 192], ['Габриэл', 'CB', 6, 87, 3, 'sh', 'k', 2, 'h', 190],
      ['Инкапие', 'CB', 5, 82, 4, 'sh', 'k', 0], ['Калафьори', 'LB', 33, 82, 1, 'lo', 'b', 1, 'k'], ['Москера', 'CB', 3, 77, 1, 'sh', 'k', 0], ['Льюис-Скелли', 'LB', 49, 78, 4, 'cu', 'k', 0],
      ['Райс', 'CDM', 41, 88, 1, 'sh', 'b', 0, 'tk'], ['Субименди', 'CDM', 36, 86, 1, 'sh', 'd', 1, 'k'], ['Эдегор', 'CAM', 8, 87, 0, 'pt', 'b', 0, 'k'],
      ['Мерино', 'CM', 23, 83, 1, 'sh', 'd', 2, 'h'], ['Эзе', 'CAM', 10, 85, 4, 'bz', 'k', 1, 'd'],
      ['Сака', 'RW', 7, 89, 5, 'bz', 'k', 0, 'dk'], ['Мадуэке', 'RW', 20, 81, 4, 'bz', 'k', 0, 'd'], ['Мартинелли', 'LW', 11, 83, 2, 'cu', 'd', 0, 'p'],
      ['Троссар', 'LW', 19, 82, 1, 'sh', 'd', 1, 's'], ['Дьёкереш', 'ST', 14, 86, 1, 'sh', 'd', 1, 'psh', 187], ['Хаверц', 'ST', 29, 83, 1, 'sh', 'b', 0, 'h', 193]
    ] },
  { id: 'bay', name: 'Бавария', short: 'BAY', league: 'Бундеслига · Германия', stadium: 'Альянц Арена', formation: '4-2-3-1', style: 'pressing',
    home: KIT('#dc052d', '#ffffff', 'plain', '#dc052d', '#dc052d', '#ffffff'), away: KIT('#f2f2f2', '#dc052d', 'plain', '#f2f2f2', '#f2f2f2', '#0b1a3a'), gk: '#2fa46a',
    players: [
      ['Нойер', 'GK', 1, 86, 0, 'sh', 'l', 0, '', 193], ['Урбиг', 'GK', 40, 77, 1, 'sh', 'b', 0],
      ['Лаймер', 'RB', 27, 82, 1, 'sh', 'd', 1, 't'], ['Станишич', 'RB', 44, 79, 1, 'sh', 'd', 0], ['Упамекано', 'CB', 2, 85, 5, 'bz', 'k', 0, 'p', 186],
      ['Та', 'CB', 4, 86, 4, 'bz', 'k', 1, 'h', 195], ['Ким Мин Джэ', 'CB', 3, 83, 2, 'sh', 'k', 0, 'h'], ['Дэвис', 'LB', 19, 83, 5, 'bz', 'k', 0, 'p'], ['Ито', 'LB', 21, 80, 2, 'sh', 'k', 0],
      ['Киммих', 'CDM', 6, 88, 0, 'pt', 'b', 0, 'k'], ['Павлович', 'CM', 45, 83, 1, 'sh', 'd', 0, 'k'], ['Горецка', 'CM', 8, 83, 1, 'pt', 'd', 1, 'h'],
      ['Мусиала', 'CAM', 10, 89, 4, 'cu', 'k', 0, 'd'], ['Олисе', 'RW', 17, 89, 4, 'bz', 'k', 0, 'dk'], ['Луис Диас', 'LW', 14, 87, 3, 'cu', 'k', 0, 'pd'],
      ['Гнабри', 'LW', 7, 82, 4, 'bz', 'k', 1, 's'], ['Карль', 'RW', 42, 77, 1, 'sh', 'b', 0, 'd'],
      ['Кейн', 'ST', 9, 91, 1, 'sh', 'b', 0, 'skh', 188], ['Джексон', 'ST', 11, 80, 5, 'bz', 'k', 0, 'p']
    ] },
  { id: 'psg', name: 'ПСЖ', short: 'PSG', league: 'Лига 1 · Франция', stadium: 'Парк де Пренс', formation: '4-3-3', style: 'pressing',
    home: KIT('#0b1f4d', '#da291c', 'band', '#0b1f4d', '#0b1f4d', '#ffffff'), away: KIT('#f2f2f2', '#0b1f4d', 'band', '#f2f2f2', '#f2f2f2', '#0b1f4d'), gk: '#e8e84a',
    players: [
      ['Шевалье', 'GK', 30, 84, 1, 'sh', 'd', 1], ['Сафонов', 'GK', 39, 81, 1, 'sh', 'b', 0, '', 192],
      ['Хакими', 'RB', 2, 88, 3, 'sh', 'k', 0, 'pd'], ['Маркиньос', 'CB', 5, 86, 2, 'sh', 'k', 2, 't'], ['Пачо', 'CB', 51, 85, 5, 'bz', 'k', 0, 'h'],
      ['Забарный', 'CB', 6, 82, 1, 'sh', 'd', 0, 'h'], ['Бералдо', 'CB', 4, 79, 2, 'sh', 'k', 0], ['Нуну Мендеш', 'LB', 25, 87, 5, 'bz', 'k', 0, 'pd'],
      ['Витинья', 'CM', 17, 89, 1, 'bz', 'd', 1, 'kd'], ['Жуан Невеш', 'CM', 87, 87, 1, 'cu', 'd', 0, 'tk'], ['Фабиан Руис', 'CM', 8, 85, 1, 'bn', 'd', 2, 'k'],
      ['Заир-Эмери', 'CM', 33, 80, 5, 'bz', 'k', 0], ['Ли Кан Ин', 'CAM', 19, 81, 2, 'sh', 'k', 0, 'k'],
      ['Дембеле', 'RW', 10, 90, 5, 'bz', 'k', 1, 'pds'], ['Кварацхелия', 'LW', 7, 88, 1, 'lc', 'd', 0, 'd'], ['Дуэ', 'RW', 14, 86, 4, 'cu', 'k', 0, 'd'],
      ['Баркола', 'LW', 29, 84, 4, 'dr', 'k', 0, 'p'], ['Гонсалу Рамуш', 'ST', 9, 81, 1, 'sh', 'd', 1, 's']
    ] },
  { id: 'int', name: 'Интер', short: 'INT', league: 'Серия А · Италия', stadium: 'Сан-Сиро', formation: '3-5-2', style: 'balanced',
    home: KIT('#0068a8', '#101010', 'stripes', '#101010', '#101010', '#ffffff'), away: KIT('#f4f4f4', '#0068a8', 'plain', '#f4f4f4', '#f4f4f4', '#0068a8'), gk: '#f07c1b',
    players: [
      ['Зоммер', 'GK', 1, 85, 0, 'sh', 'd', 0], ['Жозеп Мартинес', 'GK', 13, 79, 1, 'sh', 'd', 1],
      ['Биссек', 'CB', 31, 82, 4, 'sh', 'k', 0, 'h', 196], ['Аканджи', 'CB', 25, 84, 4, 'bz', 'k', 0, 'p'], ['Ачерби', 'CB', 15, 82, 1, 'bd', 'd', 1, 'h'],
      ['Бастони', 'CB', 95, 87, 1, 'sh', 'd', 1, 'k', 190], ['Де Врей', 'CB', 6, 81, 1, 'sh', 'b', 0],
      ['Думфрис', 'RWB', 2, 85, 4, 'bz', 'k', 0, 'ph', 188], ['Димарко', 'LWB', 32, 85, 1, 'sh', 'd', 1, 'k'],
      ['Барелла', 'CM', 23, 87, 1, 'sh', 'd', 0, 'tk'], ['Чалханоглу', 'CDM', 20, 86, 1, 'bz', 'd', 2, 'ks'], ['Мхитарян', 'CM', 22, 82, 1, 'bd', 'd', 1, 'k'],
      ['Фраттези', 'CM', 16, 81, 1, 'sh', 'd', 0, 's'], ['Сучич', 'CM', 8, 79, 1, 'sh', 'b', 0, 'k'],
      ['Лаутаро Мартинес', 'ST', 10, 89, 2, 'sh', 'k', 2, 'sh'], ['Тюрам', 'ST', 9, 86, 5, 'bz', 'k', 1, 'ph', 192], ['Бонни', 'ST', 14, 79, 5, 'bz', 'k', 0, 'p'],
      ['Эспозито', 'ST', 94, 77, 1, 'sh', 'd', 0, 'h', 191]
    ] },
  { id: 'che', name: 'Челси', short: 'CHE', league: 'Премьер-лига · Англия', stadium: 'Стэмфорд Бридж', formation: '4-2-3-1', style: 'possession',
    home: KIT('#034694', '#ffffff', 'plain', '#034694', '#ffffff', '#ffffff'), away: KIT('#efe9d8', '#034694', 'plain', '#efe9d8', '#efe9d8', '#034694'), gk: '#11b5a5',
    players: [
      ['Санчес', 'GK', 1, 82, 1, 'sh', 'd', 1, '', 197], ['Йоргенсен', 'GK', 12, 79, 1, 'sh', 'l', 0],
      ['Джеймс', 'RB', 24, 85, 4, 'bz', 'k', 1, 'kh'], ['Гюсто', 'RB', 27, 81, 4, 'cu', 'k', 0, 'p'], ['Фофана', 'CB', 29, 81, 5, 'bz', 'k', 0, 'p'],
      ['Чалоба', 'CB', 23, 81, 4, 'bz', 'k', 0], ['Колуилл', 'CB', 6, 82, 1, 'sh', 'b', 0, 'k'], ['Бадьяшиль', 'CB', 5, 79, 5, 'bz', 'k', 0],
      ['Кукурелья', 'LB', 3, 84, 1, 'lc', 'd', 0, 't'], ['Кайседо', 'CDM', 25, 88, 4, 'sh', 'k', 0, 'tp'], ['Энцо Фернандес', 'CM', 8, 86, 1, 'sh', 'd', 1, 'k'],
      ['Лавия', 'CDM', 45, 80, 4, 'bz', 'k', 0, 't'], ['Палмер', 'CAM', 10, 88, 1, 'sh', 'r', 0, 'sk'],
      ['Педру Нету', 'LW', 7, 83, 1, 'sh', 'k', 0, 'p'], ['Эстевао', 'RW', 41, 83, 4, 'cu', 'k', 0, 'd'], ['Гарначо', 'LW', 49, 81, 1, 'mo', 'd', 0, 'p'],
      ['Жоао Педро', 'ST', 20, 84, 4, 'sh', 'k', 0, 'd'], ['Делап', 'ST', 9, 80, 1, 'sh', 'd', 0, 'h']
    ] },
  { id: 'mun', name: 'Манчестер Юнайтед', short: 'MUN', league: 'Премьер-лига · Англия', stadium: 'Олд Траффорд', formation: '4-2-3-1', style: 'counter',
    home: KIT('#da291c', '#111111', 'plain', '#ffffff', '#111111', '#ffffff'), away: KIT('#0f1d3b', '#da291c', 'plain', '#0f1d3b', '#0f1d3b', '#ffffff'), gk: '#7c3aed',
    players: [
      ['Ламменс', 'GK', 31, 80, 1, 'sh', 'b', 0, '', 194], ['Байындыр', 'GK', 1, 75, 1, 'sh', 'k', 1],
      ['Далот', 'RB', 2, 81, 1, 'sh', 'k', 1, 'p'], ['Мазрауи', 'RB', 3, 80, 3, 'sh', 'k', 1], ['Де Лихт', 'CB', 4, 83, 1, 'sh', 'l', 0, 'h', 189],
      ['Магуайр', 'CB', 5, 80, 1, 'sh', 'b', 1, 'h', 194], ['Лисандро Мартинес', 'CB', 6, 84, 1, 'sh', 'k', 1, 't'], ['Йоро', 'CB', 15, 79, 5, 'bz', 'k', 0, 'p'],
      ['Шоу', 'LB', 23, 79, 1, 'sh', 'b', 0], ['Доргу', 'LB', 13, 78, 4, 'bz', 'k', 0, 'p'],
      ['Каземиро', 'CDM', 18, 81, 3, 'bz', 'k', 1, 't'], ['Угарте', 'CDM', 25, 79, 1, 'sh', 'd', 1, 't'], ['Майну', 'CM', 37, 80, 4, 'cu', 'k', 0, 'd'],
      ['Бруну Фернандеш', 'CAM', 8, 87, 1, 'sh', 'd', 2, 'ks'], ['Мбемо', 'RW', 19, 85, 5, 'bz', 'k', 0, 's'], ['Кунья', 'LW', 10, 84, 3, 'sh', 'k', 1, 'ds'],
      ['Амад', 'RW', 16, 82, 5, 'cu', 'k', 0, 'd'], ['Шешко', 'ST', 30, 82, 1, 'sh', 'd', 0, 'ph', 195], ['Зиркзе', 'ST', 11, 78, 1, 'bn', 'd', 0]
    ] },
  { id: 'juv', name: 'Ювентус', short: 'JUV', league: 'Серия А · Италия', stadium: 'Альянц Стэдиум', formation: '3-4-2-1', style: 'balanced',
    home: KIT('#f8f8f8', '#111111', 'stripes', '#ffffff', '#ffffff', '#111111'), away: KIT('#1c2a4d', '#f0c419', 'plain', '#1c2a4d', '#1c2a4d', '#f0c419'), gk: '#ff5fa2',
    players: [
      ['Ди Грегорио', 'GK', 29, 83, 1, 'sh', 'd', 1], ['Перин', 'GK', 1, 78, 1, 'sh', 'd', 1],
      ['Калулу', 'CB', 15, 81, 5, 'bz', 'k', 0, 'p'], ['Бремер', 'CB', 3, 86, 4, 'bz', 'k', 1, 'th'], ['Гатти', 'CB', 4, 80, 1, 'sh', 'd', 1, 'h'], ['Келли', 'CB', 6, 79, 4, 'bz', 'k', 0],
      ['Камбьязо', 'LWB', 27, 82, 1, 'sh', 'd', 0, 'k'], ['Жоао Марио', 'RWB', 25, 76, 4, 'bz', 'k', 0, 'p'],
      ['Локателли', 'CDM', 5, 82, 1, 'sh', 'd', 1, 'k'], ['Тюрам', 'CM', 19, 82, 5, 'bz', 'k', 0, 'h'], ['Копмейнерс', 'CM', 8, 81, 1, 'sh', 'b', 0, 's'], ['Маккенни', 'CM', 22, 79, 4, 'bz', 'k', 0, 'h'],
      ['Йылдыз', 'CAM', 10, 86, 1, 'sh', 'd', 0, 'dk'], ['Консейсао', 'RW', 7, 82, 1, 'sh', 'd', 0, 'd'], ['Жегрова', 'RW', 11, 81, 1, 'sh', 'k', 1, 'd'],
      ['Влахович', 'ST', 9, 83, 1, 'bn', 'd', 1, 'sh', 190], ['Джонатан Дэвид', 'ST', 30, 82, 4, 'bz', 'k', 0, 's'], ['Опенда', 'ST', 20, 80, 4, 'bz', 'k', 0, 'p']
    ] },
  { id: 'atm', name: 'Атлетико Мадрид', short: 'ATM', league: 'Ла Лига · Испания', stadium: 'Метрополитано', formation: '4-4-2', style: 'counter',
    home: KIT('#cb3524', '#ffffff', 'stripes', '#272e61', '#cb3524', '#272e61'), away: KIT('#1d2a4a', '#cb3524', 'plain', '#1d2a4a', '#1d2a4a', '#ffffff'), gk: '#e8e84a',
    players: [
      ['Облак', 'GK', 13, 87, 1, 'sh', 'd', 1, '', 188], ['Муссо', 'GK', 1, 77, 1, 'sh', 'd', 1],
      ['Льоренте', 'RB', 14, 82, 1, 'sh', 'd', 1, 'p'], ['Молина', 'RB', 16, 81, 1, 'sh', 'k', 1, 'p'], ['Ле Норман', 'CB', 24, 82, 1, 'sh', 'd', 1, 'h'],
      ['Хименес', 'CB', 2, 82, 1, 'sh', 'd', 2, 'h'], ['Ленгле', 'CB', 15, 78, 1, 'sh', 'd', 1], ['Ганцко', 'LB', 17, 82, 1, 'sh', 'b', 0, 't'], ['Руджери', 'LB', 3, 78, 1, 'sh', 'd', 0],
      ['Коке', 'CM', 6, 81, 1, 'sh', 'd', 1, 'k'], ['Барриос', 'CDM', 8, 83, 1, 'sh', 'd', 0, 't'], ['Баэна', 'LM', 10, 84, 1, 'sh', 'd', 0, 'k'],
      ['Джулиано Симеоне', 'RM', 20, 80, 1, 'lo', 'd', 0, 'p'], ['Нико Гонсалес', 'LM', 23, 79, 1, 'sh', 'd', 1], ['Альмада', 'CAM', 11, 80, 1, 'sh', 'k', 0, 'd'],
      ['Хулиан Альварес', 'ST', 19, 88, 1, 'sh', 'd', 0, 'sk'], ['Сёрлот', 'ST', 9, 82, 0, 'lo', 'l', 0, 'h', 195], ['Гризманн', 'ST', 7, 83, 1, 'sh', 'b', 1, 'k']
    ] },
  { id: 'bvb', name: 'Боруссия Дортмунд', short: 'BVB', league: 'Бундеслига · Германия', stadium: 'Сигнал Идуна Парк', formation: '3-4-2-1', style: 'counter',
    home: KIT('#fde100', '#111111', 'plain', '#111111', '#fde100', '#111111'), away: KIT('#141414', '#fde100', 'plain', '#141414', '#141414', '#fde100'), gk: '#2fa46a',
    players: [
      ['Кобель', 'GK', 1, 86, 1, 'sh', 'b', 0, '', 194], ['Майер', 'GK', 33, 72, 1, 'sh', 'd', 0],
      ['Антон', 'CB', 3, 82, 1, 'sh', 'd', 0, 'h'], ['Шлоттербек', 'CB', 4, 84, 1, 'sh', 'b', 0, 'k'], ['Зюле', 'CB', 25, 79, 1, 'bz', 'd', 1, 'h', 195],
      ['Бенсебаини', 'CB', 5, 78, 3, 'sh', 'k', 1], ['Рерсон', 'RWB', 26, 79, 0, 'sh', 'b', 0, 'p'], ['Свенссон', 'LWB', 24, 78, 1, 'sh', 'b', 0],
      ['Нмеча', 'CM', 8, 81, 4, 'bz', 'k', 0, 'd'], ['Забитцер', 'CM', 20, 80, 1, 'sh', 'b', 1, 's'], ['Гросс', 'CM', 13, 80, 1, 'sh', 'b', 0, 'k'],
      ['Джоб Беллингем', 'CM', 7, 78, 4, 'sh', 'k', 0], ['Брандт', 'CAM', 10, 82, 1, 'sh', 'b', 0, 'k'], ['Байер', 'CAM', 14, 81, 1, 'sh', 'b', 0, 'p'],
      ['Адейеми', 'LW', 27, 80, 4, 'bz', 'k', 0, 'p'], ['Гирасси', 'ST', 9, 86, 5, 'bz', 'k', 1, 'sh', 187]
    ] },
  { id: 'mil', name: 'Милан', short: 'MIL', league: 'Серия А · Италия', stadium: 'Сан-Сиро', formation: '3-5-2', style: 'balanced',
    home: KIT('#fb090b', '#111111', 'stripes', '#ffffff', '#111111', '#ffffff'), away: KIT('#f4f4f4', '#fb090b', 'plain', '#f4f4f4', '#f4f4f4', '#111111'), gk: '#11b5a5',
    players: [
      ['Меньян', 'GK', 16, 87, 5, 'bz', 'k', 1, '', 191], ['Терраччано', 'GK', 1, 74, 1, 'sh', 'd', 1],
      ['Томори', 'CB', 23, 81, 4, 'bz', 'k', 0, 'p'], ['Габбия', 'CB', 46, 80, 1, 'sh', 'd', 1], ['Павлович', 'CB', 31, 80, 1, 'bz', 'd', 1, 'h', 194], ['Де Винтер', 'CB', 5, 79, 1, 'sh', 'd', 0],
      ['Салемакерс', 'RWB', 56, 80, 1, 'sh', 'b', 0], ['Эступиньян', 'LWB', 2, 79, 4, 'bz', 'k', 0, 'k'], ['Бартезаги', 'LWB', 33, 76, 1, 'sh', 'd', 0],
      ['Модрич', 'CM', 14, 85, 0, 'lo', 'b', 0, 'k'], ['Фофана', 'CM', 19, 81, 5, 'bz', 'k', 0, 't'], ['Рабьо', 'CM', 12, 83, 1, 'bn', 'd', 1, 'h', 188],
      ['Риччи', 'CDM', 4, 79, 1, 'sh', 'd', 0, 'k'], ['Лофтус-Чик', 'CM', 8, 79, 4, 'bz', 'k', 0, 'h'],
      ['Пулишич', 'RW', 11, 84, 1, 'sh', 'b', 0, 'd'], ['Леау', 'LW', 10, 85, 4, 'sh', 'k', 1, 'pd'], ['Нкунку', 'ST', 18, 81, 5, 'bz', 'k', 0, 'd'], ['Хименес', 'ST', 7, 80, 1, 'sh', 'k', 0, 's']
    ] }
];
const TEAM_BY_ID = Object.fromEntries(TEAMS.map(t => [t.id, t]));

const SKIN = ['#f4d3b8', '#e9b996', '#d39b72', '#b77b52', '#8a5636', '#5b3622'];
const HAIR_COL = { k: '#16110e', d: '#3a2618', b: '#7a5534', l: '#d9b56a', r: '#b4592b', w: '#e9e4d4', g: '#9a9a96' };
const HAIR_STYLES = { bz: 'Ёжик', sh: 'Короткая', cu: 'Кудри', af: 'Афро', lo: 'Длинные', lc: 'Длинные кудри', bd: 'Лысый', bn: 'Пучок', dr: 'Дреды', mo: 'Андеркат', pt: 'Зачёс', sp: 'Твисты' };
const BOOTS = ['#f5f5f5', '#111111', '#ff3d7f', '#39e46b', '#ffd23a', '#2f7bff', '#ff7a1a'];
const NATIONS = ['Англия', 'Аргентина', 'Армения', 'Азербайджан', 'Беларусь', 'Бельгия', 'Бразилия', 'Германия', 'Грузия', 'Египет', 'Испания', 'Италия', 'Казахстан', 'Корея', 'Кыргызстан', 'Марокко', 'Мексика', 'Нигерия', 'Нидерланды', 'Норвегия', 'Польша', 'Португалия', 'Россия', 'Сенегал', 'Сербия', 'США', 'Таджикистан', 'Туркменистан', 'Турция', 'Узбекистан', 'Украина', 'Франция', 'Хорватия', 'Япония'];

// Сборка игрока из строки данных
function makeInfo(row, teamId) {
  const [name, pos, num, ovr, skin, hair, hc, beard, traits = '', h = 0] = row;
  const seed = seeded(hashStr(name + teamId)), t = POS_T[POS_GROUP[pos]];
  const attr = {};
  for (const k of ['pac', 'sho', 'pas', 'dri', 'def', 'phy']) attr[k] = clamp(Math.round(ovr + t[k] + (seed() - 0.5) * 6), 20, 97);
  const tmap = { p: 'pac', s: 'sho', k: 'pas', d: 'dri', t: 'def', h: 'phy' };
  for (const c of traits) if (tmap[c]) attr[tmap[c]] = clamp(attr[tmap[c]] + 5, 20, 98);
  if (pos === 'GK') attr.gk = ovr;
  const height = h || (pos === 'GK' ? 190 : pos === 'CB' ? 187 : POS_GROUP[pos] === 'W' ? 175 : 181) + Math.round((seed() - 0.5) * 6);
  const celeb = ['jump', 'slide', 'plane', 'arms', 'fist'][Math.floor(seed() * 5)];
  return { id: teamId + '_' + num + '_' + name, name, pos, num, ovr, attr, look: { skin, hair, hc, beard, h: height, boots: BOOTS[Math.floor(seed() * BOOTS.length)] }, celeb, teamId };
}
TEAMS.forEach(t => { t.roster = t.players.map(r => makeInfo(r, t.id)); });

function teamRatings(team, lineup) {
  const xi = lineup || autoLineup(team, team.formation).map(i => team.roster[i]);
  const avg = arr => arr.length ? Math.round(arr.reduce((a, p) => a + p.ovr, 0) / arr.length) : 70;
  const g = p => POS_GROUP[p.pos];
  return {
    att: avg(xi.filter(p => g(p) === 'ST' || g(p) === 'W')),
    mid: avg(xi.filter(p => ['DM', 'CM', 'AM'].includes(g(p)))),
    def: avg(xi.filter(p => g(p) === 'CB' || g(p) === 'FB' || g(p) === 'GK')),
    ovr: avg(xi)
  };
}

// Подбор лучшего состава под схему (жадный по слотам)
// глобальный жадный подбор: сначала самые сильные пары «игрок — позиция»
function bestAssign(items, slots, ovrOf, posOf, fixed = new Map()) {
  const pairs = [], res = new Array(slots.length).fill(-1), used = new Set();
  for (const [i, si] of fixed) { res[si] = i; used.add(i); }
  items.forEach((it, i) => { if (used.has(i)) return; slots.forEach((s, si) => { if (res[si] === -1) pairs.push({ i, si, v: ovrOf(it) - posPenalty(posOf(it), s[0]) * 1.5 }); }); });
  pairs.sort((a, b) => b.v - a.v);
  for (const pr of pairs) { if (res[pr.si] !== -1 || used.has(pr.i)) continue; res[pr.si] = pr.i; used.add(pr.i); }
  return res;
}
function autoLineup(team, formation, roster = team.roster) {
  return bestAssign(roster, FORMATIONS[formation], p => (p.redOut ? -999 : p.ovr), p => p.pos);
}
function kitFor(team, other) {
  if (!other) return team.home;
  const a = team.home, b = other.home;
  if (colorDist(a.s, b.s) < 120 || (colorDist(a.s, b.s) < 170 && colorDist(a.sh, b.sh) < 120)) return team.away;
  return team.home;
}
// ============================ РЕНДЕР: КАМЕРА И ПРОЕКЦИЯ ============================
const canvas = $('game');
const ctx = canvas.getContext('2d');
let W = 1280, H = 720, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = Math.max(320, window.innerWidth); H = Math.max(240, window.innerHeight);
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);

const Cam = {
  px: CX, py: -40, pz: 24, tx: CX, ty: 34, tz: 0,
  dpx: CX, dpy: -40, dpz: 24, dtx: CX, dty: 34, dtz: 0,
  zoom: 1, dzoom: 1, stiff: 3, shake: 0, sx: 0, sy: 0,
  fx: 0, fy: 1, fz: 0, rx: 1, ry: 0, ux: 0, uy: 0, uz: 1, focal: 1000,
  want(px, py, pz, tx, ty, tz, zoom = 1, stiff = 3) { this.dpx = px; this.dpy = py; this.dpz = pz; this.dtx = tx; this.dty = ty; this.dtz = tz; this.dzoom = zoom; this.stiff = stiff; },
  snap() { this.px = this.dpx; this.py = this.dpy; this.pz = this.dpz; this.tx = this.dtx; this.ty = this.dty; this.tz = this.dtz; this.zoom = this.dzoom; this.basis(); },
  update(dt) {
    const k = 1 - Math.exp(-this.stiff * dt);
    this.px += (this.dpx - this.px) * k; this.py += (this.dpy - this.py) * k; this.pz += (this.dpz - this.pz) * k;
    this.tx += (this.dtx - this.tx) * k; this.ty += (this.dty - this.ty) * k; this.tz += (this.dtz - this.tz) * k;
    this.zoom += (this.dzoom - this.zoom) * k;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.sx = this.shake ? (Math.random() - 0.5) * this.shake * 14 : 0; this.sy = this.shake ? (Math.random() - 0.5) * this.shake * 14 : 0;
    this.basis();
  },
  basis() {
    let fx = this.tx - this.px, fy = this.ty - this.py, fz = this.tz - this.pz;
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    let rx = fy, ry = -fx; const rl = Math.hypot(rx, ry) || 1; rx /= rl; ry /= rl;
    this.fx = fx; this.fy = fy; this.fz = fz; this.rx = rx; this.ry = ry;
    this.ux = ry * fz; this.uy = -rx * fz; this.uz = rx * fy - ry * fx;
    this.focal = Math.max(W, H * 1.25) * 1.95 * this.zoom * (Settings.cam || 1);
  }
};
const NEAR = 0.6;
const PP = { x: 0, y: 0, s: 0, d: 0 };
function toCam(x, y, z) {
  const dx = x - Cam.px, dy = y - Cam.py, dz = z - Cam.pz;
  return [dx * Cam.rx + dy * Cam.ry, dx * Cam.ux + dy * Cam.uy + dz * Cam.uz, dx * Cam.fx + dy * Cam.fy + dz * Cam.fz];
}
function projP(x, y, z) { // быстрая проекция в общий объект PP
  const dx = x - Cam.px, dy = y - Cam.py, dz = z - Cam.pz;
  const zc = dx * Cam.fx + dy * Cam.fy + dz * Cam.fz; if (zc < NEAR) return false;
  const k = Cam.focal / zc;
  PP.x = W / 2 + (dx * Cam.rx + dy * Cam.ry) * k + Cam.sx; PP.y = H / 2 - (dx * Cam.ux + dy * Cam.uy + dz * Cam.uz) * k + Cam.sy; PP.s = k; PP.d = zc;
  return true;
}
function proj(x, y, z) { return projP(x, y, z) ? { x: PP.x, y: PP.y, s: PP.s, d: PP.d } : null; }
function camDepth(x, y, z) { return (x - Cam.px) * Cam.fx + (y - Cam.py) * Cam.fy + (z - Cam.pz) * Cam.fz; }
function clipCam(pts) {
  const cs = pts.map(p => toCam(p[0], p[1], p[2])), out = [];
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i], b = cs[(i + 1) % cs.length], ia = a[2] >= NEAR, ib = b[2] >= NEAR;
    if (ia) out.push(a);
    if (ia !== ib) { const t = (NEAR - a[2]) / (b[2] - a[2]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]); }
  }
  return out;
}
function pathPoly(pts) {
  const cs = clipCam(pts); if (cs.length < 3) return false;
  ctx.beginPath();
  for (let i = 0; i < cs.length; i++) { const c = cs[i], k = Cam.focal / c[2], X = W / 2 + c[0] * k + Cam.sx, Y = H / 2 - c[1] * k + Cam.sy; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
  ctx.closePath(); return true;
}
function fillPoly(pts, style) { if (pathPoly(pts)) { ctx.fillStyle = style; ctx.fill(); } }
function line3(x1, y1, z1, x2, y2, z2, wm, style, minW = 0.6) {
  let a = toCam(x1, y1, z1), b = toCam(x2, y2, z2);
  if (a[2] < NEAR && b[2] < NEAR) return;
  if (a[2] < NEAR) { const t = (NEAR - a[2]) / (b[2] - a[2]); a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]; }
  if (b[2] < NEAR) { const t = (NEAR - b[2]) / (a[2] - b[2]); b = [b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t, NEAR]; }
  const ka = Cam.focal / a[2], kb = Cam.focal / b[2];
  ctx.strokeStyle = style; ctx.lineWidth = Math.max(minW, Math.min(wm * (ka + kb) / 2, wm * Math.min(ka, kb) * 1.6));
  ctx.beginPath(); ctx.moveTo(W / 2 + a[0] * ka + Cam.sx, H / 2 - a[1] * ka + Cam.sy); ctx.lineTo(W / 2 + b[0] * kb + Cam.sx, H / 2 - b[1] * kb + Cam.sy); ctx.stroke();
}

// ============================ РЕНДЕР: СТАДИОН И ПОЛЕ ============================
const LINES = [];
(function buildLines() {
  const seg = (x1, y1, x2, y2) => { const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 3)); for (let i = 0; i < n; i++) LINES.push([lerp(x1, x2, i / n), lerp(y1, y2, i / n), lerp(x1, x2, (i + 1) / n), lerp(y1, y2, (i + 1) / n)]); };
  const rect = (x1, y1, x2, y2) => { seg(x1, y1, x2, y1); seg(x2, y1, x2, y2); seg(x2, y2, x1, y2); seg(x1, y2, x1, y1); };
  const arc = (cx, cy, r, a0, a1, n) => { for (let i = 0; i < n; i++) { const t0 = a0 + (a1 - a0) * i / n, t1 = a0 + (a1 - a0) * (i + 1) / n; seg(cx + Math.cos(t0) * r, cy + Math.sin(t0) * r, cx + Math.cos(t1) * r, cy + Math.sin(t1) * r); } };
  rect(0, 0, PITCH_L, PITCH_W); seg(CX, 0, CX, PITCH_W); arc(CX, CY, 9.15, 0, Math.PI * 2, 40);
  for (const s of [0, 1]) {
    const gx = s ? PITCH_L : 0, d = s ? -1 : 1;
    rect(gx, CY - BOX_W / 2, gx + d * BOX_L, CY + BOX_W / 2); rect(gx, CY - SIX_W / 2, gx + d * SIX_L, CY + SIX_W / 2);
    const a = Math.acos((BOX_L - PEN_DIST) / 9.15);
    if (s) arc(PITCH_L - PEN_DIST, CY, 9.15, Math.PI - a, Math.PI + a, 14); else arc(PEN_DIST, CY, 9.15, -a, a, 14);
  }
  arc(0, 0, 1, 0, Math.PI / 2, 4); arc(PITCH_L, 0, 1, Math.PI / 2, Math.PI, 4); arc(PITCH_L, PITCH_W, 1, Math.PI, Math.PI * 1.5, 4); arc(0, PITCH_W, 1, Math.PI * 1.5, Math.PI * 2, 4);
})();
const SPOTS = [[CX, CY], [PEN_DIST, CY], [PITCH_L - PEN_DIST, CY]];
const BRANDS = ['GOLAZO 26', 'NOVA BANK', 'AEROFLY', 'KRONOS', 'VOLTA ENERGY', 'TERRA AIR', 'PIXELPLAY', 'ZENITH TELECOM', 'ORBITA', 'SOLARIS'];
const BRAND_COL = ['#ffc23d', '#2d6bff', '#00c2a8', '#ff4b5c', '#a3e635', '#38bdf8', '#f472b6', '#facc15', '#c084fc', '#fb923c'];

const Stadium = {
  crowd: [], noise: null, flash: [],
  build(homeKit, awayKit) {
    const cr = [], rnd = seeded(12345), neutral = ['#1d2533', '#2a3342', '#3b4250', '#e9e9e9', '#6b7280', '#14181f'];
    const shirt = (x, side) => {
      const r = rnd();
      if (side === 'a') return r < 0.75 ? awayKit.s : r < 0.9 ? awayKit.s2 : pick(neutral);
      return r < 0.6 ? homeKit.s : r < 0.78 ? homeKit.s2 : pick(neutral);
    };
    const add = (x, y, z, side) => cr.push({ x, y, z, c: shirt(x, side), sk: SKIN[Math.floor(rnd() * 6)], ph: rnd() * 6.28, side, arm: rnd() < 0.25 });
    for (let row = 0; row < 22; row++) for (let x = -12; x <= 117; x += 1.1) { const yy = 74.5 + row * 1.0 + rnd() * 0.15; add(x + rnd() * 0.4, yy, 1.4 + row * 0.85, x < 8 ? 'a' : 'h'); }
    for (let row = 0; row < 14; row++) for (let x = -12; x <= 117; x += 1.4) { const yy = 99.5 + row * 1.3; add(x + rnd() * 0.5, yy, 23 + row * 1.1, x < 8 ? 'a' : 'h'); }
    for (let row = 0; row < 17; row++) for (let y = -12; y <= 80; y += 1.3) {
      add(-9.5 - row * 1.0, y + rnd() * 0.4, 1.4 + row * 0.85, 'a');
      add(114.5 + row * 1.0, y + rnd() * 0.4, 1.4 + row * 0.85, 'h');
    }
    cr.sort((a, b) => (a.c < b.c ? -1 : 1));
    this.crowd = cr;
    this.flash = Array.from({ length: 40 }, () => ({ x: rand(-10, 115), y: rand(76, 110), t: rand(0, 5) }));
  },
  grassNoise() {
    if (this.noise) return this.noise;
    const c = document.createElement('canvas'); c.width = c.height = 160; const g = c.getContext('2d');
    const img = g.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random(); const l = v < 0.5 ? 0 : 255; img.data[i] = l; img.data[i + 1] = l; img.data[i + 2] = l; img.data[i + 3] = Math.random() * 26; }
    g.putImageData(img, 0, 0);
    return (this.noise = ctx.createPattern(c, 'repeat'));
  },
  drawBackground(t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#05080f'); g.addColorStop(0.5, '#0b1320'); g.addColorStop(1, '#0d1a14');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // крыша и прожекторы
    fillPoly([[-40, 96, 43], [145, 96, 43], [145, 140, 52], [-40, 140, 52]], '#0a0f18');
    for (let x = -10; x <= 115; x += 7) {
      if (!projP(x, 96.5, 42.5)) continue;
      const r = Math.max(2, PP.s * 2.2), gr = ctx.createRadialGradient(PP.x, PP.y, 0, PP.x, PP.y, r * 4);
      gr.addColorStop(0, 'rgba(255,250,230,0.95)'); gr.addColorStop(0.25, 'rgba(255,240,200,0.35)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = gr; ctx.fillRect(PP.x - r * 4, PP.y - r * 4, r * 8, r * 8);
    }
    // трибуны
    const tier = (y0, z0, y1, z1, c1, c2) => {
      if (!pathPoly([[-14, y0, z0], [119, y0, z0], [119, y1, z1], [-14, y1, z1]])) return;
      const a = proj(CX, y0, z0), b = proj(CX, y1, z1);
      if (a && b) { const gr = ctx.createLinearGradient(0, a.y, 0, b.y); gr.addColorStop(0, c1); gr.addColorStop(1, c2); ctx.fillStyle = gr; } else ctx.fillStyle = c1;
      ctx.fill();
    };
    tier(74, 0, 96.5, 20, '#1a2230', '#121925');
    fillPoly([[-14, 96.5, 20], [119, 96.5, 20], [119, 99, 22.5], [-14, 99, 22.5]], '#2a3444');
    tier(99, 22.5, 118, 38, '#151c28', '#0e141e');
    fillPoly([[-9, -14, 0], [-9, 82, 0], [-27, 82, 16], [-27, -14, 16]], '#161e2b');
    fillPoly([[114, -14, 0], [114, 82, 0], [132, 82, 16], [132, -14, 16]], '#161e2b');
  },
  drawCrowd(t, excite, celebSide) {
    const cr = this.crowd, wob = 0.05 + excite * 0.25;
    let lastC = '';
    const heads = [];
    for (let i = 0; i < cr.length; i++) {
      const p = cr[i];
      let z = p.z + Math.sin(t * 3 + p.ph) * wob * 0.3;
      if (celebSide && p.side === celebSide) z += Math.abs(Math.sin(t * 8 + p.ph)) * 0.55;
      if (!projP(p.x, p.y, z)) continue;
      if (PP.x < -10 || PP.x > W + 10 || PP.y < -10 || PP.y > H + 20) continue;
      const w = PP.s * 0.5, h = PP.s * 0.62;
      if (w < 0.6) continue;
      if (p.c !== lastC) { ctx.fillStyle = lastC = p.c; }
      ctx.fillRect(PP.x - w / 2, PP.y - h * 0.62, w, h * 0.62);
      if ((p.arm && excite > 0.45) || (celebSide && p.side === celebSide && p.arm)) ctx.fillRect(PP.x - w * 0.5, PP.y - h * 1.35, w * 0.22, h * 0.6);
      heads.push(PP.x - w * 0.3, PP.y - h, w * 0.6, h * 0.38, p.sk);
    }
    for (let i = 0; i < heads.length; i += 5) { if (heads[i + 4] !== lastC) ctx.fillStyle = lastC = heads[i + 4]; ctx.fillRect(heads[i], heads[i + 1], heads[i + 2], heads[i + 3]); }
    // вспышки фотокамер
    if (excite > 0.5) for (const f of this.flash) {
      f.t -= 0.016; if (f.t < 0) { f.t = rand(0.3, 2.5); f.x = rand(-10, 115); f.y = rand(76, 110); }
      if (f.t < 0.06 && projP(f.x, f.y, 1.5 + (f.y - 74) * 0.85)) { ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(PP.x, PP.y, Math.max(1.5, PP.s * 0.35), 0, 7); ctx.fill(); }
    }
  },
  drawBoards(t, near) {
    const panel = (x0, x1, y, i) => {
      const bi = (i + Math.floor(t / 6)) % BRANDS.length, col = BRAND_COL[bi];
      if (!pathPoly([[x0, y, 0], [x1, y, 0], [x1, y, 0.95], [x0, y, 0.95]])) return;
      ctx.fillStyle = '#0b1018'; ctx.fill();
      const c = proj((x0 + x1) / 2, y, 0.47);
      if (!c || c.s < 2) return;
      const sweep = (Math.sin(t * 2 + i) + 1) * 0.5;
      ctx.fillStyle = col; ctx.globalAlpha = 0.85 + sweep * 0.15;
      ctx.font = `700 ${Math.max(6, c.s * 0.6)}px Oswald, 'Arial Narrow', sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(BRANDS[bi], c.x, c.y);
      ctx.globalAlpha = 1;
    };
    if (!near) {
      let i = 0; for (let x = -6; x < 111; x += 9) panel(x, Math.min(111, x + 8.8), 72.5, i++);
      for (const gx of [-4.5, 109.5]) {
        for (let y = 4; y < 64; y += 10) { if (pathPoly([[gx, y, 0], [gx, y + 9.8, 0], [gx, y + 9.8, 0.95], [gx, y, 0.95]])) { ctx.fillStyle = BRAND_COL[(Math.floor(y / 10) + Math.floor(t / 6)) % BRAND_COL.length]; ctx.globalAlpha = 0.75; ctx.fill(); ctx.globalAlpha = 1; } }
      }
    } else {
      let i = 3; for (let x = -6; x < 111; x += 9) panel(x, Math.min(111, x + 8.8), -5, i++);
    }
  },
  drawPitch() {
    fillPoly([[-9, -9, 0], [114, -9, 0], [114, 74, 0], [-9, 74, 0]], '#2a7a35');
    const n = 20, sw = PITCH_L / n;
    for (let i = -1; i <= n; i++) {
      const x0 = Math.max(-6, i * sw), x1 = Math.min(111, (i + 1) * sw);
      fillPoly([[x0, -4.5, 0], [x1, -4.5, 0], [x1, 72.5, 0], [x0, 72.5, 0]], i % 2 ? '#3a9b47' : '#338d3f');
    }
    for (let j = 0; j < 8; j++) { if (j % 2) continue; const y0 = j * 8.5, y1 = y0 + 8.5; fillPoly([[-6, y0, 0], [111, y0, 0], [111, y1, 0], [-6, y1, 0]], 'rgba(0,0,0,0.045)'); }
    if (pathPoly([[-9, -9, 0], [114, -9, 0], [114, 74, 0], [-9, 74, 0]])) {
      ctx.save(); ctx.clip(); ctx.fillStyle = this.grassNoise(); ctx.fillRect(0, 0, W, H);
      const a = proj(CX, 72, 0), b = proj(CX, -4, 0);
      if (a && b) { const g = ctx.createLinearGradient(0, a.y, 0, b.y); g.addColorStop(0, 'rgba(10,25,40,0.22)'); g.addColorStop(0.5, 'rgba(255,255,220,0.03)'); g.addColorStop(1, 'rgba(0,0,0,0.08)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
      ctx.restore();
    }
    ctx.lineCap = 'round';
    for (const l of LINES) line3(l[0], l[1], 0.01, l[2], l[3], 0.01, 0.12, 'rgba(250,252,245,0.9)');
    for (const s of SPOTS) { if (pathPoly(Array.from({ length: 8 }, (_, i) => [s[0] + Math.cos(i * 0.785) * 0.18, s[1] + Math.sin(i * 0.785) * 0.18, 0.01]))) { ctx.fillStyle = 'rgba(250,252,245,0.95)'; ctx.fill(); } }
  },
  // сетки ворот (фон) — с учётом «волны» после попадания мяча
  drawNets(goals) {
    for (const g of goals) {
      const gx = g.x, o = g.out, b = gx + o * GOAL_D, y0 = CY - GOAL_W / 2, y1 = CY + GOAL_W / 2, st = 'rgba(235,240,245,0.42)';
      const bulge = (y, z) => { if (!g.hit) return 0; const d = Math.hypot(y - g.hit.y, z - g.hit.z); return Math.max(0, 1 - d / 2.2) * g.hit.a; };
      fillPoly([[b, y0, 0], [b, y1, 0], [b, y1, 2.1], [b, y0, 2.1]], 'rgba(255,255,255,0.05)');
      for (let y = y0; y <= y1 + 0.01; y += 0.45) { const k1 = bulge(y, 0.5), k2 = bulge(y, 1.6); line3(b + o * k1, y, 0, b + o * k2, y, 2.1, 0.025, st); line3(b + o * k2, y, 2.1, gx, y, GOAL_H, 0.025, st); }
      for (let z = 0; z <= 2.1; z += 0.42) line3(b + o * bulge(CY, z), y0, z, b + o * bulge(CY, z), y1, z, 0.025, st);
      for (let x = 0; x <= GOAL_D; x += 0.44) { const xx = gx + o * x; line3(xx, y1, 0, xx, y1, GOAL_H - (GOAL_H - 2.1) * x / GOAL_D, 0.025, st); line3(xx, y0, 2.1 + (GOAL_H - 2.1) * (1 - x / GOAL_D), xx, y1, 2.1 + (GOAL_H - 2.1) * (1 - x / GOAL_D), 0.025, st); }
      for (let z = 0; z <= 2.1; z += 0.42) line3(gx, y1, z, b, y1, Math.min(z, 2.1), 0.025, st);
    }
  },
  drawPost(g, which) {
    const gx = g.x, y = which === 'near' ? CY - GOAL_W / 2 : CY + GOAL_W / 2;
    if (which === 'near') {
      const o = g.out, b = gx + o * GOAL_D, st = 'rgba(235,240,245,0.32)';
      for (let x = 0; x <= GOAL_D; x += 0.44) line3(gx + o * x, y, 0, gx + o * x, y, 2.1 + (GOAL_H - 2.1) * (1 - x / GOAL_D), 0.025, st);
      for (let z = 0; z <= 2.1; z += 0.42) line3(gx, y, z, b, y, z, 0.025, st);
    }
    line3(gx, y, 0, gx, y, GOAL_H, 0.13, '#f4f6f8', 1.2);
    if (which === 'far') line3(gx, CY - GOAL_W / 2, GOAL_H, gx, CY + GOAL_W / 2, GOAL_H, 0.13, '#f4f6f8', 1.2);
  },
  drawFlag(x, y, t) {
    line3(x, y, 0, x, y, 1.55, 0.05, '#e8e8e8', 1);
    const w = Math.sin(t * 6 + x) * 0.12;
    fillPoly([[x, y, 1.55], [x + 0.45, y + w, 1.45], [x, y, 1.2]], '#ffcc1f');
  }
};
// ============================ РЕНДЕР: ФУТБОЛИСТЫ ============================
const REF_KIT = KIT('#1d1f24', '#f2d00f', 'plain', '#15161a', '#15161a', '#f2d00f');
function ellipse(g, x, y, rx, ry, fill) { g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); }
function limb(g, x1, y1, x2, y2, w, col) { g.strokeStyle = col; g.lineWidth = Math.max(1, w); g.lineCap = 'round'; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
function limb2(g, x1, y1, x2, y2, x3, y3, w, col) { g.strokeStyle = col; g.lineWidth = Math.max(1, w); g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineTo(x3, y3); g.stroke(); }

/* Рисует фигуру футболиста в локальных координатах: (0,0) — стопы, вверх — минус Y.
   o: { s — px на метр по горизонтали, hp — px на метр по вертикали, view: side|front|back, flip, phase, run,
        arms: swing|up|spread|cross|fist|throw|gk|dive, kick (0..1 или -1), look, kit, num, name, gk, kneel } */
function drawFigure(g, o) {
  const L = o.look, kit = o.kit, Hm = (L.h || 181) / 100, s = o.s, hp = o.hp, f = o.flip || 1;
  const skin = SKIN[L.skin] || SKIN[2], skinD = shade(skin, -0.22), hair = HAIR_COL[L.hc] || HAIR_COL.k;
  const shirt = o.gk ? o.gk : kit.s, shirtD = shade(shirt, -0.28), sleeve = o.gk ? shirt : (kit.p === 'sleeves' ? kit.s2 : shirt);
  const shorts = o.gk ? shade(o.gk, -0.35) : kit.sh, socks = o.gk ? shade(o.gk, -0.2) : kit.so, boots = L.boots || '#111';
  const X = m => m * s * f, Y = m => -m * hp;
  const run = o.run || 0, ph = o.phase || 0, kneel = o.kneel ? 0.42 : 0;
  const bob = Math.abs(Math.sin(ph)) * 0.035 * run;
  const hipY = 0.5 * Hm + bob - kneel, shY = 0.815 * Hm + bob - kneel, headY = 0.915 * Hm + bob - kneel;
  const thigh = 0.245 * Hm, shin = 0.255 * Hm, legW = 0.13 * s, armW = 0.085 * s;
  const lean = (o.lean || 0) * 0.12;
  const view = o.view;
  if (view === 'side') {
    // --- ноги в профиль ---
    const leg = (a, bend, far) => {
      const hx = X(0.02), hy = Y(hipY);
      const kx = hx + X(Math.sin(a) * thigh), ky = hy + Math.cos(a) * thigh * hp;
      const a2 = a - bend, fx = kx + X(Math.sin(a2) * shin), fy = ky + Math.cos(a2) * shin * hp;
      const sk = far ? skinD : skin;
      limb(g, hx, hy, kx, ky, legW * 1.05, sk);
      limb(g, kx + (fx - kx) * 0.12, ky + (fy - ky) * 0.12, fx, fy, legW * 0.95, far ? shade(socks, -0.25) : socks);
      const bx = fx + X(0.09), by = fy;
      limb(g, fx - X(0.03), fy, bx, by, legW * 0.85, far ? shade(boots, -0.3) : boots);
    };
    let a1 = Math.sin(ph) * 0.62 * run, a2 = Math.sin(ph + Math.PI) * 0.62 * run;
    let b1 = run * (0.2 + 0.85 * Math.max(0, Math.cos(ph))), b2 = run * (0.2 + 0.85 * Math.max(0, Math.cos(ph + Math.PI)));
    if (o.kick >= 0) { const t = o.kick; a1 = t < 0.45 ? lerp(0, -0.9, t / 0.45) : lerp(-0.9, 1.25, Math.min(1, (t - 0.45) / 0.3)); b1 = t < 0.5 ? 1.2 : 0.15; a2 = -0.1; b2 = 0.1; }
    if (kneel) { a1 = 1.4; b1 = 2.6; a2 = 1.3; b2 = 2.5; }
    leg(a2, b2, true);
    // дальняя рука
    const sx = X(0.0 - lean * 0.2), sy = Y(shY - 0.03);
    const armSw = o.arms === 'swing' ? Math.sin(ph) * 0.75 * run : 0;
    const armFar = () => { const a = -armSw * 1; const ex = sx + X(Math.sin(a) * 0.28 * Hm), ey = sy + Math.cos(a) * 0.28 * Hm * hp; limb2(g, sx, sy, ex, ey, ex + X(0.12 + Math.max(0, Math.sin(a)) * 0.08), ey - 0.06 * hp, armW, skinD); };
    if (o.arms === 'swing' || o.arms === 'gk') armFar();
    // торс
    g.save(); g.translate(X(lean), 0);
    const tw = 0.13;
    g.beginPath(); g.moveTo(X(-tw), Y(hipY + 0.02)); g.lineTo(X(-tw - 0.02), Y(shY)); g.quadraticCurveTo(X(0), Y(shY + 0.05), X(tw + 0.02), Y(shY)); g.lineTo(X(tw), Y(hipY + 0.02)); g.closePath();
    g.fillStyle = shirt; g.fill();
    if (kit.p === 'stripes' && !o.gk) { g.save(); g.clip(); g.fillStyle = kit.s2; for (let i = -2; i <= 2; i += 2) g.fillRect(X(i * 0.06) - 0.03 * s, Y(shY + 0.06), 0.06 * s, (shY - hipY + 0.1) * hp); g.restore(); }
    if (kit.p === 'band' && !o.gk) { g.save(); g.clip(); g.fillStyle = kit.s2; g.fillRect(X(-0.04) - 0.04 * s, Y(shY + 0.06), 0.08 * s, (shY - hipY + 0.1) * hp); g.restore(); }
    const sg = g.createLinearGradient(X(-tw), 0, X(tw), 0); sg.addColorStop(0, 'rgba(0,0,0,0.22)'); sg.addColorStop(0.6, 'rgba(255,255,255,0.06)'); sg.addColorStop(1, 'rgba(255,255,255,0.14)');
    g.fillStyle = sg; g.fill();
    // шорты
    g.fillStyle = shorts; g.beginPath(); g.moveTo(X(-0.135), Y(hipY + 0.04)); g.lineTo(X(0.135), Y(hipY + 0.04)); g.lineTo(X(0.15), Y(hipY - 0.14)); g.lineTo(X(-0.12), Y(hipY - 0.14)); g.closePath(); g.fill();
    g.restore();
    leg(a1, b1, false);
    // голова
    const hx = X(0.015 + lean * 1.1), hy = Y(headY);
    limb(g, X(lean * 0.6), Y(shY - 0.02), hx, hy + 0.05 * hp, 0.08 * s, skinD);
    drawHead(g, hx, hy, 0.105 * s, 0.12 * hp, 'side', f, L, skin, hair);
    // ближняя рука
    const nsx = X(lean * 0.6), nsy = Y(shY - 0.03);
    const arm = (a, bend, col) => { const ex = nsx + X(Math.sin(a) * 0.29 * Hm), ey = nsy + Math.cos(a) * 0.29 * Hm * hp; const hx2 = ex + X(Math.sin(a + bend) * 0.26 * Hm), hy2 = ey + Math.cos(a + bend) * 0.26 * Hm * hp; limb(g, nsx, nsy, (nsx + ex) / 2, (nsy + ey) / 2, armW * 1.15, sleeve); limb2(g, (nsx + ex) / 2, (nsy + ey) / 2, ex, ey, hx2, hy2, armW, o.gk ? sleeve : col); if (o.gk) ellipse(g, hx2, hy2, 0.06 * s, 0.06 * hp, '#f2f2f2'); };
    if (o.arms === 'swing') arm(armSw, 0.9, skin);
    else if (o.arms === 'up' || o.arms === 'throw' || o.arms === 'dive') arm(Math.PI * 0.95, 0.1, skin);
    else if (o.arms === 'spread') arm(Math.PI * 0.5, 0, skin);
    else if (o.arms === 'fist') arm(Math.PI * 0.85, -0.5, skin);
    else if (o.arms === 'gk') arm(0.9, 0.4, skin);
    else if (o.arms === 'cross') arm(0.2, 1.9, skin);
    if (o.arms === 'throw') ellipse(g, nsx + X(0.05), nsy - 0.62 * Hm * hp, 0.13 * s, 0.13 * hp, '#f5f5f5');
    return;
  }
  // --- анфас / со спины ---
  const back = view === 'back';
  const legF = (side, lift) => {
    const hx = side * 0.095 * s, hy = Y(hipY), fy = Y(Math.max(0, lift) + 0.0) , ky = (hy + fy) / 2 - lift * 0.4 * hp;
    limb(g, hx, hy, hx + side * 0.01 * s, ky, legW * 1.05, skin);
    limb(g, hx + side * 0.01 * s, ky + (fy - ky) * 0.12, hx, fy - 0.03 * hp, legW * 0.95, socks);
    ellipse(g, hx, fy - 0.02 * hp, 0.075 * s, 0.045 * hp + 1, boots);
  };
  let l1 = Math.max(0, Math.sin(ph)) * 0.16 * run, l2 = Math.max(0, Math.sin(ph + Math.PI)) * 0.16 * run;
  if (o.kick >= 0) { l1 = Math.sin(Math.min(1, o.kick) * Math.PI) * 0.3; l2 = 0; }
  if (kneel) { l1 = 0; l2 = 0; }
  if (!kneel) { legF(-1, l2); legF(1, l1); }
  const tw = 0.205, ww = 0.16;
  // руки за торсом (для поднятых рук рисуем после)
  const shX = 0.215 * s, shYp = Y(shY - 0.03);
  const armFB = (side, mode) => {
    let ex, ey, hx2, hy2;
    const swing = mode === 'swing' ? Math.sin(ph + (side > 0 ? 0 : Math.PI)) * run : 0;
    if (mode === 'up' || mode === 'throw' || mode === 'dive') { ex = side * 0.3 * s; ey = Y(shY + 0.24); hx2 = side * 0.26 * s; hy2 = Y(shY + 0.5); }
    else if (mode === 'spread') { ex = side * 0.48 * s; ey = Y(shY - 0.02); hx2 = side * 0.74 * s; hy2 = Y(shY + 0.04); }
    else if (mode === 'fist') { if (side > 0) { ex = 0.32 * s; ey = Y(shY + 0.2); hx2 = 0.3 * s; hy2 = Y(shY + 0.46); } else { ex = -0.26 * s; ey = Y(shY - 0.28); hx2 = -0.24 * s; hy2 = Y(shY - 0.5); } }
    else if (mode === 'cross') { ex = side * 0.24 * s; ey = Y(shY - 0.22); hx2 = -side * 0.12 * s; hy2 = Y(shY - 0.15); }
    else if (mode === 'gk') { ex = side * 0.36 * s; ey = Y(shY - 0.18); hx2 = side * 0.42 * s; hy2 = Y(shY - 0.02); }
    else { ex = side * 0.27 * s; ey = Y(shY - 0.27 + swing * 0.04); hx2 = side * 0.25 * s; hy2 = Y(shY - 0.52 + swing * 0.14); }
    limb(g, side * shX, shYp, (side * shX + ex) / 2, (shYp + ey) / 2, armW * 1.2, sleeve);
    limb2(g, (side * shX + ex) / 2, (shYp + ey) / 2, ex, ey, hx2, hy2, armW, o.gk ? sleeve : skin);
    if (o.gk) ellipse(g, hx2, hy2, 0.065 * s, 0.065 * hp, '#f2f2f2');
  };
  const raised = ['up', 'throw', 'dive', 'spread', 'fist'].includes(o.arms);
  if (!raised && o.arms !== 'cross') { armFB(-1, o.arms); armFB(1, o.arms); }
  // торс
  g.beginPath();
  g.moveTo(-ww * s, Y(hipY + 0.02)); g.lineTo(-tw * s, Y(shY - 0.04)); g.quadraticCurveTo(-tw * s, Y(shY + 0.03), -0.1 * s, Y(shY + 0.035));
  g.lineTo(0.1 * s, Y(shY + 0.035)); g.quadraticCurveTo(tw * s, Y(shY + 0.03), tw * s, Y(shY - 0.04)); g.lineTo(ww * s, Y(hipY + 0.02)); g.closePath();
  g.fillStyle = shirt; g.fill();
  if (!o.gk && kit.p !== 'plain') {
    g.save(); g.clip(); g.fillStyle = kit.s2;
    if (kit.p === 'stripes') for (let i = -3; i <= 3; i += 2) g.fillRect(i * 0.06 * s - 0.03 * s, Y(shY + 0.06), 0.06 * s, (shY - hipY + 0.1) * hp);
    if (kit.p === 'band') { g.fillStyle = '#ffffff'; g.fillRect(-0.075 * s, Y(shY + 0.06), 0.15 * s, (shY - hipY + 0.1) * hp); g.fillStyle = kit.s2; g.fillRect(-0.055 * s, Y(shY + 0.06), 0.11 * s, (shY - hipY + 0.1) * hp); }
    g.restore();
  }
  const sg = g.createLinearGradient(-tw * s, 0, tw * s, 0); sg.addColorStop(0, 'rgba(255,255,255,0.14)'); sg.addColorStop(0.5, 'rgba(255,255,255,0)'); sg.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.fillStyle = sg; g.fill();
  if (hp > 30) { g.fillStyle = o.gk ? shade(o.gk, -0.3) : kit.s2; g.beginPath(); g.moveTo(-0.07 * s, Y(shY + 0.035)); g.lineTo(0, Y(shY - 0.05)); g.lineTo(0.07 * s, Y(shY + 0.035)); g.closePath(); g.fill(); if (!back) { g.fillStyle = skin; g.beginPath(); g.moveTo(-0.045 * s, Y(shY + 0.035)); g.lineTo(0, Y(shY - 0.025)); g.lineTo(0.045 * s, Y(shY + 0.035)); g.closePath(); g.fill(); } }
  g.fillStyle = shorts; g.beginPath(); g.moveTo(-ww * s - 1, Y(hipY + 0.04)); g.lineTo(ww * s + 1, Y(hipY + 0.04)); g.lineTo(0.175 * s, Y(hipY - 0.13)); g.lineTo(0.02 * s, Y(hipY - 0.1)); g.lineTo(-0.02 * s, Y(hipY - 0.1)); g.lineTo(-0.175 * s, Y(hipY - 0.13)); g.closePath(); g.fill();
  if (hp > 30) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(-ww * s - 1, Y(hipY + 0.04), (ww * 2) * s + 2, 0.02 * hp); }
  if (kneel) { ellipse(g, -0.1 * s, Y(hipY - 0.2), 0.09 * s, 0.07 * hp, socks); ellipse(g, 0.1 * s, Y(hipY - 0.2), 0.09 * s, 0.07 * hp, socks); }
  // номер / эмблема
  if (back && hp > 20) {
    g.fillStyle = o.gk ? '#ffffff' : kit.n; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${Math.round(0.24 * hp)}px Oswald, 'Arial Narrow', sans-serif`;
    g.fillText(String(o.num), 0, Y((shY + hipY) / 2 + 0.01));
    if (hp > 70 && o.name) { g.font = `600 ${Math.round(0.06 * hp)}px Oswald, sans-serif`; g.fillText(o.name.toUpperCase(), 0, Y(shY - 0.07)); }
  } else if (!back && hp > 26) {
    ellipse(g, 0.09 * s, Y(shY - 0.1), 0.028 * s, 0.03 * hp, o.gk ? '#ffffff' : kit.s2);
    if (hp > 55) { g.fillStyle = o.gk ? 'rgba(255,255,255,0.8)' : kit.n; g.globalAlpha = 0.85; g.fillRect(-0.11 * s, Y(shY - 0.2), 0.22 * s, 0.035 * hp); g.globalAlpha = 1; }
  }
  if (raised || o.arms === 'cross') { armFB(-1, o.arms); armFB(1, o.arms); }
  if (o.arms === 'throw') ellipse(g, 0, Y(shY + 0.58), 0.13 * s, 0.13 * hp, '#f5f5f5');
  limb(g, 0, Y(shY), 0, Y(headY - 0.06), 0.085 * s, skinD);
  drawHead(g, 0, Y(headY), 0.105 * s, 0.12 * hp, back ? 'back' : 'front', 1, L, skin, hair);
}

function drawHead(g, x, y, rx, ry, view, f, L, skin, hair) {
  const st = L.hair;
  const back = view === 'back', side = view === 'side';
  // длинные волосы сзади головы
  if (st === 'lo' || st === 'lc' || st === 'dr') {
    g.fillStyle = hair;
    if (side) g.fillRect(f > 0 ? x - rx * 1.05 : x + rx * 0.5, y - ry * 0.2, rx * 0.55, ry * (st === 'dr' ? 1.9 : 1.6));
    else g.fillRect(x - rx * 1.1, y - ry * 0.2, rx * 2.2, ry * (st === 'dr' ? 1.9 : 1.5));
  }
  if (st === 'af' || st === 'lc') ellipse(g, x - (side ? f * rx * 0.15 : 0), y - ry * 0.25, rx * 1.42, ry * 1.32, hair);
  if (!back && !side) { ellipse(g, x - rx * 0.97, y + ry * 0.08, rx * 0.17, ry * 0.22, shade(skin, -0.1)); ellipse(g, x + rx * 0.97, y + ry * 0.08, rx * 0.17, ry * 0.22, shade(skin, -0.1)); }
  ellipse(g, x, y, rx, ry, skin);
  if (rx > 5) { const fg = g.createRadialGradient(x - rx * 0.3, y - ry * 0.3, rx * 0.1, x, y, rx * 1.05); fg.addColorStop(0, 'rgba(255,255,255,0.12)'); fg.addColorStop(1, 'rgba(0,0,0,0.18)'); ellipse(g, x, y, rx, ry, fg); }
  if (!back) {
    if (side) { ellipse(g, x + f * rx * 0.92, y + ry * 0.12, rx * 0.16, ry * 0.18, skin); }
    if (rx > 7) {
      g.fillStyle = '#1b1410';
      const ew = Math.max(1, rx * 0.15), eh = Math.max(1, ry * 0.11);
      if (side) g.fillRect(x + f * rx * 0.45 - 1, y - ry * 0.1, ew, eh);
      else {
        g.fillRect(x - rx * 0.45, y - ry * 0.08, ew, eh); g.fillRect(x + rx * 0.3, y - ry * 0.08, ew, eh);
        g.fillStyle = shade(HAIR_COL[L.hc] || '#222', -0.2); g.fillRect(x - rx * 0.52, y - ry * 0.26, rx * 0.3, Math.max(1, ry * 0.07)); g.fillRect(x + rx * 0.22, y - ry * 0.26, rx * 0.3, Math.max(1, ry * 0.07));
        g.fillStyle = shade(skin, -0.28); g.fillRect(x - rx * 0.06, y + ry * 0.05, rx * 0.12, ry * 0.2);
        g.fillStyle = shade(skin, -0.4); g.fillRect(x - rx * 0.2, y + ry * 0.48, rx * 0.4, Math.max(1, ry * 0.06));
      }
    }
    if (L.beard) {
      g.globalAlpha = L.beard === 1 ? 0.45 : 0.92; g.fillStyle = hair;
      g.beginPath();
      if (side) g.ellipse(x + f * rx * 0.25, y + ry * 0.45, rx * 0.72, ry * 0.5, 0, 0, Math.PI);
      else g.ellipse(x, y + ry * 0.38, rx * 0.86, ry * 0.58, 0, 0, Math.PI);
      g.fill(); g.globalAlpha = 1;
    }
  }
  if (st === 'bd') { if (rx > 6) ellipse(g, x - rx * 0.3, y - ry * 0.5, rx * 0.25, ry * 0.15, 'rgba(255,255,255,0.18)'); return; }
  g.fillStyle = hair;
  const cap = (k, top) => {
    g.beginPath();
    if (back) g.ellipse(x, y - ry * 0.05, rx * k, ry * (k + 0.02), 0, Math.PI * 1.0, Math.PI * 2.0), g.lineTo(x + rx * k, y + ry * 0.55), g.lineTo(x - rx * k, y + ry * 0.55);
    else if (side) g.ellipse(x - f * rx * 0.08, y - ry * 0.12, rx * k, ry * k, 0, f > 0 ? Math.PI * 0.95 : Math.PI * 0.05, f > 0 ? Math.PI * 1.9 : -Math.PI * 0.9, f < 0), g.lineTo(x - f * rx * 0.9, y + ry * 0.3);
    else g.ellipse(x, y - ry * top, rx * k, ry * (k * 0.75), 0, Math.PI, Math.PI * 2);
    g.closePath(); g.fill();
  };
  if (st === 'bz') { g.globalAlpha = 0.85; cap(1.02, 0.12); g.globalAlpha = 1; }
  else if (st === 'sh' || st === 'pt' || st === 'lo' || st === 'bn' || st === 'mo') cap(st === 'mo' ? 1.04 : 1.08, 0.18);
  else if (st === 'cu' || st === 'sp' || st === 'dr') {
    cap(1.08, 0.16);
    const n = 6; for (let i = 0; i < n; i++) { const a = Math.PI * (1.05 + 0.9 * i / (n - 1)); ellipse(g, x + Math.cos(a) * rx * 1.0, y - ry * 0.12 + Math.sin(a) * ry * 0.95, rx * 0.26, ry * 0.24, hair); }
  } else if (st === 'af' || st === 'lc') { /* объём уже нарисован */ if (!back) cap(1.1, 0.2); }
  if (st === 'mo' && !back) ellipse(g, x + (side ? f * rx * 0.2 : 0), y - ry * 0.95, rx * 0.7, ry * 0.32, hair);
  if (st === 'bn') ellipse(g, x - (side ? f * rx * 0.55 : 0), y - ry * (back ? 0.75 : 1.05), rx * 0.42, ry * 0.36, hair);
  if (st === 'dr' && rx > 4) { g.strokeStyle = hair; g.lineWidth = Math.max(1, rx * 0.18); for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(x + i * rx * 0.35, y - ry * 0.5); g.lineTo(x + i * rx * 0.42, y + ry * (back ? 1.3 : 0.9)); g.stroke(); } }
}

// ============================ РЕНДЕР: МЯЧ, ЭФФЕКТЫ, ГЕРБЫ ============================
function drawBallAt(b) {
  if (projP(b.x, b.y, 0.01)) {
    const a = clamp(0.5 - b.z * 0.08, 0.1, 0.5), r = Math.max(2, BALL_R * 1.8 * PP.s) * (1 + b.z * 0.05);
    ellipse(ctx, PP.x, PP.y, r * 1.1, r * 0.5, `rgba(0,0,0,${a})`);
  }
  if (!projP(b.x, b.y, b.z + BALL_R)) return;
  const r = Math.max(2.6, BALL_R * 1.9 * PP.s), x = PP.x, y = PP.y - r * 0.4;
  const gr = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.65, '#e8ecef'); gr.addColorStop(1, '#8b97a3');
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = gr; ctx.fill();
  if (r > 3) {
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#1d2733';
    for (let k = 0; k < 3; k++) {
      const a = b.rot + k * 2.094, c = Math.cos(a);
      if (c < -0.2) continue;
      const px = x + Math.sin(a) * r * 0.62 * Math.cos(b.spinAxis || 0), py = y + Math.sin(a) * r * 0.62 * Math.sin(b.spinAxis || 0) + (k - 1) * r * 0.35;
      ctx.beginPath(); ctx.arc(px, py, r * 0.26 * (0.5 + c * 0.5), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

const FX = {
  parts: [], confetti: [], trail: [],
  grass(x, y, n = 6) { for (let i = 0; i < n; i++) this.parts.push({ x, y, z: 0.05, vx: rand(-2, 2), vy: rand(-2, 2), vz: rand(1, 3), t: rand(0.4, 0.9), c: pick(['#3c9d48', '#2f8a3d', '#5bb85f', '#6b4f2e']) }); },
  burst(cols) { for (let i = 0; i < 180; i++) this.confetti.push({ x: rand(0, W), y: rand(-H * 0.6, -10), vx: rand(-40, 40), vy: rand(60, 180), r: rand(0, 6), vr: rand(-6, 6), w: rand(4, 9), h: rand(6, 12), c: pick(cols), t: rand(3, 6) }); },
  update(dt) {
    for (const p of this.parts) { p.vz -= GRAV * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z = Math.max(0, p.z + p.vz * dt); p.t -= dt; }
    this.parts = this.parts.filter(p => p.t > 0);
    for (const c of this.confetti) { c.x += c.vx * dt + Math.sin(c.r) * 20 * dt; c.y += c.vy * dt; c.r += c.vr * dt; c.t -= dt; }
    this.confetti = this.confetti.filter(c => c.t > 0 && c.y < H + 20);
  },
  drawWorld() {
    for (const p of this.parts) { if (!projP(p.x, p.y, p.z)) continue; ctx.fillStyle = p.c; const r = Math.max(1, PP.s * 0.05); ctx.fillRect(PP.x - r, PP.y - r, r * 2, r * 2); }
    if (this.trail.length > 2) {
      ctx.lineCap = 'round';
      for (let i = 1; i < this.trail.length; i++) {
        const a = this.trail[i - 1], b = this.trail[i];
        const pa = proj(a.x, a.y, a.z + BALL_R), pb = proj(b.x, b.y, b.z + BALL_R); if (!pa || !pb) continue;
        ctx.strokeStyle = `rgba(255,255,255,${(i / this.trail.length) * 0.35})`; ctx.lineWidth = clamp(BALL_R * 1.6 * pb.s * i / this.trail.length, 1, 5);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y - 2); ctx.lineTo(pb.x, pb.y - 2); ctx.stroke();
      }
    }
  },
  drawScreen() {
    for (const c of this.confetti) { ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.r); ctx.fillStyle = c.c; ctx.fillRect(-c.w / 2, -c.h / 2 * Math.abs(Math.cos(c.r * 2)), c.w, c.h * Math.abs(Math.cos(c.r * 2)) + 1); ctx.restore(); }
  }
};

function crestPath(g, w, h) {
  g.beginPath(); g.moveTo(w * 0.08, h * 0.08); g.lineTo(w * 0.92, h * 0.08); g.lineTo(w * 0.92, h * 0.5);
  g.quadraticCurveTo(w * 0.9, h * 0.82, w * 0.5, h * 0.97); g.quadraticCurveTo(w * 0.1, h * 0.82, w * 0.08, h * 0.5); g.closePath();
}
function drawCrest(cv, team) {
  const g = cv.getContext('2d'), w = cv.width, h = cv.height, k = team.home;
  g.clearRect(0, 0, w, h);
  g.save(); crestPath(g, w, h);
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, shade(k.s, 0.15)); gr.addColorStop(1, shade(k.s, -0.35));
  g.fillStyle = gr; g.fill(); g.clip();
  g.fillStyle = k.s2;
  if (k.p === 'stripes') for (let x = w * 0.18; x < w; x += w * 0.24) g.fillRect(x, 0, w * 0.12, h);
  else if (k.p === 'band') { g.fillStyle = '#fff'; g.fillRect(w * 0.4, 0, w * 0.2, h); g.fillStyle = k.s2; g.fillRect(w * 0.44, 0, w * 0.12, h); }
  else { g.fillRect(0, h * 0.62, w, h * 0.08); }
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, h * 0.3, w, h * 0.26);
  g.restore();
  crestPath(g, w, h); g.lineWidth = Math.max(2, w * 0.04); g.strokeStyle = luma(k.s) > 0.75 ? k.s2 : '#f4e2a0'; g.stroke();
  g.fillStyle = luma(k.s) > 0.75 && k.p !== 'stripes' ? k.s2 : '#ffffff';
  g.font = `900 ${Math.round(w * 0.2)}px Unbounded, 'Arial Black', sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(team.short, w * 0.5, h * 0.43);
  g.beginPath(); g.arc(w * 0.5, h * 0.2, w * 0.05, 0, Math.PI * 2); g.fillStyle = '#f4e2a0'; g.fill();
}
// ============================ ФИЗИКА МЯЧА ============================
const K1 = 1.15, K2 = 0.3; // качение: dv/dt = -K1 - K2·v
function rollDist(v0, va) { if (v0 <= va) return 0; return (v0 - va) / K2 - (K1 / (K2 * K2)) * Math.log((K1 + K2 * v0) / (K1 + K2 * va)); }
function passSpeed(d, arrive = 5) { let lo = arrive, hi = 45; for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (rollDist(m, arrive) < d) lo = m; else hi = m; } return (lo + hi) / 2; }
function rollTime(v0, d) {
  const a = v0 + K1 / K2, tStop = Math.log(a / (K1 / K2)) / K2;
  const sAt = t => a * (1 - Math.exp(-K2 * t)) / K2 - (K1 / K2) * t;
  if (sAt(tStop) < d) return Infinity;
  let lo = 0, hi = tStop; for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (sAt(m) < d) lo = m; else hi = m; } return hi;
}

class Ball {
  constructor() { this.reset(CX, CY); }
  reset(x, y) {
    this.x = x; this.y = y; this.z = 0; this.vx = this.vy = this.vz = 0; this.spin = 0; this.rot = 0; this.spinAxis = 0;
    this.owner = null; this.holder = null; this.lastTouch = null; this.lastTeam = null; this.kicker = null; this.kickCD = 0;
    this.kind = ''; this.target = null; this.shotBy = null; this.passTo = null; this.dead = false;
  }
  speed() { return Math.hypot(this.vx, this.vy); }
  place(x, y) { this.x = x; this.y = y; this.z = 0; this.vx = this.vy = this.vz = 0; this.spin = 0; this.owner = null; this.holder = null; this.kind = ''; this.shotBy = null; this.passTo = null; }
  kick(p, vx, vy, vz, spin, kind) {
    if (this.owner) this.owner.hasBallT = 0;
    this.owner = null; this.holder = null;
    this.vx = vx; this.vy = vy; this.vz = vz; this.spin = spin || 0; this.kind = kind;
    this.kicker = p; this.kickCD = 0.3; this.lastTouch = p; this.lastTeam = p.team;
    this.shotBy = kind === 'shot' || kind === 'header' ? p : null;
    if (kind !== 'shot' && kind !== 'header') this.passTo = this.passTo || null;
    Sfx.kick(clamp(Math.hypot(vx, vy, vz) / 30, 0.1, 1));
    if (Math.hypot(vx, vy, vz) > 22) FX.trail = [];
    Match.onKick(p, kind);
  }
  step(dt) {
    this.kickCD = Math.max(0, this.kickCD - dt);
    if (this.holder) { // мяч в руках вратаря или при вбрасывании
      const h = this.holder;
      this.x = h.x + Math.cos(h.face) * 0.25; this.y = h.y + Math.sin(h.face) * 0.25; this.z = h.anim === 'throw' ? 2.2 : 1.05; this.vx = this.vy = this.vz = 0; return;
    }
    const sp0 = Math.hypot(this.vx, this.vy);
    if (this.z > 0.001 || this.vz > 0.01) {
      const vx = this.vx, vy = this.vy;
      this.vx += -this.spin * vy * dt; this.vy += this.spin * vx * dt;
      this.vz -= GRAV * dt; this.z += this.vz * dt;
      if (this.z <= 0) {
        this.z = 0;
        if (this.vz < -1.8) { this.vz = -this.vz * 0.48; this.vx *= 0.82; this.vy *= 0.82; if (this.vz > 2) Sfx.thud(); } else this.vz = 0;
        this.spin *= 0.5;
      }
    } else {
      if (sp0 > 0) { const ns = Math.max(0, sp0 - (K1 + K2 * sp0) * dt); this.vx *= ns / sp0; this.vy *= ns / sp0; }
      this.spin *= Math.max(0, 1 - 3 * dt);
    }
    this.spin *= Math.max(0, 1 - 0.4 * dt);
    this.x += this.vx * dt; this.y += this.vy * dt;
    const sp = Math.hypot(this.vx, this.vy);
    this.rot += sp * dt / BALL_R * 0.18;
    if (sp > 0.2) this.spinAxis = Math.atan2(this.vy, this.vx);
    if (sp > 20 || (this.trailOn && sp > 12)) { FX.trail.push({ x: this.x, y: this.y, z: this.z }); if (FX.trail.length > 12) FX.trail.shift(); } else if (FX.trail.length) FX.trail.shift();
  }
  // прогноз траектории (для ИИ)
  predict(T = 3, step = 0.05) {
    const out = []; let x = this.x, y = this.y, z = this.z, vx = this.vx, vy = this.vy, vz = this.vz, spin = this.spin;
    if (this.owner || this.holder) { for (let t = 0; t <= T; t += step) out.push({ t, x, y, z }); return out; }
    for (let t = 0; t <= T + 1e-6; t += step) {
      out.push({ t, x, y, z });
      if (z > 0.001 || vz > 0.01) { const ox = vx; vx += -spin * vy * step; vy += spin * ox * step; vz -= GRAV * step; z += vz * step; if (z <= 0) { z = 0; if (vz < -1.8) { vz = -vz * 0.48; vx *= 0.82; vy *= 0.82; } else vz = 0; spin *= 0.5; } }
      else { const s = Math.hypot(vx, vy); if (s > 0) { const ns = Math.max(0, s - (K1 + K2 * s) * step); vx *= ns / s; vy *= ns / s; } }
      x += vx * step; y += vy * step;
    }
    return out;
  }
}

// ============================ ФУТБОЛИСТ ============================
class Player {
  constructor(info, team, slot) {
    this.info = info; this.team = team; this.slot = slot; this.role = FORMATIONS[team.tac.formation][slot][0];
    this.x = CX; this.y = CY; this.z = 0; this.vx = 0; this.vy = 0; this.vz = 0;
    this.dvx = 0; this.dvy = 0; this.face = 0; this.phase = Math.random() * 6; this.run = 0;
    this.anim = 'run'; this.animT = 0; this.kick = -1; this.arms = 'swing';
    this.stamina = 1; this.cd = 0; this.stun = 0; this.pending = null; this.hasBallT = 0;
    this.sprint = false; this.human = false; this.tx = CX; this.ty = CY; this.tspeed = 0.6;
    this.yellow = 0; this.sentOff = false; this.offTarget = null; this.markT = null;
    this.runT = rand(1, 4); this.making = false; this.decT = 0; this.lastDecision = '';
    this.stats = { goals: 0, assists: 0, shots: 0, onTarget: 0, passes: 0, passOk: 0, tackles: 0, saves: 0, keyPasses: 0, fouls: 0, rating: 6.4 };
  }
  get a() { return this.info.attr; }
  get isGK() { return this.role === 'GK'; }
  get name() { return this.info.name; }
  maxSpeed() {
    const base = 5.4 + this.a.pac / 100 * 4.1;
    return base * (0.72 + 0.28 * this.stamina) * (Match.ball.owner === this ? 0.93 + this.a.dri / 2000 : 1);
  }
  accel() { return 9 + this.a.pac / 22; }
  canAct() { return this.stun <= 0 && !['slide', 'dive', 'fall', 'getup', 'celebrate', 'kneel', 'header'].includes(this.anim) && !this.sentOff; }
  // желаемое движение: в точку, с долей максимальной скорости
  steer(tx, ty, frac = 0.7, stopDist = 0.4) {
    const dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy);
    if (d < stopDist) { this.dvx = 0; this.dvy = 0; return d; }
    let sp = this.maxSpeed() * frac;
    sp = Math.min(sp, Math.max(1.2, d * 2.2));
    this.dvx = dx / d * sp; this.dvy = dy / d * sp; this.sprint = frac > 0.85;
    return d;
  }
  stop() { this.dvx = 0; this.dvy = 0; this.sprint = false; }
  lookAt(x, y) { this.face = Math.atan2(y - this.y, x - this.x); }
  update(dt) {
    if (this.sentOff) { this.steer(this.offTarget.x, this.offTarget.y, 0.35); }
    this.cd = Math.max(0, this.cd - dt); this.stun = Math.max(0, this.stun - dt);
    if (this.pending) { this.pending.t -= dt; if (this.pending.t <= 0) { const fn = this.pending.fn; this.pending = null; fn(); } }
    if (this.kick >= 0) { this.kick += dt * 3.2; if (this.kick > 1) this.kick = -1; }
    this.animT += dt;
    const A = this.anim;
    if (A === 'slide') {
      const k = Math.max(0, 1 - this.animT / 0.75); this.vx = Math.cos(this.face) * 8 * k; this.vy = Math.sin(this.face) * 8 * k;
      if (this.animT > 0.8) { this.anim = 'getup'; this.animT = 0; }
    } else if (A === 'dive') {
      this.vx *= Math.max(0, 1 - 1.5 * dt); this.vy *= Math.max(0, 1 - 1.5 * dt);
      if (this.animT > 0.75) { this.anim = 'getup'; this.animT = 0; this.vx = this.vy = 0; }
    } else if (A === 'fall') {
      this.vx *= Math.max(0, 1 - 6 * dt); this.vy *= Math.max(0, 1 - 6 * dt); if (this.animT > 1.3) { this.anim = 'getup'; this.animT = 0; }
    } else if (A === 'getup') { this.vx = this.vy = 0; if (this.animT > 0.45) { this.anim = 'run'; this.animT = 0; } }
    else if (A === 'header') { if (this.z <= 0 && this.animT > 0.3) { this.anim = 'run'; this.animT = 0; } this.applyMove(dt); }
    else if (A === 'kneel' || A === 'celebrate') { this.applyMove(dt); }
    else this.applyMove(dt);
    if (this.z > 0 || this.vz > 0) { this.vz -= GRAV * dt; this.z = Math.max(0, this.z + this.vz * dt); if (this.z === 0) this.vz = 0; }
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.x = clamp(this.x, -6, PITCH_L + 6); this.y = clamp(this.y, -4, PITCH_W + 4);
    const sp = Math.hypot(this.vx, this.vy);
    this.run = clamp(sp / 6.5, 0, 1.15);
    this.phase += sp * dt * 1.45;
    // выносливость
    const drain = this.sprint && sp > 5 ? 0.012 * (1.25 - this.a.phy / 200) : -0.006;
    this.stamina = clamp(this.stamina - drain * dt * (Match.staminaScale || 1), 0.15, 1);
    if (Match.ball.owner === this) this.hasBallT += dt;
  }
  applyMove(dt) {
    let ddx = this.dvx - this.vx, ddy = this.dvy - this.vy;
    const dl = Math.hypot(ddx, ddy), mx = this.accel() * dt * (this.stun > 0 ? 0.3 : 1);
    if (dl > mx) { ddx *= mx / dl; ddy *= mx / dl; }
    this.vx += ddx; this.vy += ddy;
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > 0.6) {
      const want = Math.atan2(this.vy, this.vx), turn = (6 + this.a.dri / 20) * dt;
      const d = angDiff(this.face, want); this.face = angWrap(this.face + clamp(d, -turn, turn));
    } else if (this.watch) { const want = Math.atan2(this.watch.y - this.y, this.watch.x - this.x); this.face = angWrap(this.face + clamp(angDiff(this.face, want), -5 * dt, 5 * dt)); }
  }
  // ---------- действия с мячом ----------
  windup(fn, t = 0.1) { this.kick = 0; this.pending = { t, fn }; this.cd = 0.35; }
  passTo(rec, kind = 'pass', lead = null) {
    const b = Match.ball; if (b.owner !== this && !(b.holder === this)) return false;
    this.lookAt(rec.x, rec.y);
    const go = () => {
      if (b.owner !== this && b.holder !== this) return;
      let tx, ty;
      if (lead) { tx = lead.x; ty = lead.y; } else { const d0 = dist(b.x, b.y, rec.x, rec.y), t0 = d0 / 16; tx = rec.x + rec.vx * t0 * 0.9; ty = rec.y + rec.vy * t0 * 0.9; }
      const air = ['lob', 'cross', 'long', 'throwLong', 'punt'].includes(kind), m = air ? 3 : 0.8;
      tx = clamp(tx, m, PITCH_L - m); ty = clamp(ty, m, PITCH_W - m);
      const err = this.kickError(kind);
      b.passTo = rec; b.target = { x: tx, y: ty };
      if (kind === 'lob' || kind === 'cross' || kind === 'long' || kind === 'throwLong' || kind === 'punt') this.lobTo(tx, ty, kind, err);
      else this.groundTo(tx, ty, kind, err);
      this.stats.passes++;
    };
    if (b.holder === this) { go(); return true; }
    this.windup(go, kind === 'lob' || kind === 'cross' ? 0.16 : 0.1);
    return true;
  }
  kickError(kind) {
    const pres = Match.pressureOn(this);
    let sd = (0.015 + (1 - this.a.pas / 100) * 0.09) * (1 + pres * 0.8);
    if (kind === 'cross' || kind === 'lob' || kind === 'long') sd *= 1.5;
    if (!this.human) sd *= AI.errMul(this.team);
    return gauss() * sd;
  }
  groundTo(tx, ty, kind, err) {
    const b = Match.ball, d = Math.max(1, dist(b.x, b.y, tx, ty));
    const arrive = kind === 'through' ? 3.2 : clamp(4 + d * 0.08, 4, 8);
    const v = passSpeed(d * (1 + gauss() * 0.04), arrive) * (1 + Math.abs(err) * 0.5);
    const a = Math.atan2(ty - b.y, tx - b.x) + err;
    b.kick(this, Math.cos(a) * v, Math.sin(a) * v, d > 30 ? 0.6 : 0, 0, kind);
    if (b.owner === null) b.passTo = b.passTo || null;
  }
  lobTo(tx, ty, kind, err) {
    const b = Match.ball, d = Math.max(2, dist(b.x, b.y, tx, ty));
    const hmax = kind === 'cross' ? clamp(2.6 + d * 0.06, 3, 5.5) : kind === 'throwLong' ? clamp(d * 0.09, 1.1, 3.2) : kind === 'punt' ? clamp(d * 0.15, 4, 12) : clamp(d * 0.11, 2.2, 7.5);
    let vz = Math.sqrt(2 * GRAV * hmax), T = 2 * vz / GRAV, vh = d / T;
    if (vh > 32) { vh = 32; T = d / vh; vz = GRAV * T / 2; }
    const a = Math.atan2(ty - b.y, tx - b.x) + err;
    const k = 1 + gauss() * 0.05 + Math.abs(err);
    b.kick(this, Math.cos(a) * vh * k, Math.sin(a) * vh * k, vz * (1 + gauss() * 0.04), kind === 'cross' ? sgn(gauss()) * 0.05 : 0, kind);
  }
  // удар: aimY — точка по ширине ворот, aimZ — высота, power 0..1
  shoot(aimY, aimZ, power, finesse = false) {
    const b = Match.ball; if (b.owner !== this) return false;
    const gx = this.team.oppGoalX;
    this.lookAt(gx, aimY);
    this.windup(() => {
      if (b.owner !== this) return;
      const d = Math.max(3, dist(b.x, b.y, gx, aimY)), pres = Match.pressureOn(this);
      const skill = this.a.sho / 100;
      let sd = (0.012 + (1 - skill) * 0.07 + Math.pow(power, 3) * 0.035) * (1 + pres * 0.9) * (this.human ? 1 : AI.errMul(this.team));
      if (finesse) sd *= 0.8;
      const vh = lerp(14, 31, power) * (0.85 + skill * 0.22) * (finesse ? 0.82 : 1);
      const a = Math.atan2(aimY - b.y, gx - b.x) + gauss() * sd;
      const t = d / vh;
      let vz = (aimZ - 0.1 + 0.5 * GRAV * t * t) / t;
      vz += gauss() * (0.4 + power * power * 1.6) + Math.max(0, power - 0.85) * 5;
      const spin = finesse ? -sgn(angDiff(Math.atan2(CY - b.y, gx - b.x), a)) * 0.06 : gauss() * 0.02;
      b.kick(this, Math.cos(a) * vh, Math.sin(a) * vh, Math.max(0, vz), spin, 'shot');
      b.trailOn = power > 0.6;
      this.stats.shots++; this.team.stats.shots++;
      Match.comment(Commentary.shot(this));
    }, 0.14);
    return true;
  }
  header(tx, ty, tz, power = 0.7, mate = null) {
    const b = Match.ball; b.passTo = mate; b.target = null; this.anim = 'header'; this.animT = 0; this.vz = Math.max(this.vz, 2.6); this.z = Math.max(this.z, 0.01);
    const d = Math.max(1, dist(b.x, b.y, tx, ty)), v = lerp(9, 19, power) * (0.8 + this.a.phy / 400);
    const a = Math.atan2(ty - b.y, tx - b.x) + gauss() * (0.05 + (1 - this.a.sho / 100) * 0.08), t = d / v;
    const vz = clamp((tz - b.z + 0.5 * GRAV * t * t) / t, -6, 8);
    const kind = Math.abs(tx - this.team.oppGoalX) < 1 ? 'header' : 'pass';
    b.kick(this, Math.cos(a) * v, Math.sin(a) * v, vz, 0, kind);
    if (kind === 'header') { this.stats.shots++; this.team.stats.shots++; Match.comment(this.name + ' бьёт головой!'); }
  }
  slideTackle() {
    if (!this.canAct()) return;
    this.anim = 'slide'; this.animT = 0; this.slideHit = false; this.slideBall = false; this.cd = 1.2;
    const sp = Math.max(this.maxSpeed() * 0.9, Math.hypot(this.vx, this.vy));
    this.vx = Math.cos(this.face) * sp; this.vy = Math.sin(this.face) * sp;
    FX.grass(this.x, this.y, 8);
  }
  standTackle() {
    const b = Match.ball, o = b.owner;
    if (!this.canAct() || this.cd > 0 || !o || o.team === this.team) return false;
    if (dist(this.x, this.y, b.x, b.y) > 1.35) return false;
    this.cd = 0.7; this.kick = 0;
    const p = clamp(0.42 + (this.a.def - o.a.dri) / 90 + (this.human ? 0.08 : 0) - (o.hasBallT < 0.3 ? 0.1 : 0), 0.12, 0.88);
    if (Math.random() < p) {
      Match.loseBall(o, this, true);
      this.stats.tackles++; this.team.stats.tackles = (this.team.stats.tackles || 0) + 1;
      return true;
    }
    // неудачный отбор: шанс фола при контакте сзади
    const behind = Math.cos(angDiff(this.face, o.face)) > 0.5;
    if (Math.random() < (behind ? 0.22 : 0.07)) Match.foul(this, o, behind ? 0.3 : 0.05);
    else { this.stun = 0.45; }
    return false;
  }
  dive(tx, ty, tz) {
    this.anim = 'dive'; this.animT = 0; this.diveZ = clamp(tz, 0.2, 2.3);
    const dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy) || 1, sp = Math.min(6.2, d / 0.35);
    this.vx = dx / d * sp; this.vy = dy / d * sp; this.vz = Math.sqrt(2 * GRAV * Math.max(0.05, this.diveZ * 0.55)); this.z = 0.01;
    this.diveDir = Math.atan2(dy, dx);
  }
}
// ============================ КОМАНДА ============================
class Team {
  constructor(data, side, kit, tac, lineup, bench) {
    this.data = data; this.side = side; this.kit = kit; this.tac = Object.assign({}, tac);
    this.players = lineup.map((info, slot) => new Player(info, this, slot));
    this.bench = bench.slice(); this.subsLeft = 3; this.subsDone = 0;
    this.score = 0; this.pens = 0; this.dir = side === 0 ? 1 : -1;
    this.stats = { shots: 0, onTarget: 0, passes: 0, passOk: 0, fouls: 0, corners: 0, offsides: 0, yellow: 0, red: 0, possT: 0, tackles: 0, saves: 0 };
    this.human = false; this.controlled = null; this.locked = null; this.counterT = 0; this.opp = null;
    this.scorers = [];
  }
  get ownGoalX() { return this.dir > 0 ? 0 : PITCH_L; }
  get oppGoalX() { return this.dir > 0 ? PITCH_L : 0; }
  rel(x) { return this.dir > 0 ? x : PITCH_L - x; }
  abs(r) { return this.dir > 0 ? r : PITCH_L - r; }
  gk() { return this.players.find(p => p.isGK && !p.sentOff); }
  active() { return this.players.filter(p => !p.sentOff); }
  style() { return STYLES[this.tac.style] || STYLES.balanced; }
  formationPos(p, kickoff) { // базовая позиция из схемы (для стандартов и начала)
    const s = FORMATIONS[this.tac.formation][p.slot]; let fx = s[1], fy = s[2];
    if (kickoff) fx = Math.min(fx * 0.72 + 0.02, 0.47);
    const y = this.dir > 0 ? fy * PITCH_W : PITCH_W - fy * PITCH_W;
    return { x: this.abs(fx * PITCH_L), y };
  }
  reassign() {
    const slots = FORMATIONS[this.tac.formation], ps = this.players, fixed = new Map();
    const li = ps.findIndex(p => p.info.isLegend && !p.sentOff);
    if (li >= 0) {
      let bi = 1, bp = 1e9;
      slots.forEach((s, i) => { if (s[0] === 'GK') return; const pen = posPenalty(ps[li].info.pos, s[0]); if (pen < bp) { bp = pen; bi = i; } });
      fixed.set(li, bi);
    }
    const res = bestAssign(ps, slots, p => p.info.ovr, p => p.info.pos, fixed);
    res.forEach((pi, si) => { if (pi >= 0) { ps[pi].slot = si; ps[pi].role = slots[si][0]; } });
  }
  secondLastRel(forTeam) { // линия офсайда для соперника в его системе координат
    const rs = this.active().map(p => forTeam.rel(p.x)).sort((a, b) => b - a);
    return rs.length > 1 ? rs[1] : PITCH_L;
  }
}

// ============================ ИСКУССТВЕННЫЙ ИНТЕЛЛЕКТ ============================
const AI = {
  errMul(team) { return team.human ? 1 : [1.7, 1.2, 0.9, 0.7][Settings.diff]; },
  react(team) { return team.human ? 0.2 : [0.38, 0.26, 0.17, 0.11][Settings.diff]; },
  skill(team) { return team.human ? 0.75 : [0.45, 0.65, 0.82, 0.95][Settings.diff]; },
  // время перехвата мяча игроком по прогнозу траектории
  intercept(p, path) {
    const sp = p.maxSpeed(), reach = p.isGK && Match.inOwnBox(p, p.x, p.y) ? 1.0 : 0.6, rt = 0.12, b = Match.ball;
    const recv = b.passTo === p && b.lastTeam === p.team && b.kind !== 'cross';
    const zMax = p.isGK ? 2.6 : recv ? 1.4 : 2.3;
    for (const q of path) {
      if (q.z > zMax) continue;
      const need = Math.max(0, dist(p.x, p.y, q.x, q.y) - reach) / sp + rt;
      if (need <= q.t) return { t: q.t, x: q.x, y: q.y, z: q.z };
    }
    const q = path[path.length - 1]; const need = dist(p.x, p.y, q.x, q.y) / sp + rt;
    return { t: Math.max(need, q.t), x: q.x, y: q.y, z: q.z };
  },
  shape(team, p, inPoss) {
    const s = FORMATIONS[team.tac.formation][p.slot], fx = s[1], fy = s[2], b = Match.ball, ballR = team.rel(b.x);
    const line = team.tac.line / 100, width = team.tac.width / 100, press = team.tac.press / 100;
    let defLine, length, wid, cy;
    if (inPoss) { defLine = clamp(ballR - 30 + line * 10, 12 + line * 16, 50 + line * 8); length = 40 + width * 6; wid = 44 + width * 22; cy = lerp(CY, b.y, 0.2); }
    else { defLine = clamp(ballR - 24 + line * 6, 7 + line * 22, 34 + line * 16); length = 24 + press * 10; wid = 30 + width * 10; cy = lerp(CY, b.y, 0.5); }
    if (team.counterT > 0 && inPoss) length += 12;
    team._defLine = defLine;
    const t = (fx - 0.2) / 0.47;
    let r = defLine + t * length;
    const grp = POS_GROUP[p.role];
    if (inPoss && grp === 'FB') r += 6 + width * 10;
    if (inPoss && (grp === 'ST' || grp === 'W' || grp === 'AM')) {
      const off = Math.max(team.opp.secondLastRel(team), 52.5);
      if (ballR < off) r = Math.min(r, off - 0.9);
    }
    let y = cy + (fy - 0.5) * wid * (team.dir > 0 ? 1 : -1);
    if (inPoss && grp === 'W') y = lerp(y, team.dir > 0 ? (fy < 0.5 ? 3.5 : PITCH_W - 3.5) : (fy < 0.5 ? PITCH_W - 3.5 : 3.5), width * 0.6);
    return { x: team.abs(clamp(r, 4, 101)), y: clamp(y, 1.5, PITCH_W - 1.5), defLine };
  },
  // ---------- главный цикл команды ----------
  update(team, dt) {
    const b = Match.ball, opp = team.opp;
    team.counterT = Math.max(0, team.counterT - dt);
    team._t = (team._t || 0) - dt;
    const poss = Match.possTeam();
    const inPoss = poss === team;
    if (team._t <= 0) {
      team._t = 0.1;
      const path = Match.ballPath;
      // кто бежит к мячу
      team._chaser = null; team._chaser2 = null;
      if (!b.owner && !b.holder) {
        let best = null, bt = 1e9, best2 = null, bt2 = 1e9;
        for (const p of team.active()) {
          if (p.isGK && !Match.inOwnBox(p, path[Math.min(path.length - 1, 20)].x, path[Math.min(path.length - 1, 20)].y)) continue;
          const ic = AI.intercept(p, path); p._ic = ic;
          let t = ic.t; if (b.passTo === p) t -= 0.5;
          if (t < bt) { best2 = best; bt2 = bt; best = p; bt = t; } else if (t < bt2) { best2 = p; bt2 = t; }
        }
        team._chaser = best; team._chaserT = bt;
        if (best2 && bt2 < bt + 0.6 && !(b.passTo && b.passTo.team === team)) team._chaser2 = best2;
      }
      // прессинг
      team._presser = null; team._presser2 = null;
      if (b.owner && b.owner.team !== team) {
        const o = b.owner; let best = null, bd = 1e9, best2 = null, bd2 = 1e9;
        for (const p of team.active()) {
          if (p.isGK) continue;
          const goalSide = team.rel(p.x) < team.rel(o.x) ? 0 : 4;
          const d = dist(p.x, p.y, o.x, o.y) + goalSide;
          if (d < bd) { best2 = best; bd2 = bd; best = p; bd = d; } else if (d < bd2) { best2 = p; bd2 = d; }
        }
        team._presser = best;
        const pz = team.rel(o.x);
        const pressOn = team.tac.press / 100 * (pz > 60 ? 1.2 : pz > 35 ? 1 : 0.85);
        if (pressOn > 0.55 && bd2 < 14) team._presser2 = best2;
        if (team._forcePress && team.human) {
          const helper = team.active().filter(p => !p.isGK && p !== team.controlled).sort((p1, p2) => dist(p1.x, p1.y, o.x, o.y) - dist(p2.x, p2.y, o.x, o.y))[0];
          if (helper) { team._presser = helper; team._presser2 = null; }
        }
      }
      // маркировка
      team._marks = new Map();
      if (!inPoss) {
        const dangers = opp.active().filter(q => q !== b.owner && !q.isGK).sort((a, c) => team.rel(a.x) - team.rel(c.x));
        const free = team.active().filter(p => !p.isGK && p !== team._presser && p !== team._presser2 && p !== team._chaser);
        for (const q of dangers) {
          if (team.rel(q.x) > team.rel(b.x) + 18) continue;
          let best = null, bd = 13;
          for (const p of free) { if (team._marks.has(p)) continue; const sh = p._shape || p; const d = dist(sh.x, sh.y, q.x, q.y); if (d < bd) { bd = d; best = p; } }
          if (best) team._marks.set(best, q);
        }
      }
      // опорный для поддержки владельца
      team._support = null;
      if (inPoss && b.owner) {
        const o = b.owner, sx = o.x - team.dir * 6, sy = o.y + (o.y < CY ? 9 : -9);
        let best = null, bd = 1e9;
        for (const p of team.active()) { if (p === o || p.isGK || p.making) continue; const d = dist(p.x, p.y, sx, sy); if (d < bd) { bd = d; best = p; } }
        team._support = best; team._supportPt = { x: clamp(sx, 3, 102), y: clamp(sy, 2, 66) };
      }
    }
    // ---------- поведение каждого игрока ----------
    for (const p of team.players) {
      if (p.sentOff) { p.update(dt); continue; }
      p._shape = AI.shape(team, p, inPoss);
      const humanCtl = p === team.controlled && !Match.isIdle(team);
      if (!humanCtl && p.canAct()) {
        if (p.isGK) AI.gk(team, p, dt);
        else AI.fieldPlayer(team, p, dt, inPoss);
      }
      p.update(dt);
    }
    if (b.owner && b.owner.team === team) team.stats.possT += dt;
  },
  fieldPlayer(team, p, dt, inPoss) {
    const b = Match.ball, sh = p._shape;
    p.watch = b;
    // владелец мяча
    if (b.owner === p) { AI.carrier(team, p, dt); return; }
    // мяч свободен
    if (!b.owner && !b.holder) {
      if (b.passTo === p && b.lastTeam === team) { const ic = p._ic || AI.intercept(p, Match.ballPath); p.steer(ic.x, ic.y, 0.95, 0.15); return; }
      if (team._chaser === p) { const ic = p._ic || AI.intercept(p, Match.ballPath); p.steer(ic.x, ic.y, ic.t < 2.5 ? 1 : 0.85, 0.1); return; }
      if (team._chaser2 === p) { const ic = p._ic || AI.intercept(p, Match.ballPath); p.steer(lerp(ic.x, sh.x, 0.3), lerp(ic.y, sh.y, 0.3), 0.8); return; }
    }
    if (inPoss) {
      // забегания за спину
      const grp = POS_GROUP[p.role], o = b.owner;
      if ((grp === 'ST' || grp === 'W' || (grp === 'AM' && Math.random() < 0.5)) && o) {
        p.runT -= dt;
        const off = Math.max(team.opp.secondLastRel(team), 52.5);
        const myR = team.rel(p.x), oR = team.rel(o.x);
        if (!p.making && p.runT <= 0 && oR > 28 && off < 96 && myR < off - 0.2 && Match.pressureOn(o) < 0.7) { p.making = true; p.runEnd = Match.time + 2.6; p.runY = clamp(p.y + (CY - p.y) * 0.3 + rand(-5, 5), 4, 64); }
        if (p.making) {
          if (Match.time > p.runEnd || b.owner !== o) { p.making = false; p.runT = rand(2, 5) * (1.4 - team.style().tempo / 100); }
          else { p.steer(team.abs(Math.min(off + 10, 101)), p.runY, 1); return; }
        }
      }
      if (team._support === p && team._supportPt) { p.steer(lerp(sh.x, team._supportPt.x, 0.7), lerp(sh.y, team._supportPt.y, 0.7), 0.7); return; }
      if (team.counterT > 0 && (grp === 'ST' || grp === 'W')) { p.steer(sh.x, sh.y, 1); return; }
      p.steer(sh.x, sh.y, dist(p.x, p.y, sh.x, sh.y) > 8 ? 0.85 : 0.55);
      return;
    }
    // оборона
    const o = b.owner;
    if (o && o.team !== team) {
      if (team._presser === p && !(team.controlled && team.controlled !== p && dist(team.controlled.x, team.controlled.y, o.x, o.y) < 4 && !Match.isIdle(team))) {
        const gx = team.ownGoalX, d = dist(p.x, p.y, o.x, o.y);
        const ux = (gx - o.x), uy = (CY - o.y), ul = Math.hypot(ux, uy) || 1;
        const px = o.x + ux / ul * 1.1 + o.vx * 0.25, py = o.y + uy / ul * 1.1 + o.vy * 0.25;
        const frac = d > 6 ? 0.95 : d > 2.5 ? 0.75 : 0.5;
        p.steer(px, py, frac, 0.1);
        const aggr = team.tac.press / 100 * AI.skill(team);
        if (d < 1.3 && Math.random() < dt * (1.2 + aggr * 2.2)) p.standTackle();
        else if (d < 2.2 && d > 1.1 && Math.random() < dt * 0.25 * aggr && Math.abs(angDiff(p.face, Math.atan2(o.y - p.y, o.x - p.x))) < 0.5 && team.rel(o.x) < 70) p.slideTackle();
        return;
      }
      if (team._presser2 === p) {
        // перекрыть линию паса
        let tgt = null, bd = 1e9;
        for (const q of team.opp.active()) { if (q === o || q.isGK) continue; const d = dist(q.x, q.y, o.x, o.y); if (d < bd && d > 5) { bd = d; tgt = q; } }
        if (tgt) { p.steer(lerp(o.x, tgt.x, 0.45), lerp(o.y, tgt.y, 0.45), 0.85); return; }
      }
    }
    const q = team._marks && team._marks.get(p);
    if (q) {
      const gx = team.ownGoalX, ux = gx - q.x, uy = CY - q.y, ul = Math.hypot(ux, uy) || 1;
      let mx = q.x + ux / ul * 1.7, my = q.y + uy / ul * 1.7;
      if (b) { mx += (b.x - q.x) * 0.12; my += (b.y - q.y) * 0.12; }
      const grp = POS_GROUP[p.role];
      if (grp === 'CB' || grp === 'FB') {
        const qr = team.rel(q.x), lineR = sh.defLine;
        const trap = o && Match.pressureOn(o) > 0.55 && qr < lineR - 1.5 && Settings.diff >= 1;
        let r = trap ? lineR : Math.min(lineR, qr - 1.4);
        mx = team.abs(r); my = lerp(my, sh.y, 0.25);
      }
      const tx = lerp(sh.x, mx, 0.75), ty = lerp(sh.y, my, 0.75);
      p.steer(tx, ty, dist(p.x, p.y, tx, ty) > 5 ? 0.9 : 0.6);
      return;
    }
    p.steer(sh.x, sh.y, dist(p.x, p.y, sh.x, sh.y) > 8 ? 0.85 : 0.55);
  },
  // ---------- решения владельца мяча ----------
  carrier(team, p, dt) {
    const b = Match.ball, gx = team.oppGoalX, opp = team.opp;
    p.decT -= dt;
    const pres = Match.pressureOn(p);
    const style = team.style();
    // ведение по умолчанию: вперёд, в обход соперников
    const dribDir = AI.bestDribbleDir(team, p);
    const carryFrac = team.counterT > 0 || dribDir.space > 9 ? 0.95 : 0.62;
    if (p.isGK) p.steer(p.x + team.dir * 1.5, p.y, 0.3);
    else p.steer(p.x + Math.cos(dribDir.a) * 6, p.y + Math.sin(dribDir.a) * 6, carryFrac);
    if (p.decT > 0 || !p.canAct() || p.pending || p.cd > 0) return;
    if (p.hasBallT < 0.25 && pres < 0.6) return;
    p.decT = AI.react(team) * (0.8 + Math.random() * 0.6) * (pres > 0.6 ? 0.6 : 1);
    const opts = [];
    const noise = () => gauss() * (1 - AI.skill(team)) * 0.25;
    // удар
    const dG = dist(p.x, p.y, gx, CY);
    if (dG < 30) {
      const xg = AI.xg(team, p, p.x, p.y);
      const want = xg * (0.8 + p.a.sho / 250) + (dG < 12 ? 0.15 : 0) - (dG > 22 ? 0.12 : 0);
      opts.push({ v: want * 2.2 + noise(), f: () => AI.doShoot(team, p) });
    }
    // пасы
    const myVal = AI.zoneVal(team, p.x, p.y);
    for (const q of team.active()) {
      if (q === p) continue;
      if (q.isGK && (pres < 0.75 || team.rel(p.x) > 40)) continue;
      const d = dist(p.x, p.y, q.x, q.y); if (d < 4 || d > 45) continue;
      const rG = AI.laneRisk(team, p.x, p.y, q.x, q.y, 'pass'), rL = d > 25 ? AI.laneRisk(team, p.x, p.y, q.x, q.y, 'lob') + 0.32 + (1 - p.a.pas / 100) * 0.4 : 9;
      const lofted = rL < rG, risk = Math.min(rG, rL);
      const open = Math.min(8, AI.nearestOpp(team, q.x, q.y)) / 8;
      const gain = AI.zoneVal(team, q.x, q.y) - myVal;
      let v = 0.22 + gain * 2.2 + open * 0.3 - risk * (1.2 + (1 - style.tempo / 100) * 0.8) - d * 0.004 + (d < 16 && style.tempo < 50 ? 0.08 : 0);
      if (team.counterT > 0) v += Math.max(0, team.rel(q.x) - team.rel(p.x)) * 0.015;
      if (pres > 0.6) v += 0.15;
      if (q.human) v += 0.08;
      if (Match.legendCall && Match.legendCall.p === q && Match.time - Match.legendCall.t < 1.6) v += 0.55;
      opts.push({ v: v + noise(), f: () => { p.passTo(q, lofted ? 'long' : 'pass'); } });
      // пас на ход
      if (q.making || (POS_GROUP[q.role] === 'ST' && team.rel(q.x) > 60)) {
        const lead = Math.min(10, 4 + d * 0.15), lx = clamp(q.x + team.dir * lead, 2, 103), ly = clamp(q.y + q.vy * 0.6, 2, 66);
        const off = opp.secondLastRel(team);
        if (team.rel(q.x) < Math.max(off, 52.5) + 0.2 || team.rel(b.x) >= off) {
          const r2 = AI.laneRisk(team, p.x, p.y, lx, ly, 'pass');
          const space = Math.min(10, AI.nearestOpp(team, lx, ly)) / 10;
          const v2 = (AI.zoneVal(team, lx, ly) - myVal) * 1.7 + space * 0.5 - r2 * 1.1 + (q.making ? 0.25 : 0);
          opts.push({ v: v2 + noise(), f: () => { p.passTo(q, 'through', { x: lx, y: ly }); } });
        }
      }
    }
    // навес
    if (team.rel(p.x) > 75 && Math.abs(p.y - CY) > 14) {
      const tx = team.abs(PITCH_L - rand(6, 11)), ty = CY + rand(-5, 5);
      const heads = team.active().filter(q => q !== p && dist(q.x, q.y, tx, ty) < 9).length;
      opts.push({ v: 0.25 + heads * 0.18 + style.cross * 0.35 + noise(), f: () => { const tgt = team.active().filter(q => q !== p).sort((a, c) => dist(a.x, a.y, tx, ty) - dist(c.x, c.y, tx, ty))[0]; Match.ball.passTo = tgt; p.lookAt(tx, ty); p.windup(() => { if (Match.ball.owner === p) { p.lobTo(tx, ty, 'cross', p.kickError('cross')); p.stats.passes++; } }, 0.16); } });
    }
    // продолжить ведение
    const dv = 0.12 + Math.min(10, dribDir.space) / 10 * 0.32 + (p.a.dri - 72) / 90 + (team.rel(p.x) > 70 ? 0.08 : 0) - pres * 0.55 + (team.counterT > 0 ? 0.28 : 0) - Math.max(0, p.hasBallT - 2.2) * 0.25;
    if (!p.isGK) opts.push({ v: dv + noise(), f: () => {
      if (pres > 0.65 && Math.random() < p.a.dri / 160) AI.skillMove(p);
    } });
    // вынос
    if ((team.rel(p.x) < 25 && pres > 0.7) || (p.isGK && (pres > 0.45 || p.hasBallT > 1.5))) opts.push({ v: 0.4 + noise(), f: () => { const tx = team.abs(clamp(team.rel(p.x) + 38, 40, 72)), ty = p.y < CY ? 15 : 53; p.lookAt(tx, ty); p.windup(() => { if (Match.ball.owner === p) p.lobTo(tx, ty, 'long', p.kickError('long') * 1.3); }, 0.12); } });
    opts.sort((a, c) => c.v - a.v);
    if (opts[0]) opts[0].f();
  },
  skillMove(p) {
    const side = Math.random() < 0.5 ? -1 : 1, a = p.face + side * 0.9;
    p.vx = Math.cos(a) * p.maxSpeed() * 0.95; p.vy = Math.sin(a) * p.maxSpeed() * 0.95;
    for (const q of p.team.opp.active()) if (dist(q.x, q.y, p.x, p.y) < 2.5 && Math.random() < p.a.dri / 130 - q.a.def / 300) { q.stun = 0.55; }
    p.skillT = 0.5; Match.comment(Commentary.skill(p));
  },
  doShoot(team, p) {
    const gk = team.opp.gk(), gx = team.oppGoalX;
    let aimY;
    if (gk) { const far = gk.y > CY ? CY - GOAL_W / 2 + 0.6 : CY + GOAL_W / 2 - 0.6; aimY = Math.random() < 0.7 ? far : CY + rand(-2.5, 2.5); } else aimY = CY;
    const d = dist(p.x, p.y, gx, CY);
    const power = clamp(0.45 + d / 50 + rand(-0.08, 0.1), 0.4, 0.92);
    const finesse = d < 20 && Math.random() < 0.45;
    p.shoot(aimY, rand(0.3, d < 12 ? 1.2 : 1.9), power, finesse);
  },
  xg(team, p, x, y) {
    const gx = team.oppGoalX, d = dist(x, y, gx, CY);
    const a1 = Math.atan2(CY - GOAL_W / 2 - y, gx - x), a2 = Math.atan2(CY + GOAL_W / 2 - y, gx - x);
    const ang = Math.abs(angDiff(a1, a2));
    let v = clamp(ang * 1.4, 0, 1) * clamp(1.15 - d / 30, 0, 1);
    for (const q of team.opp.active()) {
      if (q.isGK) continue;
      const qd = dist(x, y, q.x, q.y); if (qd > d) continue;
      const qa = Math.atan2(q.y - y, q.x - x), mid = Math.atan2(CY - y, gx - x);
      if (Math.abs(angDiff(qa, mid)) < ang / 2 + 0.1) v *= 0.62;
    }
    return v;
  },
  zoneVal(team, x, y) { const r = team.rel(x) / PITCH_L, c = 1 - Math.min(1, Math.abs(y - CY) / 34); return r * r * (0.75 + 0.25 * c) + (r > 0.83 && c > 0.55 ? 0.25 : 0); },
  nearestOpp(team, x, y) { let m = 1e9; for (const q of team.opp.active()) { const d = dist(x, y, q.x, q.y); if (d < m) m = d; } return m; },
  laneRisk(team, x1, y1, x2, y2, kind) {
    const d = dist(x1, y1, x2, y2), v = kind === 'lob' ? 20 : passSpeed(d, 6);
    let risk = 0;
    for (const q of team.opp.active()) {
      for (const u of [0.2, 0.45, 0.7, 0.95]) {
        if (kind === 'lob' && u > 0.15 && u < 0.85) continue;
        const px = lerp(x1, x2, u), py = lerp(y1, y2, u);
        const tb = kind === 'lob' ? u * d / v : (rollTime(v, u * d) || u * d / v);
        const to = Math.max(0, dist(px, py, q.x, q.y) - 0.9) / 7.5 + 0.15;
        const r = 1 / (1 + Math.exp((to - tb) * 5));
        if (r > risk) risk = r;
      }
    }
    return risk;
  },
  bestDribbleDir(team, p) {
    const gx = team.oppGoalX, base = Math.atan2(lerp(CY, p.y, team.rel(p.x) > 80 ? 0.2 : 0.6) - p.y, gx - p.x);
    let best = { a: base, space: 0, v: -1e9 };
    for (const off of [0, -0.5, 0.5, -1, 1, -1.5, 1.5]) {
      const a = base + off, tx = p.x + Math.cos(a) * 5, ty = p.y + Math.sin(a) * 5;
      if (tx < 1 || tx > 104 || ty < 1.5 || ty > 66.5) continue;
      const space = AI.nearestOpp(team, tx, ty);
      const v = Math.min(space, 10) - Math.abs(off) * 2.2;
      if (v > best.v) best = { a, space, v };
    }
    return best;
  },
  // ---------- вратарь ----------
  gk(team, p, dt) {
    const b = Match.ball, gx = team.ownGoalX, dir = team.dir;
    p.watch = b; p.arms = 'gk';
    if (b.holder === p) {
      p.stop(); p.holdT = (p.holdT || 0) + dt;
      if (p.holdT > 1.4 + Math.random() * 0.5 && !p.human) AI.gkDistribute(team, p);
      return;
    }
    p.holdT = 0;
    if (b.owner === p) { AI.carrier(team, p, dt); return; }
    // летящий в створ мяч
    if (!b.owner && b.vx * dir < -3 && b.lastTeam !== team) {
      const tLine = (p.x - b.x) / (b.vx || 1e-6);
      if (tLine > 0 && tLine < 1.6) {
        const yp = b.y + b.vy * tLine, zp = b.z + b.vz * tLine - 0.5 * GRAV * tLine * tLine;
        const onT = Math.abs(yp - CY) < GOAL_W / 2 + 0.8 && zp < GOAL_H + 0.6;
        if (onT) {
          p.gkReact = (p.gkReact || 0) + dt;
          const react = 0.08 + (1 - (p.a.gk || 70) / 100) * 0.45 + (team.human ? 0.03 : [0.12, 0.06, 0.02, 0][Settings.diff]);
          if (p.gkReact > react && p.anim !== 'dive') {
            const off = Math.abs(yp - p.y);
            if (off > 1.0 || zp > 1.9) p.dive(p.x, yp, Math.max(0.3, zp));
            else p.steer(p.x, yp, 1, 0.05);
          }
          return;
        }
      }
    }
    p.gkReact = 0;
    // забрать навес
    if (!b.owner && b.z > 1 && b.lastTeam !== team) {
      const land = Match.ballPath.find(q => q.t > 0.2 && q.z < 2.6 && q.z > 0.5);
      if (land && Math.abs(land.x - gx) < 8 && Math.abs(land.y - CY) < 10) { p.steer(land.x, land.y, 1, 0.1); return; }
    }
    // свободный мяч в штрафной
    if (!b.owner && team._chaser === p) { const ic = p._ic || AI.intercept(p, Match.ballPath); p.steer(ic.x, ic.y, 1, 0.1); return; }
    // выход один на один
    const o = b.owner;
    if (o && o.team !== team && Math.abs(o.x - gx) < 17 && Math.abs(o.y - CY) < 18) {
      const defBetween = team.active().some(q => !q.isGK && Math.abs(q.x - gx) < Math.abs(o.x - gx) && dist(q.x, q.y, o.x, o.y) < 5);
      if (!defBetween) {
        const d = dist(p.x, p.y, o.x, o.y);
        p.steer(lerp(gx + dir * 1, o.x, 0.75), lerp(CY, o.y, 0.8), 0.95, 0.2);
        if (d < 1.5 && Math.random() < dt * (1.5 + (p.a.gk || 70) / 60)) { p.dive(b.x, b.y, 0.2); }
        return;
      }
    }
    // позиционирование
    const bd = dist(b.x, b.y, gx, CY), ux = (b.x - gx) / (bd || 1), uy = (b.y - CY) / (bd || 1);
    const out = clamp(bd * 0.1, 0.6, team.rel(b.x) > 60 ? 9 + team.tac.line / 20 : 4.5);
    const tx = gx + ux * out, ty = clamp(CY + uy * out, CY - 3.4, CY + 3.4);
    p.steer(tx, ty, 0.6, 0.15);
  },
  gkDistribute(team, p) {
    const opts = team.active().filter(q => q !== p).map(q => ({ q, open: AI.nearestOpp(team, q.x, q.y), d: dist(p.x, p.y, q.x, q.y) }));
    const short = opts.filter(o => o.open > 7 && o.d < 35 && AI.laneRisk(team, p.x, p.y, o.q.x, o.q.y, 'pass') < 0.35).sort((a, c) => c.open - a.open)[0];
    const style = team.style();
    if (short && (style.tempo < 70 || Math.random() < 0.5)) p.passTo(short.q, 'pass');
    else { const fw = opts.filter(o => team.rel(o.q.x) > 55).sort((a, c) => c.open - a.open)[0]; if (fw) p.passTo(fw.q, 'punt'); else if (opts[0]) p.passTo(opts[0].q, 'pass'); }
  }
};
// ============================ КОММЕНТАРИЙ ============================
const Commentary = {
  shot: p => pick([`Удар! Бьёт ${p.name}`, `${p.name} пробует пробить`, `${p.name} — удар по воротам!`, `Решается на удар ${p.name}`]),
  skill: p => pick([`${p.name} уходит финтом!`, `Какой финт! ${p.name} обыгрывает соперника`, `${p.name} накручивает защитника`]),
  save: g => pick([`Сейв! ${g.name} выручает команду`, `${g.name} тащит мёртвый мяч!`, `Блестящая реакция, ${g.name}`]),
  catchB: g => pick([`${g.name} уверенно забирает мяч`, `Мяч в руках у вратаря`]),
  post: () => pick(['Штанга!', 'Попадание в каркас ворот!', 'Перекладина! Мяч отлетает в поле']),
  miss: p => pick([`Мимо! ${p.name} промахнулся`, `${p.name} не попадает в створ`, 'Выше ворот!']),
  tackle: p => pick([`${p.name} отбирает мяч`, `Чистый отбор от ${p.name}`, `${p.name} выигрывает единоборство`]),
  foul: (p, v) => pick([`Фол! ${p.name} сбивает соперника`, `Нарушение правил, судья свистит`, `${v.name} на газоне, будет штрафной`]),
  offside: p => pick([`Офсайд! ${p.name} был в положении вне игры`, `Лайнсмен поднимает флаг: офсайд`, 'Вне игры!']),
  corner: t => pick([`Угловой для команды ${t.data.name}`, 'Подача углового']),
  goalkick: () => pick(['Удар от ворот', 'Мяч ушёл за лицевую. Удар от ворот']),
  throwIn: t => pick([`Аут в пользу ${t.data.short}`, 'Мяч за боковой. Вбрасывание']),
  freekick: t => `Штрафной для ${t.data.short}`,
  penalty: () => pick(['ПЕНАЛЬТИ! Судья показывает на точку!', 'Пенальти! Это нарушение в штрафной']),
  kickoff: () => pick(['Мяч в игре!', 'Начали!', 'Разводка с центра поля'])
};

// ============================ МАТЧ ============================
const Match = {
  active: false, paused: false, mode: 'quick', ball: new Ball(), home: null, away: null, teams: [],
  time: 0, clock: 0, half: 1, added: 0, clockScale: 15, state: 'none', stateT: 0,
  ballPath: [], pathT: 0, offside: null, offLine: null, setPiece: null, deadBall: false,
  events: [], rec: [], recT: 0, replay: null, legendCall: null, crowdExcite: 0.3, celebSide: null,
  lastPass: null, goalInfo: null, ref: null, lines: [], firstKick: 0, staminaScale: 1, pen: null, shoot: null,
  goals: [{ x: 0, out: -1, hit: null }, { x: PITCH_L, out: 1, hit: null }],
  cfg: null, onEnd: null, injury: 0, lastGoalTime: -99,

  start(cfg) {
    this.cfg = cfg; this.mode = cfg.mode || 'quick';
    const homeKit = kitFor(cfg.home, null), awayKit = kitFor(cfg.away, cfg.home);
    this.home = new Team(cfg.home, 0, homeKit, cfg.homeTac, cfg.homeXI, cfg.homeBench);
    this.away = new Team(cfg.away, 1, awayKit, cfg.awayTac, cfg.awayXI, cfg.awayBench);
    this.home.opp = this.away; this.away.opp = this.home; this.teams = [this.home, this.away];
    for (const t of this.teams) t.reassign();
    if (cfg.humanSide === 0) this.home.human = true;
    if (cfg.humanSide === 1) this.away.human = true;
    if (cfg.legend) {
      const t = this.teams[cfg.legend.side]; const lp = t.players.find(p => p.info.id === cfg.legend.id);
      if (lp) { t.locked = lp; t.controlled = lp; lp.isLegend = true; }
    }
    this.ball = new Ball(); this.time = 0; this.clock = 0; this.half = 1; this.added = randi(1, 3);
    this.clockScale = 2700 / ((cfg.halfLen || Settings.half) * 60);
    this.staminaScale = this.clockScale / 15;
    this.events = []; this.rec = []; this.offside = null; this.offLine = null; this.lastPass = null; this.goalInfo = null;
    this.firstKick = Math.random() < 0.5 ? 0 : 1; this.paused = false; this.active = true; this.lastGoalTime = -99;
    this.goals.forEach(g => (g.hit = null));
    Stadium.build(homeKit, awayKit);
    this.ref = { x: CX - 10, y: CY + 12, vx: 0, vy: 0, face: 0, phase: 0, card: null, cardT: 0 };
    this.lines = [{ x: CX + 20, y: PITCH_W + 1.3, side: 1, flag: 0, phase: 0, vx: 0 }, { x: CX - 20, y: -1.3, side: 0, flag: 0, phase: 0, vx: 0 }];
    for (const t of this.teams) for (const p of t.players) { const f = t.formationPos(p, true); p.x = f.x; p.y = f.y; p.face = t.dir > 0 ? 0 : Math.PI; }
    if (this.mode === 'shootout') { this.startShootout(); return; }
    if (cfg.skipIntro) this.startKickoff(this.teams[this.firstKick]);
    else this.startIntro();
    UI.hudStart();
  },
  stop() { this.active = false; this.state = 'none'; },
  setState(s) { this.state = s; this.stateT = 0; },
  minute() { return Math.min(this.half === 1 ? 45 + this.added : 90 + this.added, Math.floor(this.clock / 60) + (this.half === 2 ? 45 : 0) + 1); },
  minuteLabel() { const m = Math.floor(this.clock / 60) + (this.half === 2 ? 45 : 0), base = this.half === 1 ? 45 : 90; return m >= base ? `${base}+${m - base + 1}'` : `${m + 1}'`; },
  allPlayers() { return this.home.players.concat(this.away.players); },
  possTeam() {
    const b = this.ball;
    if (b.owner) return b.owner.team; if (b.holder) return b.holder.team;
    if (b.passTo && b.lastTeam && b.passTo.team === b.lastTeam) return b.lastTeam;
    return null;
  },
  pressureOn(p) { let m = 0; for (const q of p.team.opp.active()) { const d = dist(p.x, p.y, q.x, q.y); const v = clamp(1 - (d - 0.8) / 4, 0, 1); if (v > m) m = v; } return m; },
  inOwnBox(p, x, y) { const gx = p.team.ownGoalX; return Math.abs(x - gx) < BOX_L + 0.3 && Math.abs(y - CY) < BOX_W / 2 + 0.3; },
  inBoxOf(team, x, y) { const gx = team.ownGoalX; return Math.abs(x - gx) < BOX_L && Math.abs(y - CY) < BOX_W / 2; },
  isIdle(team) { return team.human && (Input.idle() > 4 || Input.disconnected); },
  comment(t) { UI.comment(t); },

  update(dt) {
    if (!this.active || this.paused) return;
    this.time += dt; this.stateT += dt;
    const st = this.state;
    if (st === 'replay') { this.updateReplay(dt); this.officials(dt); return; }
    let sdt = dt;
    if (st === 'goal' && this.stateT < 1.0) sdt = dt * 0.4;
    this.pathT -= sdt; if (this.pathT <= 0) { this.ballPath = this.ball.predict(3, 0.05); this.pathT = 0.08; }
    if (st === 'intro') this.updateIntro(sdt);
    else if (st === 'kickoff' || st === 'setpiece') this.updateSetPiece(sdt);
    else if (st === 'goal' || st === 'celebrate') this.updateCelebrate(sdt);
    else if (st === 'penalty' || st === 'shootout') this.updatePenalty(sdt);
    else if (st === 'play') {
      Human.update(sdt);
      AI.update(this.home, sdt); AI.update(this.away, sdt);
    } else if (st === 'halftime' || st === 'fulltime' || st === 'offside' || st === 'foul') {
      this.scripted(sdt);
    }
    if (st !== 'replay') {
      this.ball.step(sdt);
      if (st === 'play' || st === 'goal' || (st === 'shootout' && this.pen && this.pen.kicked) || (st === 'penalty' && this.pen && this.pen.kicked)) { this.ballInteraction(sdt); }
      this.collisions();
      this.frame(sdt);
      if (st === 'play' || (this.pen && this.pen.kicked)) this.checkBounds();
      this.netHold();
    }
    if (st === 'play') {
      this.clock += sdt * this.clockScale;
      const endT = 2700 + this.added * 60;
      if (this.clock >= endT) {
        const b = this.ball, danger = Math.abs(b.x - CX) > 36 && this.possTeam();
        if (!danger || this.clock > endT + 25 * this.clockScale / 15) this.endHalf();
      }
    }
    if (st === 'play' || st === 'goal' || st === 'setpiece') this.record(dt);
    for (const g of this.goals) if (g.hit) { g.hit.a *= Math.max(0, 1 - dt * 2.2); if (g.hit.a < 0.01) g.hit = null; }
    this.officials(dt);
    this.camera(dt);
    // атмосфера
    const b = this.ball, ex = this.state === 'play' ? clamp(0.25 + Math.max(0, 1 - Math.min(Math.abs(b.x), Math.abs(PITCH_L - b.x)) / 30) * 0.6, 0.2, 0.9) : this.crowdExcite;
    this.crowdExcite = lerp(this.crowdExcite, ex, dt * 0.8);
    Sfx.setCrowd(0.35 + this.crowdExcite * 0.4, Math.max(0, this.crowdExcite - 0.5));
    if (this.legendCall && this.time - this.legendCall.t > 2) this.legendCall = null;
    if (this.offLine && this.time - this.offLine.t > 3) this.offLine = null;
  },
  // игроки, которые просто бегут к своим целям (паузы, перерыв)
  scripted(dt) {
    for (const p of this.allPlayers()) {
      if (p.goalT) p.steer(p.goalT.x, p.goalT.y, p.goalT.s || 0.5, 0.3); else p.stop();
      p.update(dt);
    }
    if (this.state === 'offside' || this.state === 'foul') { if (this.stateT > 1.6) this.beginSetPiece(); }
  },
  frame(dt) { if (this.ref) { /* обновляется в officials */ } },
  collisions() {
    const ps = this.allPlayers();
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i]; if (a.sentOff || a.anim === 'dive') continue;
      for (let j = i + 1; j < ps.length; j++) {
        const c = ps[j]; if (c.sentOff || c.anim === 'dive') continue;
        const dx = c.x - a.x, dy = c.y - a.y, d2 = dx * dx + dy * dy;
        if (d2 < 0.36 && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = (0.6 - d) / 2, nx = dx / d, ny = dy / d;
          const wa = a.a.phy, wc = c.a.phy, ka = wc / (wa + wc), kc = wa / (wa + wc);
          a.x -= nx * push * 2 * ka; a.y -= ny * push * 2 * ka; c.x += nx * push * 2 * kc; c.y += ny * push * 2 * kc;
        }
      }
    }
  },
  // ---------- контакт с мячом ----------
  ballInteraction(dt) {
    const b = this.ball;
    if (b.holder) return;
    // подкаты
    for (const p of this.allPlayers()) {
      if (p.anim !== 'slide' || p.animT > 0.7) continue;
      const fx = p.x + Math.cos(p.face) * 0.65, fy = p.y + Math.sin(p.face) * 0.65;
      if (!p.slideBall && b.z < 0.6 && dist(fx, fy, b.x, b.y) < 0.85) {
        p.slideBall = true;
        if (b.owner && b.owner.team !== p.team) { const o = b.owner; this.loseBall(o, p, false); o.anim = 'fall'; o.animT = 0.5; p.stats.tackles++; this.comment(Commentary.tackle(p)); }
        else if (!b.owner) { const sp = 6 + Math.random() * 4; b.owner = null; b.vx = Math.cos(p.face + gauss() * 0.3) * sp; b.vy = Math.sin(p.face + gauss() * 0.3) * sp; b.lastTouch = p; b.lastTeam = p.team; b.kickCD = 0.2; b.kicker = p; this.onTouch(p, true); }
        Sfx.kick(0.3);
      }
      if (!p.slideBall && !p.slideHit) {
        for (const q of p.team.opp.active()) {
          if (q.anim === 'fall') continue;
          if (dist(p.x + Math.cos(p.face) * 0.4, p.y + Math.sin(p.face) * 0.4, q.x, q.y) < 0.7) {
            p.slideHit = true;
            const behind = Math.cos(angDiff(p.face, q.face)) > 0.4;
            this.foul(p, q, behind ? 0.45 : 0.2 + Math.hypot(p.vx, p.vy) / 40);
            return;
          }
        }
      }
    }
    if (b.owner) {
      const o = b.owner;
      if (!o.canAct() && o.anim !== 'header') { b.owner = null; return; }
      const sp = Math.hypot(o.vx, o.vy);
      const ahead = sp > 6.2 ? 0.75 + (1 - o.a.dri / 100) * 0.7 : 0.38 + sp * 0.04;
      const tx = o.x + Math.cos(o.face) * ahead, ty = o.y + Math.sin(o.face) * ahead;
      const k = 7 + o.a.dri / 12;
      b.vx = o.vx + (tx - b.x) * k; b.vy = o.vy + (ty - b.y) * k; b.z = 0; b.vz = 0;
      if (dist(o.x, o.y, b.x, b.y) > 2) b.owner = null;
      return;
    }
    // свободный мяч: кто касается первым
    let best = null, bd = 1e9, mode = '';
    for (const p of this.allPlayers()) {
      if (p.sentOff || p.stun > 0.3 || p.noTouch > this.time) continue;
      if (b.kickCD > 0 && b.kicker === p) continue;
      if (['fall', 'getup', 'celebrate'].includes(p.anim)) continue;
      const d = dist(p.x, p.y, b.x, b.y);
      const hands = p.isGK && this.inOwnBox(p, b.x, b.y) && !(this.state === 'shootout' && false);
      let m = '';
      if (hands) {
        const reach = p.anim === 'dive' ? 1.35 : 0.95;
        const cz = p.anim === 'dive' ? p.z + 0.4 : 1.2;
        const d3 = Math.hypot(d, Math.max(0, Math.abs(b.z - cz) - (p.anim === 'dive' ? 0.5 : 1.3)));
        if (d3 < reach && b.z < 2.75) m = 'hands';
      }
      const chest = (b.passTo === p && b.lastTeam === p.team) || Math.hypot(b.vx, b.vy) < 8;
      if (!m && (b.z < 1.25 || (chest && b.z < 1.75)) && d < (p.anim === 'slide' ? 0.95 : 0.66)) m = 'feet';
      const waitDrop = b.passTo === p && b.lastTeam === p.team && b.kind !== 'cross' && b.vz < 0 && b.z < 3;
      if (!m && b.z >= 1.25 && b.z < 2.7 && d < 0.8 && !p.isGK && !waitDrop) m = 'head';
      if (m && d < bd) { bd = d; best = p; mode = m; }
    }
    if (!best) return;
    const p = best;
    if (this.onTouch(p)) return;
    if (mode === 'hands') { this.gkTouch(p); return; }
    if (mode === 'head') { this.headerTouch(p); return; }
    const relV = Math.hypot(b.vx - p.vx, b.vy - p.vy);
    if ((b.kind === 'shot' || b.kind === 'header') && b.lastTeam !== p.team && relV > 13) {
      const sp = relV * rand(0.15, 0.35), a = Math.atan2(-b.vy, -b.vx) + gauss() * 0.9;
      b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp; b.vz = rand(0, 2.5); b.kind = 'block'; b.lastTouch = p; b.lastTeam = p.team; b.kicker = p; b.kickCD = 0.3;
      Sfx.thud(); this.comment(`${p.name} блокирует удар`); return;
    }
    if (relV > 20 && Math.random() > p.a.dri / 110) {
      const sp = relV * 0.3, a = Math.atan2(b.vy, b.vx) + gauss() * 0.8; b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp; b.kickCD = 0.25; b.kicker = p; b.lastTouch = p; b.lastTeam = p.team; Sfx.thud(); return;
    }
    // приём мяча
    const wasTeam = b.lastTeam;
    b.owner = p; b.kind = ''; b.trailOn = false; b.z = 0; b.vz = 0;
    p.hasBallT = 0; p.decT = AI.react(p.team) * 0.8; p.making = false;
    if (Math.hypot(p.vx, p.vy) < 1 && relV > 3) p.face = Math.atan2(-b.vy, -b.vx) + Math.PI;
    this.gainPossession(p, wasTeam);
  },
  gainPossession(p, wasTeam) {
    const b = this.ball, t = p.team;
    if (this.lastPass && this.lastPass.from.team === t && this.lastPass.from !== p && this.time - this.lastPass.t < 6) { this.lastPass.from.stats.passOk++; t.stats.passOk++; this.lastPass.ok = p; }
    b.lastTouch = p; b.lastTeam = t; b.passTo = null; b.target = null;
    if (wasTeam && wasTeam !== t) {
      // смена владения → контратака
      const committed = t.opp.active().filter(q => t.rel(q.x) < t.rel(p.x)).length;
      if (t.style().counter >= 0.4 && committed >= 4 && t.rel(p.x) < 62) { t.counterT = 4 + t.style().counter * 3; if (Math.random() < 0.6) this.comment(`${t.data.short} в контратаке!`); }
    }
    if (t.human && !t.locked && t.controlled !== p) Human.switchTo(t, p);
  },
  gkTouch(p) {
    const b = this.ball, v = Math.hypot(b.vx, b.vy, b.vz), gkr = p.a.gk || 70;
    const shot = (b.kind === 'shot' || b.kind === 'header') && b.lastTeam !== p.team;
    if (!shot && b.lastTeam === p.team && ['pass', 'through', 'long'].includes(b.kind) && b.z < 0.6) {
      b.owner = p; b.kind = ''; p.hasBallT = 0; this.gainPossession(p, b.lastTeam); return;
    }
    const diffMod = p.team.human ? 0 : [-0.12, -0.04, 0.04, 0.1][Settings.diff];
    const pCatch = shot ? clamp(gkr / 100 * 1.2 - v / 32 + (p.anim === 'dive' ? -0.12 : 0.12) + diffMod, 0.04, 0.92) : 0.92;
    const pSave = shot ? clamp(0.52 + gkr / 190 - (v - 18) / 42 + diffMod, 0.12, 0.96) : 0.98;
    const r = Math.random();
    if (r < pCatch) {
      b.holder = p; b.owner = null; b.kind = ''; b.passTo = null; p.holdT = 0;
      if (shot) { p.stats.saves++; p.team.stats.saves++; b.shotBy && b.shotBy.team.stats.onTarget++; b.shotBy && b.shotBy.stats.onTarget++; this.comment(v > 20 ? Commentary.save(p) : Commentary.catchB(p)); if (v > 20) Sfx.ooh(); }
      b.lastTouch = p; b.lastTeam = p.team; this.offside = null;
      if (p.team.human && !p.team.locked) Human.switchTo(p.team, p);
      if (this.pen && this.pen.kicked) this.pen.result = 'save';
    } else if (r < pSave) {
      const dir = p.team.dir;
      const sp = v * rand(0.25, 0.45);
      const a = Math.atan2(b.vy * 0.2 + gauss() * 3, dir * Math.abs(b.vx) * 0.3 + dir * 2);
      b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp + gauss() * 2; b.vz = rand(1, 4.5); b.kind = 'parry';
      b.lastTouch = p; b.lastTeam = p.team; b.kicker = p; b.kickCD = 0.4; b.passTo = null; p.noTouch = this.time + 0.4;
      p.stats.saves++; p.team.stats.saves++; if (b.shotBy) { b.shotBy.team.stats.onTarget++; b.shotBy.stats.onTarget++; }
      Sfx.thud(); Sfx.ooh(); this.comment(Commentary.save(p));
      if (this.pen && this.pen.kicked) this.pen.result = 'save';
    } else {
      b.vx *= 0.8; b.vy *= 0.8; p.noTouch = this.time + 0.5;
    }
  },
  headerTouch(p) {
    const b = this.ball, t = p.team, gx = t.oppGoalX;
    const nearGoal = Math.abs(b.x - gx) < 18 && Math.abs(b.y - CY) < 15;
    if (p.human && p === t.controlled && Input.dirLen() > 0.3 && !nearGoal) {
      const d = Input.dirWorld(); p.header(b.x + d.x * 15, b.y + d.y * 15, 0.5, 0.6);
    } else if (nearGoal) {
      const gk = t.opp.gk(), aimY = gk && gk.y > CY ? CY - 2.6 : CY + 2.6;
      p.header(gx, aimY + gauss() * 0.8, rand(0.2, 1.6), 0.85);
    } else if (t.rel(b.x) < 40) {
      p.header(t.abs(t.rel(b.x) + 20), b.y + (b.y < CY ? -8 : 8), 1.2, 0.75);
    } else {
      const mate = t.active().filter(q => q !== p && !q.isGK && t.rel(q.x) > t.rel(p.x) - 5).sort((a, c) => dist(a.x, a.y, p.x, p.y) - dist(c.x, c.y, p.x, p.y))[0];
      if (mate) p.header(mate.x, mate.y, 0.3, 0.5, mate); else p.header(t.abs(t.rel(b.x) + 15), b.y, 1, 0.6);
    }
  },
  // касание: проверка офсайда; true — игра остановлена
  onTouch(p, poke) {
    const off = this.offside;
    if (off) {
      if (off.team === p.team && off.players.has(p) && this.state === 'play') { this.callOffside(p); return true; }
      if (off.team !== p.team || off.kicker !== p) this.offside = null;
    }
    const b = this.ball;
    if (b.shotBy && b.shotBy.team !== p.team && !p.isGK && b.kind === 'shot') { /* блок */ }
    return false;
  },
  onKick(p, kind) {
    const b = this.ball, t = p.team;
    if (['pass', 'through', 'long', 'lob', 'cross', 'punt', 'throw', 'throwLong'].includes(kind)) { this.lastPass = { from: p, t: this.time, ok: null }; t.stats.passes++; }
    if (kind === 'shot' || kind === 'header') { b.passTo = null; b.target = null; }
    // офсайд фиксируется в момент паса (кроме аута, углового и удара от ворот)
    const exempt = this.spKind === 'throw' || this.spKind === 'corner' || this.spKind === 'goalkick';
    this.spKind = null;
    if (!exempt && this.mode !== 'shootout') {
      const line = Math.max(t.opp.secondLastRel(t), t.rel(b.x), 52.5);
      const set = new Set();
      for (const q of t.active()) if (q !== p && t.rel(q.x) > line + 0.3) set.add(q);
      this.offside = set.size ? { team: t, players: set, line: t.abs(line), kicker: p } : null;
    } else this.offside = null;
    if (t.human && !t.locked && b.passTo && b.passTo.team === t && kind !== 'shot') Human.switchTo(t, b.passTo);
    if (this.state === 'play' && this.firstKickT === undefined) this.firstKickT = this.clock;
  },
  callOffside(p) {
    const t = p.team; t.stats.offsides++;
    this.offLine = { x: this.offside.line, t: this.time, team: t };
    const ln = this.lines.find(l => (l.side === 1) === (p.x > CX)); if (ln) { ln.flag = 2.5; }
    Sfx.whistle('short'); UI.banner('Офсайд', p.name, 'Вне игры', 'warn'); this.comment(Commentary.offside(p));
    this.pendingSP = { type: 'freekick', team: t.opp, x: clamp(p.x, 2, 103), y: clamp(p.y, 2, 66), indirect: true };
    this.offside = null; this.freeze('offside');
  },
  freeze(st) {
    const b = this.ball; b.owner = null; b.holder = null; b.vx *= 0.2; b.vy *= 0.2;
    for (const p of this.allPlayers()) { p.goalT = null; p.making = false; }
    this.setState(st);
  },
  loseBall(o, tackler, won) {
    const b = this.ball; b.owner = null; o.stun = 0.5; o.hasBallT = 0;
    if (won && Math.random() < 0.55 && tackler.canAct()) { b.owner = tackler; tackler.hasBallT = 0; this.gainPossession(tackler, o.team); }
    else { const a = tackler.face + gauss() * 0.6, sp = rand(3, 6.5); b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp; b.kicker = tackler; b.kickCD = 0.15; b.lastTouch = tackler; b.lastTeam = tackler.team; this.offside = null; }
    if (Math.random() < 0.4) this.comment(Commentary.tackle(tackler));
  },
  foul(off, vic, sev) {
    if (this.state !== 'play') return;
    off.stats.fouls++; off.team.stats.fouls++;
    vic.anim = 'fall'; vic.animT = 0; vic.vx *= 0.3; vic.vy *= 0.3;
    const b = this.ball; if (b.owner) b.owner = null;
    Sfx.whistle('double'); if (off.team.human !== vic.team.human) Sfx.boo();
    const inBox = this.inBoxOf(off.team, vic.x, vic.y);
    let card = null;
    const r = Math.random();
    if (r < (sev > 0.4 ? 0.06 : 0.008)) card = 'red';
    else if (r < 0.1 + sev * 0.9) card = off.yellow ? 'red2' : 'yellow';
    this.comment(Commentary.foul(off, vic));
    if (card === 'yellow') { off.yellow = 1; off.team.stats.yellow++; this.events.push({ type: 'yellow', team: off.team.side, name: off.name, min: this.minute() }); UI.banner('Жёлтая карточка', off.name, off.team.data.name, 'warn'); this.ref.card = '#ffd83a'; this.ref.cardT = 2.5; UI.addEvent(off.team, off.name, '#ffd83a'); }
    else if (card) { off.team.stats.red++; if (card === 'red2') off.team.stats.yellow++; this.events.push({ type: 'red', team: off.team.side, name: off.name, min: this.minute() }); UI.banner('Красная карточка', off.name, card === 'red2' ? 'Вторая жёлтая' : 'Прямое удаление', 'red'); this.ref.card = '#ff4b5c'; this.ref.cardT = 2.5; UI.addEvent(off.team, off.name, '#ff4b5c'); this.sendOff(off); }
    else UI.banner(inBox ? 'Пенальти' : 'Фол', off.name, inBox ? 'Нарушение в штрафной' : 'Штрафной удар', inBox ? 'red' : '');
    this.pendingSP = inBox ? { type: 'penalty', team: vic.team } : { type: 'freekick', team: vic.team, x: clamp(vic.x, 1, 104), y: clamp(vic.y, 1, 67) };
    if (inBox) this.comment(Commentary.penalty());
    this.freeze('foul');
  },
  sendOff(p) {
    p.sentOff = true; p.offTarget = { x: p.x, y: -3.5 };
    if (p.team.controlled === p) { const n = p.team.active().filter(q => !q.isGK)[0]; if (p.team.locked === p) p.team.locked = null; if (n) Human.switchTo(p.team, n); }
    if (this.ball.owner === p) this.ball.owner = null;
  },
  // ---------- штанги, перекладина, сетка, аут ----------
  checkBounds() {
    const b = this.ball;
    if (b.holder || b.owner) { if (b.owner && (b.y < -0.3 || b.y > PITCH_W + 0.3 || b.x < -0.3 || b.x > PITCH_L + 0.3)) b.owner = null; else return; }
    for (const g of this.goals) {
      if (Math.abs(b.x - g.x) > 0.6) continue;
      for (const py of [CY - GOAL_W / 2, CY + GOAL_W / 2]) {
        const dx = b.x - g.x, dy = b.y - py, d = Math.hypot(dx, dy);
        if (d < BALL_R + 0.07 && b.z < GOAL_H + 0.05 && d > 1e-4) {
          const nx = dx / d, ny = dy / d, vn = b.vx * nx + b.vy * ny;
          if (vn < 0) { b.vx -= 1.65 * vn * nx; b.vy -= 1.65 * vn * ny; b.x = g.x + nx * (BALL_R + 0.08); b.y = py + ny * (BALL_R + 0.08); Sfx.post(); this.comment(Commentary.post()); Sfx.ooh(); Cam.shake = 0.25; if (b.shotBy) b.shotBy.stats.onTarget += 0; }
        }
      }
      if (Math.abs(b.y - CY) < GOAL_W / 2) {
        const dx = b.x - g.x, dz = b.z - GOAL_H, d = Math.hypot(dx, dz);
        if (d < BALL_R + 0.07 && d > 1e-4) { const nx = dx / d, nz = dz / d, vn = b.vx * nx + b.vz * nz; if (vn < 0) { b.vx -= 1.6 * vn * nx; b.vz -= 1.6 * vn * nz; b.x = g.x + nx * (BALL_R + 0.08); b.z = GOAL_H + nz * (BALL_R + 0.08); Sfx.post(); this.comment(Commentary.post()); Sfx.ooh(); Cam.shake = 0.25; } }
      }
    }
    if (this.state !== 'play' && !(this.pen && this.pen.kicked)) return;
    if (b.x < -BALL_R || b.x > PITCH_L + BALL_R) {
      const left = b.x < 0, gx = left ? 0 : PITCH_L;
      const inGoal = Math.abs(b.y - CY) < GOAL_W / 2 - BALL_R * 0.5 && b.z < GOAL_H - BALL_R * 0.5;
      const defending = this.teams.find(t => t.ownGoalX === gx), attacking = defending.opp;
      if (inGoal) { this.scoreGoal(attacking); return; }
      if (this.pen && this.pen.kicked) { this.pen.result = this.pen.result || 'miss'; return; }
      if (b.shotBy && b.shotBy.team === attacking) this.comment(Commentary.miss(b.shotBy));
      if (b.lastTeam === defending) this.setPieceCall('corner', attacking, left ? 0.4 : PITCH_L - 0.4, b.y < CY ? 0.4 : PITCH_W - 0.4);
      else this.setPieceCall('goalkick', defending, left ? SIX_L : PITCH_L - SIX_L, CY + (b.y < CY ? -4.5 : 4.5));
      return;
    }
    if (b.y < -BALL_R || b.y > PITCH_W + BALL_R) {
      const t = b.lastTeam ? b.lastTeam.opp : this.home;
      this.setPieceCall('throw', t, clamp(b.x, 1, PITCH_L - 1), b.y < 0 ? 0 : PITCH_W);
    }
  },
  netHold() { // мяч внутри ворот гасится сеткой
    const b = this.ball;
    for (const g of this.goals) {
      const inside = (g.out < 0 ? b.x < g.x : b.x > g.x) && Math.abs(b.y - CY) < GOAL_W / 2 + 0.2;
      if (!inside) continue;
      const back = g.x + g.out * (GOAL_D - 0.15);
      if ((g.out < 0 && b.x < back) || (g.out > 0 && b.x > back)) { if (!g.hit) { g.hit = { y: b.y, z: Math.max(0.3, b.z), a: 0.55 }; Sfx.net(); } b.x = back; b.vx *= -0.15; b.vy *= 0.4; }
      if (Math.abs(b.y - CY) > GOAL_W / 2 - 0.15) { b.y = CY + Math.sign(b.y - CY) * (GOAL_W / 2 - 0.15); b.vy *= -0.2; }
      if (b.z > 2.15) { b.z = 2.15; b.vz = -Math.abs(b.vz) * 0.2; }
    }
  },
  setPieceCall(type, team, x, y) {
    if (this.state !== 'play') return;
    const b = this.ball; b.owner = null;
    if (type === 'corner') { team.stats.corners++; this.comment(Commentary.corner(team)); UI.banner('Угловой', team.data.name, '', ''); }
    if (type === 'goalkick') this.comment(Commentary.goalkick());
    if (type === 'throw') this.comment(Commentary.throwIn(team));
    Sfx.whistle('short');
    this.pendingSP = { type, team, x, y };
    this.freeze(type === 'throw' ? 'offside' : 'foul');
    this.stateT = type === 'throw' ? 0.9 : 0.3;
  },
  // ---------- стандарты ----------
  beginSetPiece() {
    const sp = this.pendingSP; this.pendingSP = null;
    for (const p of this.allPlayers()) if (p.anim === 'fall') { p.anim = 'getup'; p.animT = 0; }
    if (!sp) { this.setState('play'); return; }
    if (sp.type === 'penalty') { this.startPenaltyKick(sp.team); return; }
    this.startSetPiece(sp.type, sp.team, sp.x, sp.y, sp);
  },
  chooseTaker(type, team, x, y) {
    const outf = team.active().filter(p => !p.isGK);
    const lg = team.locked && !team.locked.sentOff ? team.locked : null;
    if (type === 'goalkick') return team.gk() || outf[0];
    if (type === 'throw') return outf.slice().sort((a, c) => dist(a.x, a.y, x, y) - dist(c.x, c.y, x, y))[0];
    if (type === 'kickoff') return outf.find(p => p.role === 'ST') || outf.slice().sort((a, c) => dist(a.x, a.y, CX, CY) - dist(c.x, c.y, CX, CY))[0];
    if (type === 'corner') { if (lg && lg.a.pas >= 72) return lg; return outf.slice().sort((a, c) => c.a.pas - a.a.pas)[0]; }
    if (type === 'penalty') { if (lg && lg.a.sho >= 70) return lg; return outf.slice().sort((a, c) => c.a.sho - a.a.sho)[0]; }
    // штрафной
    if (Math.abs(x - team.ownGoalX) < 14 && team.gk()) return team.gk();
    const dG = dist(x, y, team.oppGoalX, CY);
    if (dG < 32) { if (lg && lg.a.sho >= 74) return lg; return outf.slice().sort((a, c) => (c.a.sho * 0.6 + c.a.pas * 0.4) - (a.a.sho * 0.6 + a.a.pas * 0.4))[0]; }
    return outf.slice().sort((a, c) => dist(a.x, a.y, x, y) - dist(c.x, c.y, x, y))[0];
  },
  startSetPiece(type, team, x, y, extra = {}) {
    const b = this.ball; b.place(x, y); this.offside = null;
    const sp = this.setPiece = { type, team, x, y, t: 0, ready: false, readyT: 0, indirect: !!extra.indirect, wall: [] };
    sp.taker = this.chooseTaker(type, team, x, y);
    const tk = sp.taker;
    if (dist(tk.x, tk.y, x, y) > 4) { const a = Math.atan2(clamp(tk.y, 2, 66) - y, tk.x - x); tk.x = x + Math.cos(a) * 3; tk.y = clamp(y + Math.sin(a) * 3, -1, PITCH_W + 1); }
    this.placeForSetPiece(sp);
    this.setState(type === 'kickoff' ? 'kickoff' : 'setpiece');
    if (team.human && !team.locked) Human.switchTo(team, tk);
    if (team.opp.human && !team.opp.locked) { const near = team.opp.active().filter(p => !p.isGK).sort((a, c) => dist(a.x, a.y, x, y) - dist(c.x, c.y, x, y))[0]; if (near) Human.switchTo(team.opp, near); }
    if (type === 'freekick') this.comment(Commentary.freekick(team));
    if (type === 'kickoff' || type === 'freekick' || type === 'corner') this.autoSubsCheck();
  },
  placeForSetPiece(sp) {
    const { type, team, x, y } = sp, opp = team.opp, b = this.ball, tk = sp.taker;
    const gx = team.oppGoalX, dir = team.dir;
    for (const p of this.allPlayers()) { p.goalT = null; p.arms = p.isGK ? 'gk' : 'swing'; }
    const set = (p, tx, ty, s = 0.8) => { p.goalT = { x: clamp(tx, -1, PITCH_L + 1), y: clamp(ty, -1, PITCH_W + 1), s }; };
    // по умолчанию — тактическая расстановка
    for (const p of team.active()) { const s = AI.shape(team, p, true); set(p, s.x, s.y, 0.6); }
    for (const p of opp.active()) { const s = AI.shape(opp, p, false); set(p, s.x, s.y, 0.6); }
    for (const t of this.teams) { const g = t.gk(); if (g) set(g, t.ownGoalX + t.dir * 2, CY, 0.6); }
    if (type === 'kickoff') {
      for (const t of this.teams) for (const p of t.active()) { const f = t.formationPos(p, true); p.x = f.x; p.y = f.y; p.vx = p.vy = 0; p.face = t.dir > 0 ? 0 : Math.PI; set(p, f.x, f.y, 0.5); }
      tk.x = CX - dir * 0.4; tk.y = CY + 0.4; set(tk, tk.x, tk.y);
      for (const p of opp.active()) if (dist(p.x, p.y, CX, CY) < 9.5) { p.x = CX - opp.dir * 10; set(p, p.x, p.y); }
    } else if (type === 'throw') {
      set(tk, x, y + (y < 1 ? -0.4 : 0.4), 0.9); tk.arms = 'throw';
      const mates = team.active().filter(p => p !== tk && !p.isGK).sort((a, c) => dist(a.x, a.y, x, y) - dist(c.x, c.y, x, y)).slice(0, 3);
      const iy = y < 1 ? 1 : -1;
      mates.forEach((p, i) => set(p, x + [-6, 7, 1][i] * dir, y + iy * [6, 7, 13][i], 0.85));
      mates.forEach(m => { const q = opp.active().filter(p => !p.isGK).sort((a, c) => dist(a.x, a.y, m.goalT.x, m.goalT.y) - dist(c.x, c.y, m.goalT.x, m.goalT.y))[0]; if (q) set(q, m.goalT.x - dir * 1.5, m.goalT.y + iy * 0.8, 0.85); });
      b.holder = null;
    } else if (type === 'corner') {
      const nearY = y < CY ? -1 : 1;
      const spots = [[6, CY + nearY * 3], [5.5, CY - nearY * 3.5], [11, CY + rand(-2, 2)], [7, CY], [16, CY - nearY * 5]];
      const runners = team.active().filter(p => p !== tk && !p.isGK).sort((a, c) => (c.a.phy + c.info.look.h / 3) - (a.a.phy + a.info.look.h / 3));
      runners.slice(0, 5).forEach((p, i) => set(p, gx - dir * spots[i][0], spots[i][1], 0.85));
      runners.slice(5, 7).forEach((p, i) => set(p, gx - dir * (24 + i * 4), CY + (i ? 10 : -10), 0.7));
      runners.slice(7).forEach(p => set(p, team.abs(55), p.y, 0.6));
      const defs = opp.active().filter(p => !p.isGK);
      const marks = runners.slice(0, 5);
      defs.forEach((d, i) => {
        if (i < marks.length) set(d, marks[i].goalT.x + dir * 0.9, marks[i].goalT.y + (CY - marks[i].goalT.y) * 0.1, 0.85);
        else if (i === marks.length) set(d, gx - dir * 0.6, CY + nearY * 3.2, 0.85);
        else if (i === marks.length + 1) set(d, gx - dir * 6, CY - nearY * 6, 0.85);
        else set(d, team.abs(40), CY + (i % 2 ? 8 : -8), 0.7);
      });
      const g = opp.gk(); if (g) set(g, gx - dir * 0.7, CY + nearY * 0.8, 0.6);
      set(tk, x - dir * 0.3, y + (y < CY ? -0.5 : 0.5), 0.9);
    } else if (type === 'goalkick') {
      const g = team.gk(); if (g) set(g, x - dir * 0.8, y, 0.7);
      for (const p of opp.active()) if (!p.isGK && Math.abs(p.goalT.x - team.ownGoalX) < BOX_L + 1) set(p, team.ownGoalX + dir * (BOX_L + 2), p.goalT.y, 0.7);
    } else if (type === 'freekick') {
      const dG = dist(x, y, gx, CY), direct = dG < 32 && !sp.indirect && Math.abs(y - CY) < 22 && Math.abs(x - gx) > 9;
      sp.direct = direct;
      const a = Math.atan2(CY - y, gx - x);
      set(tk, x - Math.cos(a) * 1.4, y - Math.sin(a) * 1.4, 0.9);
      if (direct || dG < 40) {
        const n = dG < 22 ? 4 : dG < 28 ? 3 : 2;
        const wallers = opp.active().filter(p => !p.isGK).sort((p1, p2) => dist(p1.x, p1.y, x, y) - dist(p2.x, p2.y, x, y)).slice(0, n);
        const wx = x + Math.cos(a) * 9.15, wy = y + Math.sin(a) * 9.15, px = -Math.sin(a), py = Math.cos(a);
        const gkSide = y < CY ? 1 : -1;
        wallers.forEach((p, i) => { const k = (i - (n - 1) / 2) * 0.62 - gkSide * 0.6; set(p, wx + px * k, wy + py * k, 0.9); });
        sp.wall = wallers;
        const g = opp.gk(); if (g) set(g, gx - dir * 0.6, CY + gkSide * 1.4, 0.6);
        const box = team.active().filter(p => p !== tk && !p.isGK).sort((p1, p2) => p2.a.phy - p1.a.phy).slice(0, 4);
        box.forEach((p, i) => set(p, gx - dir * (8 + i * 2.5), CY + (i - 1.5) * 4, 0.85));
        opp.active().filter(p => !p.isGK && !wallers.includes(p)).slice(0, 4).forEach((p, i) => { const m = box[i]; if (m) set(p, m.goalT.x + dir * 0.9, m.goalT.y, 0.85); });
      }
      for (const p of opp.active()) if (p.goalT && dist(p.goalT.x, p.goalT.y, x, y) < 9.15 && !sp.wall.includes(p)) { const aa = Math.atan2(p.goalT.y - y, p.goalT.x - x); set(p, x + Math.cos(aa) * 9.5, y + Math.sin(aa) * 9.5, 0.8); }
    }
  },
  updateSetPiece(dt) {
    const sp = this.setPiece, b = this.ball;
    if (!sp) { this.setState('play'); return; }
    sp.t += dt;
    for (const p of this.allPlayers()) {
      if (p.sentOff) { p.update(dt); continue; }
      if (p.goalT) p.steer(p.goalT.x, p.goalT.y, p.goalT.s, 0.2); else p.stop();
      p.watch = b;
      if (p.anim === 'fall' && p.animT > 0.6) { p.anim = 'getup'; p.animT = 0; }
      p.update(dt);
      if (sp.t > 3.2 && p.goalT && p !== sp.taker && dist(p.x, p.y, p.goalT.x, p.goalT.y) > 2 && !this.onScreen(p)) { p.x = p.goalT.x; p.y = p.goalT.y; }
    }
    const tk = sp.taker;
    if (sp.type === 'throw') { if (dist(tk.x, tk.y, tk.goalT.x, tk.goalT.y) < 0.8) { b.holder = tk; tk.arms = 'throw'; tk.anim = 'run'; } }
    const atBall = sp.type === 'throw' ? b.holder === tk : dist(tk.x, tk.y, b.x, b.y) < 1.6;
    if (!sp.ready && sp.t > 1.3 && atBall) {
      sp.ready = true; sp.readyT = 0;
      if (sp.type === 'kickoff') Sfx.whistle('short');
      if (tk.team.human && tk === tk.team.controlled) UI.setPieceHint(sp.type);
    }
    if (!sp.ready && sp.t > 5) { tk.x = sp.type === 'throw' ? tk.goalT.x : b.x - Math.cos(tk.face) * 0.8; tk.y = sp.type === 'throw' ? tk.goalT.y : b.y - Math.sin(tk.face) * 0.8; }
    if (!sp.ready) return;
    sp.readyT += dt;
    const aimX = sp.type === 'throw' ? tk.x : tk.team.oppGoalX, aimY = sp.type === 'throw' ? CY : CY;
    if (sp.type !== 'kickoff') tk.lookAt(sp.type === 'throw' ? tk.x : aimX, aimY);
    const humanTaker = tk.team.human && tk === tk.team.controlled && !this.isIdle(tk.team);
    if (humanTaker) { Human.setPiece(sp, dt); return; }
    if (sp.readyT > (sp.type === 'kickoff' ? 0.9 : 0.9 + Math.random() * 0.3)) this.aiExecute(sp);
  },
  onScreen(p) { return projP(p.x, p.y, 1) && PP.x > -40 && PP.x < W + 40 && PP.y > -40 && PP.y < H + 60; },
  aiExecute(sp) {
    const tk = sp.taker, t = sp.team, b = this.ball, mates = t.active().filter(p => p !== tk);
    this.spKind = sp.type;
    if (sp.type === 'kickoff') {
      const q = mates.filter(p => !p.isGK && t.rel(p.x) < t.rel(CX)).sort((a, c) => dist(a.x, a.y, CX, CY) - dist(c.x, c.y, CX, CY))[0] || mates[0];
      b.owner = tk; b.passTo = q; tk.passTo(q, 'pass'); this.comment(Commentary.kickoff());
    } else if (sp.type === 'throw') {
      const opts = mates.filter(p => !p.isGK && dist(p.x, p.y, tk.x, tk.y) < 22).map(p => ({ p, v: AI.nearestOpp(t, p.x, p.y) - AI.laneRisk(t, tk.x, tk.y, p.x, p.y, 'lob') * 6 + t.rel(p.x) * 0.03 })).sort((a, c) => c.v - a.v);
      const q = opts[0] ? opts[0].p : mates[0];
      b.passTo = q; tk.lookAt(q.x, q.y); tk.arms = 'swing'; tk.kick = 0;
      tk.lobTo(q.x + q.vx * 0.5, q.y + q.vy * 0.5, 'throwLong', tk.kickError('pass'));
    } else if (sp.type === 'corner') {
      b.owner = tk;
      if (Math.random() < 0.15) { const q = mates.filter(p => !p.isGK).sort((a, c) => dist(a.x, a.y, tk.x, tk.y) - dist(c.x, c.y, tk.x, tk.y))[0]; b.passTo = q; tk.passTo(q, 'pass'); }
      else {
        const runners = mates.filter(p => !p.isGK && Math.abs(p.x - t.oppGoalX) < 14 && Math.abs(p.y - CY) < 12).sort((a, c) => c.a.phy - a.a.phy);
        const q = runners[Math.floor(Math.random() * Math.min(3, runners.length))] || mates[0];
        b.passTo = q; tk.lookAt(q.x, q.y); tk.windup(() => tk.lobTo(q.x + rand(-1, 1), q.y + rand(-1, 1), 'cross', tk.kickError('cross')), 0.16);
      }
    } else if (sp.type === 'goalkick') {
      b.owner = tk; AI.gkDistribute(t, tk);
      if (b.owner === tk && !tk.pending) { const q = mates.filter(p => !p.isGK)[0]; tk.passTo(q, 'long'); }
    } else if (sp.type === 'freekick') {
      b.owner = tk;
      if (sp.direct && Math.random() < 0.75) {
        const g = t.opp.gk(), side = g && g.y > CY ? -1 : 1;
        tk.shoot(CY + side * (GOAL_W / 2 - 0.55), rand(1.4, 2.05), rand(0.62, 0.78), true);
      } else if (Math.abs(sp.x - t.oppGoalX) < 35 && t.style().cross > 0.2) {
        const q = mates.filter(p => !p.isGK && Math.abs(p.x - t.oppGoalX) < 16).sort((a, c) => c.a.phy - a.a.phy)[0];
        if (q) { b.passTo = q; tk.lookAt(q.x, q.y); tk.windup(() => tk.lobTo(q.x, q.y, 'cross', tk.kickError('cross')), 0.16); } else AI.carrier(t, tk, 0.016);
      } else {
        tk.decT = 0; tk.hasBallT = 1; AI.carrier(t, tk, 0.016);
        if (b.owner === tk && !tk.pending) { const q = mates.filter(p => !p.isGK).sort((a, c) => AI.nearestOpp(t, c.x, c.y) - AI.nearestOpp(t, a.x, a.y))[0]; tk.passTo(q, 'pass'); }
      }
    }
    this.resumePlay();
  },
  resumePlay() {
    const sp = this.setPiece; this.setPiece = null; UI.setPieceHint(null);
    for (const p of this.allPlayers()) { p.goalT = null; if (p.arms === 'throw') p.arms = 'swing'; }
    if (sp && sp.taker) { sp.taker.decT = 0; }
    this.setState('play');
  },
  startKickoff(team) {
    this.kickTeam = team; this.goalInfo = null; this.celebSide = null; this.pen = null;
    const b = this.ball; b.place(CX, CY); b.lastTeam = null; b.lastTouch = null;
    for (const p of this.allPlayers()) { p.anim = 'run'; p.kneel = false; p.z = 0; p.vz = 0; p.arms = p.isGK ? 'gk' : 'swing'; p.stun = 0; p.making = false; }
    UI.hideIntroCard();
    this.startSetPiece('kickoff', team, CX, CY);
  },
  // ---------- выход команд ----------
  startIntro() {
    this.setState('intro');
    const hp = this.home.players, ap = this.away.players;
    hp.forEach((p, i) => { p.x = CX - 1.2; p.y = 69 + i * 1.1; p.lineX = CX - 3 - i * 1.25; p.face = -Math.PI / 2; });
    ap.forEach((p, i) => { p.x = CX + 1.2; p.y = 69 + i * 1.1; p.lineX = CX + 3 + i * 1.25; p.face = -Math.PI / 2; });
    this.ref.x = CX; this.ref.y = 73;
    Cam.want(CX + 55, -75, 70, CX, 45, 0, 0.9, 1); Cam.snap();
    this.crowdExcite = 0.95; Sfx.roar(0.8, 6);
    UI.banner(this.home.data.stadium, `${this.home.data.name} — ${this.away.data.name}`, 'Добро пожаловать на стадион', 'intro');
  },
  updateIntro(dt) {
    const t = this.stateT, hp = this.home.players, ap = this.away.players, all = hp.concat(ap);
    for (const p of all) {
      const LY = 36;
      if (t < 14.5) { const d = dist(p.x, p.y, p.lineX, LY); p.steer(p.lineX, LY, d > 3 ? 0.62 : 0.3, 0.15); if (d < 0.4) { p.stop(); p.face = -Math.PI / 2; } }
      else { const f = p.team.formationPos(p, true); p.steer(f.x, f.y, 0.75, 0.3); }
      p.watch = null; p.update(dt);
      if (t < 14.5 && dist(p.x, p.y, p.lineX, LY) < 0.4) p.face = -Math.PI / 2;
    }
    this.ref.tx = CX; this.ref.ty = 37.5;
    if (t < 6.5) Cam.want(CX + 8, -26, 15, CX, 44, 1, 1, 0.6);
    else if (t < 10.5) { Cam.want(CX - 9, 19, 3.2, CX - 9, 36, 1.2, 1, 1.4); if (!this._ic1) { this._ic1 = 1; UI.introCard(this.home); } }
    else if (t < 14.5) { Cam.want(CX + 9, 19, 3.2, CX + 9, 36, 1.2, 1, 1.4); if (!this._ic2) { this._ic2 = 1; UI.introCard(this.away); } }
    else { UI.hideIntroCard(); Cam.want(CX, -40, 26, CX, 34, 0, 1, 1.2); if (!this._ic3) { this._ic3 = 1; UI.banner('Начало матча', `${this.home.data.short}  ·  ${this.away.data.short}`, `Судья готов дать свисток`, ''); } }
    if (t > 17.5 || Input.consumeSkip()) { this._ic1 = this._ic2 = this._ic3 = 0; UI.hideBanner(); for (const p of all) { const f = p.team.formationPos(p, true); p.x = f.x; p.y = f.y; } Cam.want(CX, -40, 24, CX, 34, 0, 1, 2); this.startKickoff(this.teams[this.firstKick]); }
  },
  // ---------- гол ----------
  scoreGoal(team) {
    if (this.state === 'goal' || this.state === 'celebrate') return;
    const b = this.ball;
    if (this.pen && this.mode === 'shootout') { if (!this.pen.result) this.pen.result = 'goal'; return; }
    if (this.pen) this.pen.result = 'goal';
    const scorer = b.lastTouch, og = !!scorer && scorer.team !== team;
    team.score++;
    let assist = null;
    if (!og && this.lastPass && this.lastPass.from.team === team && this.lastPass.from !== scorer && this.time - this.lastPass.t < 10) assist = this.lastPass.from;
    if (scorer && !og) { scorer.stats.goals++; scorer.stats.onTarget++; team.stats.onTarget++; }
    if (assist) assist.stats.assists++;
    const minute = this.minuteLabel();
    const ev = { type: 'goal', team: team.side, name: scorer ? scorer.name : '—', og, min: minute, clock: this.clock + (this.half === 2 ? 2700 : 0), assist: assist ? assist.name : null, legend: !!(scorer && scorer.isLegend && !og), assistLegend: !!(assist && assist.isLegend) };
    this.events.push(ev);
    this.goalInfo = { team, scorer, og, assist, minute };
    this.setState('goal'); this.recAfter = 0;
    this.celebSide = team.side === 0 ? 'h' : 'a'; this.crowdExcite = 1;
    Sfx.net(); Sfx.roar(1.3, 6); Cam.shake = 0.45; this.offside = null; this.lastGoalTime = this.time;
    UI.updateScore(true);
    if (this.mode === 'demo') return;
  },
  updateCelebrate(dt) {
    const gi = this.goalInfo, t = this.stateT, b = this.ball;
    if (!gi) { this.setState('play'); return; }
    const team = gi.team;
    if (this.state === 'goal') {
      for (const p of this.allPlayers()) { p.stop(); p.update(dt); }
      const g = this.goals.find(q => Math.abs(q.x - b.x) < 4);
      Cam.want(b.x - sgn(b.x - CX) * 5, b.y - 16, 6, b.x, b.y, 0.8, 1, 2.2);
      if (t > (this.mode === 'demo' ? 1 : 1.7)) {
        this.setState('celebrate');
        const cel = gi.og || !gi.scorer ? team.active().filter(p => !p.isGK).sort((a, c) => dist(a.x, a.y, b.x, b.y) - dist(c.x, c.y, b.x, b.y))[0] : gi.scorer;
        gi.cel = cel;
        const cy = cel.y < CY ? 1.5 : PITCH_W - 1.5, cx = clamp(cel.x + sgn(CX - cel.x) * 6, 3, PITCH_L - 3);
        gi.spot = { x: cx, y: Math.min(cy, 6) === cy ? cy : (cel.y < 40 ? 1.5 : cy) };
        if (this.mode !== 'demo') {
          UI.banner('ГОЛ!', gi.og ? `${gi.scorer ? gi.scorer.name : ''} (в свои ворота)` : `${cel.name}  ${gi.minute}`, gi.assist ? `Передача: ${gi.assist.name}` : team.data.name, 'goal');
          FX.burst([team.kit.s, team.kit.s2, '#ffffff', '#ffc23d']);
          this.comment(pick([`ГОООЛ! ${cel.name} забивает!`, `Мяч в сетке! ${cel.name}!`, `${cel.name} поражает ворота!`]));
        }
      }
      return;
    }
    const cel = gi.cel;
    const arrived = dist(cel.x, cel.y, gi.spot.x, gi.spot.y) < 1.5;
    if (!arrived && t < 3) { cel.steer(gi.spot.x, gi.spot.y, 0.95, 0.5); cel.arms = cel.info.celeb === 'plane' ? 'spread' : 'swing'; }
    else {
      cel.stop();
      const c = cel.info.celeb;
      if (c === 'slide') { cel.kneel = true; cel.arms = 'up'; }
      else if (c === 'jump') { cel.arms = 'fist'; if (cel.z <= 0 && Math.random() < 0.06) cel.vz = 3.5; }
      else if (c === 'arms') { cel.arms = 'cross'; cel.face = -Math.PI / 2; }
      else if (c === 'plane') { cel.arms = 'spread'; cel.steer(gi.spot.x + Math.cos(t * 2) * 3, gi.spot.y + Math.sin(t * 2) * 1.5 + (gi.spot.y < CY ? 2 : -2), 0.6); }
      else { cel.arms = 'fist'; }
    }
    cel.update(dt);
    let i = 0;
    for (const p of this.allPlayers()) {
      if (p === cel) continue;
      if (p.team === team && !p.isGK) {
        const a = (i++ / 9) * Math.PI * 2, tx = cel.x + Math.cos(a) * 1.2, ty = cel.y + Math.sin(a) * 0.9;
        p.steer(tx, ty, 0.9, 0.3); if (dist(p.x, p.y, cel.x, cel.y) < 3) p.arms = 'up';
      } else if (p.team !== team) { const f = p.team.formationPos(p, true); p.steer(f.x, f.y, 0.3, 0.5); p.arms = 'swing'; }
      else p.stop();
      p.update(dt);
    }
    Cam.want(cel.x, cel.y - 12, 4, cel.x, cel.y, 1.1, 1, 2);
    if (t > 5.5 || (t > 2 && Input.consumeSkip())) {
      for (const p of this.allPlayers()) { p.kneel = false; p.arms = p.isGK ? 'gk' : 'swing'; }
      if (Settings.replay && this.mode !== 'demo' && this.rec.length > 30) this.startReplay();
      else this.afterGoal();
    }
  },
  afterGoal() {
    UI.replayBadge(false); UI.hideBanner();
    const gi = this.goalInfo, conceded = gi ? gi.team.opp : this.home;
    this.startKickoff(conceded);
  },
  // ---------- повтор ----------
  record(dt) {
    this.recT += dt; if (this.recT < 1 / 30) return; this.recT = 0;
    const b = this.ball;
    this.rec.push({ b: [b.x, b.y, b.z, b.rot], p: this.allPlayers().map(p => [p.x, p.y, p.z, p.face, p.phase, p.run, p.anim, p.kick, p.arms, p.animT, p.diveDir || 0, p.kneel ? 1 : 0]), g: this.goals.map(g => g.hit ? { y: g.hit.y, z: g.hit.z, a: g.hit.a } : null) });
    if (this.state === 'goal') this.recAfter = (this.recAfter || 0) + 1;
    if (this.rec.length > 260) this.rec.shift();
  },
  startReplay() {
    const end = this.rec.length - 1 - Math.max(0, (this.recAfter || 0) - 28), start = Math.max(0, end - 165);
    this.replay = { frames: this.rec.slice(start, end + 1), f: 0 };
    this.setState('replay'); UI.replayBadge(true); UI.hideBanner();
  },
  updateReplay(dt) {
    const r = this.replay; r.f += dt * 30 * 0.6;
    const i = Math.floor(r.f), fr = r.frames;
    if (i >= fr.length - 1 || (this.stateT > 0.6 && Input.consumeSkip())) { this.replay = null; this.rec = []; this.afterGoal(); return; }
    const a = fr[i], c = fr[i + 1], k = r.f - i, ps = this.allPlayers(), b = this.ball;
    b.x = lerp(a.b[0], c.b[0], k); b.y = lerp(a.b[1], c.b[1], k); b.z = lerp(a.b[2], c.b[2], k); b.rot = lerp(a.b[3], c.b[3], k); b.owner = null; b.holder = null;
    ps.forEach((p, j) => { const s = a.p[j], e = c.p[j]; if (!s) return; p.x = lerp(s[0], e[0], k); p.y = lerp(s[1], e[1], k); p.z = lerp(s[2], e[2], k); p.face = s[3] + angDiff(s[3], e[3]) * k; p.phase = lerp(s[4], e[4], k); p.run = s[5]; p.anim = s[6]; p.kick = s[7]; p.arms = s[8]; p.animT = s[9]; p.diveDir = s[10]; p.kneel = !!s[11]; });
    this.goals.forEach((g, j) => { g.hit = a.g[j] ? { y: a.g[j].y, z: a.g[j].z, a: a.g[j].a } : null; });
    const side = b.y < CY ? -1 : 1;
    Cam.want(b.x - sgn(b.x - CX) * 4, b.y - 18 * side * 0 - 17, 6.5, b.x, b.y, 0.6, 1, 3.5);
    FX.trail = [];
  },
  // ---------- пенальти ----------
  startPenaltyKick(team, shooter) {
    const opp = team.opp, gx = team.oppGoalX, dir = team.dir, spotX = gx - dir * PEN_DIST, b = this.ball;
    b.place(spotX, CY); this.offside = null;
    shooter = shooter || this.chooseTaker('penalty', team);
    const gk = opp.gk();
    let i = 0;
    for (const p of this.allPlayers()) {
      p.goalT = null; p.anim = 'run'; p.stun = 0; p.vx = p.vy = 0; p.arms = p.isGK ? 'gk' : 'swing'; p.kneel = false;
      if (p === shooter || p === gk || p.sentOff) continue;
      if (this.mode === 'shootout') { const k = i++; p.x = CX + (k % 10 - 5) * 1.0; p.y = CY - 4 + Math.floor(k / 10) * 1.2; p.face = 0; if (p.isGK) { p.x = gx - dir * 20; p.y = CY + 12; } continue; }
      const k = i++; p.x = gx - dir * (BOX_L + 1.5 + (k % 3) * 1.4); p.y = CY - 16 + k * 1.6; p.lookAt(spotX, CY);
    }
    shooter.x = spotX - dir * 2.4; shooter.y = CY - 0.5; shooter.lookAt(gx, CY);
    if (gk) { gk.x = gx - dir * 0.25; gk.y = CY; gk.lookAt(spotX, CY); gk.anim = 'run'; }
    this.pen = { team, shooter, gk, spotX, gx, dir, aimY: CY, aimZ: 0.8, power: 0, charging: false, runup: false, kicked: false, result: null, t: 0, after: 0, guess: null, inMatch: this.mode !== 'shootout' };
    if (team.human && !team.locked) Human.switchTo(team, shooter);
    if (opp.human && gk && !opp.locked) Human.switchTo(opp, gk);
    this.setState(this.mode === 'shootout' ? 'shootout' : 'penalty');
    Cam.want(spotX - dir * 14, CY, 3.4, gx, CY, 1.1, 1.2, 3); Cam.snap();
    UI.setPieceHint('penalty', team.human && shooter === team.controlled, opp.human);
    if (this.pen.inMatch) UI.banner('Пенальти', shooter.name, `Вратарь: ${gk ? gk.name : '—'}`, 'warn');
  },
  updatePenalty(dt) {
    const pen = this.pen; if (!pen) { this.setState('play'); return; }
    pen.t += dt;
    const b = this.ball, sh = pen.shooter, gk = pen.gk;
    for (const p of this.allPlayers()) { if (p !== sh && p !== gk) { p.stop(); p.watch = b; p.update(dt); } }
    if (!pen.kicked) {
      Cam.want(pen.spotX - pen.dir * 14, CY, 3.4, pen.gx, CY, 1.1, 1.2, 3);
      const humanSh = sh.team.human && sh === sh.team.controlled && !this.isIdle(sh.team);
      const humanGK = gk && gk.team.human && gk === gk.team.controlled && !this.isIdle(gk.team);
      if (humanGK) Human.penaltyGK(pen);
      if (!pen.runup) {
        if (humanSh) Human.penaltyAim(pen, dt);
        else if (pen.t > 1.6) {
          const side = Math.random() < 0.5 ? -1 : 1, corner = Math.random() < 0.8;
          pen.aimY = CY + (corner ? side * rand(2.4, 3.2) : rand(-0.8, 0.8)); pen.aimZ = rand(0.25, 1.9); pen.power = rand(0.55, 0.85); pen.runup = true;
        }
        sh.stop(); sh.update(dt);
      } else {
        sh.steer(b.x - pen.dir * 0.35, b.y - 0.2, 0.7, 0.05); sh.update(dt);
        if (dist(sh.x, sh.y, b.x, b.y) < 0.75) {
          // удар
          const d = dist(b.x, b.y, pen.gx, pen.aimY), skill = sh.a.sho / 100;
          const sd = 0.012 + (1 - skill) * 0.05 + Math.pow(pen.power, 3) * 0.04;
          const vh = lerp(16, 28, pen.power), a = Math.atan2(pen.aimY - b.y, pen.gx - b.x) + gauss() * sd, tt = d / vh;
          let vz = (pen.aimZ - 0.1 + 0.5 * GRAV * tt * tt) / tt + gauss() * (0.3 + pen.power * pen.power) + Math.max(0, pen.power - 0.88) * 7;
          sh.kick = 0; b.owner = null; this.spKind = 'goalkick';
          b.kick(sh, Math.cos(a) * vh, Math.sin(a) * vh, Math.max(0, vz), 0, 'shot');
          sh.stats.shots++; sh.team.stats.shots++;
          pen.kicked = true; pen.after = 0;
          if (gk) {
            let g = pen.guess;
            if (!humanGK) { const r = Math.random(); g = r < 0.42 ? -1 : r < 0.84 ? 1 : 0; pen.gz = Math.random() < 0.6 ? 0.5 : 1.4; }
            pen.gkDive = { g: g || 0, z: pen.gz || 0.6, t: 0.06 + (1 - (gk.a.gk || 70) / 100) * 0.12 };
          }
        }
      }
      if (gk) { gk.stop(); gk.update(dt); }
      return;
    }
    // после удара
    pen.after += dt;
    if (gk && pen.gkDive && pen.after > pen.gkDive.t && gk.anim !== 'dive') {
      const g = pen.gkDive.g;
      if (g !== 0) gk.dive(gk.x, CY + g * 2.9, pen.gkDive.z); else gk.steer(gk.x, CY, 0.5);
      pen.gkDive.t = 99;
    }
    sh.stop(); sh.update(dt); if (gk && gk.anim !== 'dive') gk.update(dt); else if (gk) gk.update(dt);
    Cam.want(pen.spotX - pen.dir * 9, CY, 2.6, pen.gx, CY, 1.1, 1.3, 2);
    if (pen.inMatch) {
      if (pen.after > 0.55 && this.state === 'penalty') { UI.setPieceHint(null); this.pen = null; this.setState('play'); }
      return;
    }
    // серия пенальти
    if (!pen.result) {
      if (b.speed() < 0.8 && b.z < 0.1 && pen.after > 1) pen.result = 'save';
      if (b.holder) pen.result = 'save';
      if (pen.after > 3.2) pen.result = 'miss';
    }
    if (pen.result && !pen.reported) { pen.reported = true; this.shootoutResult(pen.result); }
    else if (pen.reported && pen.after > pen.resT + 2.2) this.nextShootoutKick();
  },
  startShootout() {
    for (const t of this.teams) { t.pens = 0; t.kicks = []; t.order = t.active().filter(p => !p.isGK).sort((a, c) => c.a.sho - a.a.sho); if (t.locked) { t.order = [t.locked].concat(t.order.filter(p => p !== t.locked)); } }
    this.shoot = { turn: this.firstKick, taken: [0, 0], done: false };
    UI.shootoutBar(true);
    this.nextShootoutKick(true);
  },
  shootoutResult(res) {
    const pen = this.pen, t = pen.team;
    pen.resT = pen.after;
    const ok = res === 'goal';
    if (ok) { t.pens++; Sfx.roar(1, 3); UI.banner('ГОЛ!', pen.shooter.name, `${this.home.data.short} ${this.home.pens} : ${this.away.pens} ${this.away.data.short}`, 'goal'); FX.burst([t.kit.s, t.kit.s2, '#fff']); }
    else { Sfx.ooh(); UI.banner(res === 'save' ? 'Сейв!' : 'Мимо!', res === 'save' ? (pen.gk ? pen.gk.name : '') : pen.shooter.name, `${this.home.data.short} ${this.home.pens} : ${this.away.pens} ${this.away.data.short}`, 'warn'); }
    t.kicks.push(ok);
    this.shoot.taken[t.side]++;
    UI.shootoutBar(true);
  },
  nextShootoutKick(first) {
    const s = this.shoot, h = this.home, a = this.away;
    if (!first) {
      const [nh, na] = s.taken, rem = Math.max(0, 5 - nh), remA = Math.max(0, 5 - na);
      let over = false;
      if (nh <= 5 && na <= 5) { if (h.pens + rem < a.pens || a.pens + remA < h.pens) over = true; }
      if (nh >= 5 && na >= 5 && nh === na && h.pens !== a.pens) over = true;
      if (over) { this.pen = null; UI.hideBanner(); this.finish(); return; }
      s.turn = 1 - s.turn;
    }
    UI.hideBanner();
    const t = this.teams[s.turn];
    t.dir = 1; t.opp.dir = -1;
    const sh = t.order[s.taken[t.side] % t.order.length];
    this.startPenaltyKick(t, sh);
  },
  // ---------- тайм / конец ----------
  endHalf() {
    if (this.mode === 'demo') { this.clock = 0; return; }
    if (this.half === 1) {
      Sfx.whistle('long'); this.setState('halftime');
      for (const p of this.allPlayers()) p.goalT = { x: p.x + (CX - p.x) * 0.3, y: p.y, s: 0.3 };
      setTimeout(() => { if (this.state === 'halftime') UI.showHalftime(); }, 1200);
    } else this.finish();
  },
  secondHalf() {
    this.half = 2; this.clock = 0; this.added = randi(2, 5);
    for (const t of this.teams) { t.dir *= -1; for (const p of t.players) p.stamina = Math.min(1, p.stamina + 0.3); }
    for (const t of this.teams) if (!t.human || Settings.auto) this.autoSubs(t, 2);
    this.rec = [];
    this.startKickoff(this.teams[1 - this.firstKick]);
  },
  autoSubsCheck() {
    if (this.half !== 2 || this.mode === 'demo' || this.mode === 'shootout') return;
    if (this.minute() >= 68 && !this._subs70) { this._subs70 = true; for (const t of this.teams) if (!t.human) this.autoSubs(t, 1); }
  },
  autoSubs(team, n) {
    for (let k = 0; k < n && team.subsLeft > 0 && team.bench.length; k++) {
      const cand = team.active().filter(p => !p.isGK && !p.isLegend).sort((a, c) => a.stamina - c.stamina)[0];
      if (!cand || cand.stamina > 0.75) return;
      let bi = -1, bs = -1e9;
      team.bench.forEach((inf, i) => { if (inf.pos === 'GK') return; const s = inf.ovr - posPenalty(inf.pos, cand.role); if (s > bs) { bs = s; bi = i; } });
      if (bi < 0) return;
      const inf = team.bench.splice(bi, 1)[0];
      const np = new Player(inf, team, cand.slot); np.x = cand.x; np.y = cand.y; np.role = cand.role; np.face = cand.face;
      team.players[team.players.indexOf(cand)] = np; team.subsLeft--; team.subsDone++;
      if (team.controlled === cand) team.controlled = np;
      this.comment(`Замена в ${team.data.short}: ${inf.name} вместо ${cand.name}`);
      UI.addEvent(team, `${inf.name} ↔ ${cand.name}`, '#43a8ff');
    }
  },
  finish() {
    Sfx.whistle('end'); this.setState('fulltime'); this.pen = null; UI.shootoutBar(false); UI.setPieceHint(null);
    for (const p of this.allPlayers()) p.goalT = null;
    const res = this.summary();
    setTimeout(() => { if (this.state === 'fulltime') UI.showResult(res); }, 1500);
  },
  summary() {
    const h = this.home, a = this.away, all = this.allPlayers();
    for (const p of all) {
      const s = p.stats; let r = 6.2 + s.goals * 1.1 + s.assists * 0.7 + s.saves * 0.35 + s.tackles * 0.18 + Math.min(1, s.passOk * 0.04) + s.onTarget * 0.15 - s.fouls * 0.15 - (p.yellow ? 0.3 : 0) - (p.sentOff ? 1.5 : 0);
      const won = p.team.score > p.team.opp.score; r += won ? 0.4 : p.team.score < p.team.opp.score ? -0.3 : 0;
      if (p.isGK) r -= p.team.opp.score * 0.3;
      s.rating = clamp(Math.round(r * 10) / 10, 3, 10);
    }
    const motm = all.slice().sort((p, q) => q.stats.rating - p.stats.rating)[0];
    const humanSide = this.home.human ? 0 : this.away.human ? 1 : -1;
    return { home: h, away: a, hs: h.score, as: a.score, hp: h.pens, ap: a.pens, events: this.events.slice(), motm, humanSide, mode: this.mode, shootout: this.mode === 'shootout' };
  },
  // ---------- судьи ----------
  officials(dt) {
    const r = this.ref, b = this.ball; if (!r) return;
    let tx = r.tx, ty = r.ty;
    if (this.state !== 'intro') { tx = clamp(b.x - 9 * sgn(b.x - CX) * 0.4 - 6, 4, 101); ty = clamp(b.y + (b.y < CY ? 13 : -13), 6, 62); if (dist(tx, ty, b.x, b.y) < 8) ty += 6; }
    const d = dist(r.x, r.y, tx, ty), sp = Math.min(6.5, d * 0.8);
    const vx = d > 0.3 ? (tx - r.x) / d * sp : 0, vy = d > 0.3 ? (ty - r.y) / d * sp : 0;
    r.vx = lerp(r.vx, vx, dt * 3); r.vy = lerp(r.vy, vy, dt * 3); r.x += r.vx * dt; r.y += r.vy * dt;
    r.phase += Math.hypot(r.vx, r.vy) * dt * 1.45;
    r.face = Math.hypot(r.vx, r.vy) > 0.5 ? Math.atan2(r.vy, r.vx) : Math.atan2(b.y - r.y, b.x - r.x);
    r.cardT = Math.max(0, r.cardT - dt);
    for (const ln of this.lines) {
      const rightHalf = ln.side === 1, defT = this.teams.find(t => t.ownGoalX === (rightHalf ? PITCH_L : 0));
      let x = rightHalf ? CX + 10 : CX - 10;
      if (defT) { const xs = defT.active().map(p => p.x).sort((p, q) => rightHalf ? q - p : p - q); x = xs.length > 1 ? xs[1] : x; }
      if (rightHalf) x = clamp(Math.max(x, b.x > CX ? Math.min(b.x, x) : x), CX, PITCH_L); else x = clamp(x, 0, CX);
      const vx2 = clamp((x - ln.x) * 2, -7, 7); ln.vx = lerp(ln.vx, vx2, dt * 4); ln.x += ln.vx * dt; ln.phase += Math.abs(ln.vx) * dt * 1.45;
      ln.flag = Math.max(0, ln.flag - dt);
    }
  },
  // ---------- камера ----------
  camera(dt) {
    const st = this.state, b = this.ball;
    if (['intro', 'celebrate', 'goal', 'penalty', 'shootout', 'replay'].includes(st)) return;
    if (st === 'halftime' || st === 'fulltime') { Cam.want(CX, -58, 36, CX, 38, 0, 0.9, 1.2); return; }
    let fx = b.x, fy = b.y;
    const sp = this.setPiece;
    if (sp && sp.type === 'corner') { fx = lerp(b.x, sp.team.oppGoalX - sp.team.dir * 10, 0.5); fy = lerp(b.y, CY, 0.5); }
    const lead = clamp(b.vx * 0.45, -9, 9) + (this.possTeam() ? this.possTeam().dir * 4 : 0);
    const cx = clamp(fx + lead, 13, 92), ty = clamp(fy * 0.6 + 13, 15, 46);
    const zoom = sp && sp.type === 'corner' ? 1.15 : 1;
    Cam.want(cx, -40, 26, cx, ty, 0, zoom, st === 'play' ? 2.2 : 1.6);
  }
};
// ============================ ВВОД: КЛАВИАТУРА, ГЕЙМПАД, СЕНСОР ============================
const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  KeyJ: 'pass', Space: 'pass', KeyK: 'shoot', KeyL: 'lob', KeyI: 'through', KeyE: 'skill', KeyQ: 'switch',
  ShiftLeft: 'sprint', ShiftRight: 'sprint', Escape: 'pause', KeyP: 'pause', Enter: 'skip'
};
const GP_MAP = { 0: 'pass', 1: 'lob', 2: 'shoot', 3: 'through', 4: 'switch', 5: 'skill', 7: 'sprint', 9: 'pause' };
const Input = {
  keys: {}, hits: {}, rels: {}, lastActive: 0, gpUsed: false, disconnected: false, gpPrev: {}, gpAxes: [0, 0], touch: { x: 0, y: 0, on: false, btn: {} },
  init() {
    window.addEventListener('keydown', e => {
      const a = KEYMAP[e.code]; this.lastActive = performance.now() / 1000;
      if (!a) return;
      if (Match.active && !UI.menuOpen() && !['skip', 'pause'].includes(a)) e.preventDefault();
      if (a === 'pass' && UI.menuOpen()) return;
      if (!this.keys[a]) this.hits[a] = true;
      this.keys[a] = true;
    });
    window.addEventListener('keyup', e => { const a = KEYMAP[e.code]; if (!a) return; this.keys[a] = false; this.rels[a] = true; });
    window.addEventListener('blur', () => { this.keys = {}; });
    window.addEventListener('gamepadconnected', () => { this.disconnected = false; UI.toast('Геймпад подключён'); });
    window.addEventListener('gamepaddisconnected', () => { if (this.gpUsed && Match.active && Match.mode !== 'demo') { this.disconnected = true; UI.pause(true, 'Геймпад отключён. Подключите его снова или продолжите на клавиатуре.'); } });
    this.initTouch();
  },
  initTouch() {
    const stick = $('stick'), knob = $('stick-knob');
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    this.touchEnabled = coarse;
    let id = null;
    const move = e => {
      const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2); const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
      this.touch.x = dx; this.touch.y = -dy; knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`; this.lastActive = performance.now() / 1000;
    };
    stick.addEventListener('pointerdown', e => { id = e.pointerId; stick.setPointerCapture(id); this.touch.on = true; move(e); });
    stick.addEventListener('pointermove', e => { if (e.pointerId === id) move(e); });
    const end = e => { if (e.pointerId !== id) return; id = null; this.touch.on = false; this.touch.x = this.touch.y = 0; knob.style.transform = ''; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    document.querySelectorAll('#touch .tb').forEach(b => {
      const k = b.dataset.k;
      b.addEventListener('pointerdown', e => { e.preventDefault(); if (!this.keys[k]) this.hits[k] = true; this.keys[k] = true; b.classList.add('on'); this.lastActive = performance.now() / 1000; });
      const up = () => { if (this.keys[k]) this.rels[k] = true; this.keys[k] = false; b.classList.remove('on'); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    });
  },
  poll() {
    let pads = [];
    try { pads = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { pads = []; }
    const gp = pads && Array.from(pads).find(p => p && p.connected);
    if (!gp) { this.gpAxes = [0, 0]; return; }
    const ax = Math.abs(gp.axes[0]) > 0.2 ? gp.axes[0] : 0, ay = Math.abs(gp.axes[1]) > 0.2 ? gp.axes[1] : 0;
    this.gpAxes = [ax, -ay];
    let any = ax || ay;
    for (const [i, a] of Object.entries(GP_MAP)) {
      const btn = gp.buttons[i]; const on = !!(btn && (btn.pressed || btn.value > 0.5));
      if (on && !this.gpPrev[i]) { this.hits[a] = true; if (a === 'pass') this.hits.skip = true; if (a === 'pause') this.hits.padPause = true; }
      if (!on && this.gpPrev[i]) this.rels[a] = true;
      this.gpPrev[i] = on; this['gp_' + a] = on; any = any || on;
    }
    const dp = [12, 13, 14, 15].map(i => gp.buttons[i] && gp.buttons[i].pressed);
    if (dp.some(Boolean)) { this.gpAxes = [(dp[3] ? 1 : 0) - (dp[2] ? 1 : 0), (dp[0] ? 1 : 0) - (dp[1] ? 1 : 0)]; any = true; }
    if (any) { this.lastActive = performance.now() / 1000; this.gpUsed = true; this.disconnected = false; }
  },
  down(a) { return !!(this.keys[a] || this['gp_' + a]); },
  hit(a) { return !!this.hits[a]; },
  released(a) { return !!this.rels[a]; },
  dir() {
    let x = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0), y = (this.keys.up ? 1 : 0) - (this.keys.down ? 1 : 0);
    if (this.gpAxes[0] || this.gpAxes[1]) { x = this.gpAxes[0]; y = this.gpAxes[1]; }
    if (this.touch.on) { x = this.touch.x; y = this.touch.y; }
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    return { x, y };
  },
  dirLen() { const d = this.dir(); return Math.hypot(d.x, d.y); },
  dirWorld() {
    const d = this.dir(); const fl = Math.hypot(Cam.fx, Cam.fy) || 1;
    let wx = d.x * Cam.rx + d.y * Cam.fx / fl, wy = d.x * Cam.ry + d.y * Cam.fy / fl;
    const l = Math.hypot(wx, wy); if (l > 1e-3) { const k = Math.min(1, Math.hypot(d.x, d.y)) / l; wx *= k; wy *= k; }
    return { x: wx, y: wy };
  },
  idle() { return performance.now() / 1000 - this.lastActive; },
  consumeSkip() { const s = this.hits.skip || this.hits.pass || this.hits.pause; if (s) { this.hits.skip = this.hits.pass = this.hits.pause = false; } return s; },
  endFrame() { this.hits = {}; this.rels = {}; }
};

// ============================ УПРАВЛЕНИЕ ИГРОКОМ ============================
const Human = {
  charge: 0, charging: false, firstTime: null, firstT: 0, switchT: 0, chargeFor: null,
  switchTo(team, p) {
    if (!p || p.sentOff) return;
    if (team.locked && p !== team.locked) return;
    for (const q of team.players) q.human = false;
    team.controlled = p; p.human = true; this.switchT = Match.time;
    if (team === UI.humanTeam()) UI.playerTag(p);
  },
  update(dt) { for (const t of Match.teams) if (t.human) this.control(t, dt); },
  receiverInDir(team, p, d, cone = 0.55, maxD = 50) {
    const fa = Math.hypot(d.x, d.y) > 0.2 ? Math.atan2(d.y, d.x) : p.face;
    let best = null, bv = -1e9;
    for (const q of team.active()) {
      if (q === p) continue;
      const dd = dist(p.x, p.y, q.x, q.y); if (dd < 2 || dd > maxD) continue;
      const da = Math.abs(angDiff(fa, Math.atan2(q.y - p.y, q.x - p.x)));
      if (da > cone + 0.5) continue;
      const v = -da * 2.2 - dd / 40 + (q.isGK ? -0.8 : 0);
      if (v > bv) { bv = v; best = q; }
    }
    return best;
  },
  control(team, dt) {
    let p = team.controlled;
    if (!p || p.sentOff) { p = team.locked && !team.locked.sentOff ? team.locked : team.active().filter(q => !q.isGK).sort((a, c) => dist(a.x, a.y, Match.ball.x, Match.ball.y) - dist(c.x, c.y, Match.ball.x, Match.ball.y))[0]; this.switchTo(team, p); }
    if (!p) return;
    const idle = Match.isIdle(team);
    UI.aiBadge(idle);
    if (idle) { this.charge = 0; this.charging = false; return; }
    const b = Match.ball, d = Input.dirWorld(), len = Math.hypot(d.x, d.y), sprint = Input.down('sprint');
    p.watch = b;
    if (p.canAct()) {
      if (b.holder === p) { p.dvx = p.dvy = 0; }
      else if (len > 0.12) { const sp = p.maxSpeed() * (sprint ? 1 : 0.68) * Math.min(1, len * 1.15); p.dvx = d.x / len * sp; p.dvy = d.y / len * sp; p.sprint = sprint; }
      else { p.dvx = 0; p.dvy = 0; p.sprint = false; }
    }
    if (b.owner === p || b.holder === p) this.withBall(team, p, d, len, dt);
    else this.withoutBall(team, p, d, len, dt);
    if (!team.locked) {
      if (Input.hit('switch')) this.manualSwitch(team);
      else if (Settings.auto) this.autoSwitch(team, p);
    }
  },
  withBall(team, p, d, len, dt) {
    const b = Match.ball, gx = team.oppGoalX;
    if (this.firstTime && Match.time - this.firstT < 0.6) {
      const ft = this.firstTime; this.firstTime = null;
      if (ft === 'shot') { this.doShot(team, p, d, 0.72); return; }
    }
    if (Input.down('shoot') && p.canAct() && !p.pending) {
      this.charging = true; this.chargeFor = p; this.charge = Math.min(1, this.charge + dt / 0.95);
    }
    if (this.charging && (Input.released('shoot') || !Input.down('shoot') || this.charge >= 1)) {
      const pw = this.charge; this.charging = false; this.charge = 0;
      if (b.holder === p) { const q = this.receiverInDir(team, p, d, 0.8, 70) || team.active().find(o => !o.isGK); if (q) p.passTo(q, 'punt'); return; }
      this.doShot(team, p, d, pw);
      return;
    }
    if (this.charging) return;
    if (Input.hit('pass')) {
      const q = this.receiverInDir(team, p, d, 0.55, 45);
      if (q) p.passTo(q, b.holder === p ? 'pass' : 'pass');
      else if (b.owner === p) { const a = len > 0.2 ? Math.atan2(d.y, d.x) : p.face; p.lookAt(p.x + Math.cos(a), p.y + Math.sin(a)); p.windup(() => { if (b.owner === p) p.groundTo(p.x + Math.cos(a) * 14, p.y + Math.sin(a) * 14, 'pass', p.kickError('pass')); }); }
      return;
    }
    if (Input.hit('through')) {
      const q = this.receiverInDir(team, p, d, 0.7, 50);
      if (q) { const run = Math.hypot(q.vx, q.vy) > 2 ? Math.atan2(q.vy, q.vx) : Math.atan2(CY - q.y, gx - q.x) * 0.4 + (team.dir > 0 ? 0 : Math.PI) * 0.6; const lead = 6 + dist(p.x, p.y, q.x, q.y) * 0.12; p.passTo(q, 'through', { x: clamp(q.x + Math.cos(run) * lead, 1, 104), y: clamp(q.y + Math.sin(run) * lead, 1, 67) }); }
      return;
    }
    if (Input.hit('lob')) {
      const q = this.receiverInDir(team, p, d, 0.6, 70);
      const wide = team.rel(p.x) > 70 && Math.abs(p.y - CY) > 12;
      if (q) p.passTo(q, wide ? 'cross' : b.holder === p ? 'punt' : 'lob');
      else if (wide) { const tx = team.abs(PITCH_L - 9), ty = CY; p.lookAt(tx, ty); p.windup(() => { if (b.owner === p) p.lobTo(tx, ty, 'cross', p.kickError('cross')); }, 0.16); }
      return;
    }
    if (Input.hit('skill') && b.owner === p && p.cd <= 0 && p.canAct()) {
      const a = len > 0.2 ? Math.atan2(d.y, d.x) : p.face + (Math.random() < 0.5 ? 0.8 : -0.8);
      p.face = a; p.vx = Math.cos(a) * p.maxSpeed(); p.vy = Math.sin(a) * p.maxSpeed(); p.cd = 0.9;
      for (const q of team.opp.active()) if (dist(q.x, q.y, p.x, p.y) < 2.8 && Math.random() < 0.25 + p.a.dri / 160 - q.a.def / 320) q.stun = 0.6;
      Match.comment(Commentary.skill(p));
    }
  },
  doShot(team, p, d, pw) {
    const gx = team.oppGoalX, toG = Math.atan2(CY - p.y, gx - p.x);
    let aimY;
    const len = Math.hypot(d.x, d.y);
    if (len > 0.3) {
      const perp = -Math.sin(toG) * d.x + Math.cos(toG) * d.y;
      aimY = CY + clamp(perp * 3.3 * team.dir, -3.2, 3.2);
    } else aimY = p.y < CY ? CY + 2.5 : CY - 2.5;
    const aimZ = 0.35 + pw * 1.25 + (Input.down('skill') ? 0.3 : 0);
    p.shoot(aimY, aimZ, pw, Input.down('skill'));
  },
  withoutBall(team, p, d, len, dt) {
    const b = Match.ball, o = b.owner || b.holder;
    this.charging = false; this.charge = 0;
    if (o && o.team !== team) {
      if (Input.down('pass') && p.canAct()) {
        const gx = team.ownGoalX, ux = gx - o.x, uy = CY - o.y, ul = Math.hypot(ux, uy) || 1;
        if (len < 0.2) p.steer(o.x + ux / ul * 1.0, o.y + uy / ul * 1.0, Input.down('sprint') ? 0.95 : 0.7, 0.1);
        if (dist(p.x, p.y, o.x, o.y) < 1.35 && Input.hit('pass')) p.standTackle();
        else if (dist(p.x, p.y, o.x, o.y) < 1.2 && Math.random() < dt * 1.2) p.standTackle();
      }
      if (Input.hit('shoot') && p.canAct()) { if (len > 0.2) p.face = Math.atan2(d.y, d.x); p.slideTackle(); }
      team._forcePress = Input.down('lob');
      return;
    }
    team._forcePress = false;
    // свободный мяч: удар/пас с лёта
    if (!o) {
      const db = dist(p.x, p.y, b.x, b.y);
      if (Input.hit('shoot') && db < 4) { this.firstTime = 'shot'; this.firstT = Match.time; }
      if (Input.hit('shoot') && db < 1.3 && b.z > 0.3 && b.z < 1.4 && p.canAct()) {
        // удар с лёта
        const gk = team.opp.gk(), aimY = gk && gk.y > CY ? CY - 2.4 : CY + 2.4;
        b.owner = p; p.shoot(aimY, 1, 0.8);
      }
    }
    if (Input.hit('pass') && o && o.team === team) { Match.legendCall = { p, t: Match.time }; UI.toastPass(); }
  },
  manualSwitch(team) {
    const b = Match.ball, cur = team.controlled;
    let best = null, bv = 1e9;
    for (const q of team.active()) {
      if (q === cur || q.isGK) continue;
      const ic = AI.intercept(q, Match.ballPath);
      const goalSide = team.rel(q.x) < team.rel(b.x) ? -0.4 : 0.3;
      const v = ic.t + goalSide;
      if (v < bv) { bv = v; best = q; }
    }
    if (best) this.switchTo(team, best);
  },
  autoSwitch(team, p) {
    if (Match.time - this.switchT < 1.1) return;
    const b = Match.ball, o = b.owner;
    if (o && o.team === team) return;
    const dCur = dist(p.x, p.y, b.x, b.y);
    if (!o && team._chaser && team._chaser !== p && !team._chaser.isGK) {
      if (team._chaserT < 1.2 && dCur > 6) this.switchTo(team, team._chaser);
      return;
    }
    if (o && o.team !== team) {
      const pr = team._presser;
      if (pr && pr !== p && (dCur > 22 || (dCur > 12 && Input.dirLen() < 0.1))) this.switchTo(team, pr);
    }
  },
  // ---------- стандарты под управлением человека ----------
  setPiece(sp, dt) {
    const tk = sp.taker, t = sp.team, b = Match.ball, d = Input.dirWorld(), len = Math.hypot(d.x, d.y);
    if (len > 0.2) tk.face = Math.atan2(d.y, d.x);
    const mates = t.active().filter(q => q !== tk);
    const exec = () => { Match.spKind = sp.type; };
    if (sp.type === 'freekick' && (Input.down('shoot') || this.charging)) {
      if (Input.down('shoot')) { this.charging = true; this.charge = Math.min(1, this.charge + dt / 1.1); return; }
      const pw = this.charge; this.charging = false; this.charge = 0;
      exec(); b.owner = tk;
      const toG = Math.atan2(CY - tk.y, t.oppGoalX - tk.x), perp = -Math.sin(toG) * d.x + Math.cos(toG) * d.y;
      const aimY = CY + clamp((len > 0.3 ? perp * 3.3 * t.dir : (tk.y < CY ? 2.6 : -2.6)), -3.3, 3.3);
      tk.shoot(aimY, 1.25 + pw * 0.9, clamp(pw, 0.35, 1), true);
      Match.resumePlay(); return;
    }
    if (Input.hit('pass') || Input.hit('lob') || Input.hit('through')) {
      const kind = Input.hit('lob') ? 'lob' : Input.hit('through') ? 'through' : 'pass';
      exec();
      if (sp.type === 'throw') {
        const q = this.receiverInDir(t, tk, d, 0.9, kind === 'lob' ? 32 : 20) || mates.filter(m => !m.isGK).sort((a, c) => dist(a.x, a.y, tk.x, tk.y) - dist(c.x, c.y, tk.x, tk.y))[0];
        b.passTo = q; tk.lookAt(q.x, q.y); tk.arms = 'swing'; tk.kick = 0; tk.lobTo(q.x, q.y, 'throwLong', tk.kickError('pass'));
      } else if (sp.type === 'corner' && kind !== 'pass') {
        const gx = t.oppGoalX, dirx = t.dir;
        let tx = gx - dirx * 10, ty = CY;
        if (len > 0.3) { tx = gx - dirx * clamp(8 + d.x * dirx * -5, 4, 16); ty = CY + clamp(d.y * 6, -6, 6); }
        const q = mates.filter(m => !m.isGK).sort((a, c) => dist(a.x, a.y, tx, ty) - dist(c.x, c.y, tx, ty))[0];
        b.passTo = q; tk.lookAt(tx, ty); b.owner = tk; tk.windup(() => tk.lobTo(tx, ty, 'cross', tk.kickError('cross')), 0.16);
      } else {
        b.owner = tk;
        const q = this.receiverInDir(t, tk, d, 0.7, kind === 'lob' ? 70 : 45) || mates.filter(m => !m.isGK && t.rel(m.x) >= t.rel(tk.x) - 20).sort((a, c) => dist(a.x, a.y, tk.x, tk.y) - dist(c.x, c.y, tk.x, tk.y))[0] || mates[0];
        if (kind === 'through') p_through(tk, q, t);
        else tk.passTo(q, kind === 'lob' ? (sp.type === 'goalkick' ? 'long' : 'lob') : 'pass');
      }
      if (sp.type === 'kickoff') Match.comment(Commentary.kickoff());
      Match.resumePlay();
    }
    function p_through(tk, q, t) { const lead = 8; tk.passTo(q, 'through', { x: clamp(q.x + t.dir * lead, 1, 104), y: q.y }); }
  },
  penaltyAim(pen, dt) {
    const dd = Input.dir();
    pen.aimY = clamp(pen.aimY + dd.x * Math.sign(Cam.ry || -1) * dt * 5, CY - 4.4, CY + 4.4);
    pen.aimZ = clamp(pen.aimZ + dd.y * dt * 3, 0.15, 2.8);
    if (Input.down('shoot')) { this.charging = true; pen.power = Math.min(1, pen.power + dt / 1.05); }
    else if (this.charging) { this.charging = false; pen.runup = true; }
  },
  penaltyGK(pen) {
    const dd = Input.dir();
    if (Math.abs(dd.x) > 0.4) { pen.guess = Math.sign(dd.x * (Cam.ry || -1)); pen.gz = dd.y > 0.4 ? 1.5 : 0.5; }
    else if (dd.y > 0.5) { pen.guess = 0; }
  }
};
// ============================ РЕНДЕР КАДРА ============================
const REF_LOOK = { skin: 2, hair: 'sh', hc: 'd', beard: 0, h: 180, boots: '#111111' };
const Render = {
  frame(t) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    Stadium.drawBackground(t);
    Stadium.drawCrowd(t, Match.crowdExcite, Match.celebSide);
    Stadium.drawBoards(t, false);
    Stadium.drawPitch();
    if (!Match.home) return;
    this.offsideLine();
    this.shadows();
    Stadium.drawNets(Match.goals);
    const items = [], b = Match.ball;
    for (const p of Match.allPlayers()) { if (p.sentOff && p.y < -3.2) continue; items.push({ d: camDepth(p.x, p.y, 0.9), f: () => this.player(p) }); }
    const r = Match.ref;
    if (r) items.push({ d: camDepth(r.x, r.y, 0.9), f: () => this.official(r, false) });
    for (const ln of Match.lines) items.push({ d: camDepth(ln.x, ln.y, 0.9), f: () => this.official(ln, true) });
    items.push({ d: camDepth(b.x, b.y, b.z) - 0.2, f: () => drawBallAt(b) });
    for (const g of Match.goals) {
      items.push({ d: camDepth(g.x, CY - GOAL_W / 2, 1.2), f: () => Stadium.drawPost(g, 'near') });
      items.push({ d: camDepth(g.x, CY + GOAL_W / 2, 1.2), f: () => Stadium.drawPost(g, 'far') });
    }
    for (const [fx, fy] of [[0, 0], [PITCH_L, 0], [0, PITCH_W], [PITCH_L, PITCH_W]]) items.push({ d: camDepth(fx, fy, 0.8), f: () => Stadium.drawFlag(fx, fy, t) });
    items.sort((a, c) => c.d - a.d);
    for (const it of items) it.f();
    FX.drawWorld();
    Stadium.drawBoards(t, true);
    if (Match.mode !== 'demo') this.overlays();
    if (Settings.radar && Match.active && Match.mode !== 'demo' && ['play', 'setpiece', 'kickoff'].includes(Match.state)) this.radar();
    FX.drawScreen();
  },
  shadows() {
    const ents = Match.allPlayers().filter(p => !(p.sentOff && p.y < -3.2));
    if (Match.ref) ents.push(Match.ref);
    for (const p of ents) {
      if (!projP(p.x, p.y, 0)) continue;
      if (PP.x < -60 || PP.x > W + 60 || PP.y < -40 || PP.y > H + 60) continue;
      const s = PP.s, x = PP.x, y = PP.y, lying = ['slide', 'fall', 'dive'].includes(p.anim);
      ellipse(ctx, x, y, s * (lying ? 0.8 : 0.32), s * 0.12, 'rgba(0,0,0,0.33)');
      ctx.globalAlpha = 0.11;
      for (const dx of [-1, 1]) { if (projP(p.x + dx * 0.55, p.y + 0.45, 0)) ellipse(ctx, PP.x, PP.y, s * 0.55, s * 0.14, '#000'); }
      ctx.globalAlpha = 1;
    }
  },
  viewOf(face) {
    const fl = Math.hypot(Cam.fx, Cam.fy) || 1, cx = Math.cos(face), cy = Math.sin(face);
    const along = (cx * Cam.fx + cy * Cam.fy) / fl, side = cx * Cam.rx + cy * Cam.ry;
    return { view: Math.abs(along) > 0.72 ? (along > 0 ? 'back' : 'front') : 'side', flip: side >= 0 ? 1 : -1 };
  },
  player(p) {
    if (!projP(p.x, p.y, p.z)) return;
    const fx = PP.x, fy = PP.y, s = PP.s;
    if (fx < -90 || fx > W + 90 || fy < -60 || fy > H + 260) return;
    projP(p.x, p.y, p.z + 1); const hp = Math.max(1, fy - PP.y);
    const v = this.viewOf(p.face);
    let arms = p.arms;
    if (p.isGK && arms === 'gk' && p.run > 0.55) arms = 'swing';
    const o = { s, hp, view: v.view, flip: v.flip, phase: p.phase, run: p.run, arms, kick: p.kick, look: p.info.look, kit: p.team.kit, num: p.info.num, name: p.info.name, gk: p.isGK ? p.team.data.gk : null, kneel: p.kneel, lean: p.sprint ? p.run * 0.6 : p.run * 0.2 };
    ctx.save(); ctx.translate(fx, fy);
    const A = p.anim;
    if (A === 'slide') { o.view = 'side'; ctx.rotate(-v.flip * 1.2); o.hp = s * 0.95; o.run = 0; o.kick = 0.85; }
    else if (A === 'fall') { o.view = 'side'; ctx.translate(0, -s * 0.08); ctx.rotate(v.flip * 1.45); o.hp = s * 0.95; o.run = 0; o.arms = 'spread'; }
    else if (A === 'getup') { const k = 1 - clamp(p.animT / 0.45, 0, 1); ctx.rotate(v.flip * 1.4 * k); o.hp = lerp(hp, s * 0.95, k); o.run = 0; }
    else if (A === 'dive') {
      const ds = Math.cos(p.diveDir || 0) * Cam.rx + Math.sin(p.diveDir || 0) * Cam.ry, sd = ds >= 0 ? 1 : -1, amt = Math.abs(ds) > 0.35 ? 1.35 : 0.85;
      const k = Math.min(1, p.animT / 0.12); ctx.rotate(sd * amt * k); o.view = 'front'; o.arms = 'dive'; o.hp = lerp(hp, s * 0.95, k); o.run = 0;
    } else if (A === 'header') { o.arms = 'spread'; }
    if (p.stun > 0.3 && A === 'run') o.lean = -0.4;
    drawFigure(ctx, o);
    ctx.restore();
  },
  official(r, linesman) {
    if (!projP(r.x, r.y, 0)) return;
    const fx = PP.x, fy = PP.y, s = PP.s; if (fx < -60 || fx > W + 60 || fy > H + 200) return;
    projP(r.x, r.y, 1); const hp = Math.max(1, fy - PP.y);
    const face = linesman ? (Math.abs(r.vx) > 0.3 ? (r.vx > 0 ? 0 : Math.PI) : (r.side ? -Math.PI / 2 : Math.PI / 2)) : r.face;
    const v = this.viewOf(face), sp = linesman ? Math.abs(r.vx) : Math.hypot(r.vx, r.vy);
    const arms = linesman && r.flag > 0 ? 'fist' : r.cardT > 0 ? 'fist' : 'swing';
    ctx.save(); ctx.translate(fx, fy);
    drawFigure(ctx, { s, hp, view: v.view, flip: v.flip, phase: r.phase, run: clamp(sp / 6.5, 0, 1), arms, kick: -1, look: REF_LOOK, kit: REF_KIT, num: '', name: '' });
    if (linesman || r.cardT > 0) {
      const hx = (v.view === 'side' ? 0.05 * v.flip : 0.3) * s, hy = -(r.flag > 0 || r.cardT > 0 ? 1.75 : 1.0) * hp;
      ctx.fillStyle = linesman ? (r.flag > 0 ? '#ffd23a' : '#ff8a1e') : r.card;
      ctx.fillRect(hx, hy - 0.22 * hp, linesman ? 0.32 * s : 0.12 * s, linesman ? 0.22 * hp : 0.17 * hp);
    }
    ctx.restore();
  },
  offsideLine() {
    const o = Match.offLine; if (!o) return;
    const a = clamp((3 - (Match.time - o.t)) / 0.5, 0, 1);
    line3(o.x, -1, 0.02, o.x, PITCH_W + 1, 0.02, 0.12, `rgba(255,75,92,${0.85 * a})`, 1.5);
    fillPoly([[o.x - 0.15, 0, 0.015], [o.x + 0.15, 0, 0.015], [o.x + 0.15, PITCH_W, 0.015], [o.x - 0.15, PITCH_W, 0.015]], `rgba(255,75,92,${0.25 * a})`);
  },
  ring(p, col) {
    ctx.beginPath(); let first = true;
    for (let i = 0; i <= 20; i++) { const a = i / 20 * Math.PI * 2; if (!projP(p.x + Math.cos(a) * 0.7, p.y + Math.sin(a) * 0.7, 0.02)) return; if (first) { ctx.moveTo(PP.x, PP.y); first = false; } else ctx.lineTo(PP.x, PP.y); }
    ctx.closePath(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 0.2; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;
  },
  label(x, y, text, col, bg = 'rgba(8,18,30,0.8)') {
    ctx.font = "600 12px 'Golos Text', 'Segoe UI', sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = bg; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x - w / 2, y - 9, w, 18, 5); else ctx.rect(x - w / 2, y - 9, w, 18); ctx.fill();
    ctx.fillStyle = col; ctx.fillText(text, x, y + 0.5);
  },
  overlays() {
    const st = Match.state, b = Match.ball;
    if (['intro', 'replay', 'halftime', 'fulltime'].includes(st)) return;
    for (const t of Match.teams) {
      if (!t.human || !t.controlled || t.controlled.sentOff) continue;
      const p = t.controlled, col = t.locked ? '#ffc23d' : '#43a8ff';
      this.ring(p, col);
      if (projP(p.x, p.y, p.z + 2.25)) {
        const x = PP.x, y = PP.y;
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x - 7, y - 10); ctx.lineTo(x + 7, y - 10); ctx.lineTo(x, y); ctx.closePath(); ctx.fill();
        this.label(x, y - 22, p.info.name, '#ffffff');
        if (Human.charging && Human.chargeFor === p || (Human.charging && st === 'setpiece')) {
          const w = 64; ctx.fillStyle = 'rgba(8,18,30,0.85)'; ctx.fillRect(x - w / 2 - 2, y - 44, w + 4, 10);
          const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0); g.addColorStop(0, '#3fcf76'); g.addColorStop(0.7, '#ffc23d'); g.addColorStop(1, '#ff4b5c');
          ctx.fillStyle = g; ctx.fillRect(x - w / 2, y - 42, w * Human.charge, 6);
        }
        if (Match.legendCall && Match.legendCall.p === p) this.label(x, y - 46, 'Пас мне!', '#1d1204', '#ffc23d');
      }
    }
    if (Settings.names && b.owner && !b.owner.human && projP(b.owner.x, b.owner.y, 2.15)) this.label(PP.x, PP.y - 4, b.owner.info.name, '#eef3ea', 'rgba(8,18,30,0.6)');
    // прицел на пенальти
    const pen = Match.pen;
    if (pen && !pen.kicked && pen.shooter.team.human && pen.shooter === pen.shooter.team.controlled) {
      if (projP(pen.gx, pen.aimY, pen.aimZ)) {
        const r = Math.max(8, PP.s * 0.35); ctx.strokeStyle = '#ffc23d'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(PP.x, PP.y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(PP.x - r * 1.5, PP.y); ctx.lineTo(PP.x + r * 1.5, PP.y); ctx.moveTo(PP.x, PP.y - r * 1.5); ctx.lineTo(PP.x, PP.y + r * 1.5); ctx.stroke();
        const w = 140, x = W / 2 - w / 2, y = H - 90;
        ctx.fillStyle = 'rgba(8,18,30,0.85)'; ctx.fillRect(x - 4, y - 4, w + 8, 18);
        const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, '#3fcf76'); g.addColorStop(0.75, '#ffc23d'); g.addColorStop(1, '#ff4b5c');
        ctx.fillStyle = g; ctx.fillRect(x, y, w * pen.power, 10);
      }
    }
  },
  radar() {
    const w = Math.min(190, W * 0.24), h = w * PITCH_W / PITCH_L, x0 = W - w - 16 - (Input.touchEnabled ? 52 : 0), y0 = 16;
    ctx.fillStyle = 'rgba(8,18,30,0.62)'; ctx.fillRect(x0 - 4, y0 - 4, w + 8, h + 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, w, h);
    ctx.beginPath(); ctx.moveTo(x0 + w / 2, y0); ctx.lineTo(x0 + w / 2, y0 + h); ctx.stroke();
    const bw = BOX_L / PITCH_L * w, bh = BOX_W / PITCH_W * h;
    ctx.strokeRect(x0, y0 + h / 2 - bh / 2, bw, bh); ctx.strokeRect(x0 + w - bw, y0 + h / 2 - bh / 2, bw, bh);
    const X = x => x0 + x / PITCH_L * w, Y = y => y0 + (1 - y / PITCH_W) * h;
    for (const t of Match.teams) for (const p of t.active()) {
      ctx.fillStyle = p.isGK ? t.data.gk : t.kit.s; ctx.strokeStyle = luma(t.kit.s) > 0.6 ? '#1b2533' : '#ffffff';
      const r = p.human ? 4.2 : 3;
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), r, 0, 7); ctx.fill(); ctx.lineWidth = p.human ? 2 : 1; ctx.stroke();
    }
    const b = Match.ball; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(X(b.x), Y(b.y), 2.4, 0, 7); ctx.fill();
  }
};

// ============================ ПРЕВЬЮ ФУТБОЛИСТА И КАРТОЧКА ============================
function drawPreview(cv, look, kit, num, name, gkCol) {
  const g = cv.getContext('2d'), w = cv.width, h = cv.height;
  g.clearRect(0, 0, w, h);
  const bg = g.createRadialGradient(w / 2, h * 0.35, 10, w / 2, h * 0.5, h * 0.7); bg.addColorStop(0, '#1c3550'); bg.addColorStop(1, '#07101a');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  const hp = h * 0.78 / ((look.h || 181) / 100), s = hp * 0.95;
  ellipse(g, w / 2, h * 0.92, s * 0.4, s * 0.08, 'rgba(0,0,0,0.45)');
  g.save(); g.translate(w / 2, h * 0.92);
  drawFigure(g, { s, hp, view: 'front', flip: 1, phase: 0, run: 0, arms: 'swing', kick: -1, look, kit, num, name, gk: gkCol || null });
  g.restore();
}
function drawLegendCard(cv, L, team) {
  const g = cv.getContext('2d'), w = cv.width, h = cv.height, ovr = Legend.ovr(L);
  const tier = ovr >= 85 ? ['#f6e27a', '#b8892b', '#2a1d05'] : ovr >= 75 ? ['#f3d36b', '#c79a2e', '#2a1d05'] : ovr >= 65 ? ['#e6eaee', '#9aa5b1', '#16202b'] : ['#e2b48a', '#9b6b42', '#2a1708'];
  g.clearRect(0, 0, w, h);
  g.save();
  g.beginPath(); g.moveTo(w * 0.5, 4); g.lineTo(w - 10, h * 0.08); g.lineTo(w - 10, h * 0.82); g.quadraticCurveTo(w * 0.5, h + 6, 10, h * 0.82); g.lineTo(10, h * 0.08); g.closePath();
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, tier[0]); gr.addColorStop(1, tier[1]); g.fillStyle = gr; g.fill(); g.clip();
  g.globalAlpha = 0.15; for (let i = -h; i < w; i += 18) { g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 8, 0); g.lineTo(i + 8 + h, h); g.lineTo(i + h, h); g.fill(); } g.globalAlpha = 1;
  const kit = team ? team.home : KIT('#ffffff', '#111', 'plain', '#fff', '#fff', '#111');
  const hp = h * 0.42 / ((L.look.h || 181) / 100);
  ellipse(g, w * 0.62, h * 0.6, hp * 0.32, hp * 0.06, 'rgba(0,0,0,0.25)');
  g.save(); g.translate(w * 0.62, h * 0.6); drawFigure(g, { s: hp * 0.95, hp, view: 'front', flip: 1, phase: 0, run: 0, arms: 'cross', kick: -1, look: L.look, kit, num: L.num, name: L.name }); g.restore();
  g.fillStyle = tier[2]; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.font = "900 52px Unbounded, 'Arial Black', sans-serif"; g.fillText(String(ovr), 30, 82);
  g.font = "700 20px Oswald, sans-serif"; g.fillText(POS_RU[L.pos] || L.pos, 34, 108);
  g.font = "600 13px 'Golos Text', sans-serif"; g.fillText(L.nation, 34, 128);
  if (team) { const c = document.createElement('canvas'); c.width = 60; c.height = 70; drawCrest(c, team); g.drawImage(c, 32, 138, 38, 44); }
  g.textAlign = 'center'; g.font = `800 ${L.name.length > 14 ? 16 : 20}px Unbounded, sans-serif`; g.fillText(L.name.toUpperCase().slice(0, 20), w / 2, h * 0.67);
  g.fillRect(w * 0.2, h * 0.69, w * 0.6, 1.5);
  const keys = ['pac', 'sho', 'pas', 'dri', 'def', 'phy'], ab = { pac: 'СКР', sho: 'УДР', pas: 'ПАС', dri: 'ДРБ', def: 'ЗАЩ', phy: 'ФИЗ' };
  g.font = "600 16px Oswald, sans-serif";
  keys.forEach((k, i) => { const col = i < 3 ? 0 : 1, row = i % 3, x = w * (col ? 0.55 : 0.24), y = h * 0.74 + row * 20; g.textAlign = 'left'; g.fillText(`${Math.round(L.attr[k])} ${ab[k]}`, x, y); });
  g.restore();
}
// ============================ ИНТЕРФЕЙС ============================
const SCREENS = ['scr-main', 'scr-select', 'scr-tactics', 'scr-records', 'scr-controls', 'scr-settings', 'scr-legend-create', 'scr-legend-hub', 'scr-pause', 'scr-result'];
const UI = {
  stack: [], cur: 'scr-main', bannerT: 0, sel: { home: 0, away: 1, side: 'home' }, tacCtx: null, cmT: 0,
  init() {
    // главное меню
    $('main-menu').addEventListener('click', e => { const b = e.target.closest('[data-action]'); if (!b) return; Sfx.init(); Sfx.click(); this.mainAction(b.dataset.action); });
    document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => { Sfx.click(); this.back(); }));
    // выбор команд
    document.querySelectorAll('#scr-select .arrow').forEach(b => b.addEventListener('click', () => { Sfx.click(); const k = b.dataset.team; this.sel[k] = (this.sel[k] + Number(b.dataset.dir) + TEAMS.length) % TEAMS.length; this.tacFor = {}; this.renderSelect(); }));
    $('side-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; this.sel.side = b.dataset.side; this.segOn($('side-seg'), b); });
    $('btn-tactics').addEventListener('click', () => { Sfx.click(); const side = this.sel.side === 'away' ? 'away' : 'home'; this.openTactics(this.preTac(side), false); });
    $('btn-kickoff').addEventListener('click', () => { Sfx.init(); Sfx.click(); this.kickoffQuick(); });
    // тактика
    ['tac-formation', 'tac-style'].forEach(id => $(id).addEventListener('change', () => this.tacChanged(id)));
    ['tac-line', 'tac-width', 'tac-press'].forEach(id => $(id).addEventListener('input', () => this.tacChanged(id)));
    $('tac-lineup').addEventListener('click', e => { const r = e.target.closest('.lu-row'); if (r) this.lineupClick(r); });
    // настройки
    const segs = { 'set-diff': 'diff', 'set-half': 'half', 'set-cam': 'cam', 'set-sound': 'sound', 'set-auto': 'auto', 'set-names': 'names', 'set-radar': 'radar', 'set-replay': 'replay' };
    for (const [id, key] of Object.entries(segs)) {
      $(id).addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; Settings[key] = Number(b.dataset.v); saveSettings(); this.segOn($(id), b); Sfx.init(); if (key === 'sound') Sfx.setEnabled(!!Settings.sound); Sfx.click(); });
    }
    $('btn-reset-records').addEventListener('click', () => this.confirm('Сбросить все рекорды и историю матчей?', () => { Records.reset(); this.renderRecords(); this.renderMainSide(); }));
    // пауза
    $('pause-menu').addEventListener('click', e => { const b = e.target.closest('[data-action]'); if (b) { Sfx.click(); this.pauseAction(b.dataset.action); } });
    $('btn-pause-touch').addEventListener('click', () => this.pause(true));
    $('confirm-no').addEventListener('click', () => { $('confirm').hidden = true; });
    $('confirm-yes').addEventListener('click', () => { $('confirm').hidden = true; if (this._confirmFn) this._confirmFn(); });
    // клавиатурная навигация по меню
    window.addEventListener('keydown', e => this.menuKeys(e));
    this.renderMainSide();
    this.show('scr-main', true);
    setTimeout(() => { const f = document.querySelector('#scr-main .menu-item'); if (f) f.focus(); }, 50);
  },
  segOn(seg, btn) { seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === btn)); },
  syncSettings() {
    const segs = { 'set-diff': 'diff', 'set-half': 'half', 'set-cam': 'cam', 'set-sound': 'sound', 'set-auto': 'auto', 'set-names': 'names', 'set-radar': 'radar', 'set-replay': 'replay' };
    for (const [id, key] of Object.entries(segs)) $(id).querySelectorAll('button').forEach(b => b.classList.toggle('on', Number(b.dataset.v) === Number(Settings[key])));
  },
  menuOpen() { return SCREENS.some(id => !$(id).hidden) || !$('confirm').hidden; },
  show(id, root) {
    if (!root && this.cur && this.cur !== id) this.stack.push(this.cur);
    if (root) this.stack = [];
    for (const s of SCREENS) $(s).hidden = s !== id;
    this.cur = id;
    const inMatch = Match.active && Match.mode !== 'demo';
    $('hud').hidden = !inMatch;
    $('touch').hidden = !(inMatch && Input.touchEnabled && id === null);
    if (id === 'scr-records') this.renderRecords();
    if (id === 'scr-settings') this.syncSettings();
    if (id === 'scr-main') this.renderMainSide();
    setTimeout(() => { const el = $(id) && $(id).querySelector('.menu-item, .btn.primary, .back'); if (el && !(Input.touchEnabled)) el.focus({ preventScroll: true }); }, 30);
  },
  hideAll() { for (const s of SCREENS) $(s).hidden = true; this.cur = null; $('touch').hidden = !Input.touchEnabled || !Match.active || Match.mode === 'demo'; },
  back() {
    if (this.cur === 'scr-tactics' && this.tacCtx && this.tacCtx.inMatch) { if (this._fromHalf) { this._fromHalf = false; this.show('scr-result', true); } else this.show('scr-pause', true); return; }
    if (this.cur === 'scr-controls' && this._fromPause) { this._fromPause = false; this.show('scr-pause', true); return; }
    const prev = this.stack.pop() || 'scr-main';
    for (const s of SCREENS) $(s).hidden = s !== prev;
    this.cur = prev;
    if (prev === 'scr-main') this.renderMainSide();
    if (prev === 'scr-select') this.renderSelect();
    if (prev === 'scr-legend-hub') Legend.renderHub();
  },
  menuKeys(e) {
    if (!this.cur || !$('confirm').hidden) return;
    if (e.code === 'Escape') {
      if (this.cur === 'scr-pause') { this.pause(false); e.preventDefault(); return; }
      if (this.cur !== 'scr-main' && this.cur !== 'scr-result') { this.back(); e.preventDefault(); }
      return;
    }
    if (e.code !== 'ArrowUp' && e.code !== 'ArrowDown') return;
    const items = Array.from($(this.cur).querySelectorAll('.menu-item'));
    if (!items.length) return;
    let i = items.indexOf(document.activeElement);
    i = e.code === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[i].focus(); e.preventDefault();
  },
  confirm(text, fn) { $('confirm-text').textContent = text; this._confirmFn = fn; $('confirm').hidden = false; $('confirm-no').focus(); },
  toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(this._tt); this._tt = setTimeout(() => { t.hidden = true; }, 2200); },
  toastPass() { this.comment('Вы просите пас!'); },
  mainAction(a) {
    if (a === 'quick') { this.mode = 'quick'; $('select-title').textContent = 'Быстрый матч'; this.tacFor = {}; this.show('scr-select'); this.renderSelect(); }
    else if (a === 'shootout') { this.mode = 'shootout'; $('select-title').textContent = 'Серия пенальти'; this.tacFor = {}; this.show('scr-select'); this.renderSelect(); }
    else if (a === 'legend') Legend.open();
    else if (a === 'records') this.show('scr-records');
    else if (a === 'controls') this.show('scr-controls');
    else if (a === 'settings') this.show('scr-settings');
  },
  renderMainSide() {
    const r = Records.data, el = $('main-side');
    const top = Object.entries(r.scorers).sort((a, b) => b[1] - a[1])[0];
    const lg = Legend.data;
    el.innerHTML = `<h3>Ваша статистика</h3>
      <div class="ms-row"><span>Сыграно матчей</span><b>${r.played}</b></div>
      <div class="ms-row"><span>Победы · ничьи · поражения</span><b>${r.wins}·${r.draws}·${r.losses}</b></div>
      <div class="ms-row"><span>Лучшая серия побед</span><b>${r.bestStreak}</b></div>
      <div class="ms-row"><span>Лучший бомбардир</span><b>${top ? esc(top[0]) + ' · ' + top[1] : '—'}</b></div>
      ${lg ? `<div class="ms-row"><span>Легенда: ${esc(lg.name)}</span><b>${Legend.ovr(lg)} OVR</b></div>` : ''}`;
  },
  // ---------- выбор команд ----------
  renderSelect() {
    for (const side of ['home', 'away']) {
      const t = TEAMS[this.sel[side]], card = $('sel-' + side);
      drawCrest(card.querySelector('.crest'), t);
      card.style.setProperty('--kit', t.home.s);
      const r = teamRatings(t), stars = Math.round(clamp((r.ovr - 74) / 2.4, 1, 5) * 2) / 2;
      const keys = t.roster.slice().sort((a, b) => b.ovr - a.ovr).slice(0, 4);
      card.querySelector('.tc-body').innerHTML = `
        <div class="tc-name">${esc(t.name)}</div><div class="tc-league">${esc(t.league)}</div>
        <div class="tc-ratings"><div><b>${r.ovr}</b><span>ОБЩ</span></div><div><b>${r.att}</b><span>АТК</span></div><div><b>${r.mid}</b><span>ПЗЩ</span></div><div><b>${r.def}</b><span>ЗЩТ</span></div></div>
        <div class="tc-stars" aria-label="Рейтинг ${stars} из 5">${'★'.repeat(Math.floor(stars))}${stars % 1 ? '½' : ''}<span style="opacity:.25">${'★'.repeat(5 - Math.ceil(stars))}</span></div>
        <div class="tc-keys"><ul>${keys.map(p => `<li><span>${esc(p.name)} · ${POS_RU[p.pos]}</span><b>${p.ovr}</b></li>`).join('')}</ul></div>`;
    }
    const h = TEAMS[this.sel.home];
    $('sel-stadium').textContent = 'Стадион: ' + h.stadium + ' · ' + STYLES[h.style].name;
    $('side-seg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.side === this.sel.side));
  },
  preTac(side) {
    this.tacFor = this.tacFor || {};
    const t = TEAMS[this.sel[side]];
    if (!this.tacFor[side] || this.tacFor[side].team !== t) this.tacFor[side] = this.defaultTac(t);
    return this.tacFor[side];
  },
  defaultTac(t, roster) {
    const st = STYLES[t.style];
    const ro = roster || t.roster;
    const xi = autoLineup(t, t.formation, ro);
    const bench = ro.map((p, i) => i).filter(i => !xi.includes(i));
    return { team: t, roster: ro, tac: { formation: t.formation, style: t.style, line: st.line, width: st.width, press: st.press }, xi, bench, inMatch: false };
  },
  kickoffQuick() {
    const ht = this.preTac('home'), at = this.preTac('away');
    if (ht.team === at.team) { this.toast('Выберите два разных клуба'); return; }
    const side = this.sel.side === 'home' ? 0 : this.sel.side === 'away' ? 1 : -1;
    this.hideAll();
    Match.start({
      mode: this.mode === 'shootout' ? 'shootout' : 'quick', home: ht.team, away: at.team, humanSide: side,
      homeTac: ht.tac, awayTac: at.tac, homeXI: ht.xi.map(i => ht.roster[i]), awayXI: at.xi.map(i => at.roster[i]),
      homeBench: ht.bench.map(i => ht.roster[i]), awayBench: at.bench.map(i => at.roster[i])
    });
  },
  // ---------- тактика ----------
  openTactics(ctx2, inMatch) {
    this.tacCtx = ctx2; ctx2.inMatch = inMatch; this.pickRow = null;
    const f = $('tac-formation'), s = $('tac-style');
    f.innerHTML = Object.keys(FORMATIONS).map(k => `<option value="${k}">${k}</option>`).join('');
    s.innerHTML = Object.entries(STYLES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
    const tac = ctx2.tac;
    f.value = tac.formation; s.value = tac.style; $('tac-line').value = tac.line; $('tac-width').value = tac.width; $('tac-press').value = tac.press;
    $('tac-team-name').textContent = ctx2.team.name || (ctx2.teamObj && ctx2.teamObj.data.name) || '';
    this.show('scr-tactics');
    this.renderTactics();
  },
  tacChanged(id) {
    const c = this.tacCtx, tac = c.tac;
    if (id === 'tac-style') { const st = STYLES[$('tac-style').value]; tac.style = $('tac-style').value; tac.line = st.line; tac.width = st.width; tac.press = st.press; $('tac-line').value = st.line; $('tac-width').value = st.width; $('tac-press').value = st.press; }
    if (id === 'tac-formation') {
      tac.formation = $('tac-formation').value;
      if (c.inMatch) c.teamObj.reassign();
      else { c.xi = autoLineup(c.team, tac.formation, c.roster); c.bench = c.roster.map((p, i) => i).filter(i => !c.xi.includes(i)); }
    }
    tac.line = Number($('tac-line').value); tac.width = Number($('tac-width').value); tac.press = Number($('tac-press').value);
    if (c.inMatch) Object.assign(c.teamObj.tac, tac);
    this.renderTactics();
  },
  renderTactics() {
    const c = this.tacCtx, tac = c.tac;
    $('tac-line-v').textContent = tac.line; $('tac-width-v').textContent = tac.width; $('tac-press-v').textContent = tac.press;
    $('tac-desc').textContent = STYLES[tac.style].desc;
    // поле
    const cv = $('tac-pitch'), g = cv.getContext('2d'), w = cv.width, h = cv.height;
    g.fillStyle = '#2f8a3d'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 10; i++) { if (i % 2) { g.fillStyle = '#35944a'; g.fillRect(0, i * h / 10, w, h / 10); } }
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 2;
    g.strokeRect(14, 14, w - 28, h - 28); g.beginPath(); g.moveTo(14, h / 2); g.lineTo(w - 14, h / 2); g.stroke();
    g.beginPath(); g.arc(w / 2, h / 2, 46, 0, 7); g.stroke();
    const bw = (BOX_W / PITCH_W) * (w - 28), bl = (BOX_L / PITCH_L) * (h - 28);
    g.strokeRect(w / 2 - bw / 2, h - 14 - bl, bw, bl); g.strokeRect(w / 2 - bw / 2, 14, bw, bl);
    const slots = FORMATIONS[tac.formation];
    const players = c.inMatch ? slots.map((s, i) => c.teamObj.players.find(p => p.slot === i)) : c.xi.map(i => c.roster[i]);
    const kit = c.inMatch ? c.teamObj.kit : c.team.home;
    slots.forEach((s, i) => {
      const x = 14 + (1 - s[2]) * (w - 28), y = h - 14 - s[1] * (h - 28) * 1.18;
      const info = c.inMatch ? (players[i] ? players[i].info : null) : players[i];
      g.beginPath(); g.arc(x, y, 15, 0, 7); g.fillStyle = s[0] === 'GK' ? (c.team.gk || '#2fa46a') : kit.s; g.fill();
      g.lineWidth = 2; g.strokeStyle = kit.s2; g.stroke();
      g.fillStyle = s[0] === 'GK' ? '#fff' : kit.n; g.font = "700 13px Oswald, sans-serif"; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(info ? info.num : '', x, y + 1);
      g.fillStyle = '#ffffff'; g.font = "600 11px 'Golos Text', sans-serif"; g.fillText(info ? info.name : POS_RU[s[0]], x, y + 26);
      g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = "600 10px Oswald, sans-serif"; g.fillText(POS_RU[s[0]], x, y - 24);
    });
    // состав
    const rows = [];
    if (c.inMatch) {
      const t = c.teamObj;
      t.players.slice().sort((a, b) => a.slot - b.slot).forEach((p, i) => rows.push(this.luRow('xi', t.players.indexOf(p), FORMATIONS[t.tac.formation][p.slot][0], p.info, p.sentOff ? 'удалён' : Math.round(p.stamina * 100) + '%')));
      rows.push(`<div class="lu-sep">Запасные · замен осталось: ${t.subsLeft}</div>`);
      t.bench.forEach((inf, i) => rows.push(this.luRow('bench', i, inf.pos, inf, inf.ovr)));
    } else {
      c.xi.forEach((ri, i) => rows.push(this.luRow('xi', i, slots[i][0], c.roster[ri], c.roster[ri].ovr)));
      rows.push('<div class="lu-sep">Запасные</div>');
      c.bench.forEach((ri, i) => rows.push(this.luRow('bench', i, c.roster[ri].pos, c.roster[ri], c.roster[ri].ovr)));
    }
    $('tac-lineup').innerHTML = rows.join('');
  },
  luRow(kind, i, pos, info, right) {
    const pick = this.pickRow && this.pickRow.kind === kind && this.pickRow.i === i ? ' pick' : '';
    return `<button class="lu-row ${kind === 'bench' ? 'bench' : ''}${pick}" data-kind="${kind}" data-i="${i}"><span class="lu-pos">${POS_RU[pos] || pos}</span><span class="lu-num">${info.num}</span><span class="lu-name">${esc(info.name)}${info.isLegend ? ' ★' : ''}</span><span class="lu-ovr">${right}</span></button>`;
  },
  lineupClick(row) {
    const kind = row.dataset.kind, i = Number(row.dataset.i), c = this.tacCtx;
    if (!this.pickRow || this.pickRow.kind === kind) { this.pickRow = { kind, i }; this.renderTactics(); return; }
    const xiI = kind === 'xi' ? i : this.pickRow.i, bI = kind === 'bench' ? i : this.pickRow.i;
    this.pickRow = null;
    if (c.inMatch) {
      const t = c.teamObj, old = t.players[xiI];
      if (t.subsLeft <= 0) { this.toast('Замены закончились'); this.renderTactics(); return; }
      if (old.sentOff) { this.toast('Удалённого игрока заменить нельзя'); this.renderTactics(); return; }
      if (old.isLegend) { this.toast('Свою легенду заменить нельзя'); this.renderTactics(); return; }
      const inf = t.bench.splice(bI, 1)[0];
      const np = new Player(inf, t, old.slot); np.x = old.x; np.y = old.y; np.role = old.role; t.players[xiI] = np; t.subsLeft--; t.subsDone++;
      if (t.controlled === old) Human.switchTo(t, np);
      Match.comment(`Замена: ${inf.name} вместо ${old.name}`); UI.addEvent(t, `${inf.name} ↔ ${old.name}`, '#43a8ff');
    } else {
      const tmp = c.xi[xiI]; c.xi[xiI] = c.bench[bI]; c.bench[bI] = tmp;
    }
    this.renderTactics();
  },
  // ---------- HUD ----------
  humanTeam() { return Match.home && Match.home.human ? Match.home : Match.away && Match.away.human ? Match.away : null; },
  hudStart() {
    const h = Match.home, a = Match.away;
    $('sb-home').textContent = h.data.short; $('sb-away').textContent = a.data.short;
    $('sb-home-kit').style.background = h.kit.s; $('sb-away-kit').style.background = a.kit.s;
    $('sb-events').innerHTML = ''; $('commentary').innerHTML = '';
    this.updateScore(false);
    const ht = this.humanTeam();
    $('player-tag').hidden = true; this._tagP = null; if (ht && ht.controlled) this.playerTag(ht.controlled);
    $('hud').hidden = Match.mode === 'demo';
    $('touch').hidden = !(Input.touchEnabled && Match.mode !== 'demo');
    $('scorebug').hidden = false;
    this.shootoutBar(Match.mode === 'shootout');
    this.setPieceHint(null);
  },
  updateScore(flash) {
    if (!Match.home) return;
    $('sb-hs').textContent = Match.home.score; $('sb-as').textContent = Match.away.score;
    if (flash) { const s = document.querySelector('.sb-score'); s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); }
  },
  addEvent(team, text, col) {
    const el = document.createElement('div'); el.className = 'sb-ev';
    el.innerHTML = `<i style="background:${col}"></i>${esc(team.data.short)} · ${esc(text)}`;
    $('sb-events').appendChild(el); setTimeout(() => el.remove(), 7000);
  },
  banner(title, sub, kicker, cls) {
    const b = $('banner'); b.className = 'banner ' + (cls || '');
    $('banner-title').textContent = title; $('banner-sub').textContent = sub || ''; $('banner-kicker').textContent = kicker || '';
    b.hidden = false; b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    this.bannerT = cls === 'goal' ? 5.5 : cls === 'intro' ? 4.5 : 2.4;
  },
  hideBanner() { $('banner').hidden = true; this.bannerT = 0; },
  comment(t) {
    if (Match.mode === 'demo') return;
    const c = $('commentary'), el = document.createElement('div'); el.className = 'cm-line'; el.textContent = t;
    c.appendChild(el); while (c.children.length > 2) c.firstChild.remove();
    setTimeout(() => el.remove(), 4900);
  },
  introCard(team) {
    const c = $('intro-card'); c.hidden = false; c.style.setProperty('--kit', team.kit.s); c.style.animation = 'none'; void c.offsetWidth; c.style.animation = '';
    drawCrest($('intro-crest'), team.data);
    $('ic-kicker').textContent = team.side === 0 ? 'Хозяева · стартовый состав' : 'Гости · стартовый состав';
    $('ic-name').textContent = team.data.name;
    $('ic-formation').textContent = `Схема ${team.tac.formation} · ${team.style().name}`;
    $('ic-list').innerHTML = team.players.slice().sort((a, b) => a.slot - b.slot).map(p => `<li><b>${p.info.num}</b>${esc(p.info.name)}${p.isLegend ? ' ★' : ''}</li>`).join('');
  },
  hideIntroCard() { $('intro-card').hidden = true; },
  replayBadge(on) { $('replay-badge').hidden = !on; },
  aiBadge(on) { if ($('ai-badge').hidden === !on) return; $('ai-badge').hidden = !on; },
  playerTag(p) { if (!p) return; $('player-tag').hidden = false; $('pt-num').textContent = p.info.num; $('pt-name').textContent = p.info.name; this._tagP = p; },
  setPieceHint(type, humanShooter, humanGK) {
    const h = $('hint');
    const map = {
      kickoff: ['<kbd>J</kbd> разыграть с центра'], throw: ['<kbd>J</kbd> короткий аут', '<kbd>L</kbd> длинный аут'],
      corner: ['Стрелки — зона подачи', '<kbd>L</kbd> навес', '<kbd>J</kbd> розыгрыш'], goalkick: ['<kbd>J</kbd> короткий пас', '<kbd>L</kbd> длинный удар'],
      freekick: ['<kbd>K</kbd> удар (удерживать)', '<kbd>J</kbd> пас', '<kbd>L</kbd> навес'],
      penalty: humanShooter ? ['Стрелки — прицел', '<kbd>K</kbd> удерживать и отпустить'] : humanGK ? ['Стрелки — выбрать угол прыжка'] : []
    };
    const lines = type ? map[type] || [] : ['<kbd>J</kbd> пас · <kbd>K</kbd> удар · <kbd>L</kbd> навес', '<kbd>I</kbd> на ход · <kbd>E</kbd> финт · <kbd>Q</kbd> смена'];
    const ht = this.humanTeam();
    h.innerHTML = ht || humanGK ? lines.map(l => `<span>${l}</span>`).join('') : '';
  },
  shootoutBar(on) {
    $('shootout').hidden = !on; if (!on || !Match.home) return;
    $('so-home-name').textContent = Match.home.data.short; $('so-away-name').textContent = Match.away.data.short;
    const dots = t => { const k = t.kicks || [], n = Math.max(5, k.length); let s = ''; for (let i = 0; i < n; i++) s += `<i class="so-dot ${k[i] === true ? 'ok' : k[i] === false ? 'miss' : ''}"></i>`; return s; };
    $('so-home-dots').innerHTML = dots(Match.home); $('so-away-dots').innerHTML = dots(Match.away);
  },
  tick(dt) {
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) $('banner').hidden = true; }
    if (!Match.active || Match.mode === 'demo') return;
    const m = Math.floor(Match.clock / 60) + (Match.half === 2 ? 45 : 0), s = Math.floor(Match.clock % 60), base = Match.half === 1 ? 45 : 90;
    $('sb-clock').textContent = Match.mode === 'shootout' ? 'ПЕН' : String(Math.min(m, base)).padStart(2, '0') + ':' + (m >= base ? '00' : String(s).padStart(2, '0'));
    const add = $('sb-added');
    if (m >= base && Match.mode !== 'shootout') { add.hidden = false; add.textContent = '+' + Match.added; } else add.hidden = true;
    const ht = this.humanTeam();
    if (ht && ht.controlled) { if (this._tagP !== ht.controlled) this.playerTag(ht.controlled); $('pt-stamina').style.width = Math.round(ht.controlled.stamina * 100) + '%'; }
    if (Input.hit('pause') && !Match.paused && !this.menuOpen() && Match.state !== 'intro' && Match.state !== 'fulltime' && Match.state !== 'halftime') this.pause(true);
    else if (Input.hit('padPause') && Match.paused && this.cur === 'scr-pause') this.pause(false);
  },
  // ---------- пауза, перерыв, итоги ----------
  pause(on, msg) {
    if (!Match.active || Match.mode === 'demo') return;
    if (on) {
      if (Match.state === 'fulltime' || Match.state === 'halftime') return;
      Match.paused = true; Human.charging = false;
      const h = Match.home, a = Match.away;
      $('pause-score').innerHTML = `${esc(h.data.short)} ${h.score} : ${a.score} ${esc(a.data.short)}<small>${esc(msg || (Match.minuteLabel() + ' · ' + h.data.stadium))}</small>`;
      $('pause-stats').hidden = true;
      this.show('scr-pause', true);
    } else {
      Match.paused = false; Input.disconnected = false; Input.lastActive = performance.now() / 1000; Input.keys = {};
      this.hideAll();
    }
  },
  pauseAction(a) {
    if (a === 'resume') this.pause(false);
    else if (a === 'tactics') { const t = this.humanTeam() || Match.home; this.openTactics({ team: t.data, teamObj: t, tac: Object.assign({}, t.tac), roster: null }, true); }
    else if (a === 'stats') { const s = $('pause-stats'); s.hidden = !s.hidden; s.innerHTML = this.statsHTML(); }
    else if (a === 'controls') { this._fromPause = true; this.show('scr-controls', true); }
    else if (a === 'quit') this.confirm('Выйти из матча? Результат не будет засчитан.', () => { const lg = Match.mode === 'legend'; Match.stop(); Match.paused = false; if (lg) { startDemo(); this.show('scr-legend-hub', true); this.stack = ['scr-main']; Legend.renderHub(); } else this.toMenu(); });
  },
  toMenu() { this.hideAll(); startDemo(); this.show('scr-main', true); },
  statsHTML() {
    const h = Match.home.stats, a = Match.away.stats, tot = (h.possT + a.possT) || 1, pc = s => s.passes ? Math.round(s.passOk / s.passes * 100) + '%' : '—';
    const rows = [['Владение мячом', Math.round(h.possT / tot * 100) + '%', Math.round(a.possT / tot * 100) + '%', h.possT / tot],
      ['Удары', h.shots, a.shots], ['Удары в створ', h.onTarget, a.onTarget], ['Точность передач', pc(h), pc(a)],
      ['Отборы', h.tackles, a.tackles], ['Сейвы', h.saves, a.saves], ['Фолы', h.fouls, a.fouls], ['Угловые', h.corners, a.corners],
      ['Офсайды', h.offsides, a.offsides], ['Жёлтые карточки', h.yellow, a.yellow], ['Красные карточки', h.red, a.red]];
    return rows.map(r => { const hv = parseFloat(r[1]) || 0, av = parseFloat(r[2]) || 0, sh = r[3] !== undefined ? r[3] : (hv + av ? hv / (hv + av) : 0.5); return `<div class="stat-row"><b>${r[1]}</b><div class="stat-mid"><span>${r[0]}</span><div class="stat-bars"><i style="width:${(sh * 100).toFixed(0)}%"></i><i style="width:${((1 - sh) * 100).toFixed(0)}%"></i></div></div><b>${r[2]}</b></div>`; }).join('');
  },
  scorersHTML(side) {
    const by = {};
    for (const e of Match.events) if (e.type === 'goal' && e.team === side) { const k = e.name + (e.og ? ' (авт.)' : ''); (by[k] = by[k] || []).push(e.min); }
    return Object.entries(by).map(([n, m]) => `${esc(n)} ${m.join(', ')}`).join('<br>') || '&nbsp;';
  },
  resultHead(kicker) {
    const h = Match.home, a = Match.away;
    $('res-kicker').textContent = kicker;
    $('res-score').innerHTML = `<div class="rs-team"><canvas width="64" height="75" id="rs-c1"></canvas>${esc(h.data.name)}</div>
      <div><div class="rs-num">${h.score} : ${a.score}</div>${Match.mode === 'shootout' || h.pens || a.pens ? `<span class="rs-pens">пенальти ${h.pens} : ${a.pens}</span>` : ''}</div>
      <div class="rs-team"><canvas width="64" height="75" id="rs-c2"></canvas>${esc(a.data.name)}</div>`;
    drawCrest($('rs-c1'), h.data); drawCrest($('rs-c2'), a.data);
    $('res-scorers').innerHTML = `<div>${this.scorersHTML(0)}</div><div>${this.scorersHTML(1)}</div>`;
  },
  showHalftime() {
    this.resultHead('Перерыв · 45 минут позади');
    $('res-stats').innerHTML = this.statsHTML(); $('res-extra').innerHTML = '';
    $('res-actions').innerHTML = `<button class="btn ghost" id="ra-tac">Тактика</button><button class="btn primary" id="ra-2nd">Второй тайм</button>`;
    $('ra-2nd').onclick = () => { Sfx.click(); this.hideAll(); Match.secondHalf(); };
    $('ra-tac').onclick = () => { const t = this.humanTeam() || Match.home; this._fromHalf = true; this.openTactics({ team: t.data, teamObj: t, tac: Object.assign({}, t.tac), roster: null }, true); };
    this.show('scr-result', true);
  },
  showResult(res) {
    this.resultHead(res.shootout ? 'Серия пенальти завершена' : 'Финальный свисток');
    $('res-stats').innerHTML = res.shootout ? '' : this.statsHTML();
    const extra = [];
    if (res.motm && !res.shootout) extra.push(`<div class="rx">Игрок матча: <b>${esc(res.motm.info.name)}</b> (${esc(res.motm.team.data.short)}) · оценка ${res.motm.stats.rating.toFixed(1)}</div>`);
    if (res.humanSide >= 0 && res.mode !== 'demo') { const news = Records.update(res); for (const n of news) extra.push(`<div class="rx new">Новый рекорд: <b>${esc(n)}</b></div>`); }
    if (res.mode === 'legend') extra.push(Legend.afterMatch(res));
    $('res-extra').innerHTML = extra.join('');
    const acts = $('res-actions');
    if (res.mode === 'legend') {
      acts.innerHTML = `<button class="btn primary" id="ra-cont">Продолжить карьеру</button>`;
      $('ra-cont').onclick = () => { Sfx.click(); Match.stop(); startDemo(); this.show('scr-legend-hub', true); this.stack = ['scr-main']; Legend.renderHub(); };
    } else {
      acts.innerHTML = `<button class="btn ghost" id="ra-menu">Главное меню</button><button class="btn primary" id="ra-again">${res.shootout ? 'Ещё серия' : 'Реванш'}</button>`;
      $('ra-menu').onclick = () => { Sfx.click(); Match.stop(); this.toMenu(); };
      $('ra-again').onclick = () => { Sfx.click(); this.hideAll(); Match.start(Object.assign({}, Match.cfg, { skipIntro: true })); };
    }
    this.show('scr-result', true);
  },
  // ---------- рекорды ----------
  renderRecords() {
    const r = Records.data, rows = (arr) => arr.map(([a, b]) => `<div class="rec-row"><span>${a}</span><span>${b}</span></div>`).join('');
    const top = Object.entries(r.scorers).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const clubs = Object.entries(r.clubs).sort((a, b) => b[1].p - a[1].p).slice(0, 6);
    const lg = Legend.data, best = Store.get('legendBest', null);
    $('records-body').innerHTML = `
      <div class="rec-block"><h3>Общая статистика</h3>
        <div class="big-stats"><div><b>${r.played}</b><span>Матчи</span></div><div><b>${r.wins}</b><span>Победы</span></div><div><b>${r.draws}</b><span>Ничьи</span></div><div><b>${r.losses}</b><span>Поражения</span></div></div>
        ${rows([['Забито / пропущено', `${r.gf} / ${r.ga}`], ['Сухие матчи', r.cleanSheets], ['Текущая серия побед', r.streak], ['Лучшая серия побед', r.bestStreak], ['Лучшая беспроигрышная серия', r.bestUnbeaten]])}</div>
      <div class="rec-block"><h3>Рекорды матчей</h3>
        ${rows([['Крупнейшая победа', r.bigWin ? `${r.bigWin.score} · ${esc(r.bigWin.vs)}` : '—'], ['Больше всего голов за матч', r.mostGoals ? `${r.mostGoals.n} · ${esc(r.mostGoals.vs)}` : '—'], ['Самый быстрый гол', r.fastest ? `${r.fastest.min}' · ${esc(r.fastest.name)}` : '—'], ['Серии пенальти (победы / поражения)', `${r.shootouts.w} / ${r.shootouts.l}`]])}</div>
      <div class="rec-block"><h3>Бомбардиры</h3>${top.length ? rows(top.map(([n, g]) => [esc(n), g + ' ' + plural(g, 'гол', 'гола', 'голов')])) : '<div class="rec-empty">Забейте первый гол, и здесь появится таблица бомбардиров.</div>'}</div>
      <div class="rec-block"><h3>Клубы</h3>${clubs.length ? rows(clubs.map(([id, c]) => [esc(TEAM_BY_ID[id] ? TEAM_BY_ID[id].name : id), `${c.p} ${plural(c.p, 'матч', 'матча', 'матчей')} · ${Math.round(c.w / c.p * 100)}% побед`])) : '<div class="rec-empty">Сыграйте матч за любой клуб.</div>'}</div>
      <div class="rec-block"><h3>Последние матчи</h3>${r.history.length ? rows(r.history.slice(0, 8).map(m => [`${esc(m.h)} — ${esc(m.a)}`, `${m.hs}:${m.as}${m.pens ? ' (' + m.pens + ')' : ''}`])) : '<div class="rec-empty">История пока пуста.</div>'}</div>
      <div class="rec-block"><h3>Легенда</h3>${lg ? rows([['Текущий игрок', esc(lg.name)], ['Рейтинг', Legend.ovr(lg)], ['Матчи · голы · передачи', `${lg.career.apps} · ${lg.career.goals} · ${lg.career.assists}`], ['Трофеи', lg.career.trophies.length]]) : ''}${best ? rows([['Лучшая карьера', `${esc(best.name)} · ${best.goals} ${plural(best.goals, 'гол', 'гола', 'голов')}`]]) : ''}${!lg && !best ? '<div class="rec-empty">Создайте футболиста в режиме «Легенда».</div>' : ''}</div>`;
  }
};

// ============================ РЕКОРДЫ ============================
const REC_DEFAULT = () => ({ played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, cleanSheets: 0, streak: 0, bestStreak: 0, unbeaten: 0, bestUnbeaten: 0, bigWin: null, mostGoals: null, fastest: null, scorers: {}, clubs: {}, shootouts: { w: 0, l: 0 }, history: [] });
const Records = {
  data: Object.assign(REC_DEFAULT(), Store.get('records', {})),
  save() { Store.set('records', this.data); },
  reset() { this.data = REC_DEFAULT(); this.save(); },
  update(res) {
    const r = this.data, news = [], side = res.humanSide, my = side === 0 ? res.home : res.away, op = my.opp;
    const gf = my.score, ga = op.score, vs = `${res.home.data.short} ${res.hs}:${res.as} ${res.away.data.short}`;
    r.history.unshift({ h: res.home.data.short, a: res.away.data.short, hs: res.hs, as: res.as, pens: res.shootout || res.hp || res.ap ? `${res.hp}:${res.ap}` : '', d: Date.now() });
    r.history = r.history.slice(0, 15);
    if (res.shootout) {
      const won = my.pens > op.pens; if (won) r.shootouts.w++; else r.shootouts.l++;
      this.save(); return won ? ['Победа в серии пенальти'] : [];
    }
    r.played++; r.gf += gf; r.ga += ga; if (ga === 0) r.cleanSheets++;
    const c = r.clubs[my.data.id] = r.clubs[my.data.id] || { p: 0, w: 0 }; c.p++;
    if (gf > ga) { r.wins++; c.w++; r.streak++; r.unbeaten++; }
    else if (gf === ga) { r.draws++; r.streak = 0; r.unbeaten++; }
    else { r.losses++; r.streak = 0; r.unbeaten = 0; }
    if (r.streak > r.bestStreak) { r.bestStreak = r.streak; if (r.streak >= 2) news.push(`серия из ${r.streak} побед`); }
    if (r.unbeaten > r.bestUnbeaten) r.bestUnbeaten = r.unbeaten;
    const diff = gf - ga;
    if (diff > 0 && (!r.bigWin || diff > r.bigWin.diff || (diff === r.bigWin.diff && gf > r.bigWin.gf))) { r.bigWin = { diff, gf, score: `${gf}:${ga}`, vs }; news.push(`крупнейшая победа ${gf}:${ga}`); }
    if (gf > 0 && (!r.mostGoals || gf > r.mostGoals.n)) { r.mostGoals = { n: gf, vs }; news.push(`${gf} ${plural(gf, 'гол', 'гола', 'голов')} за матч`); }
    for (const e of res.events) {
      if (e.type !== 'goal' || e.team !== side || e.og) continue;
      r.scorers[e.name] = (r.scorers[e.name] || 0) + 1;
      const min = Math.floor(e.clock / 60) + 1;
      if (!r.fastest || e.clock < r.fastest.sec) { r.fastest = { sec: e.clock, min, name: e.name }; news.push(`самый быстрый гол: ${min}' (${e.name})`); }
    }
    this.save();
    return news;
  }
};

// ============================ РЕЖИМ «ЛЕГЕНДА» ============================
const OVR_W = { ST: { sho: .35, pac: .2, dri: .2, phy: .15, pas: .1 }, W: { pac: .3, dri: .3, sho: .2, pas: .15, phy: .05 }, AM: { pas: .32, dri: .3, sho: .2, pac: .1, phy: .08 }, CM: { pas: .32, dri: .2, def: .18, phy: .15, sho: .1, pac: .05 }, DM: { def: .35, pas: .25, phy: .25, dri: .08, pac: .07 }, FB: { pac: .28, def: .32, pas: .18, phy: .12, dri: .1 }, CB: { def: .5, phy: .3, pac: .1, pas: .1 } };
const Legend = {
  data: Store.get('legend', null), form: null, tab: 'train',
  save() { Store.set('legend', this.data); },
  ovr(L) { const w = OVR_W[POS_GROUP[L.pos]] || OVR_W.CM; let s = 0; for (const k in w) s += L.attr[k] * w[k]; return Math.round(s); },
  season(L) { const y = 2026 + L.season - 1; return `${y}/${String(y + 1).slice(2)}`; },
  info(L) { return { id: 'legend', name: L.name.split(' ').slice(-1)[0] || L.name, pos: L.pos, num: L.num, ovr: this.ovr(L), attr: Object.assign({}, L.attr), look: Object.assign({}, L.look), celeb: L.celeb || 'slide', teamId: L.clubId, isLegend: true }; },
  open() { if (this.data) { UI.show('scr-legend-hub'); this.renderHub(); } else { UI.show('scr-legend-create'); this.initCreate(); } },
  // ---------- создание ----------
  initCreate() {
    const f = this.form = { skin: 2, hc: 'k', boots: BOOTS[2], foot: 'R' };
    $('lc-nation').innerHTML = NATIONS.map(n => `<option>${n}</option>`).join('');
    $('lc-pos').innerHTML = Object.keys(POS_NAME_RU).filter(p => p !== 'GK' && p !== 'LWB' && p !== 'RWB' && p !== 'LM' && p !== 'RM').map(p => `<option value="${p}">${POS_NAME_RU[p]}</option>`).join('');
    $('lc-pos').value = 'ST';
    $('lc-hair').innerHTML = Object.entries(HAIR_STYLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    $('lc-hair').value = 'sh';
    $('lc-club').innerHTML = TEAMS.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    const sw = (el, arr, key, val) => { $(el).innerHTML = arr.map((c, i) => `<button type="button" class="swatch${(val(c, i) === f[key]) ? ' on' : ''}" style="background:${c}" data-v="${i}" aria-label="Вариант ${i + 1}"></button>`).join(''); };
    sw('lc-skin', SKIN, 'skin', (c, i) => i);
    const hk = Object.keys(HAIR_COL); sw('lc-haircol', hk.map(k => HAIR_COL[k]), 'hc', (c, i) => hk[i]);
    sw('lc-boots', BOOTS, 'boots', c => c);
    const pickSw = (el, fn) => $(el).onclick = e => { const b = e.target.closest('.swatch'); if (!b) return; $(el).querySelectorAll('.swatch').forEach(x => x.classList.toggle('on', x === b)); fn(Number(b.dataset.v)); this.preview(); };
    pickSw('lc-skin', i => { f.skin = i; }); pickSw('lc-haircol', i => { f.hc = hk[i]; }); pickSw('lc-boots', i => { f.boots = BOOTS[i]; });
    $('lc-foot').onclick = e => { const b = e.target.closest('button'); if (!b) return; f.foot = b.dataset.v; UI.segOn($('lc-foot'), b); };
    ['lc-name', 'lc-number', 'lc-hair', 'lc-beard', 'lc-club', 'lc-pos'].forEach(id => { $(id).oninput = () => this.preview(); $(id).onchange = () => this.preview(); });
    $('lc-height').oninput = () => { $('lc-height-v').textContent = $('lc-height').value; this.preview(); };
    $('lc-form').onsubmit = e => { e.preventDefault(); this.create(); };
    this.preview();
  },
  lookFromForm() { const f = this.form; return { skin: f.skin, hair: $('lc-hair').value, hc: f.hc, beard: Number($('lc-beard').value), h: Number($('lc-height').value), boots: f.boots }; },
  preview() {
    const t = TEAM_BY_ID[$('lc-club').value] || TEAMS[0];
    drawPreview($('lc-canvas'), this.lookFromForm(), t.home, clamp(Number($('lc-number').value) || 27, 1, 99), $('lc-name').value || 'Игрок');
  },
  create() {
    const name = ($('lc-name').value || '').trim() || 'Алекс Морозов', pos = $('lc-pos').value, t = POS_T[POS_GROUP[pos]];
    const attr = {}; for (const k of ['pac', 'sho', 'pas', 'dri', 'def', 'phy']) attr[k] = clamp(Math.round(63 + t[k] * 0.8), 30, 78);
    const h = Number($('lc-height').value); attr.phy = clamp(attr.phy + Math.round((h - 182) / 4), 30, 80); attr.pac = clamp(attr.pac - Math.round((h - 182) / 6), 30, 80);
    const L = this.data = {
      name, nation: $('lc-nation').value, pos, foot: this.form.foot, num: clamp(Number($('lc-number').value) || 27, 1, 99), look: this.lookFromForm(), attr,
      age: 17, season: 1, clubId: $('lc-club').value, points: 3, celeb: pick(['slide', 'jump', 'plane', 'arms', 'fist']),
      career: { apps: 0, goals: 0, assists: 0, ratingSum: 0, motm: 0, trophies: [] }, ss: { apps: 0, goals: 0, assists: 0, ratingSum: 0 },
      offers: [], msg: `Добро пожаловать в ${TEAM_BY_ID[$('lc-club').value].name}! Тренер ждёт от вас прогресса.`
    };
    this.newSeason(L, true);
    this.save(); UI.show('scr-legend-hub', true); UI.stack = ['scr-main']; this.renderHub();
  },
  // ---------- сезон ----------
  newSeason(L, first) {
    const ids = TEAMS.map(t => t.id), n = ids.length, arr = ids.slice(); if (n % 2) arr.push(null);
    const rounds = [];
    for (let r = 0; r < arr.length - 1; r++) {
      const m = [];
      for (let i = 0; i < arr.length / 2; i++) { const a = arr[i], b = arr[arr.length - 1 - i]; if (a && b) m.push(r % 2 ? [b, a] : [a, b]); }
      rounds.push(m); arr.splice(1, 0, arr.pop());
    }
    L.fixtures = rounds; L.round = 0;
    L.table = Object.fromEntries(ids.map(id => [id, { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }]));
    L.ss = { apps: 0, goals: 0, assists: 0, ratingSum: 0 }; L.rivalGoals = randi(9, 15);
    if (!first) { L.offers = L.offers.filter(o => o.season === L.season); }
  },
  myMatch(L) { const r = L.fixtures[L.round]; return r ? r.find(m => m[0] === L.clubId || m[1] === L.clubId) : null; },
  strength(id) { return teamRatings(TEAM_BY_ID[id]).ovr; },
  simScore(hid, aid) {
    const hs = this.strength(hid), as = this.strength(aid), pois = l => { let k = 0, p = Math.exp(-l), s = p, u = Math.random(); while (u > s && k < 9) { k++; p *= l / k; s += p; } return k; };
    return [pois(clamp(1.45 * Math.pow(hs / as, 3.2), 0.3, 4)), pois(clamp(1.1 * Math.pow(as / hs, 3.2), 0.2, 3.6))];
  },
  applyResult(L, h, a, hg, ag) {
    const th = L.table[h], ta = L.table[a]; th.p++; ta.p++; th.gf += hg; th.ga += ag; ta.gf += ag; ta.ga += hg;
    if (hg > ag) { th.w++; ta.l++; th.pts += 3; } else if (hg < ag) { ta.w++; th.l++; ta.pts += 3; } else { th.d++; ta.d++; th.pts++; ta.pts++; }
  },
  sorted(L) { return Object.entries(L.table).sort((a, b) => b[1].pts - a[1].pts || (b[1].gf - b[1].ga) - (a[1].gf - a[1].ga) || b[1].gf - a[1].gf); },
  matchCfg(L) {
    const m = this.myMatch(L); if (!m) return null;
    const side = m[0] === L.clubId ? 0 : 1, my = TEAM_BY_ID[L.clubId], op = TEAM_BY_ID[m[1 - side]];
    const info = this.info(L), roster = my.roster.concat([info]);
    const ct = UI.defaultTac(my, roster);
    if (!ct.xi.includes(roster.length - 1)) {
      const slots = FORMATIONS[ct.tac.formation]; let bi = 1, bp = 99;
      slots.forEach((s, i) => { if (s[0] === 'GK') return; const pen = posPenalty(info.pos, s[0]); if (pen < bp) { bp = pen; bi = i; } });
      ct.bench.push(ct.xi[bi]); ct.xi[bi] = roster.length - 1; ct.bench = ct.bench.filter(i => i !== roster.length - 1);
    }
    const ot = UI.defaultTac(op);
    const H = side === 0 ? ct : ot, A = side === 0 ? ot : ct;
    return { mode: 'legend', home: TEAM_BY_ID[m[0]], away: TEAM_BY_ID[m[1]], humanSide: side, legend: { side, id: 'legend' },
      homeTac: H.tac, awayTac: A.tac, homeXI: H.xi.map(i => H.roster[i]), awayXI: A.xi.map(i => A.roster[i]), homeBench: H.bench.map(i => H.roster[i]), awayBench: A.bench.map(i => A.roster[i]) };
  },
  play() {
    const L = this.data, cfg = this.matchCfg(L); if (!cfg) return;
    Sfx.init(); UI.hideAll(); Match.start(cfg);
  },
  // общий итог тура: результат игрока + остальные матчи
  finishRound(L, myScore, me) {
    const m = this.myMatch(L);
    for (const mm of L.fixtures[L.round]) {
      if (mm === m) this.applyResult(L, mm[0], mm[1], myScore[0], myScore[1]);
      else { const [x, y] = this.simScore(mm[0], mm[1]); this.applyResult(L, mm[0], mm[1], x, y); }
    }
    L.career.apps++; L.ss.apps++; L.career.goals += me.goals; L.ss.goals += me.goals; L.career.assists += me.assists; L.ss.assists += me.assists;
    L.career.ratingSum += me.rating; L.ss.ratingSum += me.rating; if (me.motm) L.career.motm++;
    const pts = Math.max(1, Math.floor((me.rating - 5.5) * 1.3) + me.goals + (me.motm ? 1 : 0));
    L.points += pts;
    const side = m[0] === L.clubId ? 0 : 1, gf = myScore[side], ga = myScore[1 - side];
    L.msg = `${gf > ga ? 'Победа' : gf === ga ? 'Ничья' : 'Поражение'} ${gf}:${ga}. Оценка ${me.rating.toFixed(1)}, ${me.goals} ${plural(me.goals, 'гол', 'гола', 'голов')}, ${me.assists} ${plural(me.assists, 'передача', 'передачи', 'передач')}. +${pts} ${plural(pts, 'очко', 'очка', 'очков')} развития.`;
    // предложения клубов
    const ovr = this.ovr(L), avgR = L.ss.ratingSum / L.ss.apps;
    if (Math.random() < 0.18 && avgR > 6.8 && L.offers.length < 3) {
      const cur = this.strength(L.clubId), cand = TEAMS.filter(t => t.id !== L.clubId && !L.offers.some(o => o.id === t.id) && this.strength(t.id) >= cur - 2 + (ovr > 80 ? 1 : 0));
      if (cand.length) { const t = pick(cand); L.offers.push({ id: t.id, season: L.season, wage: Math.round((ovr - 50) * 9 + rand(10, 60)) }); L.msg += ` ${t.name} интересуется вами!`; }
    }
    L.round++;
    if (L.round >= L.fixtures.length) this.endSeason(L);
    this.save();
    return pts;
  },
  endSeason(L) {
    const tbl = this.sorted(L), pos = tbl.findIndex(r => r[0] === L.clubId) + 1, label = this.season(L);
    const avg = L.ss.apps ? L.ss.ratingSum / L.ss.apps : 0, ovr = this.ovr(L), msgs = [];
    if (pos === 1) { L.career.trophies.push({ t: 'Чемпион лиги', s: label, club: TEAM_BY_ID[L.clubId].name }); msgs.push('Чемпионский титул!'); }
    if (L.ss.goals >= L.rivalGoals) { L.career.trophies.push({ t: 'Золотая бутса', s: label }); msgs.push(`Золотая бутса: ${L.ss.goals} ${plural(L.ss.goals, 'гол', 'гола', 'голов')}`); }
    if (avg >= 7.6) { L.career.trophies.push({ t: 'Игрок сезона', s: label }); msgs.push('Лучший игрок сезона'); }
    if (ovr >= 86 && (L.ss.goals + L.ss.assists >= 14 || avg >= 8) && (pos <= 2 || Math.random() < 0.3)) { L.career.trophies.push({ t: 'Золотой мяч', s: label }); msgs.push('ЗОЛОТОЙ МЯЧ!'); }
    L.age++; L.season++;
    const grow = L.age <= 21 ? [2, 5] : L.age <= 25 ? [1, 3] : L.age <= 29 ? [0, 1] : L.age <= 31 ? [-1, 0] : [-3, -1];
    for (const k of Object.keys(L.attr)) { let d = randi(grow[0], grow[1]); if (k === 'pac' && L.age > 29) d -= 1; L.attr[k] = clamp(L.attr[k] + d, 25, 99); }
    L.msg = `Сезон ${label} завершён: ${pos}-е место. ${msgs.join('. ')}${msgs.length ? '.' : ''} Вам ${L.age} ${plural(L.age, 'год', 'года', 'лет')}.`;
    const best = Store.get('legendBest', null);
    if (!best || L.career.goals > best.goals) Store.set('legendBest', { name: L.name, goals: L.career.goals, apps: L.career.apps, trophies: L.career.trophies.length });
    if (L.age >= 37) { L.retired = true; L.msg += ' Пришло время завершить карьеру. Спасибо за игру!'; }
    else this.newSeason(L, false);
  },
  afterMatch(res) {
    const L = this.data; if (!L) return '';
    const team = res.humanSide === 0 ? res.home : res.away;
    const p = team.players.find(q => q.isLegend) || null;
    const me = p ? { goals: p.stats.goals, assists: p.stats.assists, rating: p.stats.rating, motm: res.motm === p } : { goals: 0, assists: 0, rating: 6, motm: false };
    const pts = this.finishRound(L, [res.hs, res.as], me);
    return `<div class="rx new">Ваша оценка: <b>${me.rating.toFixed(1)}</b> · голы ${me.goals} · передачи ${me.assists}${me.motm ? ' · игрок матча' : ''} · +${pts} ${plural(pts, 'очко', 'очка', 'очков')} развития</div>`;
  },
  simulate() {
    const L = this.data, m = this.myMatch(L); if (!m) return;
    const [hg, ag] = this.simScore(m[0], m[1]), side = m[0] === L.clubId ? 0 : 1, gf = side ? ag : hg, ga = side ? hg : ag;
    const share = { ST: 0.34, W: 0.24, AM: 0.2, CM: 0.1, DM: 0.05, FB: 0.04, CB: 0.04 }[POS_GROUP[L.pos]] * (0.6 + this.ovr(L) / 160);
    let goals = 0, assists = 0; for (let i = 0; i < gf; i++) { const r = Math.random(); if (r < share) goals++; else if (r < share * 1.9) assists++; }
    const rating = clamp(6 + goals * 1 + assists * 0.6 + rand(-0.5, 0.9) + (gf > ga ? 0.4 : gf < ga ? -0.3 : 0) + (this.ovr(L) - 70) / 40, 4.5, 10);
    this.finishRound(L, [hg, ag], { goals, assists, rating, motm: rating >= 8.2 });
    this.renderHub(); Sfx.click();
  },
  // ---------- хаб ----------
  renderHub() {
    const L = this.data; if (!L) return;
    const team = TEAM_BY_ID[L.clubId];
    drawLegendCard($('lg-card'), L, team);
    $('lg-season').textContent = `Сезон ${this.season(L)} · ${L.age} ${plural(L.age, 'год', 'года', 'лет')} · ${team.name}`;
    $('lg-msg').textContent = L.msg || '';
    const m = this.myMatch(L);
    if (L.retired) {
      $('lg-next').innerHTML = `<div class="nx-k">Карьера завершена</div><div class="nx-t">${esc(L.name)}</div><div class="nx-s">${L.career.apps} матчей · ${L.career.goals} голов · ${L.career.trophies.length} трофеев</div>`;
      $('lg-play').disabled = true; $('lg-sim').disabled = true;
    } else if (m) {
      const h = TEAM_BY_ID[m[0]], a = TEAM_BY_ID[m[1]];
      $('lg-next').innerHTML = `<div class="nx-k">Тур ${L.round + 1} из ${L.fixtures.length}</div><div class="nx-t">${esc(h.name)} — ${esc(a.name)}</div><div class="nx-s">Стадион «${esc(h.stadium)}» · вы управляете только своим игроком</div>`;
      $('lg-play').disabled = false; $('lg-sim').disabled = false;
    }
    $('lg-play').onclick = () => this.play();
    $('lg-sim').onclick = () => this.simulate();
    const tbl = this.sorted(L);
    $('lg-table').innerHTML = `<table><thead><tr><th>#</th><th>Клуб</th><th class="n">И</th><th class="n">В</th><th class="n">Н</th><th class="n">П</th><th class="n">РМ</th><th class="n">О</th></tr></thead><tbody>${tbl.map(([id, r], i) => `<tr class="${id === L.clubId ? 'me' : ''}"><td>${i + 1}</td><td>${esc(TEAM_BY_ID[id].name)}</td><td class="n">${r.p}</td><td class="n">${r.w}</td><td class="n">${r.d}</td><td class="n">${r.l}</td><td class="n">${r.gf - r.ga}</td><td class="n"><b>${r.pts}</b></td></tr>`).join('')}</tbody></table>`;
    $('lg-tabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; this.tab = b.dataset.tab; UI.segOn($('lg-tabs'), b); this.renderTab(); };
    $('lg-tabs').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === this.tab));
    $('lg-delete').onclick = () => UI.confirm('Удалить карьеру «Легенды»? Прогресс будет потерян.', () => { Store.del('legend'); this.data = null; UI.show('scr-main', true); });
    this.renderTab();
  },
  cost(v) { return Math.max(1, Math.ceil((v - 55) / 9)); },
  renderTab() {
    const L = this.data, el = $('lg-tab-body');
    if (this.tab === 'train') {
      el.innerHTML = `<div class="points"><span>Очки развития</span><b>${L.points}</b></div>` + Object.keys(ATTR_RU).map(k => {
        const v = Math.round(L.attr[k]), c = this.cost(v);
        return `<div class="attr-row"><span>${ATTR_RU[k]} <small style="color:var(--mute)">· ${c} оч.</small></span><b>${v}</b><div class="attr-bar"><i style="width:${v}%"></i></div><button class="attr-plus" data-k="${k}" ${L.points < c || v >= 99 || L.retired ? 'disabled' : ''} aria-label="Улучшить: ${ATTR_RU[k]}">+</button></div>`;
      }).join('') + `<p style="color:var(--mute);font-size:13px;margin-top:10px">Общий рейтинг считается по позиции «${POS_NAME_RU[L.pos]}».</p>`;
      el.onclick = e => { const b = e.target.closest('.attr-plus'); if (!b) return; const k = b.dataset.k, c = this.cost(L.attr[k]); if (L.points >= c) { L.points -= c; L.attr[k] = Math.min(99, L.attr[k] + 1); this.save(); Sfx.click(); this.renderHub(); } };
    } else if (this.tab === 'stats') {
      const avg = (s, n) => n ? (s / n).toFixed(2) : '—';
      el.onclick = null;
      el.innerHTML = `<div class="field-label">Сезон ${this.season(L)}</div>
        <div class="rec-row"><span>Матчи</span><span>${L.ss.apps}</span></div><div class="rec-row"><span>Голы</span><span>${L.ss.goals}</span></div><div class="rec-row"><span>Передачи</span><span>${L.ss.assists}</span></div><div class="rec-row"><span>Средняя оценка</span><span>${avg(L.ss.ratingSum, L.ss.apps)}</span></div>
        <div class="field-label" style="margin-top:14px">Карьера</div>
        <div class="rec-row"><span>Матчи</span><span>${L.career.apps}</span></div><div class="rec-row"><span>Голы</span><span>${L.career.goals}</span></div><div class="rec-row"><span>Передачи</span><span>${L.career.assists}</span></div><div class="rec-row"><span>Игрок матча</span><span>${L.career.motm}</span></div><div class="rec-row"><span>Средняя оценка</span><span>${avg(L.career.ratingSum, L.career.apps)}</span></div>`;
    } else if (this.tab === 'offers') {
      el.innerHTML = L.offers.length ? L.offers.map((o, i) => `<div class="offer"><div><b>${esc(TEAM_BY_ID[o.id].name)}</b><small>Зарплата ≈ ${o.wage} тыс. € в неделю · рейтинг клуба ${this.strength(o.id)}</small></div><button class="btn small primary" data-i="${i}" ${L.retired ? 'disabled' : ''}>Перейти</button></div>`).join('') : '<p style="color:var(--mute)">Предложений пока нет. Хорошая игра (оценка выше 6.8) привлекает внимание топ-клубов.</p>';
      el.onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; const o = L.offers[Number(b.dataset.i)]; UI.confirm(`Перейти в ${TEAM_BY_ID[o.id].name}?`, () => { L.clubId = o.id; L.offers = []; L.msg = `Трансфер завершён! Теперь вы игрок клуба ${TEAM_BY_ID[o.id].name}.`; this.save(); this.renderHub(); }); };
    } else {
      el.onclick = null;
      el.innerHTML = L.career.trophies.length ? L.career.trophies.map(t => `<div class="trophy"><i></i><div><b>${esc(t.t)}</b><br><small style="color:var(--mute)">${esc(t.s)}${t.club ? ' · ' + esc(t.club) : ''}</small></div></div>`).join('') : '<p style="color:var(--mute)">Трофеев пока нет. Выиграйте лигу или станьте лучшим бомбардиром сезона.</p>';
    }
  }
};

// ============================ ЗАПУСК ============================
function startDemo() {
  const a = randi(0, TEAMS.length - 1); let b = randi(0, TEAMS.length - 2); if (b >= a) b++;
  const ta = UI.defaultTac(TEAMS[a]), tb = UI.defaultTac(TEAMS[b]);
  Match.start({ mode: 'demo', home: TEAMS[a], away: TEAMS[b], humanSide: -1, homeTac: ta.tac, awayTac: tb.tac, homeXI: ta.xi.map(i => ta.roster[i]), awayXI: tb.xi.map(i => tb.roster[i]), homeBench: [], awayBench: [], skipIntro: true, halfLen: 999 });
}
let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000)); lastT = now;
  try {
    Input.poll();
    if (Match.active) Match.update(dt);
    Cam.update(dt);
    FX.update(dt);
    Render.frame(now / 1000);
    UI.tick(dt);
  } catch (err) { console.error(err); }
  Input.endFrame();
  requestAnimationFrame(loop);
}
function boot() {
  resize(); Cam.basis(); Input.init(); UI.init(); startDemo();
  document.addEventListener('pointerdown', () => Sfx.init(), { once: true });
  requestAnimationFrame(loop);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
