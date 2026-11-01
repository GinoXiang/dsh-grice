// Behaviour tests for the dsh-grice host half. No dependencies: a fake cordis
// context captures the registrations, and a fake HTTP request/response pair
// exercises the loopback route surface exactly as the browser half does.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { apply, POLICY_TEXT, stateFile } from '../index.js'

const TEST_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp', 'grice-tests')

/** Run one test against a fresh DSH home so state can never leak across tests. */
async function withHome(name, body) {
  const home = path.join(TEST_ROOT, `${name}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  fs.mkdirSync(home, { recursive: true })
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return await body(home)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    fs.rmSync(home, { recursive: true, force: true })
  }
}

function createServices() {
  const sections = []
  const routes = new Map()
  const commandDefinitions = []
  return {
    sections,
    routes,
    commandDefinitions,
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => {
          const index = sections.indexOf(section)
          if (index !== -1) sections.splice(index, 1)
        }
      },
    },
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
    commands: {
      register(definition) {
        commandDefinitions.push(definition)
        return () => {
          const index = commandDefinitions.indexOf(definition)
          if (index !== -1) commandDefinitions.splice(index, 1)
        }
      },
    },
  }
}

function createCtx(services) {
  return {
    logger: { warn() {}, info() {}, debug() {} },
    effects: [],
    effect(factory) {
      const disposer = factory()
      if (typeof disposer === 'function') this.effects.push(disposer)
      return disposer
    },
    inject(dependencies, callback) {
      for (const dependency of dependencies) this[dependency] = services[dependency]
      callback(this)
    },
    get(name) {
      return services[name]
    },
    dispose() {
      while (this.effects.length > 0) this.effects.pop()()
    },
  }
}

/** One fake POST request; overrides may replace method, socket, headers, or body. */
class FakeRequest extends EventEmitter {
  constructor(body, overrides = {}) {
    super()
    this.method = 'POST'
    this.socket = { remoteAddress: '127.0.0.1' }
    this.headers = {
      host: '127.0.0.1:60612',
      origin: 'http://127.0.0.1:60612',
      'content-type': 'application/json',
    }
    this.bodyText = body === undefined ? '' : JSON.stringify(body)
    Object.assign(this, overrides)
  }
}

/** Invoke one captured route and resolve with the parsed JSON reply. */
function callRoute(route, body, overrides) {
  return new Promise((resolve, reject) => {
    const request = new FakeRequest(body, overrides)
    const response = {
      status: 0,
      writeHead(status) {
        this.status = status
      },
      end(text) {
        let parsed
        try {
          parsed = JSON.parse(text)
        } catch (error) {
          reject(error)
          return
        }
        resolve({ status: this.status, body: parsed })
      },
    }
    Promise.resolve(route.handler(request, response)).catch(reject)
    if (typeof request.bodyText === 'string' && request.bodyText !== '') {
      request.emit('data', Buffer.from(request.bodyText))
    }
    request.emit('end')
  })
}

function readState() {
  return JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
}

function policySection(services) {
  return services.sections.find((section) => section.name === 'grice:policy')
}

test('activation registers the conditional section, routes, command, and a marker', async () => {
  await withHome('activation', () => {
    const services = createServices()
    const ctx = createCtx(services)
    apply(ctx)

    const marker = readState()
    assert.equal(typeof marker.activatedAt, 'string')
    assert.equal(marker.activatedPid, process.pid)
    assert.deepEqual(marker.sessions, {})

    const section = policySection(services)
    assert.ok(section, 'grice:policy section is registered')
    assert.equal(section.order, 650)
    assert.equal(section.text({ agent: { session: { id: 'session-off' } } }), '')
    assert.equal(section.text({}), '')

    assert.deepEqual([...services.routes.keys()].sort(), [
      '/dsh-grice/set',
      '/dsh-grice/state',
      '/dsh-grice/toggle',
    ])
    assert.equal(services.commandDefinitions.length, 1)
    assert.equal(services.commandDefinitions[0].name, 'grice')

    ctx.dispose()
    assert.equal(services.sections.length, 0)
    assert.equal(services.routes.size, 0)
    assert.equal(services.commandDefinitions.length, 0)
  })
})

test('toggle flips exactly one session, persists it, and drives the prompt section', async () => {
  await withHome('toggle', async () => {
    const services = createServices()
    const ctx = createCtx(services)
    apply(ctx)
    const section = policySection(services)

    const initial = await callRoute(services.routes.get('/dsh-grice/state'), { sessionId: 'session-a' })
    assert.deepEqual(initial, { status: 200, body: { ok: true, sessionId: 'session-a', enabled: false } })

    const on = await callRoute(services.routes.get('/dsh-grice/toggle'), { sessionId: 'session-a' })
    assert.equal(on.body.enabled, true)
    assert.equal(readState().sessions['session-a'], true)
    assert.equal(section.text({ agent: { session: { id: 'session-a' } } }), POLICY_TEXT)
    assert.equal(section.text({ agent: { session: { id: 'session-b' } } }), '')

    const other = await callRoute(services.routes.get('/dsh-grice/state'), { sessionId: 'session-b' })
    assert.equal(other.body.enabled, false)

    const off = await callRoute(services.routes.get('/dsh-grice/toggle'), { sessionId: 'session-a' })
    assert.equal(off.body.enabled, false)
    assert.equal(readState().sessions['session-a'], undefined)
    assert.equal(section.text({ agent: { session: { id: 'session-a' } } }), '')

    // The idempotent form used by scripts and tests.
    const set = await callRoute(services.routes.get('/dsh-grice/set'), { sessionId: 'session-c', enabled: true })
    assert.deepEqual(set.body, { ok: true, sessionId: 'session-c', enabled: true })
    assert.equal(readState().sessions['session-c'], true)
    ctx.dispose()
  })
})

test('the hello beacon records that the browser half rendered', async () => {
  await withHome('hello', async () => {
    const services = createServices()
    apply(createCtx(services))
    const reply = await callRoute(services.routes.get('/dsh-grice/state'), { sessionId: 'session-h', hello: true, version: '0.1.0' })
    assert.equal(reply.body.enabled, false)
    const state = readState()
    assert.equal(state.lastClientSeen.sessionId, 'session-h')
    assert.equal(state.lastClientSeen.version, '0.1.0')
    assert.equal(typeof state.lastClientSeen.at, 'string')
  })
})

test('the routes reject non-POST, non-loopback, cross-origin, and malformed input', async () => {
  await withHome('guards', async () => {
    const services = createServices()
    apply(createCtx(services))
    const route = services.routes.get('/dsh-grice/toggle')

    const wrongMethod = await callRoute(route, { sessionId: 'x' }, { method: 'GET' })
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.body.code, 'method')

    const remote = await callRoute(route, { sessionId: 'x' }, { socket: { remoteAddress: '10.0.0.2' } })
    assert.equal(remote.status, 403)
    assert.equal(remote.body.code, 'forbidden')

    const badHost = await callRoute(route, { sessionId: 'x' }, { headers: { host: 'evil.example', origin: 'http://evil.example' } })
    assert.equal(badHost.status, 403)

    const crossOrigin = await callRoute(route, { sessionId: 'x' }, { headers: { host: '127.0.0.1:60612', origin: 'http://evil.example' } })
    assert.equal(crossOrigin.status, 403)
    assert.equal(crossOrigin.body.code, 'forbidden')

    const missing = await callRoute(route, {})
    assert.equal(missing.status, 400)
    assert.equal(missing.body.code, 'invalid')

    const badSession = await callRoute(route, { sessionId: 'x'.repeat(300) })
    assert.equal(badSession.status, 400)

    const badJson = await callRoute(route, undefined, { bodyText: '{not json' })
    assert.equal(badJson.status, 400)
    assert.equal(badJson.body.code, 'invalid')

    const badSet = await callRoute(services.routes.get('/dsh-grice/set'), { sessionId: 'x', enabled: 'yes' })
    assert.equal(badSet.status, 400)
  })
})

test('the /grice command reports and flips the same per-session switch', async () => {
  await withHome('command', async () => {
    const services = createServices()
    const ctx = createCtx(services)
    apply(ctx)
    const command = services.commandDefinitions[0]
    const section = policySection(services)
    const invoke = (rawInput) => command.handler({ agent: { session: { id: 'session-cmd' } }, rawInput })

    assert.equal(invoke('').text, '格赖斯模式：已关闭。')
    const on = invoke(' on')
    assert.equal(on.kind, 'success')
    assert.equal(readState().sessions['session-cmd'], true)
    assert.equal(section.text({ agent: { session: { id: 'session-cmd' } } }), POLICY_TEXT)
    assert.equal(invoke('status').text, '格赖斯模式：已开启。')
    const off = invoke(' off')
    assert.equal(off.kind, 'success')
    assert.equal(readState().sessions['session-cmd'], undefined)
    assert.equal(invoke('bogus').kind, 'error')
    ctx.dispose()
  })
})

test('state survives a fresh plugin instance (page reload / host restart)', async () => {
  await withHome('persist', async () => {
    const first = createServices()
    apply(createCtx(first))
    await callRoute(first.routes.get('/dsh-grice/toggle'), { sessionId: 'session-p' })
    assert.equal(readState().sessions['session-p'], true)

    const second = createServices()
    const ctx = createCtx(second)
    apply(ctx)
    const section = policySection(second)
    assert.equal(section.text({ agent: { session: { id: 'session-p' } } }), POLICY_TEXT)
    ctx.dispose()
  })
})

test('an unreadable state file degrades to the default state', async () => {
  await withHome('corrupt', () => {
    const file = stateFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{broken', 'utf8')
    const services = createServices()
    const ctx = createCtx(services)
    assert.doesNotThrow(() => apply(ctx))
    // The activation write replaces the corrupt file with valid JSON.
    const state = readState()
    assert.equal(state.version, 1)
    assert.deepEqual(state.sessions, {})
    ctx.dispose()
  })
})
