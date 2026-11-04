// dsh-output-style - host half.
//
// Two per-Session switches (tone and output form) plus two per-Session preset
// slots. Three independent prompt contributions, each gated by its own switch:
//
//   * `style:policy`  - the built-in Grice guidance, used while the tone is
//     the default (`grice`) or unset;
//   * `style:tone`    - a selected tone preset, which replaces the built-in
//     guidance (order 650);
//   * `style:output`  - a selected output-form preset (order 660), gated by its
//     own switch so the tone switch and the output switch are independent.
//
// Preset definitions live as Markdown files under
// `<DSH_HOME>/output-style/presets/{tone,output}/*.md` (one global library,
// editable by any editor and from the settings page, hot-reloaded on change).
// The per-Session selection lives in the official storage domain
// `output_style_pair` and reaches the browser through the `outputStylePair`
// session projection; the browser never owns state, the Host is the single
// writer and writes only through the `/style` command lifecycle.
//
// The plugin imports nothing from the DSH SDK; every service is resolved
// through the cordis context at call time.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
/** Analyzer module, loaded per plugin reload (see loadAnalyzer). */
let analyzeEngine

export const name = 'dsh-output-style'

/** Plugin version, also recorded by the browser half's mount beacon. */
const VERSION = '0.5.0'
/** HTTP route prefix owned by this plugin (the settings CRUD surface only). */
const ROUTE_PREFIX = '/dsh-output-style'
/** Directory under the DSH home that holds this plugin's durable files. */
const STATE_DIR = 'output-style'
/** User preset directory: one markdown file per preset, watched for changes. */
const PRESETS_DIR = 'presets'
/** Coalescing delay for preset-file change events. */
const WATCH_DEBOUNCE_MS = 250
/** Pre-rename directory; migrated once, then left untouched. */
const LEGACY_STATE_DIR = 'grice'
/** Prompt sections owned by this plugin. */
const SECTION_POLICY = 'style:policy'
const SECTION_TONE = 'style:tone'
const SECTION_OUTPUT = 'style:output'
const ORDER_POLICY = 650
const ORDER_TONE = 650
const ORDER_OUTPUT = 660
/** Storage domain owned by this plugin: one selection record per Session. */
const DOMAIN_NAME = 'output_style_pair'
const DOMAIN_VERSION = 1
/** Session-projection key carrying the live view the composer reads. */
const PROJECTION_KEY = 'outputStylePair'
const PROJECTION_STATE_VERSION = 1
/** Legacy JSON state format, read once during migration into the domain. */
const STATE_VERSION = 3
const PRESETS_VERSION = 2
/** Bounds. */
const MAX_TRACKED_SESSIONS = 200
const MAX_SESSION_ID_LENGTH = 200
const MAX_PRESET_NAME_LENGTH = 60
const MAX_PRESET_PROMPT_LENGTH = 2000
const MAX_PRESETS_PER_KIND = 40
const MAX_PINNED_PER_KIND = 5
/** Preset kinds, in the order the settings page lists them. */
const KINDS = ['tone', 'output']
/** Library key for each kind. */
const PRESET_KEY = { tone: 'tones', output: 'outputs' }

/**
 * The built-in Grice guidance: the built-in `grice` tone preset's prompt, and
 * the fallback while no other tone is selected.
 */
export const POLICY_TEXT = [
  '用户已开启「格赖斯」沟通基调：请严格遵守格赖斯（H. P. Grice）合作原则及其四条准则，用最高的信息效率完成沟通，直到用户关闭该基调。',
  '- 数量准则（Quantity）：只给恰好充分的信息。不堆砌背景、不复述用户已经说过的内容、不重复自己刚说过的结论；用户没问的不主动展开。',
  '- 质量准则（Quality）：只陈述有依据的内容。不确定时明确说明不确定及原因；绝不编造事实、数据、代码行为、文件路径或引用。',
  '- 关系准则（Relation）：每一句都直接服务于当前问题或当前步骤；不跑题，不插入无关建议、自我评价或能力说明。',
  '- 方式准则（Manner）：先给结论或结果，再给必要依据；表达简洁、清楚、有序，避免歧义、行话堆砌和空话。',
  '输出约定：除非用户明确要求，不写开场寒暄、过程旁白、免责声明和总结性复述；需要展开时也只展开必要部分；代码、命令、路径、数字保持精确。',
].join('\n')

