/**
 * Elevator Rush — GameController v3.1
 *
 * v3.1 变更：所有概率与数值参数从 config/game-events.json 加载。
 * 若加载失败则回退到内置默认值（与 v3 一致）。
 */

(function (global) {
  'use strict';

  /* =====================================================================
   * 配置加载器（同步 XHR / 全局注入 二选一）
   * ===================================================================== */

  var _externalConfig = null;

  function loadConfigSync() {
    if (global.__GAME_CONFIG__) return global.__GAME_CONFIG__;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'config/game-events.json', false);
      xhr.send(null);
      if (xhr.status === 200) return JSON.parse(xhr.responseText);
    } catch (e) {
      console.warn('[GameController] config/game-events.json 加载失败，使用内置默认值。', e);
    }
    return null;
  }

  _externalConfig = loadConfigSync();

  function cfg(path, fallback) {
    if (!_externalConfig) return fallback;
    var keys = path.split('.');
    var node = _externalConfig;
    for (var i = 0; i < keys.length; i++) {
      if (node == null || typeof node !== 'object') return fallback;
      node = node[keys[i]];
    }
    return (node !== undefined && node !== null) ? node : fallback;
  }

  /* =====================================================================
   * 常量（从配置读取，带内置默认值回退）
   * ===================================================================== */

  var THRESHOLDS = {
    LIQUIDATION_MAX: cfg('thresholds.liquidationMax', 0.12),
    NEGATIVE_MAX:    cfg('thresholds.negativeMax',    0.25),
    POSITIVE_MAX:    cfg('thresholds.positiveMax',    0.85)
  };

  var OUTCOME_BANDS = {
    NEGATIVE_MULT_MIN: cfg('outcomeBands.negative.creditsMultiplierMin', 0.7),
    NEGATIVE_MULT_MAX: cfg('outcomeBands.negative.creditsMultiplierMax', 0.9),
    POSITIVE_MULT_MIN: cfg('outcomeBands.positive.creditsMultiplierMin', 1.1),
    POSITIVE_MULT_MAX: cfg('outcomeBands.positive.creditsMultiplierMax', 1.2),
    DOUBLE_MULT:       cfg('outcomeBands.double.creditsMultiplier',      2)
  };

  var STATES = {
    IDLE:           'IDLE',
    ASCENDING:      'ASCENDING',
    EVALUATING:     'EVALUATING',
    CARD_SELECTION: 'CARD_SELECTION',
    REVEALING:      'REVEALING',
    DECIDING:       'DECIDING',
    HISS_BREACH:    'HISS_BREACH',
    SAFE_NODE:      'SAFE_NODE',
    GAME_OVER:      'GAME_OVER',
    CASHED_OUT:     'CASHED_OUT',
    DEBT_CASHOUT:   'DEBT_CASHOUT'
  };

  var SAFE_NODE_FLOORS = cfg('safeNode.floors', [5, 10]);

  var _floorLev = {
    earlyMax:      cfg('floorLeverage.earlyFloorMax',  3),
    earlyVal:      cfg('floorLeverage.earlyLeverage',  1.8),
    growth:        cfg('floorLeverage.growthPerFloor',  0.65),
    cap:           cfg('floorLeverage.maxLeverage',     8.0)
  };

  function floorLeverage(floor) {
    if (floor <= _floorLev.earlyMax) return _floorLev.earlyVal;
    return Math.min(_floorLev.cap, _floorLev.earlyVal + (floor - _floorLev.earlyMax) * _floorLev.growth);
  }

  var CORRUPTION = {
    MAX:               cfg('corruption.max',              3.0),
    LIQUIDATION_SHIFT: cfg('corruption.liquidationShift', 0.05),
    LIQUIDATION_SHIFT_CAP: cfg('corruption.liquidationShiftCap', 0.20),
    PER_FLOOR:    cfg('corruption.perFloor',    0.08),
    ON_POSITIVE:  cfg('corruption.onPositive',  0.05),
    ON_NEGATIVE:  cfg('corruption.onNegative',  0.12),
    ON_DOUBLE:    cfg('corruption.onDouble',    0.35),
    ON_REROLL:    cfg('corruption.onReroll',    0.22),
    ON_VIP_AUDIT: cfg('corruption.onVipAuditRelief', -0.11),
    ON_DANGER_UNVEIL: cfg('corruption.onDangerUnveil', 0.17)
  };

  var BREACH_PROB      = cfg('breach.baseProbability', 0.10);
  var BREACH_MS        = cfg('breach.durationMs',      5000);
  var BREACH_MIN_FLOOR = cfg('breach.minFloor',        5);
  var BREACH_MIN_PROB  = cfg('breach.minProbability',  0.028);
  var BREACH_MAX_PROB  = cfg('breach.maxProbability',  0.44);
  var BREACH_DANGER_BONUS    = cfg('breach.dangerBonus',        0.075);
  var BREACH_VIP_REDUCTION   = cfg('breach.vipReduction',       -0.042);
  var BREACH_VIP_DANGER_COMBO = cfg('breach.vipDangerComboBonus', 0.115);

  var PIG_PERIOD = {
    maxFloor:     cfg('pigPeriod.maxFloor',             3),
    negMaxRatio:  cfg('pigPeriod.negativeMaxRatio',     0.55),
    negMinThresh: cfg('pigPeriod.negativeMinThreshold', 0.06),
    maxLossRate:  cfg('pigPeriod.maxLossRate',          -0.12)
  };

  var BASELINE_GROWTH = cfg('baselineGrowth.multiplier', 1.1);

  var FLOORS_JUMPED_MIN = cfg('floorsJumped.min', 1);
  var FLOORS_JUMPED_MAX = cfg('floorsJumped.max', 8);

  var QUOTA_CFG = {
    target:            cfg('quota.target',             1000),
    pressureMaxShift:  cfg('quota.pressureMaxShift',   0.065),
    pressureLinear:    cfg('quota.pressureLinearFactor', 0.075),
    nearRange:         cfg('quota.nearQuotaRange',     0.2),
    nearPeak:          cfg('quota.nearQuotaPeakShift', 0.038)
  };

  var SPECULATOR_CFG = {
    enabled: cfg('speculatorProtocol.enabled', true),
    targetId: cfg('speculatorProtocol.targetIdentity', 'SCAMMER'),
    durationFloors: cfg('speculatorProtocol.durationFloors', 3),
    gainMult: cfg('speculatorProtocol.gainMult', 3),
    corMult: cfg('speculatorProtocol.corruptionOutcomeMult', 2)
  };

  var ANGEL_CFG = {
    enabled: cfg('angelInvestor.enabled', true),
    targetId: cfg('angelInvestor.targetIdentity', 'VIP'),
    durationFloors: cfg('angelInvestor.durationFloors', 2),
    rateBonus: cfg('angelInvestor.positiveRateBonus', 0.04)
  };

  var REROLL_BAILOUT_CFG = {
    enabled: cfg('rerollBailout.enabled', true),
    payRatio: cfg('rerollBailout.assetPayRatio', 0.4),
    fallbackMult: cfg('rerollBailout.fallbackCreditsMultiplier', 0.82)
  };

  var GOLDEN_POS_CFG = {
    probability: cfg('goldenPositive.probability', 0.015),
    creditsMultiplier: cfg('goldenPositive.creditsMultiplier', 10)
  };

  var CHAIN_LIGHTNING_CFG = {
    probability: cfg('chainLightning.probability', 0.0008),
    extraLossRatio: cfg('chainLightning.extraLossRatioOfSnapshot', 0.18),
    storageKey: cfg('chainLightning.storageKey', 'fbc_chain_margin_call_v1')
  };

  var ASSET_FREEZE_CFG = {
    probability: cfg('assetFreeze.probability', 0.035),
    lockRatio: cfg('assetFreeze.lockRatio', 0.5),
    floorsToUnlock: cfg('assetFreeze.floorsToUnlock', 3),
    cashoutClawback: cfg('assetFreeze.cashoutClawbackRatio', 0.2)
  };

  var COMBO_BLIND_CFG = {
    windowMs: cfg('comboBlindConfidence.windowMs', 1500),
    gainMult: cfg('comboBlindConfidence.gainMult', 1.05),
    hiddenQuotaShift: cfg('comboBlindConfidence.hiddenQuotaShiftBonus', 0.024)
  };

  var SUSPENSE_CFG = {
    liquidationMs: cfg('suspense.liquidationBusyWaitMs', 0),
    negativeLowRunwayMs: cfg('suspense.lowRunwayNegativeBusyWaitMs', 0),
    lowRunwayRatio: cfg('suspense.lowRunwayCreditsToQuotaMax', 0.22)
  };

  function tpl(str, o) {
    if (!str) return '';
    var out = String(str), k;
    o = o || {};
    for (k in o) {
      if (Object.prototype.hasOwnProperty.call(o, k)) {
        out = out.split('${' + k + '}').join(String(o[k]));
      }
    }
    return out;
  }

  function busyWaitSync(ms) {
    if (!ms || ms <= 0) return;
    var t = Date.now() + (ms | 0);
    while (Date.now() < t) { /* 同步悬念：冻结主线程直至揭晓 */ }
  }

  function nativeConfirm(msg) {
    try {
      if (typeof global.confirm === 'function') return !!global.confirm(msg);
    } catch (e) { void e; }
    return false;
  }

  function chainDebtLoad() {
    try {
      if (typeof global.localStorage === 'undefined') return 0;
      var v = parseInt(global.localStorage.getItem(CHAIN_LIGHTNING_CFG.storageKey), 10);
      return isNaN(v) ? 0 : Math.max(0, v);
    } catch (e) { return 0; }
  }

  function chainDebtAdd(amount) {
    try {
      if (typeof global.localStorage === 'undefined' || amount <= 0) return;
      var cur = chainDebtLoad();
      global.localStorage.setItem(CHAIN_LIGHTNING_CFG.storageKey, String(cur + Math.floor(amount)));
    } catch (e) { void e; }
  }

  function chainDebtClear() {
    try {
      if (typeof global.localStorage !== 'undefined') {
        global.localStorage.removeItem(CHAIN_LIGHTNING_CFG.storageKey);
      }
    } catch (e) { void e; }
  }

  var BRAKE_RETAIN = cfg('item.floppyDisk.brakeRetainRatio', 0.30);
  var FLOPPY_INIT_COUNT = cfg('item.floppyDisk.initialCount', 3);

  var SAFE_NODE_PURGE_COST = cfg('safeNode.purgeCostRatio', 0.20);

  /* =====================================================================
   * 乘客身份系统
   * ===================================================================== */

  var _pCfg = cfg('passenger', {});
  var _pTypes = _pCfg.types || {};

  function _buildPassengerType(id, defaults) {
    var t = _pTypes[id] || {};
    return {
      identity: id,
      weight: t.weight != null ? t.weight : defaults.weight,
      thresholdMod: {
        liquidationShift: t.liquidationShift != null ? t.liquidationShift : defaults.liquidationShift,
        negShift: t.negShift != null ? t.negShift : defaults.negShift
      },
      creditsMod: t.creditsMod != null ? t.creditsMod : defaults.creditsMod,
      volatile: t.volatile != null ? t.volatile : defaults.volatile,
      disguiseChance: t.disguiseChance != null ? t.disguiseChance : defaults.disguiseChance
    };
  }

  var PASSENGER = {
    MAX_ONBOARD:   cfg('passenger.maxOnboard',   2),
    BOARD_CHANCE:  cfg('passenger.boardChance',   0.40),
    DEPART_CHANCE: cfg('passenger.departChance',  0.30),
    MIN_FLOOR:     cfg('passenger.minFloor',      3),
    TYPES: {
      VIP:     _buildPassengerType('VIP',     { weight: 35, liquidationShift: -0.04, negShift: -0.02, creditsMod: 1.15, disguiseChance: 0,   volatile: false }),
      SCAMMER: _buildPassengerType('SCAMMER', { weight: 35, liquidationShift: 0.06,  negShift: 0.03,  creditsMod: 0.85, disguiseChance: 1.0, volatile: false }),
      DANGER:  _buildPassengerType('DANGER',  { weight: 30, liquidationShift: 0.08,  negShift: 0.02,  creditsMod: 1.0,  disguiseChance: 0.5, volatile: true })
    }
  };

  var PASSENGER_COMBOS = {
    vipScammer: {
      liquidationShift: cfg('passenger.combos.vipScammer.liquidationShift', 0.035),
      negShift:         cfg('passenger.combos.vipScammer.negShift',         0.02),
      creditsMult:      cfg('passenger.combos.vipScammer.creditsMult',      1.2)
    },
    vipDanger: {
      liquidationShift: cfg('passenger.combos.vipDanger.liquidationShift', -0.048),
      negShift:         cfg('passenger.combos.vipDanger.negShift',          0.062),
      creditsMult:      cfg('passenger.combos.vipDanger.creditsMult',       0.93)
    }
  };

  var VOLATILE_POS_CHANCE = cfg('passenger.volatilePositiveChance', 0.6);
  var VOLATILE_POS_MULT   = cfg('passenger.volatilePositiveMult',   1.25);
  var VOLATILE_NEG_MULT   = cfg('passenger.volatileNegativeMult',   0.75);

  /* =====================================================================
   * 事件叙事词典
   * ===================================================================== */

  var OUTCOME_NARRATIVE_POOL = {
    DOUBLE: [
      { tag: '资产裂变', text: '高维漏洞 · 账面暴增' },
      { tag: '意外分红', text: '超额津贴 · 估值跳' },
      { tag: '财富跃升', text: '套利窗开 · 杠杆满' }
    ],
    POSITIVE_HIGH: [
      { tag: '财富跃升', text: '大额增值 · 流动性入' },
      { tag: '盲盒大奖', text: '高纯晶体 · 已结算' },
      { tag: '资产裂变', text: '套利成 · 倍率活' }
    ],
    POSITIVE_LOW: [
      { tag: '意外分红', text: '合规红利入账' },
      { tag: '特别津贴', text: '微补入账 · 可上行翻倍' }
    ],
    GOLDEN_FLOOR: [
      { tag: '黄金楼层', text: '匿名放行 · 单笔十倍肥尾' },
      { tag: '财富跃升', text: '估值异常 · 黄金带收益' }
    ],
    NEGATIVE: [
      { tag: '恶意做空', text: '不明机构做空 · 账面缩' },
      { tag: '违规罚款', text: '触犯法案第7.3条 · 扣款' },
      { tag: '通货膨胀', text: '购买力蒸发 · 资产缩' }
    ],
    LIQUIDATION: [
      { tag: '强制清算', text: 'FBC 破产程序 · 账面核销' }
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
    } else if (outcome.kind === 'POSITIVE' && outcome.goldenFloor) {
      pool = OUTCOME_NARRATIVE_POOL.GOLDEN_FLOOR;
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
      liq += PASSENGER_COMBOS.vipScammer.liquidationShift;
      neg += PASSENGER_COMBOS.vipScammer.negShift;
      cred *= PASSENGER_COMBOS.vipScammer.creditsMult;
    }
    if (hasVip && hasDanger) {
      liq += PASSENGER_COMBOS.vipDanger.liquidationShift;
      neg += PASSENGER_COMBOS.vipDanger.negShift;
      cred *= PASSENGER_COMBOS.vipDanger.creditsMult;
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
    if (hasDanger) p += BREACH_DANGER_BONUS;
    if (hasVip) p += BREACH_VIP_REDUCTION;
    if (hasVip && hasDanger) p += BREACH_VIP_DANGER_COMBO;
    return Math.max(BREACH_MIN_PROB, Math.min(BREACH_MAX_PROB, p));
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
    description: '审查：揭伪装。制动：下次清算时按基准账面划留存（例基准¥200≈¥60，随层浮动）。',
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
    var shift = Math.min(corruption * CORRUPTION.LIQUIDATION_SHIFT, CORRUPTION.LIQUIDATION_SHIFT_CAP);
    var agg   = aggregatePassengerModifiers(passengers || []);
    var pLiq  = agg.liquidationShift || 0;
    var pNeg  = agg.negShift;
    quotaShift = quotaShift || 0;
    floor = floor || 0;

    var bandDriftBonus = cfg('envEvents.events.BAND_DRIFT.liquidationShiftBonus', 0.028);
    if (envEventId === 'BAND_DRIFT') {
      pLiq += bandDriftBonus;
    }

    if (floor > 0 && floor <= PIG_PERIOD.maxFloor) {
      return {
        liquidationMax: 0,
        negMax:         Math.max(PIG_PERIOD.negMinThresh, THRESHOLDS.NEGATIVE_MAX * PIG_PERIOD.negMaxRatio),
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
   * @param {function():number} [rngFn]  子掷骰（黄金楼层 / 连环标记）
   */
  function rollEventFromR(r, corruption, passengers, envEventId, quotaShift, floor, rngFn) {
    if (r < 0 || r >= 1) throw new Error('rollEventFromR: r must be in [0, 1)');
    corruption = corruption || 0;
    var rnd = typeof rngFn === 'function' ? rngFn : Math.random;
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
      var negRange = OUTCOME_BANDS.NEGATIVE_MULT_MAX - OUTCOME_BANDS.NEGATIVE_MULT_MIN;
      var negOut = {
        kind: 'NEGATIVE', raw: r,
        band: '[' + T.liquidationMax.toFixed(3) + ', ' + T.negMax.toFixed(3) + ')',
        creditsMultiplier: OUTCOME_BANDS.NEGATIVE_MULT_MIN + tN * negRange
      };
      if (rnd() < CHAIN_LIGHTNING_CFG.probability) negOut.chainLightning = true;
      return negOut;
    }
    if (r < T.posMax) {
      var tP = (r - T.negMax) / (T.posMax - T.negMax);
      var posRange = OUTCOME_BANDS.POSITIVE_MULT_MAX - OUTCOME_BANDS.POSITIVE_MULT_MIN;
      var cm = OUTCOME_BANDS.POSITIVE_MULT_MIN + tP * posRange;
      if (rnd() < GOLDEN_POS_CFG.probability) {
        cm = GOLDEN_POS_CFG.creditsMultiplier;
        return {
          kind: 'POSITIVE', raw: r,
          band: '[' + T.negMax.toFixed(3) + ', ' + T.posMax.toFixed(3) + ')',
          creditsMultiplier: cm,
          goldenFloor: true
        };
      }
      return {
        kind: 'POSITIVE', raw: r,
        band: '[' + T.negMax.toFixed(3) + ', ' + T.posMax.toFixed(3) + ')',
        creditsMultiplier: cm
      };
    }
    return {
      kind: 'DOUBLE', raw: r,
      band: '(' + T.posMax.toFixed(3) + ', 1.00]',
      creditsMultiplier: OUTCOME_BANDS.DOUBLE_MULT
    };
  }

  /* =====================================================================
   * SurpriseEvent（概率随贪婪线性增长）
   * ===================================================================== */

  var SurpriseEvent = {};

  SurpriseEvent.KINDS = { COIN_RAIN: 'COIN_RAIN', SKIP_FLOOR: 'SKIP_FLOOR' };
  SurpriseEvent.BASE_PROB_COIN_RAIN  = cfg('surprise.coinRain.baseProbability',  0.05);
  SurpriseEvent.BASE_PROB_SKIP_FLOOR = cfg('surprise.skipFloor.baseProbability', 0.04);
  SurpriseEvent.MIN_FLOOR            = cfg('surprise.minFloor', 3);
  SurpriseEvent.GREED_SAT            = cfg('surprise.greedSaturationFloor', 30);
  SurpriseEvent.COIN_RAIN_RATIO      = cfg('surprise.coinRain.creditsBonusRatio', 0.25);
  SurpriseEvent.SKIP_FLOORS          = cfg('surprise.skipFloor.floorsToSkip', 1);

  SurpriseEvent.tryTrigger = function (game, sr) {
    if (game.floor < SurpriseEvent.MIN_FLOOR) return null;
    var greed = Math.min((game.floor - 1) / SurpriseEvent.GREED_SAT, 1);
    var pC = SurpriseEvent.BASE_PROB_COIN_RAIN  * (1 + greed);
    var pS = SurpriseEvent.BASE_PROB_SKIP_FLOOR * (1 + greed);
    if (sr < pC) {
      return { kind: SurpriseEvent.KINDS.COIN_RAIN,
               creditsBonus: Math.max(1, Math.floor(game.credits * SurpriseEvent.COIN_RAIN_RATIO)),
               floorBonus: 0 };
    }
    if (sr < pC + pS) {
      return { kind: SurpriseEvent.KINDS.SKIP_FLOOR, creditsBonus: 0, floorBonus: SurpriseEvent.SKIP_FLOORS };
    }
    return null;
  };

  /* =====================================================================
   * 卡牌选取系统（丧尸楼层）
   * ===================================================================== */

  var CARD_CFG = cfg('cardSelection', {});
  var CARD_ENABLED     = CARD_CFG.enabled !== false;
  var CARDS_PER_ROUND  = CARD_CFG.cardsPerRound || 3;
  var CARD_IDENTITIES  = CARD_CFG.identities || [
    { id: 'elder', name: '神秘老人', glyph: '👴', weight: 25, luckBias: 0.05 },
    { id: 'child', name: '诡异小孩', glyph: '👦', weight: 20, luckBias: -0.08 },
    { id: 'handsome', name: '俊美青年', glyph: '🧑', weight: 20, luckBias: 0 }
  ];
  var CARD_REWARD_EVENTS = CARD_CFG.rewardEvents || [];
  var CARD_BUST_EVENTS   = CARD_CFG.bustEvents || [];
  var CARD_REWARD_WEIGHT = CARD_CFG.rewardTotalWeight || 0.55;

  function _weightedPick(list, rng) {
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += (list[i].weight || 1);
    var r = rng() * total, cum = 0;
    for (i = 0; i < list.length; i++) {
      cum += (list[i].weight || 1);
      if (r < cum) return list[i];
    }
    return list[list.length - 1];
  }

  function _pickUniqueIdentities(count, rng) {
    var pool = CARD_IDENTITIES.slice();
    var result = [];
    for (var i = 0; i < count && pool.length > 0; i++) {
      var picked = _weightedPick(pool, rng);
      result.push(picked);
      pool = pool.filter(function (x) { return x.id !== picked.id; });
    }
    return result;
  }

  function generateCardHand(game) {
    var identities = _pickUniqueIdentities(CARDS_PER_ROUND, game._rng);
    var cards = [];
    var hasReward = CARD_REWARD_EVENTS.length > 0;
    var hasBust = CARD_BUST_EVENTS.length > 0;
    for (var i = 0; i < identities.length; i++) {
      var ident = identities[i];
      var bias = ident.luckBias || 0;
      var wantReward = game._rng() < (CARD_REWARD_WEIGHT + bias);
      var evt;
      if (wantReward && hasReward) {
        evt = _weightedPick(CARD_REWARD_EVENTS, game._rng);
        cards.push({
          identity: ident,
          type: 'reward',
          event: {
            id: evt.id, name: evt.name, description: evt.description,
            creditsBonusRatio: evt.creditsBonusRatio || 0,
            corruptionDelta: evt.corruptionDelta || 0
          }
        });
      } else if (hasBust) {
        evt = _weightedPick(CARD_BUST_EVENTS, game._rng);
        cards.push({
          identity: ident,
          type: 'bust',
          event: {
            id: evt.id, name: evt.name, description: evt.description,
            creditsLossRatio: evt.creditsLossRatio || 0,
            corruptionDelta: evt.corruptionDelta || 0
          }
        });
      } else if (hasReward) {
        evt = _weightedPick(CARD_REWARD_EVENTS, game._rng);
        cards.push({
          identity: ident,
          type: 'reward',
          event: {
            id: evt.id, name: evt.name, description: evt.description,
            creditsBonusRatio: evt.creditsBonusRatio || 0,
            corruptionDelta: evt.corruptionDelta || 0
          }
        });
      }
    }
    return cards;
  }

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
   * @param {number}            [options.initialBet=200]
   * @param {function():number} [options.random]     可注入确定性 RNG
   * @param {object}            [options.audio]      AudioEngine 实例
   */
  function GameController(options) {
    options = options || {};
    this.initialBet  = typeof options.initialBet === 'number' ? options.initialBet : 200;
    this._rng        = typeof options.random === 'function'   ? options.random : Math.random;
    this.audio       = options.audio || createAudioStub();
    this._listeners  = {
      state: [], outcome: [], surprise: [], cashOut: [],
      corruption: [], breach: [], reroll: [],
      passengerBoard: [], passengerLeave: [], passengerReveal: [],
      envEvent: [], passengerStack: [], uiWarning: [],
      cardHand: [], cardResult: []
    };
    this._breachTimer   = null;
    this._breachDeadline = 0;
    this.reset();
  }

  /* ---- 静态导出 ---- */
  GameController.STATES                    = STATES;
  GameController.THRESHOLDS                = THRESHOLDS;
  GameController.OUTCOME_BANDS             = OUTCOME_BANDS;
  GameController.CORRUPTION                = CORRUPTION;
  GameController.ITEM_REGISTRY             = ITEM_REGISTRY;
  GameController.SurpriseEvent             = SurpriseEvent;
  GameController.rollEventFromR            = rollEventFromR;
  GameController.computeEffectiveThresholds = computeEffectiveThresholds;
  GameController.computeBreachProbability  = computeBreachProbability;
  GameController.BREACH_DURATION_MS        = BREACH_MS;
  GameController.PASSENGER                 = PASSENGER;
  GameController.PASSENGER_COMBOS          = PASSENGER_COMBOS;
  GameController.createPassenger           = createPassenger;
  GameController.ENV_EVENT_IDS             = ENV_EVENT_IDS;
  GameController.SAFE_NODE_FLOORS          = SAFE_NODE_FLOORS;
  GameController.floorLeverage             = floorLeverage;
  GameController.getOutcomeNarrative       = getOutcomeNarrative;
  GameController.OUTCOME_NARRATIVE_POOL    = OUTCOME_NARRATIVE_POOL;
  GameController.PIG_PERIOD                = PIG_PERIOD;
  GameController.QUOTA_CFG                 = QUOTA_CFG;
  GameController.CARD_ENABLED              = CARD_ENABLED;
  GameController.CARD_IDENTITIES           = CARD_IDENTITIES;
  GameController.generateCardHand          = generateCardHand;
  GameController.cfg                       = cfg;

  /* ---- 重置 ---- */
  GameController.prototype.reset = function () {
    this.floor               = 1;
    this.credits             = this.initialBet;
    this.corruption          = 0;
    this.quota               = QUOTA_CFG.target;
    this.inventory           = [{ id: 'floppy-disk', count: FLOPPY_INIT_COUNT }];
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
    this._pendingCards       = null;  // 当前卡牌手牌
    this._cardSelectionDone  = false;
    this._speculatorContract = null;  // { floorsRemaining, gainMult, corMult }
    this._angelLift          = null;   // { floorsRemaining, rateBonus }
    this._blindConfidenceActive = false;
    this._lastDecidingAt     = 0;
    this._frozenPrincipal    = 0;
    this._frozenUnlockFloor  = 999999;
    var chainDebt = chainDebtLoad();
    if (chainDebt > 0) {
      this.credits = Math.max(0, Math.floor(this.credits - chainDebt));
      chainDebtClear();
    }
    this._clearBreachTimer();
    this._emitState(STATES.IDLE, null);
  };

  /* ---- 计算属性 ---- */

  Object.defineProperty(GameController.prototype, 'greedFactor', {
    get: function () { return Math.min((this.floor - 1) / SurpriseEvent.GREED_SAT, 1); }
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
    return this.initialBet * Math.pow(BASELINE_GROWTH, this.floor - 1);
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
  GameController.prototype.onCardHand        = function (fn) { this._listeners.cardHand.push(fn); };
  GameController.prototype.onCardResult      = function (fn) { this._listeners.cardResult.push(fn); };

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
    var ak = outcome.kind === 'POSITIVE' && outcome.goldenFloor ? 'POSITIVE' : outcome.kind;
    this.audio.playOutcome(ak);
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

  GameController.prototype._stampDecidingEnter = function () {
    this._lastDecidingAt = Date.now();
  };

  /**
   * 激进投机者对赌（浏览器原生 confirm，不新增 DOM）。
   * @param {boolean} fromScanReveal  是否为审查揭穿后的话术变体
   */
  GameController.prototype._tryOfferSpeculatorContract = function (fromScanReveal) {
    if (!SPECULATOR_CFG.enabled) return;
    if (this._speculatorContract && this._speculatorContract.floorsRemaining > 0) return;
    var key = fromScanReveal ? 'copy.speculatorProtocolScan' : 'copy.speculatorProtocol';
    var msg = tpl(cfg(key, ''), {
      durationFloors: SPECULATOR_CFG.durationFloors,
      gainMult: SPECULATOR_CFG.gainMult,
      corruptionMult: SPECULATOR_CFG.corMult
    });
    if (!msg) return;
    if (!nativeConfirm(msg)) return;
    this._speculatorContract = {
      floorsRemaining: SPECULATOR_CFG.durationFloors,
      gainMult: SPECULATOR_CFG.gainMult,
      corMult: SPECULATOR_CFG.corMult
    };
  };

  GameController.prototype._tryAngelLiftOnBoard = function (p) {
    if (!ANGEL_CFG.enabled || !p || p.isDisguised) return;
    if (p.identity !== ANGEL_CFG.targetId) return;
    this._angelLift = {
      floorsRemaining: ANGEL_CFG.durationFloors,
      rateBonus: ANGEL_CFG.rateBonus
    };
  };

  /** 每层结算末尾：连击窗口标记、对赌/天使投资人回合衰减 */
  GameController.prototype._tickFloorMetaBuffs = function () {
    this._blindConfidenceActive = false;
    if (this._speculatorContract && this._speculatorContract.floorsRemaining > 0) {
      this._speculatorContract.floorsRemaining--;
      if (this._speculatorContract.floorsRemaining <= 0) this._speculatorContract = null;
    }
    if (this._angelLift && this._angelLift.floorsRemaining > 0) {
      this._angelLift.floorsRemaining--;
      if (this._angelLift.floorsRemaining <= 0) this._angelLift = null;
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
      if (p.identity === SPECULATOR_CFG.targetId && SPECULATOR_CFG.enabled && !p.isDisguised) {
        this._tryOfferSpeculatorContract(false);
      }
      this._tryAngelLiftOnBoard(p);
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

    if (identity === SPECULATOR_CFG.targetId && SPECULATOR_CFG.enabled && wasDisguised) {
      this._tryOfferSpeculatorContract(true);
    }

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
      this._adjustCorruption(CORRUPTION.ON_VIP_AUDIT);
      auditRelief = true;
    }
    if (identity === 'DANGER' && wasDisguised) {
      this._addCorruption(CORRUPTION.ON_DANGER_UNVEIL);
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
    var surgeMultiplier = cfg('envEvents.events.CORRUPTION_SURGE.corruptionMultiplier', 2);
    var em = this.activeEnvEvent === 'CORRUPTION_SURGE' ? surgeMultiplier : 1;
    var scm = (this._speculatorContract && this._speculatorContract.floorsRemaining > 0)
      ? SPECULATOR_CFG.corMult
      : 1;
    this._addCorruption(CORRUPTION.PER_FLOOR * em);
    if (outcome.kind === 'DOUBLE')   this._addCorruption(CORRUPTION.ON_DOUBLE * em * scm);
    if (outcome.kind === 'NEGATIVE') this._addCorruption(CORRUPTION.ON_NEGATIVE * em * scm);
    if (outcome.kind === 'POSITIVE') this._addCorruption(CORRUPTION.ON_POSITIVE * em * scm);
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

  /* ---- 卡牌派发与选择 ---- */

  GameController.prototype._emitCardHand = function (cards) {
    for (var i = 0; i < this._listeners.cardHand.length; i++) {
      try { this._listeners.cardHand[i](cards, this); } catch (e) { console.error(e); }
    }
  };

  GameController.prototype._emitCardResult = function (result) {
    for (var i = 0; i < this._listeners.cardResult.length; i++) {
      try { this._listeners.cardResult[i](result, this); } catch (e) { console.error(e); }
    }
  };

  GameController.prototype.selectCard = function (index) {
    if (this.state !== STATES.CARD_SELECTION) return { ok: false, reason: 'not_card_selection' };
    if (!this._pendingCards || index < 0 || index >= this._pendingCards.length) {
      return { ok: false, reason: 'invalid_card_index' };
    }
    var card = this._pendingCards[index];
    var evt = card.event;
    var delta = 0;

    if (card.type === 'reward') {
      delta = Math.max(1, Math.floor(this.credits * (evt.creditsBonusRatio || 0)));
      this.credits += delta;
      this._updatePeakCredits();
    } else {
      delta = Math.floor(this.credits * (evt.creditsLossRatio || 0));
      this.credits = Math.max(0, this.credits - delta);
    }

    if (evt.corruptionDelta) {
      this._adjustCorruption(evt.corruptionDelta);
    }

    var result = {
      card: card,
      index: index,
      allCards: this._pendingCards,
      creditsDelta: card.type === 'reward' ? delta : -delta,
      creditsAfter: Math.floor(this.credits)
    };

    this._pendingCards = null;
    this._cardSelectionDone = true;
    this._emitCardResult(result);
    this._setState(STATES.REVEALING);
    return { ok: true, result: result };
  };

  /**
   * 卡牌 UI 无法展开时的逃生阀（例如历史版本发出空牌组仍进入 CARD_SELECTION）。
   * 将状态切回 REVEALING 以便 UI 继续 finishReveal 流程。
   */
  GameController.prototype.skipEmptyCardSelection = function () {
    if (this.state !== STATES.CARD_SELECTION) return { ok: false };
    if (this._pendingCards && this._pendingCards.length > 0) return { ok: false };
    this._pendingCards = null;
    this._cardSelectionDone = true;
    this._setState(STATES.REVEALING);
    return { ok: true };
  };

  /* ---- 主流程 ---- */

  GameController.prototype.startAscend = function () {
    if (!this.canGoUp()) return { ok: false, reason: 'invalid_state' };
    this.audio.resumeIfNeeded();
    this._blindConfidenceActive = false;
    if (this._lastDecidingAt && (Date.now() - this._lastDecidingAt) < COMBO_BLIND_CFG.windowMs) {
      this._blindConfidenceActive = true;
    }
    this._setState(STATES.ASCENDING);
    return { ok: true };
  };

  GameController.prototype._applyBaselineGrowth = function () {
    this.credits *= BASELINE_GROWTH;
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
    if (this.floor <= PIG_PERIOD.maxFloor) stake = Math.max(stake, this.initialBet);
    var lev  = floorLeverage(this.floor);
    var rate = outcome.creditsMultiplier - 1;
    if (this._angelLift && this._angelLift.floorsRemaining > 0 &&
        (outcome.kind === 'POSITIVE' || outcome.kind === 'DOUBLE')) {
      rate += this._angelLift.rateBonus;
    }
    if (this.floor <= PIG_PERIOD.maxFloor && rate < 0) rate = Math.max(rate, PIG_PERIOD.maxLossRate);
    var delta = Math.round(stake * rate * lev);
    if (delta > 0 && this._speculatorContract && this._speculatorContract.floorsRemaining > 0 &&
        (outcome.kind === 'POSITIVE' || outcome.kind === 'DOUBLE')) {
      delta = Math.round(delta * SPECULATOR_CFG.gainMult);
    }
    if (delta > 0 && this._blindConfidenceActive) {
      delta = Math.round(delta * COMBO_BLIND_CFG.gainMult);
    }
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

    var floorsJumped = Math.floor(this._rng() * (FLOORS_JUMPED_MAX - FLOORS_JUMPED_MIN + 1)) + FLOORS_JUMPED_MIN;
    for (var fj = 0; fj < floorsJumped; fj++) {
      this.floor += 1;
      this._applyBaselineGrowth();
      if (fj > 0) this._addCorruption(CORRUPTION.PER_FLOOR);
    }
    if (this._frozenPrincipal > 0 && this.floor >= this._frozenUnlockFloor) {
      this.credits += this._frozenPrincipal;
      this._frozenPrincipal = 0;
      this._frozenUnlockFloor = 999999;
      this._updatePeakCredits();
    }
    this._floorCreditsBefore = this.credits;

    /* 乘客生命周期（到站后先下后上） */
    var pEvents = this._updatePassengers();

    /* 伪救赎安全屋：第 5 / 10 层（每局首次到达时触发） */
    if (SAFE_NODE_FLOORS.indexOf(this.floor) >= 0 && !this._safeNodeVisited[this.floor]) {
      var safeOutcome = {
        kind: 'SAFE_NODE', raw: -1, band: 'SAFE_NODE',
        creditsMultiplier: 1, purgePrice: Math.round(this.credits * SAFE_NODE_PURGE_COST)
      };
      this.lastOutcome = safeOutcome;
      this._emitOutcome(safeOutcome);
      this._pendingBreach = false;
      this._setState(STATES.REVEALING);
      this._tickFloorMetaBuffs();
      return {
        ok: true, outcome: safeOutcome, surprise: null, safeNode: true,
        floorsJumped: floorsJumped,
        passengerBoarded: pEvents.boarded, passengerDeparted: pEvents.departed,
        envEvent: null, envActive: this.activeEnvEvent
      };
    }

    var envInterval = cfg('envEvents.triggerInterval', 5);
    var envMinFloor = cfg('envEvents.minFloor', 5);
    var envRoll = null;
    if (this.floor >= envMinFloor && this.floor % envInterval === 0) {
      envRoll = rollEnvEventId(this._rng);
      this.activeEnvEvent = envRoll;
      this._emitEnvEvent({ id: envRoll, floor: this.floor });
    }

    var quotaShift = 0;
    if (this.quota > 0) {
      var qRatio = this.credits / this.quota;
      if (qRatio < 1) {
        quotaShift = Math.min(QUOTA_CFG.pressureMaxShift, (1 - qRatio) * QUOTA_CFG.pressureLinear);
      }
      var distFromQuota = Math.abs(qRatio - 1.0);
      if (distFromQuota < QUOTA_CFG.nearRange) {
        var near = 1 - distFromQuota / QUOTA_CFG.nearRange;
        quotaShift += QUOTA_CFG.nearPeak * near * near;
      }
    }
    if (this._blindConfidenceActive) {
      quotaShift += COMBO_BLIND_CFG.hiddenQuotaShift;
    }

    /* 主事件（偏移指数 + 乘客叠加 + 环境 + 配额压力 + 楼层养猪期保护） */
    var r       = this._rng();
    var rngSub  = this._rng;
    var outcome = rollEventFromR(r, this.corruption, this.passengers, this.activeEnvEvent, quotaShift, this.floor, rngSub);

    if (outcome.kind === 'LIQUIDATION' && SUSPENSE_CFG.liquidationMs > 0) {
      busyWaitSync(SUSPENSE_CFG.liquidationMs);
    }
    if (outcome.kind === 'NEGATIVE' && SUSPENSE_CFG.negativeLowRunwayMs > 0 &&
        this._floorCreditsBefore < this.quota * SUSPENSE_CFG.lowRunwayRatio) {
      busyWaitSync(SUSPENSE_CFG.negativeLowRunwayMs);
    }

    if (outcome.kind === 'LIQUIDATION') {
      this._liquidationDebtAmount = (this._floorCreditsBefore < this.quota)
        ? Math.max(0, Math.floor(this.quota - this._floorCreditsBefore))
        : 0;
    }

    this._applyOutcomeToCredits(outcome);

    if (outcome.kind === 'LIQUIDATION' && this.brakeMitigationPending) {
      this.credits = Math.max(0, Math.floor(this._floorCreditsBefore * BRAKE_RETAIN));
      outcome.mitigated = true;
      outcome.displayKind = 'MITIGATED';
      this.brakeMitigationPending = false;
    }

    /* 乘客资本修正（叠加 + 组合加成） */
    if (this.passengers.length && outcome.kind !== 'LIQUIDATION') {
      var agg = aggregatePassengerModifiers(this.passengers);
      this.credits *= agg.creditsMult;
      if (agg.hasVolatile) {
        this.credits *= (this._rng() < VOLATILE_POS_CHANCE ? VOLATILE_POS_MULT : VOLATILE_NEG_MULT);
      }
    }

    if (outcome.kind === 'NEGATIVE' && outcome.chainLightning) {
      var chExtra = Math.round(this._floorCreditsBefore * CHAIN_LIGHTNING_CFG.extraLossRatio);
      this.credits = Math.max(0, this.credits - chExtra);
      chainDebtAdd(chExtra);
      outcome._chainLightningLoss = chExtra;
    }

    if (outcome.kind !== 'LIQUIDATION' && this._rng() < ASSET_FREEZE_CFG.probability) {
      var lockAmt = Math.round(this.credits * ASSET_FREEZE_CFG.lockRatio);
      lockAmt = Math.min(Math.max(0, lockAmt), Math.floor(this.credits));
      if (lockAmt > 0) {
        this.credits -= lockAmt;
        this._frozenPrincipal += lockAmt;
        this._frozenUnlockFloor = this.floor + ASSET_FREEZE_CFG.floorsToUnlock;
        outcome.assetFreezeLocked = lockAmt;
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

    this._tickFloorMetaBuffs();

    /* 卡牌选取阶段：非清算时进入卡牌选择（无牌可发时不得卡死在 CARD_SELECTION） */
    if (CARD_ENABLED && outcome.kind !== 'LIQUIDATION') {
      this._cardSelectionDone = false;
      this._pendingCards = generateCardHand(this);
      if (this._pendingCards && this._pendingCards.length > 0) {
        this._setState(STATES.CARD_SELECTION);
        this._emitCardHand(this._pendingCards);
        return {
          ok: true, outcome: outcome, surprise: surprise,
          floorsJumped: floorsJumped, cardSelection: true,
          passengerBoarded: pEvents.boarded, passengerDeparted: pEvents.departed,
          envEvent: envRoll, envActive: this.activeEnvEvent
        };
      }
      this._pendingCards = null;
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
    this._stampDecidingEnter();
    return { ok: true, gameOver: false, breach: false };
  };

  /**
   * 伪救赎安全屋：玩家选择净化（按净资产比例划扣一笔整数金额并清零偏移指数）或跳过。
   * @param {'purge'|'skip'} choice
   */
  GameController.prototype.resolveSafeNode = function (choice) {
    if (this.state !== STATES.SAFE_NODE) return { ok: false, reason: 'not_safe_node' };
    this._safeNodeVisited[this.floor] = true;
    var cost = 0;
    if (choice === 'purge') {
      cost = Math.round(this.credits * SAFE_NODE_PURGE_COST);
      this.credits = Math.max(0, this.credits - cost);
      this.corruption = 0;
      this._emitCorruption();
      this._updatePeakCredits();
    }
    this._setState(STATES.DECIDING);
    this._stampDecidingEnter();
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
      var nudgeTpl   = cfg('copy.quotaNudge', '');
      var warnText   = nudgeTpl
        ? tpl(nudgeTpl, { credits: creditsNow, quota: this.quota, debt: debt })
        : ('未达配额 ¥' + this.quota + '，当前 ¥' + creditsNow +
          '。\n强行撤离划扣差额 ¥' + debt + '。');
      this._emitUiWarning({
        text: warnText,
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
  GameController.prototype._applyEarlyCashoutFreezePenalty = function () {
    if (!(this._frozenPrincipal > 0 && this.floor < this._frozenUnlockFloor)) return;
    var claw = Math.round(this.credits * ASSET_FREEZE_CFG.cashoutClawback);
    this.credits = Math.max(0, this.credits - claw);
    this._frozenPrincipal = 0;
    this._frozenUnlockFloor = 999999;
  };

  GameController.prototype.forceDebtCashOut = function () {
    if (!this.canCashOut()) return { ok: false, reason: 'invalid_state' };
    this._clearBreachTimer();
    this._applyEarlyCashoutFreezePenalty();
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
    this._applyEarlyCashoutFreezePenalty();
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

    var r          = this._rng();
    var rngSub     = this._rng;
    var newOutcome = rollEventFromR(r, this.corruption, this.passengers, this.activeEnvEvent, 0, this.floor, rngSub);

    if (newOutcome.kind === 'LIQUIDATION' && REROLL_BAILOUT_CFG.enabled) {
      var pay = Math.round(this.credits * REROLL_BAILOUT_CFG.payRatio);
      var bailMsg = tpl(cfg('copy.rerollBailout', ''), {
        pay: pay,
        balance: Math.floor(this.credits)
      });
      if (bailMsg && nativeConfirm(bailMsg)) {
        this.credits = Math.max(0, this.credits - pay);
        r = this._rng();
        newOutcome = rollEventFromR(r, this.corruption, this.passengers, this.activeEnvEvent, 0, this.floor, rngSub);
        if (newOutcome.kind === 'LIQUIDATION') {
          newOutcome = {
            kind: 'NEGATIVE',
            raw: r,
            band: 'REROLL_BAILOUT_FALLBACK',
            creditsMultiplier: REROLL_BAILOUT_CFG.fallbackMult,
            bailoutRewrite: true
          };
        }
      }
    }

    if (newOutcome.kind === 'LIQUIDATION' && SUSPENSE_CFG.liquidationMs > 0) {
      busyWaitSync(SUSPENSE_CFG.liquidationMs);
    }
    if (newOutcome.kind === 'NEGATIVE' && SUSPENSE_CFG.negativeLowRunwayMs > 0 &&
        this._floorCreditsBefore < this.quota * SUSPENSE_CFG.lowRunwayRatio) {
      busyWaitSync(SUSPENSE_CFG.negativeLowRunwayMs);
    }

    if (newOutcome.kind === 'LIQUIDATION') {
      this._liquidationDebtAmount = (this._floorCreditsBefore < this.quota)
        ? Math.max(0, Math.floor(this.quota - this._floorCreditsBefore))
        : 0;
    }

    this._applyOutcomeToCredits(newOutcome);

    if (newOutcome.kind === 'LIQUIDATION' && this.brakeMitigationPending) {
      this.credits = Math.max(0, Math.floor(this._floorCreditsBefore * BRAKE_RETAIN));
      newOutcome.mitigated = true;
      newOutcome.displayKind = 'MITIGATED';
      this.brakeMitigationPending = false;
    }

    if (this.passengers.length && newOutcome.kind !== 'LIQUIDATION') {
      var aggR = aggregatePassengerModifiers(this.passengers);
      this.credits *= aggR.creditsMult;
      if (aggR.hasVolatile) {
        this.credits *= (this._rng() < VOLATILE_POS_CHANCE ? VOLATILE_POS_MULT : VOLATILE_NEG_MULT);
      }
    }

    if (newOutcome.kind === 'NEGATIVE' && newOutcome.chainLightning) {
      var chR = Math.round(this._floorCreditsBefore * CHAIN_LIGHTNING_CFG.extraLossRatio);
      this.credits = Math.max(0, this.credits - chR);
      chainDebtAdd(chR);
      newOutcome._chainLightningLoss = chR;
    }

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
