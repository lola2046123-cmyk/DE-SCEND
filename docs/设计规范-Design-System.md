# Last Floor · Design System 设计规范 (v0.06.3)

> 作者注：本文档面向 **后续 UI / 关卡 / 弹窗 / 前端组件迭代** 的设计师与工程师，
> 以 *Control · Federal Bureau of Control* 的官僚美学为基准，
> 用 **红 / 绿 二色 + 中性冷光** 作为全局色调，所有装饰黄 / 暖金一律弃用。
>
> 本文件与 `index.html` 中 `:root` 的 `--ds-*` token 同源；
> 所有新增 UI 必须先查表，再使用 token 引用，**禁止硬编码色值**。
>
> **v0.06.3 主色对调（推翻 v0.06.2 中性化方案）**：
> HUD LED **主读数**（FLOOR / 楼层值 / `¥` / `#money` / 任务行 / 沉浸态资产）→ 暖珊瑚 `--hud-readout` (`#f8a59b`) **主色复位**。
> HUD LED **次级辅助**（标签 `实时楼层 / 许可概要 / 净资产` / 配额副数字 `/ 1,000` / mission 标签 / `净资产` 标签）→ 中性冷白 `--hud-led-readout` (`#F2F5F9`) **降级为次级**。
> mint 仍仅作"极端正反馈态"信号（过线庆贺、t3·t4 巨额 gain、odometer t3·t4、wealth-burst）。
> 红色不够亮的高亮场景（跳层 / +¥ t1·t2 / 任务关键数字），统一用纯白 `#FFFFFF`，末帧回到暖珊瑚主色。

---

## 0 · 设计原则（先记牢）

| 编号 | 原则 | 说明 |
|----|----|----|
| **P-01** | **官僚冷感** | 文档 / 文书化排版，CRT 冷光 + 混凝土暗调；忌任何"游乐场化"亮色块。|
| **P-02** | **二色语义** | 仅用 红 / 绿 表达 UI 状态。红 = 警示 / 制动 / 故障；绿 = 达标 / 增益 / 激活。|
| **P-03** | **数据为先** | 数字 / 标签优先于装饰；任何 LED / 边光都为读数服务。|
| **P-04** | **冷为底，色为信号** | 屏幕底色保持中性冷光，红绿仅用于"事件爆光"。色块面积越小越好。|
| **P-05** | **降级优先** | `prefers-reduced-motion` / mobile 永远是一等公民，所有动画必须可降级。|

---

## 1 · 颜色 Color Tokens

### 1.1 主色 · Positive Mint（青绿）

> 替代旧 *暖金 / 琥珀*，用于「达标 / 增益 / 激活 / 已解锁」。
> 灵感来自 *Control · Abilities* 界面的青绿激活态。

| Token | HEX | 用途 |
|----|----|----|
| `--ds-positive` | `#4ade80` | 主色（边框 / LED / 标签） |
| `--ds-positive-bright` | `#6ee7a7` | 高亮（hover / 文字着重） |
| `--ds-positive-soft` | `rgba(74,222,128,.18)` | 弱底（背景填充 / 内辉光） |
| `--ds-positive-glow` | `rgba(74,222,128,.55)` | 主辉（text-shadow / box-shadow） |
| `--ds-positive-deep` | `#22a356` | 深 mint（阴影 / 颗粒底） |

### 1.2 警示色 · Danger Red（FBC 锈红）

> 用于「破产 / 警示 / 制动 / 故障 / 配额未达成」。

| Token | HEX | 用途 |
|----|----|----|
| `--ds-danger` | `#ff4d4d` | 主红（多用于警告标签） |
| `--ds-danger-bright` | `#ff6b6b` | 高亮（hover） |
| `--ds-danger-soft` | `rgba(255,77,77,.18)` | 弱底（错误背景） |
| `--ds-danger-glow` | `rgba(212,32,32,.55)` | 主辉 |
| `--ds-danger-deep` | `#a01515` | HISS 红（不可降级） |

### 1.3 中性冷光 · Neutral Cool

| Token | HEX | 用途 |
|----|----|----|
| `--ds-neutral-cool` | `#c8d0d8` | 正文 / 主读数 |
| `--ds-neutral-cool-bright` | `#e8eff5` | 强调（按钮文字） |
| `--ds-neutral-cool-mid` | `#6b7580` | 副文 / 占位符 |
| `--ds-neutral-cool-dim` | `#4a5560` | 边框 / 分隔线 |

### 1.3-bis HUD LED 主 / 次级双层色规则（v0.06.3 对调）

> v0.06.2 曾把 LED 主读数中性化（冷白）→ 用户反馈"珊瑚红出现概率应该更高"。
> **v0.06.3 修正**：主读数回到暖珊瑚（主色复位），冷白降级为标签 / 配额 / 净资产标签等次级辅助。

#### 主层 · `--hud-readout`（暖珊瑚，主色）

| Token | HEX / RGBA | 用途 |
|----|----|----|
| `--hud-readout` | `rgba(248, 165, 155, 1)` (`#f8a59b`) | LED 主读数：FLOOR / 楼层值 / `¥` / `#money` / 任务行 / 沉浸态资产、场景层 `credits-delta-flash` 末帧 |
| `--hud-readout-glow` | `rgba(248, 165, 155, 0.5)` | 主读数 text-shadow 主辉 |

#### 次级层 · `--hud-led-readout`（中性冷白，副色）