/** The built-in preset library; a missing or unreadable file seeds this set. */
const DEFAULT_PRESETS = {
  version: PRESETS_VERSION,
  tones: [
    {
      id: 'grice',
      name: '格赖斯·高效',
      prompt: POLICY_TEXT,
      pinned: true,
      builtin: true,
    },
    {
      id: 'coach',
      name: '教练引导',
      prompt: [
        '沟通基调：教练式引导。',
        '- 不给现成答案，先用一个问题确认目标与现状，再给可选择的方向（每个方向说明代价与适用场景）。',
        '- 把决定权留给用户；用户明确要答案时再给明确建议。',
        '- 每次只推进一小步，结尾给出一个具体的下一步。',
      ].join('\n'),
      pinned: true,
      builtin: true,
    },
    {
      id: 'audit',
      name: '严谨审阅',
      prompt: [
        '沟通基调：严谨审阅。',
        '- 先列假设与前提，再给结论；主动指出风险、边界条件、失败模式与反例。',
        '- 证据不足时明确说不知道或需要什么证据，不补全想象。',
        '- 对用户的方案先复述理解，再逐条给出可验证的问题与修改建议。',
      ].join('\n'),
      pinned: true,
      builtin: true,
    },
    {
      id: 'creative',
      name: '创意发散',
      prompt: [
        '沟通基调：创意发散。',
        '- 先给至少 3 个明显不同的方向，再收敛；不要第一句话就否定或选定一个方案。',
        '- 允许类比与跳跃，但每个想法都标注它成立的前提与代价。',
        '- 用户要求收敛时，再给推荐方案与取舍理由。',
      ].join('\n'),
      pinned: true,
      builtin: true,
    },
    {
      id: 'minimal',
      name: '极简结论',
      prompt: [
        '沟通基调：极简结论。',
        '- 只给结论、代码或命令；不解释过程，不写铺垫与总结。',
        '- 用户追问原因时再补充依据，且一次只补一层。',
        '- 除答案本身外不输出任何说明性文字。',
      ].join('\n'),
      pinned: true,
      builtin: true,
    },
    {
      id: 'socratic',
      name: '苏格拉底追问',
      prompt: [
        '沟通基调：苏格拉底式追问。',
        '- 先用一两个问题澄清概念与目标，确认理解后再回答。',
        '- 用反问检验用户论证中的隐含前提，不直接下结论。',
      ].join('\n'),
      pinned: false,
      builtin: true,
    },
    {
      id: 'balanced',
      name: '均衡自然',
      prompt: '',
      pinned: false,
      builtin: true,
    },
  ],
  outputs: [
    {
      id: 'code',
      name: '代码实现',
      prompt: [
        '产出形态：代码实现。',
        '- 直接给可运行的完整代码，标明文件路径；需要时附一条可复制的运行命令。',
        '- 不用伪代码，不省略关键实现；改动以 diff 或完整片段交付。',
        '- 只解释必要的接口、依赖与坑，不写长篇教程。',
      ].join('\n'),
      pinned: true,
      builtin: true,
    },
    {
      id: 'analysis',
      name: '数据分析',
      prompt: [
        '产出形态：数据分析。',
        '- 先写指标口径与数据来源，再给结果，最后给局限。',
        '- 结论用数字与区间表达，区分相关与因果。',
        '- 表格优先于长段落；每个结论都能追溯到具体数据。',
      ].join('\n'),
      pinned: true,
      builtin: true,
    },
    {
      id: 'doc',
      name: '文档写作',
      prompt: [
        '产出形态：文档写作。',
        '- 用标题层级组织，段落完整、可直接粘贴使用。',
        '- 面向的读者与用途放在开头；术语首次出现时解释。',
        '- 不写对话式口吻，不写「如上所述」这类空话。',
      ].join('\n'),
      pinned: true,
      builtin: true,
    },
    {
      id: 'translate',
      name: '翻译',
      prompt: [
        '产出形态：翻译。',
        '- 只输出译文，保持原文的结构与格式；不解释、不加注、不意译扩写。',
        '- 术语前后一致；原文有歧义时在末尾用一行列出待确认点。',
      ].join('\n'),
      pinned: true,
      builtin: true,
    },
    {
      id: 'summary',
      name: '总结提炼',
      prompt: [
        '产出形态：总结提炼。',
        '- 只保留关键结论、决定、待办与未决问题，每条一行。',
        '- 不按原文顺序复述，不做逐段摘要；总长度不超过原文的三分之一。',
      ].join('\n'),
      pinned: true,
      builtin: true,
    },
    {
      id: 'tutorial',
      name: '教学解释',
      prompt: [
        '产出形态：教学解释。',
        '- 由浅入深分步骤讲，先用一句话给全貌，再逐层展开。',
        '- 每个抽象概念配一个具体例子；每节末尾用一句话检验是否讲清。',
      ].join('\n'),
      pinned: false,
      builtin: true,
    },
    {
      id: 'options',
      name: '方案对比',
      prompt: [
        '产出形态：方案对比。',
        '- 先列方案，再用一张表对比关键维度（成本、风险、可维护性、适用场景）。',
        '- 最后给明确推荐与「什么情况下不该选它」。',
      ].join('\n'),
      pinned: false,
      builtin: true,
    },
  ],
}

/** The DSH home directory, honouring the same override the rest of DSH uses. */
function dshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim() !== '') return configured.trim()
  return path.join(os.homedir(), '.dsh')
}

/** Absolute path of the durable switch state. */
export function stateFile() {
  return path.join(dshHome(), STATE_DIR, 'state.json')
}

/** Absolute path of the durable preset library. */
export function presetsFile() {
  return path.join(dshHome(), STATE_DIR, 'presets.json')
}

/** Move the pre-rename directory into place once, so existing users keep state. */
function migrateLegacyDir(ctx) {
  const current = path.join(dshHome(), STATE_DIR)
  const legacy = path.join(dshHome(), LEGACY_STATE_DIR)
  for (const name of ['state.json', 'presets.json']) {
    const target = path.join(current, name)
    const source = path.join(legacy, name)
    try {
      if (fs.existsSync(target) || !fs.existsSync(source)) continue
      fs.mkdirSync(current, { recursive: true })
      fs.copyFileSync(source, target)
      ctx?.logger?.info?.('dsh-output-style: migrated %s from the pre-rename location', name)
    } catch (error) {
      ctx?.logger?.warn?.('dsh-output-style: could not migrate %s: %s', name, String((error && error.message) || error))
    }
  }
}

/** A request the browser half made, rejected with its own status and code. */
class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

// --- per-session state (official storage domain) -----------------------------

const EMPTY_SESSION = Object.freeze({ toneEnabled: false, tone: null, output: null, outputEnabled: false })

function normalizeSession(raw) {
  if (raw === true) return { toneEnabled: true, tone: null, output: null, outputEnabled: false }
  if (raw === false || raw === null || typeof raw !== 'object') return { ...EMPTY_SESSION }
  const toneEnabled = raw.toneEnabled === true || raw.grice === true
  const tone = typeof raw.tone === 'string' && raw.tone !== '' ? raw.tone : null
  const output = typeof raw.output === 'string' && raw.output !== '' ? raw.output : null
  // v2 stored one master switch; its selected output was injected exactly while
  // that switch was on, so migrate the output gate instead of guessing.
  const outputEnabled = raw.outputEnabled === true
    || (raw.outputEnabled === undefined && output !== null && toneEnabled)
  return { toneEnabled, tone, output, outputEnabled }
}

/** Validate one durable selection record (zod-shaped `.parse` for the domain table). */
function parseSelectionRecord(raw) {
  if (raw === null || typeof raw !== 'object') throw new Error('selection record must be an object')
  const record = normalizeSession(raw)
  if (!record.toneEnabled && record.tone === null && record.output === null && !record.outputEnabled) {
    throw new Error('selection record carries no selection')
  }
  for (const value of [record.tone, record.output]) {
    if (value !== null && (typeof value !== 'string' || value.length > MAX_PRESET_NAME_LENGTH)) {
      throw new Error('selection record names an invalid preset')
    }
  }
  return record
}

/** The storage-domain declaration; record schemas are zod-shaped (`parse`). */
const DOMAIN_SPEC = {
  name: DOMAIN_NAME,
  version: DOMAIN_VERSION,
  tables: { selection: { valueSchema: { parse: parseSelectionRecord } } },
}

function normalizeState(raw) {
  const state = {
    version: STATE_VERSION,
    sessions: {},
    updatedAt: null,
    activatedAt: null,
    activatedPid: null,
    lastClientSeen: null,
  }
  if (raw === null || typeof raw !== 'object') return state
  if (raw.sessions !== null && typeof raw.sessions === 'object') {
    for (const [key, value] of Object.entries(raw.sessions)) {
      if (typeof key !== 'string' || key === '' || key.length > MAX_SESSION_ID_LENGTH) continue
      const session = normalizeSession(value)
      if (session.toneEnabled || session.tone !== null || session.output !== null || session.outputEnabled) state.sessions[key] = session
    }
  }
  if (typeof raw.updatedAt === 'string') state.updatedAt = raw.updatedAt
  if (typeof raw.activatedAt === 'string') state.activatedAt = raw.activatedAt
  if (Number.isFinite(raw.activatedPid)) state.activatedPid = Math.trunc(raw.activatedPid)
  if (raw.lastClientSeen !== null && typeof raw.lastClientSeen === 'object') {
    const seen = raw.lastClientSeen
    state.lastClientSeen = {
      at: typeof seen.at === 'string' ? seen.at : null,
      sessionId: typeof seen.sessionId === 'string' ? seen.sessionId : null,
      version: typeof seen.version === 'string' ? seen.version : null,
    }
  }
  return state
}

