/**
 * Elevator Rush — GameController v3.2
 *
 * v3.2 变更：
 *   ‑ 删卡牌、连环爆雷、资产冻结、软盘重掷买断（含 _frozenPrincipal / chainDebt 全栈）。
 *   ‑ 新增 LOCKER_SELECTING 状态：开门后玩家在多个封存货舱中选盘，倒计时由 UI 维护。
 *   ‑ 新增 generateLockerHand / selectLocker / autoSelectLocker（FBC 代决议）。
 *   ‑ 生涯档案新增 total_committee_overrides 字段。
 *   ‑ 乘客系统扩展为 5 类（VIP / SCAMMER / DANGER / INFORMER / CLEANER）。
 *   ‑ 配置加载错误时回退到内置默认值（与 v3.1 对齐）。
 */

(function (global) {
  'use strict';

  /* =====================================================================
   * 配置加载器
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
   * 局长生涯档案 — FBC 绩效核查中枢 (LocalStorage 持久化)
   * ===================================================================== */
  var _FBC_CAREER_KEY = 'fbc_career_archive_v1';

  function _careerBlank() {
    return {
      total_buy_in:               0,   /* v0.06：累计建仓投入（玩家每局开局的 initialBet 之和） */
      total_credits_collected:    0,   /* 累计核销资产（成功撤离到账之和） */
      total_credits_lost:         0,   /* v0.06：累计清算损失（清算时该局的 buy-in 之和；用于直观对账） */
      total_floors_climbed:       0,
      max_floor_reached:          0,
      total_liquidations:         0,
      total_committee_overrides:  0,
      total_quota_crossings:      0,   /* v0.06：累计配额过线次数（每局至多 +1） */
      total_debt_cashouts:        0    /* v0.06：累计未达配额触发的债务撤离次数 */
    };
  }

  function careerLoad() {
    var b = _careerBlank();
    try {
      var raw = (typeof localStorage !== 'undefined')
        ? localStorage.getItem(_FBC_CAREER_KEY) : null;
      if (raw) {
        var d = JSON.parse(raw);
        return {
          total_buy_in:               d.total_buy_in               || 0,
          total_credits_collected:    d.total_credits_collected    || 0,
          total_credits_lost:         d.total_credits_lost         || 0,
          total_floors_climbed:       d.total_floors_climbed       || 0,
          max_floor_reached:          d.max_floor_reached          || 0,
          total_liquidations:         d.total_liquidations         || 0,
          total_committee_overrides:  d.total_committee_overrides  || 0,
          total_quota_crossings:      d.total_quota_crossings      || 0,
          total_debt_cashouts:        d.total_debt_cashouts        || 0
        };
      }
    } catch (e) {}
    return b;
  }

  function _careerSave(data) {
    try {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem(_FBC_CAREER_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  /**
   * 原子化合并：所有新增字段与旧字段共用同一 key，向后兼容。
   * 支持的 delta：
   *   - buyIn:           累加到 total_buy_in（玩家每次"建仓"在 deploy 入口调用）
   *   - creditsCollected:累加到 total_credits_collected（成功撤离）
   *   - creditsLost:     累加到 total_credits_lost（清算时显式记录损失金额；通常 = 该局 buy-in）
   *   - floorsClimbed / floorReached / liquidation / committeeOverride: 同 0.05
   */
  function careerMerge(delta) {
    var a = careerLoad();
    if (delta.buyIn)               a.total_buy_in              += Math.max(0, Math.floor(delta.buyIn));
    if (delta.creditsCollected)    a.total_credits_collected   += Math.max(0, Math.floor(delta.creditsCollected));
    if (delta.creditsLost)         a.total_credits_lost        += Math.max(0, Math.floor(delta.creditsLost));
    if (delta.floorsClimbed)       a.total_floors_climbed      += delta.floorsClimbed;
    if (delta.floorReached)        a.max_floor_reached          = Math.max(a.max_floor_reached, delta.floorReached);
    if (delta.liquidation)         a.total_liquidations        += 1;
    if (delta.committeeOverride)   a.total_committee_overrides += 1;
    if (delta.quotaCrossing)       a.total_quota_crossings     += 1;
    if (delta.debtCashout)         a.total_debt_cashouts       += 1;
    _careerSave(a);
    return a;
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
    IDLE:             'IDLE',
    ASCENDING:        'ASCENDING',
    EVALUATING:       'EVALUATING',
    LOCKER_SELECTING: 'LOCKER_SELECTING',
    REVEALING:        'REVEALING',
    DECIDING:         'DECIDING',
    HISS_BREACH:      'HISS_BREACH',
    SAFE_NODE:        'SAFE_NODE',
    GAME_OVER:        'GAME_OVER',
    CASHED_OUT:       'CASHED_OUT',
    DEBT_CASHOUT:     'DEBT_CASHOUT'
  };

  var SAFE_NODE_FLOORS = cfg('safeNode.floors', [5, 10]);

  var _floorLev = {
    earlyMax: cfg('floorLeverage.earlyFloorMax',  3),
    earlyVal: cfg('floorLeverage.earlyLeverage',  1.8),
    growth:   cfg('floorLeverage.growthPerFloor', 0.65),
    cap:      cfg('floorLeverage.maxLeverage',    8.0)
  };

  function floorLeverage(floor) {
    if (floor <= _floorLev.earlyMax) return _floorLev.earlyVal;
    return Math.min(_floorLev.cap, _floorLev.earlyVal + (floor - _floorLev.earlyMax) * _floorLev.growth);
  }

  var CORRUPTION = {
    MAX:                   cfg('corruption.max',                 3.0),
    LIQUIDATION_SHIFT:     cfg('corruption.liquidationShift',    0.05),
    LIQUIDATION_SHIFT_CAP: cfg('corruption.liquidationShiftCap', 0.20),
    PER_FLOOR:             cfg('corruption.perFloor',            0.08),
    ON_POSITIVE:           cfg('corruption.onPositive',          0.05),
    ON_NEGATIVE:           cfg('corruption.onNegative',          0.12),
    ON_DOUBLE:             cfg('corruption.onDouble',            0.35),
    ON_VIP_AUDIT:          cfg('corruption.onVipAuditRelief',   -0.11),
    ON_DANGER_UNVEIL:      cfg('corruption.onDangerUnveil',      0.17),
    ON_COMMITTEE_OVERRIDE: cfg('corruption.onCommitteeOverride', 0.45)
  };

  var BREACH_PROB      = cfg('breach.baseProbability', 0.10);
  var BREACH_MS        = cfg('breach.durationMs',      5000);
  var BREACH_MIN_FLOOR = cfg('breach.minFloor',        5);
  var BREACH_MIN_PROB  = cfg('breach.minProbability',  0.028);
  var BREACH_MAX_PROB  = cfg('breach.maxProbability',  0.44);
  var BREACH_DANGER_BONUS     = cfg('breach.dangerBonus',         0.075);
  var BREACH_VIP_REDUCTION    = cfg('breach.vipReduction',       -0.042);
  var BREACH_VIP_DANGER_COMBO = cfg('breach.vipDangerComboBonus', 0.115);

  var PIG_PERIOD = {
    maxFloor:     cfg('pigPeriod.maxFloor',             3),
    negMaxRatio:  cfg('pigPeriod.negativeMaxRatio',     0.55),
    negMinThresh: cfg('pigPeriod.negativeMinThreshold', 0.06),
    maxLossRate:  cfg('pigPeriod.maxLossRate',          -0.12)
  };

  var BASELINE_GROWTH = cfg('baselineGrowth.multiplier', 1.1);

  /* baselineGrowth.tiers — 按 stakeRatio = credits/quota 分段的衰减曲线。
     越富越缓，逼迫高资产玩家在"守"与"再赌一层"之间做真实决策。 */
  var BASELINE_GROWTH_TIERS = (function () {
    var raw = cfg('baselineGrowth.tiers', null);
    if (!raw || !raw.length) return null;
    var list = [];
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i] || {};
      var s = Number(t.stakeRatio);
      var m = Number(t.multiplier);
      if (!isFinite(s) || s <= 0 || !isFinite(m) || m <= 0) continue;
      list.push({ stakeRatio: s, multiplier: m, label: t.label || '' });
    }
    list.sort(function (a, b) { return a.stakeRatio - b.stakeRatio; });
    return list.length ? list : null;
  })();

  function pickBaselineGrowthTier(credits, quota) {
    if (!BASELINE_GROWTH_TIERS) return { multiplier: BASELINE_GROWTH, label: 'flat', stakeRatio: 0 };
    var qSafe = quota > 0 ? quota : 1;
    var ratio = credits / qSafe;
    for (var i = 0; i < BASELINE_GROWTH_TIERS.length; i++) {
      if (ratio < BASELINE_GROWTH_TIERS[i].stakeRatio) {
        return { multiplier: BASELINE_GROWTH_TIERS[i].multiplier, label: BASELINE_GROWTH_TIERS[i].label, stakeRatio: ratio };
      }
    }
    var last = BASELINE_GROWTH_TIERS[BASELINE_GROWTH_TIERS.length - 1];
    return { multiplier: last.multiplier, label: last.label, stakeRatio: ratio };
  }

  /* FBC 流通损耗（House Edge）。仅对 delta > 0 抽水；
     抽水时机在 speculator/blindConfidence 等正向乘子之后，
     语义为"无论你怎么赢，FBC 都先切一片"。 */
  var FBC_EDGE_CFG = (function () {
    var enabled = cfg('fbcEdge.enabled', true);
    var rates   = cfg('fbcEdge.rates', null) || {};
    var label   = cfg('fbcEdge.label', '联邦资产流通损耗');
    return {
      enabled: !!enabled,
      label:   String(label),
      rates: {
        POSITIVE:    Number(rates.POSITIVE)    || 0,
        DOUBLE:      Number(rates.DOUBLE)      || 0,
        GOLDEN:      Number(rates.GOLDEN)      || 0,
        NEGATIVE:    Number(rates.NEGATIVE)    || 0,
        LIQUIDATION: Number(rates.LIQUIDATION) || 0
      }
    };
  })();

  function pickFbcEdgeRate(outcome) {
    if (!FBC_EDGE_CFG.enabled || !outcome) return 0;
    if (outcome.kind === 'POSITIVE' && outcome.goldenFloor) return FBC_EDGE_CFG.rates.GOLDEN || 0;
    var r = FBC_EDGE_CFG.rates[outcome.kind];
    return (typeof r === 'number' && r > 0) ? Math.min(r, 0.5) : 0;
  }

  var FLOORS_JUMPED_MIN = cfg('floorsJumped.min', 1);
  var FLOORS_JUMPED_MAX = cfg('floorsJumped.max', 8);

  var QUOTA_CFG = {
    target:           cfg('quota.target',               1000),
    pressureMaxShift: cfg('quota.pressureMaxShift',     0.065),
    pressureLinear:   cfg('quota.pressureLinearFactor', 0.075),
    nearRange:        cfg('quota.nearQuotaRange',       0.2),
    nearPeak:         cfg('quota.nearQuotaPeakShift',   0.038),
    minQuota:         cfg('quota.minQuota',             500),
    crossedBonusMs:   cfg('quota.crossedBonusCountdownMs', 1000),
    crossedBonusOnce: cfg('quota.crossedBonusOnce',     true)
  };

  var QUOTA_TIERS = (function () {
    var raw = cfg('quota.tiers', []);
    if (!Array.isArray(raw) || !raw.length) return [];
    return raw
      .map(function (t) {
        return {
          buyInMax:   typeof t.buyInMax === 'number' ? t.buyInMax : Infinity,
          multiplier: typeof t.multiplier === 'number' ? t.multiplier : 1,
          label:      t.label || ''
        };
      })
      .sort(function (a, b) { return a.buyInMax - b.buyInMax; });
  }());

  /**
   * 根据 buy-in 选择 quota 档位。
   * 缺省 / 配置缺失时回退到 QUOTA_CFG.target，保证旧档案兼容。
   */
  function pickQuotaForBuyIn(buyIn) {
    var stake = (typeof buyIn === 'number' && buyIn > 0) ? buyIn : 0;
    if (!QUOTA_TIERS.length || stake <= 0) {
      return { value: QUOTA_CFG.target, multiplier: null, label: 'static' };
    }
    var tier = null;
    for (var i = 0; i < QUOTA_TIERS.length; i++) {
      if (stake <= QUOTA_TIERS[i].buyInMax) { tier = QUOTA_TIERS[i]; break; }
    }
    if (!tier) tier = QUOTA_TIERS[QUOTA_TIERS.length - 1];
    var raw = stake * tier.multiplier;
    var rounded = Math.round(raw / 50) * 50;
    var floored = Math.max(QUOTA_CFG.minQuota, rounded);
    return { value: floored, multiplier: tier.multiplier, label: tier.label };
  }

  var SPECULATOR_CFG = {
    enabled:        cfg('speculatorProtocol.enabled', true),
    targetId:       cfg('speculatorProtocol.targetIdentity', 'SCAMMER'),
    durationFloors: cfg('speculatorProtocol.durationFloors', 3),
    gainMult:       cfg('speculatorProtocol.gainMult', 3),
    corMult:        cfg('speculatorProtocol.corruptionOutcomeMult', 2)
  };

  var ANGEL_CFG = {
    enabled:        cfg('angelInvestor.enabled', true),
    targetId:       cfg('angelInvestor.targetIdentity', 'VIP'),
    durationFloors: cfg('angelInvestor.durationFloors', 2),
    rateBonus:      cfg('angelInvestor.positiveRateBonus', 0.04)
  };

  var GOLDEN_POS_CFG = {
    probability:       cfg('goldenPositive.probability', 0.015),
    creditsMultiplier: cfg('goldenPositive.creditsMultiplier', 10)
  };

  var COMBO_BLIND_CFG = {
    windowMs:         cfg('comboBlindConfidence.windowMs', 1500),
    gainMult:         cfg('comboBlindConfidence.gainMult', 1.05),
    hiddenQuotaShift: cfg('comboBlindConfidence.hiddenQuotaShiftBonus', 0.024)
  };

  var SUSPENSE_CFG = {
    liquidationMs:        cfg('suspense.liquidationBusyWaitMs', 0),
    negativeLowRunwayMs:  cfg('suspense.lowRunwayNegativeBusyWaitMs', 0),
    lowRunwayRatio:       cfg('suspense.lowRunwayCreditsToQuotaMax', 0.22)
  };

  var LOCKER_CFG = {
    enabled:               cfg('lockerSelection.enabled', true),
    countByBiome:          cfg('lockerSelection.lockerCountByBiome', { admin: 2, maintenance: 3, supernatural: 4 }),
    countdownPerLockerMs:  cfg('lockerSelection.countdownPerLockerMs', 4000),
    countdownMinMs:        cfg('lockerSelection.countdownMinMs', 6000),
    countdownMaxMs:        cfg('lockerSelection.countdownMaxMs', 16000),
    numberMin:             cfg('lockerSelection.lockerNumberMin', 1),
    numberMax:             cfg('lockerSelection.lockerNumberMax', 99)
  };

  var FBC_OVERRIDE_CFG = {
    enabled:           cfg('fbcOverride.enabled', true),
    creditsClampRatio: cfg('fbcOverride.creditsClampRatio', 0.62),
    extraCorruption:   cfg('fbcOverride.extraCorruption', 0.45),
    messages:          cfg('fbcOverride.messages', [])
  };

  var LOCKER_HINT_COPY = {
    good: cfg('lockerHintCopy.good', []),
    bad:  cfg('lockerHintCopy.bad',  [])
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

  var BRAKE_RETAIN     = cfg('item.floppyDisk.brakeRetainRatio', 0.30);
  var FLOPPY_INIT_COUNT = cfg('item.floppyDisk.initialCount', 3);

  var SAFE_NODE_PURGE_COST = cfg('safeNode.purgeCostRatio', 0.20);

  /* =====================================================================
   * Biome 区段映射（与 UI biomeClass 共用）
   * ===================================================================== */

  function biomeForFloor(floor) {
    var ranges = cfg('biome.ranges', [
      { minFloor: 1,  maxFloor: 10,   biome: 'admin' },
      { minFloor: 11, maxFloor: 25,   biome: 'maintenance' },
      { minFloor: 26, maxFloor: 9999, biome: 'supernatural' }
    ]);
    for (var i = 0; i < ranges.length; i++) {
      var r = ranges[i];
      if (floor >= r.minFloor && floor <= r.maxFloor) return r.biome;
    }
    return 'admin';
  }

  /* =====================================================================
   * 乘客身份系统
   * ===================================================================== */

  var _pCfg   = cfg('passenger', {});
  var _pTypes = _pCfg.types || {};

  function _buildPassengerType(id, defaults) {
    var t = _pTypes[id] || {};
    return {
      identity:       id,
      label:          t.label != null ? t.label : (defaults.label || id),
      weight:         t.weight != null ? t.weight : defaults.weight,
      thresholdMod: {
        liquidationShift: t.liquidationShift != null ? t.liquidationShift : defaults.liquidationShift,
        negShift:         t.negShift         != null ? t.negShift         : defaults.negShift
      },
      creditsMod:     t.creditsMod     != null ? t.creditsMod     : defaults.creditsMod,
      volatile:       t.volatile       != null ? t.volatile       : defaults.volatile,
      disguiseChance: t.disguiseChance != null ? t.disguiseChance : defaults.disguiseChance,
      lockerHintChance:   t.lockerHintChance   != null ? t.lockerHintChance   : (defaults.lockerHintChance   || 0),
      lockerHintAccuracy: t.lockerHintAccuracy != null ? t.lockerHintAccuracy : (defaults.lockerHintAccuracy || 0)
    };
  }

  var PASSENGER = {
    MAX_ONBOARD:   cfg('passenger.maxOnboard',   2),
    BOARD_CHANCE:  cfg('passenger.boardChance',  0.40),
    DEPART_CHANCE: cfg('passenger.departChance', 0.30),
    MIN_FLOOR:     cfg('passenger.minFloor',     3),
    TYPES: {
      VIP:      _buildPassengerType('VIP',      { weight: 28, liquidationShift: -0.04, negShift: -0.02, creditsMod: 1.15, disguiseChance: 0,   volatile: false, label: '监理员' }),
      SCAMMER:  _buildPassengerType('SCAMMER',  { weight: 28, liquidationShift:  0.06, negShift:  0.03, creditsMod: 0.85, disguiseChance: 1.0, volatile: false, label: '红圈商人' }),
      DANGER:   _buildPassengerType('DANGER',   { weight: 22, liquidationShift:  0.08, negShift:  0.02, creditsMod: 1.00, disguiseChance: 0.5, volatile: true,  label: '希斯潜伏者' }),
      INFORMER: _buildPassengerType('INFORMER', { weight: 14, liquidationShift:  0.00, negShift:  0.00, creditsMod: 1.00, disguiseChance: 0,   volatile: false, label: '内线情报员', lockerHintChance: 0.85, lockerHintAccuracy: 0.78 }),
      CLEANER:  _buildPassengerType('CLEANER',  { weight:  8, liquidationShift: -0.01, negShift: -0.01, creditsMod: 1.00, disguiseChance: 0,   volatile: false, label: '清扫员',     lockerHintChance: 0.45, lockerHintAccuracy: 0.55 })
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
      {
        tag: '资产裂变', text: '高维漏洞 · 账面暴增',
        lore: '异动来源：本层轿厢短暂穿越了一处价值折叠区间（参照：FBC档案3-7-R）。账面拷贝已自动归入探测员信托账户。\n\n注意：请勿对此次收益来源进行非授权报告。委员会已在相关记录中标注〔REDACTED〕。'
      },
      {
        tag: '意外分红', text: '超额津贴 · 估值跳',
        lore: '账单备注：某匿名高级研究员于本层提交了估值修正申请，申请内容为机密，本次入账为系统自动响应，无需审批流程。\n\n该研究员的后续行踪目前列为管控信息，请勿询问。'
      },
      {
        tag: '财富跃升', text: '套利窗开 · 杠杆满',
        lore: '套利事件摘要：轿厢传感器检测到本层存在短暂的高维套利窗口。依协议，探测员持有的全部杠杆头寸已完成自动镜像增值。\n\n此类事件每发生一次，垂直探测序列的预期寿命即缩短约七小时。此为例行备注。'
      }
    ],
    POSITIVE_HIGH: [
      {
        tag: '财富跃升', text: '大额增值 · 流动性入',
        lore: '高净值事件登记：本层杠杆结算触发了委员会内部的HNW-C清算协议。该协议的激活条件至今为机密。\n\n入账金额已扣除噪声矫正费（0.000%，精确至小数点后十七位后归零）。连续触发此类事件可能导致后续楼层产生补偿性罚款。'
      },
      {
        tag: '盲盒大奖', text: '高纯晶体 · 已结算',
        lore: '异常事件摘要：探测传感器于本层读取到超规格流动性信号，经委员会核查，该信号已确认为真实可信。\n\n后果：账面大幅增值。原因：无法公开。建议：不要询问。'
      },
      {
        tag: '资产裂变', text: '套利成 · 倍率活',
        lore: '套利成功报告：本层发生了一起受控的资产结构重组事件，全部超额收益依规归入探测员账户。\n\n委员会提示：接连触发高净值事件将提升下一层的偏移基准。您的贪婪曲线已被实时记录在案。'
      }
    ],
    POSITIVE_LOW: [
      {
        tag: '意外分红', text: '合规红利入账',
        lore: '例行入账说明：本层完成了一次低强度合规红利分配。触发条件：平凡。金额：尚可。\n\n风险提示：委员会将连续三次入账列为"行为模式异常"并可能启动额外审查。本条提示系自动生成，与您的具体行为无关。'
      },
      {
        tag: '特别津贴', text: '微补入账 · 可上行翻倍',
        lore: '内部备忘：本次微量入账系因轿厢于本层触发了一项已遗忘的补贴条款，该条款的原始签署人已于七年前以"行政失联"为由注销档案。\n\n建议：收下，不要追溯来源。'
      }
    ],
    GOLDEN_FLOOR: [
      {
        tag: '黄金楼层', text: '匿名放行 · 单笔十倍肥尾',
        lore: '异常收益档案：本层为本次探测序列中的匿名放行节点。放行条件：概率性的，不可预测的，委员会拒绝给出任何解释。\n\n警示：当您下次在电梯中看到相同的楼层数字时，不要按它。'
      },
      {
        tag: '财富跃升', text: '估值异常 · 黄金带收益',
        lore: '肥尾收益备注：本次结算的倍率已超出正常预期范围。委员会内部将此类事件记为"奇点收益"。\n\n警告：重复触发奇点收益的探测员，其后续偏移基准将被永久上调。这不是威胁，这是数据。'
      }
    ],
    NEGATIVE: [
      {
        tag: '恶意做空', text: '不明机构做空 · 账面缩',
        lore: '异动来源：某匿名机构于本层针对您的探测账户实施了精准做空操作。做空者身份：〔REDACTED〕。做空理由：〔REDACTED〕。\n\n委员会内部估计，上述标注信息的公开披露将引起至少两名委员会成员的个人不适，故维持现状。'
      },
      {
        tag: '违规罚款', text: '触犯法案第7.3条 · 扣款',
        lore: '罚款事由：监控系统于本层记录到您的视线方向与走廊末端的异常实体产生了0.3秒的接触窗口。\n\n依据《联邦模因卫生条例》第7.3条第二款，模因防控费已自动划扣。如需申诉，请前往B9层档案室。该办公室自建立以来尚未接待过任何访客。'
      },
      {
        tag: '通货膨胀', text: '购买力蒸发 · 资产缩',
        lore: '账面缩水说明：本层内存在一个未公开的通货膨胀异常源。委员会已在内部档案中记录此事件，但决定不采取任何行动。\n\n您的购买力已被无形吸收。负责吸收的实体对"谢谢"没有任何反应。'
      }
    ],
    LIQUIDATION: [
      {
        tag: '强制清算', text: 'FBC 破产程序 · 账面核销',
        lore: '结算通知：账面归零程序已执行完毕。\n\n依据《联邦信用核销规程》附件F，您的全部探测杠杆已归还至局方信托储备池。此记录已自动同步至您的永久失信档案。\n\n委员会感谢您的参与，并祝您在下一轮探测中做出更为审慎的决策。'
      }
    ],
    COMMITTEE_OVERRIDE: [
      {
        tag: '代决议执行', text: '委员会代开柜 · 收益折扣',
        lore: 'FBC 内部备忘：探测员未能在规定窗口内完成货舱选择，委员会依《迟疑代决议条例》第三条接管开柜流程。\n\n备注：剩余收益按规章折扣留存，偏移指数已加重。下次请果断行使探测员裁量权。'
      }
    ]
  };

  function getOutcomeNarrative(outcome) {
    if (!outcome) return null;
    var pool;
    if (outcome.committeeOverride) {
      pool = OUTCOME_NARRATIVE_POOL.COMMITTEE_OVERRIDE;
    } else if (outcome.kind === 'DOUBLE') {
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
      if (p.identity === 'VIP')     hasVip = true;
      if (p.identity === 'SCAMMER') hasScammer = true;
      if (p.identity === 'DANGER')  hasDanger = true;
    }
    if (hasVip && hasScammer) {
      liq  += PASSENGER_COMBOS.vipScammer.liquidationShift;
      neg  += PASSENGER_COMBOS.vipScammer.negShift;
      cred *= PASSENGER_COMBOS.vipScammer.creditsMult;
    }
    if (hasVip && hasDanger) {
      liq  += PASSENGER_COMBOS.vipDanger.liquidationShift;
      neg  += PASSENGER_COMBOS.vipDanger.negShift;
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
      if (px.identity === 'VIP')    hasVip    = true;
      if (px.identity === 'DANGER') hasDanger = true;
    }
    if (hasDanger)            p += BREACH_DANGER_BONUS;
    if (hasVip)               p += BREACH_VIP_REDUCTION;
    if (hasVip && hasDanger)  p += BREACH_VIP_DANGER_COMBO;
    return Math.max(BREACH_MIN_PROB, Math.min(BREACH_MAX_PROB, p));
  }

  function createPassenger(rng) {
    var keys = ['VIP', 'SCAMMER', 'DANGER', 'INFORMER', 'CLEANER'];
    var totalW = 0;
    for (var i = 0; i < keys.length; i++) totalW += PASSENGER.TYPES[keys[i]].weight;
    var r = rng() * totalW, cumulative = 0;
    var type = PASSENGER.TYPES.VIP;
    for (var j = 0; j < keys.length; j++) {
      cumulative += PASSENGER.TYPES[keys[j]].weight;
      if (r < cumulative) { type = PASSENGER.TYPES[keys[j]]; break; }
    }
    return {
      identity:           type.identity,
      label:              type.label,
      thresholdMod:       type.thresholdMod,
      creditsMod:         type.creditsMod,
      volatile:           !!type.volatile,
      isDisguised:        rng() < type.disguiseChance,
      lockerHintChance:   type.lockerHintChance   || 0,
      lockerHintAccuracy: type.lockerHintAccuracy || 0
    };
  }

  /* =====================================================================
   * 物品注册表
   * ===================================================================== */

  var ITEM_REGISTRY = {};

  ITEM_REGISTRY['floppy-disk'] = {
    id:   'floppy-disk',
    name: 'Bureau Module',
    description: '审查：揭伪装。制动：下次清算时按基准账面划留存（例基准¥200≈¥60，随层浮动）。',
    modes: {
      scan: {
        usableIn: [STATES.DECIDING, STATES.HISS_BREACH],
        canUse: function (ctrl) { return ctrl.passengers && ctrl.passengers.length > 0; },
        onUse:  function (ctrl) { return ctrl.scanPassenger(); }
      },
      brake: {
        usableIn: [STATES.DECIDING, STATES.HISS_BREACH],
        canUse: function (ctrl) { return !ctrl.brakeMitigationPending; },
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
      return {
        kind: 'NEGATIVE', raw: r,
        band: '[' + T.liquidationMax.toFixed(3) + ', ' + T.negMax.toFixed(3) + ')',
        creditsMultiplier: OUTCOME_BANDS.NEGATIVE_MULT_MIN + tN * negRange
      };
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
      return {
        kind: SurpriseEvent.KINDS.COIN_RAIN,
        creditsBonus: Math.max(1, Math.floor(game.credits * SurpriseEvent.COIN_RAIN_RATIO)),
        floorBonus: 0
      };
    }
    if (sr < pC + pS) {
      return { kind: SurpriseEvent.KINDS.SKIP_FLOOR, creditsBonus: 0, floorBonus: SurpriseEvent.SKIP_FLOORS };
    }
    return null;
  };

  /* =====================================================================
   * 封存货舱 / 选盘系统
   * ===================================================================== */

  /**
   * 生成本层货舱手牌：N 个候选 outcome（每个独立掷骰），其中 1 个会成为本层最终结果。
   *   - 每个 outcome 的 creditsMultiplier 已固定，selectLocker 时再施加副作用。
   *   - 柜号在 [LOCKER_CFG.numberMin, LOCKER_CFG.numberMax] 区间无重复抽取。
   *   - 至少有 1 个候选会落到 POSITIVE/DOUBLE 带（minBidGapPositive=1），避免一手全坏极端体验。
   *
   * @param {object} ctrl     GameController 实例
   * @param {number} count    柜数（已根据 Biome / 养猪期裁剪）
   * @param {number} quotaShift 配额压力偏移
   * @returns {{ candidates: Array<{lockerNumber, outcome, r}>, biome }}
   */
  function generateLockerHand(ctrl, count, quotaShift) {
    var rng = ctrl._rng;
    var biome = biomeForFloor(ctrl.floor);
    var minPos = cfg('lockerSelection.minBidGapPositive', 1);

    var candidates = [];
    var hasPositive = false;
    var attempts = 0;
    while (candidates.length < count && attempts < count * 6) {
      attempts++;
      var r = rng();
      var oc = rollEventFromR(r, ctrl.corruption, ctrl.passengers, ctrl.activeEnvEvent, quotaShift || 0, ctrl.floor, rng);
      candidates.push({ outcome: oc, r: r });
      if (oc.kind === 'POSITIVE' || oc.kind === 'DOUBLE') hasPositive = true;
    }
    if (!hasPositive && minPos > 0 && candidates.length > 0) {
      var rPos = THRESHOLDS.NEGATIVE_MAX + rng() * (THRESHOLDS.POSITIVE_MAX - THRESHOLDS.NEGATIVE_MAX - 1e-4);
      var posOc = rollEventFromR(rPos, ctrl.corruption, ctrl.passengers, ctrl.activeEnvEvent, quotaShift || 0, ctrl.floor, rng);
      candidates[Math.floor(rng() * candidates.length)] = { outcome: posOc, r: rPos };
    }

    var numbers = [];
    var lockerSet = {};
    var span = LOCKER_CFG.numberMax - LOCKER_CFG.numberMin + 1;
    var numAttempts = 0;
    var numAttemptCap = Math.max(40, count * 12);
    while (numbers.length < count && numAttempts < numAttemptCap) {
      numAttempts++;
      var n = LOCKER_CFG.numberMin + Math.floor(rng() * span);
      if (!lockerSet[n]) {
        lockerSet[n] = true;
        numbers.push(n);
      }
    }
    /* 兜底：RNG 退化时顺序补齐，避免确定性测试场景死循环 */
    if (numbers.length < count) {
      var probe = LOCKER_CFG.numberMin;
      while (numbers.length < count && probe <= LOCKER_CFG.numberMax) {
        if (!lockerSet[probe]) {
          lockerSet[probe] = true;
          numbers.push(probe);
        }
        probe++;
      }
    }

    for (var i = 0; i < candidates.length; i++) {
      candidates[i].lockerNumber = numbers[i];
    }
    return { candidates: candidates, biome: biome };
  }

  function _resolveLockerCount(biome, floor) {
    var byBiome = LOCKER_CFG.countByBiome || {};
    var n = byBiome[biome];
    if (typeof n !== 'number') n = 3;
    if (floor <= PIG_PERIOD.maxFloor) n = Math.min(n, 2);
    return Math.max(2, Math.min(4, n));
  }

  /**
   * 单次选柜倒计时：count × perLocker 毫秒，被 [min, max] 截断。
   */
  function _resolveLockerCountdown(count) {
    var base = count * LOCKER_CFG.countdownPerLockerMs;
    return Math.max(LOCKER_CFG.countdownMinMs, Math.min(LOCKER_CFG.countdownMaxMs, base));
  }

  /* =====================================================================
   * AudioEngine 桩
   * ===================================================================== */

  function createAudioStub() {
    return {
      playStateTransition: function () {},
      playOutcome:         function () {},
      playSurprise:        function () {},
      playBreach:          function () {},
      resumeIfNeeded:      function () {},
      playCommitteePulse:  function () {},
      playLeverPull:       function () {},
      tryPlaySlot:         function () {},
      playQuotaReached:    function () {},
      playLockerOpen:      function () {},
      playLockerSelect:    function () {},
      playCommitteeOverride: function () {},
      playMetalTap:        function () {}
    };
  }

  /* =====================================================================
   * GameController
   * ===================================================================== */

  function GameController(options) {
    options = options || {};
    this.initialBet  = typeof options.initialBet === 'number' ? options.initialBet : 200;
    this._rng        = typeof options.random === 'function'   ? options.random : Math.random;
    this.audio       = options.audio || createAudioStub();
    this._listeners  = {
      state: [], outcome: [], surprise: [], cashOut: [],
      corruption: [], breach: [],
      passengerBoard: [], passengerLeave: [], passengerReveal: [],
      envEvent: [], passengerStack: [], uiWarning: [],
      lockerHand: [], lockerSelected: [], lockerHint: [],
      quotaCrossed: []
    };
    this._breachTimer    = null;
    this._breachDeadline = 0;
    this.reset();
  }

  /* ---- 静态导出 ---- */
  GameController.STATES                     = STATES;
  GameController.THRESHOLDS                 = THRESHOLDS;
  GameController.OUTCOME_BANDS              = OUTCOME_BANDS;
  GameController.CORRUPTION                 = CORRUPTION;
  GameController.ITEM_REGISTRY              = ITEM_REGISTRY;
  GameController.SurpriseEvent              = SurpriseEvent;
  GameController.rollEventFromR             = rollEventFromR;
  GameController.computeEffectiveThresholds = computeEffectiveThresholds;
  GameController.computeBreachProbability   = computeBreachProbability;
  GameController.BREACH_DURATION_MS         = BREACH_MS;
  GameController.PASSENGER                  = PASSENGER;
  GameController.PASSENGER_COMBOS           = PASSENGER_COMBOS;
  GameController.createPassenger            = createPassenger;
  GameController.ENV_EVENT_IDS              = ENV_EVENT_IDS;
  GameController.SAFE_NODE_FLOORS           = SAFE_NODE_FLOORS;
  GameController.floorLeverage              = floorLeverage;
  GameController.getOutcomeNarrative        = getOutcomeNarrative;
  GameController.OUTCOME_NARRATIVE_POOL     = OUTCOME_NARRATIVE_POOL;
  GameController.PIG_PERIOD                 = PIG_PERIOD;
  GameController.QUOTA_CFG                  = QUOTA_CFG;
  GameController.LOCKER_CFG                 = LOCKER_CFG;
  GameController.FBC_OVERRIDE_CFG           = FBC_OVERRIDE_CFG;
  GameController.LOCKER_HINT_COPY           = LOCKER_HINT_COPY;
  GameController.generateLockerHand         = generateLockerHand;
  GameController.biomeForFloor              = biomeForFloor;
  GameController.cfg                        = cfg;
  GameController.careerLoad                 = careerLoad;
  GameController.careerMerge                = careerMerge;
  GameController.pickQuotaForBuyIn          = pickQuotaForBuyIn;

  /* ---- 重置 ---- */
  GameController.prototype.reset = function () {
    this.floor                  = 1;
    this.credits                = this.initialBet;
    this.corruption             = 0;
    var quotaPick               = pickQuotaForBuyIn(this.initialBet);
    this.quota                  = quotaPick.value;
    this._quotaTierLabel        = quotaPick.label;
    this._quotaMultiplier       = quotaPick.multiplier;
    this._quotaBonusPendingMs   = 0;
    this.inventory              = [{ id: 'floppy-disk', count: FLOPPY_INIT_COUNT }];
    this.passengers             = [];
    this.activeEnvEvent         = null;
    this.brakeMitigationPending = false;
    this.state                  = STATES.IDLE;
    this.rngLog                 = [];
    this.lastOutcome            = null;
    this.lastSurprise           = null;
    this.lastPayout             = null;
    this._floorCreditsBefore    = null;
    this._pendingBreach         = false;
    this._quotaCrossed          = false;
    this._liquidationDebtAmount = 0;
    this._peakCredits           = this.initialBet;
    this._safeNodeVisited       = {};
    this._speculatorContract    = null;
    this._angelLift             = null;
    this._blindConfidenceActive = false;
    this._lastDecidingAt        = 0;

    this._lockerHand            = null;
    this._lockerHandMeta        = null;
    this._lockerHandQuotaShift  = 0;
    this._lockerHandPaxEvents   = null;
    this._lockerHandFloorsJumped = 0;
    this._lockerHandEnvRoll     = null;
    this._lockerCountdownDeadline = 0;

    this._clearBreachTimer();
    this._emitState(STATES.IDLE, null);
  };

  /* ---- 计算属性 ---- */

  Object.defineProperty(GameController.prototype, 'greedFactor', {
    get: function () { return Math.min((this.floor - 1) / SurpriseEvent.GREED_SAT, 1); }
  });

  Object.defineProperty(GameController.prototype, 'corruptionRatio', {
    get: function () { return Math.min(this.corruption / CORRUPTION.MAX, 1); }
  });

  GameController.prototype.getEffectiveThresholds = function () {
    return computeEffectiveThresholds(this.corruption, this.passengers, this.activeEnvEvent, 0, this.floor);
  };

  GameController.prototype._updatePeakCredits = function () {
    if (this.credits > this._peakCredits) this._peakCredits = this.credits;
  };

  Object.defineProperty(GameController.prototype, 'passenger', {
    get: function () {
      return this.passengers && this.passengers.length ? this.passengers[0] : null;
    }
  });

  GameController.prototype.getNetAsset = function () { return this.credits - this.quota; };

  GameController.prototype.getDebt = function () { return Math.max(0, this.quota - this.credits); };

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
  GameController.prototype.onStateChange       = function (fn) { this._listeners.state.push(fn); };
  GameController.prototype.onOutcome           = function (fn) { this._listeners.outcome.push(fn); };
  GameController.prototype.onSurprise          = function (fn) { this._listeners.surprise.push(fn); };
  GameController.prototype.onCashOut           = function (fn) { this._listeners.cashOut.push(fn); };
  GameController.prototype.onCorruption        = function (fn) { this._listeners.corruption.push(fn); };
  GameController.prototype.onBreach            = function (fn) { this._listeners.breach.push(fn); };
  GameController.prototype.onPassengerBoard    = function (fn) { this._listeners.passengerBoard.push(fn); };
  GameController.prototype.onPassengerLeave    = function (fn) { this._listeners.passengerLeave.push(fn); };
  GameController.prototype.onPassengerReveal   = function (fn) { this._listeners.passengerReveal.push(fn); };
  GameController.prototype.onEnvEvent          = function (fn) { this._listeners.envEvent.push(fn); };
  GameController.prototype.onPassengerStack    = function (fn) { this._listeners.passengerStack.push(fn); };
  GameController.prototype.onUiWarning         = function (fn) { this._listeners.uiWarning.push(fn); };
  GameController.prototype.onLockerHand        = function (fn) { this._listeners.lockerHand.push(fn); };
  GameController.prototype.onLockerSelected    = function (fn) { this._listeners.lockerSelected.push(fn); };
  GameController.prototype.onLockerHint        = function (fn) { this._listeners.lockerHint.push(fn); };
  GameController.prototype.onQuotaCrossed      = function (fn) { this._listeners.quotaCrossed.push(fn); };

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

  GameController.prototype._emitCorruption = function () {
    for (var i = 0; i < this._listeners.corruption.length; i++) {
      try { this._listeners.corruption[i](this.corruption, this.corruptionRatio, this); } catch (e) { console.error(e); }
    }
  };

  GameController.prototype._emitBreach = function () {
    for (var i = 0; i < this._listeners.breach.length; i++) {
      try { this._listeners.breach[i](this._breachDeadline, this); } catch (e) { console.error(e); }
    }
    this.audio.playBreach();
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

  GameController.prototype._emitUiWarning = function (data) {
    for (var i = 0; i < this._listeners.uiWarning.length; i++) {
      try { this._listeners.uiWarning[i](data, this); } catch (e) { console.error(e); }
    }
  };

  GameController.prototype._emitLockerHand = function (payload) {
    for (var i = 0; i < this._listeners.lockerHand.length; i++) {
      try { this._listeners.lockerHand[i](payload, this); } catch (e) { console.error(e); }
    }
  };

  GameController.prototype._emitLockerSelected = function (payload) {
    for (var i = 0; i < this._listeners.lockerSelected.length; i++) {
      try { this._listeners.lockerSelected[i](payload, this); } catch (e) { console.error(e); }
    }
  };

  GameController.prototype._emitLockerHint = function (hint) {
    for (var i = 0; i < this._listeners.lockerHint.length; i++) {
      try { this._listeners.lockerHint[i](hint, this); } catch (e) { console.error(e); }
    }
  };

  GameController.prototype._stampDecidingEnter = function () {
    this._lastDecidingAt = Date.now();
  };

  /**
   * 激进投机者对赌（浏览器原生 confirm，不新增 DOM）。
   */
  GameController.prototype._tryOfferSpeculatorContract = function (fromScanReveal) {
    if (!SPECULATOR_CFG.enabled) return;
    if (this._speculatorContract && this._speculatorContract.floorsRemaining > 0) return;
    var key = fromScanReveal ? 'copy.speculatorProtocolScan' : 'copy.speculatorProtocol';
    var msg = tpl(cfg(key, ''), {
      durationFloors: SPECULATOR_CFG.durationFloors,
      gainMult:       SPECULATOR_CFG.gainMult,
      corruptionMult: SPECULATOR_CFG.corMult
    });
    if (!msg) return;
    if (!nativeConfirm(msg)) return;
    this._speculatorContract = {
      floorsRemaining: SPECULATOR_CFG.durationFloors,
      gainMult:        SPECULATOR_CFG.gainMult,
      corMult:         SPECULATOR_CFG.corMult
    };
  };

  GameController.prototype._tryAngelLiftOnBoard = function (p) {
    if (!ANGEL_CFG.enabled || !p || p.isDisguised) return;
    if (p.identity !== ANGEL_CFG.targetId) return;
    this._angelLift = {
      floorsRemaining: ANGEL_CFG.durationFloors,
      rateBonus:       ANGEL_CFG.rateBonus
    };
  };

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
   */
  GameController.prototype.scanPassenger = function () {
    if (!this.passengers.length) return { ok: false, reason: 'no_passenger' };
    var idx = 0, i, p;
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
    var auditRelief = false, hissUnveil = false;
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
    if (outcome.kind === 'DOUBLE')   this._addCorruption(CORRUPTION.ON_DOUBLE   * em * scm);
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
    /* v0.06：清算同时把该局建仓投入计入累计损失，用于赢/亏对账 */
    careerMerge({ liquidation: true, creditsLost: this.initialBet });
    this._setState(STATES.GAME_OVER);
  };

  /* ---- 能力查询 ---- */

  GameController.prototype.canGoUp = function () {
    return this.state === STATES.IDLE || this.state === STATES.DECIDING;
  };

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

  /* =====================================================================
   * 主流程
   * ===================================================================== */

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
    var tier = pickBaselineGrowthTier(this.credits, this.quota);
    this.credits *= tier.multiplier;
    this._lastBaselineTier = tier;
    this._updatePeakCredits();
  };

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

    /* FBC 流通损耗：仅对正向 delta 抽水。
       税基为已叠加 speculator/blindConfidence 的最终增益，
       语义为"FBC 对所有渠道的正面收益统一切片"。 */
    var edgeRate   = (delta > 0) ? pickFbcEdgeRate(outcome) : 0;
    var edgeAmount = 0;
    if (edgeRate > 0) {
      edgeAmount = Math.round(delta * edgeRate);
      if (edgeAmount > 0) {
        delta -= edgeAmount;
      }
    }
    outcome._fbcEdgeRate   = edgeRate;
    outcome._fbcEdgeAmount = edgeAmount;

    this.credits = Math.max(0, this.credits + delta);
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
   * 流程（v3.2）：
   *   ASCENDING → EVALUATING
   *   ↓ 楼层跳跃 / 基线增值 / 乘客下上
   *   ↓ 安全屋拦截（直接 REVEALING）
   *   ↓ 环境事件 / 配额压力
   *   ↓ 生成货舱手牌（多个候选 outcome）
   *   ↓ LOCKER_SELECTING
   *   ↓ UI 倒计时；玩家选择 → selectLocker；超时 → autoSelectLocker(FBC 代决议)
   *   ↓ REVEALING
   *
   * @returns {{ ok, lockerHand?, candidates?, lockerCount?, biome?, countdownMs?, safeNode?, outcome? }}
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
    careerMerge({ floorsClimbed: floorsJumped, floorReached: this.floor });
    this._floorCreditsBefore = this.credits;

    var pEvents = this._updatePassengers();

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

    /* === 生成货舱手牌 === */
    var biome = biomeForFloor(this.floor);
    var lockerCount = _resolveLockerCount(biome, this.floor);
    var hand = generateLockerHand(this, lockerCount, quotaShift);
    var countdownMs = _resolveLockerCountdown(lockerCount);

    var quotaBonusApplied = 0;
    if (this._quotaBonusPendingMs > 0) {
      quotaBonusApplied = this._quotaBonusPendingMs;
      countdownMs = countdownMs + quotaBonusApplied;
      if (QUOTA_CFG.crossedBonusOnce) {
        this._quotaBonusPendingMs = 0;
      }
    }

    this._lockerHand            = hand.candidates;
    this._lockerHandMeta = {
      biome:             biome,
      floorsJumped:      floorsJumped,
      envRoll:           envRoll,
      paxEvents:         pEvents,
      quotaShift:        quotaShift,
      countdownMs:       countdownMs,
      quotaBonusApplied: quotaBonusApplied
    };
    this._lockerCountdownDeadline = Date.now() + countdownMs;

    this._setState(STATES.LOCKER_SELECTING);

    var hint = this._computeLockerHint(hand.candidates);
    if (hint) this._emitLockerHint(hint);

    var payload = {
      candidates:  hand.candidates,
      lockerCount: lockerCount,
      biome:       biome,
      countdownMs: countdownMs,
      deadline:    this._lockerCountdownDeadline,
      floorsJumped:      floorsJumped,
      passengerBoarded:  pEvents.boarded,
      passengerDeparted: pEvents.departed,
      envEvent:          envRoll,
      envActive:         this.activeEnvEvent,
      hint:              hint
    };
    this._emitLockerHand(payload);

    return {
      ok: true,
      lockerHand:  payload,
      candidates:  hand.candidates,
      lockerCount: lockerCount,
      biome:       biome,
      countdownMs: countdownMs,
      floorsJumped:      floorsJumped,
      passengerBoarded:  pEvents.boarded,
      passengerDeparted: pEvents.departed,
      envEvent:          envRoll,
      envActive:         this.activeEnvEvent
    };
  };

  /**
   * 情报员/清扫员上车后给一条柜号情报；准确率由乘客 lockerHintAccuracy 决定。
   * 仅在生成完手牌后调用，确保柜号已敲定。
   */
  GameController.prototype._computeLockerHint = function (candidates) {
    if (!candidates || !candidates.length) return null;
    var bestPax = null;
    for (var i = 0; i < this.passengers.length; i++) {
      var p = this.passengers[i];
      if (!p.lockerHintChance || p.isDisguised) continue;
      if (this._rng() >= p.lockerHintChance) continue;
      if (!bestPax || (p.lockerHintAccuracy > bestPax.lockerHintAccuracy)) bestPax = p;
    }
    if (!bestPax) return null;

    var goodIdx = -1, badIdx = -1;
    for (var k = 0; k < candidates.length; k++) {
      var oc = candidates[k].outcome;
      if ((oc.kind === 'POSITIVE' || oc.kind === 'DOUBLE') && goodIdx < 0) goodIdx = k;
      if ((oc.kind === 'NEGATIVE' || oc.kind === 'LIQUIDATION') && badIdx < 0) badIdx = k;
    }
    var truthful = this._rng() < bestPax.lockerHintAccuracy;
    var pickGood = (goodIdx >= 0) && (badIdx < 0 || this._rng() < 0.5);

    var targetIdx, polarity;
    if (pickGood) {
      polarity = 'good';
      targetIdx = truthful ? goodIdx : (badIdx >= 0 ? badIdx : Math.floor(this._rng() * candidates.length));
    } else {
      polarity = 'bad';
      targetIdx = truthful ? (badIdx >= 0 ? badIdx : Math.floor(this._rng() * candidates.length))
                           : (goodIdx >= 0 ? goodIdx : Math.floor(this._rng() * candidates.length));
    }
    var lockerNumber = candidates[targetIdx].lockerNumber;
    var pool = LOCKER_HINT_COPY[polarity] || [];
    var line = pool.length ? pool[Math.floor(this._rng() * pool.length)] : null;
    var text = line ? tpl(line, { locker: _formatLockerNumber(lockerNumber) }) : null;
    return {
      passenger:    bestPax,
      polarity:     polarity,
      lockerNumber: lockerNumber,
      targetIdx:    targetIdx,
      truthful:     truthful,
      text:         text
    };
  };

  /**
   * 玩家主动选盘。
   * @param {number} idx  柜子索引（基于 _lockerHand 数组顺序）
   */
  GameController.prototype.selectLocker = function (idx) {
    if (this.state !== STATES.LOCKER_SELECTING) return { ok: false, reason: 'not_locker_selecting' };
    if (!this._lockerHand || idx < 0 || idx >= this._lockerHand.length) {
      return { ok: false, reason: 'invalid_locker_idx' };
    }
    return this._resolveLockerSelection(idx, false);
  };

  /**
   * UI 倒计时归零时调用：随机挑一柜并按 FBC 代决议折扣处置。
   */
  GameController.prototype.autoSelectLocker = function () {
    if (this.state !== STATES.LOCKER_SELECTING) return { ok: false, reason: 'not_locker_selecting' };
    if (!this._lockerHand || !this._lockerHand.length) return { ok: false, reason: 'no_hand' };
    var idx = Math.floor(this._rng() * this._lockerHand.length);
    return this._resolveLockerSelection(idx, true);
  };

  GameController.prototype._resolveLockerSelection = function (idx, isCommitteeOverride) {
    var chosen = this._lockerHand[idx];
    var meta = this._lockerHandMeta || {};
    var lockerNumber = chosen.lockerNumber;
    var outcome = chosen.outcome;
    var allCandidates = this._lockerHand;

    /* 留底；selectLocker 完成后再清空 */
    this._lockerHandMeta = null;
    this._lockerHand = null;
    this._lockerCountdownDeadline = 0;

    if (isCommitteeOverride) {
      outcome.committeeOverride = true;
      outcome.committeeOverrideLocker = lockerNumber;
    }

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

    if (this.passengers.length && outcome.kind !== 'LIQUIDATION') {
      var agg = aggregatePassengerModifiers(this.passengers);
      this.credits *= agg.creditsMult;
      if (agg.hasVolatile) {
        this.credits *= (this._rng() < VOLATILE_POS_CHANCE ? VOLATILE_POS_MULT : VOLATILE_NEG_MULT);
      }
    }

    /* 委员会代决议折扣（在乘客修正后再裁剪，确保最终账面被压扁） */
    if (isCommitteeOverride && outcome.kind !== 'LIQUIDATION') {
      var ratio = FBC_OVERRIDE_CFG.creditsClampRatio || 1;
      var preClamp = this.credits;
      if (preClamp > this._floorCreditsBefore) {
        var gain = preClamp - this._floorCreditsBefore;
        this.credits = Math.max(0, Math.floor(this._floorCreditsBefore + gain * ratio));
        outcome._committeeOverrideClampDelta = Math.floor(this.credits - preClamp);
      } else {
        var loss = this._floorCreditsBefore - preClamp;
        this.credits = Math.max(0, Math.floor(this._floorCreditsBefore - loss * (1 + (1 - ratio))));
        outcome._committeeOverrideClampDelta = Math.floor(this.credits - preClamp);
      }
      this._addCorruption(FBC_OVERRIDE_CFG.extraCorruption || 0);
    }

    this._applyCorruptionForOutcome(outcome);

    if (!this._quotaCrossed && outcome.kind !== 'LIQUIDATION') {
      var preCredits = this._floorCreditsBefore || 0;
      if (preCredits < this.quota && this.credits >= this.quota) {
        this._quotaCrossed = true;
        if (typeof this.audio.playQuotaReached === 'function') {
          this.audio.playQuotaReached();
        }

        var bonusMs = QUOTA_CFG.crossedBonusMs > 0 ? QUOTA_CFG.crossedBonusMs : 0;
        if (bonusMs > 0) this._quotaBonusPendingMs = bonusMs;

        var quotaCrossedPayload = {
          floor:           this.floor,
          credits:         this.credits,
          quota:           this.quota,
          tierLabel:       this._quotaTierLabel || 'static',
          multiplier:      this._quotaMultiplier || null,
          bonusCountdownMs: bonusMs,
          surplus:         Math.max(0, this.credits - this.quota)
        };

        try { careerMerge({ quotaCrossing: true }); } catch (eMerge) { /* swallow */ }

        for (var qi = 0; qi < this._listeners.quotaCrossed.length; qi++) {
          try { this._listeners.quotaCrossed[qi](quotaCrossedPayload, this); }
          catch (eCb) { console.error(eCb); }
        }
      }
    }

    var pid = this.passengers.map(function (x) { return x.identity; }).join('+') || null;
    this.rngLog.push({
      floor:        this.floor,
      raw:          outcome.raw,
      outcomeKind:  outcome.kind,
      band:         outcome.band,
      creditsAfter: this.credits,
      corruption:   this.corruption,
      passenger:    pid,
      envEvent:     this.activeEnvEvent,
      mitigated:    !!outcome.mitigated,
      lockerNumber: lockerNumber,
      committeeOverride: !!isCommitteeOverride
    });

    this.lastOutcome = outcome;
    this._emitOutcome(outcome);

    if (isCommitteeOverride) {
      careerMerge({ committeeOverride: true });
      try { this.audio.playCommitteeOverride && this.audio.playCommitteeOverride(); } catch (e) {}
    }

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
      this._pendingBreach = this.floor >= BREACH_MIN_FLOOR && this._rng() < bProb;
    } else {
      this.lastSurprise   = null;
      this._pendingBreach = false;
    }

    this._tickFloorMetaBuffs();

    var payload = {
      idx:                idx,
      lockerNumber:       lockerNumber,
      outcome:            outcome,
      surprise:           surprise,
      committeeOverride:  !!isCommitteeOverride,
      allCandidates:      allCandidates,
      floorsJumped:       meta.floorsJumped || 0,
      passengerBoarded:   meta.paxEvents ? meta.paxEvents.boarded : null,
      passengerDeparted:  meta.paxEvents ? meta.paxEvents.departed : null,
      envEvent:           meta.envRoll || null,
      envActive:          this.activeEnvEvent
    };

    this._emitLockerSelected(payload);
    this._setState(STATES.REVEALING);
    return {
      ok:                true,
      idx:               payload.idx,
      lockerNumber:      payload.lockerNumber,
      outcome:           payload.outcome,
      surprise:          payload.surprise,
      committeeOverride: payload.committeeOverride,
      allCandidates:     payload.allCandidates,
      floorsJumped:      payload.floorsJumped,
      passengerBoarded:  payload.passengerBoarded,
      passengerDeparted: payload.passengerDeparted,
      envEvent:          payload.envEvent,
      envActive:         payload.envActive
    };
  };

  /**
   * 开门展示结束后由 UI 调用。
   */
  GameController.prototype.finishReveal = function () {
    if (this.state !== STATES.REVEALING) return { ok: false, reason: 'not_revealing' };

    if (this.lastOutcome && this.lastOutcome.kind === 'LIQUIDATION' && !this.lastOutcome.mitigated) {
      /* v0.06：清算同时把该局建仓投入计入累计损失，用于赢/亏对账 */
      careerMerge({ liquidation: true, creditsLost: this.initialBet });
      this._setState(STATES.GAME_OVER);
      return { ok: true, gameOver: true, breach: false };
    }

    if (this.lastOutcome && this.lastOutcome.kind === 'SAFE_NODE') {
      this._setState(STATES.SAFE_NODE);
      return { ok: true, gameOver: false, breach: false, safeNode: true };
    }

    if (this._pendingBreach) {
      this._pendingBreach = false;
      this._setState(STATES.HISS_BREACH);
      this._startBreachTimer();
      return { ok: true, gameOver: false, breach: true };
    }

    this._setState(STATES.DECIDING);
    this._stampDecidingEnter();
    return { ok: true, gameOver: false, breach: false };
  };

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

  GameController.prototype.forceDebtCashOut = function () {
    if (!this.canCashOut()) return { ok: false, reason: 'invalid_state' };
    this._clearBreachTimer();
    var payout = Math.floor(this.credits);
    var debt   = Math.floor(this.getDebt());
    this.lastPayout = payout;

    /* v0.06 C-1：债务撤离也要"入账"，否则 NET P&L 缺口会被永久隐藏。
       - payout（玩家被 FBC 提扣后剩余取回额）记入 total_credits_collected。
       - 不计 liquidation / creditsLost：损失体现在 buy_in - payout 自然差。
       - 单独计 total_debt_cashouts，便于"未达配额"事件单独审计。 */
    careerMerge({ creditsCollected: payout, debtCashout: true });

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
    var payout = Math.floor(this.credits);
    this.lastPayout = payout;
    careerMerge({ creditsCollected: payout });
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

  GameController.prototype.useItem = function (itemId, options) {
    options = options || {};
    var mode = options.mode || 'scan';
    if (!this.canUseItem(itemId, mode)) return { ok: false, reason: 'cannot_use_item' };
    var def = ITEM_REGISTRY[itemId];
    var sub = def.modes[mode];
    var inv = this.getInventoryItem(itemId);

    inv.count -= 1;
    if (inv.count < 0) inv.count = 0;
    if (inv.count <= 0 && itemId !== 'floppy-disk') {
      this.inventory = this.inventory.filter(function (it) { return it.id !== itemId; });
    }
    return sub.onUse(this);
  };

  /* =====================================================================
   * 工具
   * ===================================================================== */

  function _formatLockerNumber(n) {
    if (typeof n !== 'number') return String(n);
    return (n < 10 ? '0' : '') + n;
  }
  GameController.formatLockerNumber = _formatLockerNumber;

  global.GameController = GameController;
})(typeof window !== 'undefined' ? window : globalThis);