| Token | HEX / RGBA | 用途 |
|----|----|----|
| `--hud-led-readout` | `#F2F5F9` | LED 次级冷白底（保留 token，用于未来"专门的中性副读数"） |
| `--hud-led-readout-soft` | `rgba(220, 232, 246, 0.62)` | 副读数 / 标签弱调（label `实时楼层` / `许可概要` / mission 标签） |
| `--hud-led-readout-glow` | `rgba(220, 232, 246, 0.45)` | 次级元素弱辉 |

**LED 高亮替代规则**（红色不够亮时的备选高亮 — 与 v0.06.2 一致）：
- 跳层闪光 / t1·t2 普通 +¥ 闪光高亮帧 / 任务关键数字（`.hud__mission-gold`）→ **纯白 `#FFFFFF`**
- 末帧（`100%`）回到 `var(--hud-readout)` 暖珊瑚主色（v0.06.2 旧版回到冷白，v0.06.3 已调整）。
- mint `--ds-positive-bright` 仅留给极端正反馈（quota-cleared / t3·t4 gain pulse / wealth-burst）。

### 1.4 基础物料色

| Token | HEX |
|----|----|
| `--concrete-void` | `#070707`（最深背景） |
| `--concrete-deep` | `#0e0e0e` |
| `--concrete-base` | `#1c1c1c` |
| `--concrete-mid` | `#2a2a2a` |
| `--concrete-light` | `#3d3d3d` |

### 1.5 ⚠️ 弃用 · Deprecated

| 旧 Token | 新映射 | 备注 |
|----|----|----|
| `--warn-yellow` | `var(--ds-danger)` | 兼容旧引用，新代码禁用 |
| 任意 `#f5c800` / `#ffe066` / `#ffd060` / `#fff4aa` 等暖金硬编码 | 改 `--ds-positive` 或 `--ds-danger` | 已全局清理 |

### 1.6 语义对照表（写新组件时直接照搜）

| 语义 | 推荐 token |
|----|----|
| 达标 / 增益 / 解锁 / 完成（**仅极端态**） | `--ds-positive` 系 |
| 破产 / HISS / 制动 / 错误 | `--ds-danger` 系 / `--hiss-red*` |
| HUD LED 主读数（FLOOR / 楼层值 / ¥ / #money / 任务行）**默认态** | `--hud-readout` (`#f8a59b` 暖珊瑚，v0.06.3 主色复位) |
| HUD LED 次级辅助（标签 / 配额副数字 / 净资产标签 / mission 标签） | `--hud-led-readout-soft` (`rgba(220,232,246,.62)` 冷白) |
| HUD LED 高亮闪光（跳层 / t1·t2 +¥ / 任务关键数字） | 纯白 `#FFFFFF`，末帧回 `--hud-readout` 暖珊瑚 |
| 场景层资产闪字（`credits-delta-flash` 等） | `--hud-readout` (`#f8a59b` 暖珊瑚，与 LED 主读数同源) |
| 普通文字 / 副标 | `--bureau-white` / `--ds-neutral-cool` |
| 装饰光 / horizon / floor reflect | 冷青 `rgba(80,200,220,.x)` |

---

## 2 · 字体 Typography

### 2.1 字体族

| 用途 | font-family |
|----|----|
| 主 UI 正文 | `"Helvetica Neue", Helvetica, Arial, sans-serif` |
| 数字 / 表格 / 文档化标签 | `"Courier New", monospace`（FBC 文书感） |
| 资产数字 / HUD readout | `"Inter", system-ui, sans-serif` |
| 楼层 LED / 序列号 | `"VT323", monospace`（CRT 像素风） |
| Tabular numbers | `font-variant-numeric: tabular-nums;`（必加） |

### 2.2 字号阶梯

> ❗ **中文最低 8px (0.5rem)**；交互文字最低 12px (0.75rem)。
> ❗ **v0.06.1 弹窗强化**：所有"系统级模态弹窗"（资产异动档案 / 配额未达成 / 补给站 / BOSS 质询 / 撤离结算）正文不得低于 12.5px，标题不得低于 12px。

| Level | size (clamp) | 用途 |
|----|----|----|
| `display-xl` | `clamp(1.55rem, 6.8vw, 1.9rem)` | 货舱卡 ±¥ 主数字 |
| `display-lg` | `clamp(1.28rem, 5.2vw, 1.72rem)` | HUD 资产 #money |
| `display-md` | `clamp(0.9rem, 4.2vw, 1.25rem)` | 叙事标签 (`narrative-flash__tag`) |
| `modal-title` | `clamp(12px, 0.84rem, 14.5px)` | **系统弹窗标题**（trm header / debt-warning header） |
| `modal-title-cn` | `clamp(15px, 1.05rem, 18px)` | **系统弹窗主标题**（result title / boss question / safe-node title） |
| `modal-body` | `clamp(12.5px, 0.82rem, 14.5px)` | **系统弹窗正文**（trm lore / debt text / safe-node lead / directive） |
| `modal-tag` | `clamp(11px, 0.7rem, 12.5px)` | 弹窗内 `[ 名目 ]` 标签 |
| `modal-btn` | `clamp(11.5px, 0.72rem, 13px)` | 弹窗按钮（min-height 36–44px） |
| `modal-meta` | `clamp(10px, 0.62rem, 11.5px)` | 弹窗角标 / ref / footnote |
| `body-lg` | `clamp(0.62rem, 2.8vw, 0.82rem)` | 货舱品名 |
| `body-md` | `clamp(0.55rem, 2vw, 0.7rem)` | 普通正文 |
| `body-sm` | `clamp(0.5rem, 1.85vw, 0.6rem)` | 任务行 / 状态信息 (8px min) |
| `tag` | `0.5rem` | 全大写监视器 tag (`SEALED`, `LOT 37`) |
| `caption` | `clamp(0.42rem, 1.9vw, 0.54rem)` | 极弱化注释（**最低 8px**） |

