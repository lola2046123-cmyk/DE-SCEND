/**
 * Elevator Rush — AudioEngine
 *
 * 完整的 Web Audio API 路由图。当前所有插槽 gain = 0（静音），
 * 但图结构已建立；调用 loadSlot(name, arrayBuffer) 即可激活任意槽位。
 *
 * 插槽命名与游戏事件的映射关系已在 SLOT_MAP_* 中文档化，
 * 方便后期音效设计师直接对号入座。
 */

(function (global) {
  'use strict';

  /* =====================================================================
   * 插槽注册表
   * ===================================================================== */

  /**
   * 所有具名插槽。
   * 每个插槽 = 一个独立 GainNode（挂在 masterGain 下），
   * 可独立调音量、可挂 effect chain（compressor / reverb 等）。
   */
  var SLOTS = [
    'IDLE',         // 待机氛围音
    'ASCENDING',    // 上升机械声
    'DOOR_OPEN',    // 门滑开金属声
    'DOOR_CLOSE',   // 门合拢撞击
    'BOOM',         // 爆炸 / 死亡
    'POSITIVE',     // 正面增益
    'NEGATIVE',     // 负面减损
    'DOUBLE',       // ×2 超现实
    'CASH_OUT',     // 结算撤离
    'COIN_RAIN',    // 金币雨
    'SKIP_FLOOR'    // 跳层闪光
  ];

  /**
   * 状态转换 → 插槽名映射。
   * key 格式："{from}→{to}"，from 为 null 时写 "null"。
   */
  var SLOT_MAP_TRANSITIONS = {
    'null→IDLE':           'IDLE',
    'IDLE→ASCENDING':      'ASCENDING',
    'DECIDING→ASCENDING':  'ASCENDING',
    'EVALUATING→REVEALING':'DOOR_OPEN',
    'REVEALING→DECIDING':  null,
    'REVEALING→GAME_OVER': 'BOOM',
    'GAME_OVER→IDLE':      'IDLE',
    'DECIDING→CASHED_OUT': 'CASH_OUT',
    'CASHED_OUT→IDLE':     'IDLE'
  };

  /** 主事件结果 → 插槽名 */
  var SLOT_MAP_OUTCOMES = {
    BOOM:     'BOOM',
    DOUBLE:   'DOUBLE',
    POSITIVE: 'POSITIVE',
    NEGATIVE: 'NEGATIVE'
  };

  /** SurpriseEvent.kind → 插槽名 */
  var SLOT_MAP_SURPRISE = {
    COIN_RAIN:  'COIN_RAIN',
    SKIP_FLOOR: 'SKIP_FLOOR'
  };

  /* =====================================================================
   * AudioEngine
   * ===================================================================== */

  function AudioEngine() {
    this._ctx    = null;
    this._master = null;
    this._slots  = {};
    this._ready  = false;
    this._log    = [];
  }

  AudioEngine.SLOTS               = SLOTS;
  AudioEngine.SLOT_MAP_TRANSITIONS = SLOT_MAP_TRANSITIONS;
  AudioEngine.SLOT_MAP_OUTCOMES    = SLOT_MAP_OUTCOMES;
  AudioEngine.SLOT_MAP_SURPRISE    = SLOT_MAP_SURPRISE;

  /**
   * 背景音乐 / 音频素材路径（相对放置 elevator-rush-demo.html 的目录）
   * 将文件放入 assets/audio/bgm/ 后，可用 fetch + loadSlot 接入 Web Audio。
   */
  AudioEngine.ASSET_PATHS = {
    BGM_DIR: 'assets/audio/bgm',
    /** 主循环 BGM（预留；可改为 .ogg / .m4a 并同步修改此处） */
    BGM_MAIN_LOOP: 'assets/audio/bgm/main-loop.mp3'
  };

  /* ---- 初始化（惰性，首次用户交互后调用） ---- */

  AudioEngine.prototype._ensureContext = function () {
    if (this._ctx) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) { console.warn('[AudioEngine] Web Audio API not supported'); return; }

      this._ctx = new Ctx();

      /* Master gain → Compressor → destination（保护扬声器） */
      var limiter = this._ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value      = 3;
      limiter.ratio.value     = 20;
      limiter.attack.value    = 0.002;
      limiter.release.value   = 0.1;
      limiter.connect(this._ctx.destination);

      this._master = this._ctx.createGain();
      this._master.gain.value = 0.85;
      this._master.connect(limiter);

      /* 为每个插槽建立独立 GainNode，初始静音 */
      for (var i = 0; i < SLOTS.length; i++) {
        var slotName = SLOTS[i];
        var g = this._ctx.createGain();
        g.gain.value = 0;   // 静音，等待 loadSlot 激活
        g.connect(this._master);
        this._slots[slotName] = { gainNode: g, buffer: null };
      }

      this._ready = true;
    } catch (e) {
      console.warn('[AudioEngine] init failed:', e);
    }
  };

  /* ---- 公开 API ---- */

  /**
   * 解除浏览器 AudioContext 自动暂停。
   * 由 GameController.startAscend 触发，确保首次交互前不输出声音。
   */
  AudioEngine.prototype.resumeIfNeeded = function () {
    this._ensureContext();
    if (this._ctx && this._ctx.state === 'suspended') {
      this._ctx.resume().catch(function () {});
    }
  };

  /**
   * 向具名插槽加载音频数据。
   * @param {string}      slotName    SLOTS 中的名称
   * @param {ArrayBuffer} arrayBuffer fetch() 拿到的原始音频字节
   * @param {number}      [volume=1]  解码后该插槽的音量
   * @returns {Promise<void>}
   */
  AudioEngine.prototype.loadSlot = function (slotName, arrayBuffer, volume) {
    var self = this;
    this._ensureContext();
    if (!this._ctx) return Promise.reject(new Error('AudioContext unavailable'));
    if (!this._slots[slotName]) return Promise.reject(new Error('Unknown slot: ' + slotName));

    return new Promise(function (resolve, reject) {
      self._ctx.decodeAudioData(arrayBuffer, function (buffer) {
        self._slots[slotName].buffer = buffer;
        self._slots[slotName].gainNode.gain.value = (typeof volume === 'number') ? volume : 1;
        resolve();
      }, reject);
    });
  };

  /**
   * 运行时调节插槽音量（0–1）。
   * 可用于随贪婪系数动态增益（例如 ASCENDING 音量随楼层升高）。
   */
  AudioEngine.prototype.setSlotVolume = function (slotName, volume) {
    var slot = this._slots[slotName];
    if (!slot) return;
    if (this._ctx) {
      slot.gainNode.gain.setTargetAtTime(volume, this._ctx.currentTime, 0.05);
    } else {
      slot.gainNode && (slot.gainNode.gain.value = volume);
    }
  };

  /**
   * 获取插槽信息（调试用）。
   * @returns {{ name, hasBuffer, volume }[]}
   */
  AudioEngine.prototype.inspect = function () {
    return SLOTS.map(function (name) {
      var slot = this._slots[name];
      return {
        name:      name,
        hasBuffer: slot ? !!slot.buffer : false,
        volume:    slot ? slot.gainNode.gain.value : 0
      };
    }, this);
  };

  /* ---- 内部播放 ---- */

  AudioEngine.prototype._playSlot = function (slotName) {
    var entry = { t: Date.now(), slot: slotName, played: false };
    this._log.push(entry);
    if (this._log.length > 200) this._log.shift();

    var slot = this._slots[slotName];
    if (!slot || !slot.buffer || !this._ctx) return;
    if (this._ctx.state === 'suspended') return;

    try {
      var src = this._ctx.createBufferSource();
      src.buffer = slot.buffer;
      src.connect(slot.gainNode);
      src.start(0);
      entry.played = true;
    } catch (e) {
      console.warn('[AudioEngine] playSlot error:', slotName, e);
    }
  };

  /* ---- GameController 接口（与 createAudioStub 同签名） ---- */

  /**
   * 由 GameController._emitState 调用。
   * @param {string|null} from  上一个 STATES 值（首次为 null）
   * @param {string}      to    下一个 STATES 值
   */
  AudioEngine.prototype.playStateTransition = function (from, to) {
    var key = (from === null ? 'null' : from) + '→' + to;
    var slotName = SLOT_MAP_TRANSITIONS[key];
    if (slotName) this._playSlot(slotName);
  };

  /**
   * 由 GameController._emitOutcome 调用。
   * @param {string} kind  'BOOM' | 'DOUBLE' | 'POSITIVE' | 'NEGATIVE'
   */
  AudioEngine.prototype.playOutcome = function (kind) {
    var slotName = SLOT_MAP_OUTCOMES[kind];
    if (slotName) this._playSlot(slotName);
  };

  /**
   * 由 UI 层在 SurpriseEvent 视觉动画触发时调用（GameController 已派发 _emitSurprise）。
   * @param {string} kind  'COIN_RAIN' | 'SKIP_FLOOR'
   */
  AudioEngine.prototype.playSurprise = function (kind) {
    var slotName = SLOT_MAP_SURPRISE[kind];
    if (slotName) this._playSlot(slotName);
  };

  /**
   * UI 层可选触发：若该插槽已 loadSlot 则播放，否则静默。
   * 用于开场授权、过场等尚未绑定状态机的事件。
   */
  AudioEngine.prototype.tryPlaySlot = function (slotName) {
    this.resumeIfNeeded();
    this._playSlot(slotName);
  };

  /**
   * 委员会指令 / 终端行：短促低频脉冲（不依赖 loadSlot）。
   * 若上下文未启动或仍 suspended，静默跳过。
   */
  AudioEngine.prototype.playCommitteePulse = function () {
    this.resumeIfNeeded();
    if (!this._ctx || !this._master) return;
    if (this._ctx.state === 'suspended') return;
    try {
      var t0 = this._ctx.currentTime;
      var o  = this._ctx.createOscillator();
      var g  = this._ctx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(88, t0);
      o.frequency.exponentialRampToValueAtTime(42, t0 + 0.08);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.038, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
      o.connect(g);
      g.connect(this._master);
      o.start(t0);
      o.stop(t0 + 0.15);
    } catch (e) {
      console.warn('[AudioEngine] playCommitteePulse:', e);
    }
  };

  /**
   * 手动加固 / 断路器拉杆：粗重机械回弹 + 金属摩擦感（不依赖 loadSlot）。
   */
  AudioEngine.prototype.playLeverPull = function () {
    this.resumeIfNeeded();
    if (!this._ctx || !this._master) return;
    if (this._ctx.state === 'suspended') return;
    try {
      var ctx = this._ctx;
      var t0  = ctx.currentTime;
      var master = this._master;

      /* 主冲程：快速下拉再回弹（锯齿 + 低通） */
      var o1 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.setValueAtTime(95, t0);
      o1.frequency.exponentialRampToValueAtTime(38, t0 + 0.09);
      o1.frequency.exponentialRampToValueAtTime(72, t0 + 0.22);
      var g1 = ctx.createGain();
      var f1 = ctx.createBiquadFilter();
      f1.type = 'lowpass';
      f1.frequency.setValueAtTime(420, t0);
      f1.frequency.exponentialRampToValueAtTime(1800, t0 + 0.05);
      f1.frequency.exponentialRampToValueAtTime(320, t0 + 0.2);
      g1.gain.setValueAtTime(0.0001, t0);
      g1.gain.exponentialRampToValueAtTime(0.11, t0 + 0.02);
      g1.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      o1.connect(f1);
      f1.connect(g1);
      g1.connect(master);
      o1.start(t0);
      o1.stop(t0 + 0.3);

      /* 撞击止点 */
      var o2 = ctx.createOscillator();
      o2.type = 'square';
      o2.frequency.setValueAtTime(55, t0 + 0.08);
      o2.frequency.exponentialRampToValueAtTime(28, t0 + 0.11);
      var g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.0001, t0 + 0.078);
      g2.gain.exponentialRampToValueAtTime(0.055, t0 + 0.085);
      g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
      o2.connect(g2);
      g2.connect(master);
      o2.start(t0 + 0.078);
      o2.stop(t0 + 0.14);

      /* 高频摩擦碎音 */
      var len = Math.floor(ctx.sampleRate * 0.12);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      var i;
      for (i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * (1 - i / len) * 0.35;
      }
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var g3 = ctx.createGain();
      g3.gain.setValueAtTime(0.0001, t0 + 0.04);
      g3.gain.exponentialRampToValueAtTime(0.045, t0 + 0.055);
      g3.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      var f3 = ctx.createBiquadFilter();
      f3.type = 'bandpass';
      f3.frequency.value = 2400;
      f3.Q.value = 0.7;
      src.connect(f3);
      f3.connect(g3);
      g3.connect(master);
      src.start(t0 + 0.04);
      src.stop(t0 + 0.18);
    } catch (e) {
      console.warn('[AudioEngine] playLeverPull:', e);
    }
  };

  global.AudioEngine = AudioEngine;
})(typeof window !== 'undefined' ? window : globalThis);
