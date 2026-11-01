// dsh-grice - host half.
//
// One per-Session switch (the Grice pill) plus two per-Session preset slots:
// a communication/thinking tone and an output form. Three independent prompt
// contributions, all off unless the Session's master switch is on:
//
//   * `grice:policy`  - the built-in Grice guidance, used while the tone is
//     the default (`grice`) or unset;
//   * `grice:tone`    - a selected tone preset, which replaces the built-in
//     guidance (order 650);
//   * `grice:output`  - a selected output-form preset (order 660).
//
// Preset definitions live in `<DSH_HOME>/grice/presets.json` (one global
// library, editable from the settings page); the per-Session selection lives
// beside the master switch in `<DSH_HOME>/grice/state.json`. The browser half
// never owns state: it reads and submits, the Host is the single writer.
//
// The plugin imports nothing from the DSH SDK; every service is resolved
// through the cordis context at call time.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = 'dsh-grice'

/** Plugin version, also recorded by the browser half's mount beacon. */
const VERSION = '0.2.0'
/** HTTP route prefix owned by this plugin. */
const ROUTE_PREFIX = '/dsh-grice'
/** Prompt sections owned by this plugin. */
const SECTION_POLICY = 'grice:policy'
const SECTION_TONE = 'grice:tone'
const SECTION_OUTPUT = 'grice:output'
const ORDER_POLICY = 650
const ORDER_TONE = 650
const ORDER_OUTPUT = 660
/** Durable formats. */
const STATE_VERSION = 2
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
  '用户已开启「格赖斯模式」：请严格遵守格赖斯（H. P. Grice）合作原则及其四条准则，用最高的信息效率完成沟通，直到用户关闭该模式。',
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
  return path.join(dshHome(), 'grice', 'state.json')
}

/** Absolute path of the durable preset library. */
export function presetsFile() {
  return path.join(dshHome(), 'grice', 'presets.json')
}

/** A request the browser half made, rejected with its own status and code. */
class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

// --- atomic JSON storage -----------------------------------------------------

function readJsonCached(file, ctx, label) {
  let stat
  try {
    stat = fs.statSync(file)
  } catch {
    return { exists: false }
  }
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    ctx?.logger?.warn?.('dsh-grice: ignored unreadable %s: %s', label, String((error && error.message) || error))
    return { exists: true, broken: true }
  }
  return { exists: true, stat, raw }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(temporary, file)
}

// --- per-session state -------------------------------------------------------

const EMPTY_SESSION = Object.freeze({ grice: false, tone: null, output: null })