function pruneSessions(state) {
  const keys = Object.keys(state.sessions)
  if (keys.length <= MAX_TRACKED_SESSIONS) return
  for (const key of keys.slice(0, keys.length - MAX_TRACKED_SESSIONS)) delete state.sessions[key]
}

/**
 * The switch store over the official storage domain: reads are synchronous
 * (the opened table keeps the loaded records in memory), writes are awaited so
 * a settled command implies a durable record.
 * @param table - the opened `selection` table handle.
 * @returns the store read and write surface.
 */
function createStore(table) {
  async function write(sessionId, record) {
    const empty = !record.toneEnabled && record.tone === null && record.output === null && !record.outputEnabled
    if (empty) await table.delete(sessionId)
    else await table.put(sessionId, { ...record })
    return record
  }

  const store = {
    /** The effective per-Session state; a missing Session reads fully off. */
    session(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return { ...EMPTY_SESSION }
      const stored = table.get(sessionId)
      return stored === undefined ? { ...EMPTY_SESSION } : normalizeSession(stored)
    },
    /** Whether the master switch is on for this Session. */
    toneEnabled(sessionId) {
      return store.session(sessionId).toneEnabled
    },
    /** Whether the independent output-form switch is on for this Session. */
    outputEnabled(sessionId) {
      return store.session(sessionId).outputEnabled
    },
    /** Set the master switch; an empty Session id cannot be stored. */
    async setToneEnabled(sessionId, enabled) {
      const id = requireSessionIdValue(sessionId)
      return write(id, { ...store.session(id), toneEnabled: enabled === true })
    },
    /** Set the independent output-form switch; an empty Session id cannot be stored. */
    async setOutputEnabled(sessionId, enabled) {
      const id = requireSessionIdValue(sessionId)
      return write(id, { ...store.session(id), outputEnabled: enabled === true })
    },
    /** Set one preset slot; `null` clears it. Selecting a preset also enables its own switch. */
    async setPreset(sessionId, kind, presetId) {
      const id = requireSessionIdValue(sessionId)
      if (!KINDS.includes(kind)) throw new HttpError(400, 'invalid', 'kind must be tone or output')
      const value = presetId === undefined || presetId === null ? null : String(presetId)
      const current = store.session(id)
      return write(id, kind === 'tone'
        ? { ...current, toneEnabled: true, tone: value }
        : { ...current, outputEnabled: true, output: value })
    },
    /** Flip the master switch and return the new per-Session state. */
    async toggle(sessionId) {
      const id = requireSessionIdValue(sessionId)
      return store.setToneEnabled(id, !store.toneEnabled(id))
    },
    /** Flip the output-form switch and return the new per-Session state. */
    async toggleOutput(sessionId) {
      const id = requireSessionIdValue(sessionId)
      return store.setOutputEnabled(id, !store.outputEnabled(id))
    },
  }
  return store
}

/**
 * Import the pre-domain JSON state once. The legacy file is renamed on success
 * so a stale snapshot cannot re-import over newer domain records; a failed
 * rename only costs a re-check on the next start, never a duplicate write.
 * @param ctx - host context, for diagnostics.
 * @param table - the opened `selection` table handle.
 */
async function migrateLegacyState(ctx, table) {
  const file = stateFile()
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return
  }
  const legacy = normalizeState(raw)
  pruneSessions(legacy)
  let migrated = 0
  for (const [sessionId, value] of Object.entries(legacy.sessions)) {
    if (table.get(sessionId) !== undefined) continue
    const record = normalizeSession(value)
    if (!record.toneEnabled && record.tone === null && record.output === null && !record.outputEnabled) continue
    await table.put(sessionId, record)
    migrated += 1
  }
  try {
    fs.renameSync(file, `${file}.migrated`)
  } catch {
    // Keeping the file is harmless: the per-record existence check above is idempotent.
  }
  if (migrated > 0) ctx?.logger?.info?.('dsh-output-style: migrated %d session selection(s) into domain %s', migrated, DOMAIN_NAME)
}

/**
 * Open the plugin's selection domain, run the one-time migrations, and hand the
 * `selection` table to the store. The domain close is owned by the plugin
 * fiber's effect chain, registered before the open await.
 * @param ctx - plugin fiber context.
 * @param storageDomain - the injected `storageDomain` facility.
 * @returns the opened table handle (undefined when the fiber died mid-open).
 */
async function openSelectionTable(ctx, storageDomain) {
  let opened
  ctx.effect(() => () => {
    void opened?.close()
  }, 'dsh-output-style: storage domain close')
  const domain = await storageDomain.open(DOMAIN_SPEC)
  if (ctx.fiber?.uid === null) {
    await domain.close()
    return undefined
  }
  opened = domain
  migrateLegacyDir(ctx)
  const table = domain.table('selection')
  await migrateLegacyState(ctx, table)
  return table
}

function requireSessionIdValue(value) {
  const id = String(value ?? '').trim()
  if (id === '' || id.length > MAX_SESSION_ID_LENGTH) throw new HttpError(400, 'invalid', 'sessionId is invalid')
  return id
}

// --- preset library ----------------------------------------------------------

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_PRESETS))
}

function normalizePreset(raw, kind) {
  if (raw === null || typeof raw !== 'object') return undefined
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const prompt = typeof raw.prompt === 'string' ? raw.prompt : ''
  if (id === '' || id.length > MAX_PRESET_NAME_LENGTH) return undefined
  if (name === '' || name.length > MAX_PRESET_NAME_LENGTH) return undefined
  return {
    id,
    name,
    prompt: prompt.slice(0, MAX_PRESET_PROMPT_LENGTH),
    pinned: raw.pinned === true,
    builtin: raw.builtin === true || (kind === 'tone' && id === 'grice'),
  }
}

function normalizePresets(raw) {
  const library = { version: PRESETS_VERSION, tones: [], outputs: [] }
  if (raw === null || typeof raw !== 'object') return cloneDefaults()
  const seen = new Set()
  for (const kind of KINDS) {
    const key = PRESET_KEY[kind]
    const list = Array.isArray(raw[key]) ? raw[key] : []
    for (const entry of list) {
      const preset = normalizePreset(entry, kind)
      if (preset === undefined) continue
      const dedupe = `${kind}:${preset.id}`
      if (seen.has(dedupe)) continue
      seen.add(dedupe)
      library[key].push(preset)
      if (library[key].length >= MAX_PRESETS_PER_KIND) break
    }
    if (library[key].length === 0) library[key] = cloneDefaults()[key]
  }
  return library
}

