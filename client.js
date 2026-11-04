// dsh-output-style - browser half.
//
// Classic client bundle (client-modules protocol): register a factory with
// window.__ModuleLoader__.load and return apply(). The composer carries two
// split controls — a tone switch with its preset menu and an output-form switch
// with its preset menu — and the settings page manages the Markdown preset
// library.
//
// Session state arrives through the Host's `outputStylePair` session projection
// (subscribe on the projection face, no polling). Every write is a `/style`
// command executed through the client command Remote, so the Host stays the
// single writer and each switch keeps the durable command lifecycle.
window.__ModuleLoader__.load({
  id: 'dsh-output-style',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-output-style'
    const ROUTE = '/dsh-output-style'
    const VERSION = '0.4.0'
    /** Session projection carrying the live switch state (host-owned). */
    const PROJECTION_KEY = 'outputStylePair'
    /** The wire shape a missing projection reads as; identity-stable for React. */
    const EMPTY_STYLE = Object.freeze({
      status: 'loading',
      enabled: false,
      outputEnabled: false,
      tone: null,
      output: null,
      tones: [],
      outputs: [],
    })

    const zh = {
      panel: '输出风格',
      styleAria: '基调开关',
      styleOn: '基调开关：已开启。点击关闭。',
      styleOff: '基调开关：已关闭。点击开启。',
      tone: '基调',
      toneAria: '沟通与思考基调',
      toneHint: '选择沟通/思考基调；选中后自动开启基调开关。',
      menuAria: '选择沟通基调',
      toneDefault: '格赖斯·高效',
      output: '产出',
      outputAria: '产出形态',
      outputHint: '选择产出形态；选中后自动开启产出开关。',
      outputOn: '产出形态开关：已开启。点击关闭。',
      outputOff: '产出形态开关：已关闭。点击开启。',
      outputMenuAria: '选择产出形态',
      outputNone: '无额外要求',
      more: '更多…',
      collapse: '收起',
      manageHint: '在「设置 → 输出风格」里管理预设',
      loading: '加载中…',
      unavailable: '不可用',
      failed: '操作失败',
      settingsTitle: '输出风格',
      settingsIntro: '管理沟通基调与产出形态预设。两个控件都从这里取数据；单条提示词上限 2000 字符。',
      settingsTone: '沟通基调',
      settingsOutput: '产出形态',
      builtin: '内置',
      pinned: '置顶',
      pin: '置顶',
      unpin: '取消置顶',
      add: '新增预设',
      addTone: '新增基调',
      addOutput: '新增产出',
      editPreset: '编辑预设',
      newPreset: '新建预设',
      name: '名称',
      namePlaceholder: '例如：代码审查',
      prompt: '提示词正文（会追加到当前会话的系统提示词）',
      promptPlaceholder: '写清楚要求：交付物、结构、语气、不要做什么…',
      pinnedLabel: '在下拉框前 5 条中展示',
      chars: (count) => `${count} / 2000`,
      save: '保存',
      cancel: '取消',
      remove: '删除',
      edit: '编辑',
      reset: '恢复默认预设',
      resetConfirm: '恢复默认预设？自定义预设会被删除。',
      removeConfirm: '删除这个预设？当前正在使用它的会话会自动回退。',
      empty: '还没有预设，点「新增」创建一个。',
      saved: '已保存',
      builtinNote: '内置预设也可以修改或删除，恢复默认会还原。',
      close: '关闭',
    }

    const en = {
      panel: 'Output Style',
      styleAria: 'Tone switch',
      styleOn: 'Tone switch: on. Click to turn off.',
      styleOff: 'Tone switch: off. Click to turn on.',
      tone: 'Tone',
      toneAria: 'Communication and thinking tone',
      toneHint: 'Pick a tone; selecting one turns its switch on.',
      menuAria: 'Choose communication tone',
      toneDefault: 'Grice · efficient',
      output: 'Output',
      outputAria: 'Output form',
      outputHint: 'Pick an output form; selecting one turns its switch on.',
      outputOn: 'Output form switch: on. Click to turn off.',
      outputOff: 'Output form switch: off. Click to turn on.',
      outputMenuAria: 'Choose output form',
      outputNone: 'No extra requirements',
      more: 'More…',
      collapse: 'Show less',
      manageHint: 'Manage presets in Settings → Output Style',
      loading: 'Loading…',
      unavailable: 'Unavailable',
      failed: 'Failed',
      settingsTitle: 'Output style',
      settingsIntro: 'Manage communication tone and output-form presets. Both composer controls read from here; each prompt is capped at 2000 characters.',
      settingsTone: 'Tone presets',
      settingsOutput: 'Output presets',
      builtin: 'built-in',
      pinned: 'pinned',
      pin: 'Pin',
      unpin: 'Unpin',
      add: 'New preset',
      addTone: 'New tone',
      addOutput: 'New output',
      editPreset: 'Edit preset',
      newPreset: 'New preset',
      name: 'Name',
      namePlaceholder: 'e.g. Code review',
      prompt: 'Prompt text (appended to the system prompt of a session)',
      promptPlaceholder: 'State the deliverable, structure, tone, and what not to do…',
      pinnedLabel: 'Show in the first 5 rows of the dropdown',
      chars: (count) => `${count} / 2000`,
      save: 'Save',
      cancel: 'Cancel',
      remove: 'Delete',
      edit: 'Edit',
      reset: 'Restore default presets',
      resetConfirm: 'Restore default presets? Custom presets will be deleted.',
      removeConfirm: 'Delete this preset? Sessions using it fall back automatically.',
      empty: 'No presets yet — click New to create one.',
      saved: 'Saved',
      builtinNote: 'Built-in presets can be edited or deleted; Restore defaults brings them back.',
      close: 'Close',
    }

    const CSS = [
      '.dshstyle{display:inline-flex;align-items:center;gap:4px;height:28px;max-width:220px;padding:0 8px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;line-height:20px;cursor:pointer;outline:none}',
      '.dshstyle:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshstyle:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
      '.dshstyle:disabled{cursor:default;opacity:.55}',
      '.dshstyle[data-active="1"]{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-primary));background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 12%,transparent)}',
      '.dshstyle[data-active="1"]:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 18%,transparent)}',
      '.dshstyle-icon{display:inline-flex;flex:none}',
      '.dshstyle-icon svg{width:14px;height:14px}',
      '.dshstyle-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshstyle-select{max-width:180px}',
      '.dshstyle-select .dshstyle-label{max-width:132px}',
      '.dshstyle-chevron{display:inline-flex;flex:none;opacity:.65;transition:transform .12s}',
      '.dshstyle-chevron svg{width:12px;height:12px}',
      '.dshstyle-split{display:inline-flex;align-items:center;height:28px;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;line-height:20px}',
      '.dshstyle-split[data-active="1"]{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-primary));background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 12%,transparent)}',
      '.dshstyle-split-main{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 4px 0 8px;border:none;border-radius:var(--dsw-radius-sm) 0 0 var(--dsw-radius-sm);background:transparent;color:inherit;font:inherit;cursor:pointer;outline:none}',
      '.dshstyle-split-main:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshstyle-split[data-active="1"] .dshstyle-split-main:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 10%,transparent)}',
      '.dshstyle-split-main:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
      '.dshstyle-split-main:disabled{opacity:.55;cursor:default}',
      '.dshstyle-split-divider{width:1px;height:14px;flex:none;background:currentColor;opacity:.18}',
      '.dshstyle-split-caret{display:inline-flex;align-items:center;justify-content:center;width:20px;height:28px;padding:0;border:none;border-radius:0 var(--dsw-radius-sm) var(--dsw-radius-sm) 0;background:transparent;color:inherit;cursor:pointer;outline:none}',
      '.dshstyle-split-caret:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshstyle-split[data-active="1"] .dshstyle-split-caret:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 10%,transparent)}',
      '.dshstyle-split-caret:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
      // Narrow composer: keep both controls on one toolbar row by showing one
      // character of the preset name instead of wrapping the row.
      '@container (width <= 560px){.dshstyle-split-main .dshstyle-label{max-width:1em;text-overflow:clip}.dshstyle-split-main{gap:4px;padding-right:2px}}',
      '.dshstyle-menu-more-btn{appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11px;padding:0 2px;cursor:pointer}',
      '.dshstyle-menu-more-btn:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}',
      '.dshstyle-menu-more-row{display:block;width:100%;padding:6px 10px;border-radius:var(--dsw-radius-sm);font-size:12px;text-align:left}',
      '.dshstyle-menu-more-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshstyle-menu{position:fixed;z-index:2147483000;min-width:208px;max-width:320px;padding:4px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-base,#fff);box-shadow:0 10px 28px rgba(0,0,0,.2)}',
      '.dshstyle-menu-list{max-height:320px;overflow:auto}',
      '.dshstyle-menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;text-align:left;cursor:pointer}',
      '.dshstyle-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshstyle-menu-item[data-selected="1"]{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-primary));font-weight:500}',
      '.dshstyle-menu-check{flex:none;width:14px;text-align:center;opacity:.9}',
      '.dshstyle-menu-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshstyle-menu-more{color:var(--dsw-alias-label-secondary)}',
      '.dshstyle-menu-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l2,rgba(128,128,128,.25))}',
      '.dshstyle-menu-hint{padding:6px 10px 4px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
      '.dshstyle-settings{display:flex;flex-direction:column;gap:14px;max-width:760px;padding:4px 2px 40px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}',
      '.dshstyle-settings-title{margin:0;font-size:18px;font-weight:600;line-height:26px}',
      '.dshstyle-settings-intro{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px}',
      '.dshstyle-tabs{display:flex;gap:6px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.25))}',
      '.dshstyle-tab{appearance:none;border:none;border-bottom:2px solid transparent;background:transparent;padding:7px 12px;color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer}',
      '.dshstyle-tab[data-on="1"]{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-primary));border-bottom-color:var(--dsw-alias-state-business-primary,#4d6bfe);font-weight:600}',
      '.dshstyle-rows{display:flex;flex-direction:column;gap:6px}',
      '.dshstyle-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.25));border-radius:var(--dsw-radius-md,8px)}',
      '.dshstyle-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.dshstyle-row-name{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:500}',
      '.dshstyle-row-meta{color:var(--dsw-alias-label-tertiary);font-size:11px}',
      '.dshstyle-badge{flex:none;padding:0 5px;border-radius:4px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}',
      '.dshstyle-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;min-height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}',
      '.dshstyle-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dshstyle-btn[data-primary="1"]{border-color:transparent;background:var(--dsw-alias-state-business-primary,#4d6bfe);color:#fff}',
      '.dshstyle-btn[data-danger="1"]:hover{color:var(--dsw-alias-state-error-primary,#e5484d)}',
      '.dshstyle-btn:disabled{opacity:.5;cursor:default}',
      '.dshstyle-form{display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2,#fafafa)}',
      '.dshstyle-form-title{font-size:13px;font-weight:600}',
      '.dshstyle-field{display:flex;flex-direction:column;gap:5px}',
      '.dshstyle-field-label{color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.dshstyle-input,.dshstyle-textarea{box-sizing:border-box;width:100%;padding:7px 9px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit}',
      '.dshstyle-textarea{min-height:150px;resize:vertical;line-height:1.55}',
      '.dshstyle-form-foot{display:flex;align-items:center;gap:8px}',
      '.dshstyle-form-foot .dshstyle-spacer{flex:1}',
      '.dshstyle-hint{color:var(--dsw-alias-label-tertiary);font-size:11px}',
      '.dshstyle-notice{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-secondary));font-size:12px}',
      '.dshstyle-error{color:var(--dsw-alias-state-error-primary,#e5484d);font-size:12px}',
      '.dshstyle-empty{padding:18px 4px;color:var(--dsw-alias-label-tertiary);font-size:13px}',
      '.dshstyle-check{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px}',
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

    /** A small "tone / output" artwork whose shape differs from the Grice glyph. */
    function PresetGlyph({ kind }) {
      if (kind === 'tone') {
        return h('svg', {
          viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false',
        }, [
          h('path', { key: 'a', d: 'M3 11.2V5.4h5.1v5.8H6.2L4.2 13v-1.8H3Z' }),
          h('path', { key: 'b', d: 'M9.6 9.2h2.9c.5 0 .9-.4.9-.9V3.6c0-.5-.4-.9-.9-.9H7.4' }),
        ])
      }
      return h('svg', {
        viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false',
      }, [
        h('path', { key: 'page', d: 'M4 2.2h5.6L12.8 5.4v8.4H4V2.2Z' }),
        h('path', { key: 'fold', d: 'M9.4 2.4v3.2h3.2' }),
        h('path', { key: 'line', d: 'M6 9.4h4.4M6 11.6h3.2' }),
      ])
    }

    function ChevronGlyph() {
      return h('svg', {
        viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false',
      }, h('path', { d: 'M4 6.2 8 10l4-3.8' }))
    }

    function CheckGlyph() {
      return h('svg', {
        viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false',
      }, h('path', { d: 'M3.4 8.4 6.4 11.2 12.6 4.8' }))
    }

    /**
     * Per-Session switch surface shared by every composer control. The Host
     * pushes the `outputStylePair` session projection, so this store subscribes
     * to that face instead of polling a route; commands are the write path
     * (exactly the `/style` lifecycle the keyboard uses).
     * @param sessions - the client `sessions` service, when composed.
     * @param remote - the client `remote` service, used as the command fallback.
     */
    function createSessionStore(sessions, remote) {
      const records = new Map()

      function recordOf(sessionId) {
        let record = records.get(sessionId)
        if (record === undefined) {
          record = {
            sessionId,
            snapshot: EMPTY_STYLE,
            listeners: new Set(),
            face: null,
            faceOff: null,
            listOff: null,
          }
          records.set(sessionId, record)
        }
        return record
      }

      function publish(record) {
        let next = EMPTY_STYLE
        try {
          const raw = record.face === null ? undefined : record.face.getSnapshot()
          if (raw !== null && typeof raw === 'object') {
            next = {
              status: 'ready',
              enabled: raw.enabled === true,
              outputEnabled: raw.outputEnabled === true,
              tone: typeof raw.tone === 'string' ? raw.tone : null,
              output: typeof raw.output === 'string' ? raw.output : null,
              tones: Array.isArray(raw.tones) ? raw.tones : [],
              outputs: Array.isArray(raw.outputs) ? raw.outputs : [],
            }
          }
        } catch {
          next = EMPTY_STYLE
        }
        record.snapshot = next
        for (const listener of record.listeners) listener()
      }

      function unwatchList(record) {
        if (record.listOff === null) return
        try {
          record.listOff()
        } catch {
          // A disposed sessions service already dropped the subscription.
        }
        record.listOff = null
      }

      /** Retry binding when the session materializes later (the slot may render first). */
      function watchList(record) {
        if (record.listOff !== null || sessions === null || sessions === undefined) return
        const list = sessions.list
        if (list === null || list === undefined || typeof list.subscribe !== 'function') return
        try {
          record.listOff = list.subscribe(() => bind(record))
        } catch {
          record.listOff = null
        }
      }

      function bind(record) {
        if (record.face !== null) return
        if (sessions === null || sessions === undefined || typeof sessions.binding !== 'function') return
        let binding
        try {
          binding = sessions.binding(record.sessionId)
        } catch {
          binding = undefined
        }
        const projections = binding !== null && typeof binding === 'object' && binding.session !== null && typeof binding.session === 'object'
          ? binding.session.projections
          : undefined
        const face = projections !== null && typeof projections === 'object' && typeof projections.faceOf === 'function'
          ? projections.faceOf(PROJECTION_KEY)
          : undefined
        if (face === null || face === undefined || typeof face.getSnapshot !== 'function') {
          watchList(record)
          return
        }
        record.face = face
        unwatchList(record)
        if (typeof face.subscribe === 'function') {
          try {
            record.faceOff = face.subscribe(() => publish(record))
          } catch {
            record.faceOff = null
          }
        }
        publish(record)
      }

      function release(record) {
        if (record.faceOff !== null) {
          try {
            record.faceOff()
          } catch {
            // The face was disposed with its session.
          }
          record.faceOff = null
        }
        record.face = null
        unwatchList(record)
      }

      return {
        snapshotOf(sessionId) {
          const record = recordOf(sessionId)
          bind(record)
          return record.snapshot
        },
        subscribe(sessionId, listener) {
          const record = recordOf(sessionId)
          record.listeners.add(listener)
          bind(record)
          return () => {
            record.listeners.delete(listener)
            if (record.listeners.size === 0) release(record)
          }
        },
        /**
         * Run one `/style` line through the durable command lifecycle. The
         * projection push that follows updates every subscribed control.
         * @param sessionId - the session whose agent runs the command.
         * @param line - full command line, leading slash included.
         * @returns the command execution result.
         */
        async command(sessionId, line) {
          if (remote !== null && remote !== undefined && remote.commands !== undefined && typeof remote.commands.execute === 'function') {
            const result = await remote.commands.execute(sessionId, line, [])
            if (result !== null && typeof result === 'object' && result.ok === false) {
              const failure = result.error !== null && typeof result.error === 'object' ? result.error : {}
              throw new Error(String(failure.message || failure.code || 'command failed'))
            }
            return result
          }
          throw new Error('this session cannot run commands yet')
        },
      }
    }

    /** The global preset library, shared by both dropdowns and the settings page. */
    function createPresetStore() {
      let snapshot = { status: 'loading', tones: [], outputs: [], error: null }
      const listeners = new Set()
      let pending = null

      function publish(next) {
        snapshot = { ...snapshot, ...next }
        for (const listener of listeners) listener()
      }

      function load(force) {
        if (pending !== null) return pending
        if (snapshot.status === 'ready' && force !== true) return Promise.resolve(snapshot)
        pending = post('/presets', {}).then((data) => {
          pending = null
          const presets = data.presets ?? {}
          publish({
            status: 'ready',
            tones: Array.isArray(presets.tones) ? presets.tones : [],
            outputs: Array.isArray(presets.outputs) ? presets.outputs : [],
            error: null,
          })
          return snapshot
        }).catch((error) => {
          pending = null
          publish({ status: 'error', error: String((error && error.message) || error) })
          return snapshot
        })
        return pending
      }

      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        load,
        replace(library) {
          const presets = library ?? {}
          publish({
            status: 'ready',
            tones: Array.isArray(presets.tones) ? presets.tones : [],
            outputs: Array.isArray(presets.outputs) ? presets.outputs : [],
            error: null,
          })
        },
        find(kind, id) {
          if (typeof id !== 'string' || id === '') return undefined
          return snapshot[kind === 'tone' ? 'tones' : 'outputs'].find((preset) => preset.id === id)
        },
        nameOf(kind, id) {
          const preset = this.find(kind, id)
          if (preset !== undefined) return preset.name
          return kind === 'tone' ? zh.toneDefault : zh.outputNone
        },
      }
    }

    const inject = ['slots', 'sessions']

    function apply(ctx) {
      const style = document.createElement('style')
      style.dataset.dshGrice = '1'
      style.textContent = CSS
      document.head.appendChild(style)
      ctx.effect(() => () => style.remove(), 'dsh-output-style: styles')

      // The locale registry is optional: a page without it falls back to the
      // browser language, and every label still renders.
      let locale
      try {
        locale = ctx.get('locale')
      } catch {
        locale = undefined
      }
      if (locale && typeof locale.register === 'function') {
        ctx.effect(() => {
          try {
            return locale.register(NS, { zh, en })
          } catch {
            return () => {}
          }
        }, 'dsh-output-style: dictionaries')
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

      /** Optional client services: absent ones degrade to the render-safe fallbacks. */
      function serviceOf(name) {
        try {
          return ctx.get(name)
        } catch {
          return undefined
        }
      }
      const sessions = serviceOf('sessions')
      const remote = serviceOf('remote')
      const sessionStore = createSessionStore(sessions, remote)
      const presetStore = createPresetStore()

      function useSession(sessionId) {
        const subscribe = React.useCallback(
          (listener) => (isSessionId(sessionId) ? sessionStore.subscribe(sessionId, listener) : () => {}),
          [sessionId],
        )
        const getSnapshot = React.useCallback(
          () => (isSessionId(sessionId) ? sessionStore.snapshotOf(sessionId) : EMPTY_STYLE),
          [sessionId],
        )
        return React.useSyncExternalStore(subscribe, getSnapshot)
      }

      function usePresets() {
        const snapshot = React.useSyncExternalStore(
          (listener) => presetStore.subscribe(listener),
          () => presetStore.getSnapshot(),
        )
        React.useEffect(() => {
          presetStore.load(false)
        }, [])
        return snapshot
      }

      /** The merged composer control: master switch plus one small chevron for both preset kinds. */
      function GriceControl(props) {
        const t = useDictionary()
        const sessionId = props.sessionId
        const snapshot = useSession(sessionId)
        const [open, setOpen] = React.useState(false)
        const [expanded, setExpanded] = React.useState({ tone: false, output: false })
        const [position, setPosition] = React.useState({ left: 980, top: 880 })
        const [busy, setBusy] = React.useState(false)
        const [failure, setFailure] = React.useState(null)
        const anchorRef = React.useRef(null)

        const close = React.useCallback(() => {
          setOpen(false)
          setExpanded({ tone: false, output: false })
        }, [])

        React.useEffect(() => {
          if (!open) return undefined
          const onPointer = (event) => {
            const anchor = anchorRef.current
            if (anchor !== null && anchor.contains(event.target)) return
            if (event.target && typeof event.target.closest === 'function' && event.target.closest('.dshstyle-menu')) return
            close()
          }
          const onKey = (event) => {
            if (event.key === 'Escape') close()
          }
          document.addEventListener('mousedown', onPointer)
          document.addEventListener('keydown', onKey)
          return () => {
            document.removeEventListener('mousedown', onPointer)
            document.removeEventListener('keydown', onKey)
          }
        }, [open, close])

        React.useEffect(() => {
          if (failure === null) return undefined
          const timer = setTimeout(() => setFailure(null), 3000)
          return () => clearTimeout(timer)
        }, [failure])

        const toggle = React.useCallback(() => {
          if (busy || !isSessionId(sessionId)) return
          setBusy(true)
          setFailure(null)
          sessionStore.command(sessionId, snapshot.enabled === true ? '/style off' : '/style on').catch((error) => {
            setFailure(String((error && error.message) || error))
          }).then(() => {
            setBusy(false)
          })
        }, [busy, sessionId, snapshot.enabled])

        const choose = React.useCallback((kind, id) => {
          if (!isSessionId(sessionId)) return
          const line = id === null
            ? `/style ${kind} none`
            : `/style ${kind} ${id}`
          sessionStore.command(sessionId, line).then(() => {
            close()
          }).catch((error) => {
            setFailure(String((error && error.message) || error))
          })
        }, [close, sessionId])

        if (!isSessionId(sessionId)) return null

        const toneList = snapshot.tones
        const outputList = snapshot.outputs
        const toneId = snapshot.tone ?? 'grice'
        const tonePreset = toneList.find((preset) => preset.id === toneId)
        const outputPreset = outputList.find((preset) => preset.id === snapshot.output)
        const enabled = snapshot.enabled === true
        const toneName = tonePreset === undefined ? t.toneDefault : tonePreset.name
        const outputName = snapshot.output === null
          ? t.outputNone
          : (outputPreset === undefined ? snapshot.output : outputPreset.name)
        // The chip names the active tone, so the closed state says what the session runs on.
        const label = toneName
        const stateHint = `基调：${toneName}；产出：${outputName}`
        const title = failure === null
          ? (enabled ? `${t.styleOn} ${stateHint}` : `${t.styleOff} ${stateHint}`)
          : `${t.failed}（${failure}）`

        const openMenu = () => {
          const anchor = anchorRef.current
          if (anchor === null) return
          const rect = anchor.getBoundingClientRect()
          const estimated = 470
          const below = rect.bottom + 6 + estimated < window.innerHeight
          setPosition(below
            ? { left: Math.max(8, rect.left), top: rect.bottom + 6 }
            : { left: Math.max(8, rect.left), bottom: window.innerHeight - rect.top + 6 })
          setOpen(true)
        }

        const row = (kind, preset, selectedId) => h('button', {
          key: `${kind}-${preset.id}`,
          type: 'button',
          className: 'dshstyle-menu-item',
          'data-selected': preset.id === selectedId ? '1' : undefined,
          onClick: () => choose(kind, preset.id),
        }, [
          h('span', { key: 'check', className: 'dshstyle-menu-check' }, preset.id === selectedId ? h(CheckGlyph) : null),
          h('span', { key: 'text', className: 'dshstyle-menu-text' }, preset.name),
        ])

        const pinned = toneList.filter((preset) => preset.pinned).slice(0, 5)
        const hidden = toneList.filter((preset) => !pinned.includes(preset))
        const shown = expanded.tone ? toneList : pinned

        const menu = open
          ? h('div', {
            className: 'dshstyle-menu',
            style: position === null ? undefined : position,
            role: 'menu',
          }, [
            shown.map((preset) => row('tone', preset, toneId)),
            hidden.length > 0
              ? h('button', {
                key: 'more',
                type: 'button',
                className: 'dshstyle-menu-more-btn dshstyle-menu-more-row',
                onClick: () => setExpanded({ ...expanded, tone: !expanded.tone }),
              }, expanded.tone ? t.collapse : t.more)
              : null,
            h('div', { key: 'hint', className: 'dshstyle-menu-hint' }, t.manageHint),
          ])
          : null

        return h(React.Fragment, null, [
          h('div', {
            key: 'split',
            ref: anchorRef,
            className: 'dshstyle-split',
            'data-active': enabled ? '1' : undefined,
            'data-open': open ? '1' : undefined,
            'data-status': snapshot.status,
          }, [
            h('button', {
              key: 'main',
              type: 'button',
              className: 'dshstyle-split-main',
              'aria-label': t.styleAria,
              'aria-pressed': enabled ? 'true' : 'false',
              title,
              disabled: busy,
              onClick: toggle,
            }, [
              h('span', { key: 'icon', className: 'dshstyle-icon' }, h(GriceGlyph)),
              h('span', { key: 'label', className: 'dshstyle-label' }, label),
            ]),
            h('span', { key: 'divider', className: 'dshstyle-split-divider', 'aria-hidden': 'true' }),
            h('button', {
              key: 'caret',
              type: 'button',
              className: 'dshstyle-split-caret',
              'aria-label': t.menuAria,
              'aria-haspopup': 'menu',
              'aria-expanded': open ? 'true' : 'false',
              title: t.menuAria,
              onClick: () => (open ? close() : openMenu()),
            }, h(ChevronGlyph)),
          ]),
          menu,
        ])
      }

      /** The output-form dropdown, a separate button beside the merged tone control. */
      function OutputSelect(props) {
        const t = useDictionary()
        const sessionId = props.sessionId
        const snapshot = useSession(sessionId)
        const [open, setOpen] = React.useState(false)
        const [expanded, setExpanded] = React.useState(false)
        const [position, setPosition] = React.useState(null)
        const [failure, setFailure] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const anchorRef = React.useRef(null)

        const close = React.useCallback(() => {
          setOpen(false)
          setExpanded(false)
        }, [])

        React.useEffect(() => {
          if (!open) return undefined
          const onPointer = (event) => {
            const anchor = anchorRef.current
            if (anchor !== null && anchor.contains(event.target)) return
            if (event.target && typeof event.target.closest === 'function' && event.target.closest('.dshstyle-menu')) return
            close()
          }
          const onKey = (event) => {
            if (event.key === 'Escape') close()
          }
          document.addEventListener('mousedown', onPointer)
          document.addEventListener('keydown', onKey)
          return () => {
            document.removeEventListener('mousedown', onPointer)
            document.removeEventListener('keydown', onKey)
          }
        }, [open, close])

        React.useEffect(() => {
          if (failure === null) return undefined
          const timer = setTimeout(() => setFailure(null), 3000)
          return () => clearTimeout(timer)
        }, [failure])

        const choose = React.useCallback((id) => {
          if (!isSessionId(sessionId)) return
          const line = id === null ? '/style output none' : `/style output ${id}`
          sessionStore.command(sessionId, line).then(() => {
            close()
          }).catch((error) => {
            setFailure(String((error && error.message) || error))
          })
        }, [close, sessionId])

        const toggle = React.useCallback(() => {
          if (busy || !isSessionId(sessionId)) return
          setBusy(true)
          setFailure(null)
          sessionStore.command(sessionId, snapshot.outputEnabled === true ? '/style output off' : '/style output on').catch((error) => {
            setFailure(String((error && error.message) || error))
          }).then(() => {
            setBusy(false)
          })
        }, [busy, sessionId, snapshot.outputEnabled])

        if (!isSessionId(sessionId)) return null

        const library = snapshot.outputs
        const selected = library.find((preset) => preset.id === snapshot.output)
        const label = selected === undefined ? t.outputNone : selected.name
        const outputOn = snapshot.outputEnabled === true
        const title = failure === null
          ? `${outputOn ? t.outputOn : t.outputOff} 当前：${label}`
          : `${t.failed}（${failure}）`

        const openMenu = () => {
          const anchor = anchorRef.current
          if (anchor === null) return
          const rect = anchor.getBoundingClientRect()
          const estimated = Math.min(360, Math.max(180, (expanded ? library.length + 1 : 7) * 32 + 28))
          const below = rect.bottom + 6 + estimated < (typeof window === 'undefined' ? 800 : window.innerHeight)
          setPosition(below
            ? { left: Math.max(8, rect.left), top: rect.bottom + 6 }
            : { left: Math.max(8, rect.left), bottom: (typeof window === 'undefined' ? 0 : window.innerHeight) - rect.top + 6 })
          setOpen(true)
        }

        const pinned = library.filter((preset) => preset.pinned).slice(0, 5)
        const hidden = library.filter((preset) => !pinned.includes(preset))
        const shown = expanded ? library : pinned

        const item = (id, name, selectedId) => h('button', {
          key: `${id ?? 'none'}`,
          type: 'button',
          className: 'dshstyle-menu-item',
          'data-selected': id === selectedId ? '1' : undefined,
          onClick: () => choose(id),
        }, [
          h('span', { key: 'check', className: 'dshstyle-menu-check' }, id === selectedId ? h(CheckGlyph) : null),
          h('span', { key: 'text', className: 'dshstyle-menu-text' }, name),
        ])

        const menu = open
          ? h('div', {
            className: 'dshstyle-menu',
            style: position === null ? undefined : position,
            role: 'menu',
          }, [
            item(null, t.outputNone, snapshot.output),
            shown.map((preset) => item(preset.id, preset.name, snapshot.output)),
            hidden.length > 0
              ? h('button', {
                key: 'more',
                type: 'button',
                className: 'dshstyle-menu-more-btn dshstyle-menu-more-row',
                onClick: () => setExpanded(!expanded),
              }, expanded ? t.collapse : t.more)
              : null,
            h('div', { key: 'hint', className: 'dshstyle-menu-hint' }, t.manageHint),
          ])
          : null

        return h(React.Fragment, null, [
          h('div', {
            key: 'split',
            ref: anchorRef,
            className: 'dshstyle-split',
            'data-active': outputOn ? '1' : undefined,
            'data-open': open ? '1' : undefined,
            'data-status': snapshot.status,
          }, [
            h('button', {
              key: 'main',
              type: 'button',
              className: 'dshstyle-split-main',
              'aria-label': t.outputAria,
              'aria-pressed': outputOn ? 'true' : 'false',
              title,
              disabled: busy,
              onClick: toggle,
            }, [
              h('span', { key: 'icon', className: 'dshstyle-icon' }, h(PresetGlyph, { kind: 'output' })),
              h('span', { key: 'label', className: 'dshstyle-label' }, label),
            ]),
            h('span', { key: 'divider', className: 'dshstyle-split-divider', 'aria-hidden': 'true' }),
            h('button', {
              key: 'caret',
              type: 'button',
              className: 'dshstyle-split-caret',
              'aria-label': t.outputMenuAria,
              'aria-haspopup': 'menu',
              'aria-expanded': open ? 'true' : 'false',
              title: t.outputMenuAria,
              onClick: () => (open ? close() : openMenu()),
            }, h(ChevronGlyph)),
          ]),
          menu,
        ])
      }
      function SettingsPanel() {
        const t = useDictionary()
        const presets = usePresets()
        const [tab, setTab] = React.useState('tone')
        const [editing, setEditing] = React.useState(null)
        const [notice, setNotice] = React.useState(null)
        const [failure, setFailure] = React.useState(null)
        const [busy, setBusy] = React.useState(false)

        const library = tab === 'tone' ? presets.tones : presets.outputs

        React.useEffect(() => {
          presetStore.load(false)
        }, [])

        React.useEffect(() => {
          setEditing(null)
          setNotice(null)
          setFailure(null)
        }, [tab])

        React.useEffect(() => {
          if (notice === null) return undefined
          const timer = setTimeout(() => setNotice(null), 2500)
          return () => clearTimeout(timer)
        }, [notice])

        const startAdd = () => {
          setNotice(null)
          setFailure(null)
          setEditing({ id: undefined, name: '', prompt: '', pinned: false })
        }

        const startEdit = (preset) => {
          setNotice(null)
          setFailure(null)
          setEditing({ id: preset.id, name: preset.name, prompt: preset.prompt, pinned: preset.pinned === true })
        }

        const save = () => {
          if (editing === null || busy) return
          setBusy(true)
          setFailure(null)
          post('/presets/save', {
            kind: tab,
            preset: {
              id: editing.id,
              name: editing.name,
              prompt: editing.prompt,
              pinned: editing.pinned,
            },
          }).then((data) => {
            presetStore.replace(data.list)
            setEditing(null)
            setNotice(t.saved)
          }).catch((error) => {
            setFailure(String((error && error.message) || error))
          }).then(() => {
            setBusy(false)
          })
        }

        const remove = (preset) => {
          if (typeof window === 'undefined' || !window.confirm(t.removeConfirm)) return
          setBusy(true)
          setFailure(null)
          post('/presets/delete', { kind: tab, id: preset.id }).then((data) => {
            presetStore.replace(data.list)
            if (editing !== null && editing.id === preset.id) setEditing(null)
            setNotice(t.saved)
          }).catch((error) => {
            setFailure(String((error && error.message) || error))
          }).then(() => {
            setBusy(false)
          })
        }

        const reset = () => {
          if (typeof window === 'undefined' || !window.confirm(t.resetConfirm)) return
          setBusy(true)
          setFailure(null)
          post('/presets/reset', { kind: tab }).then((data) => {
            presetStore.replace(data.list)
            setNotice(t.saved)
          }).catch((error) => {
            setFailure(String((error && error.message) || error))
          }).then(() => {
            setBusy(false)
          })
        }

        const rows = library.map((preset) => h('div', { key: preset.id, className: 'dshstyle-row' }, [
          h('div', { key: 'main', className: 'dshstyle-row-main' }, [
            h('div', { key: 'name', className: 'dshstyle-row-name' }, [
              h('span', { key: 'text' }, preset.name),
              preset.pinned ? h('span', { key: 'pin', className: 'dshstyle-badge' }, t.pinned) : null,
              preset.builtin ? h('span', { key: 'builtin', className: 'dshstyle-badge' }, t.builtin) : null,
            ]),
            h('div', { key: 'meta', className: 'dshstyle-row-meta' }, t.chars((preset.prompt || '').length)),
          ]),
          h('button', {
            key: 'edit', type: 'button', className: 'dshstyle-btn', disabled: busy,
            onClick: () => startEdit(preset),
          }, t.edit),
          h('button', {
            key: 'delete', type: 'button', className: 'dshstyle-btn', 'data-danger': '1', disabled: busy,
            onClick: () => remove(preset),
          }, t.remove),
        ]))

        const form = editing === null ? null : h('div', { className: 'dshstyle-form' }, [
          h('div', { key: 'title', className: 'dshstyle-form-title' }, editing.id === undefined ? t.newPreset : t.editPreset),
          h('label', { key: 'name', className: 'dshstyle-field' }, [
            h('span', { key: 'label', className: 'dshstyle-field-label' }, t.name),
            h('input', {
              key: 'input', className: 'dshstyle-input', value: editing.name, placeholder: t.namePlaceholder,
              onChange: (event) => setEditing({ ...editing, name: event.target.value }),
            }),
          ]),
          h('label', { key: 'prompt', className: 'dshstyle-field' }, [
            h('span', { key: 'label', className: 'dshstyle-field-label' }, t.prompt),
            h('textarea', {
              key: 'textarea', className: 'dshstyle-textarea', value: editing.prompt,
              placeholder: t.promptPlaceholder,
              onChange: (event) => setEditing({ ...editing, prompt: event.target.value.slice(0, 2000) }),
            }),
          ]),
          h('div', { key: 'pinned', className: 'dshstyle-check' }, h('input', {
            type: 'checkbox', checked: editing.pinned === true,
            onChange: (event) => setEditing({ ...editing, pinned: event.target.checked }),
          }), h('span', null, t.pinnedLabel)),
          h('div', { key: 'foot', className: 'dshstyle-form-foot' }, [
            failure === null ? null : h('span', { key: 'error', className: 'dshstyle-error' }, failure),
            h('span', { key: 'spacer', className: 'dshstyle-spacer' }),
            h('span', { key: 'chars', className: 'dshstyle-hint' }, t.chars((editing.prompt || '').length)),
            h('button', {
              key: 'cancel', type: 'button', className: 'dshstyle-btn', disabled: busy,
              onClick: () => setEditing(null),
            }, t.cancel),
            h('button', {
              key: 'save', type: 'button', className: 'dshstyle-btn', 'data-primary': '1', disabled: busy,
              onClick: save,
            }, t.save),
          ]),
        ])

        return h('div', { className: 'dshstyle-settings' }, [
          h('h1', { key: 'title', className: 'dshstyle-settings-title' }, t.settingsTitle),
          h('p', { key: 'intro', className: 'dshstyle-settings-intro' }, t.settingsIntro),
          h('div', { key: 'tabs', className: 'dshstyle-tabs' }, [
            h('button', {
              key: 'tone', type: 'button', className: 'dshstyle-tab', 'data-on': tab === 'tone' ? '1' : undefined,
              onClick: () => setTab('tone'),
            }, t.settingsTone),
            h('button', {
              key: 'output', type: 'button', className: 'dshstyle-tab', 'data-on': tab === 'output' ? '1' : undefined,
              onClick: () => setTab('output'),
            }, t.settingsOutput),
          ]),
          h('div', { key: 'actions', className: 'dshstyle-form-foot' }, [
            h('button', {
              key: 'add', type: 'button', className: 'dshstyle-btn', 'data-primary': '1', disabled: busy,
              onClick: startAdd,
            }, tab === 'tone' ? t.addTone : t.addOutput),
            h('span', { key: 'spacer', className: 'dshstyle-spacer' }),
            notice === null ? null : h('span', { key: 'notice', className: 'dshstyle-notice' }, notice),
            failure === null || editing !== null ? null : h('span', { key: 'error', className: 'dshstyle-error' }, failure),
            h('button', {
              key: 'reset', type: 'button', className: 'dshstyle-btn', disabled: busy, onClick: reset,
            }, t.reset),
          ]),
          presets.status === 'loading' && library.length === 0
            ? h('div', { key: 'loading', className: 'dshstyle-empty' }, t.loading)
            : rows.length === 0
              ? h('div', { key: 'empty', className: 'dshstyle-empty' }, t.empty)
              : h('div', { key: 'rows', className: 'dshstyle-rows' }, rows),
          form,
          h('div', { key: 'note', className: 'dshstyle-hint' }, t.builtinNote),
        ])
      }

      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'dsh-output-style',
        order: 120,
      }, GriceControl))

      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'dsh-output-style-output',
        order: 140,
      }, OutputSelect))

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-output-style',
        order: 120,
        label: () => dictionary().panel,
      }, SettingsPanel))
    }

    return { name: 'dsh-output-style', inject, apply }
  },
})
