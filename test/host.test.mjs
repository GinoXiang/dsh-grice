// Behaviour tests for the dsh-grice host half. No dependencies: a fake cordis
// context captures the registrations, and a fake HTTP request/response pair
// exercises the loopback route surface exactly as the browser half does.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { apply, POLICY_TEXT, stateFile, presetsFile } from '../index.js'

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

function readPresets() {
  return JSON.parse(fs.readFileSync(presetsFile(), 'utf8'))
}

function section(services, name) {
  return services.sections.find((entry) => entry.name === name)
}

function assemblySession(id) {
  return { agent: { session: { id } } }
}

const ALL_SECTIONS = ['grice:policy', 'grice:tone', 'grice:output']

test('activation registers three prompt sections, ten routes, the command, and seeds presets', async () => {
  await withHome('activation', () => {
    const services = createServices()
    const ctx = createCtx(services)
    apply(ctx)

    const marker = readState()
    assert.equal(typeof marker.activatedAt, 'string')
    assert.equal(marker.activatedPid, process.pid)
    assert.deepEqual(marker.sessions, {})

    for (const name of ALL_SECTIONS) assert.ok(section(services, name), `${name} section is registered`)
    assert.equal(section(services, 'grice:policy').order, 650)
    assert.equal(section(services, 'grice:output').order, 660)

    const library = readPresets()
    assert.ok(library.tones.length >= 5)
    assert.ok(library.outputs.length >= 5)
    assert.equal(library.tones.find((preset) => preset.id === 'grice').prompt, POLICY_TEXT)
    assert.equal(library.tones.find((preset) => preset.id === 'grice').pinned, true)

    assert.deepEqual([...services.routes.keys()].sort(), [
      '/dsh-grice/presets',
      '/dsh-grice/presets/delete',
      '/dsh-grice/presets/reset',
      '/dsh-grice/presets/save',
      '/dsh-grice/select',
      '/dsh-grice/set',
      '/dsh-grice/set-output',
      '/dsh-grice/state',
      '/dsh-grice/toggle',
      '/dsh-grice/toggle-output',
    ])
    assert.equal(services.commandDefinitions.length, 1)
    assert.equal(services.commandDefinitions[0].name, 'grice')

    ctx.dispose()
    assert.equal(services.sections.length, 0)
    assert.equal(services.routes.size, 0)
    assert.equal(services.commandDefinitions.length, 0)
  })
})

test('the master switch drives the Grice policy section and survives a restart', async () => {
  await withHome('policy', async () => {
    const services = createServices()
    const ctx = createCtx(services)
    apply(ctx)
    const policy = section(services, 'grice:policy')

    assert.equal(policy.text(assemblySession('session-a')), '')
    const on = await callRoute(services.routes.get('/dsh-grice/toggle'), { sessionId: 'session-a' })
    assert.equal(on.body.enabled, true)
    assert.equal(on.body.outputEnabled, false)
    assert.equal(on.body.tone, null)
    assert.equal(on.body.output, null)
    assert.equal(policy.text(assemblySession('session-a')), POLICY_TEXT)
    assert.equal(policy.text(assemblySession('session-b')), '')
    assert.equal(readState().sessions['session-a'].grice, true)

    const off = await callRoute(services.routes.get('/dsh-grice/set'), { sessionId: 'session-a', enabled: false })
    assert.equal(off.body.enabled, false)
    assert.equal(policy.text(assemblySession('session-a')), '')
    ctx.dispose()

    const second = createServices()
    const secondCtx = createCtx(second)
    apply(secondCtx)
    assert.equal(section(second, 'grice:policy').text(assemblySession('session-a')), '')
    secondCtx.dispose()
  })
})

