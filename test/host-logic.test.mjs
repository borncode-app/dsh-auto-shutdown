// Logic harness for dsh-auto-shutdown's Host half: a fake Cordis context, a fake
// HTTP route, and fake operating-system commands. Proves the per-session switch,
// the arming and the cancelling rules without ever touching the real machine.
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

const armedCount = () => calls.filter(call => call[0] === 'powerOff').length
const writeState = (value) => writeFileSync(statePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

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
async function request(ctx, method, body, sessionId) {
  const route = ctx.routes[0]
  assert.ok(route !== undefined, 'no route registered')
  const req = new EventEmitter()
  req.method = method
  req.url = sessionId === undefined ? route.path : `${route.path}?sessionId=${encodeURIComponent(sessionId)}`
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
function emit(ctx, sessionId, event, header = {}) {
  const handlers = ctx.handlers.get('session/event') ?? []
  assert.ok(handlers.length > 0, 'no session/event listener')
  handlers[0]({ id: sessionId, header: { id: sessionId, isSeeded: false, ...header } }, event)
}

const settle = () => wait(60)
const completed = (turn = 1) => ({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
const stopped = (turn = 1) => ({ type: 'turn/end', data: { turn, reason: { kind: 'aborted' } } })
const limitFailure = () => ({ code: 'QUOTA', message: 'quota exceeded', status: 402 })
const limitReason = { kind: 'error', error: limitFailure() }
const userMessage = (text = 'wait') => ({ type: 'user/message', data: { content: [{ type: 'text', text }], source: { kind: 'user' } } })

const A = 'session-a'
const B = 'session-b'

const ctx = fakeContext()
await apply(ctx, Config({}))

// 1. A fresh install: no session is armed, nothing is running.
let state = await request(ctx, 'GET', undefined, A)
assert.equal(state.status, 200)
assert.equal(state.json.enabled, false)
assert.equal(state.json.supported, true)
assert.equal(state.json.pending, null)
assert.deepEqual(state.json.sessions, [])
console.log('ok 1 fresh state:', JSON.stringify({ enabled: state.json.enabled, sessions: state.json.sessions }))

// 2. A session that was never switched on arms nothing.
emit(ctx, A, completed())
await settle()
assert.equal(armedCount(), 0)
console.log('ok 2 an unarmed session arms nothing')

// 3. Turning one session on persists that session only.
state = await request(ctx, 'POST', { action: 'toggle', enabled: true, sessionId: A }, A)
assert.equal(state.json.enabled, true)
assert.deepEqual(state.json.sessions, [A])
assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).sessions, { [A]: true })
console.log('ok 3 session A switched on and persisted')

// 4. Another session keeps the default, and a toggle without a session is refused.
state = await request(ctx, 'GET', undefined, B)
assert.equal(state.json.enabled, false, 'session B inherited session A state')
const refused = await request(ctx, 'POST', { action: 'toggle', enabled: true })
assert.equal(refused.status, 400)
console.log('ok 4 session B stays off and a sessionless toggle is refused')

// 5. The armed session arms the operating system countdown; the other one does not see it.
emit(ctx, A, completed())
await settle()
assert.equal(armedCount(), 1)
assert.equal(calls[0][0], 'powerOff')
assert.equal(calls[0][1], 120)
state = await request(ctx, 'GET', undefined, A)
assert.equal(state.json.pendingHere, true)
assert.equal(state.json.pending.sessionId, A)
state = await request(ctx, 'GET', undefined, B)
assert.equal(state.json.pendingHere, false, 'another session saw the countdown as its own')
assert.notEqual(state.json.pending, null, 'the machine-wide countdown must stay visible')
console.log('ok 5 the armed session armed the countdown')

// 6. A message in a different session does not take the countdown back.
emit(ctx, B, userMessage())
await settle()
assert.equal(armedCount(), 1)
assert.equal(calls.filter(call => call[0] === 'cancel').length, 0, 'another session cancelled the countdown')
console.log('ok 6 a message in another session is ignored')

// 7. A message in the armed session does take it back.
emit(ctx, A, userMessage())
await settle()
assert.equal(calls.filter(call => call[0] === 'cancel').length, 1)
state = await request(ctx, 'GET', undefined, A)
assert.equal(state.json.pending, null)
console.log('ok 7 a message in the armed session cancelled the countdown')

// 8. A stopped turn is not finished work.
emit(ctx, A, stopped())
await settle()
assert.equal(armedCount(), 1)
console.log('ok 8 a stopped turn arms nothing')

// 9. A delegated child session never releases the machine.
emit(ctx, 'session-child', completed(), { parentSession: A })
await settle()
assert.equal(armedCount(), 1)
console.log('ok 9 a subagent arms nothing')

// 10. Turning the armed session off releases a countdown it started.
emit(ctx, A, completed())
await settle()
assert.equal(armedCount(), 2)
state = await request(ctx, 'POST', { action: 'toggle', enabled: false, sessionId: A }, A)
assert.equal(state.json.enabled, false)
assert.equal(state.json.pending, null)
assert.equal(calls.filter(call => call[0] === 'cancel').length, 2)
assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).sessions, {})
console.log('ok 10 turning the session off cancelled its countdown')

// 11. The explicit arm action refuses while that session is off.
state = await request(ctx, 'POST', { action: 'arm', sessionId: A, delaySeconds: 45 }, A)
assert.equal(state.json.pending, null)
assert.equal(armedCount(), 2)
console.log('ok 11 arming an unarmed session does nothing')

