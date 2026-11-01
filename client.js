// dsh-grice - browser half.
//
// A classic client bundle (client-modules protocol): register a factory with
// window.__ModuleLoader__.load and return apply(). The board renders one
// switch in the composer's left tool row, next to the permission chip; the
// switch owns no state, it reads and flips the Host's per-Session switch
// through the plugin's own loopback routes.
//
// React and the shared runtime come from the page's frozen module table; no
// another plugin's component is imported.
window.__ModuleLoader__.load({
  id: 'dsh-grice',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-grice'
    const ROUTE = '/dsh-grice'
    const VERSION = '0.1.0'
    /** How often the idle board re-reads the Host switch (cheap local POST). */
    const POLL_MS = 4000

    const zh = {
      label: '格赖斯',
      aria: '格赖斯模式开关',
      titleOn: '格赖斯模式：已开启。助手会严格遵守数量、质量、关系、方式四条语用准则，只给必要信息。点击关闭。',
      titleOff: '格赖斯模式：已关闭。点击开启：助手将严格遵守格赖斯语用准则，进行高效沟通。',
      failed: '切换失败，请重试',
    }

    const en = {
      label: 'Grice',
      aria: 'Grice mode switch',
      titleOn: 'Grice mode: on. Replies obey the maxims of quantity, quality, relation and manner. Click to turn off.',
      titleOff: 'Grice mode: off. Click to make replies obey Grice\'s maxims for efficient communication.',
      failed: 'Could not switch, retry',
    }

    const CSS = [
      '.dshgrice{display:inline-flex;align-items:center;gap:4px;height:28px;max-width:220px;padding:0 8px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;line-height:20px;cursor:pointer;outline:none}',
      '.dshgrice:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshgrice:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
      '.dshgrice:disabled{cursor:default;opacity:.55}',
      '.dshgrice[data-active="1"]{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-primary));background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 12%,transparent)}',
      '.dshgrice[data-active="1"]:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 18%,transparent)}',
      '.dshgrice-icon{display:inline-flex;flex:none}',
      '.dshgrice-icon svg{width:14px;height:14px}',
      '.dshgrice-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    ].join('')

    function isSessionId(value) {
      return typeof value === 'string' && value !== ''
    }

    async function post(path, body) {
      const response = await fetch(`${ROUTE}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body === undefined ? {} : body),
      })
      let data = {}
      try {
        data = await response.json()
      } catch {
        data = {}
      }
      if (!response.ok || !data || data.ok !== true) {
        const fallback = response.ok ? 'unexpected response' : `HTTP ${response.status}`
        throw new Error((data && data.error) || fallback)
      }
      return data
    }

    /** The switch artwork: a speech bubble with a check, matching the toolbar icons' weight. */
    function GriceGlyph() {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
      }, [
        h('path', { key: 'bubble', d: 'M2.7 3.2h10.6a1 1 0 0 1 1 1v6.1a1 1 0 0 1-1 1H6.1l-2.9 2.2v-2.2h-.5a1 1 0 0 1-1-1V4.2a1 1 0 0 1 1-1Z' }),
        h('path', { key: 'check', d: 'M5.6 7.6l1.5 1.5 3.3-3.3' }),
      ])
    }

    const inject = ['slots']

    function apply(ctx) {
      const style = document.createElement('style')
      style.dataset.dshGrice = '1'
      style.textContent = CSS
      document.head.appendChild(style)
      ctx.effect(() => () => style.remove(), 'dsh-grice: styles')

      // The locale registry is optional: a page without it falls back to the
      // browser language, and every label still renders.
      let locale
      try {
        locale = ctx.get('locale')
      } catch {
        locale = undefined
      }

      function dictionary() {
        let active = ''
        try {
          active = String((locale && typeof locale.getSnapshot === 'function' ? locale.getSnapshot().active : '') || '')
        } catch {
          active = ''
        }
        if (!active && typeof navigator !== 'undefined') active = String(navigator.language || '')
        return active.toLowerCase().startsWith('zh') ? zh : en
      }

      function useDictionary() {
        const [revision, setRevision] = React.useState(0)
        React.useEffect(() => {
          if (!locale || typeof locale.subscribe !== 'function') return undefined
          return locale.subscribe(() => setRevision((value) => value + 1))
        }, [])
        return React.useMemo(() => dictionary(), [revision])
      }

      /** The transport-backed switch state: Host is the only writer. */
      function useGriceSwitch(sessionId) {
        const [snapshot, setSnapshot] = React.useState({ status: 'loading', enabled: false })
        React.useEffect(() => {
          if (!isSessionId(sessionId)) {
            setSnapshot({ status: 'ready', enabled: false })
            return undefined
          }
          let live = true
          const read = (hello) => {
            const payload = hello
              ? { sessionId, hello: true, version: VERSION }
              : { sessionId }
            post('/state', payload).then((data) => {
              if (!live) return
              setSnapshot({ status: 'ready', enabled: data.enabled === true })
            }).catch(() => {
              if (!live) return
              setSnapshot((current) => (current.status === 'loading' ? { status: 'error', enabled: false } : current))
            })
          }
          read(true)
          const timer = setInterval(() => {
            if (typeof document === 'undefined' || document.visibilityState === 'hidden') return
            read(false)
          }, POLL_MS)
          return () => {
            live = false
            clearInterval(timer)
          }
        }, [sessionId])
        return [snapshot, setSnapshot]
      }

      function GriceSwitch(props) {
        const t = useDictionary()
        const sessionId = props.sessionId
        const [snapshot, setSnapshot] = useGriceSwitch(sessionId === undefined ? undefined : sessionId)
        const [busy, setBusy] = React.useState(false)
        const [failure, setFailure] = React.useState(null)

        React.useEffect(() => {
          if (failure === null) return undefined
          const timer = setTimeout(() => setFailure(null), 2500)
          return () => clearTimeout(timer)
        }, [failure])

        const onClick = React.useCallback(() => {
          if (busy || !isSessionId(sessionId)) return
          const wanted = !snapshot.enabled
          setBusy(true)
          setFailure(null)
          // The Host is the single writer; show the intended state at once and
          // let the answer settle it so a failed write cannot leave a lie.
          setSnapshot({ status: 'ready', enabled: wanted })
          post('/toggle', { sessionId }).then((data) => {
            setSnapshot({ status: 'ready', enabled: data.enabled === true })
          }).catch((error) => {
            setSnapshot({ status: 'ready', enabled: !wanted })
            setFailure(String((error && error.message) || error))
          }).then(() => {
            setBusy(false)
          })
        }, [busy, sessionId, snapshot.enabled])

        if (!isSessionId(sessionId)) return null

        const title = failure === null
          ? (snapshot.enabled ? t.titleOn : t.titleOff)
          : `${t.failed}（${failure}）`
        return h('button', {
          type: 'button',
          className: 'dshgrice',
          'data-active': snapshot.enabled ? '1' : undefined,
          'data-status': snapshot.status,
          'aria-label': t.aria,
          'aria-pressed': snapshot.enabled ? 'true' : 'false',
          title,
          disabled: busy,
          onClick,
        }, [
          h('span', { key: 'icon', className: 'dshgrice-icon' }, h(GriceGlyph)),
          h('span', { key: 'label', className: 'dshgrice-label' }, t.label),
        ])
      }

      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'dsh-grice',
        order: 120,
      }, GriceSwitch))
    }

    return { name: 'dsh-grice', inject, apply }
  },
})