function normalizeSession(raw) {
  if (raw === true) return { grice: true, tone: null, output: null }
  if (raw === false || raw === null || typeof raw !== 'object') return { ...EMPTY_SESSION }
  const grice = raw.grice === true
  const tone = typeof raw.tone === 'string' && raw.tone !== '' ? raw.tone : null
  const output = typeof raw.output === 'string' && raw.output !== '' ? raw.output : null
  return { grice, tone, output }
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
      if (session.grice || session.tone !== null || session.output !== null) state.sessions[key] = session
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
 * The switch store: one JSON file as the single source of truth, read through
 * an mtime/size cache so providers evaluated on every prompt assembly do not
 * re-read the disk, and written atomically so a crash cannot truncate it.
 * @param ctx - host context, for diagnostics only.
 * @returns the store read and write surface.
 */
function createStore(ctx) {
  let cached
  let cachedStamp

  function load() {
    const file = stateFile()
    const read = readJsonCached(file, ctx, 'state file')
    if (!read.exists) {
      cached = normalizeState(undefined)
      cachedStamp = undefined
      return cached
    }
    if (cached !== undefined && cachedStamp !== undefined && read.stat !== undefined
      && cachedStamp.mtimeMs === read.stat.mtimeMs && cachedStamp.size === read.stat.size) {
      return cached
    }
    cached = normalizeState(read.broken ? undefined : read.raw)
    cachedStamp = read.stat === undefined ? undefined : { mtimeMs: read.stat.mtimeMs, size: read.stat.size }
    return cached
  }

  function save(next) {
    const file = stateFile()
    writeJson(file, next)
    cached = next
    try {
      const stat = fs.statSync(file)
      cachedStamp = { mtimeMs: stat.mtimeMs, size: stat.size }
    } catch {
      cachedStamp = undefined
    }
  }

  /** Apply one mutation to a fresh copy of the state, then persist it. */
  function update(mutate) {
    const current = normalizeState(load())
    const draft = {
      ...current,
      sessions: Object.fromEntries(Object.entries(current.sessions).map(([key, value]) => [key, { ...value }])),
    }
    mutate(draft)
    for (const [key, value] of Object.entries(draft.sessions)) {
      if (!value.grice && value.tone === null && value.output === null) delete draft.sessions[key]
    }
    pruneSessions(draft)
    draft.version = STATE_VERSION
    draft.updatedAt = new Date().toISOString()
    save(draft)
    return draft
  }

  const store = {
    /** The effective per-Session state; a missing Session reads fully off. */
    session(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return { ...EMPTY_SESSION }
      return { ...(load().sessions[sessionId] ?? EMPTY_SESSION) }
    },
    /** Whether the master switch is on for this Session. */
    enabled(sessionId) {
      return store.session(sessionId).grice
    },
    /** Set the master switch; an empty Session id cannot be stored. */
    setGrice(sessionId, enabled) {
      const id = requireSessionIdValue(sessionId)
      update((draft) => {
        const current = draft.sessions[id] ?? { ...EMPTY_SESSION }
        draft.sessions[id] = { ...current, grice: enabled === true }
      })
      return store.session(id)
    },
    /** Set one preset slot; `null` clears it. Selecting a preset also enables the master switch. */
    setPreset(sessionId, kind, presetId) {
      const id = requireSessionIdValue(sessionId)
      if (!KINDS.includes(kind)) throw new HttpError(400, 'invalid', 'kind must be tone or output')
      const value = presetId === undefined || presetId === null ? null : String(presetId)
      update((draft) => {
        const current = draft.sessions[id] ?? { ...EMPTY_SESSION }
        const next = { ...current, grice: true }
        if (kind === 'tone') next.tone = value
        else next.output = value
        draft.sessions[id] = next
      })
      return store.session(id)
    },
    /** Flip the master switch and return the new per-Session state. */
    toggle(sessionId) {
      const id = requireSessionIdValue(sessionId)
      const next = !store.enabled(id)
      return store.setGrice(id, next)
    },
    /** Record this process's activation, so the plugin's liveness is observable. */
    markActivated() {
      return update((draft) => {
        draft.activatedAt = new Date().toISOString()
        draft.activatedPid = process.pid
      })
    },
    /** Record that a browser page mounted the switch; the client half's liveness beacon. */
    noteClient(sessionId, version) {
      update((draft) => {
        draft.lastClientSeen = {
          at: new Date().toISOString(),
          sessionId: typeof sessionId === 'string' ? sessionId : null,
          version: typeof version === 'string' ? version : null,
        }
      })
    },
  }
  return store
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

function createPresetStore(ctx) {
  let cached
  let cachedStamp

  function load() {
    const file = presetsFile()
    const read = readJsonCached(file, ctx, 'preset library')
    if (!read.exists || read.broken) {
      const seeded = cloneDefaults()
      try {
        writeJson(file, seeded)
      } catch (error) {
        ctx?.logger?.warn?.('dsh-grice: preset library could not be seeded: %s', String((error && error.message) || error))
      }
      cached = seeded
      cachedStamp = undefined
      return cached
    }
    if (cached !== undefined && cachedStamp !== undefined && read.stat !== undefined
      && cachedStamp.mtimeMs === read.stat.mtimeMs && cachedStamp.size === read.stat.size) {
      return cached
    }
    cached = normalizePresets(read.raw)
    cachedStamp = read.stat === undefined ? undefined : { mtimeMs: read.stat.mtimeMs, size: read.stat.size }
    return cached
  }

  function save(library) {
    writeJson(presetsFile(), library)
    cached = library
    try {
      const stat = fs.statSync(presetsFile())
      cachedStamp = { mtimeMs: stat.mtimeMs, size: stat.size }
    } catch {
      cachedStamp = undefined
    }
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

  function ensurePinnedBounds(library) {
    for (const kind of KINDS) {
      let pinned = 0
      for (const preset of library[PRESET_KEY[kind]]) {
        if (!preset.pinned) continue
        pinned += 1
        if (pinned > MAX_PINNED_PER_KIND) preset.pinned = false
      }
    }
  }

  /** When pinning would exceed the cap, unpin the last pinned row (never the row being saved). */
  function makeRoomForPinned(library, kind, exceptId) {
    const key = PRESET_KEY[kind]
    const pinned = library[key].filter((preset) => preset.pinned && preset.id !== exceptId)
    if (pinned.length < MAX_PINNED_PER_KIND) return
    for (let index = library[key].length - 1; index >= 0; index -= 1) {
      const preset = library[key][index]
      if (preset.pinned && preset.id !== exceptId) {
        preset.pinned = false
        return
      }
    }
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

  // Seed or repair the library on activation, so a corrupt file is replaced
  // before the first prompt assembly or dropdown read.
  try {
    load()
  } catch (error) {
    ctx?.logger?.warn?.('dsh-grice: preset library could not be prepared: %s', String((error && error.message) || error))
  }

  return {
    list,
    find,
    /** Create or replace one preset; returns the saved list. */
    upsert(kind, input) {
      if (!KINDS.includes(kind)) throw new HttpError(400, 'invalid', 'kind must be tone or output')
      const key = PRESET_KEY[kind]
      const name = typeof input.name === 'string' ? input.name.trim() : ''
      if (name === '' || name.length > MAX_PRESET_NAME_LENGTH) {
        throw new HttpError(400, 'invalid', `name must be 1-${MAX_PRESET_NAME_LENGTH} characters`)
      }
      if (typeof input.prompt !== 'string') throw new HttpError(400, 'invalid', 'prompt must be a string')
      if (input.prompt.length > MAX_PRESET_PROMPT_LENGTH) {
        throw new HttpError(400, 'invalid', `prompt must be at most ${MAX_PRESET_PROMPT_LENGTH} characters`)
      }
      const library = normalizePresets(load())
      const wantedId = typeof input.id === 'string' ? input.id.trim() : ''
      const existing = wantedId === '' ? undefined : library[key].find((preset) => preset.id === wantedId)
      if (existing !== undefined) {
        existing.name = name
        existing.prompt = input.prompt
        if (typeof input.pinned === 'boolean') {
          existing.pinned = input.pinned
          if (input.pinned) makeRoomForPinned(library, kind, existing.id)
        }
      } else {
        if (library[key].length >= MAX_PRESETS_PER_KIND) {
          throw new HttpError(400, 'full', `at most ${MAX_PRESETS_PER_KIND} presets per kind`)
        }
        if (input.pinned === true) makeRoomForPinned(library, kind, null)
        library[key].push({
          id: wantedId === '' ? makeId(library, kind, name) : wantedId,
          name,
          prompt: input.prompt,
          pinned: input.pinned === true,
          builtin: false,
        })
      }
      ensurePinnedBounds(library)
      save(library)
      return { list: list(), saved: existing ?? library[key][library[key].length - 1] }
    },
    /** Delete one preset; returns the saved list. */
    remove(kind, id) {
      if (!KINDS.includes(kind)) throw new HttpError(400, 'invalid', 'kind must be tone or output')
      const key = PRESET_KEY[kind]
      const library = normalizePresets(load())
      const next = library[key].filter((preset) => preset.id !== id)
      if (next.length === library[key].length) throw new HttpError(404, 'not-found', 'preset does not exist')
      library[key] = next
      save(library)
      return { list: list() }
    },
    /** Restore one kind, or the whole library, to the shipped defaults. */
    reset(kind) {
      if (kind !== undefined && kind !== null && !KINDS.includes(kind)) {
        throw new HttpError(400, 'invalid', 'kind must be tone or output')
      }
      const library = normalizePresets(load())
      const defaults = cloneDefaults()
      if (kind === 'tone') library.tones = defaults.tones
      else if (kind === 'output') library.outputs = defaults.outputs
      else {
        library.tones = defaults.tones
        library.outputs = defaults.outputs
      }
      save(library)
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
      if (session === undefined || !session.grice) return ''
      if (session.tone !== null && session.tone !== 'grice') return ''
      return POLICY_TEXT
    },
  }))
  fiber.effect(() => sp.section({
    name: SECTION_TONE,
    order: ORDER_TONE,
    text: (assembly) => {
      const session = sessionState(assembly)
      if (session === undefined || !session.grice || session.tone === null || session.tone === 'grice') return ''
      const preset = presets.find('tone', session.tone)
      return preset === undefined ? '' : preset.prompt
    },
  }))
  fiber.effect(() => sp.section({
    name: SECTION_OUTPUT,
    order: ORDER_OUTPUT,
    text: (assembly) => {
      const session = sessionState(assembly)
      if (session === undefined || !session.grice || session.output === null) return ''
      const preset = presets.find('output', session.output)
      return preset === undefined ? '' : preset.prompt
    },
  }))
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

function requireSessionId(body) {
  return requireSessionIdValue(body.sessionId)
}

function requireKind(body) {
  const kind = typeof body.kind === 'string' ? body.kind : ''
  if (!KINDS.includes(kind)) throw new HttpError(400, 'invalid', 'kind must be tone or output')
  return kind
}

function routeHandler(run) {
  return async (req, res) => {
    if (!guard(req, res)) return
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, code: 'method', error: 'POST only' })
      return
    }
    try {
      const body = await readJsonBody(req)
      sendJson(res, 200, { ok: true, ...await run(body) })
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const code = error instanceof HttpError ? error.code : 'internal'
      sendJson(res, status, { ok: false, code, error: String((error && error.message) || error) })
    }
  }
}