// --- markdown preset library ------------------------------------------------

/** Absolute path of the user preset directory (one subdirectory per kind). */
export function presetsDir() {
  return path.join(dshHome(), STATE_DIR, PRESETS_DIR)
}

function presetKindDir(kind) {
  return path.join(presetsDir(), kind)
}

/** Sanitize a caller-supplied preset id into a safe file stem (no separators). */
function sanitizePresetId(value) {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

function presetFilePath(kind, id) {
  return path.join(presetKindDir(kind), `${id}.md`)
}

function presetBuiltinIds(kind) {
  return new Set((DEFAULT_PRESETS[PRESET_KEY[kind]] ?? []).map((preset) => preset.id))
}

/** Serialize one preset as a markdown file: scalar frontmatter plus the prompt body. */
function serializePreset(preset) {
  const lines = ['---', `name: ${JSON.stringify(preset.name)}`, `pinned: ${preset.pinned === true}`, '---', '', preset.prompt, '']
  return lines.join('\n')
}

/** Parse one `---` frontmatter + body preset file; undefined when malformed. */
function parsePresetText(id, kind, text) {
  if (typeof text !== 'string') return undefined
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (match === null) return undefined
  const fields = {}
  for (const line of match[1].split(/\r?\n/)) {
    const index = line.indexOf(':')
    if (index <= 0) continue
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value)
      } catch {
        continue
      }
    }
    fields[key] = value
  }
  const prompt = text.slice(match[0].length).trim()
  if (prompt.length > MAX_PRESET_PROMPT_LENGTH) return undefined
  const name = typeof fields.name === 'string' && fields.name.trim() !== '' ? fields.name.trim() : id
  if (name.length > MAX_PRESET_NAME_LENGTH) return undefined
  return {
    id,
    name,
    prompt,
    pinned: String(fields.pinned).toLowerCase() === 'true',
    builtin: presetBuiltinIds(kind).has(id),
  }
}

/** Write one preset markdown file (atomic rename so the watcher sees one event). */
function writePresetFile(kind, preset) {
  const file = presetFilePath(kind, preset.id)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, serializePreset(preset), 'utf8')
  fs.renameSync(temporary, file)
}

/** Seed the shipped defaults as user files (idempotent; never overwrites). */
function seedPresetFiles() {
  for (const kind of KINDS) {
    for (const preset of DEFAULT_PRESETS[PRESET_KEY[kind]]) {
      if (fs.existsSync(presetFilePath(kind, preset.id))) continue
      writePresetFile(kind, preset)
    }
  }
}

/**
 * Import the pre-markdown presets.json once: one file per preset, then the JSON
 * is renamed away so a stale snapshot cannot re-import over newer files.
 * @param ctx - host context, for diagnostics.
 */
function migratePresetsJson(ctx) {
  const file = presetsFile()
  if (!fs.existsSync(file)) return
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    raw = undefined
  }
  const library = normalizePresets(raw)
  for (const kind of KINDS) {
    for (const preset of library[PRESET_KEY[kind]]) {
      if (fs.existsSync(presetFilePath(kind, preset.id))) continue
      writePresetFile(kind, preset)
    }
  }
  try {
    fs.renameSync(file, `${file}.migrated`)
  } catch {
    // Keeping the file is harmless: existing files are never overwritten above.
  }
  ctx?.logger?.info?.('dsh-output-style: migrated presets.json into markdown files')
}

/**
 * Load the markdown preset library. A malformed file is skipped with a
 * warning and never breaks the plugin; an empty kind falls back to the shipped
 * defaults so the composer always has presets.
 * @param ctx - host context, for diagnostics.
 * @returns the library in file order.
 */
function loadPresetLibrary(ctx) {
  const library = { version: PRESETS_VERSION, tones: [], outputs: [] }
  for (const kind of KINDS) {
    const dir = presetKindDir(kind)
    let entries
    try {
      entries = fs.readdirSync(dir)
    } catch {
      entries = []
    }
    for (const name of entries.filter((entry) => entry.endsWith('.md')).sort()) {
      const id = name.slice(0, -3)
      if (id === '' || id.length > MAX_PRESET_NAME_LENGTH) continue
      if (library[PRESET_KEY[kind]].length >= MAX_PRESETS_PER_KIND) break
      let text
      try {
        text = fs.readFileSync(path.join(dir, name), 'utf8')
      } catch {
        continue
      }
      const preset = parsePresetText(id, kind, text)
      if (preset === undefined) {
        ctx?.logger?.warn?.('dsh-output-style: skipped malformed preset file %s', name)
        continue
      }
      library[PRESET_KEY[kind]].push(preset)
    }
  }
  for (const kind of KINDS) {
    if (library[PRESET_KEY[kind]].length > 0) continue
    seedPresetFiles()
    library[PRESET_KEY[kind]] = DEFAULT_PRESETS[PRESET_KEY[kind]].map((preset) => ({ ...preset }))
  }
  return library
}

