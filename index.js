import z from '@deepseek-ai/schemastery'
import { execFile } from 'node:child_process'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/** File that keeps the user's on/off choice across restarts. */
const STATE_FILE = fileURLToPath(new URL('./state.json', import.meta.url))
/** Which generation of this file a running Host loaded; lives in every state answer. */
const REVISION = '2026-11-12.2'
/** How long the operating system waits before it powers the computer down. */
const DEFAULT_DELAY_SECONDS = 120
/** The shortest countdown the plugin arms; below this a reply could never arrive. */
const MIN_DELAY_SECONDS = 30
/** The longest countdown the plugin arms. */
const MAX_DELAY_SECONDS = 3600
/** The note Windows shows next to its own shutdown countdown dialog. */
const DEFAULT_MESSAGE = 'The Harness session finished, so this computer is shutting down. Run "shutdown /a" to cancel.'
/** Failure codes that mean a spent usage limit rather than a transient fault. */
const LIMIT_CODES = ['QUOTA', 'ACCOUNT_QUOTA', 'RATE_LIMIT']
/** How long the plugin waits for the operating system's answer. */
const COMMAND_TIMEOUT_MS = 15_000

export const Config = z.object({
  /** Path the Web GUI reads and posts the toggle to. */
  endpoint: z.string().default('/plugins/auto-shutdown'),
  /**
   * Whether a finished session powers the computer down. The Web GUI can change
   * this at runtime. It ships OFF: the switch is reversible, but a shutdown is
   * not.
   */
  enabled: z.boolean().default(false),
  /** Countdown the operating system shows before it powers the computer down. */
  delaySeconds: z.number().default(DEFAULT_DELAY_SECONDS),
  /** Shortest countdown the plugin arms. */
  minDelaySeconds: z.number().default(MIN_DELAY_SECONDS),
  /** Longest countdown the plugin arms. */
  maxDelaySeconds: z.number().default(MAX_DELAY_SECONDS),
  /**
   * Route of the plugin that resumes a session after a spent limit. The
   * shutdown plugin asks it whether this session will be picked up again.
   */
  continueEndpoint: z.string().default('/plugins/auto-continue'),
  /** Deadline for that question, in milliseconds. */
  continueTimeoutMs: z.number().default(8000),
  /**
   * How many times the plugin reads that answer before it decides the session
   * will not resume. The resuming plugin books its continuation in the
   * background — it first probes the provider for the reset time — so the
   * booking can land a moment after the turn ended.
   */
  settleAttempts: z.number().default(5),
  /** Gap between those reads, in milliseconds. */
  settleIntervalMs: z.number().default(3000),
  /** The note Windows shows next to its own shutdown countdown dialog. */
  message: z.string().default(DEFAULT_MESSAGE),
})

/** Hard service: the Host HTTP carrier that serves the toggle route. */
export const inject = ['webServer']