test('selecting a tone replaces the built-in policy and auto-enables the switch', async () => {
  await withHome('tone', async () => {
    const services = createServices()
    apply(createCtx(services))
    const policy = section(services, 'grice:policy')
    const tone = section(services, 'grice:tone')

    // No selection yet, switch off.
    await callRoute(services.routes.get('/dsh-grice/set'), { sessionId: 'session-t', enabled: false })
    assert.equal(tone.text(assemblySession('session-t')), '')

    const selected = await callRoute(services.routes.get('/dsh-grice/select'), { sessionId: 'session-t', kind: 'tone', id: 'coach' })
    assert.equal(selected.body.enabled, true)
    assert.equal(selected.body.tone, 'coach')
    assert.equal(policy.text(assemblySession('session-t')), '')
    assert.match(tone.text(assemblySession('session-t')), /教练式引导/)
    assert.equal(readState().sessions['session-t'].grice, true)

    // The built-in grice tone means the built-in policy.
    await callRoute(services.routes.get('/dsh-grice/select'), { sessionId: 'session-t', kind: 'tone', id: 'grice' })
    assert.equal(policy.text(assemblySession('session-t')), POLICY_TEXT)
    assert.equal(tone.text(assemblySession('session-t')), '')

    // Clearing falls back to the built-in policy while staying on.
    const cleared = await callRoute(services.routes.get('/dsh-grice/select'), { sessionId: 'session-t', kind: 'tone', id: null })
    assert.equal(cleared.body.tone, null)
    assert.equal(cleared.body.enabled, true)
    assert.equal(policy.text(assemblySession('session-t')), POLICY_TEXT)

    // Unknown ids are refused.
    const bad = await callRoute(services.routes.get('/dsh-grice/select'), { sessionId: 'session-t', kind: 'tone', id: 'nope' })
    assert.equal(bad.status, 404)
    const badKind = await callRoute(services.routes.get('/dsh-grice/select'), { sessionId: 'session-t', kind: 'music', id: 'grice' })
    assert.equal(badKind.status, 400)
  })
})

test('the output switch gates its section independently of the tone switch', async () => {
  await withHome('output', async () => {
    const services = createServices()
    apply(createCtx(services))
    const output = section(services, 'grice:output')
    const policy = section(services, 'grice:policy')

    // Selecting an output preset enables only the output switch.
    const selected = await callRoute(services.routes.get('/dsh-grice/select'), { sessionId: 'session-o', kind: 'output', id: 'code' })
    assert.equal(selected.body.output, 'code')
    assert.equal(selected.body.outputEnabled, true)
    assert.equal(selected.body.enabled, false)
    assert.match(output.text(assemblySession('session-o')), /代码实现/)
    assert.equal(policy.text(assemblySession('session-o')), '')

    // Turning the tone switch on adds the policy without touching the output.
    await callRoute(services.routes.get('/dsh-grice/set'), { sessionId: 'session-o', enabled: true })
    assert.equal(policy.text(assemblySession('session-o')), POLICY_TEXT)
    assert.match(output.text(assemblySession('session-o')), /代码实现/)

    // Turning the output switch off leaves the tone injection alone.
    const off = await callRoute(services.routes.get('/dsh-grice/toggle-output'), { sessionId: 'session-o' })
    assert.equal(off.body.outputEnabled, false)
    assert.equal(output.text(assemblySession('session-o')), '')
    assert.equal(policy.text(assemblySession('session-o')), POLICY_TEXT)

    const on = await callRoute(services.routes.get('/dsh-grice/toggle-output'), { sessionId: 'session-o' })
    assert.equal(on.body.outputEnabled, true)
    assert.match(output.text(assemblySession('session-o')), /代码实现/)

    // Clearing the preset stops the output text while the switch stays on.
    await callRoute(services.routes.get('/dsh-grice/select'), { sessionId: 'session-o', kind: 'output', id: null })
    assert.equal(output.text(assemblySession('session-o')), '')

    // Turning the tone switch off leaves the selected output preset alone.
    await callRoute(services.routes.get('/dsh-grice/set'), { sessionId: 'session-o', enabled: false })
    await callRoute(services.routes.get('/dsh-grice/select'), { sessionId: 'session-o', kind: 'output', id: 'doc' })
    assert.equal(policy.text(assemblySession('session-o')), '')
    assert.match(output.text(assemblySession('session-o')), /文档写作/)

    const badOutputSet = await callRoute(services.routes.get('/dsh-grice/set-output'), { sessionId: 'session-o', enabled: 'yes' })
    assert.equal(badOutputSet.status, 400)
  })
})

