// Behaviour tests for the dsh-output-style host half. No dependencies: a fake
// cordis context captures the registrations, and an in-memory stand-in for the
// official storage-domain and session-projection services exercises the new
// state architecture exactly the way the Host composes it.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { apply, POLICY_TEXT, stateFile, presetsFile, presetsDir } from '../index.js'

const TEST_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp', 'style-tests')

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

/**
 * Compose the fake host services: prompt sections, the settings routes, the
 * command registry, plus in-memory `storageDomain` and `sessionProjections`
 * implementing the same contracts the real Host services expose.
 */
function createServices() {
  const sections = []
  const routes = new Map()
  const commandDefinitions = []
  const projections = []
  const domains = []

  const storageDomain = {
    async open(spec) {
      const tables = new Map()
      for (const name of Object.keys(spec.tables)) tables.set(name, new Map())
      const domain = {
        spec,
        tables,
        table(name) {
          const map = tables.get(name)
          if (map === undefined) throw new Error(`domain '${spec.name}' declares no table '${name}'`)
          return {
            get: (key) => map.get(key),
            async put(key, value) { map.set(key, JSON.parse(JSON.stringify(value))) },
            async delete(key) { map.delete(key) },
            entries: () => map.entries(),
            keys: () => map.keys(),
            get size() { return map.size },
          }
        },
        async close() {},
      }
      domains.push(domain)
      return domain
    },
  }

  const sessionProjections = {
    register(definition) {
      projections.push(definition)
      return () => {
        const index = projections.indexOf(definition)
        if (index !== -1) projections.splice(index, 1)
      }
    },
  }

  return {
    sections,
    routes,
    commandDefinitions,
    projections,
    domains,
    storageDomain,
    sessionProjections,
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
    fiber: { uid: 1 },
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

/** Boot the plugin against a fresh fake host. */
async function boot() {
  const services = createServices()
  const ctx = createCtx(services)
  await apply(ctx)
  return { services, ctx }
}

/** The `selection` table contents of the opened domain. */
function records(services) {
  const domain = services.domains[0]
  return domain === undefined ? new Map() : domain.tables.get('selection')
}

/** The one registered `/style` command definition. */
function commandDefinition(services) {
  const definition = services.commandDefinitions.find((entry) => entry.name === 'style')
  assert.ok(definition, 'the /style command is registered')
  return definition
}

/** Execute one `/style` line the way the command runtime does. */
function runCommand(services, sessionId, rawInput) {
  return commandDefinition(services).handler({ agent: { session: { id: sessionId } }, rawInput, commandId: 'command-1' })
}

/** The one registered session projection definition. */
function projectionDefinition(services) {
  const definition = services.projections[0]
  assert.ok(definition, 'the session projection is registered')
  return definition
}

/** The whole wire view for one session, built from the projection's own state. */
function projectionView(services, sessionId) {
  const definition = projectionDefinition(services)
  const state = definition.init({ id: sessionId }, 0)
  return definition.wire.view(state)
}

/** The prompt section text for one session and one section name. */
function sectionText(services, sectionName, sessionId) {
  const section = services.sections.find((entry) => entry.name === sectionName)
  assert.ok(section, `section ${sectionName} is registered`)
  return section.text({ agent: { session: { id: sessionId } } })
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

test('the host declares the storage domain and registers the projection and sections', async () => {
  await withHome('boot', async () => {
    const { services, ctx } = await boot()
    assert.equal(services.domains.length, 1)
    assert.equal(services.domains[0].spec.name, 'output_style_pair')
    assert.equal(services.domains[0].spec.version, 1)
    assert.deepEqual(Object.keys(services.domains[0].spec.tables), ['selection'])
    assert.equal(services.projections.length, 1)
    assert.equal(services.projections[0].key, 'outputStylePair')
    assert.equal(services.projections[0].stateVersion, 1)
    assert.deepEqual(services.sections.map((section) => section.name), ['style:policy', 'style:tone', 'style:output'])
    assert.deepEqual([...services.routes.keys()].sort(), [
      '/dsh-output-style/presets',
      '/dsh-output-style/presets/delete',
      '/dsh-output-style/presets/import',
      '/dsh-output-style/presets/reset',
      '/dsh-output-style/presets/save',
    ])
    ctx.dispose()
  })
})

test('the tone switch drives the built-in policy section and survives a restart', async () => {
  await withHome('tone-switch', async () => {
    const { services, ctx } = await boot()
    assert.equal(sectionText(services, 'style:policy', 'session-a'), '')

    const on = await runCommand(services, 'session-a', ' on')
    assert.equal(on.kind, 'success')
    assert.match(on.text, /基调开关已开启/)
    assert.equal(sectionText(services, 'style:policy', 'session-a'), POLICY_TEXT)
    assert.equal(sectionText(services, 'style:policy', 'session-b'), '')
    assert.equal(records(services).get('session-a').toneEnabled, true)
    assert.equal(projectionView(services, 'session-a').enabled, true)

    await runCommand(services, 'session-a', ' off')
    assert.equal(sectionText(services, 'style:policy', 'session-a'), '')
    assert.equal(records(services).has('session-a'), false, 'an all-off session leaves no domain record')
    ctx.dispose()

    // A second boot over the same DSH home reads the durable domain record.
    const second = await boot()
    const definition = projectionDefinition(second.services)
    const state = definition.init({ id: 'session-a' }, 0)
    assert.equal(definition.wire.view(state).enabled, false)
    second.ctx.dispose()
  })
})

test('selecting a tone replaces the policy and auto-enables only the tone switch', async () => {
  await withHome('tone-select', async () => {
    const { services, ctx } = await boot()
    const selected = await runCommand(services, 'session-a', ' tone coach')
    assert.equal(selected.kind, 'success')
    assert.match(selected.text, /教练引导/)
    const tone = sectionText(services, 'style:tone', 'session-a')
    assert.ok(tone.length > 0)
    assert.notEqual(tone, POLICY_TEXT)
    assert.equal(sectionText(services, 'style:policy', 'session-a'), '')
    assert.equal(sectionText(services, 'style:output', 'session-a'), '')
    assert.equal(records(services).get('session-a').tone, 'coach')
    assert.equal(records(services).get('session-a').outputEnabled, false)

    // An unknown preset is a command error and writes nothing.
    const rejected = await runCommand(services, 'session-a', ' tone nope')
    assert.equal(rejected.kind, 'error')
    assert.equal(records(services).get('session-a').tone, 'coach')
    ctx.dispose()
  })
})

test('the output switch gates its section independently of the tone switch', async () => {
  await withHome('output-switch', async () => {
    const { services, ctx } = await boot()
    const selected = await runCommand(services, 'session-o', ' output code')
    assert.match(selected.text, /代码实现/)
    assert.match(sectionText(services, 'style:output', 'session-o'), /代码/)
    assert.equal(sectionText(services, 'style:policy', 'session-o'), '')

    await runCommand(services, 'session-o', ' on')
    assert.equal(sectionText(services, 'style:policy', 'session-o'), POLICY_TEXT)
    assert.match(sectionText(services, 'style:output', 'session-o'), /代码/)

    await runCommand(services, 'session-o', ' output off')
    assert.equal(sectionText(services, 'style:output', 'session-o'), '')
    assert.equal(sectionText(services, 'style:policy', 'session-o'), POLICY_TEXT, 'tone injection is untouched')
    ctx.dispose()
  })
})

test('the projection folds command lifecycle events and serves the wire view', async () => {
  await withHome('projection', async () => {
    const { services, ctx } = await boot()
    const definition = projectionDefinition(services)
    const empty = definition.init({ id: 'session-p' }, 0)
    assert.equal(definition.apply(empty, { type: 'message/user', data: {} }), empty, 'foreign events are identity-stable')

    const parked = definition.apply(empty, {
      type: 'command/run',
      data: { name: 'style', args: ' tone coach', commandId: 'c1' },
    })
    assert.notEqual(parked, empty)
    assert.deepEqual(parked.pending, { commandId: 'c1' })

    await runCommand(services, 'session-p', ' tone coach')
    const settled = definition.apply(parked, { type: 'command/done', data: { commandId: 'c1', kind: 'success' } })
    assert.equal(settled.pending, null)

    const view = definition.wire.view(settled)
    definition.wire.viewSchema.parse(view)
    assert.equal(view.enabled, true)
    assert.equal(view.tone, 'coach')
    assert.equal(view.outputEnabled, false)
    assert.ok(Array.isArray(view.tones) && view.tones.length > 0)
    assert.ok(view.tones.some((tone) => tone.id === 'coach' && tone.name.includes('教练')))
    assert.ok(Array.isArray(view.outputs) && view.outputs.some((output) => output.id === 'code'))
    ctx.dispose()
  })
})

test('a pre-domain state.json is migrated once and then renamed', async () => {
  await withHome('legacy-state', async () => {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true })
    fs.writeFileSync(stateFile(), JSON.stringify({
      version: 3,
      sessions: {
        'session-old': { toneEnabled: true, tone: 'coach', output: 'code', outputEnabled: true },
      },
    }), 'utf8')
    const { services, ctx } = await boot()
    assert.deepEqual(records(services).get('session-old'), { toneEnabled: true, tone: 'coach', output: 'code', outputEnabled: true })
    assert.equal(fs.existsSync(stateFile()), false, 'the migrated file is renamed away')
    assert.equal(fs.existsSync(`${stateFile()}.migrated`), true)
    assert.equal(sectionText(services, 'style:tone', 'session-old').length > 0, true)
    ctx.dispose()
  })
})

test('pre-rename grice/ state files are migrated before the domain import', async () => {
  await withHome('legacy-dir', async () => {
    const legacy = path.join(process.env.DSH_HOME, 'grice')
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(path.join(legacy, 'state.json'), JSON.stringify({
      version: 3,
      sessions: { 'session-legacy': { toneEnabled: true, tone: null, output: null, outputEnabled: false } },
    }), 'utf8')
    fs.writeFileSync(path.join(legacy, 'presets.json'), JSON.stringify({
      version: 2,
      tones: [{ id: 'grice', name: '格赖斯·高效', prompt: POLICY_TEXT, pinned: true, builtin: true }],
      outputs: [{ id: 'code', name: '代码实现', prompt: 'legacy output', pinned: true, builtin: true }],
    }), 'utf8')
    const { services, ctx } = await boot()
    assert.equal(records(services).get('session-legacy').toneEnabled, true)
    assert.equal(fs.existsSync(path.join(legacy, 'state.json')), true, 'the old directory is left untouched')
    assert.equal(fs.existsSync(presetsFile()), false, 'the legacy JSON library is renamed away')
    const migrated = fs.readFileSync(path.join(presetsDir(), 'output', 'code.md'), 'utf8')
    assert.match(migrated, /legacy output/)
    ctx.dispose()
  })
})

test('markdown preset files are loaded, skipped when malformed, and served to the composer', async () => {
  await withHome('preset-files', async () => {
    const toneDir = path.join(presetsDir(), 'tone')
    fs.mkdirSync(toneDir, { recursive: true })
    fs.writeFileSync(path.join(toneDir, 'house-style.md'), [
      '---',
      'name: "House style"',
      'pinned: true',
      '---',
      '',
      '先给结论，再给依据。',
      '',
    ].join('\n'), 'utf8')
    fs.writeFileSync(path.join(toneDir, 'broken.md'), 'no frontmatter here', 'utf8')

    const { services, ctx } = await boot()
    const listed = await callRoute(services.routes.get('/dsh-output-style/presets'), {})
    const custom = listed.body.presets.tones.find((preset) => preset.id === 'house-style')
    assert.ok(custom, 'the markdown preset is served')
    assert.equal(custom.name, 'House style')
    assert.equal(custom.pinned, true)
    assert.equal(custom.prompt, '先给结论，再给依据。')
    assert.equal(listed.body.presets.tones.some((preset) => preset.id === 'broken'), false)
    assert.ok(listed.body.presets.tones.some((preset) => preset.id === 'grice' && preset.builtin === true))
    ctx.dispose()
  })
})

test('the import route writes JSON presets into the markdown library', async () => {
  await withHome('preset-import', async () => {
    const { services, ctx } = await boot()
    const route = services.routes.get('/dsh-output-style/presets/import')
    assert.ok(route, 'the import route is registered')

    const imported = await callRoute(route, {
      kind: 'tone',
      presets: [
        { id: 'imported-tone', name: '导入基调', prompt: '导入的提示词', pinned: true },
        { name: '无名 id', prompt: '自动生成 id' },
        { name: '', prompt: 'invalid' },
      ],
    })
    assert.equal(imported.status, 200)
    assert.equal(imported.body.imported, 2)
    assert.equal(imported.body.skipped.length, 1)
    assert.ok(fs.existsSync(path.join(presetsDir(), 'tone', 'imported-tone.md')))
    assert.ok(imported.body.list.tones.some((preset) => preset.id === 'imported-tone' && preset.name === '导入基调'))

    // A path-looking id is sanitized into a safe file stem.
    const sanitized = await callRoute(route, {
      kind: 'output',
      presets: [{ id: '../escape', name: '逃逸', prompt: 'x' }],
    })
    assert.equal(sanitized.status, 200)
    assert.equal(sanitized.body.imported, 1)
    assert.ok(fs.existsSync(path.join(presetsDir(), 'output', 'escape.md')))
    assert.equal(sanitized.body.list.outputs.some((preset) => preset.id === 'escape'), true)

    // Malformed payloads are rejected without writing.
    const empty = await callRoute(route, { kind: 'tone', presets: [] })
    assert.equal(empty.status, 400)
    ctx.dispose()
  })
})

test('the settings routes read and mutate the preset library', async () => {
  await withHome('presets', async () => {
    const { services, ctx } = await boot()
    const route = services.routes.get('/dsh-output-style/presets')
    const listed = await callRoute(route, {})
    assert.equal(listed.status, 200)
    assert.ok(Array.isArray(listed.body.presets.tones))
    assert.ok(Array.isArray(listed.body.presets.outputs))

    const saved = await callRoute(services.routes.get('/dsh-output-style/presets/save'), {
      kind: 'tone',
      preset: { id: 'custom', name: '自定义', prompt: '自定义提示词', pinned: true },
    })
    assert.equal(saved.status, 200)
    const afterSave = await callRoute(services.routes.get('/dsh-output-style/presets'), {})
    assert.ok(afterSave.body.presets.tones.some((preset) => preset.id === 'custom'))

    const removed = await callRoute(services.routes.get('/dsh-output-style/presets/delete'), { kind: 'tone', id: 'custom' })
    assert.equal(removed.status, 200)
    const afterDelete = await callRoute(services.routes.get('/dsh-output-style/presets'), {})
    assert.equal(afterDelete.body.presets.tones.some((preset) => preset.id === 'custom'), false)
    ctx.dispose()
  })
})

test('the preset routes reject non-POST, non-loopback, and cross-origin requests', async () => {
  await withHome('guards', async () => {
    const { services, ctx } = await boot()
    const route = services.routes.get('/dsh-output-style/presets')
    assert.equal((await callRoute(route, {}, { method: 'GET' })).status, 405)
    assert.equal((await callRoute(route, {}, { socket: { remoteAddress: '192.168.1.5' } })).status, 403)
    assert.equal((await callRoute(route, {}, { headers: { host: 'evil.example', origin: 'http://evil.example' } })).status, 403)
    assert.equal((await callRoute(route, {}, { headers: { host: '127.0.0.1:60612', origin: 'http://evil.example' } })).status, 403)
    ctx.dispose()
  })
})

test('the /style command reports and flips both switches and presets', async () => {
  await withHome('command', async () => {
    const { services, ctx } = await boot()
    const definition = commandDefinition(services)
    assert.equal(definition.name, 'style')
    assert.ok(definition.description.length > 0)

    const status = await runCommand(services, 'session-cmd', '')
    assert.match(status.text, /基调开关：关/)
    assert.match(status.text, /产出开关：关/)

    await runCommand(services, 'session-cmd', ' on')
    const on = await runCommand(services, 'session-cmd', ' status')
    assert.match(on.text, /基调开关：开/)

    const outputOn = await runCommand(services, 'session-cmd', ' output on')
    assert.match(outputOn.text, /产出开关已开启/)
    assert.equal(records(services).get('session-cmd').outputEnabled, true)

    const tone = await runCommand(services, 'session-cmd', ' tone coach')
    assert.match(tone.text, /教练引导/)
    const output = await runCommand(services, 'session-cmd', ' output code')
    assert.match(output.text, /代码实现/)

    const resetTone = await runCommand(services, 'session-cmd', ' tone none')
    assert.match(resetTone.text, /恢复默认/)
    assert.equal(records(services).get('session-cmd').tone, null)
    ctx.dispose()
  })
})
