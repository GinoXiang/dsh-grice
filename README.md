# dsh-grice — 格赖斯模式（高效沟通插件）

> A composer switch for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): turn it on and the assistant in that Session must follow Grice's cooperative principle — quantity, quality, relation, manner — for maximally efficient replies.

在 DSH 输入框（对话框）里加一个 **「格赖斯」开关**。打开后，当前会话的助手会严格遵守格赖斯（H. P. Grice）合作原则的四条语用准则，用最高信息效率回答；关闭即恢复默认风格。

插件开关位置：输入框左下角、`工作区内修改` 权限胶囊右侧（`conversation.input.left` 槽位）。

![输入框里的格赖斯开关](docs/composer.png)

## 它约束什么

开启「格赖斯模式」后，Host 会为**当前会话**的系统提示词追加一段 `grice:policy`：

| 准则 | 落地规则 |
|---|---|
| 数量（Quantity） | 只给恰好充分的信息；不复述、不堆砌背景、不主动展开没问的内容 |
| 质量（Quality） | 只陈述有依据的内容；不确定就标注不确定，不编造事实/数据/路径/引用 |
| 关系（Relation） | 每句话都服务当前问题或步骤；不跑题、不加无关建议 |
| 方式（Manner） | 先结论后依据；简洁、清楚、有序；代码/命令/路径/数字精确 |

行为要点：

- **按会话独立**：开关状态按 Session 保存，A 会话打开不影响 B 会话。
- **下一步即生效**：系统提示词段落是动态 provider，切换后同一轮的下一个 step 就会带上新提示，不需要新会话。
- **唯一写入方是 Host**：浏览器半边只读取/提交切换，状态持久化在 `<DSH_HOME>/grice/state.json`，刷新页面、重启 DSH 都不丢。
- **可观测**：插件激活时写 `activatedAt`/`activatedPid`；浏览器里出现开关时写 `lastClientSeen`，便于排查「装上了但没起来」。

## 使用

1. 点输入框里的「格赖斯」按钮：激活态为品牌色高亮；悬停可看准则说明。
2. 或在会话里输入斜杠命令：
   - `/grice` 或 `/grice status` — 查看当前状态
   - `/grice on` — 开启
   - `/grice off` — 关闭

## 安装

要求：DSH 0.2.x（在 `0.2.1-rc.5` 桌面版实测），无需构建步骤（纯 JS，无 `prepare` 脚本）。

### 方式一：从 GitHub 安装（推荐）

```powershell
dsh plugin --profile <你的 profile> add github:GinoXiang/dsh-grice
```

`dsh plugin` 会自动把 `dsh-grice` 加进该 profile 的 `dsh.profile.bundles`。
开启 HMR 的 DSH 无需重启、约 1–3 秒内生效；未开启 HMR 时重启 DSH 并刷新页面。

### 方式二：本地开发安装

```powershell
git clone https://github.com/GinoXiang/dsh-grice.git
dsh plugin --profile <你的 profile> add link:<仓库绝对路径>
```

