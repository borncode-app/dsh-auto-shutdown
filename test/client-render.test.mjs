// Render harness for dsh-auto-shutdown's Web half: a miniature hook runtime, a
// fake locale service, a fake fetch, and the real client module. Proves the
// settings section is an overview of the per-conversation switches (it renders
// no switch of its own), that its counts follow the sessions the Host reports,
// that the machine-wide countdown still shows and can be cancelled, that
// "turn every switch off" reaches both plugins once, and that the composer chip
// keeps its per-session behaviour.
import { readFileSync } from 'node:fs'
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

/** The button whose visible text is exactly the given text. */
const buttonOf = (tree, text) => find(tree, node => node.type === 'button' && textOf(node) === text)

/** The POSTs one fake route received, in order. */
const postsTo = (route) => calls.filter(call => call.options?.method === 'POST' && call.url.split('?')[0] === route)

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
assert.equal(slots.sections.length, 1, 'exactly one settings section registered')
assert.equal(slots.icons.length, 1, 'exactly one section icon registered')
assert.equal(slots.icons[0].options.id, 'automation', 'the icon answers the section id')
assert.equal(slots.dock.length, 1, 'exactly one composer chip registered')

const sectionComponent = section.component
const chipComponent = slots.dock[0].component
assert.equal(typeof sectionComponent, 'function', 'section component registered')
assert.equal(typeof chipComponent, 'function', 'chip component registered')

