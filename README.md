# 记忆宫殿（dsh-memory-palace）

把会话原文按轮次分类归档到当前工作区的 `memory-palace/`，并在上下文压缩后按需读回。另提供热记忆、项目档案、杂事、关系图谱和记忆家族。

- 当前发布：`0.4.5`
- 版本变化见 `CHANGELOG.md`

## 功能总览

### 归档

- 上下文压力达到阈值时，模型调用 `palace_archive` 把较早轮次分类写入磁盘。
- 归档正文从会话日志逐字取出；模型只提交类别和轮次区间。
- 每月一份 `_summary.md`；同一类别一次归档写一个文件，超出单文件上限才分卷。
- 支持归档后压缩、手动归档、全量校验和最近归档列表。

### 热记忆

- 四个板块：`identity`（角色自我）、`user`（用户画像）、`rules`（规则铁律）、`memories`（关键记忆）。
- 层级：`mind-seal`、`important`、`normal`、`minor`、`keepsake`。
- `keepsake` 只存在于 `memories`，不进入自动注入调度。
- 注入由 `coreInjection` 控制，默认 `off`；可设 `on` 或 `test`。
- 支持项目热记忆：按 `projectLabel` 绑定项目档案，随项目启停。
- 支持记忆家族：母归属、子会话、脱离、让位、解散、根转移。

### 项目档案

- 会话级 Markdown 文档；支持新建、编辑、启停、归档、取消归档、软删除。
- 正文按 20K 字符分段读取。
- 支持局部编辑：追加、按二级标题替换、按唯一片段替换、插入小节、删除小节。
- 支持附件：文件、网页地址、图片；每篇最多 5 个。
- 支持提醒：时间、轮次、上下文压力、会话事件四类触发。
- 档案可授权家族只读；启停、共用、归档由拥有者管理。

### 杂事随记

- 短期记忆层；不自动注入，不占热记忆注入预算。
- 每条正文最多 60 字，1–5 个具体 tag；列表预览显示前 30 字，召回预览同样为 30 字。
- 显著度为 0–100：结构证据占 60%，情绪强度占 40%；达到 70 进入复核。
- 情绪分正、负两组独立计数，先按近义词库分组去重，再用饱和曲线折算强度。
- 自动捕获只读取用户/外部插件的文本消息；跳过测试、过程和建议句。
- 自动捕获正文带说话人：主用户写「主用户说：」，外部来源优先写网名，取不到写「外部用户说：」。
- 自动捕获会带关键句前后各一句上下文，总长度受 60 字上限约束。
- 自动捕获使用共享 tag 池：热记忆、项目档案、杂事里的已有 tag。
- 已有 tag 匹配前先归一化（去时态/助词/标点），再查近义词；命中就复用。
- 已有 tag 未命中时，从文本里的显式实体或分词结果提取一个具体词作为新 tag。
- tag 置信度决定处理方式：已有 tag、显式实体、地名可直接用；新事件词进入候选，不硬写。
- 候选先过滤问句、测试/meta、纯情绪和没有具体事件/实体/地点的内容。
- 事实更新采用追加替代：旧条保留并标记过时，新条通过 `supersedes` 关联；旧条停止续命，按原寿命过期。
- 列表支持分页、搜索、状态筛选和 tag 补全。

### 关系图谱

- 按会话维护 tag 关联，不跨会话合并。
- 每个 tag 最多 10 条关系；每个会话最多 500 个 tag 进入图谱。
- `memory_tag_graph` 返回 rank、effectiveRank、cohesion、lastSeen。
- 默认返回 5 个相关 tag + 5 条条目；`limit` 可放宽到 20。
- `candidates` 参数可批量检查候选 tag 是否已在共享池中，只返回精确/近义匹配，不写库。
- 读取杂事/档案时附带同 tag 的 related 条目；摘要检索零命中时给候选 tag。
- 图谱默认开启，可用 `tagGraphEnabled` 关闭。

## 安装

```powershell
dsh plugin --profile <profile> add @dafantong01/dsh-memory-palace
```

本地 tgz：