function createPresetStore(ctx) {
  let cached
  let prepared = false

  /** One-time import of the pre-markdown library, then the shipped files. */
  function prepare() {
    if (prepared) return
    prepared = true
    try {
      migratePresetsJson(ctx)
    } catch (error) {
      ctx?.logger?.warn?.('dsh-output-style: preset migration failed: %s', String((error && error.message) || error))
    }
    try {
      seedPresetFiles()
    } catch (error) {
      ctx?.logger?.warn?.('dsh-output-style: preset files could not be seeded: %s', String((error && error.message) || error))
    }
  }

  function load() {
    prepare()
    if (cached === undefined) cached = loadPresetLibrary(ctx)
    return cached
  }

  function reload() {
    try {
      cached = loadPresetLibrary(ctx)
    } catch (error) {
      ctx?.logger?.warn?.('dsh-output-style: preset reload skipped: %s', String((error && error.message) || error))
    }
    return cached
  }

  // Watch the user preset tree and swap the library after a coalescing delay;
  // a failed reload keeps the previous library, never breaks the composer.
  try {
    ctx.effect(() => {
      let timer
      let watcher
      try {
        watcher = fs.watch(presetsDir(), { persistent: false, recursive: true }, () => {
          if (timer !== undefined) return
          timer = setTimeout(() => {
            timer = undefined
            reload()
          }, WATCH_DEBOUNCE_MS)
        })
      } catch (error) {
        ctx?.logger?.warn?.('dsh-output-style: preset directory cannot be watched: %s', String((error && error.message) || error))
        return () => {}
      }
      return () => {
        if (timer !== undefined) clearTimeout(timer)
        try {
          watcher.close()
        } catch {
          // The watcher is already gone.
        }
      }
    })
  } catch {
    // A composition without the effect service still serves the loaded library.
  }

  // Prepare on activation so the first assembly or dropdown read is settled.
  try {
    load()
  } catch (error) {
    ctx?.logger?.warn?.('dsh-output-style: preset library could not be prepared: %s', String((error && error.message) || error))
  }

  function list() {
    const library = load()
    return { tones: library.tones.map((preset) => ({ ...preset })), outputs: library.outputs.map((preset) => ({ ...preset })) }
  }

  function find(kind, id) {
    if (typeof id !== 'string' || id === '') return undefined
    if (!KINDS.includes(kind)) return undefined
    return load()[PRESET_KEY[kind]].find((preset) => preset.id === id)
  }

  /** Keep at most MAX_PINNED_PER_KIND pinned rows per kind, rewriting the losers. */
  function enforcePinnedCap(kind, exceptId) {
    const library = load()
    const list = library[PRESET_KEY[kind]]
    let pinned = list.filter((preset) => preset.pinned)
    if (pinned.length <= MAX_PINNED_PER_KIND) return
    const keep = new Set(pinned.slice(0, MAX_PINNED_PER_KIND).map((preset) => preset.id))
    for (const preset of pinned) {
      if (keep.has(preset.id) || preset.id === exceptId) continue
      preset.pinned = false
      writePresetFile(kind, preset)
    }
    reload()
  }

  function makeId(library, kind, name) {
    const key = PRESET_KEY[kind]
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'preset'
    let candidate = base
    let index = 2
    while (library[key].some((preset) => preset.id === candidate)) {
      candidate = `${base}-${index}`
      index += 1
    }
    return candidate
  }

  return {
    list,
    find,
    /** Create or replace one preset file; returns the saved list. */
    upsert(kind, input) {
      if (!KINDS.includes(kind)) throw new HttpError(400, 'invalid', 'kind must be tone or output')
      const name = typeof input.name === 'string' ? input.name.trim() : ''
      if (name === '' || name.length > MAX_PRESET_NAME_LENGTH) {
        throw new HttpError(400, 'invalid', `name must be 1-${MAX_PRESET_NAME_LENGTH} characters`)
      }
      if (typeof input.prompt !== 'string') throw new HttpError(400, 'invalid', 'prompt must be a string')
      if (input.prompt.length > MAX_PRESET_PROMPT_LENGTH) {
        throw new HttpError(400, 'invalid', `prompt must be at most ${MAX_PRESET_PROMPT_LENGTH} characters`)
      }
      const library = load()
      const key = PRESET_KEY[kind]
      const wantedId = typeof input.id === 'string' ? sanitizePresetId(input.id) : ''
      const existing = wantedId === '' ? undefined : library[key].find((preset) => preset.id === wantedId)
      let preset
      if (existing !== undefined) {
        preset = { ...existing, name, prompt: input.prompt }
        if (typeof input.pinned === 'boolean') preset.pinned = input.pinned
      } else {
        if (library[key].length >= MAX_PRESETS_PER_KIND) {
          throw new HttpError(400, 'full', `at most ${MAX_PRESETS_PER_KIND} presets per kind`)
        }
        preset = {
          id: wantedId === '' ? makeId(library, kind, name) : wantedId,
          name,
          prompt: input.prompt,
          pinned: input.pinned === true,
          builtin: false,
        }
      }
      writePresetFile(kind, preset)
      reload()
      enforcePinnedCap(kind, preset.id)
      return { list: list(), saved: find(kind, preset.id) ?? preset }
    },
    /**
     * Import presets for one kind from already-parsed JSON entries. A safe
     * explicit id overwrites the same id; missing ids are generated from the
     * name. Invalid or over-cap entries are skipped and reported.
     * @param kind - tone or output.
     * @param entries - preset objects (`{ id?, name, prompt, pinned? }`).
     * @returns the saved list plus imported/skipped counts.
     */
    importMany(kind, entries) {
      if (!KINDS.includes(kind)) throw new HttpError(400, 'invalid', 'kind must be tone or output')
      if (!Array.isArray(entries) || entries.length === 0) {
        throw new HttpError(400, 'invalid', 'presets must be a non-empty array')
      }
      let imported = 0
      const skipped = []
      for (const entry of entries.slice(0, MAX_PRESETS_PER_KIND)) {
        if (entry === null || typeof entry !== 'object') {
          skipped.push('invalid')
          continue
        }
        const name = typeof entry.name === 'string' ? entry.name.trim() : ''
        const prompt = typeof entry.prompt === 'string' ? entry.prompt : ''
        if (name === '' || name.length > MAX_PRESET_NAME_LENGTH || prompt.length > MAX_PRESET_PROMPT_LENGTH) {
          skipped.push(name === '' ? 'invalid' : name)
          continue
        }
        const library = load()
        const key = PRESET_KEY[kind]
        const wantedId = sanitizePresetId(entry.id)
        const existing = wantedId === '' ? undefined : library[key].find((preset) => preset.id === wantedId)
        if (existing === undefined && library[key].length >= MAX_PRESETS_PER_KIND) {
          skipped.push(name)
          continue
        }
        const id = existing !== undefined ? existing.id : (wantedId === '' ? makeId(library, kind, name) : wantedId)
        writePresetFile(kind, { id, name, prompt, pinned: entry.pinned === true, builtin: false })
        imported += 1
      }
      reload()
      if (imported > 0) enforcePinnedCap(kind)
      return { list: list(), imported, skipped }
    },
    /** Delete one preset file; returns the saved list. */
    remove(kind, id) {
      if (!KINDS.includes(kind)) throw new HttpError(400, 'invalid', 'kind must be tone or output')
      if (typeof id !== 'string' || id === '') throw new HttpError(400, 'invalid', 'id required')
      const file = presetFilePath(kind, id)
      if (!fs.existsSync(file)) throw new HttpError(404, 'not-found', 'preset does not exist')
      fs.rmSync(file, { force: true })
      reload()
      return { list: list() }
    },
    /** Restore one kind, or the whole library, to the shipped defaults. */
    reset(kind) {
      if (kind !== undefined && kind !== null && !KINDS.includes(kind)) {
        throw new HttpError(400, 'invalid', 'kind must be tone or output')
      }
      const kinds = kind === 'tone' || kind === 'output' ? [kind] : [...KINDS]
      for (const target of kinds) {
        const dir = presetKindDir(target)
        let entries = []
        try {
          entries = fs.readdirSync(dir)
        } catch {
          entries = []
        }
        for (const entry of entries) {
          if (!entry.endsWith('.md')) continue
          fs.rmSync(path.join(dir, entry), { force: true })
        }
        for (const preset of DEFAULT_PRESETS[PRESET_KEY[target]]) {
          writePresetFile(target, { ...preset })
        }
      }
      reload()
      return { list: list() }
    },
  }
}

