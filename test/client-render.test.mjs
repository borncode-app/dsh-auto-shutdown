// Render harness for dsh-auto-shutdown's Web half: a miniature hook runtime, a
// fake locale service, a fake fetch, and the real client module. Proves the
// settings section renders both switches, that each switch posts the right
// control action, that a pending shutdown shows its countdown and a way out,
// and that the composer chip never fights the auto-continue chip.
import assert from 'node:assert/strict'

let factory
globalThis.window = {
  __ModuleLoader__: {
    load: (definition) => {
      assert.equal(definition.id, '@local/dsh-auto-shutdown')
      factory = definition.factory
    },
  },
}

await import(new URL('../client.js', import.meta.url).href)
assert.equal(typeof factory, 'function', 'client module registered a factory')

// --- miniature hook runtime -------------------------------------------------
let hooks = []
let hookIndex = 0
let pendingEffects = []

const reactApi = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  useState(initial) {
    const at = hookIndex++
    if (!(at in hooks)) hooks[at] = typeof initial === 'function' ? initial() : initial
    const set = (value) => {
      hooks[at] = typeof value === 'function' ? value(hooks[at]) : value
    }
    return [hooks[at], set]
  },
  useEffect(fn) {
    const at = hookIndex++
    if (hooks[at] === undefined) {
      hooks[at] = true
      pendingEffects.push(fn)
    }
  },
  useMemo(fn) {
    hookIndex++
    return fn()
  },
  useCallback(fn) {
    hookIndex++
    return fn
  },
  useRef(initial) {
    const at = hookIndex++
    if (!(at in hooks)) hooks[at] = { current: initial }
    return hooks[at]
  },
}

/** Forget every hook slot so the next render mounts the component fresh. */
function mountHooks() {
  hooks = []
  hookIndex = 0
  pendingEffects = []
}

/** Render once, then run the effects that render queued, and return the tree. */
function render(component, props) {
  hookIndex = 0
  pendingEffects = []
  const tree = component(props)
  const effects = pendingEffects
  for (const effect of effects) effect()
  return tree
}

/** Let the component's async fetch settle. */
const flush = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 5))
}

/** All visible text in an element tree. */
function textOf(tree) {
  if (tree === null || tree === undefined) return ''
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  return tree.children.map(textOf).join('')
}

/** Depth-first search for the first element matching a predicate. */
function find(tree, predicate) {
  if (tree === null || tree === undefined || typeof tree !== 'object') return undefined
  if (predicate(tree)) return tree
  for (const child of tree.children) {
    const hit = find(child, predicate)
    if (hit !== undefined) return hit
  }
  return undefined
}

/** Depth-first search for every element matching a predicate. */
function findAll(tree, predicate) {
  if (tree === null || tree === undefined || typeof tree !== 'object') return []
  const hits = predicate(tree) ? [tree] : []
  for (const child of tree.children) hits.push(...findAll(child, predicate))
  return hits
}

// --- load the real client module -------------------------------------------
const require = (name) => {
  if (name === 'react') return reactApi
  throw new Error(`unexpected client require: ${name}`)
}
const loaded = factory(require)
assert.deepEqual(loaded.inject, ['slots', 'locale'])

// --- a fake locale service --------------------------------------------------
const NS = 'settings.automation'
const locale = {
  active: 'en',
  dicts: new Map(),
  registered: [],
  register(ns, dicts) {
    locale.registered.push({ ns, dicts })
    locale.dicts.set(ns, dicts)
    return () => locale.dicts.delete(ns)
  },
  bind(ns) {
    return (key, values) => {
      const dicts = locale.dicts.get(ns) ?? {}
      const dict = dicts[locale.active] ?? dicts.en ?? {}
      const text = dict[key] ?? (dicts.en ?? {})[key] ?? key
      if (values === undefined) return text
      return String(text).replace(/\{(\w+)\}/gu, (match, name) => (name in values ? String(values[name]) : match))
    }
  },
  getSnapshot: () => ({ active: locale.active, revision: 0 }),
}

// --- the slots the plugin registers into ------------------------------------
const slots = { sections: [], icons: [], dock: [] }
const ctx = {
  slots: {
    inject: (name, produce) => {
      const entry = produce()
      if (name === 'settings.section') slots.sections.push(entry)
      else if (name === 'settings.section.icon') slots.icons.push(entry)
      else if (name === 'conversation.composer.dock') slots.dock.push(entry)
      else throw new Error(`unexpected slot ${name}`)
    },
    register: (options, component) => ({ options, component }),
  },
  locale,
  effect: (fn) => fn(),
}
loaded.apply(ctx)