### 2.3 字重

| weight | 用途 |
|----|----|
| `400` | 普通文字 |
| `600` | 标签 / 按钮副本 |
| `700` | 子标题 / 强调段 |
| `800` | 数字 / 主标题 |
| `900` | 极致强调（仅金额变动峰值） |

### 2.4 间距

| 属性 | 推荐值 |
|----|----|
| `letter-spacing`（中文段落） | `0.04em – 0.06em` |
| `letter-spacing`（监视器 tag） | `0.12em – 0.20em` |
| `letter-spacing`（数字） | `0.04em – 0.06em` |
| `line-height`（正文） | `1.45 – 1.55` |
| `line-height`（标题） | `1.05 – 1.20` |

---

## 3 · 间距 Spacing

> 全局采用 4px 倍数 + `clamp()` 实现响应式收缩。

| Token | 值 | 用法 |
|----|----|----|
| `space-2xs` | `2px / clamp(.1rem,.5vw,.15rem)` | 标签内边距 |
| `space-xs`  | `4px – 6px` | icon ↔ 文字间距 |
| `space-sm`  | `8px – 12px` | 表单输入内边距 |
| `space-md`  | `clamp(.4rem, 1.4vw, .65rem)` | 卡片之间留白 |
| `space-lg`  | `clamp(.6rem, 2vw, .9rem)` | section 之间 |
| `space-xl`  | `clamp(.8rem, 3vw, 1.2rem)` | overlay 与主内容之间 |
| `space-2xl` | `clamp(1.2rem, 4vw, 2rem)` | 全屏弹窗左右内边距 |

**栅格基准**：宽度 `min(420px, 100vw)`，移动竖屏为主，禁止 1024+ 宽显示。

---

## 4 · 弹窗 Overlay / Dialog

### 4.1 通用骨架

```html
<div class="overlay-shell" role="dialog" aria-label="…">
  <div class="overlay-shell__decor" aria-hidden="true"><!-- 3D 布景层 --></div>
  <div class="overlay-shell__head"><!-- 顶部 tag --></div>
  <div class="overlay-shell__body"><!-- 主内容（z-index:5） --></div>
  <div class="overlay-shell__foot"><!-- 底部 hint / CTA --></div>
</div>
```

### 4.2 视觉规范

| 属性 | 值 |
|----|----|
| 背景 | `radial-gradient(...) ` 冷调（参考 `#locker-selection-overlay`、`#manifest-reveal-overlay`） |
| `backdrop-filter` | `blur(6px – 10px)` |
| 主色边框 | 1px `rgba(120, 130, 140, .40)` |
| 高亮边框（hover） | 1px `var(--ds-positive)` 或 `var(--ds-danger)` |
| z-index 层级 | `decor:0 < body:5 < hint/CTA:10 < toast:60` |

### 4.3 动效

| 状态 | 动效 |
|----|----|
| open | `opacity 0 → 1`，时长 `.28s ease`，叠 `transform: scale(0.985 → 1)` |
| close | `opacity 1 → 0`，时长 `.22s ease` |
| reduce-motion | `opacity` 单帧切换，禁用 transform |

### 4.4 三类弹窗模板

1. **信息弹窗（FBC 文档式）**
   - 背景 `--concrete-base`
   - 顶部 monospace tag + 主红/绿一种语义边框
   - 例：`risk-auth-panel`、`debt-warning-overlay`

2. **3D 场景弹窗（沉浸式）**
   - 背景 `radial-gradient` 冷调
   - 含 `.*-decor`（梯形墙、灯架、地平线、vignette）
   - 内容居中，z-index:5
   - 例：`locker-selection-overlay`、`manifest-reveal-overlay`

3. **叙事弹窗（短闪）**
   - `.narrative-flash-overlay`，停留 1.6s 后自动消失
   - 仅 1 个 monospace tag + 1 行小字
   - 默认 mint，penalty 走红

### 4.5 系统弹窗字号 / 亮度规范（v0.06.1）

> 适用于：`#transaction-receipt-modal` / `.debt-warning-overlay` / `.safe-node-overlay` / `.boss-overlay` / `.result-overlay`。
> 这五类弹窗承载结算、规程、警告等关键信息，需保证桌面 / 移动端字面清晰、可阅读。

| 元素 | 字号 token | alpha（v0.06.1） |
|----|----|----|
| 顶部 tag / classification | `modal-meta` `clamp(10–11.5px)` | `0.78 – 0.96`（原 0.5–0.85） |
| 弹窗英文 header (`uppercase`) | `modal-title` `clamp(12–14.5px)` | `0.96`（原 0.9） |
| 中文主标题 | `modal-title-cn` `clamp(15–18px)` | 渐变色文字保留，需 `text-shadow` |
| 数字主体（金额变动） | `display-md` 或 `clamp(16–19px)` | `0.96 – 0.98` |
| 正文 / lore / lead | `modal-body` `clamp(12.5–14.5px)` | `0.92 – 0.96`（原 0.82–0.9） |
| `[ 名目 ]` 标签 | `modal-tag` `clamp(11–12.5px)` | `0.85` |
| 按钮文 | `modal-btn` `clamp(11.5–13px)`，min-height 36–44px | `0.95`+ |
| 角标 / footer / ref | `modal-meta` `clamp(10–12px)` | `0.7 – 0.85` |