// --- prompt sections ---------------------------------------------------------

/** The Session id of the agent whose prompt is being assembled, when known. */
function sessionIdOfAssembly(assembly) {
  try {
    const session = assembly !== null && typeof assembly === 'object' && assembly.agent !== undefined
      ? assembly.agent.session
      : undefined
    const id = session !== null && typeof session === 'object' ? session.id : undefined
    if (typeof id === 'string') return id
    if (id !== undefined && id !== null) return String(id)
  } catch {
    // An assembly shape this build cannot read contributes no guidance.
    return undefined
  }
  return undefined
}

/**
 * Register the three conditional prompt sections. Their providers run at every
 * assembly, so a switched or selected preset reaches the very next step of the
 * same turn.
 * @param sp - the system-prompt service.
 * @param fiber - the owning injected context.
 * @param store - the session switch store.
 * @param presets - the preset library.
 */
function registerPrompt(sp, fiber, store, presets) {
  const sessionState = (assembly) => {
    const sessionId = sessionIdOfAssembly(assembly)
    return sessionId === undefined ? undefined : store.session(sessionId)
  }
  fiber.effect(() => sp.section({
    name: SECTION_POLICY,
    order: ORDER_POLICY,
    text: (assembly) => {
      const session = sessionState(assembly)
      if (session === undefined || !session.toneEnabled) return ''
      if (session.tone !== null && session.tone !== 'grice') return ''
      return POLICY_TEXT
    },
  }))
  fiber.effect(() => sp.section({
    name: SECTION_TONE,
    order: ORDER_TONE,
    text: (assembly) => {
      const session = sessionState(assembly)
      if (session === undefined || !session.toneEnabled || session.tone === null || session.tone === 'grice') return ''
      const preset = presets.find('tone', session.tone)
      return preset === undefined ? '' : preset.prompt
    },
  }))
  fiber.effect(() => sp.section({
    name: SECTION_OUTPUT,
    order: ORDER_OUTPUT,
    text: (assembly) => {
      const session = sessionState(assembly)
      if (session === undefined || !session.outputEnabled || session.output === null) return ''
      const preset = presets.find('output', session.output)
      return preset === undefined ? '' : preset.prompt
    },
  }))
}

// --- recommendation (settings page "智能推荐") --------------------------------

/**
 * Load the analyzer with an mtime-bearing query. A host reload (disable/enable
 * or HMR) reinstantiates the plugin, and the query makes the fresh analyzer run
 * instead of the process-wide ESM cache.
 * @returns the analyzer module namespace.
 */
async function loadAnalyzer() {
  const url = new URL('./analyze.js', import.meta.url)
  const stat = await fs.promises.stat(fileURLToPath(url))
  return import(`${url.href}?v=${stat.mtimeMs}`)
}

/** Absolute path of the shipped task-analysis guide used by the AI layer. */
const ANALYSIS_GUIDE_FILE = fileURLToPath(new URL('./analysis-guide.md', import.meta.url))
/** Loaded lazily; an unreadable guide degrades to the rules layer only. */
let analysisGuideText
function analysisGuide() {
  if (analysisGuideText === undefined) {
    try {
      analysisGuideText = fs.readFileSync(ANALYSIS_GUIDE_FILE, 'utf8')
    } catch {
      analysisGuideText = ''
    }
  }
  return analysisGuideText
}

/** Compact preset projection for prompts and rules. */
function compactPresets(presets) {
  const list = presets.list()
  const compact = (entries) => (Array.isArray(entries) ? entries : []).map((preset) => ({ id: preset.id, name: preset.name }))
  return { tones: compact(list.tones), outputs: compact(list.outputs) }
}

/** Validate and bound the analysis form coming from the settings page. */
function normalizeAnalyzeInput(body) {
  const input = body !== null && typeof body === 'object' ? body : {}
  const read = (value, limit) => (typeof value === 'string' ? value.trim().slice(0, limit) : '')
  const normalized = {
    content: read(input.content, 8000),
    stage: read(input.stage, 40),
    inputs: read(input.inputs, 2000),
    outputs: read(input.outputs, 2000),
    audience: read(input.audience, 1000),
    constraints: read(input.constraints, 2000),
  }
  if (normalized.content === '') throw new HttpError(400, 'invalid', '请先填写工作内容与目标')
  return normalized
}

/**
 * Layer B: one LLM call over the default model, embedding the shipped task
 * analysis guide and the rules result as a prior. Throws on any failure so the
 * route can fall back to the rules result.
 * @param fiber - the webServer-injected scope, used to reach optional services.
 * @param input - the normalized form.
 * @param presets - compact preset lists.
 * @param fallback - the rules result.
 * @returns the AI analysis in the shared result shape.
 */
async function analyzeWithAi(fiber, input, presets, fallback) {
  const llm = fiber.get('llm')
  if (llm === null || llm === undefined || typeof llm.stream !== 'function') {
    throw new Error('AI 分析需要 llm 服务，当前组合未提供')
  }
  const defaults = fiber.get('agentDefaultModel')
  const selection = defaults !== null && defaults !== undefined && typeof defaults.currentSelection === 'function'
    ? defaults.currentSelection()
    : undefined
  if (selection === null || selection === undefined || typeof selection.provider !== 'string' || typeof selection.model !== 'string') {
    throw new Error('没有可用的默认模型，请先在设置里选择模型')
  }
  const messages = analyzeEngine.buildAiMessages(input, analysisGuide(), presets.tones, presets.outputs, fallback)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60000)
  let text = ''
  let finish
  const chunkTypes = {}
  try {
    for await (const chunk of llm.stream({
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
      system: messages.system,
      messages: [{ role: 'user', content: [{ type: 'text', text: messages.user }] }],
      temperature: 0.2,
      maxTokens: 3000,
      signal: controller.signal,
    })) {
      if (chunk === null || typeof chunk !== 'object') continue
      chunkTypes[chunk.type] = (chunkTypes[chunk.type] ?? 0) + 1
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      if (chunk.type === 'finish') {
        finish = chunk.reason
        break
      }
    }
  } finally {
    clearTimeout(timer)
  }
  if (finish !== undefined && finish !== null && finish.kind !== 'stop' && finish.kind !== 'max-tokens') {
    const failure = finish.failure
    throw new Error(failure !== undefined && typeof failure.message === 'string' ? failure.message : '模型调用失败')
  }
  if (text.trim() === '') {
    const shape = JSON.stringify({ finish: finish === undefined ? null : finish.kind, chunks: chunkTypes })
    throw new Error(`模型没有返回文本（${shape}）`)
  }
  const payload = analyzeEngine.parseAiPayload(text)
  const result = payload === undefined ? undefined : analyzeEngine.normalizeAiResult(payload, presets.tones, presets.outputs, fallback)
  if (result === undefined) {
    const shape = JSON.stringify({ finish: finish === undefined ? null : finish.kind, length: text.length })
    throw new Error(`模型返回的分析格式无法解析或输出被截断（${shape}，前 120 字：${text.slice(0, 120)}）`)
  }
  return result
}