const section = slots.sections.find(entry => entry.options.id === 'automation')
assert.ok(section !== undefined, 'the settings section registered')
assert.equal(sections0(slots), 1, 'exactly one settings section registered')
assert.equal(slots.icons.length, 1, 'exactly one section icon registered')
assert.equal(slots.icons[0].options.id, 'automation', 'the icon answers the section id')
assert.equal(slots.dock.length, 1, 'exactly one composer chip registered')

const sectionComponent = section.component
const chipComponent = slots.dock[0].component
assert.equal(typeof sectionComponent, 'function', 'section component registered')
assert.equal(typeof chipComponent, 'function', 'chip component registered')

/** How many settings sections the plugin registered. */
function sections0(rows) {
  return rows.sections.length
}

// --- fake Host state and fetch ---------------------------------------------
const calls = []
let shutdown = { revision: '2026-11-12.1', enabled: false, supported: true, platform: 'win32', delaySeconds: 120, now: Date.now(), pending: null }
let continuation = { revision: '2026-11-12.6', enabled: false, supported: true, now: Date.now(), pending: [] }
globalThis.fetch = async (url, options = {}) => {
  const target = String(url)
  calls.push({ url: target, options })
  if (options.method === 'POST') {
    const request = JSON.parse(options.body)
    if (target === '/plugins/auto-shutdown') {
      if (request.action === 'toggle') shutdown = { ...shutdown, enabled: typeof request.enabled === 'boolean' ? request.enabled : !shutdown.enabled }
      if (request.action === 'cancel') shutdown = { ...shutdown, pending: null }
    }
    if (target === '/plugins/auto-continue') {
      if (request.action === 'toggle') continuation = { ...continuation, enabled: typeof request.enabled === 'boolean' ? request.enabled : !continuation.enabled }
    }
    return { ok: true, json: async () => (target === '/plugins/auto-shutdown' ? shutdown : continuation) }
  }
  return { ok: true, json: async () => (target === '/plugins/auto-shutdown' ? shutdown : continuation) }
}

/** Mount the settings section fresh against one Host state and one locale. */
async function mountSection({ localeId = 'en', shutdownState, continueState }) {
  mountHooks()
  locale.active = localeId
  if (shutdownState !== undefined) shutdown = shutdownState
  if (continueState !== undefined) continuation = continueState
  let tree = render(sectionComponent, {})
  await flush()
  tree = render(sectionComponent, {})
  return tree
}

/** Mount the composer chip fresh against one Host state and one locale. */
async function mountChip({ localeId = 'en', state }) {
  mountHooks()
  locale.active = localeId
  if (state !== undefined) shutdown = state
  let tree = render(chipComponent, { sessionId: 'session-1' })
  await flush()
  tree = render(chipComponent, { sessionId: 'session-1' })
  return tree
}

/** The switch whose accessible name is the given text. */
const switchOf = (tree, label) => find(tree, node => node.props?.role === 'switch' && node.props?.['aria-label'] === label)

const OFF_SHUTDOWN = { revision: '2026-11-12.1', enabled: false, supported: true, platform: 'win32', delaySeconds: 120, now: Date.now(), pending: null }
const OFF_CONTINUE = { revision: '2026-11-12.6', enabled: false, supported: true, now: Date.now(), pending: [] }

// 1. The section sits after browser-use and carries a localized label.
assert.equal(section.options.name, 'settings.section')
assert.equal(section.options.id, 'automation')
assert.equal(section.options.order, 24)
assert.equal(section.options.locale, NS)
locale.active = 'en'
assert.equal(section.options.label(), 'Automation')
locale.active = 'th'
assert.equal(section.options.label(), 'ระบบอัตโนมัติ')
locale.active = 'zh'
assert.equal(section.options.label(), '自动化')
console.log('ok 1 section registered:', section.options.id, section.options.order)

// 2. The section renders both switch rows.
let tree = await mountSection({ localeId: 'en', shutdownState: OFF_SHUTDOWN, continueState: OFF_CONTINUE })
const switches = findAll(tree, node => node.props?.role === 'switch')
assert.equal(switches.length, 2, 'both switch rows render')
assert.ok(switchOf(tree, 'Auto-continue after usage limits') !== undefined, 'the auto-continue row renders')
assert.ok(switchOf(tree, 'Auto-ShutdownPC') !== undefined, 'the auto-shutdown row renders')
assert.match(textOf(tree), /Auto-continue after usage limits/u)
assert.match(textOf(tree), /Auto-ShutdownPC/u)
assert.match(textOf(tree), /Warning: this switch really powers the computer down/u)
console.log('ok 2 both switch rows:', textOf(tree).slice(0, 120))