// 12. With the session on the arm action arms, and the countdown is bounded.
await request(ctx, 'POST', { action: 'toggle', enabled: true, sessionId: A }, A)
state = await request(ctx, 'POST', { action: 'arm', sessionId: A, delaySeconds: 5 }, A)
assert.notEqual(state.json.pending, null)
assert.equal(calls[calls.length - 1][1], 30, 'the countdown is not shorter than the floor')
await request(ctx, 'POST', { action: 'arm', sessionId: A, delaySeconds: 999999 }, A)
assert.equal(calls[calls.length - 1][1], 3600, 'the countdown is not longer than the ceiling')
console.log('ok 12 the countdown is bounded')

// 13. The explicit cancel action releases the machine.
state = await request(ctx, 'POST', { action: 'cancel' }, A)
assert.equal(state.json.pending, null)
assert.equal(calls[calls.length - 1][0], 'cancel')
console.log('ok 13 explicit cancel')

// The auto-continue plugin owns the answer to "will this session be picked up
// again?". The stub below stands in for its route.
const realFetch = globalThis.fetch
let continuationState = { enabled: false, supported: true, pending: [] }
globalThis.fetch = async (url) => {
  const address = String(url)
  if (!address.includes('/plugins/auto-continue')) throw new Error(`unexpected request: ${address}`)
  if (!address.includes('sessionId=')) throw new Error('the continuation probe dropped the session id')
  return {
    ok: true,
    status: 200,
    json: async () => continuationState,
    body: { cancel: async () => undefined },
  }
}
const smallSettle = (attempts) => Config({ settleAttempts: attempts, settleIntervalMs: 10 })

// 14. A spent usage limit with Auto-continue off releases the machine.
continuationState = { enabled: false, supported: true, pending: [] }
const ctx5 = fakeContext()
await apply(ctx5, smallSettle(2))
await request(ctx5, 'POST', { action: 'toggle', enabled: true, sessionId: A }, A)
const beforeLimit = armedCount()
emit(ctx5, A, { type: 'turn/end', data: { turn: 1, reason: limitReason } })
await wait(300)
assert.equal(armedCount(), beforeLimit + 1, 'a spent limit with Auto-continue off did not release the machine')
console.log('ok 14 a spent limit with Auto-continue off releases the machine')

// 15. A spent usage limit with Auto-continue on keeps the machine on while a
//     continuation is booked for that session.
continuationState = { enabled: true, supported: true, pending: [{ sessionId: A, dueAt: Date.now() + 600000, attempts: 1, provider: 'minimax-api', source: 'quota', taskId: 'task-1' }] }
const ctx6 = fakeContext()
await apply(ctx6, smallSettle(3))
await request(ctx6, 'POST', { action: 'toggle', enabled: true, sessionId: A }, A)
const beforeResume = armedCount()
emit(ctx6, A, { type: 'turn/end', data: { turn: 1, reason: limitReason } })
await wait(300)
assert.equal(armedCount(), beforeResume, 'the machine was released while the session was going to resume')
console.log('ok 15 a session that resumes keeps the machine on')

// 16. A spent usage limit with Auto-continue on releases the machine when
//     nothing booked a continuation for that session.
continuationState = { enabled: true, supported: true, pending: [] }
const ctx7 = fakeContext()
await apply(ctx7, smallSettle(2))
await request(ctx7, 'POST', { action: 'toggle', enabled: true, sessionId: A }, A)
const beforeStuck = armedCount()
emit(ctx7, A, { type: 'turn/end', data: { turn: 1, reason: limitReason } })
await wait(300)
assert.equal(armedCount(), beforeStuck + 1, 'a session nothing will resume did not release the machine')
console.log('ok 16 a session nothing will resume releases the machine')

// 17. A failure that is not a spent limit never releases the machine.
continuationState = { enabled: false, supported: true, pending: [] }
const ctx8 = fakeContext()
await apply(ctx8, smallSettle(2))
await request(ctx8, 'POST', { action: 'toggle', enabled: true, sessionId: A }, A)
const beforeOther = armedCount()
emit(ctx8, A, { type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { code: 'SERVER', message: 'boom', status: 500 } } } })
await wait(300)
assert.equal(armedCount(), beforeOther, 'an ordinary failure released the machine')
console.log('ok 17 an ordinary failure releases nothing')

globalThis.fetch = realFetch

// 18. The panic action turns every session off.
await request(ctx5, 'POST', { action: 'toggle', enabled: true, sessionId: B }, B)
state = await request(ctx5, 'POST', { action: 'off-all' })
assert.deepEqual(state.json.sessions, [])
state = await request(ctx5, 'GET', undefined, A)
assert.equal(state.json.enabled, false)
state = await request(ctx5, 'GET', undefined, B)
assert.equal(state.json.enabled, false)
console.log('ok 18 off-all released every session')

// 19. A restart honours the stored per-session choices.
writeState({ sessions: { [A]: true } })
const ctx2 = fakeContext()
await apply(ctx2, Config({}))
state = await request(ctx2, 'GET', undefined, A)
assert.equal(state.json.enabled, true)
state = await request(ctx2, 'GET', undefined, B)
assert.equal(state.json.enabled, false)
state = await request(ctx2, 'GET')
assert.equal(state.json.sessionId, null)
assert.equal(state.json.enabled, false, 'a sessionless poll must use the config default')
console.log('ok 19 restart honoured the stored choices')

// 20. A platform that cannot power itself down says so, and arms nothing.
const armedBefore = armedCount()
commands.supported = () => false
writeState({ sessions: { [A]: true } })
const ctx4 = fakeContext()
await apply(ctx4, Config({}))
state = await request(ctx4, 'GET', undefined, A)
assert.equal(state.json.supported, false)
emit(ctx4, A, completed())
await settle()
assert.equal(armedCount(), armedBefore, 'the unsupported platform armed a shutdown')
console.log('ok 20 an unsupported platform arms nothing')

rmSync(statePath)
writeState({ sessions: {} })
console.log('\nall 20 checks passed')
