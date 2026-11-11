// Logic harness for dsh-auto-shutdown's Host half: a fake Cordis context, a fake
// HTTP route, and fake operating-system commands. Proves the toggle, the arming
// and the cancelling rules without ever touching the real machine.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const pluginDir = new URL('../', import.meta.url)
const statePath = fileURLToPath(new URL('state.json', pluginDir))
if (existsSync(statePath)) rmSync(statePath)

const { apply, Config, commands } = await import(new URL('index.js', pluginDir).href)

/** Every command the plugin asked for, instead of running it. */
const calls = []
commands.supported = () => true
commands.powerOff = async (delaySeconds, message) => {
  calls.push(['powerOff', delaySeconds, message])
  return { ok: true, stdout: '', stderr: '' }
}
commands.cancel = async () => {
  calls.push(['cancel'])
  return { ok: true, stdout: '', stderr: '' }
}

/** Fake Host context: listener registry, effect runner, HTTP route. */
function fakeContext() {
  const handlers = new Map()
  const routes = []
  const logs = []
  const ctx = {
    logs,
    handlers,
    routes,
    logger: {
      info: (message) => logs.push(['info', message]),
      warn: (message) => logs.push(['warn', message]),
    },
    get: () => undefined,
    on: (name, handler) => {
      const list = handlers.get(name) ?? []
      list.push(handler)
      handlers.set(name, list)
      return () => {
        const current = handlers.get(name) ?? []
        handlers.set(name, current.filter(entry => entry !== handler))
      }
    },
    effect: (fn) => {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => undefined
    },
    webServer: {
      getOrigin: () => 'http://127.0.0.1:54588',
      register: (route) => {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
    },
  }
  return ctx
}

/** Call the registered Host route with a synthetic request. */
async function request(ctx, method, body) {
  const route = ctx.routes[0]
  assert.ok(route !== undefined, 'no route registered')
  const req = new EventEmitter()
  req.method = method
  req.url = route.path
  const response = {
    status: undefined,
    headers: undefined,
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
  }
  const answered = new Promise((resolve, reject) => {
    response.end = (text) => {
      response.body = text ?? ''
      resolve()
    }
    setTimeout(() => reject(new Error('route did not answer')), 5000)
  })
  route.handler(req, response)
  if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
  req.emit('end')
  await answered
  return { status: response.status, json: JSON.parse(response.body) }
}

/** Deliver one session event to the plugin. */
function emit(ctx, session, event) {
  const handlers = ctx.handlers.get('session/event') ?? []
  assert.ok(handlers.length > 0, 'no session/event listener')
  handlers[0](session, event)
}

const settle = () => new Promise(resolve => setTimeout(resolve, 50))

const ctx = fakeContext()
await apply(ctx, Config({}))

// 1. Fresh state: off, supported, nothing armed.
let state = await request(ctx, 'GET')
assert.equal(state.status, 200)
assert.equal(state.json.enabled, false)
assert.equal(state.json.supported, true)
assert.equal(state.json.pending, null)
assert.equal(state.json.delaySeconds, 120)
console.log('ok 1 fresh state:', JSON.stringify(state.json))

// 2. While the switch is off a finished session never arms a shutdown.
emit(ctx, { id: 'session-test', header: { id: 'session-test', isSeeded: false } }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
await settle()
assert.equal(calls.length, 0)
console.log('ok 2 off arms nothing')

// 3. Turning the switch on persists the choice.
state = await request(ctx, 'POST', { action: 'toggle', enabled: true })
assert.equal(state.json.enabled, true)
assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).enabled, true)
console.log('ok 3 switch on persisted')