// --- HTTP routes -------------------------------------------------------------

function isLoopbackAddress(address) {
  if (typeof address !== 'string' || address.length === 0) return false
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.')
}

function isLocalHostHeader(host) {
  if (typeof host !== 'string' || host.length === 0) return false
  const name = host.split(':')[0].replace(/^\[|\]$/g, '').toLowerCase()
  return name === 'localhost' || name === '127.0.0.1' || name === '::1'
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 1e6) req.destroy()
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
    req.on('aborted', () => reject(new Error('aborted')))
  })
}

/** Loopback socket, loopback Host header, and same-origin when an Origin is sent. */
function guard(req, res) {
  if (!isLoopbackAddress(req.socket && req.socket.remoteAddress)) {
    sendJson(res, 403, { ok: false, code: 'forbidden', error: 'loopback only' })
    return false
  }
  const host = req.headers.host
  if (!isLocalHostHeader(host)) {
    sendJson(res, 403, { ok: false, code: 'forbidden', error: 'unexpected host' })
    return false
  }
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin.length > 0) {
    let originHost = null
    try {
      originHost = new URL(origin).host
    } catch {
      originHost = null
    }
    if (originHost !== host) {
      sendJson(res, 403, { ok: false, code: 'forbidden', error: 'cross-origin request' })
      return false
    }
  }
  return true
}

async function readJsonBody(req) {
  let body = {}
  try {
    const raw = await readBody(req)
    if (raw) body = JSON.parse(raw)
  } catch {
    throw new HttpError(400, 'invalid', 'malformed JSON body')
  }
  return body !== null && typeof body === 'object' ? body : {}
}

function requireKind(body) {
  const kind = typeof body.kind === 'string' ? body.kind : ''
  if (!KINDS.includes(kind)) throw new HttpError(400, 'invalid', 'kind must be tone or output')
  return kind
}

function routeHandler(run, context) {
  return async (req, res) => {
    if (!guard(req, res)) return
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, code: 'method', error: 'POST only' })
      return
    }
    try {
      const body = await readJsonBody(req)
      sendJson(res, 200, { ok: true, ...await run(body, context) })
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const code = error instanceof HttpError ? error.code : 'internal'
      sendJson(res, status, { ok: false, code, error: String((error && error.message) || error) })
    }
  }
}

/**
 * Publish the browser-facing preset-library surface: the settings page's read
 * and CRUD operations. Session state is not served here any more — the browser
 * reads the `outputStylePair` session projection and writes through `/style`
 * commands, so there is nothing to poll and no custom state protocol.
 * @param webServer - the Host web server.
 * @param fiber - the owning injected context.
 * @param presets - the preset library.
 */
function registerRoutes(webServer, fiber, presets) {
  fiber.effect(() => webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/presets`,
    handler: routeHandler(async () => ({ presets: presets.list() })),
  }))
  fiber.effect(() => webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/presets/save`,
    handler: routeHandler(async (body) => {
      const kind = requireKind(body)
      const preset = body.preset !== null && typeof body.preset === 'object' ? body.preset : {}
      return { ...presets.upsert(kind, preset), kind }
    }),
  }))
  fiber.effect(() => webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/presets/delete`,
    handler: routeHandler(async (body) => {
      const kind = requireKind(body)
      const id = typeof body.id === 'string' ? body.id : ''
      if (id === '') throw new HttpError(400, 'invalid', 'id required')
      return { ...presets.remove(kind, id), kind }
    }),
  }))
  fiber.effect(() => webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/presets/import`,
    handler: routeHandler(async (body) => {
      const kind = requireKind(body)
      return { ...presets.importMany(kind, body.presets), kind }
    }),
  }))
  fiber.effect(() => webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/analyze`,
    handler: routeHandler(async (body, injected) => {
      if (analyzeEngine === undefined) throw new HttpError(503, 'unavailable', '分析器尚未加载完成')
      const input = normalizeAnalyzeInput(body.input)
      const compact = compactPresets(presets)
      const fallback = analyzeEngine.analyzeRules(input, compact.tones, compact.outputs)
      if (body.mode !== 'ai') return { analysis: fallback }
      try {
        return { analysis: await analyzeWithAi(injected, input, compact, fallback) }
      } catch (error) {
        return { analysis: { ...fallback, warning: `AI 分析不可用：${String((error && error.message) || error)}` } }
      }
    }, fiber),
  }))
  fiber.effect(() => webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/presets/reset`,
    handler: routeHandler(async (body) => {
      const kind = body.kind === undefined || body.kind === null ? undefined : requireKind(body)
      return { ...presets.reset(kind) }
    }),
  }))
}

// --- `/style` command --------------------------------------------------------

function presetName(presets, kind, id) {
  if (id === null || id === undefined) return kind === 'tone' ? '格赖斯·高效' : '无额外要求'
  const preset = presets.find(kind, id)
  return preset === undefined ? id : preset.name
}

/**
 * Register the slash command with the same authority as the composer controls,
 * so the switch and both selections also work from a keyboard-driven session.
 * @param commands - the command registry service.
 * @param fiber - the owning injected context.
 * @param store - the session switch store.
 * @param presets - the preset library.
 */