**通用要求**：
- 标题层加 `text-shadow: 0 0 4–6px rgba(0,0,0,.5)`，避免在亮背景上糊成一片；
- 所有"暖色珊瑚红"统一收敛到 `rgba(220, 158, 145, x)`、`rgba(232, 158, 142, x)` 两档；
- 所有"绿色"统一向 `--ds-positive` 靠拢（`rgba(140, 215, 168, x)` / `rgba(160, 230, 178, x)`）；
- 不得保留任何 alpha < 0.6 的中文正文 —— 这是模态弹窗的硬约束。

---

## 5 · 按钮 Button

### 5.1 主按钮（核心动作 ▲ 上行 / ▼ 撤离）

| 属性 | 值 |
|----|----|
| 形态 | 圆形金属按钮 (`metal-btn`) |
| 主色 | 红 = 撤离（`metal-btn--withdraw`），红 = 上行（`metal-btn--deploy`） |
| 尺寸 | `66px × 66px`，圆形 |
| Hover (PC) | 三角呼吸动画 + 外光晕 (`metal-tri-breath-*`) |
| Active | `transform: scale(0.93) translateY(2px)` |
| Focus | `outline: 1.5px solid currentColor; outline-offset: 4px` |
| 触屏 | 无 hover，靠 `:active` + 音效（`playMetalTap`） |
| 音效 | `playMetalTap('deploy' | 'withdraw')` |

### 5.2 次按钮 / 表单按钮

| 类型 | 用法 | 视觉 |
|----|----|----|
| 默认 | `<button class="btn btn--secondary">` | 1px 边框 `--ds-neutral-cool-dim`，文字 `--ds-neutral-cool` |
| 已选 | `[aria-pressed="true"]` | 边框 `--ds-positive`，文字 `--ds-positive-bright` |
| 危险 | `<button class="btn btn--danger">` | 边框 `--ds-danger`，文字 `--ds-danger-bright` |
| 文字链 | `<button class="btn btn--link">` | 无边框，monospace，下划虚线 |

### 5.3 状态规范（必须支持的 5 种态）

```
default  → hover  → active  → disabled  → focus-visible
```

每个状态都必须：
- 颜色变化清晰（最少 8% lightness 差）；
- transition `0.18 – 0.25s ease`；
- disabled 状态必须 `pointer-events: none; opacity: .35`。

---

## 6 · 数字 Numbers

> 数字是本游戏 90% 信息量的载体，规范从严。

| 维度 | 规则 |
|----|----|
| 字体 | `Inter` 主，`Courier New` / `VT323` 备选 |
| 必加属性 | `font-variant-numeric: tabular-nums;` |
| 千位分隔 | `formatYuanComma()`，例：`¥ 12,580` |
| 货币符号 | `¥`（人民币） |
| 正负号 | 正数无前缀，负数 `- ¥` |
| HUD LED 主读数 | `--hud-readout` (`#f8a59b` 暖珊瑚，v0.06.3 主色复位) |
| HUD LED 次级辅助 | `--hud-led-readout-soft` (`rgba(220,232,246,.62)` 冷白，标签 / 配额副数字 / mission 标签 / 净资产标签) |
| 场景闪字 | `--hud-readout`（与 LED 主读数同源，`credits-delta-flash` 等叙事层共用） |
| 增益高亮 | t1/t2 = 纯白 `#FFFFFF` 闪 → 末帧回 `--hud-readout`；t3/t4 = `--ds-positive-bright`（mint） |
| 亏损 | `--ds-danger-bright`（冷红） |
| 增益脉冲 | `money-hud-gain-pulse`（t1·t2 纯白闪 → 暖珊瑚）/ `money-hud-gain-pulse-strong`（t3·t4 mint） |
| 亏损里程表 | `money-odometer--loss`（冷红收缩） |
| 高额增益 | `money-odometer--t3 / --t4`（mint 微膨胀，**极端态保留**） |

---

## 7 · 输入框 Input

```html
<input type="text" class="ds-input" placeholder="¥ 200" />
```

| 状态 | 视觉 |
|----|----|
| default | `border: 1px solid var(--ds-neutral-cool-dim);` `background: rgba(15,15,15,.6);` |
| hover | `border-color: var(--ds-neutral-cool-mid);` |
| focus | `border-color: var(--ds-positive);` `box-shadow: 0 0 0 3px var(--ds-positive-soft);` |
| invalid | `border-color: var(--ds-danger);` `box-shadow: 0 0 0 3px var(--ds-danger-soft);` |
| disabled | `opacity: .4; pointer-events: none;` |

| 属性 | 值 |
|----|----|
| `min-height` | 38px (mobile) / 32px (PC) |
| 字体 | `Courier New` |
| 字号 | `body-md`（≥ 12px） |
| 内边距 | `.5rem .75rem` |
| 圆角 | `2px` |

**滚动条**（深色界面专用）：

```css
scrollbar-width: thin;
scrollbar-color: rgba(120, 75, 60, 0.4) rgba(15, 10, 8, 0.55);
```