// 3. The auto-continue switch shows off when the Host says so.
tree = await mountSection({ localeId: 'en', shutdownState: OFF_SHUTDOWN, continueState: OFF_CONTINUE })
assert.equal(switchOf(tree, 'Auto-continue after usage limits').props['aria-checked'], 'false')
assert.equal(switchOf(tree, 'Auto-ShutdownPC').props['aria-checked'], 'false')
console.log('ok 3 both switches off')

// 4. Clicking the Auto-ShutdownPC switch posts the toggle to its own route.
calls.length = 0
tree = await mountSection({ localeId: 'en', shutdownState: OFF_SHUTDOWN, continueState: OFF_CONTINUE })
await switchOf(tree, 'Auto-ShutdownPC').props.onClick()
await flush()
const toggleCall = calls.filter(call => call.options?.method === 'POST' && call.url === '/plugins/auto-shutdown').at(-1)
assert.ok(toggleCall !== undefined, 'the switch posted to /plugins/auto-shutdown')
assert.deepEqual(JSON.parse(toggleCall.options.body), { action: 'toggle', enabled: true })
assert.equal(toggleCall.options.headers['content-type'], 'application/json')
assert.equal(toggleCall.options.headers.accept, 'application/json')
tree = render(sectionComponent, {})
assert.equal(switchOf(tree, 'Auto-ShutdownPC').props['aria-checked'], 'true', 'the Host answer is adopted')
console.log('ok 4 shutdown toggle posted:', toggleCall.options.body)

// 5. Clicking the auto-continue switch posts to the other plugin's route.
calls.length = 0
tree = await mountSection({ localeId: 'en', shutdownState: OFF_SHUTDOWN, continueState: OFF_CONTINUE })
await switchOf(tree, 'Auto-continue after usage limits').props.onClick()
await flush()
const continueCall = calls.filter(call => call.options?.method === 'POST' && call.url === '/plugins/auto-continue').at(-1)
assert.ok(continueCall !== undefined, 'the switch posted to /plugins/auto-continue')
assert.deepEqual(JSON.parse(continueCall.options.body), { action: 'toggle', enabled: true })
assert.equal(calls.filter(call => call.options?.method === 'POST' && call.url === '/plugins/auto-shutdown').length, 0, 'the other route was untouched')
console.log('ok 5 auto-continue toggle posted:', continueCall.options.body)

// 6. A second click while the first is in flight never reaches the Host.
calls.length = 0
tree = await mountSection({ localeId: 'en', shutdownState: OFF_SHUTDOWN, continueState: OFF_CONTINUE })
const busySwitch = switchOf(tree, 'Auto-ShutdownPC')
busySwitch.props.onClick()
busySwitch.props.onClick()
await flush()
assert.equal(calls.filter(call => call.options?.method === 'POST' && call.url === '/plugins/auto-shutdown').length, 1, 'the switch did not double-fire')
console.log('ok 6 no double fire')

// 7. A pending shutdown shows the countdown and a way to call it off.
const armed = {
  ...OFF_SHUTDOWN,
  enabled: true,
  pending: { sessionId: 'abc-123', armedAt: Date.now(), dueAt: Date.now() + 90_000, delaySeconds: 120 },
}
calls.length = 0
tree = await mountSection({ localeId: 'th', shutdownState: armed, continueState: OFF_CONTINUE })
assert.match(textOf(tree), /รอปิดเครื่อง/u, 'the pending row renders')
assert.match(textOf(tree), /จะปิดเครื่องในอีก/u, 'the countdown renders')
assert.match(textOf(tree), /1 น\./u, 'the countdown reads minutes')
assert.match(textOf(tree), /30 ว\./u, 'the countdown reads seconds')
const cancel = find(tree, node => node.type === 'button' && String(node.props?.className ?? '').includes('dshas_buttonDanger'))
assert.ok(cancel !== undefined, 'the cancel control renders')
assert.match(textOf(cancel), /ยกเลิกการปิดเครื่อง/u)
await cancel.props.onClick()
await flush()
const cancelCall = calls.filter(call => call.options?.method === 'POST' && call.url === '/plugins/auto-shutdown').at(-1)
assert.deepEqual(JSON.parse(cancelCall.options.body), { action: 'cancel' })
console.log('ok 7 pending countdown and cancel:', cancelCall.options.body)