function registerCommand(commands, fiber, store, presets) {
  fiber.effect(() => commands.register({
    name: 'style',
    description: '开关沟通基调与产出形态，或查看/设置当前会话的基调与产出预设',
    input: { hint: '[on|off|output on|output off|tone <id>|output <id>]' },
    handler: async ({ agent, rawInput }) => {
      const session = agent !== null && typeof agent === 'object' ? agent.session : undefined
      const sessionId = session !== null && typeof session === 'object' && session.id !== undefined ? String(session.id) : ''
      if (sessionId === '') return { kind: 'error', text: '当前会话不可用，无法切换输出风格。' }
      const argument = String(rawInput === undefined ? '' : rawInput).trim()
      const [verb, ...rest] = argument.split(/\s+/)
      if (argument === '' || verb === 'status') {
        const current = store.session(sessionId)
        return {
          kind: 'success',
          text: `基调开关：${current.toneEnabled ? '开' : '关'}（${presetName(presets, 'tone', current.tone ?? 'grice')}）；产出开关：${current.outputEnabled ? '开' : '关'}（${presetName(presets, 'output', current.output)}）`,
        }
      }
      if (verb === 'on' || verb === '开') {
        await store.setToneEnabled(sessionId, true)
        return { kind: 'success', text: '基调开关已开启。' }
      }
      if (verb === 'off' || verb === '关') {
        await store.setToneEnabled(sessionId, false)
        return { kind: 'success', text: '基调开关已关闭。' }
      }
      if (verb === 'output' && (rest[0] === 'on' || rest[0] === 'off')) {
        const enabled = rest[0] === 'on'
        await store.setOutputEnabled(sessionId, enabled)
        return { kind: 'success', text: `产出开关已${enabled ? '开启' : '关闭'}。` }
      }
      if (verb === 'tone' || verb === 'output') {
        const kind = verb
        const id = (rest[0] ?? '').trim()
        if (id === '' || id === 'default' || id === 'none') {
          await store.setPreset(sessionId, kind, null)
          return { kind: 'success', text: `${kind === 'tone' ? '基调' : '产出'}已恢复默认。` }
        }
        if (presets.find(kind, id) === undefined) return { kind: 'error', text: `没有 ${kind} 预设「${id}」。` }
        await store.setPreset(sessionId, kind, id)
        return { kind: 'success', text: `${kind === 'tone' ? '基调' : '产出'}已设为「${presetName(presets, kind, id)}」，对应开关已开启。` }
      }
      return { kind: 'error', text: '用法：/style [on|off|output on|output off|tone <id>|output <id>]' }
    },
  }))
}

// --- session projection ------------------------------------------------------

/** Validate the projection's persisted fold state (zod-shaped `.parse`). */
function parseFoldState(raw) {
  if (raw === null || typeof raw !== 'object') throw new Error('fold state must be an object')
  const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId : ''
  if (sessionId === '') throw new Error('fold state is missing its session id')
  const pending = raw.pending
  if (pending !== null && (typeof pending !== 'object' || typeof pending.commandId !== 'string')) {
    throw new Error('fold state pending is invalid')
  }
  return { sessionId, pending: pending === null || pending === undefined ? null : { commandId: pending.commandId } }
}

/** Validate the projection's wire view (zod-shaped `.parse`). */
function parseStyleView(raw) {
  if (raw === null || typeof raw !== 'object') throw new Error('style view must be an object')
  if (typeof raw.enabled !== 'boolean' || typeof raw.outputEnabled !== 'boolean') throw new Error('style view switches are invalid')
  if (raw.tone !== null && typeof raw.tone !== 'string') throw new Error('style view tone is invalid')
  if (raw.output !== null && typeof raw.output !== 'string') throw new Error('style view output is invalid')
  if (!Array.isArray(raw.tones) || !Array.isArray(raw.outputs)) throw new Error('style view libraries are invalid')
  return raw
}

/**
 * Fold one committed command lifecycle event into the projection state. The
 * state carries only the session id and the in-flight switch; the whole view is
 * derived from the domain at read time, so a migrated or out-of-band record can
 * never be masked by stale fold state.
 * @param state - folded state before the event.
 * @param event - one committed session event.
 * @returns the next state; the same reference when the event is not ours.
 */
function foldStyleEvent(state, event) {
  if (event === null || typeof event !== 'object') return state
  const data = event.data
  if (event.type === 'command/run') {
    if (data === null || typeof data !== 'object' || data.name !== 'style' || data.args === undefined) return state
    const argument = String(data.args).trim()
    if (argument === '' || argument === 'status') return state
    const commandId = String(data.commandId)
    if (state.pending !== null && state.pending.commandId === commandId) return state
    return { sessionId: state.sessionId, pending: { commandId } }
  }
  if (event.type === 'command/done' && state.pending !== null) {
    if (data === null || typeof data !== 'object') return state
    if (state.pending.commandId !== String(data.commandId)) return state
    return { sessionId: state.sessionId, pending: null }
  }
  return state
}

/** Build the whole wire view: the live domain record plus both compact libraries. */
function buildStyleView(store, presets, state) {
  const session = store.session(state.sessionId)
  const library = presets.list()
  const compact = (list) => list.map((preset) => ({ id: preset.id, name: preset.name, pinned: preset.pinned === true }))
  return {
    enabled: session.toneEnabled,
    tone: session.tone,
    outputEnabled: session.outputEnabled,
    output: session.output,
    tones: compact(Array.isArray(library.tones) ? library.tones : []),
    outputs: compact(Array.isArray(library.outputs) ? library.outputs : []),
  }
}

/**
 * Register the `outputStylePair` session projection: the composer subscribes to
 * this whole value instead of polling a route. Registration rides the injected
 * scope's fiber effect.
 * @param ctx - plugin context.
 * @param store - the domain-backed session store.
 * @param presets - the preset library.
 */
function registerProjection(ctx, store, presets) {
  ctx.inject(['sessionProjections'], (sub) => {
    sub.effect(() => sub.sessionProjections.register({
      key: PROJECTION_KEY,
      stateSchema: { parse: parseFoldState },
      init: (header) => ({
        sessionId: header !== null && typeof header === 'object' && header.id !== undefined ? String(header.id) : '',
        pending: null,
      }),
      apply: foldStyleEvent,
      wire: {
        viewSchema: { parse: parseStyleView },
        view: (state) => buildStyleView(store, presets, state),
      },
      stateVersion: PROJECTION_STATE_VERSION,
    }))
  })
}

// --- plugin ------------------------------------------------------------------

/**
 * Wire the storage-domain session state, the `/style` write path, the session
 * projection the browser reads, the preset settings routes, and the three
 * prompt sections.
 * @param ctx - host plugin context.
 */
export const inject = ['storageDomain']

export async function apply(ctx) {
  const storageDomain = ctx.get('storageDomain')
  if (storageDomain === undefined || storageDomain === null || typeof storageDomain.open !== 'function') {
    ctx.logger?.warn?.('dsh-output-style: the storageDomain service is unavailable, so the plugin stays inactive')
    return
  }
  const table = await openSelectionTable(ctx, storageDomain)
  if (table === undefined) return
  const store = createStore(table)
  const presets = createPresetStore(ctx)
  try {
    analyzeEngine = await loadAnalyzer()
  } catch (error) {
    ctx.logger?.warn?.('dsh-output-style: analyzer could not be loaded: %s', String((error && error.message) || error))
    analyzeEngine = undefined
  }
  registerProjection(ctx, store, presets)

  ctx.inject(['systemPrompt'], (sub) => registerPrompt(sub.systemPrompt, sub, store, presets))
  ctx.inject(['webServer'], (sub) => registerRoutes(sub.webServer, sub, presets))
  ctx.inject(['commands'], (sub) => registerCommand(sub.commands, sub, store, presets))
}