```powershell
dsh plugin --profile <profile> add <path-to-tgz>
```

GitHub 固定提交：

```powershell
dsh plugin --profile <profile> add github:dafantong01/dsh-memory-palace#<commit>
```

安装后重启 DSH，在会话页签打开「记忆宫殿」，给会话命名后才会归档。

## 工具

### 归档

| 工具 | 作用 |
|---|---|
| `palace_archive` | 按 `segments` 归档轮次；`summaries` 给每个类别写月度摘要；越界或已归档轮次会拒绝 |
| `palace_turns` | 列轮次清单：turn 号、发言者、开头片段；turn 是日志事件序号 |
| `palace_summary` | 读月度摘要；支持月份、类别、候选翻页、补写近况摘要 |
| `palace_search` | 检索归档正文；支持本会话/家族/全库、类别、按轮聚合或原始命中 |
| `palace_read` | 按轮次或路径读归档原文；支持分段读取 |
| `palace_config` | 查看/修改本会话配置；`get` 同时返回工作区默认和有效配置 |

### 热记忆

| 工具 | 作用 |
|---|---|
| `memory_core_read` | 读四个板块；可按板块、层级、项目过滤 |
| `memory_core_write` | 写热记忆；`rules` 的 mind-seal 只能走候选；`tagCheckOnly` 只做 tag 预检 |
| `memory_core_remove` | 软删除热记忆条目；`rules` 删除由用户在页签确认 |
| `memory_core_candidate` | 提交 `rules` 候选；用户确认后生效 |

### 项目档案

| 工具 | 作用 |
|---|---|
| `memory_doc_create` | 新建档案；`tagCheckOnly` 只做 tag 预检 |
| `memory_doc_update` | 更新正文/标题/标签/项目；支持局部编辑；`tagCheckOnly` 只做 tag 预检 |
| `memory_doc_remove` | 软删除档案 |
| `memory_doc_search` | 搜索档案标题、描述、标签和正文 |
| `memory_doc_read` | 按 20K 分段读取档案 |
| `memory_doc_outline` | 返回档案章节目录和字符偏移 |
| `memory_doc_reminder` | 管理档案提醒：列表、添加、删除、启停 |

### 杂事

| 工具 | 作用 |
|---|---|
| `memory_trivia_write` | 写入或替代一条杂事；支持显式 `entities`、`confirmTrivia` |
| `memory_trivia_read` | 按 id 读杂事，记录访问 |
| `memory_trivia_search` | 按文字或 tag 搜索杂事 |
| `memory_trivia_remove` | 硬删除一条杂事 |

### 图谱与家族

| 工具 | 作用 |
|---|---|
| `memory_tag_graph` | 按 tag 或关键词查关联条目；`candidates` 批量检查候选 tag |
| `memory_family_decide` | 家族重建时记录用户决定 |

## 归档工作方式

1. **触发检查**：每 `checkEveryTurns` 轮检查一次，同时满足压力门和批量门才提醒。
2. **压力门**：上下文占用达到 `triggerPressure`（默认 60%）。
3. **批量门**：可归档轮数达到 `minBatchTurns`，或可归档文本量达到无需归档量的 `batchByteFraction`。
4. **分类归档**：模型用 `segments` 提交逐轮类别；同一类别可拆多段，最终合并成一个文件。
5. **保留区**：窗口 × `retainFraction`（默认 12%）内的近期轮次不归档。
6. **写入**：从会话日志逐字取原文；超 `maxFileBytes` 按轮分卷。
7. **去重**：已归档区间记录在 `.state.json`；新请求会剔除已覆盖轮次。
8. **归档后压缩**：`compactAfterArchive` 默认关；开启后调用 DSH 压缩服务。

## 目录

```text
<工作区>/
  memory-palace/
    .namespaces.json
    config.json
    <会话文件夹>/
      config.json
      .state.json
      index.jsonl
      _core/
      _docs/
      trivia/
      _tag-graph/
      <YYYY-MM>/
        _summary.md
        <category>/
          <前缀>-<category>-<YYYYMMDD-HHmmss>.md
```