// 4. A finished session arms the operating system's own countdown.
emit(ctx, { id: 'session-test', header: { id: 'session-test', isSeeded: false } }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
await settle()
assert.equal(calls.length, 1)
assert.equal(calls[0][0], 'powerOff')
assert.equal(calls[0][1], 120)
assert.ok(typeof calls[0][2] === 'string' && calls[0][2].length > 0, 'the system message is empty')
state = await request(ctx, 'GET')
assert.notEqual(state.json.pending, null)
assert.equal(state.json.pending.sessionId, 'session-test')
assert.equal(state.json.pending.delaySeconds, 120)
assert.ok(state.json.pending.dueAt > state.json.pending.armedAt, 'the countdown does not run forward')
console.log('ok 4 armed:', JSON.stringify(state.json.pending))

// 5. A new message from the user releases the machine again.
emit(ctx, { id: 'session-test', header: { id: 'session-test', isSeeded: false } }, { type: 'user/message', data: { content: [{ type: 'text', text: 'wait' }], source: { kind: 'user' } } })
await settle()
assert.equal(calls.length, 2)
assert.equal(calls[1][0], 'cancel')
state = await request(ctx, 'GET')
assert.equal(state.json.pending, null)
console.log('ok 5 a user message cancelled the countdown')

// 6. A stopped turn is not finished work.
emit(ctx, { id: 'session-test', header: { id: 'session-test', isSeeded: false } }, { type: 'turn/end', data: { turn: 2, reason: { kind: 'aborted' } } })
await settle()
assert.equal(calls.length, 2)
console.log('ok 6 a stopped turn arms nothing')

// 7. A delegated child session never releases the machine.
emit(ctx, { id: 'session-child', header: { id: 'session-child', isSeeded: false, parentSession: 'session-test' } }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
await settle()
assert.equal(calls.length, 2)
console.log('ok 7 a subagent arms nothing')

// 8. Turning the switch off releases a countdown that is already running.
emit(ctx, { id: 'session-test', header: { id: 'session-test', isSeeded: false } }, { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } })
await settle()
assert.equal(calls.length, 3)
state = await request(ctx, 'POST', { action: 'toggle', enabled: false })
assert.equal(state.json.enabled, false)
assert.equal(state.json.pending, null)
assert.equal(calls.length, 4)
assert.equal(calls[3][0], 'cancel')
assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).enabled, false)
console.log('ok 8 turning the switch off cancelled the countdown')

// 9. The explicit arm action refuses while the switch is off.
state = await request(ctx, 'POST', { action: 'arm', sessionId: 'session-test', delaySeconds: 45 })
assert.equal(state.json.pending, null)
assert.equal(calls.length, 4)
console.log('ok 9 arming while off does nothing')

// 10. With the switch on the arm action arms, and the countdown is bounded.
await request(ctx, 'POST', { action: 'toggle', enabled: true })
state = await request(ctx, 'POST', { action: 'arm', sessionId: 'session-test', delaySeconds: 5 })
assert.notEqual(state.json.pending, null)
assert.equal(calls[calls.length - 1][1], 30, 'the countdown is not shorter than the floor')
await request(ctx, 'POST', { action: 'arm', sessionId: 'session-test', delaySeconds: 999999 })
assert.equal(calls[calls.length - 1][1], 3600, 'the countdown is not longer than the ceiling')
console.log('ok 10 the countdown is bounded')

// 11. The explicit cancel action releases the machine.
state = await request(ctx, 'POST', { action: 'cancel' })
assert.equal(state.json.pending, null)
assert.equal(calls[calls.length - 1][0], 'cancel')
console.log('ok 11 explicit cancel')

// The auto-continue plugin owns the answer to "will this session be picked up
// again?". The stub below stands in for its route.
const realFetch = globalThis.fetch
let continuationState = { enabled: false, supported: true, pending: [] }
globalThis.fetch = async (url) => {
  const address = String(url)
  if (!address.includes('/plugins/auto-continue')) throw new Error(`unexpected request: ${address}`)
  return {
    ok: true,
    status: 200,
    json: async () => continuationState,
    body: { cancel: async () => undefined },
  }
}
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const armedCount = () => calls.filter(call => call[0] === 'powerOff').length
const limitReason = { kind: 'error', error: { code: 'QUOTA', message: 'quota exceeded', status: 402 } }

// 12. A spent usage limit with Auto-continue off releases the machine.
continuationState = { enabled: false, supported: true, pending: [] }
const ctx5 = fakeContext()
await apply(ctx5, Config({ settleAttempts: 2, settleIntervalMs: 10 }))
await request(ctx5, 'POST', { action: 'toggle', enabled: true })
const beforeLimit = armedCount()
emit(ctx5, { id: 'session-limit', header: { id: 'session-limit', isSeeded: false } }, { type: 'turn/end', data: { turn: 1, reason: limitReason } })
await wait(300)
assert.equal(armedCount(), beforeLimit + 1, 'a spent limit with Auto-continue off did not release the machine')
console.log('ok 12 a spent limit with Auto-continue off releases the machine')

