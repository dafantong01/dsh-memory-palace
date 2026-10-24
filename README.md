# 记忆回廊（dsh-memory-palace）

把会话原文按「一轮对话」为单位、分类归档到**当前工作区**的 `memory-palace/` 目录。
目的：在 DSH 自动压缩之前，先把较早的完整原文落到磁盘，压缩后还能查回原话。

## 工作方式

1. **触发检查**：每 `checkEveryTurns` 轮（默认 5），在回合收尾处检查一次。要同时满足两道门：
   - **压力门**：上下文占用 ≥ `triggerPressure`（默认 60%）× 窗口。
     占用取 **DSH 自己的计量** `ctx.tokenMeter.measure(session).totalTokens`——压缩后它会回落；
     拿不到计量服务时才退回「日志轮次累加」，并在提示里标注「日志估算」。
   - **批量门**：可归档轮数 ≥ `minBatchTurns`（默认 10）**或** 可归档文本量 ≥ 无需归档量 × `batchByteFraction`（默认 50%）
2. **提醒**：两道门都过，插件注入一条极短提示，请模型调用归档工具（`enableSteer:false` 可关掉，关掉就没有自动归档）。
3. **分类（逐轮判断）**：模型逐轮决定每轮属于哪个类别，用 `segments` 提交：
   `[{category, fromTurn, toTurn}, …]`。同一类别可以拆成多段，最后合并成一个文件；
   每个 turn 只能归一类，区间不许重叠。
4. **保留**：`无需归档的近期文本量 = 窗口 × retainFraction`（默认 12%），比这更新的轮次不动。
   取整轮粒度、严格不超过该上限；只有单轮本身就超上限时，至少保留最后 1 轮。
   12% 的用意：压得比 DSH 压缩尾部（约 16%）更小，压缩时不会碰到你还没归档的近期内容。
5. **写入**：插件从会话日志逐字取出每个类别的轮次，按时间正序写进该类别**一个文件**（超 `maxFileBytes` 才分卷）。模型不复述内容，不会截断或改写。
6. **覆盖去重**：已归档轮次记在 `.state.json` 的 `archivedRanges`；新请求先把已覆盖的轮次剔掉，只写剩下的。
7. **归档后压缩**：`compactAfterArchive` **默认关**。`compactNow()` 不接受范围参数，压多少由 DSH 自己决定，
   可能压掉尚未归档的近期轮次（原文仍在会话日志里，可再归档）。默认不动它。

## 目录与文件名（会话级隔离）

```
<当前工作区>/
  memory-palace/
    .namespaces.json       # 会话ID → 文件夹名 的映射（插件维护）
    config.json            # 新会话的默认值（旧版遗留，仅作默认）
    <文件夹>/              # 记忆名：英文（大小写均可）+数字/空格/下划线/连字符
      config.json          # 本会话自己的开关/参数/记忆名
      .state.json          # 本会话水位、已归档区间
      index.jsonl          # 本会话的归档索引（路径相对本文件夹）
      <YYYY-MM>/           # 月份容器：归档时按归档年月找/建
        _summary.md        # 该月摘要：只追加，每段对应一次归档里的一个类别
        <category>/
          <前缀>-<category>-<YYYYMMDD-HHmmss>.md
```

- **文件夹名 = 页签里填的「记忆命名」**：英文（大小写均可）、数字、空格、下划线、连字符，≤32 位；**首尾不能有空格**，中文与路径分隔符会被拒绝。
- 没命名时用会话ID，且**不产生任何记忆文件**（只建 config/state）。
- 在页签里改名并保存 → 文件夹**就地改名**，索引里的路径是相对的，不需要跟着改。
- **文件夹即归属**：`memory-palace/<你的文件夹>/` 里的文件都属于那个会话；文件名前缀只是历史署名，不代表归属。
- **摘要每月一份**：`<YYYY-MM>/_summary.md`，只追加；同一次归档里每个类别写一段，段头是「归档日期 · [类别] 轮次范围」。
- 一次归档调用里，同一类别的所有轮次进同目录下的**一个文件**（超 `maxFileBytes` 才按轮分卷 `-p1/-p2`）。
- 不同类别 = 不同文件，即使来自同一次调用。
- 同秒冲突自动加 `-2`。分类目录强制英文小写。

### 从旧结构迁移

早期版本用过不同的目录结构。迁移脚本只用于本项目早期数据，**不包含在发布包中**；新用户从 0.1.0 开始使用无需迁移。