---

## 8 · 图标 Icons

### 8.1 风格（v0.06 改版）

> **一律使用面性图标（filled glyph），禁止线性图标。**
> 灵感参考 *Control · Loadout / Weapon Mods* 的实心剪影 icon —— 简化几何 + 单色填充，
> 在小尺寸下识别度最高，且与 FBC 官僚文档美学一致。

| 维度 | 规则 |
|----|----|
| 表现 | `fill: currentColor; stroke: none;`（**禁用 `stroke` 描边**） |
| 尺寸 | 8x8 / 12x12 / 16x16 / 24x24 四档 |
| 来源 | 必须矢量（SVG inline），禁止位图 |
| 调色 | `currentColor`，由父元素决定语义；多态可单独覆盖 fill |
| 视觉密度 | 占位框内"实心面积比" ≥ 35%（避免看起来像描边） |
| 圆角 | 默认尖角；仅"按钮 / 标签 / 容器"用 1–2px 圆角，icon 本体保持几何尖锐 |
| 路径精度 | `shape-rendering: geometricPrecision;` |

### 8.2 命名约定

| 类型 | prefix | 例 |
|----|----|----|
| 状态 | `icon--state-*` | `icon--state-active` (mint) |
| 警示 | `icon--state-danger` | 红 |
| 操作 | `icon--action-*` | `icon--action-cashout` |

### 8.3 BGM / 音频图标（实心喇叭）

参考 `#bgm-toggle-btn` 的 SVG，全部使用 `fill="currentColor"`：

```svg
<!-- ON 态：实心喇叭 + 两层实心声波月牙 -->
<svg viewBox="0 0 16 16">
  <path d="M0.6 5.5H3.4L7.4 2.05A0.95 0.95 0 0 1 9 2.78V13.22A0.95 0.95 0 0 1 7.4 13.95L3.4 10.5H0.6Z"/>
  <path d="M10.4 5.0Q12.55 6.4 12.55 8T10.4 11.0V9.4Q11.25 8.55 11.25 8T10.4 6.6Z"/>
  <path d="M12.5 3.0Q15.6 5.0 15.6 8T12.5 13.0V11.4Q14.0 9.95 14.0 8T12.5 4.6Z"/>
</svg>
```

| 状态 | fill |
|----|----|
| ON | `currentColor`（继承按钮当前色） |
| OFF | 喇叭仍 `currentColor`，实心 X 单独 `var(--ds-danger)` |

### 8.4 菜单按钮（实心抽屉柜）

`#fbc-menu-btn` —— 由 3 条 1.6px 细线改为 3 块 14×3px 实心方块（filled glyph）：

```css
.fbc-menu-btn__bar {
  width: 14px; height: 3px;
  background: var(--bar-color);
  border-radius: 0;       /* 尖角，FBC 抽屉感 */
}
```

展开态：上下两块旋转 ±45°，中间块 `opacity:0` + `scaleX(0.4)` 收缩消失，
仍是"实心方块"而非线条。

### 8.5 兜底替换原则

如果旧组件还有线性 SVG（`fill="none"; stroke="..."`），按以下优先级改造：

1. **首选**：将所有 stroke path 改写为闭合的 fill 形状（multi-path 可叠加 fill-rule="evenodd"）。
2. **次选**：用 CSS pseudo-element 构造实心几何（`::before { background: …; clip-path: polygon(…); }`）。
3. **不选**：保留 `stroke + stroke-width`（违反规范）。

---

## 9 · LED / 监视器读数（HUD 专属）

### 9.1 核心 readout（v0.06.3 主 / 次级双层色）

#### 主层（暖珊瑚 `--hud-readout`，v0.06.3 主色复位）

| 元素 | 类名 | 颜色（默认态） | 极端态 |
|----|----|----|----|
| 楼层 LED 主行 | `.hud__readout-main--floor` | `--hud-readout` 珊瑚红 | quota-cleared 时 mint |
| 楼层数 `#floor` | `.hud__led-value` | 继承父级珊瑚红 | 跳层瞬间纯白 `#FFFFFF` → 末帧回珊瑚红 |
| 资产主行 | `.hud__readout-main--asset` | `--hud-readout` 珊瑚红 | 同 #money |
| 资产数字 `#money` | `#money` | 继承父级珊瑚红 | t1·t2 纯白闪 → 末帧回珊瑚红 / t3·t4 mint 闪 / loss 红 / quota-cleared mint |
| `¥` 货币符号 | `.hud__readout-currency` | 继承父级珊瑚红 | 同上 |
| 任务行（pre-game） | `.hud__mission-line` | `rgba(248,165,155,.92)` 珊瑚红软调 | 关键数字 `.hud__mission-gold` 走纯白高亮 |
| 沉浸态资产 | `.hud__live-credits-line` | `--hud-readout` 珊瑚红 | — |

#### 次级层（中性冷白，v0.06.3 降级为辅助）

| 元素 | 类名 | 颜色（默认态） |
|----|----|----|
| 实时楼层 label | `.hud__readout-label` | `rgba(220,232,246,.55)` 冷白 |
| 许可概要 / 回收进度 label | `#hud-asset-label` | `rgba(220,232,246,.55)` 冷白 |
| `/ 1000` 配额分隔符 | `.hud__quota-sep` | `rgba(220,232,246,.32)` 冷白弱 |
| `/ 1000` 配额数字 | `.hud__quota-target` | `rgba(220,232,246,.5)` 冷白中 |
| mission 标签 | `.hud__readout-label--mission` | `rgba(220,232,246,.55)` 冷白 |
| 沉浸态副标 | `.hud__live-label` | `rgba(220,232,246,.55)` 冷白 |
| 净资产 label `净资产` | `.hud__net-asset__label` | `rgba(220,232,246,.45)` 冷白弱 |