Windows 且路径含空格时，pnpm 的 `link:` spec 容易出问题，可先用目录联接换成无空格路径：

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\plugins\dsh-grice" -Target "<仓库绝对路径>"
dsh plugin --profile <你的 profile> add "link:C:/Users/<you>/plugins/dsh-grice"
```

### 卸载

```powershell
dsh plugin --profile <你的 profile> remove dsh-grice
```

并把 profile `package.json` 的 `dsh.profile.bundles` 中的 `dsh-grice` 去掉。

### 维护者发版注意

市场条目使用 `releases/latest/download/dsh-grice.tgz`（版本号无关的资产名）。每次发新 release 时，把
`npm pack` 生成的 tarball 重命名为 `dsh-grice.tgz` 并附加到该 release，否则这个链接会在下一次发版后 404。

## 实现结构

```
dsh-grice/
├── package.json              # dsh.bundle.patch + dsh.client（platform: web）
├── cordis.patch.yml          # insert: id=dsh-grice, name=dsh-grice
├── index.js                  # Host 半边：状态存储 + 系统提示词 section + HTTP 路由 + /grice 命令
├── client.js                 # 浏览器半边：conversation.input.left 槽位的开关按钮
├── test/host.test.mjs        # Host 半边行为测试（node:test，无依赖）
├── test/client.test.mjs      # 浏览器半边注册测试（假 window.__ModuleLoader__ + 假 ctx）
└── docs/composer.png         # 输入框里的开关实拍
```

Host 半边（`index.js`）：

- `createStore(ctx)` — `<DSH_HOME>/grice/state.json` 单一事实来源，mtime 缓存 + 原子写。
- `ctx.inject(['systemPrompt'], …)` — 注册 `grice:policy`（order 650，紧随团队策略之后），text provider 按 `assembly.agent.session.id` 查开关，关闭时返回空串。
- `ctx.inject(['webServer'], …)` — `POST /dsh-grice/state|toggle|set`，三道本地校验：回环 socket、回环 Host、同源 Origin。
- `ctx.inject(['commands'], …)` — `/grice [on|off]`。

浏览器半边（`client.js`）：

- 经典 client bundle 协议：`window.__ModuleLoader__.load({ id, factory })`，`factory(require)` 返回 `{ name, inject, apply }`。
- `apply(ctx)` 注入 `<style>`、向 `conversation.input.left` 注册列表项（`id: dsh-grice`, `order: 120`）。
- 组件从 session 作用域标准 props 取 `sessionId`，轮询 `/state`，点击做乐观切换并以 Host 返回值为准；文案中英自适应（DSH locale 或浏览器语言）。

## 测试

```powershell
# 无依赖，直接跑（node:test 打印 TAP）
node test/host.test.mjs
node test/client.test.mjs

# 或
npm test
```

`node --test` 在部分 Windows 沙箱里会因测试 runner 派生子进程而报 EPERM，所以本仓库 README 使用直接运行的写法。

覆盖：状态持久化、`grice:policy` 文本随开关变化、HTTP 三道校验（回环 socket / 回环 Host / 同源 Origin）、
`/grice` 命令、浏览器 mount beacon、插件 dispose 清理、浏览器半边槽位注册。

运行中的实例可看 `<DSH_HOME>/grice/state.json`：

```json
{
  "version": 1,
  "sessions": { "session-...": true },
  "activatedAt": "2026-11-01T01:30:26.783Z",
  "activatedPid": 13608,
  "lastClientSeen": { "at": "2026-11-01T01:30:29.438Z", "sessionId": "session-...", "version": "0.1.0" }
}
```

- 有 `activatedAt` ⇒ Host 半边已激活；
- 有 `lastClientSeen` ⇒ 浏览器里开关已渲染并打通了 HTTP；
- `sessions` 里出现某 id ⇒ 该会话已开启格赖斯模式。

另外在隔离的测试 Host 上做过真实装配验证：用真实 `Agent` 调 `ctx.systemPrompt.assemble()`，
开启的会话系统提示词里 `grice:policy` 有完整准则文本，未开启的会话该段为空。

## 设计取舍

- **为什么不是全局开关**：对话是会话级的，模式也应会话级；状态按 Session 键存，避免一个开关污染所有会话。
- **为什么用系统提示词 section 而不是发一条用户消息**：section 不占对话轮次、不污染历史；且在每一步 assembly 时重新求值，切换立即生效。
- **为什么 Host 持有状态**：浏览器可能刷新、可能多窗口；让 Host 做唯一写入方，避免两边状态漂移。
- **不用 localStorage 持久化**：刷新或换窗口都跟 Host 保持一致；也避免多标签页各记各的。

## 已知限制

- 开关状态在 `<DSH_HOME>/grice/state.json`；删除该文件即全部关闭。会话删除后其条目不会自动清理（上限 200 条，超出按插入顺序淘汰）。
- `/dsh-grice/*` 路由与 DSH 自带的本地插件路由一样只监听回环地址，没有额外的鉴权；不要在启用 `--host` 暴露到网络的部署里把它当成安全边界。
- 本地 `link:` 安装时移动仓库路径会使 profile 里的依赖失效，需要重新 `add link:`。

## License

[MIT](LICENSE)