/** Run one Windows shutdown command and report what the operating system said. */
const runShutdown = (args) => new Promise((resolve) => {
  try {
    execFile('shutdown.exe', args, { windowsHide: true, timeout: COMMAND_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error === undefined || error === null) {
        resolve({ ok: true, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
        return
      }
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error), stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  } catch (error) {
    resolve({ ok: false, error: error instanceof Error ? error.message : String(error), stdout: '', stderr: '' })
  }
})

/**
 * The operating-system commands this plugin uses.
 *
 * This is the only place the plugin touches the machine. The test harness
 * replaces these entries so that no check can ever power a real computer down.
 * Nothing else in a deployment changes them.
 */
export const commands = {
  /** Whether this machine can power itself down through the plugin's path. */
  supported: () => process.platform === 'win32',
  /** Ask the operating system to power the computer down after a countdown. */
  powerOff: (delaySeconds, message) => runShutdown(['/s', '/t', String(delaySeconds), '/c', message]),
  /** Cancel a countdown the operating system already has running. */
  cancel: () => runShutdown(['/a']),
}

/**
 * Shut the computer down after a Harness session finishes.
 *
 * The plugin never powers the computer down on its own: it asks Windows to do it
 * with a visible countdown, the way the operating system's own "Shut down" does.
 * Windows shows its own dialog during that countdown and aborts the shutdown
 * when the user cancels it, so the countdown is the safety net, not the plugin.
 *
 * The session is released in two cases: a turn that completed (the agent
 * finished the work), and a turn that ended in a spent usage limit (the token
 * ran out). The second case only releases the machine when nothing will pick
 * the session up again: with Auto-continue on, the session resumes by itself and
 * the computer stays on until the resumed turn really finishes.
 *
 * The switch is OFF by default and its state lives in `state.json`, next to the
 * plugin, exactly like the auto-continue plugin's. Any new message from the user
 * cancels a pending shutdown: the machine is only released once nobody is
 * waiting on the agent any more.
 */
export async function apply(ctx, config) {
  const read = (field, fallback) => {
    const value = config?.[field]
    if (value === undefined) return fallback
    const resolved = typeof value?.get === 'function' ? value.get() : value
    return resolved === undefined ? fallback : resolved
  }

  const logger = ctx.logger
  /** The runtime on/off choice; `undefined` until `state.json` or a toggle decides. */
  let chosen
  let ready = false
  /** The countdown that is armed right now, when one is. */
  let pending = null
  /**
   * Per-arm generation: a cancel or a new arming bumps it, so a command that is
   * still running cannot resurrect a decision the user already reversed.
   */
  let generation = 0

  const configured = () => read('enabled', false) !== false
  const enabled = () => (chosen === undefined ? configured() : chosen === true)
  /** Only Windows offers a countdown this plugin can rely on. */
  const supported = () => commands.supported() === true

  /** Persist the runtime choice; a failure must not lose the in-memory decision. */
  const persist = async () => {
    const body = `${JSON.stringify({ enabled: enabled() }, null, 2)}\n`
    const temporary = `${STATE_FILE}.tmp`
    try {
      await writeFile(temporary, body, 'utf8')
      await rename(temporary, STATE_FILE)
    } catch (error) {
      logger.warn(`auto-shutdown: could not save the toggle: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** The countdown to arm, held inside the configured bounds. */
  const delayFor = (wanted) => {
    const floor = Math.max(MIN_DELAY_SECONDS, Math.min(MAX_DELAY_SECONDS, read('minDelaySeconds', MIN_DELAY_SECONDS)))
    const ceiling = Math.max(floor, Math.min(MAX_DELAY_SECONDS, read('maxDelaySeconds', MAX_DELAY_SECONDS)))
    const asked = Number.isFinite(wanted) ? wanted : read('delaySeconds', DEFAULT_DELAY_SECONDS)
    const seconds = Math.round(Number(asked))
    if (!Number.isFinite(seconds)) return floor
    return Math.min(ceiling, Math.max(floor, seconds))
  }

  /**
   * Arm the operating system's own shutdown countdown.
   *
   * Windows shows its dialog while the countdown runs and the user can cancel
   * it from there. The plugin's own `pending` record only mirrors what the
   * operating system was told, so the GUI can show the same countdown.
   */
  const arm = async (sessionId, wanted) => {
    if (!supported()) {
      logger.warn('auto-shutdown: this platform cannot power the computer down; nothing was armed')
      return undefined
    }
    const delay = delayFor(wanted)
    const message = String(read('message', DEFAULT_MESSAGE)).slice(0, 180)
    const capture = ++generation
    const result = await commands.powerOff(delay, message)
    if (capture !== generation) return undefined
    if (!result.ok) {
      logger.warn(`auto-shutdown: could not arm the shutdown: ${result.error}`)
      pending = null
      return undefined
    }
    const armedAt = Date.now()
    pending = {
      sessionId: typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null,
      armedAt,
      dueAt: armedAt + delay * 1000,
      delaySeconds: delay,
    }
    logger.info(`auto-shutdown: the computer will shut down in ${String(delay)} s`)
    return pending
  }

  /**
   * Cancel a pending shutdown.
   *
   * The command is sent even when this plugin holds no record of one: a
   * countdown armed before a restart still belongs to the operating system, and
   * the only way to stop it is to ask.
   */
  const abort = async (why) => {
    const capture = ++generation
    pending = null
    const result = await commands.cancel()
    if (capture !== generation) return false
    if (!result.ok) {
      logger.info(`auto-shutdown: there was no shutdown to cancel (${why})`)
      return false
    }
    logger.info(`auto-shutdown: the shutdown was cancelled (${why})`)
    return true
  }

  /** Whether this session is a root conversation that may release the machine. */
  const eligible = (session) => {
    if (session === undefined || session === null) return false
    const header = session.header
    if (header !== undefined && header !== null) {
      if (header.parentSession !== undefined || header.origin === 'subagent') return false
    }
    return typeof session.id === 'string' && session.id.length > 0
  }

  /** Whether this failure is a spent usage limit rather than a transient fault. */
  const isLimit = (failure) => {
    if (failure === null || typeof failure !== 'object') return false
    if (typeof failure.code === 'string' && LIMIT_CODES.includes(failure.code)) return true
    return failure.status === 429 || failure.status === 402
  }

  /**
   * Read what the auto-continue plugin knows about the sessions it watches.
   *
   * That plugin owns the answer to "will this session be picked up again?", so
   * the shutdown plugin asks it over HTTP instead of guessing. A route that
   * cannot be read counts as "nothing will resume this session".
   */
  const continuation = async () => {
    const route = read('continueEndpoint', '/plugins/auto-continue')
    if (typeof route !== 'string' || route.length === 0) return undefined
    let url
    try {
      url = new URL(route, ctx.webServer.getOrigin())
    } catch {
      return undefined
    }
    let response
    try {
      response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(Math.max(1000, read('continueTimeoutMs', 8000))),
      })
    } catch {
      return undefined
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return undefined
    }
    try {
      return await response.json()
    } catch {
      return undefined
    }
  }

  /**
   * Whether this session will be resumed by itself after a spent limit.
   *
   * The auto-continue plugin books its continuation in the background: it first
   * probes the provider for the reset time, which can take a moment, and only
   * then records the booking. So the answer is read again a few times before
   * the plugin believes that nothing will resume the session.
   */
  const willResume = async (sessionId) => {
    const attempts = Math.max(1, read('settleAttempts', 5))
    const interval = Math.max(0, read('settleIntervalMs', 3000))
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const state = await continuation()
      // The route is unreachable: nothing is going to resume the session.
      if (state === undefined) return false
      // The switch is off, or the resuming plugin cannot work here.
      if (state.enabled !== true || state.supported === false) return false
      const booked = Array.isArray(state.pending) ? state.pending : []
      if (booked.some(entry => String(entry?.sessionId) === String(sessionId))) return true
      if (attempt < attempts && interval > 0) {
        await new Promise(resolve => setTimeout(resolve, interval))
      }
    }
    return false
  }

  /** Answer one browser poll or toggle with the current state. */
  const snapshot = () => ({
    revision: REVISION,
    enabled: enabled(),
    supported: supported(),
    platform: process.platform,
    delaySeconds: delayFor(undefined),
    now: Date.now(),
    pending: pending === null
      ? null
      : {
          sessionId: pending.sessionId,
          armedAt: pending.armedAt,
          dueAt: pending.dueAt,
          delaySeconds: pending.delaySeconds,
        },
  })

  /** Read one JSON request body, bounded. */
  const readBody = (req) => new Promise((resolve) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 64_000) {
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })

  await (async () => {
    try {
      const saved = JSON.parse(await readFile(STATE_FILE, 'utf8'))
      if (typeof saved?.enabled === 'boolean') chosen = saved.enabled
    } catch {
      /* no saved choice: the plugin config decides */
    }
    ready = true
  })()

  ctx.on('session/event', (session, event) => {
    const sessionId = typeof session?.id === 'string' ? session.id : ''
    if (event?.type === 'user/message') {
      // The user is back at the keyboard: the machine is not free yet.
      if (pending !== null) void abort('the user sent a message')
      return
    }
    if (event?.type !== 'turn/end') return
    const reason = event?.data?.reason
    // A stopped turn is not finished work; only a completed one releases the machine.
    if (!ready || !enabled()) return
    if (!eligible(session)) return
    if (reason?.kind === 'completed') {
      // The agent finished the work: the session is done.
      void arm(sessionId, delayFor(undefined))
      return
    }
    if (reason?.kind !== 'error') return
    // A spent usage limit ends the turn in error. The session is over unless
    // the auto-continue plugin booked a continuation that will pick it up.
    if (!isLimit(reason.error)) return
    void (async () => {
      const capture = generation
      const resumed = await willResume(sessionId)
      if (capture !== generation) return
      if (resumed) {
        logger.info('auto-shutdown: the session resumes by itself; the computer stays on')
        return
      }
      await arm(sessionId, delayFor(undefined))
    })()
  })

  ctx.effect(() => {
    const endpoint = read('endpoint', '/plugins/auto-shutdown')
    const reply = (res, status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    }
    return ctx.webServer.register({
      kind: 'exact',
      path: endpoint,
      handler: (req, res) => {
        if (req.method === 'GET' || req.method === 'HEAD') {
          reply(res, 200, snapshot())
          return
        }
        if (req.method !== 'POST') {
          reply(res, 405, { error: 'method-not-allowed' })
          return
        }
        void (async () => {
          const request = await readBody(req)
          if (request.action === 'toggle') {
            chosen = typeof request.enabled === 'boolean' ? request.enabled : !enabled()
            await persist()
            // Turning the switch off must also release a countdown already running.
            if (!enabled() && pending !== null) await abort('the switch was turned off')
          } else if (request.action === 'cancel') {
            await abort('the user cancelled it')
          } else if (request.action === 'arm') {
            if (!enabled()) {
              logger.warn('auto-shutdown: the switch is off; nothing was armed')
            } else {
              await arm(typeof request.sessionId === 'string' ? request.sessionId : '', request.delaySeconds)
            }
          }
          reply(res, 200, snapshot())
        })().catch((error) => {
          logger.warn(`auto-shutdown: control route failed: ${error instanceof Error ? error.message : String(error)}`)
          try {
            reply(res, 500, { error: 'failed' })
          } catch {
            /* the reply already began */
          }
        })
      },
    })
  }, 'auto-shutdown: control route')
}