#### 净资产语义（独立通道，v0.06.3 不变）

| 元素 | 类名 | 颜色 |
|----|----|----|
| 净资产值 | `.hud__net-asset__value` | 正 = `--ds-positive`；负 = `--ds-danger`（自动闪烁） |

> ⚠ **v0.06.2 仍生效**：旧版 `// ALLOC_QUOTA · CLEARED` mono 标签（`.hud__quota-cleared-tag`）已删除——
> 占用 LED 高度且与场景层 `// FBC §3.1 — 配额已达成` 闪现重复。
> 配额过线反馈仅保留：HUD 数字渐染 mint + 一次性扫光 + 场景顶部闪现，v0.06.3 不重新引入。

### 9.2 LED 灯效（v0.06.3 暖珊瑚光晕复位）

```css
.hud__readout-main {
  color: var(--hud-readout);
  text-shadow:
    0 0 6px var(--hud-readout-glow),             /* 主辉：暖珊瑚 */
    0 0 20px rgba(248, 165, 155, 0.28),          /* 中辉 */
    0 0 40px rgba(220, 90, 80, 0.16);            /* 远辉：略偏深红，提供层次 */
}
```

LED 闪烁动画必须使用 `steps()` 而非 `linear`，模拟 CRT 跳帧。

### 9.3 跳层闪光范例（v0.06.3：纯白闪 → 暖珊瑚）

```css
@keyframes skip-counter-flash {
  0%   { color: #FFFFFF; transform: scale(1.45);
         text-shadow: 0 0 14px rgba(255,255,255,.85), 0 0 32px rgba(248,165,155,.5); }
  60%  { color: #FFFFFF; transform: scale(1.1);
         text-shadow: 0 0 8px rgba(255,255,255,.55); }
  100% { color: var(--hud-readout); transform: scale(1);
         text-shadow: 0 0 6px var(--hud-readout-glow),
                      0 0 20px rgba(248,165,155,.28); }
}
```

适用范围：`#floor.skip-flash`、`.shaft.skip-glow`（暖珊瑚冲光，v0.06.3 同步）、`@keyframes money-hud-gain-pulse`（t1·t2 末帧继承珊瑚红主色）。

### 9.4 极端态保留 mint 一览（v0.06.3 不变）

| 触发 | 类名 / keyframes | 视觉 |
|----|----|----|
| 配额过线 | `--quota-cleared` / `--quota-flash` / `fbc-quota-flash` | quota / # money 渐染 mint + 1.1s 扫光 |
| t3 大额 +¥ | `money-hud-gain-pulse-strong` | 30% 关键帧 mint glow（×0.55 alpha） |
| t4 巨额 +¥ | `money-hud-gain-pulse-strong` + `--t4` | 同上 + odometer-swell-t4 微膨胀 |
| 高额里程表 | `money-odometer--t3 / --t4` | mint glow text-shadow |
| 大额收益爆光 | `wealth-burst / --mega` | 车厢 mint 爆闪 |

---

## 10 · 货舱卡 / Polarity（关键组件）

```css
.manifest-card[data-polarity="gain"]    → mint 系（v0.06 由暖金改）
.manifest-card[data-polarity="loss"]    → 锈红
.manifest-card[data-polarity="neutral"] → 冷灯白
```

| 状态 | shell border | crate-glow | delta 文字 | hue-rotate |
|----|----|----|----|----|
| gain | `rgba(74,222,128,.35)` | `rgba(74,222,128,.65)` | `rgba(110,231,167,.95)` | `+72deg` |
| loss | `rgba(140,58,50,.40)` | `rgba(190,75,65,.65)` | `rgba(210,115,100,.95)` | `-18deg` |
| neutral | 默认（无 override） | `rgba(130,140,155,.40)` | `rgba(165,170,178,.85)` | 无 |

---

## 11 · 动效 Animation

### 11.1 节奏标准

| 用途 | duration | easing |
|----|----|----|
| 微反馈（tap / focus） | 0.15 – 0.20s | `ease-out` |
| 标准切换（弹窗 / 卡片） | 0.28 – 0.40s | `ease` / `cubic-bezier(.4,0,.2,1)` |
| 大型场景过渡 | 0.55 – 0.85s | `cubic-bezier(.16,1.05,.26,1)`（弹性） |
| 庆贺爆光 | 0.95 – 2.28s | `cubic-bezier(.1,1.12,.2,1)` |