当前采用的结构是 `<会话>/<YYYY-MM>/<category>/`。

## 工具

| 工具 | 作用 |
|---|---|
| `palace_archive` | 归档轮次。**未命名会话会拒绝**。用 `segments` 逐段给类别：`[{category, fromTurn, toTurn}, …]`；并用 `summaries=[{category, text}, …]` 给**每个类别**写一段只概述该类别本次轮次的话（逐段追加到当月 `_summary.md`）。单类别时可用 `summary` 代替。可传 `selfName` 作文件名前缀。**超出保留边界或已归档的轮次会直接报错**（防止模型估错轮次号） |
| `palace_turns` | 列**轮次清单**：`turn` 号 + 发言者 + 开头 70 字，用于归档前确认每轮内容。`turn` 是日志事件序号（含系统指令/插件 steer/纯工具轮），**不要用“第几条消息”换算** |
| `palace_summary` | 读**月度摘要**：不指定 `month` 时列出最近几个月（摘要末尾预览 + 归档文件数）；`month=YYYY-MM` 返回该月摘要全文；`category` 只看该月某类段落；`append` + `fromTurn/toTurn` 可给**还没归档的近况**补写一段摘要 |
| `palace_search` | 检索归档。默认**只查本会话**；`namespace` 查别的会话、`all:true` 扫全部命名空间（结果标来源）、`category` 只查某类。`keyword` 支持空格分隔的多关键词（AND，引号包短语）。默认**按轮聚合**（每轮一条代表命中 + 该轮命中数），`limitTurns` 控制轮数（默认取 `searchTurnLimit`=12）；`groupByTurn=false` 回原始命中行（旧 `limit` 语义）。片段约 220 字符，总输出上限 8K，文件读失败会跳过并注明。**只搜归档正文，不搜 `_summary.md`**（摘要里的概述性说法要用 `palace_summary` 读）；但原文 **0 命中**时会自动回查摘要并标注「摘要不是轮次」，可用 `includeSummary:true` 强制追加 |
| `palace_read` | 读归档。`fromTurn/toTurn` 返**完整原文**；`path` 可省略（按轮次自动找文件），也接受 search 的「文件夹/…」路径；可传 `namespace`。末尾附一行**回链**（提取 turn 引用/文件名/工具名，自动提取仅供参考） |
| `palace_config` | 查看/修改**本会话**配置（`get` 会同时返回 effective / 工作区默认 / 本会话配置） |

### 检索四步法（为省 token 设计）

```
0) 不知道在哪个月：palace_summary(limit=6)
   → 每月摘要末尾预览；找到大致年月
0b) palace_summary(month="2026-10")
   → 该月全部摘要段落（哪次归档、讲了什么）
1) palace_search(keyword="事故教训", limit=3)
   → 约 1 千字符：命中位置 + 轮次 + 行号 + 文件路径
2) palace_read(fromTurn=48, toTurn=48)
   → 该轮完整原文（思考、工具调用、返回都在）
```

- 单次读取默认上限 **60,000 字符**（约一本书的三分之一），硬上限也是 6 万。
- 单轮超过 6 万字符时，返回前 6 万并提示 `用 offset=N 继续`，可分段读完整个大轮（实测 12.7 万字符分 3 段读完）。
- 不给轮次、也不给 path 时只返回文件开头 6 万字符，并提示按轮次精确取。

## 开关（会话级，fail-closed）

真正生效要同时满足（现在收成**一个统一门** `gateState()`，页签会显示“为什么没生效”）：

1. **全局总闸** `enabled`（默认开，只是允许插件工作）
2. **本会话开关**：`memory-palace/<文件夹>/config.json` 里 `enabled: true`，新会话缺省为关
3. **已命名**：记忆名为空时，即使开了开关也**不归档**（只建文件夹和配置）
4. **自动提示**：`injectNotice` / `enableSteer` 任一关掉 → 工具仍可用，但不会主动 steer（页签会写明）
5. **会话可见性**：`palace_archive` 被 capability-panel 关掉的会话整块静默

`GET /memory-palace-api` 额外返回 `gate: { active, steer, reasons[] }` 与 `events`（最近 20 条插件事件：归档/检索失败/门关闭等），页签直接展示，不用解压会话日志。

### 三个入口

- 聊天框 **`/palace on`**（`off` 关闭，`status` 查看）
- 页签「记忆回廊」里的滑块
- 让模型调用 `palace_config`

都只改**当前会话自己**那份配置——不碰 profile、不用重启。

