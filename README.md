# dsh-grice — 格赖斯模式（沟通开关 + 双下拉 + 预设管理）

> A composer switch plus tone and output-form dropdowns for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): each session's system prompt follows the selected communication tone and desired output form, with a settings page for the preset library.

DSH 输入框里有三个独立控件，作用域都是**当前会话**：

![输入框里的三个控件](docs/composer.png)

| 控件 | 作用 |
|---|---|
| **格赖斯**（单击开关） | 总开关：关闭时不注入任何提示词。 |
| **沟通基调**（下拉） | 默认 `格赖斯·高效`；选其他基调会**替换**内置格赖斯准则；选中后自动开启总开关。 |
| **产出形态**（下拉） | `无额外要求`、`代码实现`、`数据分析`、`文档写作`、`翻译`、`总结提炼`…；选中后自动开启总开关，与基调互不影响。 |

## 预设

- 内置 **7 个沟通/思考基调**：格赖斯·高效、教练引导、严谨审阅、创意发散、极简结论、苏格拉底追问、均衡自然。
- 内置 **7 个产出形态**：代码实现、数据分析、文档写作、翻译、总结提炼、教学解释、方案对比。
- 每个下拉显示置顶的前 5 条 + **「更多…」**（展开全部）。
- **设置 → 格赖斯**：两个 tab 管理预设 —— 新增、编辑、删除、置顶（前 5 条）、恢复默认；单条提示词上限 2000 字符。
- 内置预设也可改可删；「恢复默认」会把该分类还原成出厂预设。

## 提示词注入

三个独立 section，按顺序追加到系统提示词：

```
deployment:persona-prefix
grice:policy   (order 650)  ← 总开关开、基调为默认时注入内置格赖斯准则
grice:tone     (order 650)  ← 选了具体基调时注入该基调提示词（替换 policy）
grice:output   (order 660)  ← 选了产出形态时注入该提示词
```

- 总开关关闭 = 三个 section 全部为空，插件等于不存在。
- 每个 step 的 assembly 都会重新求值，**切换后同一轮的下一个 step 就生效**，不需要新会话。
- 状态按 Session 存：`<DSH_HOME>/grice/state.json`；预设库是全局的：`<DSH_HOME>/grice/presets.json`。
- 删除正在使用的预设 → 该会话自动回退（基调回内置格赖斯、产出回无），不会报错。

## 使用

- 单击「格赖斯」开关当前会话的注入；「沟通基调」「产出形态」下拉选择即生效并自动打开总开关。
- 斜杠命令：
  - `/grice` 或 `/grice status` — 查看当前开关、基调、产出
  - `/grice on` / `/grice off`
  - `/grice tone <id>`、`/grice output <id>`；`/grice tone none`、`/grice output none` 恢复默认
- 内置 id：基调 `grice` `coach` `audit` `creative` `minimal` `socratic` `balanced`；产出 `code` `analysis` `doc` `translate` `summary` `tutorial` `options`。

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
├── index.js                  # Host：会话状态 + 预设库 + 三个提示词 section + HTTP 路由 + /grice 命令
├── client.js                 # 浏览器：开关、两个下拉、设置页（settings.section）
├── test/host.test.mjs        # Host 行为测试（node:test，无依赖）
├── test/client.test.mjs      # 浏览器注册测试（假 window.__ModuleLoader__ + 假 ctx）
├── docs/composer.png         # 输入框三个控件实拍
├── docs/icon-180.png         # 市场卡片图标
└── README.md
```

Host 半边（`index.js`）：

- `createStore(ctx)` — `<DSH_HOME>/grice/state.json`，会话 v2 结构 `{ grice, tone, output }`，v1 布尔值自动迁移；mtime 缓存 + 原子写。
- `createPresetStore(ctx)` — `<DSH_HOME>/grice/presets.json`，内置预设播种、正常化、置顶上限 5、恢复默认。
- `registerPrompt` — 三个 section 的动态 provider，按 `assembly.agent.session.id` 查当前会话选择。
- `registerRoutes` — `state` / `toggle` / `set` / `select` / `presets` / `presets/save` / `presets/delete` / `presets/reset`，回环 socket + 回环 Host + 同源 Origin 三道校验。
- `registerCommand` — `/grice [on|off|tone <id>|output <id>]`。

浏览器半边（`client.js`）：

- 经典 client bundle 协议：`window.__ModuleLoader__.load({ id, factory })`，返回 `{ name, inject, apply }`。
- 两个共享 store：按会话的开关/选择状态（轮询 + 订阅）、全局预设库；三个 composer 控件与设置页共用。
- `conversation.input.left` 注册三个列表项（`dsh-grice` 120 / `dsh-grice-tone` 130 / `dsh-grice-output` 140）；`settings.section` 注册「格赖斯」设置页。

## 测试

```powershell
# 无依赖，直接跑（node:test 打印 TAP）
node test/host.test.mjs
node test/client.test.mjs

# 或
npm test
```

`node --test` 在部分 Windows 沙箱里会因测试 runner 派生子进程而报 EPERM，所以本仓库 README 使用直接运行的写法。

覆盖：三 section 注入与互斥、总开关、按会话隔离、预设库 CRUD / 置顶上限 / 恢复默认、删除回退、v1→v2 状态迁移、HTTP 三道校验、`/grice` 命令、浏览器四个注册点与卸载清理。

运行中的实例可看 `<DSH_HOME>/grice/state.json` 与 `presets.json`。

## 设计取舍

- **开关与下拉分开**：开关是总闸，双下拉是选择；下拉选中自动打开总闸（用户指定行为），关闭总闸立即停用全部注入。
- **基调替换而非叠加**：选了「教练引导」就不该再同时套着「格赖斯极简」，所以 tone 与内置 policy 互斥；产出形态是另一个维度，可叠加。
- **预设库全局、选择按会话**：同一套预设在不同对话里复用，但每个对话的当前选择各自独立。
- **Host 单写方**：浏览器只读/提交，避免多窗口状态漂移；`presets.json` 损坏时自动重新播种。

## 已知限制

- 状态/预设文件都在 `<DSH_HOME>/grice/`；删除 `presets.json` 会重新播种出厂预设。
- `/dsh-grice/*` 路由与 DSH 自带本地插件一样只监听回环地址，没有额外鉴权；不要在把 DSH 暴露到网络的部署里把它当安全边界。
- 本地 `link:` 安装时移动仓库路径会使 profile 依赖失效，需要重新 `add link:`。
- 市场条目最初按 0.1.0 的「单开关」描述提交；升级到 0.2.0 后需要同步更新条目描述与 release 资产（进行中）。

## License

[MIT](LICENSE)