function sessionPayload(store, sessionId) {
  const session = store.session(sessionId)
  return {
    sessionId,
    enabled: session.grice,
    tone: session.tone,
    output: session.output,
    version: VERSION,
  }
}

/**
 * Publish the browser-facing switch surface: session state, master switch,
 * preset selection, and the preset library (read + settings writes).
 * @param webServer - the Host web server.
 * @param fiber - the owning injected context.
 * @param store - the session switch store.
 * @param presets - the preset library.
 */
function registerRoutes(webServer, fiber, store, presets) {
  fiber.effect(() => webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/state`,
    handler: routeHandler(async (body) => {
      const sessionId = requireSessionId(body)
      if (body.hello === true) store.noteClient(sessionId, body.version)
      return sessionPayload(store, sessionId)
    }),
  }))
  fiber.effect(() => webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/toggle`,
    handler: routeHandler(async (body) => {
      const sessionId = requireSessionId(body)
      store.toggle(sessionId)
      return sessionPayload(store, sessionId)
    }),
  }))
  fiber.effect(() => webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/set`,
    handler: routeHandler(async (body) => {
      const sessionId = requireSessionId(body)
      if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'invalid', 'enabled must be a boolean')
      store.setGrice(sessionId, body.enabled)
      return sessionPayload(store, sessionId)
    }),
  }))
  fiber.effect(() => webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/select`,
    handler: routeHandler(async (body) => {
      const sessionId = requireSessionId(body)
      const kind = requireKind(body)
      const id = body.id === undefined || body.id === null ? null : String(body.id)
      if (id !== null && presets.find(kind, id) === undefined) {
        throw new HttpError(404, 'not-found', `no ${kind} preset "${id}"`)
      }
      store.setPreset(sessionId, kind, id)
      return sessionPayload(store, sessionId)
    }),
  }))
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
    path: `${ROUTE_PREFIX}/presets/reset`,
    handler: routeHandler(async (body) => {
      const kind = body.kind === undefined || body.kind === null ? undefined : requireKind(body)
      return { ...presets.reset(kind) }
    }),
  }))
}