// 8. A platform that cannot power the computer down disables that switch.
const unsupported = { ...OFF_SHUTDOWN, supported: false }
tree = await mountSection({ localeId: 'en', shutdownState: unsupported, continueState: OFF_CONTINUE })
const deadSwitch = switchOf(tree, 'Auto-ShutdownPC')
assert.equal(deadSwitch.props.disabled, true, 'the switch is disabled')
assert.match(textOf(tree), /This platform cannot power the computer down/u)
assert.doesNotMatch(textOf(tree), /Warning: this switch really powers the computer down/u)
console.log('ok 8 unsupported platform disabled')

// 9. The composer chip renders beside the auto-continue chip.
assert.equal(slots.dock[0].options.id, 'auto-shutdown')
assert.equal(slots.dock[0].options.order, 4)
assert.equal(slots.dock[0].options.name, 'conversation.composer.dock')
tree = await mountChip({ localeId: 'en', state: OFF_SHUTDOWN })
const stat = find(tree, node => node.props?.['data-composer-stat'] !== undefined)
assert.ok(stat !== undefined, 'the chip carries a composer stat')
assert.equal(stat.props['data-composer-stat'], 'auto-shutdown')
const chipButton = find(tree, node => node.props?.['data-auto-shutdown'] !== undefined)
assert.equal(chipButton.props['data-auto-shutdown'], 'off')
assert.match(textOf(tree), /Shutdown: off/u)
console.log('ok 9 composer chip off:', textOf(tree))

// 10. The chip turns the switch on and shows the countdown while one is armed.
calls.length = 0
tree = await mountChip({ localeId: 'en', state: OFF_SHUTDOWN })
await find(tree, node => node.props?.['data-auto-shutdown'] !== undefined).props.onClick()
await flush()
const chipToggle = calls.filter(call => call.options?.method === 'POST' && call.url === '/plugins/auto-shutdown').at(-1)
assert.deepEqual(JSON.parse(chipToggle.options.body), { action: 'toggle', enabled: true })
tree = await mountChip({ localeId: 'en', state: { ...OFF_SHUTDOWN, enabled: true, pending: armed.pending } })
assert.equal(find(tree, node => node.props?.['data-auto-shutdown'] !== undefined).props['data-auto-shutdown'], 'waiting')
assert.match(textOf(tree), /Shutdown in/u)
const chipCancel = find(tree, node => node.type === 'button' && node.children.includes('×'))
assert.ok(chipCancel !== undefined, 'the chip offers a cancel control')
await chipCancel.props.onClick()
await flush()
const chipCancelCall = calls.filter(call => call.options?.method === 'POST' && call.url === '/plugins/auto-shutdown').at(-1)
assert.deepEqual(JSON.parse(chipCancelCall.options.body), { action: 'cancel' })
console.log('ok 10 chip toggle and cancel posted')

// 11. The Thai and Chinese copy is complete.
const dictionaries = locale.dicts.get(NS)
assert.ok(dictionaries !== undefined, 'the dictionaries registered under the plugin namespace')
for (const id of ['en', 'th', 'zh']) {
  assert.ok(dictionaries[id] !== undefined, `${id} dictionary registered`)
  assert.equal(typeof dictionaries[id].meta.title, 'string', `${id} meta title`)
  assert.equal(typeof dictionaries[id].meta.description, 'string', `${id} meta description`)
}
const enKeys = Object.keys(dictionaries.en).sort()
assert.deepEqual(Object.keys(dictionaries.th).sort(), enKeys, 'Thai carries every English key')
assert.deepEqual(Object.keys(dictionaries.zh).sort(), enKeys, 'Chinese carries every English key')
assert.ok(enKeys.includes('nav'))
assert.equal(dictionaries.en.meta.title, 'Auto-shutdown the PC after a session finishes')
console.log('ok 11 dictionaries complete:', enKeys.length, 'keys in en/th/zh')

// 12. A failed fetch leaves the section quiet instead of crashing.
globalThis.fetch = async () => {
  throw new Error('offline')
}
mountHooks()
tree = render(sectionComponent, {})
await flush()
tree = render(sectionComponent, {})
assert.match(textOf(tree), /The action failed/u)
console.log('ok 12 a failed fetch is reported')

console.log('\nall 12 render checks passed')
// The chip keeps a polling timer alive, exactly as it does in the page.
process.exit(0)