// 13. A spent usage limit with Auto-continue on keeps the machine on while a
//     continuation is booked for that session.
continuationState = { enabled: true, supported: true, pending: [{ sessionId: 'session-limit', dueAt: Date.now() + 600000, attempts: 1, provider: 'minimax-api', source: 'quota', taskId: 'task-1' }] }
const ctx6 = fakeContext()
await apply(ctx6, Config({ settleAttempts: 3, settleIntervalMs: 10 }))
await request(ctx6, 'POST', { action: 'toggle', enabled: true })
const beforeResume = armedCount()
emit(ctx6, { id: 'session-limit', header: { id: 'session-limit', isSeeded: false } }, { type: 'turn/end', data: { turn: 1, reason: limitReason } })
await wait(300)
assert.equal(armedCount(), beforeResume, 'the machine was released while the session was going to resume')
console.log('ok 13 a session that resumes keeps the machine on')

// 14. A spent usage limit with Auto-continue on releases the machine when
//     nothing booked a continuation for that session.
continuationState = { enabled: true, supported: true, pending: [] }
const ctx7 = fakeContext()
await apply(ctx7, Config({ settleAttempts: 2, settleIntervalMs: 10 }))
await request(ctx7, 'POST', { action: 'toggle', enabled: true })
const beforeStuck = armedCount()
emit(ctx7, { id: 'session-limit', header: { id: 'session-limit', isSeeded: false } }, { type: 'turn/end', data: { turn: 1, reason: limitReason } })
await wait(300)
assert.equal(armedCount(), beforeStuck + 1, 'a session nothing will resume did not release the machine')
console.log('ok 14 a session nothing will resume releases the machine')

// 15. A failure that is not a spent limit never releases the machine.
continuationState = { enabled: false, supported: true, pending: [] }
const ctx8 = fakeContext()
await apply(ctx8, Config({ settleAttempts: 2, settleIntervalMs: 10 }))
await request(ctx8, 'POST', { action: 'toggle', enabled: true })
const beforeOther = armedCount()
emit(ctx8, { id: 'session-limit', header: { id: 'session-limit', isSeeded: false } }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { code: 'SERVER', message: 'boom', status: 500 } } } })
await wait(300)
assert.equal(armedCount(), beforeOther, 'an ordinary failure released the machine')
console.log('ok 15 an ordinary failure releases nothing')

globalThis.fetch = realFetch

// 16. A restart honours the stored choice.
writeFileSync(statePath, `${JSON.stringify({ enabled: false }, null, 2)}\n`, 'utf8')
const ctx2 = fakeContext()
await apply(ctx2, Config({}))
state = await request(ctx2, 'GET')
assert.equal(state.json.enabled, false)
writeFileSync(statePath, `${JSON.stringify({ enabled: true }, null, 2)}\n`, 'utf8')
const ctx3 = fakeContext()
await apply(ctx3, Config({}))
state = await request(ctx3, 'GET')
assert.equal(state.json.enabled, true)
console.log('ok 16 restart honoured the stored choice')

// 17. A platform that cannot power itself down says so, and arms nothing.
const armedBefore = calls.filter(call => call[0] === 'powerOff').length
commands.supported = () => false
const ctx4 = fakeContext()
await apply(ctx4, Config({}))
state = await request(ctx4, 'GET')
assert.equal(state.json.supported, false)
emit(ctx4, { id: 'session-test', header: { id: 'session-test', isSeeded: false } }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
await settle()
assert.equal(calls.filter(call => call[0] === 'powerOff').length, armedBefore, 'the unsupported platform armed a shutdown')
console.log('ok 17 an unsupported platform arms nothing')

rmSync(statePath)
writeFileSync(statePath, `${JSON.stringify({ enabled: false }, null, 2)}\n`, 'utf8')
console.log('\nall 17 checks passed')