### 11.2 必须的降级

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    transition-duration: .01ms !important;
  }
  /* 关键反馈仍保留 0.85s 快速 fade */
}
```

### 11.3 全局可复用动画

| 类名 | 用途 |
|----|----|
| `money-hud-gain-pulse[--t1·--t2]` | 普通增益脉冲（v0.06.3：35% 帧纯白高亮，末帧继承 #money 暖珊瑚主色） |
| `money-hud-gain-pulse-strong[--t3·--t4]` | 极端增益脉冲（mint，保留） |
| `money-odometer--loss / --t3 / --t4` | 资产里程表反馈（loss 冷红 / t3·t4 mint glow） |
| `credits-delta-flash--gain-tier-1..4` | 开门 ±¥ 大数字弹出（场景层叙事，与 LED 主读数同源暖珊瑚） |
| `narrative-flash` | 短叙事 tag 闪现 |
| `wealth-burst / --mega` | 大额收益车厢爆光（mint，极端态） |
| `skip-counter-flash` / `shaft-skip-glow` | 跳层闪光（v0.06.3：纯白闪 → 末帧回暖珊瑚） |

---

## 12 · 移动端 / 响应式

### 12.1 断点

```css
@media (max-width: 480px)        { /* 紧凑列 / 隐藏远景灯 */ }
@media (max-height: 760px)       { /* 收紧间距 */ }
@media (max-height: 640px)       { /* 极致收紧（iPhone SE 等） */ }
@media (hover: none) and (pointer: coarse) { /* 触屏：禁 hover, 仅 active */ }
```

### 12.2 触屏专属规则

- 所有 hover-only 效果必须在 `(hover: hover)` 内才启用；
- 所有 desktop 键盘提示在 `(hover: none) and (pointer: coarse)` 内必须改成"点击"提示
  （参考 `.input-hint__desktop` / `.input-hint__touch`）；
- 所有"点击外部关闭"使用 `pointerdown` 而非 `mousedown`（iOS Safari 兼容）。

---

## 13 · z-index 层级表

| z-index | 层 |
|----|----|
| 0 | 场景布景 (`*-decor`) |
| 1 – 4 | stage 主体 |
| 5 – 9 | 主内容（弹窗内 body） |
| 10 – 19 | HUD / 永久性按钮 |
| 20 – 29 | toast / hint |
| 100 – 199 | flash overlay |
| 200 – 299 | 软盘 / 命令圆盘 |
| 300 – 399 | locker / manifest 全屏 |
| 400 – 499 | 首次访问引导 |
| 500+ | 系统级（崩溃 / debug） |

---

## 14 · 文案规范

| 风格 | 描述 |
|----|----|
| **官僚怪诞** | "委员会对您的稳定性表示担忧。" |
| **理性克制** | 数字优先于形容词，避免 emoji 与感叹号。 |
| **二段化** | tag（全大写 monospace）+ 简短陈述。 |
| **禁用词** | 死 / 活 / 输 / 赢，改用 *清算 / 撤离 / 核销 / 偏差*。 |
| **数字格式** | `¥ 1,200` 中间空格；负数 `- ¥58`（"-" 后空格）。 |

---

## 15 · 检查清单 Checklist（提交新组件前必过）

- [ ] 颜色全部用 `--ds-*` 或既有 token，无硬编码黄/暖金/暖橙；
- [ ] 中文最小字号 ≥ 8px（0.5rem），交互文字 ≥ 12px；
- [ ] 所有数字加 `font-variant-numeric: tabular-nums`；
- [ ] hover / active / focus / disabled 四态齐备；
- [ ] 移动端 (`hover: none`) 无残留"按悬浮键"提示；
- [ ] `pointerdown` 替代 `mousedown`；
- [ ] `prefers-reduced-motion` 降级路径已定义；
- [ ] 弹窗有 `role="dialog"` + `aria-label`；
- [ ] 文案符合 §14（无禁用词，FBC 风）；
- [ ] z-index 在 §13 表内。
- [ ] **HUD/LED 主层**：默认走 `--hud-readout`（暖珊瑚）—— v0.06.3 主色复位；mint 仅在"极端态" CSS 类下出现（§9.4 表）；
- [ ] **HUD/LED 次级层**：标签 / 配额副数字 / mission 标签 / 净资产标签等"读数附属物"统一走 `rgba(220,232,246,.32~.62)` 冷白系；
- [ ] **HUD/LED 高亮帧**：跳层 / +¥ t1·t2 / 任务关键数字用纯白 `#FFFFFF`，**末帧必须回到 `--hud-readout`**（不再回到冷白）；
- [ ] **HUD/LED 区**：禁止在 LED 元素上挂装饰性次级标签（占高度且重复信息）。

---

## 附录 A · 与旧版本（≤ v0.05）的差异速览

### A.1 v0.05 → v0.06（黄→mint 主基调切换）

| 类别 | v0.05 旧 | v0.06 新 |
|----|----|----|
| 主积极色 | 暖金 `#f5c800` / `#ffe566` / `#fff4aa` | mint `#4ade80` / `#6ee7a7` |
| 货舱卡 gain glow | `rgba(200,165,80,.7)` | `rgba(74,222,128,.7)` |
| HUD 任务行 | `rgba(245,213,71,.92)` 黄 | `rgba(74,222,128,.92)` mint |
| Coin 颜色 | `#f5c800 → #9a7c00` 金币 | mint 控制币 (`#4ade80 → #1f6e3c`) |
| Skip flash | `#ffe066` | `#6ee7a7` |
| Wealth burst | 黄 `rgba(255,210,80,...)` | mint `rgba(74,222,128,...)` |
| Locker LED | 暖琥珀 | mint 待机 |
| Locker 顶部横梁 | 暖金 | 冷白金属 |
| Multiplier mid | `--warn-yellow` | `--ds-danger-bright` |
| Radial brake 段 | 暖橙 `rgba(255,175,70,..)` | 红 `rgba(255,80,80,..)` |
| `--warn-yellow` token | `#f5c800` | `var(--ds-danger)` 兼容映射 |

