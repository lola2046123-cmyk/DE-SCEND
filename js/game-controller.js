/**
 * Elevator Rush — GameController v3
 *
 * 新增：
 *   - corruption（偏移指数）：影响赔率曲线，随楼层 / 结果累积
 *   - inventory (物品栏)：物品系统入口，含 The Floppy Disk
 *   - 事件带重构：BOOM_MAX = base + corruption * BOOM_SHIFT
 *   - useItem(id) / rerollCurrentFloor()
 *   - HISS_BREACH 状态：开门后 10% 概率触发 5s 倒计时，超时自动 Boom
 */

(function (global) {
  'use strict';

  /* =====================================================================
   * 常量
   * ===================================================================== */

  /** 基础事件带阈值（未受腐蚀时） */
  var THRESHOLDS = {
    BOOM_MAX:     0.12,
    NEGATIVE_MAX: 0.25,
    POSITIVE_MAX: 0.85
  };

  var STATES = {
    IDLE:        'IDLE',
    ASCENDING:   'ASCENDING',
    EVALUATING:  'EVALUATING',
    REVEALING:   'REVEALING',
    DECIDING:    'DECIDING',
    HISS_BREACH: 'HISS_BREACH',   // 新增：偏移突破倒计时（Hiss Breach）
    GAME_OVER:   'GAME_OVER',
    CASHED_OUT:  'CASHED_OUT'
  };

  /**
   * 偏移指数参数
   *
   *   corruption 取值范围 [0, MAX]（浮点数）
   *   corruptionRatio = corruption / MAX  → [0, 1] 供 UI 使用
   *
   * BOOM_SHIFT 决定偏移指数对爆炸概率的放大系数：
   *   BOOM_MAX_effective = THRESHOLDS.BOOM_MAX + corruption × BOOM_SHIFT
   *   最大时（corruption=3）：0.12 + 3×0.05 = 0.27，是基础值的 2.25 倍
   */
  var CORRUPTION = {
    MAX:          3.0,
    BOOM_SHIFT:   0.05,    // final_event_chance = base + corruption * BOOM_SHIFT
    PER_FLOOR:    0.08,    // 每升一层
    ON_POSITIVE:  0.05,    // 正面结果：贪婪副作用
    ON_NEGATIVE:  0.12,    // 负面结果：创伤加剧
    ON_DOUBLE:    0.35,    // 超现实奖励：现实扭曲严重
    ON_REROLL:    0.22     // 使用软盘重掷：干预代价
  };

  var BREACH_PROB      = 0.10;   // Hiss Breach 触发概率
  var BREACH_MS        = 5000;   // 倒计时时长（ms）
  var BREACH_MIN_FLOOR = 5;      // 最低触发楼层

  /* =====================================================================
   * 乘客身份系统
   * ===================================================================== */

  var PASSENGER = {
    MAX_ONBOARD:   2,
    BOARD_CHANCE:  0.40,
    DEPART_CHANCE: 0.30,
    MIN_FLOOR:     3,
    TYPES: {
      VIP: {
        identity: 'VIP', weight: 35,
        thresholdMod: { boomShift: -0.04, negShift: -0.02 },
        creditsMod: 1.15,
        disguiseChance: 0
      },
      SCAMMER: {
        identity: 'SCAMMER', weight: 35,
        thresholdMod: { boomShift: 0.06, negShift: 0.03 },
        creditsMod: 0.85,
        disguiseChance: 1.0
      },
      DANGER: {
        identity: 'DANGER', weight: 30,
        thresholdMod: { boomShift: 0.08, negShift: 0.02 },
        creditsMod: 1.0,
        volatile: true,
        disguiseChance: 0.5
      }
    }
  };

  /** 动态环境事件（每 5 层轮换） */
  var ENV_EVENT_IDS = ['LIGHTS_OUT', 'CORRUPTION_SURGE', 'BAND_DRIFT'];

  function rollEnvEventId(rng) {
    return ENV_EVENT_IDS[Math.floor(rng() * ENV_EVENT_IDS.length)];
  }

  function aggregatePassengerModifiers(passengers) {
    var boom = 0, neg = 0, cred = 1;
    var hasVolatile = false;
    var hasVip = false, hasScammer = false, hasDanger = false;
    var i, p;
    for (i = 0; i < passengers.length; i++) {
      p = passengers[i];
      boom += (p.thresholdMod && p.thresholdMod.boomShift) || 0;
      neg  += (p.thresholdMod && p.thresholdMod.negShift)  || 0;
      if (p.creditsMod && p.creditsMod !== 1) cred *= p.creditsMod;
      if (p.volatile) hasVolatile = true;
      if (p.identity === 'VIP') hasVip = true;
      if (p.identity === 'SCAMMER') hasScammer = true;
      if (p.identity === 'DANGER') hasDanger = true;
    }
    if (hasVip && hasScammer) {
      boom += 0.035;
      neg  += 0.02;
      cred *= 1.2;
    }
    /* P1：审计员 × 希斯同厢 — 结构风险被行政压制，负向带与叙事张力上升 */
    if (hasVip && hasDanger) {
      boom -= 0.048;
      neg  += 0.062;
      cred *= 0.93;
    }
    return {
      boomShift: boom,
      negShift:  neg,
      creditsMult: cred,
      hasVolatile: hasVolatile,
      comboVipScammer: hasVip && hasScammer,
      comboVipDanger: hasVip && hasDanger
    };
  }

  /**
   * P1：Hiss Breach 概率受乘客身份调制（审计抑制 / 希斯催化 / 同场对峙激化）
   */
  function computeBreachProbability(passengers) {
    var p = BREACH_PROB;
    var hasVip = false, hasDanger = false;
    var i, px;
    passengers = passengers || [];
    for (i = 0; i < passengers.length; i++) {
      px = passengers[i];
      if (px.identity === 'VIP') hasVip = true;
      if (px.identity === 'DANGER') hasDanger = true;
    }
    if (hasDanger) p += 0.075;
    if (hasVip) p -= 0.042;
    if (hasVip && hasDanger) p += 0.115;
    return Math.max(0.028, Math.min(0.44, p));
  }

  function createPassenger(rng) {
    var r = rng() * 100, cumulative = 0, type = PASSENGER.TYPES.VIP;
    var keys = ['VIP', 'SCAMMER', 'DANGER'];
    for (var i = 0; i < keys.length; i++) {
      cumulative += PASSENGER.TYPES[keys[i]].weight;
      if (r < cumulative) { type = PASSENGER.TYPES[keys[i]]; break; }
    }
    return {
      identity:     type.identity,
      thresholdMod: type.thresholdMod,
      creditsMod:   type.creditsMod,
      volatile:     !!type.volatile,
      isDisguised:  rng() < type.disguiseChance
    };
  }

  /* =====================================================================
   * 物品注册表
   * ===================================================================== */

  var ITEM_REGISTRY = {};

  /**
   * 局里多功能模块盘：审查 / 应急制动（双模式，同一库存计数）
   */
  ITEM_REGISTRY['floppy-disk'] = {
    id:   'floppy-disk',
    name: 'Bureau Module',
    description: '审查：揭露乘客伪装。应急制动：下一次垂直坠毁时强制保留 30% 资产。',
    modes: {
      scan: {
        usableIn: [STATES.DECIDING, STATES.HISS_BREACH],
        canUse: function (ctrl) {
          return ctrl.passengers && ctrl.passengers.length > 0;
        },
        onUse: function (ctrl) { return ctrl.scanPassenger(); }
      },
      brake: {
        usableIn: [STATES.DECIDING, STATES.HISS_BREACH],
        canUse: function (ctrl) {
          return !ctrl.boomMitigationPending;
        },
        onUse: function (ctrl) {
          ctrl.boomMitigationPending = true;
          return { ok: true, mode: 'brake' };
        }
      }
    }
  };

  /* =====================================================================
   * 赔率引擎（可审计 + 偏移指数感知）
   * ===================================================================== */

  /**
   * 根据偏移指数和乘客修正计算有效阈值。
   *
   * @param {number}      corruption ∈ [0, CORRUPTION.MAX]
   * @param {object|null} passenger  当前乘客（可选）
   * @returns {{ boomMax, negMax, posMax }}
   */
  function computeEffectiveThresholds(corruption, passengers, envEventId) {
    var shift  = Math.min(corruption * CORRUPTION.BOOM_SHIFT, 0.20);
    var agg    = aggregatePassengerModifiers(passengers || []);
    var pBoom  = agg.boomShift;
    var pNeg   = agg.negShift;
    if (envEventId === 'BAND_DRIFT') {
      pBoom += 0.028;
    }
    return {
      boomMax: Math.max(0.02, THRESHOLDS.BOOM_MAX     + shift + pBoom),
      negMax:  Math.max(0.08, THRESHOLDS.NEGATIVE_MAX + shift + pBoom + pNeg),
      posMax:  THRESHOLDS.POSITIVE_MAX
    };
  }

  /**
   * 单随机数可审计映射。
   * @param {number}       r           ∈ [0, 1)
   * @param {number}       corruption  当前偏移指数（默认 0）
   * @param {object[]}     passengers  乘客列表（可空）
   * @param {string|null}  envEventId  当前环境事件
   */
  function rollEventFromR(r, corruption, passengers, envEventId) {
    if (r < 0 || r >= 1) throw new Error('rollEventFromR: r must be in [0, 1)');
    corruption = corruption || 0;
    var T = computeEffectiveThresholds(corruption, passengers || [], envEventId || null);

    if (r < T.boomMax) {
      return {
        kind: 'BOOM', raw: r,
        band: '[0, ' + T.boomMax.toFixed(3) + ')',
        creditsMultiplier: 0
      };
    }
    if (r < T.negMax) {
      var tN = (r - T.boomMax) / (T.negMax - T.boomMax);
      return {
        kind: 'NEGATIVE', raw: r,
        band: '[' + T.boomMax.toFixed(3) + ', ' + T.negMax.toFixed(3) + ')',
        creditsMultiplier: 0.7 + tN * 0.2
      };
    }
    if (r < T.posMax) {
      var tP = (r - T.negMax) / (T.posMax - T.negMax);
      return {
        kind: 'POSITIVE', raw: r,
        band: '[' + T.negMax.toFixed(3) + ', ' + T.posMax.toFixed(3) + ')',
        creditsMultiplier: 1.1 + tP * 0.1
      };
    }
    return {
      kind: 'DOUBLE', raw: r,
      band: '(' + T.posMax.toFixed(3) + ', 1.00]',
      creditsMultiplier: 2
    };
  }

  /* =====================================================================
   * SurpriseEvent（概率随贪婪线性增长）
   * ===================================================================== */

  var SurpriseEvent = {};

  SurpriseEvent.KINDS = { COIN_RAIN: 'COIN_RAIN', SKIP_FLOOR: 'SKIP_FLOOR' };
  SurpriseEvent.BASE_PROB_COIN_RAIN  = 0.05;
  SurpriseEvent.BASE_PROB_SKIP_FLOOR = 0.04;

  SurpriseEvent.tryTrigger = function (game, sr) {
    if (game.floor < 3) return null;
    var greed = Math.min((game.floor - 1) / 30, 1);
    var pC = SurpriseEvent.BASE_PROB_COIN_RAIN  * (1 + greed);
    var pS = SurpriseEvent.BASE_PROB_SKIP_FLOOR * (1 + greed);
    if (sr < pC) {
      return { kind: SurpriseEvent.KINDS.COIN_RAIN,
               creditsBonus: Math.max(1, Math.floor(game.credits * 0.25)),
               floorBonus: 0 };
    }
    if (sr < pC + pS) {
      return { kind: SurpriseEvent.KINDS.SKIP_FLOOR, creditsBonus: 0, floorBonus: 1 };
    }
    return null;
  };

  /* =====================================================================
   * AudioEngine 桩
   * ===================================================================== */

  function createAudioStub() {
    return {
      playStateTransition: function (f, t) { void f; void t; },
      playOutcome:    function (k) { void k; },
      playSurprise:   function (k) { void k; },
      playBreach:     function ()  {},
      resumeIfNeeded: function ()  {},
      playCommitteePulse: function () {},
      playLeverPull:    function () {},
      tryPlaySlot:      function () {}
    };
  }

  /* =====================================================================
   * GameController
   * ===================================================================== */

  /**
   * @param {object}            options
   * @param {number}            [options.initialBet=100]
   * @param {function():number} [options.random]     可注入确定性 RNG
   * @param {object}            [options.audio]      AudioEngine 实例
   */
  function GameController(options) {
    options = options || {};
    this.initialBet  = typeof options.initialBet === 'number' ? options.initialBet : 100;
    this._rng        = typeof options.random === 'function'   ? options.random : Math.random;
    this.audio       = options.audio || createAudioStub();
    this._listeners  = {
      state: [], outcome: [], surprise: [], cashOut: [],
      corruption: [], breach: [], reroll: [],
      passengerBoard: [], passengerLeave: [], passengerReveal: [],
      envEvent: [], passengerStack: []
    };
    this._breachTimer   = null;
    this._breachDeadline = 0;
    this.reset();
  }

  /* ---- 静态导出 ---- */
  GameController.STATES                    = STATES;
  GameController.THRESHOLDS                = THRESHOLDS;
  GameController.CORRUPTION                = CORRUPTION;
  GameController.ITEM_REGISTRY             = ITEM_REGISTRY;
  GameController.SurpriseEvent             = SurpriseEvent;
  GameController.rollEventFromR            = rollEventFromR;
  GameController.computeEffectiveThresholds = computeEffectiveThresholds;
  GameController.computeBreachProbability  = computeBreachProbability;
  GameController.BREACH_DURATION_MS        = BREACH_MS;
  GameController.PASSENGER                 = PASSENGER;
  GameController.createPassenger           = createPassenger;
  GameController.ENV_EVENT_IDS             = ENV_EVENT_IDS;

  /* ---- 重置 ---- */
  GameController.prototype.reset = function () {
    this.floor               = 1;
    this.credits             = this.initialBet;
    this.corruption          = 0;
    this.inventory           = [{ id: 'floppy-disk', count: 3 }];
    this.passengers          = [];
    this.activeEnvEvent      = null;
    this.boomMitigationPending = false;
    this.state               = STATES.IDLE;
    this.rngLog              = [];
    this.lastOutcome         = null;
    this.lastSurprise        = null;
    this.lastPayout          = null;
    this._floorCreditsBefore = null;  // 用于 reroll 回滚
    this._pendingBreach      = false;
    this._clearBreachTimer();
    this._emitState(STATES.IDLE, null);
  };

  /* ---- 计算属性 ---- */

  /** 贪婪系数 ∈ [0, 1]，30 层饱和 */
  Object.defineProperty(GameController.prototype, 'greedFactor', {
    get: function () { return Math.min((this.floor - 1) / 30, 1); }
  });

  /** 偏移比率 ∈ [0, 1]，供 CSS 使用 */
  Object.defineProperty(GameController.prototype, 'corruptionRatio', {
    get: function () { return Math.min(this.corruption / CORRUPTION.MAX, 1); }
  });

  GameController.prototype.getEffectiveThresholds = function () {
    return computeEffectiveThresholds(this.corruption, this.passengers, this.activeEnvEvent);
  };

  Object.defineProperty(GameController.prototype, 'passenger', {
    get: function () {
      return this.passengers && this.passengers.length ? this.passengers[0] : null;
    }
  });

  GameController.prototype.getTheoreticalCredits = function () {
    return this.initialBet * Math.pow(1.1, this.floor - 1);
  };

  GameController.prototype.getInventoryItem = function (id) {
    for (var i = 0; i < this.inventory.length; i++) {
      if (this.inventory[i].id === id) return this.inventory[i];
    }
    return null;
  };

  /* ---- 事件监听注册 ---- */
  GameController.prototype.onStateChange  = function (fn) { this._listeners.state.push(fn); };
  GameController.prototype.onOutcome      = function (fn) { this._listeners.outcome.push(fn); };
  GameController.prototype.onSurprise     = function (fn) { this._listeners.surprise.push(fn); };
  GameController.prototype.onCashOut      = function (fn) { this._listeners.cashOut.push(fn); };
  GameController.prototype.onCorruption   = function (fn) { this._listeners.corruption.push(fn); };
  GameController.prototype.onBreach       = function (fn) { this._listeners.breach.push(fn); };
  GameController.prototype.onReroll          = function (fn) { this._listeners.reroll.push(fn); };
  GameController.prototype.onPassengerBoard  = function (fn) { this._listeners.passengerBoard.push(fn); };
  GameController.prototype.onPassengerLeave  = function (fn) { this._listeners.passengerLeave.push(fn); };
  GameController.prototype.onPassengerReveal = function (fn) { this._listeners.passengerReveal.push(fn); };
  GameController.prototype.onEnvEvent        = function (fn) { this._listeners.envEvent.push(fn); };
  GameController.prototype.onPassengerStack  = function (fn) { this._listeners.passengerStack.push(fn); };

  /* ---- 事件派发 ---- */
  GameController.prototype._emitState = function (next, prev) {
    for (var i = 0; i < this._listeners.state.length; i++) {
      try { this._listeners.state[i](next, prev, this); } catch (e) { console.error(e); }
    }
    this.audio.playStateTransition(prev, next);
  };

  GameController.prototype._emitOutcome = function (outcome) {
    for (var i = 0; i < this._listeners.outcome.length; i++) {
      try { this._listeners.outcome[i](outcome, this); } catch (e) { console.error(e); }
    }
    this.audio.playOutcome(outcome.kind);
  };

  GameController.prototype._emitSurprise = function (s) {
    for (var i = 0; i < this._listeners.surprise.length; i++) {
      try { this._listeners.surprise[i](s, this); } catch (e) { console.error(e); }
    }
    this.audio.playSurprise(s.kind);
  };

  /** 每次偏移指数变化后调用，传递原始值和比率 */
  GameController.prototype._emitCorruption = function () {
    for (var i = 0; i < this._listeners.corruption.length; i++) {
      try { this._listeners.corruption[i](this.corruption, this.corruptionRatio, this); } catch (e) { console.error(e); }
    }
  };

  /** 广播 Breach 开始，传递截止时间戳（供 UI 绘制倒计时） */
  GameController.prototype._emitBreach = function () {
    for (var i = 0; i < this._listeners.breach.length; i++) {
      try { this._listeners.breach[i](this._breachDeadline, this); } catch (e) { console.error(e); }
    }
    this.audio.playBreach();
  };

  GameController.prototype._emitReroll = function (newOutcome) {
    for (var i = 0; i < this._listeners.reroll.length; i++) {
      try { this._listeners.reroll[i](newOutcome, this); } catch (e) { console.error(e); }
    }
  };

  GameController.prototype._emitPassengerBoard = function (p) {
    for (var i = 0; i < this._listeners.passengerBoard.length; i++) {
      try { this._listeners.passengerBoard[i](p, this); } catch (e) { console.error(e); }
    }
  };

  GameController.prototype._emitPassengerLeave = function (p, reason) {
    for (var i = 0; i < this._listeners.passengerLeave.length; i++) {
      try { this._listeners.passengerLeave[i](p, reason, this); } catch (e) { console.error(e); }
    }
  };

  GameController.prototype._emitPassengerReveal = function (p) {
    for (var i = 0; i < this._listeners.passengerReveal.length; i++) {
      try { this._listeners.passengerReveal[i](p, this); } catch (e) { console.error(e); }
    }
  };

  GameController.prototype._emitEnvEvent = function (payload) {
    for (var i = 0; i < this._listeners.envEvent.length; i++) {
      try { this._listeners.envEvent[i](payload, this); } catch (e) { console.error(e); }
    }
  };

  GameController.prototype._emitPassengerStack = function () {
    for (var i = 0; i < this._listeners.passengerStack.length; i++) {
      try { this._listeners.passengerStack[i](this.passengers.slice(), this); } catch (e) { console.error(e); }
    }
  };

  /* ---- 乘客生命周期 ---- */

  GameController.prototype._updatePassengers = function () {
    var result = { boarded: null, departed: null };
    var departedList = [];
    var i, p;

    for (i = this.passengers.length - 1; i >= 0; i--) {
      if (this._rng() < PASSENGER.DEPART_CHANCE) {
        p = this.passengers.splice(i, 1)[0];
        departedList.push(p);
        this._emitPassengerLeave(p, 'departed');
      }
    }
    if (departedList.length) result.departed = departedList;

    if (this.passengers.length < PASSENGER.MAX_ONBOARD &&
        this.floor >= PASSENGER.MIN_FLOOR &&
        this._rng() < PASSENGER.BOARD_CHANCE) {
      p = createPassenger(this._rng);
      this.passengers.push(p);
      result.boarded = p;
      this._emitPassengerBoard(p);
    }

    this._emitPassengerStack();
    return result;
  };

  /**
   * 模块盘 · 审查：优先揭露第一个仍伪装的乘客；否则揭露首位。
   * SCAMMER 伪装被揭后逃离。
   */
  GameController.prototype.scanPassenger = function () {
    if (!this.passengers.length) return { ok: false, reason: 'no_passenger' };
    var idx = 0;
    var i, p;
    for (i = 0; i < this.passengers.length; i++) {
      if (this.passengers[i].isDisguised) { idx = i; break; }
    }
    p = this.passengers[idx];
    var wasDisguised = p.isDisguised;
    var identity     = p.identity;
    p.isDisguised = false;
    this._emitPassengerReveal(p);

    var fled = false;
    if (wasDisguised && identity === 'SCAMMER') {
      fled = true;
      this.passengers.splice(idx, 1);
      this._emitPassengerLeave(p, 'fled');
    }
    var auditRelief = false;
    var hissUnveil = false;
    /* P1：审查博弈 — 审计员背书降温（每位每局仅一次）；伪装希斯被揭穿则偏移尖峰 */
    if (identity === 'VIP' && !p.auditCleared) {
      p.auditCleared = true;
      this._adjustCorruption(-0.11);
      auditRelief = true;
    }
    if (identity === 'DANGER' && wasDisguised) {
      this._addCorruption(0.17);
      hissUnveil = true;
    }
    this._emitPassengerStack();
    return {
      ok: true, identity: identity, wasDisguised: wasDisguised, fled: fled, index: idx,
      auditRelief: auditRelief, hissUnveil: hissUnveil
    };
  };

  GameController.prototype._setState = function (next) {
    var prev = this.state;
    this.state = next;
    this._emitState(next, prev);
  };

  /* ---- 偏移指数管理 ---- */

  GameController.prototype._addCorruption = function (delta) {
    this.corruption = Math.min(this.corruption + delta, CORRUPTION.MAX);
    this._emitCorruption();
  };

  /** P1：允许审查等事件小幅回退偏移指数（下限 0） */
  GameController.prototype._adjustCorruption = function (delta) {
    this.corruption = Math.max(0, Math.min(CORRUPTION.MAX, this.corruption + delta));
    this._emitCorruption();
  };

  GameController.prototype._applyCorruptionForOutcome = function (outcome) {
    var em = this.activeEnvEvent === 'CORRUPTION_SURGE' ? 2 : 1;
    this._addCorruption(CORRUPTION.PER_FLOOR * em);
    if (outcome.kind === 'DOUBLE')   this._addCorruption(CORRUPTION.ON_DOUBLE * em);
    if (outcome.kind === 'NEGATIVE') this._addCorruption(CORRUPTION.ON_NEGATIVE * em);
    if (outcome.kind === 'POSITIVE') this._addCorruption(CORRUPTION.ON_POSITIVE * em);
  };

  /* ---- Hiss Breach 计时器 ---- */

  GameController.prototype._clearBreachTimer = function () {
    if (this._breachTimer !== null) {
      clearTimeout(this._breachTimer);
      this._breachTimer = null;
    }
  };

  GameController.prototype._startBreachTimer = function () {
    var self = this;
    this._breachDeadline = Date.now() + BREACH_MS;
    this._emitBreach();
    this._breachTimer = setTimeout(function () {
      self._autoBoom();
    }, BREACH_MS);
  };

  /**
   * 倒计时归零：强制 Boom，不走正常事件带，特殊标记 autoBoom: true。
   */
  GameController.prototype._autoBoom = function () {
    if (this.state !== STATES.HISS_BREACH) return;
    this._clearBreachTimer();
    this.credits     = 0;
    this.lastOutcome = {
      kind: 'BOOM', raw: -1, band: 'HISS_AUTO_BOOM',
      creditsMultiplier: 0, autoBoom: true
    };
    this._emitOutcome(this.lastOutcome);
    this._setState(STATES.GAME_OVER);
  };

  /* ---- 能力查询 ---- */

  GameController.prototype.canGoUp = function () {
    return this.state === STATES.IDLE || this.state === STATES.DECIDING;
  };

  /** Hiss Breach 期间仍可结算撤离 */
  GameController.prototype.canCashOut = function () {
    return this.state === STATES.IDLE    ||
           this.state === STATES.DECIDING ||
           this.state === STATES.HISS_BREACH;
  };

  GameController.prototype.canUseItem = function (id, mode) {
    mode = mode || 'scan';
    var def = ITEM_REGISTRY[id];
    if (!def || !def.modes) return false;
    var sub = def.modes[mode];
    if (!sub) return false;
    var inv = this.getInventoryItem(id);
    if (!inv || inv.count <= 0) return false;
    if (sub.usableIn.indexOf(this.state) < 0) return false;
    if (typeof sub.canUse === 'function' && !sub.canUse(this)) return false;
    return true;
  };

  /* ---- 主流程 ---- */

  GameController.prototype.startAscend = function () {
    if (!this.canGoUp()) return { ok: false, reason: 'invalid_state' };
    this.audio.resumeIfNeeded();
    this._setState(STATES.ASCENDING);
    return { ok: true };
  };

  GameController.prototype._applyBaselineGrowth = function () { this.credits *= 1.1; };

  GameController.prototype._applyOutcomeToCredits = function (outcome) {
    if (outcome.kind === 'BOOM') { this.credits = 0; return; }
    this.credits *= outcome.creditsMultiplier;
  };

  GameController.prototype._applySurprise = function (surprise) {
    if (surprise.kind === SurpriseEvent.KINDS.COIN_RAIN) {
      this.credits += surprise.creditsBonus;
    }
    if (surprise.kind === SurpriseEvent.KINDS.SKIP_FLOOR) {
      for (var i = 0; i < surprise.floorBonus; i++) {
        this.floor += 1;
        this._applyBaselineGrowth();
        this._addCorruption(CORRUPTION.PER_FLOOR);
      }
    }
  };

  /**
   * 关门动画结束后由 UI 调用。
   *
   * 流程：EVALUATING → 事件带（含偏移指数）→ 偏移指数累积 → SurpriseEvent → Breach 判定 → REVEALING
   *
   * @returns {{ ok, outcome, surprise }}
   */
  GameController.prototype.processAscendComplete = function () {
    if (this.state !== STATES.ASCENDING) return { ok: false, reason: 'not_ascending' };
    this._setState(STATES.EVALUATING);

    /* 基线增长 + 快照 */
    this.floor += 1;
    this._applyBaselineGrowth();
    this._floorCreditsBefore = this.credits;

    /* 乘客生命周期（到站后先下后上） */
    var pEvents = this._updatePassengers();

    /* 每 5 层：动态环境事件轮换 */
    var envRoll = null;
    if (this.floor >= 5 && this.floor % 5 === 0) {
      envRoll = rollEnvEventId(this._rng);
      this.activeEnvEvent = envRoll;
      this._emitEnvEvent({ id: envRoll, floor: this.floor });
    }

    /* 主事件（偏移指数 + 乘客叠加 + 环境） */
    var r       = this._rng();
    var outcome = rollEventFromR(r, this.corruption, this.passengers, this.activeEnvEvent);
    this._applyOutcomeToCredits(outcome);

    /* 应急制动：坠毁时保留 30%（相对本层基线快照） */
    if (outcome.kind === 'BOOM' && this.boomMitigationPending) {
      this.credits = Math.max(0, Math.floor(this._floorCreditsBefore * 0.3));
      outcome.mitigated = true;
      outcome.displayKind = 'MITIGATED';
      this.boomMitigationPending = false;
    }

    /* 乘客资本修正（叠加 + 组合加成） */
    if (this.passengers.length && outcome.kind !== 'BOOM') {
      var agg = aggregatePassengerModifiers(this.passengers);
      this.credits *= agg.creditsMult;
      if (agg.hasVolatile) {
        this.credits *= (this._rng() > 0.4 ? 1.25 : 0.75);
      }
    }

    this._applyCorruptionForOutcome(outcome);

    var pid = this.passengers.map(function (x) { return x.identity; }).join('+') || null;
    this.rngLog.push({
      floor:        this.floor,
      raw:          r,
      outcomeKind:  outcome.kind,
      band:         outcome.band,
      creditsAfter: this.credits,
      corruption:   this.corruption,
      passenger:    pid,
      envEvent:     this.activeEnvEvent,
      mitigated:    !!outcome.mitigated
    });

    this.lastOutcome = outcome;
    this._emitOutcome(outcome);

    /* SurpriseEvent（仅非 BOOM） */
    var surprise = null;
    if (outcome.kind !== 'BOOM') {
      var sr = this._rng();
      surprise = SurpriseEvent.tryTrigger(this, sr);
      if (surprise) {
        this._applySurprise(surprise);
        this.lastSurprise = surprise;
        this._emitSurprise(surprise);
      } else {
        this.lastSurprise = null;
      }

      var bProb = computeBreachProbability(this.passengers);
      this._pendingBreach =
        this.floor >= BREACH_MIN_FLOOR && this._rng() < bProb;
    } else {
      this.lastSurprise   = null;
      this._pendingBreach = false;
    }

    this._setState(STATES.REVEALING);
    return {
      ok: true, outcome: outcome, surprise: surprise,
      passengerBoarded: pEvents.boarded, passengerDeparted: pEvents.departed,
      envEvent: envRoll, envActive: this.activeEnvEvent
    };
  };

  /**
   * 开门展示结束后由 UI 调用。
   *
   * 返回：
   *   { ok, gameOver, breach }
   *   breach=true → 状态切换到 HISS_BREACH，5s 倒计时启动
   */
  GameController.prototype.finishReveal = function () {
    if (this.state !== STATES.REVEALING) return { ok: false, reason: 'not_revealing' };

    /* BOOM → GAME_OVER（应急制动已缓和的坠毁除外） */
    if (this.lastOutcome && this.lastOutcome.kind === 'BOOM' && !this.lastOutcome.mitigated) {
      this._setState(STATES.GAME_OVER);
      return { ok: true, gameOver: true, breach: false };
    }

    /* Hiss Breach → 进入 HISS_BREACH，启动倒计时 */
    if (this._pendingBreach) {
      this._pendingBreach = false;
      this._setState(STATES.HISS_BREACH);
      this._startBreachTimer();
      return { ok: true, gameOver: false, breach: true };
    }

    /* 正常 → DECIDING */
    this._setState(STATES.DECIDING);
    return { ok: true, gameOver: false, breach: false };
  };

  /* ---- 结算撤离 ---- */

  GameController.prototype.cashOut = function () {
    if (!this.canCashOut()) return { ok: false, reason: 'invalid_state' };
    this._clearBreachTimer();
    var payout   = Math.floor(this.credits);
    this.lastPayout = payout;
    this._setState(STATES.CASHED_OUT);
    for (var i = 0; i < this._listeners.cashOut.length; i++) {
      try { this._listeners.cashOut[i](payout, this); } catch (e) { console.error(e); }
    }
    this.reset();
    return { ok: true, payout: payout };
  };

  /* ---- BOOM 确认 ---- */

  GameController.prototype.acknowledgeGameOver = function () {
    if (this.state !== STATES.GAME_OVER) return { ok: false, reason: 'not_game_over' };
    this.reset();
    return { ok: true };
  };

  /* =====================================================================
   * 物品系统
   * ===================================================================== */

  /**
   * 使用物品。
   * @param {string} itemId  注册表 ID
   * @returns {{ ok, reason?, ... }}  由各物品 onUse 的返回值决定
   */
  GameController.prototype.useItem = function (itemId, options) {
    options = options || {};
    var mode = options.mode || 'scan';
    if (!this.canUseItem(itemId, mode)) return { ok: false, reason: 'cannot_use_item' };
    var def = ITEM_REGISTRY[itemId];
    var sub = def.modes[mode];
    var inv = this.getInventoryItem(itemId);

    inv.count -= 1;
    if (inv.count < 0) inv.count = 0;
    /* 模块盘耗尽后保留 ×0 条目，供 UI 呈现「离线」态 */
    if (inv.count <= 0 && itemId !== 'floppy-disk') {
      this.inventory = this.inventory.filter(function (it) { return it.id !== itemId; });
    }

    return sub.onUse(this);
  };

  /**
   * The Floppy Disk 效果：重掷当前楼层结果。
   *
   * - 仅在 DECIDING 状态下可调用（canUseItem 已保证）
   * - 回滚至 _floorCreditsBefore（基线后、结果前的快照）
   * - 消耗 CORRUPTION.ON_REROLL 偏移指数（干预代价）
   * - 新结果若为 BOOM → 直接进入 GAME_OVER
   * - 不重新触发 SurpriseEvent（重掷代价之一）
   *
   * @returns {{ ok, newOutcome, boom }}
   */
  GameController.prototype.rerollCurrentFloor = function () {
    if (this.state !== STATES.DECIDING) return { ok: false, reason: 'not_deciding' };
    if (this._floorCreditsBefore === null) return { ok: false, reason: 'no_snapshot' };

    /* 回滚金额到基线快照 */
    this.credits = this._floorCreditsBefore;

    /* 移除上一条 rngLog（本层旧数据） */
    if (this.rngLog.length && this.rngLog[this.rngLog.length - 1].floor === this.floor) {
      this.rngLog.pop();
    }

    /* 偏移指数代价（先加，再用新偏移指数掷骰） */
    this._addCorruption(CORRUPTION.ON_REROLL);

    /* 重掷（使用最新偏移指数，代价立即体现） */
    var r          = this._rng();
    var newOutcome = rollEventFromR(r, this.corruption, this.passengers, this.activeEnvEvent);
    this._applyOutcomeToCredits(newOutcome);
    this._applyCorruptionForOutcome(newOutcome);

    this.rngLog.push({
      floor:        this.floor,
      raw:          r,
      outcomeKind:  newOutcome.kind,
      band:         newOutcome.band,
      creditsAfter: this.credits,
      corruption:   this.corruption,
      rerolled:     true
    });

    this.lastOutcome = newOutcome;
    this._emitOutcome(newOutcome);
    this._emitReroll(newOutcome);

    /* 重掷到 BOOM → 立即 GAME_OVER */
    if (newOutcome.kind === 'BOOM') {
      this._setState(STATES.GAME_OVER);
      return { ok: true, newOutcome: newOutcome, boom: true };
    }

    /* 正常重掷：留在 DECIDING，UI 更新文字即可 */
    return { ok: true, newOutcome: newOutcome, boom: false };
  };

  global.GameController = GameController;
})(typeof window !== 'undefined' ? window : globalThis);