// --- fake Host state and fetch ---------------------------------------------
const calls = []
let shutdown = {
  revision: '2026-11-12.3',
  sessionId: null,
  enabled: false,
  supported: true,
  platform: 'win32',
  delaySeconds: 120,
  now: Date.now(),
  sessions: [],
  pendingHere: false,
  pending: null,
}
let continuation = {
  revision: '2026-11-12.6',
  sessionId: null,
  enabled: false,
  supported: true,
  now: Date.now(),
  pending: [],
  sessions: [],
}
globalThis.fetch = async (url, options = {}) => {
  const address = String(url)
  const route = address.split('?')[0]
  calls.push({ url: address, options })
  if (options.method === 'POST') {
    const request = JSON.parse(options.body)
    if (route === '/plugins/auto-shutdown') {
      if (request.action === 'cancel') shutdown = { ...shutdown, pending: null, pendingHere: false }
      if (request.action === 'off-all') shutdown = { ...shutdown, sessions: [], pending: null, pendingHere: false }
      if (request.action === 'toggle') {
        shutdown = {
          ...shutdown,
          enabled: typeof request.enabled === 'boolean' ? request.enabled : !shutdown.enabled,
          sessionId: typeof request.sessionId === 'string' ? request.sessionId : null,
        }
      }
    }
    if (route === '/plugins/auto-continue' && request.action === 'toggle') {
      const others = continuation.sessions.filter(id => id !== request.sessionId)
      continuation = { ...continuation, sessions: request.enabled === false ? others : [...others, request.sessionId] }
    }
    return { ok: true, json: async () => (route === '/plugins/auto-shutdown' ? shutdown : continuation) }
  }
  return { ok: true, json: async () => (route === '/plugins/auto-shutdown' ? shutdown : continuation) }
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

const OFF_SHUTDOWN = {
  revision: '2026-11-12.3',
  sessionId: null,
  enabled: false,
  supported: true,
  platform: 'win32',
  delaySeconds: 120,
  now: Date.now(),
  sessions: [],
  pendingHere: false,
  pending: null,
}
const OFF_CONTINUE = { revision: '2026-11-12.6', sessionId: null, enabled: false, supported: true, now: Date.now(), pending: [], sessions: [] }

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

// 2. The section renders both status rows and no switch of its own.
let tree = await mountSection({ localeId: 'en', shutdownState: OFF_SHUTDOWN, continueState: OFF_CONTINUE })
let text = textOf(tree)
assert.equal(findAll(tree, node => node.props?.role === 'switch').length, 0, 'the section renders no switch')
assert.equal(findAll(tree, node => String(node.props?.className ?? '').split(' ').includes('dshas_statusLine')).length, 2, 'both status rows render')
assert.match(text, /Auto-continue after usage limits/u, 'the auto-continue row renders')
assert.match(text, /Auto-ShutdownPC/u, 'the auto-shutdown row renders')
assert.match(text, /under the composer of the conversation you mean/u, 'the intro points at the composer switch')
assert.match(text, /Warning: this switch really powers the computer down/u, 'the red warning stays')
console.log('ok 2 both status rows, no switches')

// 3. The count wording follows the sessions the Host reports.
text = textOf(tree)
assert.equal((text.match(/No conversation has it on/gu) ?? []).length, 2, 'both rows say nothing is on')
tree = await mountSection({
  localeId: 'en',
  shutdownState: { ...OFF_SHUTDOWN, sessions: ['shutdown-a', 'shutdown-b'] },
  continueState: { ...OFF_CONTINUE, sessions: ['continue-a', 'continue-b'] },
})
text = textOf(tree)
assert.equal((text.match(/2 conversations on/gu) ?? []).length, 2, 'both rows count their own sessions')
assert.doesNotMatch(text, /No conversation has it on/u)
console.log('ok 3 counts follow the sessions arrays')

// 4. An unsupported platform is reported instead of a count.
tree = await mountSection({
  localeId: 'en',
  shutdownState: { ...OFF_SHUTDOWN, supported: false, platform: 'linux' },
  continueState: { ...OFF_CONTINUE, supported: false },
})
text = textOf(tree)
assert.match(text, /Automatic continuation needs the schedule service/u, 'auto-continue reports the missing service')
assert.match(text, /This platform cannot power the computer down, so this switch stays off/u, 'auto-shutdown reports the platform')
assert.doesNotMatch(text, /Warning: this switch really powers the computer down/u, 'the warning is not claimed where it cannot fire')
assert.doesNotMatch(text, /No conversation has it on/u, 'an unsupported row shows no count')
console.log('ok 4 unsupported platform reported')

// 5. A pending shutdown shows the countdown and a way to call it off.
const armedPending = { sessionId: 'abc-123', armedAt: Date.now(), dueAt: Date.now() + 90_000, delaySeconds: 120 }
const armed = { ...OFF_SHUTDOWN, enabled: true, sessions: ['abc-123'], pending: armedPending, pendingHere: true }
calls.length = 0
tree = await mountSection({ localeId: 'th', shutdownState: armed, continueState: OFF_CONTINUE })
text = textOf(tree)
assert.match(text, /รอปิดเครื่อง/u, 'the pending row renders')
assert.match(text, /จะปิดเครื่องในอีก/u, 'the countdown renders')
assert.match(text, /1 น\./u, 'the countdown reads minutes')
assert.match(text, /30 ว\./u, 'the countdown reads seconds')
const cancel = buttonOf(tree, 'ยกเลิกการปิดเครื่อง')
assert.ok(cancel !== undefined, 'the cancel control renders')
await cancel.props.onClick()
await flush()
const cancelPosts = postsTo('/plugins/auto-shutdown')
assert.equal(cancelPosts.length, 1, 'the cancel control posted once')
assert.deepEqual(JSON.parse(cancelPosts[0].options.body), { action: 'cancel' })
console.log('ok 5 pending countdown and cancel:', cancelPosts[0].options.body)

// 6. "Turn every switch off" reaches both plugins, then reloads both states.
calls.length = 0
tree = await mountSection({
  localeId: 'en',
  shutdownState: { ...OFF_SHUTDOWN, sessions: ['shutdown-a'] },
  continueState: { ...OFF_CONTINUE, sessions: ['continue-a', 'continue-b'] },
})
const offAll = buttonOf(tree, 'Turn every switch off')
assert.ok(offAll !== undefined, 'the danger button renders')
assert.match(String(offAll.props.className), /dshas_buttonDanger/u, 'it is a danger button')
offAll.props.onClick()
const busyTree = render(sectionComponent, {})
assert.equal(buttonOf(busyTree, 'Turn every switch off').props.disabled, true, 'the button is disabled while busy')
await flush()
const shutdownPosts = postsTo('/plugins/auto-shutdown')
const continuePosts = postsTo('/plugins/auto-continue')
assert.equal(shutdownPosts.length, 1, 'the shutdown route was posted once')
assert.deepEqual(JSON.parse(shutdownPosts[0].options.body), { action: 'off-all' })
assert.equal(shutdownPosts[0].options.headers['content-type'], 'application/json')
assert.equal(shutdownPosts[0].options.headers.accept, 'application/json')
assert.equal(continuePosts.length, 2, 'one toggle per auto-continue session')
assert.deepEqual(
  continuePosts.map(call => JSON.parse(call.options.body)),
  [
    { action: 'toggle', enabled: false, sessionId: 'continue-a' },
    { action: 'toggle', enabled: false, sessionId: 'continue-b' },
  ],
)
const settled = render(sectionComponent, {})
assert.equal(buttonOf(settled, 'Turn every switch off').props.disabled, false, 'the button is usable again')
assert.equal((textOf(settled).match(/No conversation has it on/gu) ?? []).length, 2, 'both counts reloaded as empty')
console.log('ok 6 turn every switch off:', JSON.stringify(shutdownPosts[0].options.body), continuePosts.length, 'continue toggles')

// 7. The three dictionaries carry the same keys, and the locale files match.
const dictionaries = locale.dicts.get(NS)
assert.ok(dictionaries !== undefined, 'the dictionaries registered under the plugin namespace')
const enKeys = Object.keys(dictionaries.en).sort()
assert.deepEqual(Object.keys(dictionaries.th).sort(), enKeys, 'Thai carries every English key')
assert.deepEqual(Object.keys(dictionaries.zh).sort(), enKeys, 'Chinese carries every English key')
for (const id of ['en', 'th', 'zh']) {
  assert.equal(typeof dictionaries[id].meta.title, 'string', `${id} meta title`)
  assert.equal(typeof dictionaries[id].meta.description, 'string', `${id} meta description`)
  const file = JSON.parse(readFileSync(new URL(`../locale/${id}.json`, import.meta.url), 'utf8'))
  assert.deepEqual(file, dictionaries[id], `locale/${id}.json matches the registered ${id} dictionary`)
  for (const key of ['intro', 'autoContinueHint', 'autoShutdownHint', 'countOn', 'countNone', 'offAll', 'offAllHint']) {
    assert.equal(typeof dictionaries[id][key], 'string', `${id} carries ${key}`)
  }
}
assert.equal(dictionaries.en.countOn, '{count} conversations on')
assert.equal(dictionaries.en.countNone, 'No conversation has it on')
assert.equal(dictionaries.en.offAll, 'Turn every switch off')
assert.equal(dictionaries.en.meta.title, 'Auto-shutdown the PC after a session finishes')
console.log('ok 7 dictionaries complete:', enKeys.length, 'keys in en/th/zh and in locale/*.json')

// 8. The composer chip stays per session: off label, toggle, own countdown only.
assert.equal(slots.dock[0].options.id, 'auto-shutdown')
assert.equal(slots.dock[0].options.order, 4)
assert.equal(slots.dock[0].options.name, 'conversation.composer.dock')
calls.length = 0
tree = await mountChip({ localeId: 'en', state: OFF_SHUTDOWN })
const stat = find(tree, node => node.props?.['data-composer-stat'] !== undefined)
assert.ok(stat !== undefined, 'the chip carries a composer stat')
assert.equal(stat.props['data-composer-stat'], 'auto-shutdown')
assert.equal(find(tree, node => node.props?.['data-auto-shutdown'] !== undefined).props['data-auto-shutdown'], 'off')
assert.match(textOf(tree), /Shutdown: off/u, 'the chip reads off')
await find(tree, node => node.props?.['data-auto-shutdown'] !== undefined).props.onClick()
await flush()
const chipToggle = postsTo('/plugins/auto-shutdown').at(-1)
assert.ok(chipToggle !== undefined, 'the chip posted to its own route')
assert.deepEqual(JSON.parse(chipToggle.options.body), { action: 'toggle', enabled: true, sessionId: 'session-1' })
assert.equal(JSON.parse(chipToggle.options.body).sessionId, 'session-1', 'the chip sends its session id')
tree = await mountChip({
  localeId: 'en',
  state: { ...OFF_SHUTDOWN, enabled: true, sessions: ['session-1'], pending: armedPending, pendingHere: true },
})
assert.match(textOf(tree), /Shutdown in/u, 'the owning conversation sees its countdown')
assert.ok(buttonOf(tree, '×') !== undefined, 'the owning conversation can cancel')
tree = await mountChip({
  localeId: 'en',
  state: { ...OFF_SHUTDOWN, enabled: true, sessions: ['session-1'], pending: armedPending, pendingHere: false },
})
assert.doesNotMatch(textOf(tree), /Shutdown in/u, 'another conversation never sees the countdown')
assert.match(textOf(tree), /Shutdown: on/u, 'it still reads its own switch as on')
assert.equal(buttonOf(tree, '×'), undefined, 'it offers no cancel control')
console.log('ok 8 composer chip per session:', chipToggle.options.body)

// 9. The danger button never fires twice, even when clicked twice at once.
calls.length = 0
tree = await mountSection({
  localeId: 'en',
  shutdownState: OFF_SHUTDOWN,
  continueState: { ...OFF_CONTINUE, sessions: ['continue-a', 'continue-b'] },
})
const twice = buttonOf(tree, 'Turn every switch off')
twice.props.onClick()
twice.props.onClick()
await flush()
assert.equal(postsTo('/plugins/auto-shutdown').length, 1, 'off-all reached the Host once')
assert.equal(postsTo('/plugins/auto-continue').length, 2, 'each auto-continue session was switched off once')
console.log('ok 9 turn every switch off never double-fires')

// 10. A failed fetch leaves the section quiet instead of crashing.
globalThis.fetch = async () => {
  throw new Error('offline')
}
mountHooks()
tree = render(sectionComponent, {})
await flush()
tree = render(sectionComponent, {})
assert.match(textOf(tree), /The action failed/u)
console.log('ok 10 a failed fetch is reported')

console.log('\nall 10 render checks passed')
// The section and the chip keep polling timers alive, exactly as they do in the page.
process.exit(0)