> 升级路径：旧 token 全部保留兼容映射，新组件请直接使用 `--ds-*`。

### A.2 v0.06 → v0.06.1（系统弹窗字号 / 亮度规范化）

| 类别 | v0.06 旧 | v0.06.1 新 |
|----|----|----|
| 系统弹窗正文 | 多处 < 12.5px / alpha < 0.85 | clamp(12.5–14.5px) / alpha ≥ 0.94 |
| 系统弹窗标题 | font-weight 普通 | 700+ + `text-shadow` 提亮 |
| `manifest-reveal-overlay__head` | top 偏高（远离物品） | top `clamp(56px, 14%, 110px)`，与 lot row 横排 |
| 配额过线庆贺 | + mono 标签 `// ALLOC_QUOTA · CLEARED` | （v0.06.2 删） |
| 委员会低语 / 边缘碎闪 | 字小 + 0.42 alpha + 1.35s | clamp(12–14px) + 0.78 alpha + 2.8s |
| `doorRevealSettleMs` | 900ms | 200ms（去无意义等待） |

### A.3 v0.06.1 → v0.06.2（HUD LED 去 mint，纯白替代）

| 类别 | v0.06.1 旧 | v0.06.2 新 |
|----|----|----|
| **LED 默认主读数** | `--hud-readout` (`#f8a59b` 暖珊瑚) | `--hud-led-readout` (`#F2F5F9` 冷白，新 token) |
| **LED 标签 / quota / mission** | 部分 mint / 部分珊瑚红 | 统一 `rgba(220,232,246,.32~.94)` 冷白 alpha 阶 |
| **跳层闪光** `#floor.skip-flash` | 0%/60% 染 mint `#6ee7a7` | 纯白 `#FFFFFF`，末帧回中性冷白 |
| **跳层井道光** `.shaft.skip-glow` | mint `rgba(74,222,128,.55)` | 冷白 `rgba(220,232,246,.45)` |
| **普通增益脉冲** `money-hud-gain-pulse`（t1·t2） | mint `#e8fff0` + 绿 glow | 纯白 `#FFFFFF` + 白 glow |
| **强增益脉冲** `money-hud-gain-pulse-strong`（t3·t4） | mint glow | **保留 mint**（极端态） |
| **任务行** `.hud__mission-line` | mint `rgba(74,222,128,.92)` | 冷白 `rgba(232,240,248,.94)` |
| **任务关键数字** `.hud__mission-gold` | mint bright | 纯白 `#FFFFFF` + 白 glow |
| **沉浸态资产** `.hud__live-credits-line` | 暖珊瑚 | `var(--hud-led-readout)` 冷白 |
| **HUD 配额过线标签** `.hud__quota-cleared-tag` | 9px mono `// ALLOC_QUOTA · CLEARED` | **完全移除**（占高度且与场景层闪现重复） |
| **菜单·规则页"货舱清点"色描述** | "金黄发光为正向" | "绿光为正向"（与全局红/绿规范一致） |

### A.4 v0.06.2 → v0.06.3（LED 主 / 次级色相对调）

> 玩家反馈："珊瑚红出现的概率应该更高一些，白色为次级色"。
> v0.06.2 把 LED 全员中性化，导致主读数失去识别度；v0.06.3 修正为**主层暖珊瑚 + 次级层冷白**的双层结构。

| 类别 | v0.06.2 旧 | v0.06.3 新 |
|----|----|----|
| **LED 主读数** `.hud__readout-main`（FLOOR / ¥ / #money） | `--hud-led-readout` (`#F2F5F9` 冷白) | `--hud-readout` (`#f8a59b` 暖珊瑚) **主色复位** |
| **沉浸态资产** `.hud__live-credits-line` | 冷白 | `--hud-readout` 暖珊瑚 |
| **任务行** `.hud__mission-line` | 冷白 `rgba(232,240,248,.94)` | 珊瑚红软调 `rgba(248,165,155,.92)` |
| **任务关键数字** `.hud__mission-gold` | 纯白 + 白 glow | **保留纯白**（红色不够亮的高亮替代位） |
| **跳层闪光** `skip-counter-flash` 末帧 | `var(--hud-led-readout)` 冷白 | `var(--hud-readout)` 暖珊瑚（高亮帧仍纯白） |
| **跳层井道光** `.shaft.skip-glow` | `rgba(220,232,246,.45)` 冷白 | `rgba(248,165,155,.42)` 暖珊瑚 |
| **普通增益脉冲** `money-hud-gain-pulse` 末帧 | 隐式继承冷白 | 隐式继承珊瑚红主色（35% 帧仍纯白高亮） |
| **次级层（保持 v0.06.2 冷白不变）** | — | 标签 / 配额副数字 / mission 标签 / 沉浸态副标 / 净资产标签 |

> v0.06.3 **核心原则**：LED 主层用暖珊瑚 → 让"读数"是视觉焦点；冷白降级为"读数附属物"。
> mint 仍仅作奖励信号；纯白 `#FFFFFF` 仍作"红色不够亮"时的高亮替代位（跳层 / +¥ t1·t2 / 任务关键数字）。

---

*文档维护：v0.06.3 · 2026-04-28*
*下一步迭代建议：v0.07 引入 `--ds-info-cyan` 用于"信息提示"语义层（仅在确实需要第三色时再加）。*