test('the preset library can be read, created, edited, deleted, and reset', async () => {
  await withHome('presets', async () => {
    const services = createServices()
    apply(createCtx(services))
    const presetsRoute = services.routes.get('/dsh-grice/presets')
    const saveRoute = services.routes.get('/dsh-grice/presets/save')
    const deleteRoute = services.routes.get('/dsh-grice/presets/delete')
    const resetRoute = services.routes.get('/dsh-grice/presets/reset')

    const initial = await callRoute(presetsRoute, {})
    assert.ok(initial.body.presets.tones.length >= 5)
    assert.ok(initial.body.presets.outputs.length >= 5)

    const created = await callRoute(saveRoute, {
      kind: 'output',
      preset: { name: '周报模板', prompt: '按「完成 / 进行中 / 风险 / 下周」四段写周报。', pinned: true },
    })
    assert.equal(created.status, 200)
    const saved = created.body.saved
    assert.equal(saved.name, '周报模板')
    assert.equal(saved.pinned, true)
    assert.equal(saved.builtin, false)

    const edited = await callRoute(saveRoute, {
      kind: 'output',
      preset: { id: saved.id, name: '周报模板 v2', prompt: '四段式周报。' },
    })
    assert.equal(edited.body.saved.name, '周报模板 v2')
    assert.equal(readPresets().outputs.filter((preset) => preset.id === saved.id).length, 1)

    const deleted = await callRoute(deleteRoute, { kind: 'output', id: saved.id })
    assert.equal(deleted.status, 200)
    assert.equal(deleted.body.list.outputs.some((preset) => preset.id === saved.id), false)

    const reset = await callRoute(resetRoute, { kind: 'output' })
    assert.equal(reset.status, 200)
    assert.equal(reset.body.list.outputs.length, initial.body.presets.outputs.length)
    assert.equal(reset.body.list.tones.length, initial.body.presets.tones.length)

    const invalid = await callRoute(saveRoute, { kind: 'tone', preset: { name: '', prompt: 'x' } })
    assert.equal(invalid.status, 400)
    const longPrompt = await callRoute(saveRoute, { kind: 'tone', preset: { name: 'x', prompt: 'a'.repeat(2001) } })
    assert.equal(longPrompt.status, 400)
    const missing = await callRoute(deleteRoute, { kind: 'tone', id: 'nope' })
    assert.equal(missing.status, 404)
  })
})

test('a selected preset that is deleted degrades to no injection', async () => {
  await withHome('deleted-preset', async () => {
    const services = createServices()
    apply(createCtx(services))
    const tone = section(services, 'grice:tone')
    await callRoute(services.routes.get('/dsh-grice/presets/save'), {
      kind: 'tone',
      preset: { name: '临时基调', prompt: '临时提示词', pinned: false },
    })
    const library = readPresets()
    const id = library.tones.find((preset) => preset.name === '临时基调').id
    await callRoute(services.routes.get('/dsh-grice/select'), { sessionId: 'session-d', kind: 'tone', id })
    assert.match(tone.text(assemblySession('session-d')), /临时提示词/)
    await callRoute(services.routes.get('/dsh-grice/presets/delete'), { kind: 'tone', id })
    assert.equal(tone.text(assemblySession('session-d')), '')
    assert.equal(section(services, 'grice:policy').text(assemblySession('session-d')), '')
  })
})

test('old state migrates to the current session shape', async () => {
  await withHome('migrate', () => {
    const file = stateFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      sessions: { 'session-old': true },
      activatedAt: '2026-10-01T00:00:00.000Z',
    }), 'utf8')
    const services = createServices()
    const ctx = createCtx(services)
    apply(ctx)
    const state = readState()
    assert.deepEqual(state.sessions['session-old'], { grice: true, tone: null, output: null, outputEnabled: false })
    assert.equal(section(services, 'grice:policy').text(assemblySession('session-old')), POLICY_TEXT)
    ctx.dispose()
  })
})