- 月份按该批首轮对话时间归属。
- 文件夹名支持英文、数字、空格、下划线、连字符，最多 32 字；首尾不能空格。
- 未命名会话不产生归档文件。
- 归档索引使用相对路径；改名文件夹不需要改索引。
- 类别目录使用英文小写。

## 配置分层

1. **profile 默认**：插件 Config。
2. **工作区默认**：`<工作区>/memory-palace/config.json`。
3. **本会话配置**：`memory-palace/<会话文件夹>/config.json`。
4. **工具/页签**：`palace_config` 和「记忆宫殿」页签修改本会话配置。

`enabledWorkspaces` 非空时只对匹配的工作区生效；`enabledSessions` 非空时只对列出的会话生效。

## 主要配置

### 归档

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | true | 全局总闸 |
| `triggerPressure` | 0.6 | 压力阈值 |
| `retainFraction` | 0.12 | 近期保留比例 |
| `retainBytes` | 100000 | `retainFraction<=0` 时的字节保留量 |
| `batchByteFraction` | 0.5 | 批量门兜底比例 |
| `minBatchTurns` | 10 | 最少归档轮数 |
| `checkEveryTurns` | 5 | 检查频率 |
| `maxFileBytes` | 5000000 | 单文件上限 |
| `selfNameSlug` | assistant | 归档文件名前缀 |
| `rootDirName` | memory-palace | 根目录名 |
| `includeReasoning` | true | 归档包含思考原文 |
| `compactAfterArchive` | false | 归档后压缩 |
| `archiveTailTurns` | 2 | 归档后压缩时保留的尾部轮数 |
| `enableSteer` | true | 注入归档提醒 |
| `injectNotice` | true | 注入提示 |
| `cacheVerifyEvery` | 20 | 缓存全量校准频率 |
| `enabledWorkspaces` | [] | 限定工作区 |
| `enabledSessions` | [] | 限定会话 |
| `contextWindowTokens` | 1048576 | 估算窗口；配置工具不允许手改 |

### 热记忆

| 键 | 默认 | 说明 |
|---|---|---|
| `coreInjection` | off | `off` / `on` / `test` |
| `coreInjectionBudget` | 10000 | 每轮注入预算 |
| `coreTierImportantTurns` | 5 | important 注入间隔轮数 |
| `coreTierImportantTokens` | 10000 | important 注入间隔 token |
| `coreTierNormalTurns` | 12 | normal 注入间隔轮数 |
| `coreTierNormalTokens` | 30000 | normal 注入间隔 token |

### 杂事

| 键 | 默认 | 说明 |
|---|---|---|
| `triviaEnabled` | true | 杂事开关 |
| `triviaMaxPerTurn` | 2 | 每回合新增上限；0 不限制 |
| `triviaMaxPerDay` | 20 | 每天新增上限；0 不限制 |
| `triviaInterest` | 5 | 写入兴趣度 1–10 |
| `triviaMentionHint` | false | 提到已知 tag 时提示 |
| `triviaAutoRecall` | true | 按消息自动召回 |
| `triviaAutoCapture` | true | 自动捕获用户/外部文本 |
| `triviaCandidateReview` | false | 边界内容只给候选 |
| `triviaEntityProvider` | off | `off` / `remote` |
| `triviaEntityEndpoint` | 空 | 远程实体 endpoint |
| `triviaEntityModel` | 空 | 远程实体模型 |
| `triviaEntityKey` | 空 | 远程实体 key；只写不读 |
| `triviaAutoReview` | true | 长寿条自动续命 |
| `tagGraphEnabled` | true | 关系图谱开关 |

### 摘要与回忆

| 键 | 默认 | 说明 |
|---|---|---|
| `searchTurnLimit` | 12 | `palace_search` 按轮聚合的默认轮数 |
| `groupByTurn` | true | 默认按轮聚合 |
| `summaryFallback` | own-then-family | 摘要零命中回退 |
| `summaryCandidateLimitEnabled` | true | 候选摘要硬上限 |
| `summaryCandidateLimit` | 12 | 旧版候选上限 |
| `summaryCandidateExtra` | 6 | 候选月数增量 |
| `summaryCandidatePerMonth` | 3 | 每月候选段数 |
| `recallStrength` | low | `off` / `low` / `medium` / `high` / `forced` |
| `recursionMaxDepth` | 1 | 递归轮数 |
| `recursionMaxWidth` | 1 | 每轮关键词数 |
| `recallBudgetRounds` | 1 | 建议递归轮数 |
| `recallBudgetKeywords` | 1 | 建议每轮关键词数 |

