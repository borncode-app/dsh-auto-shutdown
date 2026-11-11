window.__ModuleLoader__.load({
  id: '@local/dsh-auto-shutdown',
  factory: (require) => {
    const React = require('react')

    /** Dictionary namespace owned by this plugin. */
    const NS = 'settings.automation'
    /** Must match this plugin's Host row `endpoint`. */
    const ENDPOINT = '/plugins/auto-shutdown'
    /** The other plugin's route; this page only reads it and toggles it. */
    const CONTINUE_ENDPOINT = '/plugins/auto-continue'
    /** How often the composer chip re-reads the Host state. */
    const POLL_MS = 10000
    /** How often a shown countdown re-renders. */
    const TICK_MS = 1000

    /** English copy. */
    const en = {
      'nav': 'Automation',
      'title': 'Automation',
      'intro': 'Two switches that let the Harness keep working on its own: resume the conversation after a spent usage limit, and power the computer down once the session has finished its work.',
      'meta': {
        'title': 'Auto-shutdown the PC after a session finishes',
        'description': 'Powers the computer down through the operating system\'s own visible countdown once a session\'s work finishes, and hosts the switch that turns Auto-continue on or off. Ships off.',
      },
      'autoContinue': 'Auto-continue after usage limits',
      'autoContinueHint': 'When a model usage limit runs out, this conversation resumes by itself as soon as the limit resets. Switch it off to stop and wait at the limit instead.',
      'autoContinueUnsupported': 'Automatic continuation needs the schedule service, which is not mounted here.',
      'autoShutdown': 'Auto-ShutdownPC',
      'autoShutdownHint': 'The computer shuts down by itself once the session has finished its work. A session stopped by a spent usage limit releases it too, unless Auto-continue will pick that session up again. Keep this off unless you want the machine to power off without asking.',
      'autoShutdownUnsupported': 'This platform cannot power the computer down, so this switch stays off.',
      'autoShutdownWarning': 'Warning: this switch really powers the computer down. Anything that is still unsaved is lost.',
      'pending': 'Pending shutdown',
      'pendingIn': 'Shuts down in {time}',
      'pendingHint': 'A shutdown is armed. The computer goes down when the countdown reaches zero.',
      'cancel': 'Cancel shutdown',
      'busy': 'Working…',
      'loading': 'Loading…',
      'failed': 'The action failed.',
      'unit.h': '{count}h',
      'unit.m': '{count}m',
      'unit.s': '{count}s',
      'unit.gap': ' ',
      'chip.on': 'Shutdown: on',
      'chip.off': 'Shutdown: off',
      'chip.onHint': 'The computer shuts down by itself when the session finishes. Click to turn this off.',
      'chip.offHint': 'The computer stays on when the session finishes. Click to let it shut down by itself.',
      'chip.waiting': 'Shutdown in {time}',
      'chip.waitingHint': 'A shutdown is armed and fires in {time}. Click × to cancel it.',
      'chip.cancel': 'Cancel the pending shutdown',
      'chip.unsupported': 'This platform cannot power the computer down.',
    }

    /** Thai copy. */
    const th = {
      'nav': 'ระบบอัตโนมัติ',
      'title': 'ระบบอัตโนมัติ',
      'intro': 'สองสวิตช์ที่ให้ Harness ทำงานต่อได้เองโดยไม่ต้องรอคุณ คือต่อบทสนทนาใหม่เมื่อโควตาการใช้งานหมดแล้วรีเซ็ต และสั่งปิดเครื่องเมื่องานของเซสชันทำเสร็จ',
      'meta': {
        'title': 'ปิดเครื่องอัตโนมัติเมื่อ session จบ',
        'description': 'สั่งปิดเครื่องผ่านตัวนับถอยหลังของระบบปฏิบัติการเมื่องานใน session จบ พร้อมสวิตช์สำหรับเปิด/ปิด Auto-continue ค่าเริ่มต้นคือปิด',
      },
      'autoContinue': 'ต่ออัตโนมัติเมื่อโควตาหมด',
      'autoContinueHint': 'เมื่อโควตาการใช้งานของโมเดลหมด บทสนทนานี้จะกลับมาทำงานต่อเองทันทีที่โควตารีเซ็ต ปิดไว้ถ้าต้องการให้หยุดรอที่โควตา',
      'autoContinueUnsupported': 'การต่ออัตโนมัติต้องใช้บริการตั้งเวลา ซึ่งยังไม่ได้ติดตั้งไว้ที่นี่',
      'autoShutdown': 'Auto-ShutdownPC',
      'autoShutdownHint': 'เครื่องจะสั่งปิดไฟเองเมื่องานของเซสชันทำเสร็จ และจะปิดด้วยเมื่อ session ติดโควตาจนทำต่อไม่ได้ เว้นแต่ Auto-continue จะมาต่อให้เอง ควรปิดไว้ก่อน เว้นแต่คุณต้องการให้เครื่องปิดไฟโดยไม่ต้องถาม',
      'autoShutdownUnsupported': 'แพลตฟอร์มนี้สั่งปิดเครื่องไม่ได้ สวิตช์นี้จึงถูกปิดไว้',
      'autoShutdownWarning': 'คำเตือน: สวิตช์นี้สั่งปิดเครื่องจริง งานที่ยังไม่บันทึกจะหายไป',
      'pending': 'รอปิดเครื่อง',
      'pendingIn': 'จะปิดเครื่องในอีก {time}',
      'pendingHint': 'มีการสั่งปิดเครื่องอยู่ เครื่องจะปิดไฟเมื่อเวลานับถอยหลังถึงศูนย์',
      'cancel': 'ยกเลิกการปิดเครื่อง',
      'busy': 'กำลังทำงาน…',
      'loading': 'กำลังโหลด…',
      'failed': 'ดำเนินการไม่สำเร็จ',
      'unit.h': '{count} ชม.',
      'unit.m': '{count} น.',
      'unit.s': '{count} ว.',
      'unit.gap': ' ',
      'chip.on': 'ปิดเครื่อง: เปิดใช้',
      'chip.off': 'ปิดเครื่อง: ปิดใช้',
      'chip.onHint': 'เครื่องจะสั่งปิดไฟเองเมื่องานของเซสชันทำเสร็จ คลิกเพื่อปิด',
      'chip.offHint': 'เครื่องจะยังเปิดอยู่เมื่องานของเซสชันทำเสร็จ คลิกเพื่อให้สั่งปิดไฟเอง',
      'chip.waiting': 'ปิดเครื่องในอีก {time}',
      'chip.waitingHint': 'มีการสั่งปิดเครื่องอยู่และจะทำงานในอีก {time} คลิก × เพื่อยกเลิก',
      'chip.cancel': 'ยกเลิกการปิดเครื่องที่รออยู่',
      'chip.unsupported': 'แพลตฟอร์มนี้สั่งปิดเครื่องไม่ได้',
    }

    /** Simplified Chinese copy. */
    const zh = {
      'nav': '自动化',
      'title': '自动化',
      'intro': '两个开关，让 Harness 在你不盯着的时候也能继续工作：用量额度耗尽并恢复后自动续接对话，以及会话工作完成后自动关机。',
      'meta': {
        'title': '会话结束后自动关机',
        'description': '会话工作完成后，通过操作系统自带的可见倒计时来关闭电脑，并提供自动续接开关。默认关闭。',
      },
      'autoContinue': '用量额度耗尽后自动续接',
      'autoContinueHint': '模型用量额度耗尽后，本次对话会在额度恢复时自动继续。关闭它则在额度耗尽处停下等待。',
      'autoContinueUnsupported': '自动续接需要定时任务服务，此处尚未挂载。',
      'autoShutdown': 'Auto-ShutdownPC',
      'autoShutdownHint': '会话的工作完成后，机器会自行关机。会话因额度耗尽而停下时也会关机，除非 Auto-continue 会继续它。除非你确实希望它直接关机，否则请保持关闭。',
      'autoShutdownUnsupported': '此平台无法关闭电脑，因此该开关保持关闭。',
      'autoShutdownWarning': '警告：该开关会真正关闭电脑，未保存的工作将会丢失。',
      'pending': '待关机',
      'pendingIn': '将在 {time}后关机',
      'pendingHint': '已安排关机，倒计时归零时电脑会关闭。',
      'cancel': '取消关机',
      'busy': '处理中…',
      'loading': '加载中…',
      'failed': '操作失败。',
      'unit.h': '{count}小时',
      'unit.m': '{count}分',
      'unit.s': '{count}秒',
      'unit.gap': '',
      'chip.on': '自动关机：开',
      'chip.off': '自动关机：关',
      'chip.onHint': '会话结束后机器会自行关机。点击关闭。',
      'chip.offHint': '会话结束后机器保持开机。点击开启自动关机。',
      'chip.waiting': '将在 {time}后关机',
      'chip.waitingHint': '已安排关机，将在 {time}后执行。点击 × 取消。',
      'chip.cancel': '取消待执行的关机',
      'chip.unsupported': '此平台无法关闭电脑。',
    }

    /** The row's own styles; the class names are unique to this plugin. */
    const css = [
      '.dshas_section{display:flex;flex-direction:column;gap:16px;max-width:760px}',
      '.dshas_title{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary);margin:0}',
      '.dshas_description{margin:4px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dshas_rows{display:flex;flex-direction:column;gap:1px;background:var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);overflow:hidden}',
      '.dshas_row{display:flex;align-items:baseline;gap:16px;padding:10px 12px;background:var(--dsw-alias-bg-module-platform)}',
      '.dshas_rowLabel{flex:0 0 190px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dshas_rowValue{flex:1 1 auto;min-width:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.dshas_actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dshas_button{height:32px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}',
      '@media (hover:hover){.dshas_button:hover{background:var(--dsw-alias-interactive-bg-hover)}}',
      '.dshas_button:disabled{opacity:.5;cursor:default}',
      '.dshas_buttonDanger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dshas_status{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dshas_statusError{color:var(--dsw-alias-state-error-primary)}',
      '.dshas_separator{height:.5px;border:none;margin:0;background:var(--dsw-alias-border-l2)}',
      '.dshas_switchRow{display:flex;align-items:flex-start;gap:12px}',
      '.dshas_switch{position:relative;flex:0 0 auto;width:36px;height:20px;margin-top:2px;padding:0;border:none;border-radius:999px;background:var(--dsw-alias-border-l2);cursor:pointer}',
      '.dshas_switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}',
      '.dshas_switch:disabled{opacity:.5;cursor:default}',
      '.dshas_switchBusy{opacity:.65}',
      '.dshas_switchKnob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-module-platform);transition:transform .12s ease-out}',
      '.dshas_switch[aria-checked="true"] .dshas_switchKnob{transform:translateX(16px)}',
      '.dshas_label{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}',
      '.dshas_hint{margin-top:2px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dshas_warning{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}',
    ].join('')

    /** The chip's own styles; they ride on the composer dock. */
    const styles = {
      anchor: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        height: '20px',
        color: 'var(--dsw-alias-label-secondary)',
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '20px',
        whiteSpace: 'nowrap',
      },
      button: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        height: '20px',
        padding: '0 2px',
        margin: '0',
        border: 'none',
        background: 'none',
        color: 'inherit',
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '20px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
      cancel: {
        height: '16px',
        width: '16px',
        padding: '0',
        margin: '0 0 0 2px',
        border: 'none',
        borderRadius: '4px',
        background: 'none',
        color: 'inherit',
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '16px',
        cursor: 'pointer',
        opacity: 0.7,
      },
    }

    /**
     * Fill `{name}` placeholders from one values object.
     *
     * @param {string} text - the text to fill.
     * @param {object} values - the values of the placeholders.
     * @returns {string} the filled text.
     */
    function format(text, values) {
      if (values === undefined) return text
      return String(text).replace(/\{(\w+)\}/gu, (match, name) => (values[name] === undefined ? match : String(values[name])))
    }

    /**
     * The plugin's own reader of its dictionaries.
     *
     * The locale service is bound when the page mounts; before that the raw key
     * is the honest answer.
     *
     * @param {string} key - the dictionary key.
     * @param {object} values - the values of the placeholders.
     * @returns {string} the translated text.
     */
    let translate = (key, values) => format(key, values)

    /**
     * A short reading of the time left, in the active language.
     *
     * @param {number} milliseconds - the time that is left.
     * @param {Function} t - the dictionary reader.
     * @returns {string} the reading, such as `1m 30s`.
     */
    function durationText(milliseconds, t) {
      const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000))
      const hours = Math.floor(totalSeconds / 3600)
      const minutes = Math.floor((totalSeconds % 3600) / 60)
      const seconds = totalSeconds % 60
      if (hours > 0) return `${t('unit.h', { count: hours })}${t('unit.gap')}${t('unit.m', { count: minutes })}`
      if (minutes > 0) return `${t('unit.m', { count: minutes })}${t('unit.gap')}${t('unit.s', { count: seconds })}`
      return t('unit.s', { count: seconds })
    }

    /**
     * The navigation icon of the settings section: a power symbol.
     *
     * @param {object} props - the row's own props.
     * @returns {object} the icon element.
     */
    function SectionIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 16
      const active = props?.active === true
      return React.createElement(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': 'true',
          style: { display: 'block', flex: '0 0 auto' },
        },
        React.createElement('path', {
          d: 'M8 2.4v5.2',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          opacity: active ? 1 : 0.75,
        }),
        React.createElement('path', {
          d: 'M4.6 4.8a4.6 4.6 0 1 0 6.8 0',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          opacity: active ? 1 : 0.75,
        }),
      )
    }

    /** The chip's small power symbol. */
    function PowerIcon() {
      return React.createElement(
        'svg',
        { width: 12, height: 12, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
        React.createElement('path', {
          d: 'M12 3v8',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.2,
          strokeLinecap: 'round',
        }),
        React.createElement('path', {
          d: 'M6.8 6.8a7.2 7.2 0 1 0 10.4 0',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.2,
          strokeLinecap: 'round',
        }),
      )
    }

    /**
     * The Automation settings section: the two switches that let the Harness
     * keep working without the user.
     *
     * @param {object} props - the row's own props.
     * @returns {object} the section element.
     */
    function AutomationSection(props) {
      const t = (key, values) => (typeof props?.t === 'function' ? props.t(key, values) : translate(key, values))
      const [shutdown, setShutdown] = React.useState(null)
      const [continuation, setContinuation] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [error, setError] = React.useState(null)
      const [clock, setClock] = React.useState(0)
      /** The in-flight guard: a second click never reaches the Host. */
      const busyRef = React.useRef(false)

      /**
       * Read this plugin's own state from the Host.
       *
       * @returns {Promise<object | null>} the state, or null when it failed.
       */
      const loadShutdown = React.useCallback(async () => {
        try {
          const response = await fetch(ENDPOINT, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`status ${response.status}`)
          const body = await response.json()
          setShutdown(body)
          setError(null)
          return body
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
          return null
        }
      }, [])

      /**
       * Read the other plugin's state; a failure here only leaves that one
       * switch empty, the section itself still works.
       *
       * @returns {Promise<object | null>} the state, or null when it failed.
       */
      const loadContinuation = React.useCallback(async () => {
        try {
          const response = await fetch(CONTINUE_ENDPOINT, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`status ${response.status}`)
          const body = await response.json()
          setContinuation(body)
          return body
        } catch {
          return null
        }
      }, [])

      React.useEffect(() => {
        void loadShutdown()
        void loadContinuation()
      }, [loadShutdown, loadContinuation])

      // The countdown is a live reading, so it has to move on its own.
      React.useEffect(() => {
        const handle = setInterval(() => setClock(Date.now()), TICK_MS)
        return () => clearInterval(handle)
      }, [])

      /**
       * Send one action to one route.
       *
       * @param {string} url - the route to post to.
       * @param {object} body - the action to send.
       * @returns {Promise<object>} the Host's answer.
       */
      const send = async (url, body) => {
        const response = await fetch(url, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const answer = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(answer?.error ?? `status ${response.status}`)
        return answer
      }

      /**
       * Run one action with the busy state around it.
       *
       * @param {string} url - the route to post to.
       * @param {object} body - the action to send.
       * @param {Function} adopt - the reader of the Host's answer.
       * @returns {Promise<void>} once the action settled.
       */
      const act = async (url, body, adopt) => {
        if (busyRef.current) return
        busyRef.current = true
        setBusy(url)
        try {
          adopt(await send(url, body))
          setError(null)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          busyRef.current = false
          setBusy('')
        }
      }

      const pending = shutdown?.pending ?? null
      const remaining = pending === null ? 0 : pending.dueAt - (clock > 0 ? clock : Date.now())
      const waiting = pending !== null && remaining > 0
      const shutdownSupported = shutdown === null || shutdown.supported !== false
      const continuationSupported = continuation === null || continuation.supported !== false
      const busyHere = busy.length > 0

      return React.createElement(
        'section',
        { className: 'dshas_section' },
        React.createElement('style', null, css),
        React.createElement(
          'div',
          null,
          React.createElement('h2', { className: 'dshas_title' }, t('title')),
          React.createElement('p', { className: 'dshas_description' }, t('intro')),
        ),
        error ? React.createElement('p', { className: 'dshas_status dshas_statusError', role: 'alert' }, `${t('failed')} ${error}`) : null,
        busyHere ? React.createElement('span', { className: 'dshas_status', role: 'status' }, t('busy')) : null,
        React.createElement('hr', { className: 'dshas_separator' }),
        React.createElement(
          'div',
          { className: 'dshas_switchRow' },
          React.createElement(
            'button',
            {
              type: 'button',
              role: 'switch',
              className: busy === CONTINUE_ENDPOINT ? 'dshas_switch dshas_switchBusy' : 'dshas_switch',
              'aria-checked': continuation?.enabled === true ? 'true' : 'false',
              'aria-label': t('autoContinue'),
              'aria-busy': busy === CONTINUE_ENDPOINT ? 'true' : 'false',
              disabled: busyHere || continuation === null || !continuationSupported,
              onClick: () => {
                const next = continuation?.enabled !== true
                setContinuation((current) => (current === null ? current : { ...current, enabled: next }))
                void act(CONTINUE_ENDPOINT, { action: 'toggle', enabled: next }, (answer) => setContinuation(answer))
              },
            },
            React.createElement('span', { className: 'dshas_switchKnob' }),
          ),
          React.createElement(
            'div',
            null,
            React.createElement('div', { className: 'dshas_label' }, t('autoContinue')),
            React.createElement('div', { className: 'dshas_hint' }, continuationSupported ? t('autoContinueHint') : t('autoContinueUnsupported')),
          ),
        ),
        React.createElement('hr', { className: 'dshas_separator' }),
        React.createElement(
          'div',
          { className: 'dshas_switchRow' },
          React.createElement(
            'button',
            {
              type: 'button',
              role: 'switch',
              className: busy === ENDPOINT ? 'dshas_switch dshas_switchBusy' : 'dshas_switch',
              'aria-checked': shutdown?.enabled === true ? 'true' : 'false',
              'aria-label': t('autoShutdown'),
              'aria-busy': busy === ENDPOINT ? 'true' : 'false',
              disabled: busyHere || shutdown === null || !shutdownSupported,
              onClick: () => {
                const next = shutdown?.enabled !== true
                setShutdown((current) => (current === null ? current : { ...current, enabled: next }))
                void act(ENDPOINT, { action: 'toggle', enabled: next }, (answer) => setShutdown(answer))
              },
            },
            React.createElement('span', { className: 'dshas_switchKnob' }),
          ),
          React.createElement(
            'div',
            null,
            React.createElement('div', { className: 'dshas_label' }, t('autoShutdown')),
            React.createElement('div', { className: 'dshas_hint' }, shutdownSupported ? t('autoShutdownHint') : t('autoShutdownUnsupported')),
            shutdownSupported ? React.createElement('div', { className: 'dshas_warning', role: 'note' }, t('autoShutdownWarning')) : null,
          ),
        ),
        waiting
          ? React.createElement(
            'div',
            null,
            React.createElement('hr', { className: 'dshas_separator' }),
            React.createElement(
              'div',
              { className: 'dshas_rows' },
              React.createElement(
                'div',
                { className: 'dshas_row' },
                React.createElement('div', { className: 'dshas_rowLabel' }, t('pending')),
                React.createElement('div', { className: 'dshas_rowValue' }, t('pendingIn', { time: durationText(remaining, t) })),
                React.createElement(
                  'div',
                  { className: 'dshas_actions' },
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'dshas_button dshas_buttonDanger',
                      disabled: busyHere,
                      onClick: () => void act(ENDPOINT, { action: 'cancel' }, (answer) => setShutdown(answer)),
                    },
                    t('cancel'),
                  ),
                ),
              ),
            ),
            React.createElement('div', { className: 'dshas_hint' }, t('pendingHint')),
          )
          : null,
      )
    }

    const apply = (ctx) => {
      const t = ctx.locale.bind(NS)
      translate = (key, values) => t(key, values)
      ctx.effect(() => ctx.locale.register(NS, { en, th, zh }), 'ui-auto-shutdown: dictionaries')
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'automation',
        order: 24,
        label: () => t('nav'),
        locale: NS,
      }, AutomationSection))
      ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
        name: 'settings.section.icon',
        id: 'automation',
        order: 0,
        locale: NS,
      }, SectionIcon))

      /**
       * The composer chip: the Auto-ShutdownPC switch at the bottom of the
       * composer, next to the auto-continue chip.
       *
       * @param {object} props - the dock's own props.
       * @returns {object} the chip element.
       */
      function AutoShutdownChip(props) {
        const t = (key, values) => translate(key, values)
        const [state, setState] = React.useState(undefined)
        const [busy, setBusy] = React.useState(false)
        const [clock, setClock] = React.useState(0)

        React.useEffect(() => {
          let cancelled = false
          let timer
          const load = async () => {
            try {
              const response = await fetch(ENDPOINT, { headers: { accept: 'application/json' } })
              const body = await response.json()
              if (!cancelled) setState(body)
            } catch {
              /* a transient failure keeps the previous reading */
            }
            if (!cancelled) timer = setTimeout(() => void load(), POLL_MS)
          }
          void load()
          return () => {
            cancelled = true
            clearTimeout(timer)
          }
        }, [])

        React.useEffect(() => {
          const handle = setInterval(() => setClock(Date.now()), TICK_MS)
          return () => clearInterval(handle)
        }, [])

        /**
         * Send one control action and adopt the Host's answer.
         *
         * @param {object} request - the action to send.
         * @returns {Promise<void>} once the action settled.
         */
        const send = async (request) => {
          setBusy(true)
          try {
            const response = await fetch(ENDPOINT, {
              method: 'POST',
              headers: { accept: 'application/json', 'content-type': 'application/json' },
              body: JSON.stringify(request),
            })
            setState(await response.json())
          } catch {
            /* leave the previous reading in place */
          } finally {
            setBusy(false)
          }
        }

        if (state === undefined) return null

        const pending = state.pending ?? null
        const remaining = pending === null ? 0 : pending.dueAt - (clock > 0 ? clock : Date.now())
        const waiting = pending !== null && remaining > 0
        const on = state.enabled === true

        let label
        let title
        if (waiting) {
          label = t('chip.waiting', { time: durationText(remaining, t) })
          title = t('chip.waitingHint', { time: durationText(remaining, t) })
        } else {
          label = t(on ? 'chip.on' : 'chip.off')
          title = state.supported === false ? t('chip.unsupported') : t(on ? 'chip.onHint' : 'chip.offHint')
        }

        const color = waiting
          ? 'var(--dsw-alias-state-warn-primary)'
          : on
            ? 'var(--dsw-alias-brand-primary)'
            : 'var(--dsw-alias-label-secondary)'

        return React.createElement(
          'span',
          { style: styles.anchor, 'data-composer-stat': 'auto-shutdown' },
          React.createElement(
            'button',
            {
              type: 'button',
              style: { ...styles.button, color, opacity: busy ? 0.6 : 1 },
              title,
              'aria-label': title,
              'aria-pressed': on,
              'data-auto-shutdown': waiting ? 'waiting' : on ? 'on' : 'off',
              disabled: busy,
              onClick: () => void send({ action: 'toggle', enabled: !on }),
            },
            React.createElement(PowerIcon),
            React.createElement('span', null, label),
          ),
          waiting
            ? React.createElement(
              'button',
              {
                type: 'button',
                style: { ...styles.cancel, color },
                title: t('chip.cancel'),
                'aria-label': t('chip.cancel'),
                disabled: busy,
                onClick: () => void send({ action: 'cancel' }),
              },
              '×',
            )
            : null,
        )
      }

      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register({ name: 'conversation.composer.dock', id: 'auto-shutdown', order: 4 }, AutoShutdownChip),
      )
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