test('a v2 state keeps its selected output enabled when migrating', async () => {
  await withHome('migrate-v2', () => {
    const file = stateFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({
      version: 2,
      sessions: {
        'session-v2': { grice: true, tone: 'coach', output: 'code' },
      },
    }), 'utf8')
    const services = createServices()
    const ctx = createCtx(services)
    apply(ctx)
    const state = readState()
    assert.deepEqual(state.sessions['session-v2'], {
      grice: true,
      tone: 'coach',
      output: 'code',
      outputEnabled: true,
    })
    assert.match(section(services, 'grice:tone').text(assemblySession('session-v2')), /教练式引导/)
    assert.match(section(services, 'grice:output').text(assemblySession('session-v2')), /代码实现/)
    ctx.dispose()
  })
})

test('the hello beacon records that the browser half rendered', async () => {
  await withHome('hello', async () => {
    const services = createServices()
    apply(createCtx(services))
    const reply = await callRoute(services.routes.get('/dsh-grice/state'), {
      sessionId: 'session-h',
      hello: true,
      version: '0.2.0',
    })
    assert.equal(reply.body.enabled, false)
    const state = readState()
    assert.equal(state.lastClientSeen.sessionId, 'session-h')
    assert.equal(state.lastClientSeen.version, '0.2.0')
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

    const badHost = await callRoute(route, { sessionId: 'x' }, { headers: { host: 'evil.example', origin: 'http://evil.example' } })
    assert.equal(badHost.status, 403)

    const crossOrigin = await callRoute(route, { sessionId: 'x' }, { headers: { host: '127.0.0.1:60612', origin: 'http://evil.example' } })
    assert.equal(crossOrigin.status, 403)

    const missing = await callRoute(route, {})
    assert.equal(missing.status, 400)

    const badJson = await callRoute(route, undefined, { bodyText: '{not json' })
    assert.equal(badJson.status, 400)

    const badSet = await callRoute(services.routes.get('/dsh-grice/set'), { sessionId: 'x', enabled: 'yes' })
    assert.equal(badSet.status, 400)
  })
})

test('the /grice command reports and flips both switches and presets', async () => {
  await withHome('command', async () => {
    const services = createServices()
    const ctx = createCtx(services)
    apply(ctx)
    const command = services.commandDefinitions[0]
    const invoke = (rawInput) => command.handler({ agent: { session: { id: 'session-cmd' } }, rawInput })

    assert.match(invoke('').text, /基调开关：关/)
    assert.equal(invoke(' on').kind, 'success')
    assert.match(invoke('status').text, /基调开关：开/)
    assert.equal(readState().sessions['session-cmd'].grice, true)

    assert.equal(invoke(' tone coach').kind, 'success')
    assert.equal(readState().sessions['session-cmd'].tone, 'coach')
    assert.match(invoke('status').text, /教练引导/)

    assert.equal(invoke(' output code').kind, 'success')
    assert.equal(readState().sessions['session-cmd'].output, 'code')
    assert.equal(readState().sessions['session-cmd'].outputEnabled, true)
    assert.match(invoke('status').text, /代码实现/)

    assert.equal(invoke(' output off').kind, 'success')
    assert.equal(readState().sessions['session-cmd'].outputEnabled, false)
    assert.equal(invoke(' output on').kind, 'success')
    assert.equal(readState().sessions['session-cmd'].outputEnabled, true)

    assert.equal(invoke(' off').kind, 'success')
    assert.equal(readState().sessions['session-cmd'].grice, false)
    assert.equal(invoke(' tone nope').kind, 'error')
    assert.equal(invoke('bogus').kind, 'error')
    ctx.dispose()
  })
})

test('an unreadable state and preset file degrade to defaults', async () => {
  await withHome('corrupt', () => {
    const state = stateFile()
    fs.mkdirSync(path.dirname(state), { recursive: true })
    fs.writeFileSync(state, '{broken', 'utf8')
    fs.writeFileSync(presetsFile(), '{broken', 'utf8')
    const services = createServices()
    const ctx = createCtx(services)
    assert.doesNotThrow(() => apply(ctx))
    assert.equal(readState().version, 3)
    assert.deepEqual(readState().sessions, {})
    assert.ok(readPresets().tones.length >= 5)
    assert.ok(readPresets().outputs.length >= 5)
    ctx.dispose()
  })
})