## 回忆强度

| 档位 | 行为 |
|---|---|
| `off` | 只归档，不做回忆注入 |
| `low` | 归档；模型可自行调用记忆工具 |
| `medium` | 压缩后注入一次摘要读取指引 |
| `high` | 允许模型递归检索，受预算建议约束 |
| `forced` | 每条用户消息后注入检索指令 |

预算值是给模型的建议，插件不强制执行递归。

## 数据与隐私

- 归档、热记忆、项目档案、杂事、图谱和家族数据保存在当前工作区。
- 插件默认不访问网络。
- 启用 `triviaEntityProvider=remote` 后，自动捕获的文本会发送到配置的远程实体 endpoint；key 只放在请求头，不写入日志。
- 图片和文件不存字节；归档写占位符与哈希，项目档案附件保存路径或网页地址。
- 自动捕获读取用户/外部插件文本；模型思考、插件注入、宿主上下文、图片内容和网页抓取不进入自动捕获。
- 会话日志读取范围是 `$DSH_HOME/sessions/`；本地路由 `/memory-palace-api` 仅监听回环地址。

## 已知限制

- 检索使用关键词、tag、时间与图谱关系，不做 embedding 检索。
- 归档、项目档案和热记忆的写锁以单 DSH 实例为前提；多实例不做强一致保证。
- 项目档案全文按需读取，不自动注入。
- 单轮或单块超长内容按上限截断，读取时用分段参数继续。
- 远程实体 provider 依赖外部网络与 endpoint；失败时回退本地结构实体。
- 自动捕获偏保守：生活类事实优先进入候选或由模型主动写入，不保证全部自动落盘。

## 兼容性

- `engines.dsh`：`>=0.2.1-rc.2 <0.3.0-0`
- 会话日志格式：DSH v4 JSONL（zstd）。
- 依赖：`fzstd`、`@deepseek-ai/schemastery`。
- 需要宿主提供：工具注册、turn 事件、steer、webServer 路由；压缩服务可选。

## English

Memory Palace is a local long-term memory plugin for DSH sessions.

- Archives older turns by category under the current workspace's `memory-palace/` directory.
- Provides four hot-memory boards, project documents and reminders, short-lived trivia, a tag graph, and memory families.
- Reads archives back after compaction through `palace_*` tools.
- Trivia entries are capped at 60 characters, show 30-character previews, and use a 0–100 score with review at 70.
- Automatic capture reuses the shared tag pool from hot memory, project documents, and trivia; tag checks are read-only.
- Stores data locally. The optional remote entity provider sends captured text to the configured endpoint.

**Install**

```powershell
dsh plugin --profile <profile> add @dafantong01/dsh-memory-palace
```

**Tools**

- Archive: `palace_archive`, `palace_turns`, `palace_summary`, `palace_search`, `palace_read`, `palace_config`
- Hot memory: `memory_core_read`, `memory_core_write`, `memory_core_remove`, `memory_core_candidate`
- Project documents: `memory_doc_create`, `memory_doc_update`, `memory_doc_remove`, `memory_doc_search`, `memory_doc_read`, `memory_doc_outline`, `memory_doc_reminder`
- Trivia: `memory_trivia_write`, `memory_trivia_read`, `memory_trivia_search`, `memory_trivia_remove`
- Graph and family: `memory_tag_graph`, `memory_family_decide`

**Requirements**

- DSH `>=0.2.1-rc.2 <0.3.0-0`.
- Reads local session logs under `$DSH_HOME/sessions/`, reads/writes `memory-palace/` in the current workspace, and registers a loopback HTTP route.

**License**: MIT.
