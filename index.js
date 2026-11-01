// dsh-grice - host half.
//
// One per-session switch, owned by the Host, plus the guidance that the switch
// turns on. Three pieces:
//
//   * the durable switch state in `<DSH_HOME>/grice/state.json` (one entry per
//     Session that has the mode on; a Session is on exactly while its entry
//     exists);
//   * the `grice:policy` system-prompt section, whose text provider reads the
//     switch for the Session of the current assembly, so only an enabled
//     Session gets the guidance — including from its next step on when the
//     switch flips mid-turn;
//   * loopback-only HTTP routes the browser half uses to read and flip the
//     switch from the composer, and a `/grice` command with the same effect.
//
// The browser half never owns state: it renders what it reads and posts the
// flip, so renderer and model can never disagree. The plugin imports nothing
// from the DSH SDK; every service is resolved through the cordis context at
// call time.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = 'dsh-grice'

/** Plugin version, also recorded by the browser half's mount beacon. */
const VERSION = '0.1.0'
/** HTTP route prefix owned by this plugin. */
const ROUTE_PREFIX = '/dsh-grice'
/** System-prompt section name and placement. */
const SECTION_NAME = 'grice:policy'
const SECTION_ORDER = 650
/** Durable state file format. */
const STATE_VERSION = 1
/** Upper bound of tracked Sessions; the oldest entries leave first. */
const MAX_TRACKED_SESSIONS = 200
/** Longest Session id this plugin stores. */
const MAX_SESSION_ID_LENGTH = 200

/**
 * The guidance an enabled Session receives. Written from the model's
 * perspective: quantities, evidence, relevance, and manner of the answer.
 */
export const POLICY_TEXT = [
  '用户已开启「格赖斯模式」：请严格遵守格赖斯（H. P. Grice）合作原则及其四条准则，用最高的信息效率完成沟通，直到用户关闭该模式。',
  '- 数量准则（Quantity）：只给恰好充分的信息。不堆砌背景、不复述用户已经说过的内容、不重复自己刚说过的结论；用户没问的不主动展开。',
  '- 质量准则（Quality）：只陈述有依据的内容。不确定时明确说明不确定及原因；绝不编造事实、数据、代码行为、文件路径或引用。',
  '- 关系准则（Relation）：每一句都直接服务于当前问题或当前步骤；不跑题，不插入无关建议、自我评价或能力说明。',
  '- 方式准则（Manner）：先给结论或结果，再给必要依据；表达简洁、清楚、有序，避免歧义、行话堆砌和空话。',
  '输出约定：除非用户明确要求，不写开场寒暄、过程旁白、免责声明和总结性复述；需要展开时也只展开必要部分；代码、命令、路径、数字保持精确。',
].join('\n')

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

/** A request the browser half made, rejected with its own status and code. */
class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

// --- durable state -----------------------------------------------------------

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
      if (value !== true) continue
      if (typeof key !== 'string' || key === '' || key.length > MAX_SESSION_ID_LENGTH) continue
      state.sessions[key] = true
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
 * an mtime/size cache so a provider evaluated on every prompt assembly does not
 * re-read the disk, and written atomically so a crash cannot truncate it.
 * @param ctx - host context, for diagnostics only.
 * @returns the store read and write surface.
 */
