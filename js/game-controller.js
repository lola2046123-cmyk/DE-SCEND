/**
 * Elevator Rush — GameController v3
 *
 * 新增：
 *   - corruption（偏移指数）：影响赔率曲线，随楼层 / 结果累积
 *   - inventory (物品栏)：物品系统入口，含 The Floppy Disk
 *   - 事件带：LIQUIDATION_MAX = base + corruption × LIQUIDATION_SHIFT（强制清算带）
 *   - useItem(id) / rerollCurrentFloor()
 *   - HISS_BREACH：开门后 10% 概率触发 5s 倒计时，超时触发强制清算
 */

(function (global) {
  'use strict';

  /* =====================================================================
   * 常量
   * ===================================================================== */

  /** 基础事件带阈值（未受腐蚀时） */
  var THRESHOLDS = {
    LIQUIDATION_MAX: 0.12,
    NEGATIVE_MAX:    0.25,
    POSITIVE_MAX:    0.85
  };

  var STATES = {
    IDLE:        'IDLE',
    ASCENDING:   'ASCENDING',
    EVALUATING:  'EVALUATING',
    REVEALING:   'REVEALING',
    DECIDING:    'DECIDING',
    HISS_BREACH: 'HISS_BREACH',
    SAFE_NODE:   'SAFE_NODE',    // 补给站（第 5/10 层伪救赎安全屋）
    GAME_OVER:   'GAME_OVER',
    CASHED_OUT:  'CASHED_OUT',
    DEBT_CASHOUT: 'DEBT_CASHOUT'  // 配额未达成时强行撤离
  };

  /** 伪救赎安全屋楼层（每局仅触发一次） */
  var SAFE_NODE_FLOORS = [5, 10];

  /**
   * 楼层杠杆系数。
   * 养猪期（1-3 层）平稳放大，5 层起指数级扩张，让本金越大暴富越快、抽水越狠。
   */
  function floorLeverage(floor) {
    if (floor <= 3) return 1.8;
    return Math.min(8.0, 1.8 + (floor - 3) * 0.65);
  }

  /**
   * 偏移指数参数
   *
   *   corruption 取值范围 [0, MAX]（浮点数）
   *   corruptionRatio = corruption / MAX  → [0, 1] 供 UI 使用
   *
   * LIQUIDATION_SHIFT：偏移指数对「强制清算」概率带的放大系数
   *   LIQUIDATION_MAX_effective = THRESHOLDS.LIQUIDATION_MAX + corruption × LIQUIDATION_SHIFT
   */
  var CORRUPTION = {
    MAX:               3.0,
    LIQUIDATION_SHIFT: 0.05,
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
        thresholdMod: { liquidationShift: -0.04, negShift: -0.02 },
        creditsMod: 1.15,
        disguiseChance: 0
      },
      SCAMMER: {
        identity: 'SCAMMER', weight: 35,
        thresholdMod: { liquidationShift: 0.06, negShift: 0.03 },
        creditsMod: 0.85,
        disguiseChance: 1.0
      },
      DANGER: {
        identity: 'DANGER', weight: 30,
        thresholdMod: { liquidationShift: 0.08, negShift: 0.02 },
        creditsMod: 1.0,
        volatile: true,
        disguiseChance: 0.5
      }
    }
  };

  /* =====================================================================
   * 事件叙事词典
   * ===================================================================== */

  var OUTCOME_NARRATIVE_POOL = {
    DOUBLE: [
      { tag: '资产裂变', text: '触发高维金融漏洞，账面暴增 · 视同意外分红入账' },
      { tag: '意外分红', text: '系统发放特别超额津贴 · 高阶收容物估值暴增' },
      { tag: '财富跃升', text: '跨维度套利窗口开放 · 杠杆已自动拉满' }
    ],
    POSITIVE_HIGH: [
      { tag: '财富跃升', text: '大额账面增值 · 流动性注入' },
      { tag: '盲盒大奖', text: '截获高价值能量晶体 · 收益自动结算' },
      { tag: '资产裂变', text: '高频套利成功执行 · 本金倍率激活' }
    ],
    POSITIVE_LOW: [
      { tag: '意外分红', text: '合规红利入账 · 可继续上行放大收益' },
      { tag: '特别津贴', text: '微额系统补贴已入账 · 继续上行可翻倍' }
    ],
    NEGATIVE: [
      { tag: '恶意做空', text: '遭遇不明机构做空 · 账面强制收缩' },
      { tag: '违规罚款', text: '触犯联邦法案 §7.3 · 强制扣款执行' },
      { tag: '通货膨胀', text: '跨维度购买力蒸发 · 资产被迫缩水' }
    ],
    LIQUIDATION: [
      { tag: '强制清算', text: '联邦控制局启动破产程序 · 账面核销' }
    ]
  };

  /**
   * 根据 outcome 返回叙事文案对象 { tag, text }。
   * 供 UI 在结果前 0.5s 展示「事件短文本」制造悬念。
   * @param {object} outcome
   * @returns {{ tag: string, text: string }|null}
   */
  function getOutcomeNarrative(outcome) {
    if (!outcome) return null;
    var pool;
    if (outcome.kind === 'DOUBLE') {
      pool = OUTCOME_NARRATIVE_POOL.DOUBLE;
    } else if (outcome.kind === 'POSITIVE') {
      pool = (outcome.creditsMultiplier >= 1.16 || (outcome._effectiveMultiplier && outcome._effectiveMultiplier >= 1.16))
        ? OUTCOME_NARRATIVE_POOL.POSITIVE_HIGH
        : OUTCOME_NARRATIVE_POOL.POSITIVE_LOW;
    } else if (outcome.kind === 'NEGATIVE') {
      pool = OUTCOME_NARRATIVE_POOL.NEGATIVE;
    } else if (outcome.kind === 'LIQUIDATION') {
      pool = OUTCOME_NARRATIVE_POOL.LIQUIDATION;
    } else {
      return null;
    }
    if (!pool || !pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /** 动态环境事件（每 5 层轮换） */
  var ENV_EVENT_IDS = ['LIGHTS_OUT', 'CORRUPTION_SURGE', 'BAND_DRIFT'];

  function rollEnvEventId(rng) {
    return ENV_EVENT_IDS[Math.floor(rng() * ENV_EVENT_IDS.length)];
  }

  function aggregatePassengerModifiers(passengers) {
    var liq = 0, neg = 0, cred = 1;
    var hasVolatile = false;
    var hasVip = false, hasScammer = false, hasDanger = false;
    var i, p, tm;
    for (i = 0; i < passengers.length; i++) {
      p = passengers[i];
      tm = p.thresholdMod;
      liq += (tm && (tm.liquidationShift != null ? tm.liquidationShift : tm.boomShift)) || 0;
      neg += (tm && tm.negShift) || 0;
      if (p.creditsMod && p.creditsMod !== 1) cred *= p.creditsMod;
      if (p.volatile) hasVolatile = true;
      if (p.identity === 'VIP') hasVip = true;
      if (p.identity === 'SCAMMER') hasScammer = true;
      if (p.identity === 'DANGER') hasDanger = true;
    }
    if (hasVip && hasScammer) {
      liq += 0.035;
      neg += 0.02;
      cred *= 1.2;
    }
    if (hasVip && hasDanger) {
      liq -= 0.048;
      neg += 0.062;
      cred *= 0.93;
    }
    return {
      liquidationShift: liq,
      negShift:         neg,
      creditsMult:      cred,
      hasVolatile:      hasVolatile,
      comboVipScammer:  hasVip && hasScammer,
      comboVipDanger:   hasVip && hasDanger
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
    description: '审查：揭露乘客伪装。应急制动：下一次触发强制清算时保留约 30% 账面资产。',
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
          return !ctrl.brakeMitigationPending;
        },
        onUse: function (ctrl) {
          ctrl.brakeMitigationPending = true;
          return { ok: true, mode: 'brake' };
        }
      }
    }
  };

  /* =====================================================================
   * 赔率引擎（可审计 + 偏移指数感知）
   * ===================================================================== */

  /**
   * @param {number}      corruption
   * @param {object[]}    passengers
   * @param {string|null} envEventId
   * @param {number}      [quotaShift=0]  配额压力附加偏移
   * @param {number}      [floor=0]       当前楼层（1-3 层养猪期保护）
   * @returns {{ liquidationMax, negMax, posMax }}
   */
  function computeEffectiveThresholds(corruption, passengers, envEventId, quotaShift, floor) {
    var shift = Math.min(corruption * CORRUPTION.LIQUIDATION_SHIFT, 0.20);
    var agg   = aggregatePassengerModifiers(passengers || []);
    var pLiq  = agg.liquidationShift || 0;
    var pNeg  = agg.negShift;
    quotaShift = quotaShift || 0;
    floor = floor || 0;
    if (envEventId === 'BAND_DRIFT') {
      pLiq += 0.028;
    }
    /* 养猪期（第 1-3 层）：强制锁定破产概率为 0，负面区间同步压缩 */
    if (floor > 0 && floor <= 3) {
      return {
        liquidationMax: 0,
        negMax:         Math.max(0.06, THRESHOLDS.NEGATIVE_MAX * 0.55),
        posMax:         THRESHOLDS.POSITIVE_MAX
      };
    }
    return {
      liquidationMax: Math.max(0.02, THRESHOLDS.LIQUIDATION_MAX + shift + pLiq + quotaShift),
      negMax:         Math.max(0.08, THRESHOLDS.NEGATIVE_MAX + shift + pLiq + pNeg + quotaShift * 0.8),
      posMax:         THRESHOLDS.POSITIVE_MAX
    };
  }

  /**
   * 单随机数可审计映射。
   * @param {number}       r           ∈ [0, 1)
   * @param {number}       corruption  当前偏移指数（默认 0）
   * @param {object[]}     passengers  乘客列表（可空）
   * @param {string|null}  envEventId  当前环境事件
   * @param {number}       [quotaShift=0]
   * @param {number}       [floor=0]   当前楼层（养猪期保护透传）
   */
  function rollEventFromR(r, corruption, passengers, envEventId, quotaShift, floor) {
    if (r < 0 || r >= 1) throw new Error('rollEventFromR: r must be in [0, 1)');
    corruption = corruption || 0;
    var T = computeEffectiveThresholds(corruption, passengers || [], envEventId || null, quotaShift || 0, floor || 0);

    if (r < T.liquidationMax) {
      return {
        kind: 'LIQUIDATION', raw: r,
        band: '[0, ' + T.liquidationMax.toFixed(3) + ')',
        creditsMultiplier: 0
      };
    }
    if (r < T.negMax) {
      var tN = (r - T.liquidationMax) / (T.negMax - T.liquidationMax);
      return {
        kind: 'NEGATIVE', raw: r,
        band: '[' + T.liquidationMax.toFixed(3) + ', ' + T.negMax.toFixed(3) + ')',
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
      playOutcome:      function (k) { void k; },
      playSurprise:     function (k) { void k; },
      playBreach:       function ()  {},
      resumeIfNeeded:   function ()  {},
      playCommitteePulse: function () {},
      playLeverPull:    function () {},
      tryPlaySlot:      function () {},
      playQuotaReached: function () {}
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
      envEvent: [], passengerStack: [], uiWarning: []
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
  GameController.SAFE_NODE_FLOORS          = SAFE_NODE_FLOORS;
  GameController.floorLeverage             = floorLeverage;
  GameController.getOutcomeNarrative       = getOutcomeNarrative;
  GameController.OUTCOME_NARRATIVE_POOL    = OUTCOME_NARRATIVE_POOL;

  /* ---- 重置 ---- */
  GameController.prototype.reset = function () {
    this.floor               = 1;
    this.credits             = this.initialBet;
    this.corruption          = 0;
    this.quota               = 10000;          // 本局回收指标（固定）
    this.inventory           = [{ id: 'floppy-disk', count: 3 }];
    this.passengers          = [];
    this.activeEnvEvent      = null;
    this.brakeMitigationPending = false;
    this.state               = STATES.IDLE;
    this.rngLog              = [];
    this.lastOutcome         = null;
    this.lastSurprise        = null;
    this.lastPayout          = null;
    this._floorCreditsBefore = null;  // 用于 reroll 回滚
    this._pendingBreach      = false;
    this._quotaCrossed       = false; // 是否已触发 quota-reached 音效
    this._liquidationDebtAmount = 0;  // 强制清算时的负债快照（供 UI）
    this._peakCredits        = this.initialBet;  // 本局最高持有记录
    this._safeNodeVisited    = {};    // { floor: true } 已访问的安全屋
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
    return computeEffectiveThresholds(this.corruption, this.passengers, this.activeEnvEvent, 0, this.floor);
  };

  /** 本局最高持有资产记录（供结算界面展示） */
  GameController.prototype._updatePeakCredits = function () {
    if (this.credits > this._peakCredits) {
      this._peakCredits = this.credits;
    }
  };

  Object.defineProperty(GameController.prototype, 'passenger', {
    get: function () {
      return this.passengers && this.passengers.length ? this.passengers[0] : null;
    }
  });

  /** 净资产 = 当前资产 - 配额（负值代表负债） */
  GameController.prototype.getNetAsset = function () {
    return this.credits - this.quota;
  };

  /** 当前负债额（正值代表欠款，0 代表已达标） */
  GameController.prototype.getDebt = function () {
    return Math.max(0, this.quota - this.credits);
  };

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
  GameController.prototype.onUiWarning       = function (fn) { this._listeners.uiWarning.push(fn); };

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

  /**
   * 配额未达成拦截事件。
   * @param {{ text, quota, credits, debt }} data
   */
  GameController.prototype._emitUiWarning = function (data) {
    for (var i = 0; i < this._listeners.uiWarning.length; i++) {
      try { this._listeners.uiWarning[i](data, this); } catch (e) { console.error(e); }
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
      self._autoLiquidate();
    }, BREACH_MS);
  };

  /**
   * 倒计时归零：强制清算，不走正常事件带。
   */
  GameController.prototype._autoLiquidate = function () {
    if (this.state !== STATES.HISS_BREACH) return;
    this._clearBreachTimer();
    this._liquidationDebtAmount = (this.credits < this.quota)
      ? Math.max(0, Math.floor(this.quota - this.credits))
      : 0;
    this.credits     = 0;
    this.lastOutcome = {
      kind: 'LIQUIDATION', raw: -1, band: 'HISS_AUTO_LIQUIDATION',
      creditsMultiplier: 0, autoLiquidate: true
    };
    this._emitOutcome(this.lastOutcome);
    this._setState(STATES.GAME_OVER);
  };

  /* ---- 能力查询 ---- */

  GameController.prototype.canGoUp = function () {
    return this.state === STATES.IDLE || this.state === STATES.DECIDING;
    /* 注意：SAFE_NODE 状态下不允许上行，必须先通过 resolveSafeNode 完成选择 */
  };

  /** Hiss Breach / 安全屋期间均可结算撤离 */
  GameController.prototype.canCashOut = function () {
    return this.state === STATES.IDLE       ||
           this.state === STATES.DECIDING   ||
           this.state === STATES.SAFE_NODE  ||
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

  GameController.prototype._applyBaselineGrowth = function () {
    this.credits *= 1.1;
    this._updatePeakCredits();
  };

  /**
   * 动态复利杠杆结算。
   *
   * 公式：delta = stake × (creditsMultiplier - 1) × leverage
   *   - stake    = 本层进入快照（_floorCreditsBefore），优先用快照保证可审计性
   *   - leverage = floorLeverage(floor)，楼层越高、波动越大
   *
   * 养猪期特例（1-3 层）：
   *   - 负面 delta 最多扣减 stake × 12%（排除极大额度负面扣减）
   *   - stake 向下保底为 initialBet，避免滚雪球式快速归零
   */
  GameController.prototype._applyOutcomeToCredits = function (outcome) {
    if (outcome.kind === 'LIQUIDATION') { this.credits = 0; return; }
    var stake = this._floorCreditsBefore !== null ? this._floorCreditsBefore : this.credits;
    /* 养猪期：用初始注资保底（避免前几层小亏后雪崩） */
    if (this.floor <= 3) stake = Math.max(stake, this.initialBet);
    var lev  = floorLeverage(this.floor);
    var rate = outcome.creditsMultiplier - 1;   // 正 = 赚，负 = 亏
    /* 养猪期限幅：最大亏损不超过 stake 的 12% */
    if (this.floor <= 3 && rate < 0) rate = Math.max(rate, -0.12);
    var delta = Math.round(stake * rate * lev);
    this.credits = Math.max(0, this.credits + delta);
    /* 把实际有效倍率写回 outcome，供叙事判断 */
    outcome._effectiveDelta      = delta;
    outcome._effectiveMultiplier = stake > 0 ? (this.credits / stake) : 1;
    this._updatePeakCredits();
  };

  GameController.prototype._applySurprise = function (surprise) {
    if (surprise.kind === SurpriseEvent.KINDS.COIN_RAIN) {
      this.credits += surprise.creditsBonus;
      this._updatePeakCredits();
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

    /* 随机楼层跳跃（1-8 层），逐层累积基线增长与偏移 */
    var floorsJumped = Math.floor(this._rng() * 8) + 1;
    for (var fj = 0; fj < floorsJumped; fj++) {
      this.floor += 1;
      this._applyBaselineGrowth();
      if (fj > 0) this._addCorruption(CORRUPTION.PER_FLOOR);
    }
    this._floorCreditsBefore = this.credits;

    /* 乘客生命周期（到站后先下后上） */
    var pEvents = this._updatePassengers();

    /* 伪救赎安全屋：第 5 / 10 层（每局首次到达时触发） */
    if (SAFE_NODE_FLOORS.indexOf(this.floor) >= 0 && !this._safeNodeVisited[this.floor]) {
      var safeOutcome = {
        kind: 'SAFE_NODE', raw: -1, band: 'SAFE_NODE',
        creditsMultiplier: 1, purgePrice: Math.round(this.credits * 0.20)
      };
      this.lastOutcome = safeOutcome;
      this._emitOutcome(safeOutcome);
      this._pendingBreach = false;
      this._setState(STATES.REVEALING);
      return {
        ok: true, outcome: safeOutcome, surprise: null, safeNode: true,
        floorsJumped: floorsJumped,
        passengerBoarded: pEvents.boarded, passengerDeparted: pEvents.departed,
        envEvent: null, envActive: this.activeEnvEvent
      };
    }

    /* 每 5 层：动态环境事件轮换（安全屋层已提前返回，此处不重复触发） */
    var envRoll = null;
    if (this.floor >= 5 && this.floor % 5 === 0) {
      envRoll = rollEnvEventId(this._rng);
      this.activeEnvEvent = envRoll;
      this._emitEnvEvent({ id: envRoll, floor: this.floor });
    }

    /* 配额压力动态调整（越欠越险 + 临门一脚非线性波动） */
    var quotaShift = 0;
    if (this.quota > 0) {
      var qRatio = this.credits / this.quota;
      if (qRatio < 1) {
        /* 基础欠债压力：线性，最大 0.065 */
        quotaShift = Math.min(0.065, (1 - qRatio) * 0.075);
      }
      /* 临门一脚：qRatio ∈ [0.8, 1.2] 时产生非线性脉冲，峰值约 ±0.038 */
      var distFromQuota = Math.abs(qRatio - 1.0);
      if (distFromQuota < 0.2) {
        var near = 1 - distFromQuota / 0.2;
        quotaShift += 0.038 * near * near;
      }
    }

    /* 主事件（偏移指数 + 乘客叠加 + 环境 + 配额压力 + 楼层养猪期保护） */
    var r       = this._rng();
    var outcome = rollEventFromR(r, this.corruption, this.passengers, this.activeEnvEvent, quotaShift, this.floor);

    if (outcome.kind === 'LIQUIDATION') {
      this._liquidationDebtAmount = (this._floorCreditsBefore < this.quota)
        ? Math.max(0, Math.floor(this.quota - this._floorCreditsBefore))
        : 0;
    }

    this._applyOutcomeToCredits(outcome);

    /* 应急制动：强制清算时保留约 30%（相对本层基线快照） */
    if (outcome.kind === 'LIQUIDATION' && this.brakeMitigationPending) {
      this.credits = Math.max(0, Math.floor(this._floorCreditsBefore * 0.3));
      outcome.mitigated = true;
      outcome.displayKind = 'MITIGATED';
      this.brakeMitigationPending = false;
    }

    /* 乘客资本修正（叠加 + 组合加成） */
    if (this.passengers.length && outcome.kind !== 'LIQUIDATION') {
      var agg = aggregatePassengerModifiers(this.passengers);
      this.credits *= agg.creditsMult;
      if (agg.hasVolatile) {
        this.credits *= (this._rng() > 0.4 ? 1.25 : 0.75);
      }
    }

    this._applyCorruptionForOutcome(outcome);

    /* 配额穿越：资产首次从负转正时触发音效（每局仅一次） */
    if (!this._quotaCrossed && outcome.kind !== 'LIQUIDATION') {
      var preCredits = this._floorCreditsBefore || 0;
      if (preCredits < this.quota && this.credits >= this.quota) {
        this._quotaCrossed = true;
        if (typeof this.audio.playQuotaReached === 'function') {
          this.audio.playQuotaReached();
        }
      }
    }

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

    var surprise = null;
    if (outcome.kind !== 'LIQUIDATION') {
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
      floorsJumped: floorsJumped,
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

    if (this.lastOutcome && this.lastOutcome.kind === 'LIQUIDATION' && !this.lastOutcome.mitigated) {
      this._setState(STATES.GAME_OVER);
      return { ok: true, gameOver: true, breach: false };
    }

    /* 安全屋：切换到 SAFE_NODE 等待玩家选择 */
    if (this.lastOutcome && this.lastOutcome.kind === 'SAFE_NODE') {
      this._setState(STATES.SAFE_NODE);
      return { ok: true, gameOver: false, breach: false, safeNode: true };
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

  /**
   * 伪救赎安全屋：玩家选择净化（扣 20% 清零偏移指数）或跳过。
   * @param {'purge'|'skip'} choice
   */
  GameController.prototype.resolveSafeNode = function (choice) {
    if (this.state !== STATES.SAFE_NODE) return { ok: false, reason: 'not_safe_node' };
    this._safeNodeVisited[this.floor] = true;
    var cost = 0;
    if (choice === 'purge') {
      cost = Math.round(this.credits * 0.20);
      this.credits = Math.max(0, this.credits - cost);
      this.corruption = 0;
      this._emitCorruption();
      this._updatePeakCredits();
    }
    this._setState(STATES.DECIDING);
    return { ok: true, choice: choice, cost: cost };
  };

  /* ---- 结算撤离 ---- */

  /**
   * 公共撤离入口（带配额拦截）。
   * - 净资产 < 0 → 拦截，发出 UI_WARNING 事件，返回 { ok: false, reason: 'quota_not_met' }
   * - 净资产 ≥ 0 → 调用 cashOut()，正常结算
   */
  GameController.prototype.requestCashOut = function () {
    if (!this.canCashOut()) return { ok: false, reason: 'invalid_state' };
    if (this.getNetAsset() < 0) {
      var creditsNow = Math.floor(this.credits);
      var debt       = Math.floor(this.getDebt());
      this._emitUiWarning({
        text: '行政警告：指标未达成。\n当前收集额：¥' + creditsNow +
              '，目标配额：¥' + this.quota +
              '。\n若强行撤离，差额（¥' + debt + '）将从您的物理器官中等价扣除。',
        quota:   this.quota,
        credits: creditsNow,
        debt:    debt
      });
      return { ok: false, reason: 'quota_not_met', debt: debt };
    }
    return this.cashOut();
  };

  /**
   * 强行割肉撤离（配额未达成时玩家主动确认）。
   * 资产归零视为 GAME OVER，展示《资产清算通知书》。
   */
  GameController.prototype.forceDebtCashOut = function () {
    if (!this.canCashOut()) return { ok: false, reason: 'invalid_state' };
    this._clearBreachTimer();
    var payout = Math.floor(this.credits);
    var debt   = Math.floor(this.getDebt());
    this.lastPayout = payout;
    this._setState(STATES.DEBT_CASHOUT);
    for (var i = 0; i < this._listeners.cashOut.length; i++) {
      try { this._listeners.cashOut[i](payout, this, { debtForced: true, debt: debt }); } catch (e) { console.error(e); }
    }
    this.reset();
    return { ok: true, payout: payout, debt: debt, debtForced: true };
  };

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
   * - 新结果若为 LIQUIDATION → 直接进入 GAME_OVER
   * - 不重新触发 SurpriseEvent（重掷代价之一）
   *
   * @returns {{ ok, newOutcome, liquidated }}
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

    /* 重掷（使用最新偏移指数，代价立即体现；楼层养猪期保护继续有效） */
    var r          = this._rng();
    var newOutcome = rollEventFromR(r, this.corruption, this.passengers, this.activeEnvEvent, 0, this.floor);
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

    if (newOutcome.kind === 'LIQUIDATION') {
      this._setState(STATES.GAME_OVER);
      return { ok: true, newOutcome: newOutcome, liquidated: true };
    }

    return { ok: true, newOutcome: newOutcome, liquidated: false };
  };

  global.GameController = GameController;
})(typeof window !== 'undefined' ? window : globalThis);