## 会话页签（GUI）

会话头部会多一个「记忆回廊」页签，按**当前会话**显示与修改：

- 开关滑块（绿色=已开启、灰色=已关闭）
- 本会话文件夹（`memory-palace/<名字>`；未命名时显示会话ID并提示不会归档）
- 「记忆命名」输入框：保存即**改名文件夹**；只接受英文（大小写）/数字/空格/下划线/连字符、首尾不能空格；与同工作区其他会话重名会被拒绝
- 估算窗口 tokens（只读，自动探测）
- 触发阈值 %（滑块 + 输入框联动）
- 检查频率、最小归档批量、批量兜底阈值 %、无需归档比例 %
- 无需归档的近期文本量（只读，窗口 × 比例为 token 数）
- 单文件上限 MB
- 自动提示、收录深度思考、归档后压缩
- 最近 20 条归档列表

数据来自宿主路由 `GET/POST /memory-palace-api`（`kind: exact`；DSH 的 `/api` 是 RPC 通道，不能占用）。
非活跃会话通过会话日志头部的 `session` 事件取 `cwd`，不依赖 agent 是否在运行。

## 配置分层

1. **全局默认**：插件配置（profile 级，volatile）。
2. **工作区默认**：`<工作区>/memory-palace/config.json`，只作为新会话的初始值。
3. **本会话配置**：`memory-palace/<文件夹>/config.json`，页签与 `/palace` 实际改的是这份。
4. **按会话开关**：capability-panel 里关掉 `palace_archive`。

可被工作区覆盖：`enabled`、`triggerPressure`、`retainFraction`、`batchByteFraction`、`retainBytes`、
`maxFileBytes`、`checkEveryTurns`、`minBatchTurns`、`selfNameSlug`、`includeReasoning`、
`compactAfterArchive`、`injectNotice`。

## 配置项

| 项 | 默认 | 说明 |
|---|---|---|
| `enabled` | true | 全局总闸 |
| `triggerPressure` | 0.6 | 压力门：历史估算 ÷ 窗口 |
| `retainFraction` | 0.12 | 无需归档比例，占窗口比例（0.02–0.5，建议 < 16%） |
| `batchByteFraction` | 0.5 | 批量门兜底：可归档量达到无需归档量的该比例即放行 |
| `minBatchTurns` | 10 | 批量门：可归档轮数 |
| `checkEveryTurns` | 5 | 每几轮检查一次 |
| `maxFileBytes` | 5000000 | 单文件上限（十进制 MB，5,000,000 = 5.0 MB），超出按轮分卷 |
| `selfNameSlug` | assistant | 文件名前缀（与「记忆命名」无关，可分开设置） |
| `rootDirName` | memory-palace | 根目录名 |
| `includeReasoning` | true | 归档是否收录思考原文 |
| `compactAfterArchive` | false | 归档后是否触发压缩（默认关，见上） |
| `enableSteer` | true | 是否注入归档提醒 |
| `injectNotice` | true | 是否注入提示 |
| `enabledWorkspaces` | [] | 额外工作区白名单 |
| `enabledSessions` | [] | 额外会话白名单 |
| `contextWindowTokens` | 自动 | **只读**：从日志 `request/context` 探测，进程内缓存 |
| `searchTurnLimit` | 12 | `palace_search` 按轮聚合时默认返回多少轮（1–30 整数，服务端也校验） |
| `groupByTurn` | true | `palace_search` 是否默认按轮聚合（false 回原始命中行） |
| `recallStrength` | low | 回忆强度：`off` / `low` / `medium` / `high` / `forced`（见下节） |
| `recallBudgetRounds` | 1 | **建议预算**：最多几轮（1–5 整数，仅 high/forced 出现；插件不强制执行） |
| `recallBudgetKeywords` | 1 | **建议预算**：每轮最多几个关键词（1–5 整数；插件不强制执行） |
| `recursionMaxDepth/Width` | — | 旧键，等价于上面两个；读写时保持同步，仅为兼容保留 |
| `retainTurns` | — | **已废弃**：保留窗口只按比例算；写入时会被忽略并清理 |

会话配置里额外有 `name`（记忆命名，默认空）；会话开关是会话配置里的 `enabled`。

## 回忆强度（五档）

