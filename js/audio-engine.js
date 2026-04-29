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
    'IDLE',          // 待机氛围音
    'ASCENDING',     // 上升机械声
    'DOOR_OPEN',     // 门滑开金属声
    'DOOR_CLOSE',    // 门合拢撞击
    'LIQUIDATION',   // 强制清算 / 破产带
    'POSITIVE',      // 正面增益
    'NEGATIVE',      // 负面减损
    'DOUBLE',        // ×2 超现实
    'CASH_OUT',      // 结算撤离
    'COIN_RAIN',     // 金币雨
    'SKIP_FLOOR',    // 跳层闪光
    'QUOTA_REACHED', // 配额达成：神圣解锁叮声（净资产从负转正时触发）
    'BREACH'         // Hiss 入侵警报
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
    'REVEALING→GAME_OVER': 'LIQUIDATION',
    'GAME_OVER→IDLE':      'IDLE',
    'DECIDING→CASHED_OUT': 'CASH_OUT',
    'CASHED_OUT→IDLE':     'IDLE'
  };

  /** 主事件结果 → 插槽名 */
  var SLOT_MAP_OUTCOMES = {
    LIQUIDATION: 'LIQUIDATION',
    DOUBLE:   'DOUBLE',
    POSITIVE: 'POSITIVE',
    NEGATIVE: 'NEGATIVE'
  };

  /** SurpriseEvent.kind → 插槽名 */
  var SLOT_MAP_SURPRISE = {
    COIN_RAIN:  'COIN_RAIN',
    SKIP_FLOOR: 'SKIP_FLOOR'
  };

  /**
   * BGM 专属插槽：这些插槽经由低通滤波器总线输出；
   * 其余 SFX 插槽直连 master，完全绕过滤波器。
   */
  var BGM_SLOTS = ['IDLE', 'ASCENDING'];

  /* =====================================================================
   * AudioEngine
   * ===================================================================== */

  function AudioEngine() {
    this._ctx       = null;
    this._master    = null;
    this._bgmFilter = null;   /* BiquadFilterNode (lowpass)，仅 BGM 总线使用 */
    this._bgmBus    = null;   /* GainNode，BGM 总线音量 */
    this._bgmDimmed = false;
    this._bgmMuted  = false;  /* 仅 BGM 总线静音（保留 SFX） */
    this._muted     = false;  /* 主总线静音（关闭模式） */
    this._slots     = {};
    this._ready     = false;
    this._log       = [];
  }

  /** 主总线常态音量；静音切换时作为还原目标。 */
  AudioEngine.MASTER_LEVEL = 0.85;

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
    BGM_MAIN_LOOP: 'assets/audio/bgm/main-loop3.mp3'
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
      this._master.gain.value = this._muted ? 0.0001 : AudioEngine.MASTER_LEVEL;
      this._master.connect(limiter);

      /*
       * BGM 总线：BGM 插槽 → bgmFilter (lowpass) → bgmBus → master
       * SFX 插槽直连 master，完全绕过滤波器，保持清脆穿透力。
       */
      this._bgmFilter = this._ctx.createBiquadFilter();
      this._bgmFilter.type = 'lowpass';
      this._bgmFilter.frequency.value = 20000; /* 初始极高截止 ≈ 全频旁通 */
      this._bgmFilter.Q.value = 0.7;

      this._bgmBus = this._ctx.createGain();
      this._bgmBus.gain.value = 1.0;

      this._bgmFilter.connect(this._bgmBus);
      this._bgmBus.connect(this._master);

      /* 若在 Context 就绪前已设置降维或静音状态，立即应用 */
      if (this._bgmMuted) {
        this._bgmBus.gain.value = 0.0001;
      } else if (this._bgmDimmed) {
        this._bgmFilter.frequency.value = 400;
        this._bgmBus.gain.value = 0.3;
      }

      /* 为每个插槽建立独立 GainNode，初始静音；BGM 插槽走 bgmFilter 总线 */
      for (var i = 0; i < SLOTS.length; i++) {
        var slotName = SLOTS[i];
        var g = this._ctx.createGain();
        g.gain.value = 0;
        var isBgmSlot = BGM_SLOTS.indexOf(slotName) >= 0;
        g.connect(isBgmSlot ? this._bgmFilter : this._master);
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
   * @param {string} kind  'LIQUIDATION' | 'DOUBLE' | 'POSITIVE' | 'NEGATIVE'
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
   * v0.06：HUD 主按钮（▲ 上行 / ▼ 撤离）按下瞬间的金属脆响。
   * 设计要点：
   *   - 极短（≈110 ms），不阻塞后续 deployImpact / cashOut 的次级音效；
   *   - 中频金属脆响（叮 + 极短余韵），与 leverPull 的"机械下拉"形成层次区分；
   *   - kind 参数：'deploy' 偏暖（700→520 Hz，红铜质感）；'withdraw' 偏冷亮
   *     （820→640 Hz，黄铜质感）；其它默认中性。
   */
  AudioEngine.prototype.playMetalTap = function (kind) {
    this.resumeIfNeeded();
    if (!this._ctx || !this._master) return;
    if (this._ctx.state === 'suspended') return;
    try {
      var ctx = this._ctx;
      var t0  = ctx.currentTime;
      var master = this._master;

      var fStart = 760, fEnd = 580;
      if (kind === 'deploy')   { fStart = 700; fEnd = 520; }
      else if (kind === 'withdraw') { fStart = 820; fEnd = 640; }

      /* 主体：三角波叮响 + 高通去掉低频闷感 */
      var o1 = ctx.createOscillator();
      o1.type = 'triangle';
      o1.frequency.setValueAtTime(fStart, t0);
      o1.frequency.exponentialRampToValueAtTime(fEnd, t0 + 0.07);
      var g1 = ctx.createGain();
      g1.gain.setValueAtTime(0.0001, t0);
      g1.gain.exponentialRampToValueAtTime(0.085, t0 + 0.008);
      g1.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
      var hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 320;
      o1.connect(hp);
      hp.connect(g1);
      g1.connect(master);
      o1.start(t0);
      o1.stop(t0 + 0.13);

      /* 顶端泛音：让"叮"更有金属感，4× 倍频极短 */
      var o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.setValueAtTime(fStart * 2.6, t0);
      var g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.0001, t0);
      g2.gain.exponentialRampToValueAtTime(0.04, t0 + 0.005);
      g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
      o2.connect(g2);
      g2.connect(master);
      o2.start(t0);
      o2.stop(t0 + 0.07);

      /* 触感前导：极轻的碎音点击，模拟手指接触金属面 */
      var len = Math.floor(ctx.sampleRate * 0.012);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * (1 - i / len) * 0.5;
      }
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var g3 = ctx.createGain();
      g3.gain.setValueAtTime(0.022, t0);
      g3.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.013);
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3600;
      bp.Q.value = 0.6;
      src.connect(bp);
      bp.connect(g3);
      g3.connect(master);
      src.start(t0);
      src.stop(t0 + 0.014);
    } catch (e) {
      console.warn('[AudioEngine] playMetalTap:', e);
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

  /**
   * Hiss Breach 入侵警报：低频共鸣 + 高频刺激（不依赖 loadSlot）。
   */
  AudioEngine.prototype.playBreach = function () {
    this.resumeIfNeeded();
    if (!this._ctx || !this._master) return;
    if (this._ctx.state === 'suspended') return;
    try {
      var ctx = this._ctx;
      var master = this._master;
      var t0 = ctx.currentTime;

      /* 低频警报律动 */
      var o1 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.setValueAtTime(55, t0);
      o1.frequency.setValueAtTime(62, t0 + 0.08);
      o1.frequency.setValueAtTime(55, t0 + 0.16);
      var g1 = ctx.createGain();
      g1.gain.setValueAtTime(0.0001, t0);
      g1.gain.exponentialRampToValueAtTime(0.055, t0 + 0.03);
      g1.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      o1.connect(g1);
      g1.connect(master);
      o1.start(t0);
      o1.stop(t0 + 0.4);

      /* 高频刺激 */
      var o2 = ctx.createOscillator();
      o2.type = 'square';
      o2.frequency.setValueAtTime(1200, t0 + 0.06);
      o2.frequency.exponentialRampToValueAtTime(900, t0 + 0.25);
      var g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.0001, t0 + 0.058);
      g2.gain.exponentialRampToValueAtTime(0.028, t0 + 0.07);
      g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      o2.connect(g2);
      g2.connect(master);
      o2.start(t0 + 0.058);
      o2.stop(t0 + 0.35);
    } catch (e) {
      console.warn('[AudioEngine] playBreach:', e);
    }
  };

  /**
   * 配额达成——神圣解锁叮声：清脆高频铃声 + 泛音 + 自然延迟余韵。
   * 触发条件：净资产首次从负转正（由 GameController 调用）。
   */
  AudioEngine.prototype.playQuotaReached = function () {
    this.resumeIfNeeded();
    if (!this._ctx || !this._master) return;
    if (this._ctx.state === 'suspended') return;
    try {
      var ctx = this._ctx;
      var master = this._master;
      var t0 = ctx.currentTime;

      /* 主音 A6（1760 Hz）—— 清亮基音，长衰减 */
      var o1 = ctx.createOscillator();
      o1.type = 'sine';
      o1.frequency.setValueAtTime(1760, t0);
      o1.frequency.exponentialRampToValueAtTime(1752, t0 + 2.0);
      var g1 = ctx.createGain();
      g1.gain.setValueAtTime(0.0001, t0);
      g1.gain.exponentialRampToValueAtTime(0.20, t0 + 0.004);  /* 极快启音 */
      g1.gain.exponentialRampToValueAtTime(0.07, t0 + 0.35);
      g1.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.4);
      o1.connect(g1);
      g1.connect(master);
      o1.start(t0);
      o1.stop(t0 + 2.6);

      /* 五度泛音 E7（2637 Hz）—— 谐波共鸣 */
      var o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.setValueAtTime(2637, t0);
      var g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.0001, t0);
      g2.gain.exponentialRampToValueAtTime(0.10, t0 + 0.003);
      g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.2);
      o2.connect(g2);
      g2.connect(master);
      o2.start(t0);
      o2.stop(t0 + 1.4);

      /* 八度确认音 A5（880 Hz）—— 低一层支撑 */
      var o3 = ctx.createOscillator();
      o3.type = 'sine';
      o3.frequency.setValueAtTime(880, t0);
      var g3 = ctx.createGain();
      g3.gain.setValueAtTime(0.0001, t0);
      g3.gain.exponentialRampToValueAtTime(0.12, t0 + 0.005);
      g3.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
      o3.connect(g3);
      g3.connect(master);
      o3.start(t0);
      o3.stop(t0 + 1.1);

      /* 延迟余韵（模拟铃声在空旷机械厅的反射） */
      var delay = ctx.createDelay(0.5);
      delay.delayTime.value = 0.22;
      var dfb = ctx.createGain();
      dfb.gain.value = 0.30;
      var dout = ctx.createGain();
      dout.gain.value = 0.14;
      g1.connect(delay);
      delay.connect(dfb);
      dfb.connect(delay);
      delay.connect(dout);
      dout.connect(master);

    } catch (e) {
      console.warn('[AudioEngine] playQuotaReached:', e);
    }
  };

  /**
   * BGM 降维/沉浸状态切换。
   *
   * 仅操纵 BGM 总线（bgmFilter 截止频率 + bgmBus 音量），
   * SFX 插槽与所有程序音效直连 master，完全不受影响，保持清脆穿透力。
   *
   * 使用 cancelScheduledValues + setValueAtTime + linearRampToValueAtTime
   * 三步确保任意状态下切换都平滑无爆音（Safari 兼容）。
   *
   * @param {boolean} dimmed  true = 降维（低通 400 Hz，音量 30%）
   */
  AudioEngine.prototype.setBgmDimmed = function (dimmed) {
    this._bgmDimmed = !!dimmed;
    if (!this._ctx || !this._bgmFilter || !this._bgmBus) return;
    var t0      = this._ctx.currentTime;
    var rampEnd = t0 + 0.55;

    this._bgmFilter.frequency.cancelScheduledValues(t0);
    this._bgmFilter.frequency.setValueAtTime(this._bgmFilter.frequency.value, t0);
    this._bgmBus.gain.cancelScheduledValues(t0);
    this._bgmBus.gain.setValueAtTime(this._bgmBus.gain.value, t0);

    if (dimmed) {
      this._bgmFilter.frequency.linearRampToValueAtTime(400,   rampEnd);
      this._bgmBus.gain.linearRampToValueAtTime(0.3, rampEnd);
    } else {
      this._bgmFilter.frequency.linearRampToValueAtTime(20000, rampEnd);
      this._bgmBus.gain.linearRampToValueAtTime(1.0, rampEnd);
    }
  };

  /** @returns {boolean} */
  AudioEngine.prototype.isBgmDimmed = function () {
    return this._bgmDimmed;
  };

  /**
   * 主总线静音/取消静音（关闭模式）。
   *
   * 与 BGM 降维不同，本方法直接调节 master 输出电平，
   * 因此对所有插槽（BGM + SFX）以及 playCommitteePulse / playLeverPull 等
   * 程序化音效都生效。Context 尚未就绪时仅记录意图，待 _ensureContext 应用。
   *
   * @param {boolean} muted  true = 关闭（master 趋零）
   */
  AudioEngine.prototype.setMasterMuted = function (muted) {
    this._muted = !!muted;
    if (!this._ctx || !this._master) return;
    var t0      = this._ctx.currentTime;
    var rampEnd = t0 + 0.18;
    this._master.gain.cancelScheduledValues(t0);
    this._master.gain.setValueAtTime(this._master.gain.value, t0);
    this._master.gain.linearRampToValueAtTime(
      this._muted ? 0.0001 : AudioEngine.MASTER_LEVEL,
      rampEnd
    );
  };

  /** @returns {boolean} */
  AudioEngine.prototype.isMasterMuted = function () {
    return !!this._muted;
  };

  /**
   * 仅静音 BGM 总线（保留 SFX 与所有程序化音效）。
   * 与 setBgmDimmed / setMasterMuted 互斥使用：
   *   - setMasterMuted(true)  会让所有声音消失（包括 SFX）
   *   - setBgmMuted(true)     只让 BGM 消失，SFX 一切照旧
   *
   * @param {boolean} muted  true = 静音 BGM；false = 还原 BGM 总线
   */
  AudioEngine.prototype.setBgmMuted = function (muted) {
    this._bgmMuted = !!muted;
    if (!this._ctx || !this._bgmBus) return;
    var t0      = this._ctx.currentTime;
    var rampEnd = t0 + 0.22;
    this._bgmBus.gain.cancelScheduledValues(t0);
    this._bgmBus.gain.setValueAtTime(this._bgmBus.gain.value, t0);
    /* 还原时若处于"降维"状态，回到 0.3；否则回到 1.0 */
    var restored = this._bgmDimmed ? 0.3 : 1.0;
    this._bgmBus.gain.linearRampToValueAtTime(this._bgmMuted ? 0.0001 : restored, rampEnd);
  };

  /** @returns {boolean} */
  AudioEngine.prototype.isBgmMuted = function () {
    return !!this._bgmMuted;
  };

  /* =====================================================================
   * 选盘 / 货舱 SFX —— 直连 master，不进 BGM 总线
   * ===================================================================== */

  /**
   * 选盘浮层弹出：金属插销轻响 + 低空悬念长音。
   */
  AudioEngine.prototype.playLockerSelectionEnter = function () {
    this.resumeIfNeeded();
    if (!this._ctx || !this._master) return;
    if (this._ctx.state === 'suspended') return;
    try {
      var ctx = this._ctx;
      var master = this._master;
      var t0 = ctx.currentTime;

      /* 上闩"咔" */
      var click = ctx.createOscillator();
      click.type = 'square';
      click.frequency.setValueAtTime(1480, t0);
      click.frequency.exponentialRampToValueAtTime(880, t0 + 0.04);
      var cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t0);
      cg.gain.exponentialRampToValueAtTime(0.06, t0 + 0.005);
      cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
      click.connect(cg); cg.connect(master);
      click.start(t0); click.stop(t0 + 0.07);

      /* 悬念长音：低频 sine 缓慢推升 */
      var pad = ctx.createOscillator();
      pad.type = 'sine';
      pad.frequency.setValueAtTime(146, t0 + 0.04);
      pad.frequency.linearRampToValueAtTime(196, t0 + 0.5);
      var pg = ctx.createGain();
      pg.gain.setValueAtTime(0.0001, t0 + 0.04);
      pg.gain.linearRampToValueAtTime(0.045, t0 + 0.18);
      pg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.78);
      pad.connect(pg); pg.connect(master);
      pad.start(t0 + 0.04); pad.stop(t0 + 0.8);
    } catch (e) {
      console.warn('[AudioEngine] playLockerSelectionEnter:', e);
    }
  };

  /**
   * 玩家点选某柜：滑动金属 + 锁芯解锁 click。
   */
  AudioEngine.prototype.playLockerOpen = function () {
    this.resumeIfNeeded();
    if (!this._ctx || !this._master) return;
    if (this._ctx.state === 'suspended') return;
    try {
      var ctx = this._ctx;
      var master = this._master;
      var t0 = ctx.currentTime;

      /* 解锁 click */
      var click = ctx.createOscillator();
      click.type = 'square';
      click.frequency.setValueAtTime(720, t0);
      click.frequency.exponentialRampToValueAtTime(380, t0 + 0.05);
      var cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t0);
      cg.gain.exponentialRampToValueAtTime(0.085, t0 + 0.005);
      cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
      click.connect(cg); cg.connect(master);
      click.start(t0); click.stop(t0 + 0.08);

      /* 滑动金属：白噪 → bandpass 扫频 */
      var len = Math.floor(ctx.sampleRate * 0.18);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * (1 - i / len) * 0.9;
      }
      var src = ctx.createBufferSource(); src.buffer = buf;
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(900, t0 + 0.04);
      bp.frequency.exponentialRampToValueAtTime(2400, t0 + 0.2);
      var sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t0 + 0.04);
      sg.gain.exponentialRampToValueAtTime(0.07, t0 + 0.07);
      sg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      src.connect(bp); bp.connect(sg); sg.connect(master);
      src.start(t0 + 0.04); src.stop(t0 + 0.24);

      /* 共鸣 ping */
      var ping = ctx.createOscillator();
      ping.type = 'triangle';
      ping.frequency.setValueAtTime(660, t0 + 0.18);
      var pg = ctx.createGain();
      pg.gain.setValueAtTime(0.0001, t0 + 0.18);
      pg.gain.exponentialRampToValueAtTime(0.04, t0 + 0.19);
      pg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);
      ping.connect(pg); pg.connect(master);
      ping.start(t0 + 0.18); ping.stop(t0 + 0.45);
    } catch (e) {
      console.warn('[AudioEngine] playLockerOpen:', e);
    }
  };

  /**
   * 倒计时进入恐慌段：单次心跳重音（建议进入 panic 时一次性触发）。
   */
  AudioEngine.prototype.playLockerPanic = function () {
    this.resumeIfNeeded();
    if (!this._ctx || !this._master) return;
    if (this._ctx.state === 'suspended') return;
    try {
      var ctx = this._ctx;
      var master = this._master;
      var t0 = ctx.currentTime;

      function thump(at, peak) {
        var o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(120, at);
        o.frequency.exponentialRampToValueAtTime(58, at + 0.12);
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(peak, at + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
        o.connect(g); g.connect(master);
        o.start(at); o.stop(at + 0.15);
      }
      thump(t0,        0.085);
      thump(t0 + 0.18, 0.07);
    } catch (e) {
      console.warn('[AudioEngine] playLockerPanic:', e);
    }
  };

  /**
   * FBC 代决议盖章：低沉冲击 + 公文章戳 + 阴森余音。
   *
   * v0.07.2：加入 playbackRate 微随机化（0.95×–1.05×）。
   *   - noise BufferSource 直接设置 src.playbackRate；
   *   - oscillator 以相同比例缩放 frequency，等效于 playbackRate 偏移；
   *   - 连续触发时每次音色轻微偏移，避免机械重复感。
   */
  AudioEngine.prototype.playFbcOverrideStamp = function () {
    this.resumeIfNeeded();
    if (!this._ctx || !this._master) return;
    if (this._ctx.state === 'suspended') return;
    try {
      var ctx = this._ctx;
      var master = this._master;
      var t0 = ctx.currentTime;

      /* 0.95x–1.05x 随机播速，为每次盖章注入轻微物理差异感 */
      var rate = 0.95 + Math.random() * 0.1;

      /* 重落: 低 square 强压（频率随 rate 偏移） */
      var thud = ctx.createOscillator();
      thud.type = 'square';
      thud.frequency.setValueAtTime(110 * rate, t0);
      thud.frequency.exponentialRampToValueAtTime(48 * rate, t0 + 0.13);
      var tg = ctx.createGain();
      tg.gain.setValueAtTime(0.0001, t0);
      tg.gain.exponentialRampToValueAtTime(0.13, t0 + 0.008);
      tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 720;
      thud.connect(lp); lp.connect(tg); tg.connect(master);
      thud.start(t0); thud.stop(t0 + 0.2);

      /* 公文章纸面摩擦（BufferSource 直接设 playbackRate） */
      var len = Math.floor(ctx.sampleRate * 0.08);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) * 0.6;
      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;          /* ← playbackRate 随机化核心 */
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
      var sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t0 + 0.04);
      sg.gain.exponentialRampToValueAtTime(0.05, t0 + 0.05);
      sg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      src.connect(bp); bp.connect(sg); sg.connect(master);
      src.start(t0 + 0.04); src.stop(t0 + 0.13);

      /* 阴森余音（频率随 rate 偏移） */
      var dr = ctx.createOscillator();
      dr.type = 'sawtooth';
      dr.frequency.setValueAtTime(72 * rate, t0 + 0.1);
      dr.frequency.linearRampToValueAtTime(58 * rate, t0 + 0.6);
      var dg = ctx.createGain();
      dg.gain.setValueAtTime(0.0001, t0 + 0.1);
      dg.gain.linearRampToValueAtTime(0.035, t0 + 0.18);
      dg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8);
      var dlp = ctx.createBiquadFilter();
      dlp.type = 'lowpass'; dlp.frequency.value = 460;
      dr.connect(dlp); dlp.connect(dg); dg.connect(master);
      dr.start(t0 + 0.1); dr.stop(t0 + 0.85);
    } catch (e) {
      console.warn('[AudioEngine] playFbcOverrideStamp:', e);
    }
  };

  /**
   * 三位一体展示框（door-result-frame）淡入扫描音。
   *
   * 设计意图：模拟 FBC 终端从虚空中"打印"出数据的质感。
   *   ① 噪底层：带通白噪（~2.8 kHz）在 CSS opacity 过渡（0.4s）内做淡入→淡出，
   *      营造"打印头扫描"的粒状纹理；
   *   ② 扫描线：细线正弦从 600 Hz 爬升至 960 Hz，贯穿整段，
   *      模拟 CRT 扫描线自下而上的行进感；
   *   ③ 锁定 click：末尾极短方波 click，暗示数据已完整写入。
   *
   * 路由：直连 master，完全绕过 BGM 低通滤波器；
   *       即使在"音频降维（沉浸模式）"下亦保持清晰穿透力。
   */
  AudioEngine.prototype.playScanPrint = function () {
    this.resumeIfNeeded();
    if (!this._ctx || !this._master) return;
    if (this._ctx.state === 'suspended') return;
    try {
      var ctx    = this._ctx;
      var master = this._master;
      var t0     = ctx.currentTime;

      /* ── ① 噪底：带通白噪，淡入（~150 ms）→ 保持 → 淡出（~120 ms）── */
      var dur = 0.44;
      var len = Math.floor(ctx.sampleRate * dur);
      var nbuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var nd   = nbuf.getChannelData(0);
      for (var i = 0; i < len; i++) nd[i] = (Math.random() * 2 - 1) * 0.8;

      var nsrc = ctx.createBufferSource();
      nsrc.buffer = nbuf;

      var nbp = ctx.createBiquadFilter();
      nbp.type = 'bandpass';
      nbp.frequency.value = 2800;
      nbp.Q.value = 0.9;

      var ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t0);
      ng.gain.linearRampToValueAtTime(0.036, t0 + 0.15);   /* 淡入 */
      ng.gain.setValueAtTime(0.036, t0 + 0.28);
      ng.gain.linearRampToValueAtTime(0.0001, t0 + dur);   /* 淡出 */

      nsrc.connect(nbp); nbp.connect(ng); ng.connect(master);
      nsrc.start(t0); nsrc.stop(t0 + dur + 0.01);

      /* ── ② 扫描线：正弦从 600 Hz 爬升至 960 Hz，带形淡入/淡出 ── */
      var scan = ctx.createOscillator();
      scan.type = 'sine';
      scan.frequency.setValueAtTime(600, t0);
      scan.frequency.linearRampToValueAtTime(960, t0 + 0.36);

      var sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t0);
      sg.gain.linearRampToValueAtTime(0.016, t0 + 0.10);   /* 淡入 */
      sg.gain.setValueAtTime(0.016, t0 + 0.28);
      sg.gain.linearRampToValueAtTime(0.0001, t0 + 0.42);  /* 淡出 */

      scan.connect(sg); sg.connect(master);
      scan.start(t0); scan.stop(t0 + 0.44);

      /* ── ③ 锁定 click：末尾极短方波，暗示数据写入完毕 ── */
      var click = ctx.createOscillator();
      click.type = 'square';
      click.frequency.setValueAtTime(1180, t0 + 0.36);
      click.frequency.exponentialRampToValueAtTime(720, t0 + 0.42);

      var cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t0 + 0.355);
      cg.gain.exponentialRampToValueAtTime(0.020, t0 + 0.364);
      cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);

      var chp = ctx.createBiquadFilter();
      chp.type = 'highpass';
      chp.frequency.value = 600;

      click.connect(chp); chp.connect(cg); cg.connect(master);
      click.start(t0 + 0.355); click.stop(t0 + 0.44);

    } catch (e) {
      console.warn('[AudioEngine] playScanPrint:', e);
    }
  };

  /**
   * 货舱清点单件揭露音。
   * @param {'gain'|'loss'|'neutral'} polarity
   */
  AudioEngine.prototype.playManifestRevealItem = function (polarity) {
    this.resumeIfNeeded();
    if (!this._ctx || !this._master) return;
    if (this._ctx.state === 'suspended') return;
    try {
      var ctx = this._ctx;
      var master = this._master;
      var t0 = ctx.currentTime;

      if (polarity === 'gain') {
        /* 清亮上扬 */
        var o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(880, t0);
        o.frequency.exponentialRampToValueAtTime(1320, t0 + 0.08);
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
        o.connect(g); g.connect(master);
        o.start(t0); o.stop(t0 + 0.2);
      } else if (polarity === 'loss') {
        /* 短促下沉 */
        var o2 = ctx.createOscillator();
        o2.type = 'sine';
        o2.frequency.setValueAtTime(220, t0);
        o2.frequency.exponentialRampToValueAtTime(96, t0 + 0.12);
        var g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.0001, t0);
        g2.gain.exponentialRampToValueAtTime(0.07, t0 + 0.01);
        g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
        o2.connect(g2); g2.connect(master);
        o2.start(t0); o2.stop(t0 + 0.2);
      } else {
        /* 中性轻 tick */
        var o3 = ctx.createOscillator();
        o3.type = 'square';
        o3.frequency.setValueAtTime(640, t0);
        var g3 = ctx.createGain();
        g3.gain.setValueAtTime(0.0001, t0);
        g3.gain.exponentialRampToValueAtTime(0.025, t0 + 0.005);
        g3.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
        o3.connect(g3); g3.connect(master);
        o3.start(t0); o3.stop(t0 + 0.06);
      }
    } catch (e) {
      console.warn('[AudioEngine] playManifestRevealItem:', e);
    }
  };

  global.AudioEngine = AudioEngine;
})(typeof window !== 'undefined' ? window : globalThis);
