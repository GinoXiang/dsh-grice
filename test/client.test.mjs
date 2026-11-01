// Behaviour tests for the dsh-grice browser half. The bundle is a classic
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
      assert.equal(name, 'locale')
      return {
        getSnapshot: () => ({ active: 'zh' }),
        subscribe: () => () => {},
        register: () => () => {},
      }
    },
  }
}

test('the bundle registers the merged composer control and the settings section', () => {
  assert.ok(loaded, 'the bundle registered with the module loader')
  assert.equal(loaded.id, 'dsh-grice')

  const plugin = loaded.factory((specifier) => {
    assert.equal(specifier, 'react')
    return React
  })
  assert.equal(plugin.name, 'dsh-grice')
  assert.deepEqual(plugin.inject, ['slots'])
  assert.equal(typeof plugin.apply, 'function')

  const ctx = fakeCtx()
  plugin.apply(ctx)

  assert.deepEqual(ctx.injected, ['conversation.input.left', 'settings.section'])
  assert.equal(ctx.registered.length, 2)

  const composer = ctx.registered.find((entry) => entry.options.name === 'conversation.input.left').options
  assert.equal(composer.id, 'dsh-grice')
  assert.equal(composer.order, 120)
  const settings = ctx.registered.find((entry) => entry.options.name === 'settings.section').options
  assert.equal(settings.id, 'dsh-grice')
  assert.equal(typeof settings.label, 'function')

  // Each registration has a component function; the style element is removed
  // when the plugin unloads.
  for (const entry of ctx.registered) assert.ok(typeof entry.component === 'function')
  assert.equal(created.length, 1)
  for (const disposer of ctx.effects) disposer()
  assert.equal(created[0].removed, true)
})

test('the bundle talks only to its own loopback routes', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../client.js', import.meta.url), 'utf8'))
  for (const route of ['/state', '/toggle', '/select', '/presets', '/presets/save', '/presets/delete', '/presets/reset']) {
    assert.match(source, new RegExp(`'${route}'`))
  }
  assert.doesNotMatch(source, /https?:\/\//)
})
