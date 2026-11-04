// Behaviour tests for the dsh-output-style browser half. The bundle is a classic
// client module that calls window.__ModuleLoader__.load at import time, so the
// test provides that facade, then drives the returned factory and apply with a
// fake client context and a fake DOM.
import test from 'node:test'
import assert from 'node:assert/strict'

/** Minimal React stand-in: the factory only needs hooks at render time. */
const React = {
  createElement: (...args) => ({ args }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useCallback: (callback) => callback,
  useMemo: (factory) => factory(),
  useRef: (initial) => ({ current: initial }),
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  Fragment: function Fragment() {},
}

/** The page facade the classic bundle registers itself with. */
let loaded
const windowFacade = {
  __ModuleLoader__: {
    load(definition) {
      loaded = definition
    },
  },
}

globalThis.window = windowFacade
globalThis.navigator = { language: 'zh-CN' }
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, enabled: false }) })

const created = []
globalThis.document = {
  visibilityState: 'visible',
  head: { appendChild() {} },
  createElement: () => {
    const element = {
      dataset: {},
      textContent: '',
      remove() {
        element.removed = true
      },
    }
    created.push(element)
    return element
  },
  addEventListener() {},
  removeEventListener() {},
}
globalThis.setInterval = () => 1
globalThis.clearInterval = () => {}

await import('../client.js')

function fakeCtx() {
  const registered = []
  const injected = []
  const effects = []
  return {
    registered,
    injected,
    effects,
    slots: {
      inject(key, callback) {
        injected.push(key)
        return callback()
      },
      register(options, component) {
        registered.push({ options, component })
        return () => {
          const index = registered.findIndex((entry) => entry.options === options)
          if (index !== -1) registered.splice(index, 1)
        }
      },
    },
    effect(factory) {
      const disposer = factory()
      if (typeof disposer === 'function') effects.push(disposer)
      return disposer
    },
    get(name) {
      if (name === 'locale') {
        return {
          getSnapshot: () => ({ active: 'zh' }),
          subscribe: () => () => {},
          register: () => () => {},
        }
      }
      return undefined
    },
  }
}

test('the bundle registers the merged tone control, the output dropdown, and the settings section', () => {
  assert.ok(loaded, 'the bundle registered with the module loader')
  assert.equal(loaded.id, 'dsh-output-style')

  const plugin = loaded.factory((specifier) => {
    assert.equal(specifier, 'react')
    return React
  })
  assert.equal(plugin.name, 'dsh-output-style')
  assert.deepEqual(plugin.inject, ['slots', 'sessions'])
  assert.equal(typeof plugin.apply, 'function')

  const ctx = fakeCtx()
  plugin.apply(ctx)

  assert.deepEqual(ctx.injected, ['conversation.input.left', 'conversation.input.left', 'settings.section', 'conversation.chat.commandview'])
  assert.equal(ctx.registered.length, 4)

  const composer = ctx.registered.filter((entry) => entry.options.name === 'conversation.input.left')
  assert.equal(composer.length, 2)
  assert.equal(composer[0].options.id, 'dsh-output-style')
  assert.equal(composer[0].options.order, 120)
  assert.equal(composer[1].options.id, 'dsh-output-style-output')
  assert.equal(composer[1].options.order, 140)
  const commandView = ctx.registered.find((entry) => entry.options.name === 'conversation.chat.commandview')
  assert.ok(commandView, 'the /style command row is claimed from the keyed commandview slot')
  assert.equal(commandView.options.key, 'style')
  assert.equal(typeof commandView.component, 'function')
  // Switch operations render nothing; the bare/status listing stays visible.
  const hiddenRow = commandView.component({ node: { args: ' on', outcome: { kind: 'success', text: '基调开关已开启。' } } })
  assert.ok(hiddenRow && Array.isArray(hiddenRow.args), 'switches render a collapse marker')
  assert.equal(hiddenRow.args[0], 'span')
  assert.equal(hiddenRow.args[1].className, 'dshstyle-cmdrow-hidden')
  const hiddenRow2 = commandView.component({ node: { args: ' tone coach', outcome: { kind: 'success', text: '基调已设为「教练引导」' } } })
  assert.equal(hiddenRow2.args[1].className, 'dshstyle-cmdrow-hidden')
  const listing = commandView.component({ node: { args: '', outcome: { kind: 'success', text: '基调开关：开' } } })
  assert.ok(listing && Array.isArray(listing.args), 'the status listing renders a row')
  assert.equal(commandView.component({ node: { args: ' nope', outcome: { kind: 'error', text: '没有 tone 预设' } } }).args[0], 'div')
  const settings = ctx.registered.find((entry) => entry.options.name === 'settings.section').options
  assert.equal(settings.id, 'dsh-output-style')
  assert.equal(typeof settings.label, 'function')

  // Each registration has a component function; the style element is removed
  // when the plugin unloads.
  for (const entry of ctx.registered) assert.ok(typeof entry.component === 'function')
  assert.equal(created.length, 1)
  for (const disposer of ctx.effects) disposer()
  assert.equal(created[0].removed, true)
})

test('the bundle reads the session projection and keeps only the settings routes', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../client.js', import.meta.url), 'utf8'))
  for (const route of ['/presets', '/presets/save', '/presets/delete', '/presets/reset', '/presets/import']) {
    assert.match(source, new RegExp(`'${route}'`))
  }
  // Session state comes from the host projection, not a polling endpoint.
  assert.match(source, /outputStylePair/)
  assert.match(source, /faceOf\(/)
  for (const route of ['/state', '/toggle', '/set', '/toggle-output', '/set-output', '/select']) {
    assert.doesNotMatch(source, new RegExp(`'${route}'`))
  }
  assert.doesNotMatch(source, /https?:\/\//)
})
