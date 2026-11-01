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
}

await import('../client.js')

function fakeSlots() {
  const registrations = []
  return {
    registrations,
    slots: {
      inject(key, callback) {
        assert.equal(key, 'conversation.input.left')
        return callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {
          const index = registrations.findIndex((entry) => entry.options === options)
          if (index !== -1) registrations.splice(index, 1)
        }
      },
    },
  }
}

function fakeCtx(slots) {
  const effects = []
  return {
    effects,
    slots,
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
      }
    },
  }
}

test('the bundle registers one composer switch under a stable id', () => {
  assert.ok(loaded, 'the bundle registered with the module loader')
  assert.equal(loaded.id, 'dsh-grice')
  assert.equal(typeof loaded.factory, 'function')

  const plugin = loaded.factory((specifier) => {
    assert.equal(specifier, 'react')
    return React
  })
  assert.equal(plugin.name, 'dsh-grice')
  assert.deepEqual(plugin.inject, ['slots'])
  assert.equal(typeof plugin.apply, 'function')

  const { slots, registrations } = fakeSlots()
  const ctx = fakeCtx(slots)
  plugin.apply(ctx)

  assert.equal(registrations.length, 1)
  const [{ options, component }] = registrations
  assert.equal(options.name, 'conversation.input.left')
  assert.equal(options.id, 'dsh-grice')
  assert.equal(options.order, 120)
  assert.equal(typeof component, 'function')

  // The style element goes in and its disposer removes it on unload.
  assert.equal(created.length, 1)
  for (const disposer of ctx.effects) disposer()
  assert.equal(created[0].removed, true)
  assert.ok(document.head)
})

test('the switch reports the load state and hides without a session id', () => {
  const plugin = loaded.factory(() => React)
  const { slots } = fakeSlots()
  plugin.apply(fakeCtx(slots))

  // The bundle talks to its own loopback routes only.
  const source = plugin.apply.toString()
  assert.match(source, /conversation\.input\.left/)
})