// --- `/grice` command --------------------------------------------------------

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
    name: 'grice',
    description: '开关格赖斯模式，或查看/设置当前会话的沟通基调与产出形态',
    input: { hint: '[on|off|tone <id>|output <id>]' },
    handler: ({ agent, rawInput }) => {
      const session = agent !== null && typeof agent === 'object' ? agent.session : undefined
      const sessionId = session !== null && typeof session === 'object' && session.id !== undefined ? String(session.id) : ''
      if (sessionId === '') return { kind: 'error', text: '当前会话不可用，无法切换格赖斯模式。' }
      const argument = String(rawInput === undefined ? '' : rawInput).trim()
      const [verb, ...rest] = argument.split(/\s+/)
      if (argument === '' || verb === 'status') {
        const current = store.session(sessionId)
        return {
          kind: 'success',
          text: `格赖斯模式：${current.grice ? '已开启' : '已关闭'}；基调：${presetName(presets, 'tone', current.tone ?? 'grice')}；产出：${presetName(presets, 'output', current.output)}`,
        }
      }
      if (verb === 'on' || verb === '开') {
        store.setGrice(sessionId, true)
        return { kind: 'success', text: '格赖斯模式已开启。' }
      }
      if (verb === 'off' || verb === '关') {
        store.setGrice(sessionId, false)
        return { kind: 'success', text: '格赖斯模式已关闭。' }
      }
      if (verb === 'tone' || verb === 'output') {
        const kind = verb
        const id = (rest[0] ?? '').trim()
        if (id === '' || id === 'default' || id === 'none') {
          store.setPreset(sessionId, kind, null)
          return { kind: 'success', text: `${kind === 'tone' ? '基调' : '产出'}已恢复默认。` }
        }
        if (presets.find(kind, id) === undefined) return { kind: 'error', text: `没有 ${kind} 预设「${id}」。` }
        store.setPreset(sessionId, kind, id)
        return { kind: 'success', text: `${kind === 'tone' ? '基调' : '产出'}已设为「${presetName(presets, kind, id)}」，格赖斯模式已开启。` }
      }
      return { kind: 'error', text: '用法：/grice [on|off|tone <id>|output <id>]' }
    },
  }))
}

// --- plugin ------------------------------------------------------------------

/**
 * Wire the switch and both preset slots: prompt sections, HTTP routes, and the
 * command, each only where the corresponding service is composed.
 * @param ctx - host context.
 */
export function apply(ctx) {
  const store = createStore(ctx)
  const presets = createPresetStore(ctx)
  try {
    store.markActivated()
  } catch (error) {
    ctx.logger?.warn?.('dsh-grice: activation marker could not be written: %s', String((error && error.message) || error))
  }

  ctx.inject(['systemPrompt'], (sub) => registerPrompt(sub.systemPrompt, sub, store, presets))
  ctx.inject(['webServer'], (sub) => registerRoutes(sub.webServer, sub, store, presets))
  ctx.inject(['commands'], (sub) => registerCommand(sub.commands, sub, store, presets))
}