| 档位 | 行为 |
|---|---|
| `off` 关 | **只归档，不读记忆**；不注入任何回忆/摘要提示 |
| `low` 低 | 默认行为：优先读摘要，模型觉得必要时才读原文；不递归 |
| `medium` 中 | 走正常路线：年月 → 摘要 → 检索 → 原文；**不递归** |
| `high` 高 | 在中基础上**允许**模型主动递归检索，受 `recallBudgetRounds/Keywords` 预算约束（预算只是建议，插件不强制执行） |
| `forced` 强制 | 高 + **每条用户消息后都发一条检索指令**；没有归档时插件返回「归档记忆为空」，模型必须如实回答，不得编造；检索后简短说明回忆到了什么 |

补充规则：

- **启动时不注入**：重启后会话历史本身就在上下文里，“上一轮聊到哪”不需要摘要补；只在**压缩后**注入一次归档摘要。
- **压缩后只注入“去读哪份摘要”的指引（硬触发）**：监听 `session/event` 的 `compaction/end`；每次上下文压缩完成后，下轮请求组装前注入一条**简短指引**（不注入摘要全文），要求先调 `palace_summary(month=…)` 读最近年月的归档摘要，再继续。月份取自**实际存在摘要的最新月份**（不是日历当前月，跨年也不会指向空月份）；该月摘要不足 500 token 时，指引会额外给出上一个月的调用方式。优先级：**系统压缩摘要优先，它没覆盖到的内容用归档摘要补充**。这条指引是普通上下文消息，下次压缩自然消失——**不会每轮重复强调**。
- **事件失效是静默的**：`session/event` 属于首方内部用法，DSH 升级若改名不会报错、只会不收事件。插件会在“最近事件”里记 `compaction-detected` 与 `recall-after-compaction`，页签看不到这两条就说明链路没通。
- **预算是提示不是硬约束**：递归由模型执行，插件只把上限写进指令；超了要模型自己收敛。
- **强制档有成本**：每条消息多一次检索往返，长会话里 token 消耗明显。
- 所有档位都**不改变归档行为**（`off` 也照常归档原文）。

## 可靠性

- **原子写**：归档文件、`.state.json`、`config.json` 都是先写临时文件再 rename。
- **数据优先**：归档先写文件、再写摘要、最后写状态（摘要失败时 state 未更新，重试不会变成“已归档过”）；索引追加失败写进 `.pending-index.jsonl`，下次归档前自动补写；追加前会补换行，避免半行粘连。
- **边界语义**：保留边界 `boundary = 0` 表示“全部在保留区、暂不可归档”，不是“无限制”；且**永远不归档最后一轮**（可能正在生成）。
- **覆盖集以索引为准**：判断“已归档”时按 `index.jsonl` 里真实存在的行展开，不用 `archivedThroughTurn` 单点最大值，避免区间空洞被填平。
- **不重复**：覆盖去重（区间剔除）+ 同秒 `-2` 兜底。
- **索引容错**：读 `index.jsonl` 前会剥掉 UTF-8 BOM（旧文件可能带 BOM，按行 parse 会全失败）。
- **读取限制**：`palace_read` 只能读本命名空间（或 legacy 根）下的归档，`.state.json`/`config.json`/`index.jsonl`/`.namespaces.json` 直接拒绝。
- **可观测**：`.state.json` 记 `lastCheckTurn / lastCheckAt / lastPressure / lastArchiveRange`，`/palace status` 可见。
- **解码缓存**：按日志 `mtime + size` 缓存（最多 8 个会话）。
- **失败静默**：钩子内 catch，不阻塞对话。

## 依赖与失败策略

- 读 DSH 的 `.zstd` 日志需要 `fzstd`（多帧解压；Node zlib 只解第一帧）。
- 注册一个 systemPrompt 段（order 160）用于常驻检索指引，并注册一个压缩后注入的动态上下文；不监听 `agent/pre-step`，避免与其他插件抢接缝。

## 兼容性

- 需要 `ctx.tools.register`、`agent/turn-stopping`、`agent.steer`、`ctx.webServer.register`、`ctx.compaction`（可选）。
- 日志按 DSH v4（`session.v4.jsonl.zstd`）解析；格式变了会少条目而不是报错。

## 图片、文件与联网结果

- 图片/文件**不存字节**：只写一行占位符（`[图片 sha256:… 1024×768｜…]`），删了附件也不会崩。
- 联网搜索结果按工具返回文本归档，单块截断 40 万字符；用户/助手文本与思考各截断 20 万字符。

## 安装

**从 npm 安装（推荐）**

```
dsh plugin --profile <profile> add @dafantong01/dsh-memory-palace
```

**从 GitHub 安装（钉 commit，避免拉到未发布的中间状态）**