export function createStore(ctx) {
  let cached
  let cachedStamp

  function load() {
    const file = stateFile()
    let stat
    try {
      stat = fs.statSync(file)
    } catch {
      stat = undefined
    }
    if (stat !== undefined && cached !== undefined && cachedStamp !== undefined
      && cachedStamp.mtimeMs === stat.mtimeMs && cachedStamp.size === stat.size) {
      return cached
    }
    let raw
    if (stat !== undefined) {
      try {
        raw = JSON.parse(fs.readFileSync(file, 'utf8'))
      } catch (error) {
        ctx?.logger?.warn?.('dsh-grice: ignored unreadable state file: %s', String((error && error.message) || error))
        raw = undefined
      }
    }
    cached = normalizeState(raw)
    cachedStamp = stat === undefined ? undefined : { mtimeMs: stat.mtimeMs, size: stat.size }
    return cached
  }

  function save(next) {
    const file = stateFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    fs.renameSync(temporary, file)
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
    const draft = { ...current, sessions: { ...current.sessions } }
    mutate(draft)
    pruneSessions(draft)
    draft.updatedAt = new Date().toISOString()
    save(draft)
    return draft
  }

  return {
    /** Whether one Session has the mode on. */
    enabled(sessionId) {
      if (typeof sessionId !== 'string') return false
      return load().sessions[sessionId] === true
    },
    /** Set one Session's switch; an empty session id cannot be stored. */
    set(sessionId, enabled) {
      const id = String(sessionId).trim()
      if (id === '' || id.length > MAX_SESSION_ID_LENGTH) {
        throw new HttpError(400, 'invalid', 'sessionId is invalid')
      }
      update((draft) => {
        if (enabled) draft.sessions[id] = true
        else delete draft.sessions[id]
      })
      return enabled
    },
    /** Flip one Session's switch and return the new value. */
    toggle(sessionId) {
      const next = !this.enabled(sessionId)
      this.set(sessionId, next)
      return next
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
    /** The policy text contributed while the mode is on. */
    policy() {
      return POLICY_TEXT
    },
  }
}

// --- prompt section ----------------------------------------------------------

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
 * Register the conditional guidance section. Its provider runs at every
 * assembly, so a flipped switch reaches the very next step of the same turn.
 * @param sp - the system-prompt service.
 * @param fiber - the owning injected context.
 * @param store - the switch store.
 */
function registerPrompt(sp, fiber, store) {
  fiber.effect(() => sp.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: (assembly) => {
      const sessionId = sessionIdOfAssembly(assembly)
      return sessionId !== undefined && store.enabled(sessionId) ? store.policy() : ''
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
  const value = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  if (value === '' || value.length > MAX_SESSION_ID_LENGTH) {
    throw new HttpError(400, 'invalid', 'sessionId required')
  }
  return value
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

/**
 * Publish the three browser halves of the switch. `/state` is the polled read
 * (and the first call carries `hello: true`, the client liveness beacon),
 * `/toggle` flips, and `/set` is the idempotent form for scripts and commands.
 * @param webServer - the Host web server.
 * @param fiber - the owning injected context.
 * @param store - the switch store.
 */
function registerRoutes(webServer, fiber, store) {
  fiber.effect(() => webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/state`,
    handler: routeHandler(async (body) => {
      const sessionId = requireSessionId(body)
      if (body.hello === true) store.noteClient(sessionId, body.version)
      return { sessionId, enabled: store.enabled(sessionId) }
    }),
  }))
  fiber.effect(() => webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/toggle`,
    handler: routeHandler(async (body) => {
      const sessionId = requireSessionId(body)
      return { sessionId, enabled: store.toggle(sessionId) }
    }),
  }))
  fiber.effect(() => webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/set`,
    handler: routeHandler(async (body) => {
      const sessionId = requireSessionId(body)
      if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'invalid', 'enabled must be a boolean')
      store.set(sessionId, body.enabled)
      return { sessionId, enabled: body.enabled }
    }),
  }))
}

// --- `/grice` command --------------------------------------------------------

/**
 * Register the slash command with the same authority as the composer chip, so
 * the switch also works from a keyboard-driven session.
 * @param commands - the command registry service.
 * @param fiber - the owning injected context.
 * @param store - the switch store.
 */
function registerCommand(commands, fiber, store) {
  fiber.effect(() => commands.register({
    name: 'grice',
    description: '开启或关闭格赖斯模式：开启后助手严格遵守格赖斯语用准则进行高效沟通',
    input: { hint: '[on|off]' },
    handler: ({ agent, rawInput }) => {
      const session = agent !== null && typeof agent === 'object' ? agent.session : undefined
      const sessionId = session !== null && typeof session === 'object' && session.id !== undefined ? String(session.id) : ''
      if (sessionId === '') return { kind: 'error', text: '当前会话不可用，无法切换格赖斯模式。' }
      const argument = String(rawInput === undefined ? '' : rawInput).trim().toLowerCase()
      if (argument === '' || argument === 'status') {
        const enabled = store.enabled(sessionId)
        return { kind: 'success', text: enabled ? '格赖斯模式：已开启。' : '格赖斯模式：已关闭。' }
      }
      if (argument === 'on' || argument === '开') {
        store.set(sessionId, true)
        return { kind: 'success', text: '格赖斯模式已开启：之后的回复会严格遵守格赖斯语用准则。' }
      }
      if (argument === 'off' || argument === '关') {
        store.set(sessionId, false)
        return { kind: 'success', text: '格赖斯模式已关闭。' }
      }
      return { kind: 'error', text: '用法：/grice [on|off]' }
    },
  }))
}

// --- plugin ------------------------------------------------------------------

/**
 * Wire the switch: prompt section, HTTP routes, and the command, each only
 * where the corresponding service is composed.
 * @param ctx - host context.
 */
export function apply(ctx) {
  const store = createStore(ctx)
  try {
    store.markActivated()
  } catch (error) {
    ctx.logger?.warn?.('dsh-grice: activation marker could not be written: %s', String((error && error.message) || error))
  }

  ctx.inject(['systemPrompt'], (sub) => registerPrompt(sub.systemPrompt, sub, store))
  ctx.inject(['webServer'], (sub) => registerRoutes(sub.webServer, sub, store))
  ctx.inject(['commands'], (sub) => registerCommand(sub.commands, sub, store))
}