```
dsh plugin --profile <profile> add github:dafantong01/dsh-memory-palace#<commit>
```

**从本地 tgz 安装**

```
dsh plugin --profile <profile> add ./dafantong01-dsh-memory-palace-0.1.1.tgz
```

装好后在 profile 的 `dsh.profile.bundles` 里确认有 `@dafantong01/dsh-memory-palace`，然后重启 DSH。

> pnpm 对 `file:` 依赖会做 junction；如果插件树激活失败，检查 `node_modules/@dafantong01/dsh-memory-palace` 是否是真实目录。

## 兼容性与权限

- **DSH 版本**：`engines.dsh` 为 `>=0.2.1-rc.2 <0.3.0-0`，低于或高于此范围时市场会标记不兼容。
- **运行时权限**：插件在你的 DSH 进程内运行，权限等同你本人：
  - 读 `$DSH_HOME/sessions/` 下的会话日志（归档原文来源）
  - 读写当前工作区的 `memory-palace/`
  - 注册一个本地 HTTP 路由 `GET/POST /memory-palace-api`（仅本机回环）
- **不联网**：不请求任何外部服务，数据全部留在本机。
- **不存附件字节**：图片/文件只记占位符与哈希，原文件删除也不影响归档。

## 常见问题

- **页签显示「session not found」**：路由拿不到该会话的 `cwd`，通常是日志被移走。
- **`/palace status` 显示未开启**：工作区 `config.json` 缺 `enabled:true`。
- **一直不触发**：检查压力是否到阈值、可归档区间是否为空（近期内容都在保留区内）。

## 常驻提示词

插件常驻一段 systemPrompt（order 160，约 60 token）：

> 本工作区有 memory-palace 归档。需要更早的细节、旧决定、被压缩掉的历史，或用户问起“之前说过什么”时，
> 先用 `palace_search` 定位，再用 `palace_read` 按轮次取原文；不要凭印象编造过去的事。

工具描述也配合写成“先用它定位”。

## 按类别分段归档

模型逐轮判断类别，用一次调用提交多段：

```json
palace_archive({
  "segments": [
    { "category": "dsh-plugin-dev", "fromTurn": 112, "toTurn": 114 },
    { "category": "bug-report",     "fromTurn": 115, "toTurn": 115 },
    { "category": "dsh-plugin-dev", "fromTurn": 116, "toTurn": 116 }
  ]
})
```

- 同一类别拆多段 → 合并写进**一个文件**，轮次顺序不变
- 每个 turn 只能归一类，区间重叠会报错
- 文件头会写实际轮次：连续 `turn 113–114`，跳号 `turn 113, 114, 116, 128`（4 轮，不连续）
- 索引行对不连续区间额外记 `turns: [...]`
- 归档正文的轮次标题改用 `## TURN n · 时间`，避免正文里“引用了旧归档标题”时把 `palace_read` 的切片切错；老文件仍按 `## 第 n 轮 ·` 兼容解析
---

## English

A DSH plugin that archives older conversation turns, verbatim, into a workspace-local `memory-palace/` directory before context compaction — then lets the model search and read them back later.

**Why**: DSH compacts long contexts; after compaction the original wording is gone. This plugin keeps it on disk, searchable.

**Install**

```
dsh plugin --profile <profile> add @dafantong01/dsh-memory-palace
```

or pin a commit:

```
dsh plugin --profile <profile> add github:dafantong01/dsh-memory-palace#<commit>
```

Restart DSH afterwards. Enable per session via the Memory Palace tab or `/palace on`.

**What it does**

- Archives turns by category when context pressure crosses a threshold; never rewrites or truncates text.
- Stores `memory-palace/<session>/<YYYY-MM>/_summary.md` plus `<category>/<file>.md`.
- Tools: `palace_archive`, `palace_summary`, `palace_search`, `palace_read`, `palace_turns`, `palace_config`.
- Five recall levels (`off` / `low` / `medium` / `high` / `forced`); after compaction it asks the model to read the latest month's archive summary.
- Per-session configuration; data stays in the workspace.

**Requirements**

- DSH `>=0.2.1-rc.2 <0.3.0-0`.
- Runs inside your DSH process with your permissions: reads local session logs under `$DSH_HOME/sessions/`, reads/writes `memory-palace/` in the current workspace, and registers a loopback HTTP route `/memory-palace-api`.
- No network calls, no attached-file bytes stored (placeholders with hashes only).

**License**: MIT.