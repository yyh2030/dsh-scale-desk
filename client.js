/**
 * scale-desk — browser half.
 *
 * One panel, four tabs: 量表库（定义与出处）/ 录入（手填与导入）/ 计分（宽表与
 * 每题明细）/ 校验（定义与数据问题）。Everything comes from the Host route; the
 * page never reads `_lab` itself and never computes a score on its own.
 */

/* @dsh-generated: client-identity prelude begin */
;(function (global) {
  if (global.__DSH_RESEARCH_CLIENT_IDENTITY__) return

const DSH_RESEARCH_CLIENT_IDENTITY = (function () {
  const IDENTITY_VERSION = '2026-11-10-u02'
  /** 共享键：同一标签里四个插件都读它，保证 pageId 一致。 */
  const PAGE_KEY = 'dsh:research:page:v3'
  /** 每个插件自己的键：键名含插件前一等公民前缀，便于诊断与单独清理。 */
  const PAGE_KEY_PREFIX = 'dsh:research:page:v3:plugin'
  const WORKSPACE_KEY = 'dsh:research:workspace:v3'
  const REVISION_KEY = 'dsh:research:page-revision:v3'
  const TAB_CHANNEL = 'dsh-research-tab-v3'
  const GLOBAL_KEY = '__DSH_RESEARCH_CLIENT_IDENTITY__'
  const PAGE_ID_RE = /^[A-Za-z0-9_-]{8,80}$/
  const PROBE_TIMEOUT_MS = 60
  /** 同一 realm（一个标签页）里所有插件共用的随机标签指纹，用来区分同标签兄弟与克隆标签。 */
  const tabNonce = randomToken()

  function randomToken(length) {
    const bytes = new Uint8Array(Math.ceil((length || 24) / 2))
    const cryptoSource = typeof globalThis !== 'undefined' ? globalThis.crypto : null
    if (cryptoSource && typeof cryptoSource.getRandomValues === 'function') cryptoSource.getRandomValues(bytes)
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
  }

  function randomPageId() { return randomToken(24) }

  function isPageId(value) { return typeof value === 'string' && PAGE_ID_RE.test(value) }

  function pluginPageKey(plugin) {
    const name = String(plugin || 'unknown').trim() || 'unknown'
    return PAGE_KEY_PREFIX + ':' + name
  }

  function safeSegment(value) {
    const text = String(value === null || value === undefined ? '' : value).trim()
    if (!text) return 'none'
    return text.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 96) || 'none'
  }

  /** 数据集标识：优先 dataRoot，其次研究定义路径，最后 studyId；只用于草稿键隔离。 */
  function datasetKey(binding) {
    if (!binding || typeof binding !== 'object') return 'none'
    return safeSegment(binding.dataRoot || binding.studyPath || binding.dataset || binding.studyId || 'none')
  }

  function instanceKey(binding) {
    return safeSegment(binding && (binding.instanceId || binding.studyId) || 'none')
  }

  /** study-ops 写到 scale-desk 的焦点提示：同一研究实例 + 同一数据集才复用。 */
  function focusKey(binding) {
    return 'dsh:research:focus:v2:' + instanceKey(binding) + ':' + datasetKey(binding)
  }

  /** analysis-run 方案草稿：实例 + 数据集（dataPath），不能只按 studyId 存。 */
  function planDraftKey(binding, dataPath, studyId) {
    return 'analysis-plan:v2:' + instanceKey(binding) + ':' + safeSegment(studyId || (binding && binding.studyId)) + ':' + safeSegment(dataPath || datasetKey(binding))
  }

  /** demographic-coder 数据集草稿：实例 + 数据集名。 */
  function datasetDraftKey(prefix, binding, dataset) {
    return String(prefix || 'dc:dataset:v3') + ':' + instanceKey(binding) + ':' + safeSegment(dataset || datasetKey(binding))
  }

  /**
   * 从 Client Slot/Service 契约读取当前标签所属工作区。
   * 只读 uiWorkspace 的当前会话与工作区成员关系；拿不到就返回 null，绝不猜 cwd。
   */
  function workspaceFromContext(ctx) {
    try {
      if (!ctx || typeof ctx.get !== 'function') return null
      const ui = ctx.get('uiWorkspace')
      if (!ui) return null
      const selection = ui.selection && typeof ui.selection.getSnapshot === 'function' ? ui.selection.getSnapshot() : null
      const sessionId = selection && selection.sessionId
      const snapshot = ui.workspaces && ui.workspaces.list && typeof ui.workspaces.list.getSnapshot === 'function' ? ui.workspaces.list.getSnapshot() : null
      const items = snapshot && Array.isArray(snapshot.items) ? snapshot.items : []
      let workspace = null
      if (sessionId) workspace = items.find(item => item && Array.isArray(item.sessionIds) && item.sessionIds.includes(sessionId)) || null
      if (!workspace && selection && selection.workspaceId) workspace = items.find(item => item && item.workspaceId === selection.workspaceId) || null
      if (!workspace) return null
      return { id: workspace.workspaceId || '', path: workspace.path || '' }
    } catch { return null }
  }

  function safeStorage(global) {
    try { return global && global.sessionStorage ? global.sessionStorage : null } catch { return null }
  }

  function createClientIdentity(options) {
    const settings = options || {}
    const global = settings.global || (typeof globalThis !== 'undefined' ? globalThis : null)
    const plugin = String(settings.plugin || 'unknown')
    const storage = settings.storage !== undefined ? settings.storage : safeStorage(global)
    // 只从页面 window（或显式注入）取 BroadcastChannel；Node 测试进程的全局实现
    // 不能被误当成浏览器标签能力，否则测试/宿主进程会被常驻通道挂住。
    const broadcastFactory = settings.BroadcastChannel || (global && global.BroadcastChannel) || null
    const workspaceProvider = settings.workspaceProvider || null
    const random = typeof settings.random === 'function' ? settings.random : randomPageId
    const tabId = settings.tabId || tabNonce
    const pageKey = pluginPageKey(plugin)
    let pageId = ''
    let workspace = null
    let revision = 0
    let binding = null
    let readyPromise = null
    let channel = null

    function read(key) {
      try { return storage && typeof storage.getItem === 'function' ? String(storage.getItem(key) || '') : '' } catch { return '' }
    }
    function write(key, value) {
      try { if (storage && typeof storage.setItem === 'function') storage.setItem(key, String(value)); return true } catch { return false }
    }
    function remove(key) { try { if (storage && typeof storage.removeItem === 'function') storage.removeItem(key) } catch { /* ignore */ } }

    function workspaceStorageKey(id) { return WORKSPACE_KEY + ':' + id }
    function revisionStorageKey(id) { return REVISION_KEY + ':' + id }

    function readWorkspace() {
      const raw = read(workspaceStorageKey(pageId))
      if (!raw) return null
      try {
        const value = JSON.parse(raw)
        return value && typeof value === 'object' ? { id: String(value.id || ''), path: String(value.path || '') } : null
      } catch { return null }
    }
    function readRevision() {
      const value = Number(read(revisionStorageKey(pageId)))
      return Number.isFinite(value) && value >= 0 ? value : 0
    }
    function persistWorkspace() {
      if (!pageId) return
      if (workspace) write(workspaceStorageKey(pageId), JSON.stringify(workspace))
      else remove(workspaceStorageKey(pageId))
      write(revisionStorageKey(pageId), String(revision))
    }

    function normalizeWorkspace(value) {
      if (!value) return null
      if (typeof value === 'string') return { id: value.trim(), path: '' }
      const id = String(value.id || value.workspaceId || '').trim()
      const path = typeof value.path === 'string' ? value.path.trim() : ''
      if (!id && !path) return null
      return { id, path }
    }

    function installChannel() {
      if (channel || !broadcastFactory) return
      try {
        channel = new broadcastFactory(TAB_CHANNEL)
        if (typeof channel.addEventListener === 'function') {
          channel.addEventListener('message', event => {
            const message = event && event.data ? event.data : event
            if (!message || message.type !== 'identity-probe' || !message.nonce) return
            // 同一标签的四个兄弟共用一个 tab 指纹，不能互相判成克隆；只回答其他标签的探测。
            if (message.tab === tabId) return
            if (message.pageId !== pageId) return
            try { channel.postMessage({ type: 'identity-alive', pageId, nonce: message.nonce }) } catch { /* ignore */ }
          })
        }
      } catch { channel = null }
    }

    /** 克隆标签会复制 sessionStorage；用 BroadcastChannel 问一下这个 pageId 是否已在别的标签活着。 */
    async function contested(id) {
      if (!broadcastFactory) return false
      let probe = null
      try { probe = new broadcastFactory(TAB_CHANNEL) } catch { return false }
      return await new Promise(resolve => {
        let settled = false
        const nonce = random()
        const finish = value => {
          if (settled) return
          settled = true
          try { if (probe && typeof probe.close === 'function') probe.close() } catch { /* ignore */ }
          resolve(value)
        }
        if (typeof probe.addEventListener === 'function') {
          probe.addEventListener('message', event => {
            const message = event && event.data ? event.data : event
            if (message && message.type === 'identity-alive' && message.pageId === id && message.nonce === nonce) finish(true)
          })
        }
        try { probe.postMessage({ type: 'identity-probe', pageId: id, nonce, tab: tabId }) } catch { finish(false); return }
        setTimeout(() => finish(false), PROBE_TIMEOUT_MS)
      })
    }

    function ready() {
      if (readyPromise) return readyPromise
      readyPromise = (async () => {
        const storedPlugin = read(pageKey)
        const storedShared = read(PAGE_KEY)
        // 共享键优先：四个插件以它为唯一事实；插件键只做诊断/清理辅助。
        let candidate = isPageId(storedShared) ? storedShared : (isPageId(storedPlugin) ? storedPlugin : '')
        // 同标签的兄弟插件已经通过共享内存确认过这个身份，不必再互探。
        if (candidate && candidate !== memoryPageId() && await contested(candidate)) candidate = ''
        if (!candidate) {
          candidate = isPageId(memoryPageId()) ? memoryPageId() : random()
          // 进程内唯一 ID：同一标签的四个插件通过共享内存拿到同一个值，克隆/无 storage 时也彼此不同。
          setMemoryPageId(candidate)
          write(pageKey, candidate)
          write(PAGE_KEY, candidate)
        } else {
          setMemoryPageId(candidate)
          if (storedPlugin !== candidate) write(pageKey, candidate)
          if (storedShared !== candidate) write(PAGE_KEY, candidate)
        }
        pageId = candidate
        if (!workspace) workspace = readWorkspace()
        revision = Math.max(revision, readRevision())
        installChannel()
        return pageId
      })()
      return readyPromise
    }

    // 进程内单例挂在全局 API 上：四个插件 bundle 共用同一个 API 实例时通过它对齐。
    function memoryPageId() {
      try { return global && global.__DSH_RESEARCH_PAGE_MEMORY__ ? String(global.__DSH_RESEARCH_PAGE_MEMORY__) : '' } catch { return '' }
    }
    function setMemoryPageId(value) {
      try { if (global) global.__DSH_RESEARCH_PAGE_MEMORY__ = value } catch { /* ignore */ }
    }

    /** 同标签任一插件 newPage 后，其他插件下次请求前要采纳新的共享 pageId。 */
    function syncPageFromGlobal() {
      const sharedMemory = memoryPageId()
      if (!isPageId(sharedMemory) || sharedMemory === pageId) return
      pageId = sharedMemory
      workspace = readWorkspace()
      revision = readRevision()
      binding = null
    }

    function ensure() {
      syncPageFromGlobal()
      if (!pageId) {
        // 同步路径也不能覆盖已持久化的身份；只有确实没有候选时才生成。
        const storedShared = read(PAGE_KEY)
        const storedPlugin = read(pageKey)
        const stored = isPageId(storedShared) ? storedShared : (isPageId(storedPlugin) ? storedPlugin : '')
        pageId = stored || (isPageId(memoryPageId()) ? memoryPageId() : random())
        setMemoryPageId(pageId)
        if (!stored) write(PAGE_KEY, pageId)
        if (storedPlugin !== pageId) write(pageKey, pageId)
        if (!workspace) workspace = readWorkspace()
        revision = Math.max(revision, readRevision())
      }
      return pageId
    }

    function syncWorkspace(ctx) {
      if (typeof workspaceProvider !== 'function' || !pageId) return workspace
      let next = null
      try { next = workspaceProvider(ctx) } catch { next = null }
      return setWorkspace(next)
    }

    function setWorkspace(next) {
      const normalized = normalizeWorkspace(next)
      if (!normalized) return workspace
      if (workspace && workspace.id === normalized.id && workspace.path === normalized.path) return workspace
      if (workspace) {
        // 同标签切换工作区：绑定代次递增，旧令牌作废。
        revision += 1
        binding = null
      }
      workspace = normalized
      persistWorkspace()
      return workspace
    }

    function newPage() {
      const next = random()
      pageId = next
      setMemoryPageId(next)
      revision = 0
      binding = null
      write(pageKey, next)
      write(PAGE_KEY, next)
      persistWorkspace()
      installChannel()
      return next
    }

    function prepare(ctx) {
      syncPageFromGlobal()
      ensure()
      if (typeof workspaceProvider === 'function') syncWorkspace(ctx)
      return begin()
    }

    function begin() {
      ensure()
      return {
        pageId,
        workspaceId: workspace ? workspace.id : '',
        workspacePath: workspace ? workspace.path : '',
        bindingRevision: revision,
        studyId: binding ? binding.studyId || '' : '',
        instanceId: binding ? binding.instanceId || '' : '',
        token: binding ? binding.token || '' : '',
      }
    }

    function headers() {
      ensure()
      const result = { 'x-dsh-page': pageId }
      if (workspace && workspace.id) result['x-dsh-workspace'] = workspace.id
      return result
    }

    function body() {
      ensure()
      const result = { pageId, bindingRevision: revision }
      if (workspace && workspace.id) result.workspaceId = workspace.id
      // 写入令牌必须随请求体发送：连接/读取响应会 remember() 令牌，但只有 body 带上它，
      // 服务端 assertWrite 才会认为这是当前页面的绑定（否则页面永远 binding_required）。
      if (binding && binding.token) result.binding = binding.token
      return result
    }

    function capture() { return begin() }

    function remember(nextBinding) {
      if (!nextBinding || typeof nextBinding !== 'object' || !nextBinding.token) return binding
      binding = {
        token: String(nextBinding.token),
        studyId: nextBinding.studyId || (nextBinding.study && nextBinding.study.id) || '',
        instanceId: nextBinding.instanceId || (nextBinding.study && nextBinding.study.instanceId) || '',
        studyRevision: nextBinding.studyRevision || (nextBinding.study && nextBinding.study.revision) || '',
        bindingRevision: Number(nextBinding.bindingRevision) || 0,
        workspaceId: nextBinding.workspaceId || '',
      }
      return binding
    }

    function staleError(message, details) {
      const error = new Error(message)
      error.code = 'stale_response'
      error.details = details
      return error
    }

    /**
     * 响应回来后核对本次 capture：页面、工作区代次或研究身份变了就拒绝，
     * 由调用方丢弃这次结果，不能覆盖新页面状态。
     */
    function assertResponse(snapshot, responseBinding, options) {
      if (!snapshot) return true
      if (snapshot.pageId !== pageId) throw staleError('页面身份已变化，忽略过时响应', { pageId, expected: snapshot.pageId })
      if (snapshot.bindingRevision !== revision) throw staleError('页面绑定已切换，忽略过时响应', { bindingRevision: revision, expected: snapshot.bindingRevision })
      const workspaceId = workspace ? workspace.id : ''
      if ((snapshot.workspaceId || '') !== workspaceId) throw staleError('页面工作区已切换，忽略过时响应', { workspaceId, expected: snapshot.workspaceId })
      if (responseBinding && typeof responseBinding === 'object') {
        const allowRebind = options && options.allowRebind === true
        const responseStudy = responseBinding.studyId || (responseBinding.study && responseBinding.study.id) || ''
        const responseInstance = responseBinding.instanceId || (responseBinding.study && responseBinding.study.instanceId) || ''
        const responseWorkspace = responseBinding.workspaceId || ''
        if (responseWorkspace && workspaceId && responseWorkspace !== workspaceId) {
          throw staleError('响应来自其他工作区，已丢弃', { workspaceId, responseWorkspace })
        }
        if (!allowRebind) {
          if (snapshot.studyId && responseStudy && snapshot.studyId !== responseStudy) {
            throw staleError('响应属于其他研究，已丢弃', { studyId: responseStudy, expected: snapshot.studyId })
          }
          if (snapshot.instanceId && responseInstance && snapshot.instanceId !== responseInstance) {
            throw staleError('响应属于其他研究实例，已丢弃', { instanceId: responseInstance, expected: snapshot.instanceId })
          }
        }
      }
      return true
    }

    function accept(snapshot, responseBinding, options) {
      assertResponse(snapshot, responseBinding, options)
      return remember(responseBinding)
    }

    // 首次创建就落盘：隐私模式下也会落到本标签的进程内单例。
    void ready().catch(() => {})

    return {
      version: IDENTITY_VERSION,
      plugin,
      ready,
      ensure,
      pageId() { return ensure() },
      newPage,
      prepare,
      begin,
      syncWorkspace,
      setWorkspace,
      workspace() { return workspace ? { ...workspace } : null },
      revision() { return revision },
      headers,
      body,
      capture,
      remember,
      binding() { return binding ? { ...binding } : null },
      assertResponse,
      accept,
      focusKey() { return focusKey(binding) },
      planDraftKey(dataPath) { return planDraftKey(binding, dataPath, binding && binding.studyId) },
      datasetDraftKey(prefix, dataset) { return datasetDraftKey(prefix, binding, dataset) },
      staleError,
    }
  }

  return {
    IDENTITY_VERSION,
    PAGE_KEY,
    PAGE_KEY_PREFIX,
    WORKSPACE_KEY,
    REVISION_KEY,
    TAB_CHANNEL,
    GLOBAL_KEY,
    randomPageId,
    isPageId,
    pluginPageKey,
    safeSegment,
    datasetKey,
    instanceKey,
    focusKey,
    planDraftKey,
    datasetDraftKey,
    workspaceFromContext,
    createClientIdentity,
  }
})()
  global.__DSH_RESEARCH_CLIENT_IDENTITY__ = DSH_RESEARCH_CLIENT_IDENTITY
})(typeof window !== 'undefined' ? window : globalThis)
/* @dsh-generated: client-identity prelude end */








/* @dsh-generated: study-picker prelude begin */
;(function (global) {
  if (global.__DSH_RESEARCH_PICKER__) return

function createStudyPicker(options) {
  const route = options.route
  const headers = options.headers || (() => ({}))
  const pickDirectory = options.pickDirectory || null
  const onChanged = options.onChanged || (() => {})
  const plugin = options.plugin || 'research'
  let root = null
  let panel = null
  let choices = null
  let note = ''
  let busy = false
  let advanced = false
  let creating = false
  let targetDir = ''
  let chooseDir = null

  async function api(action, payload, method = 'POST') {
    const url = method === 'GET' ? `${route}?action=${encodeURIComponent(action)}` : route
    const response = await fetch(url, {
      method,
      headers: { ...headers(), 'content-type': 'application/json' },
      body: method === 'POST' ? JSON.stringify({ action, payload: payload || {} }) : undefined,
    })
    let data = null
    try { data = await response.json() } catch { data = null }
    if (!response.ok || !data || data.ok === false) {
      const message = data && data.error && (data.error.message || data.error.note) ? (data.error.message || data.error.note) : `请求失败（${response.status}）`
      throw new Error(message)
    }
    return data.data
  }

  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag)
    for (const [key, value] of Object.entries(props || {})) {
      if (key === 'style') { if (node.style) for (const [name, style] of Object.entries(value)) node.style[name] = style }
      else if (key === 'onClick') node.addEventListener('click', value)
      else if (key === 'className') node.className = value
      else if (key === 'text') node.textContent = value
      else if (key === 'value') node.value = value
      else if (key === 'placeholder') node.placeholder = value
      else node.setAttribute(key, value)
    }
    for (const child of children) if (child != null) node.append(child)
    return node
  }

  const buttonStyle = {
    height: '30px', padding: '0 10px', border: '1px solid #cdc7b7', borderRadius: '5px',
    background: '#fffefb', color: '#24221f', cursor: 'pointer', font: 'inherit', fontSize: '13px',
  }
  const rowStyle = { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderBottom: '1px solid #eceade', cursor: 'pointer', width: '100%', background: 'transparent', border: 'none', textAlign: 'left', font: 'inherit' }

  function stateLabel(row) {
    if (row.state === 'ok') return '已存在'
    if (row.state === 'missing') return '需重新定位'
    if (row.state === 'invalid') return '配置损坏'
    return '未知'
  }

  function render() {
    if (!panel) return
    panel.textContent = ''
    const recent = (choices && choices.recent) || []
    const scope = (choices && choices.scope) || {}
    const binding = (choices && choices.binding) || {}
    const head = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' } },
      el('strong', { text: '打开研究' }),
      el('button', { style: buttonStyle, text: '关闭', onClick: close }),
    )
    const scopeBox = el('div', { style: { background: '#f2f0e9', borderRadius: '6px', padding: '8px 10px', fontSize: '12.5px', color: '#5b564d', lineHeight: '1.7' } },
      el('div', { text: `当前页面：${binding.studyId || '未绑定'}` }),
      el('div', { text: `当前工作区：${scope.workspace ? (scope.workspace.path || scope.workspace.id || '已识别') : '未识别'}` }),
      el('div', { text: `当前会话：${scope.kind === 'agent' ? (scope.session || '已识别') : '页面切换不改变 Agent 研究'}` }),
      el('div', { style: { color: '#726c62', fontSize: '12px' }, text: '在此研究工作区打开会话：暂不支持（宿主没有研究→工作区映射）；请在工作区新建会话。' }),
    )
    const list = el('div', { style: { maxHeight: '230px', overflow: 'auto', border: '1px solid #eceade', borderRadius: '6px', marginTop: '10px' } })
    if (!recent.length) list.append(el('div', { style: { padding: '12px', color: '#726c62' }, text: '暂无最近研究。选择研究文件夹或新建研究。' }))
    for (const row of recent) {
      const item = el('button', { style: { ...rowStyle, opacity: row.state === 'missing' ? '0.65' : '1' }, onClick: () => select(row) },
        el('span', { style: { flex: '1 1 auto', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: `${row.name || row.studyId || row.studyPath}` }),
        el('span', { style: { color: '#726c62', fontSize: '12px' }, text: row.current ? '当前' : stateLabel(row) }),
      )
      if (row.current) item.style.background = '#f4e5dd'
      list.append(item)
    }
    const actions = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' } },
      el('button', { style: buttonStyle, text: '选择研究文件夹…', onClick: chooseFolder }),
      el('button', { style: buttonStyle, text: '新建研究…', onClick: () => { creating = true; advanced = false; render() } }),
      el('button', { style: buttonStyle, text: '高级', onClick: () => { advanced = !advanced; creating = false; render() } }),
    )
    const body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, head, scopeBox, list, actions)
    if (creating) body.append(createForm())
    if (advanced) body.append(advancedForm())
    if (note) body.append(el('div', { style: { color: '#9b3a2c', fontSize: '12.5px' }, text: note }))
    panel.append(body)
  }

  function createForm() {
    const name = el('input', { placeholder: '研究名称', value: '', style: { height: '30px', padding: '0 8px', border: '1px solid #cdc7b7', borderRadius: '5px', font: 'inherit' } })
    const dirText = el('span', { style: { color: '#5b564d', fontSize: '12.5px', wordBreak: 'break-all' }, text: targetDir || '尚未选择父目录' })
    const choose = el('button', { style: buttonStyle, text: '选择父目录…', onClick: async () => {
      const dir = await chooseFolderPath()
      if (!dir) return
      targetDir = dir; render()
    } })
    const create = el('button', { style: { ...buttonStyle, background: '#a55a3c', color: '#fdfbf7', borderColor: '#a55a3c' }, text: '创建并连接', onClick: async () => {
      if (busy) return
      const title = String(name.value || '').trim()
      if (!title) { note = '请填写研究名称'; render(); return }
      if (!targetDir) { note = '请选择父目录'; render(); return }
      busy = true; note = ''
      try {
        const payload = { studyPath: joinPath(targetDir, 'study.json'), name: title }
        await api('studyCreate', payload)
        await finishSwitch()
      } catch (error) { note = error.message; busy = false; render() }
    } })
    return el('div', { style: { border: '1px solid #eceade', borderRadius: '6px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' } },
      el('strong', { text: '新建研究' }), name, dirText, el('div', { style: { display: 'flex', gap: '8px' } }, choose, create))
  }

  function advancedForm() {
    const input = el('input', { placeholder: 'study.json 的绝对路径', style: { flex: '1 1 auto', height: '30px', padding: '0 8px', border: '1px solid #cdc7b7', borderRadius: '5px', font: 'inherit' } })
    const connect = el('button', { style: buttonStyle, text: '连接', onClick: async () => {
      if (busy) return
      if (!input.value.trim()) { note = '请填写研究定义路径'; render(); return }
      busy = true; note = ''
      try { await api('studyConnect', { studyPath: input.value.trim() }); await finishSwitch() }
      catch (error) { note = error.message; busy = false; render() }
    } })
    return el('div', { style: { border: '1px solid #eceade', borderRadius: '6px', padding: '10px', display: 'flex', gap: '8px' } }, input, connect)
  }

  function joinPath(dir, name) {
    const clean = String(dir).replace(/[\\/]+$/, '')
    return `${clean}/${name}`
  }

  async function chooseFolderPath() {
    if (!pickDirectory) { note = '当前宿主未提供目录选择，请使用高级路径'; render(); return null }
    try { return await pickDirectory() } catch (error) { note = error.message || '目录选择已取消'; render(); return null }
  }

  async function chooseFolder() {
    const dir = await chooseFolderPath()
    if (!dir) return
    busy = true; note = ''
    try {
      const found = await api('studyDiscover', { dir })
      const configs = (found && found.configs) || []
      if (!configs.length) {
        targetDir = dir; creating = true; advanced = false
        note = '此文件夹没有研究配置，可以新建研究。'
      } else if (configs.length === 1) {
        await api('studyConnect', { studyPath: configs[0].studyPath })
        await finishSwitch()
        return
      } else {
        choices = null
        showConfigs(configs)
        busy = false
        return
      }
    } catch (error) { note = error.message }
    busy = false
    render()
  }

  function showConfigs(configs, relocateId = null) {
    if (!panel) return
    panel.textContent = ''
    panel.append(
      el('strong', { text: relocateId ? '选择重新定位后的研究配置' : '此文件夹有多个研究配置，请选择' }),
      el('div', { style: { margin: '10px 0', border: '1px solid #eceade', borderRadius: '6px' } },
        ...configs.map(row => el('button', { style: rowStyle, onClick: async () => {
          if (!row.valid) { note = '这个配置无效：' + (row.problems || []).join('；'); render(); return }
          try {
            if (relocateId) await api('studyRelocate', { instanceId: relocateId, studyPath: row.studyPath })
            else await api('studyConnect', { studyPath: row.studyPath })
            await finishSwitch()
          } catch (error) { note = error.message; busy = false; render() }
        } },
          el('span', { style: { flex: '1 1 auto' }, text: `${row.name || row.studyId || row.relativePath}` }),
          el('span', { style: { color: row.valid ? '#3f6b4f' : '#9b3a2c', fontSize: '12px' }, text: row.valid ? row.relativePath : '无效' }),
        ))
      ),
      el('button', { style: buttonStyle, text: '返回', onClick: () => { choices = null; refresh(); render() } }),
    )
  }

  async function select(row) {
    if (row.state === 'missing') {
      if (!row.instanceId) { note = '该研究没有实例记录，请选择文件夹或高级路径连接'; advanced = true; render(); return }
      const dir = await chooseFolderPath()
      if (!dir) return
      busy = true; note = ''
      try {
        const found = await api('studyDiscover', { dir })
        const configs = (found && found.configs) || []
        if (!configs.length) { note = '此文件夹没有研究配置'; busy = false; render(); return }
        if (configs.length > 1) { showConfigs(configs, row.instanceId); return }
        await api('studyRelocate', { instanceId: row.instanceId, studyPath: configs[0].studyPath })
        await finishSwitch()
      } catch (error) { note = error.message; busy = false; render() }
      return
    }
    if (!row.studyPath) return
    busy = true; note = ''
    try { await api('studyConnect', { studyPath: row.studyPath }); await finishSwitch() }
    catch (error) { note = error.message; busy = false; render() }
  }

  async function finishSwitch() {
    busy = false
    let name = ''
    try { choices = await api('studyChoices'); const current = (choices.recent || []).find(row => row.current); name = (current && (current.name || current.studyId)) || '' } catch { /* 名称稍后刷新 */ }
    close()
    updateButton()
    showToast(name)
    onChanged()
  }

  function showToast(name) {
    const toast = el('div', {
      style: {
        position: 'fixed', right: '24px', bottom: '28px', zIndex: '2147483100', maxWidth: '420px',
        background: '#24221f', color: '#fdfbf7', borderRadius: '8px', padding: '10px 12px',
        display: 'flex', alignItems: 'center', gap: '10px', font: '13px Cambria, serif',
        boxShadow: '0 10px 26px rgba(0,0,0,.25)',
      },
    },
      el('span', { style: { flex: '1 1 auto' }, text: name ? `已切换到：${name}` : '已切换研究' }),
      el('button', { style: { ...buttonStyle, height: '26px', background: '#fdfbf7' }, text: '刷新面板', onClick: () => { try { window.location.reload() } catch { /* 无窗口 */ } } }),
      el('button', { style: { ...buttonStyle, height: '26px', background: 'transparent', color: '#fdfbf7', borderColor: '#5b564d' }, text: '稍后', onClick: () => toast.remove() }),
    )
    document.body.append(toast)
    setTimeout(() => { try { toast.remove() } catch { /* 已移除 */ } }, 12000)
  }

  async function refresh() {
    try { choices = await api('studyChoices') } catch (error) { choices = null; note = error.message }
    updateButton()
    if (panel) render()
  }

  function updateButton() {
    if (!root) return
    const current = choices && choices.binding && choices.binding.studyId
    const nameRow = choices && choices.recent && choices.recent.find(row => row.current)
    root.textContent = `研究：${(nameRow && (nameRow.name || nameRow.studyId)) || current || '未绑定'} ▾`
  }

  function close() {
    if (panel) {
      if (panel.__onKey) document.removeEventListener('keydown', panel.__onKey)
      panel.remove(); panel = null
    }
  }

  function open() {
    if (panel) { close(); return }
    panel = el('div', {
      style: {
        position: 'fixed', bottom: '108px', right: '24px', width: '540px', maxWidth: 'calc(100vw - 48px)',
        maxHeight: 'calc(100vh - 200px)', overflow: 'auto', zIndex: '2147483000', background: '#fbfaf6',
        border: '1px solid #cdc7b7', borderRadius: '10px', padding: '14px', boxShadow: '0 18px 50px rgba(0,0,0,.22)',
        fontFamily: 'Cambria, "Noto Serif SC", serif', color: '#24221f', fontSize: '14px',
      },
    })
    document.body.append(panel)
    const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); close() } }
    document.addEventListener('keydown', onKey)
    panel.__onKey = onKey
    refresh()
  }

  function install() {
    if (root) return root
    if (typeof window !== 'undefined' && window.__DSH_RESEARCH_PICKER_INSTANCE__) return window.__DSH_RESEARCH_PICKER_INSTANCE__
    if (!document.body || typeof document.body.appendChild !== 'function' || !document.createElement) return null
    root = el('button', {
      style: {
        position: 'fixed', bottom: '64px', right: '24px', zIndex: '2147482000',
        height: '30px', padding: '0 12px', border: '1px solid #cdc7b7', borderRadius: '999px',
        background: '#fffefb', color: '#24221f', cursor: 'pointer', font: 'inherit', fontSize: '13px',
        boxShadow: '0 2px 10px rgba(0,0,0,.08)',
      },
      text: '研究：加载中…',
      title: `${plugin} 当前研究`,
    })
    root.addEventListener('click', open)
    document.body.append(root)
    // 面板只在研究插件页打开时自动关闭；入口按钮始终可见，避免被误判为“消失”。
    setInterval(() => {
      if (!panel) return
      try { if (!document.querySelector('.so-pagehead,.sd-root,.dc-root,.ar-pagehead')) close() } catch { close() }
    }, 800)
    refresh()
    if (typeof window !== 'undefined') window.__DSH_RESEARCH_PICKER_INSTANCE__ = pickerApi
    return root
  }

  const pickerApi = { install, open, close, refresh, get state() { return choices } }
  return pickerApi
}

const DSH_RESEARCH_PICKER = { createStudyPicker }
  global.__DSH_RESEARCH_PICKER__ = DSH_RESEARCH_PICKER
})(typeof window !== 'undefined' ? window : globalThis)
/* @dsh-generated: study-picker prelude end */











window.__ModuleLoader__.load({
  id: '@local/scale-desk',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useMemo, useRef } = React

    const API = '/api/scale-desk'
    const ALL = '__all__'
    let activeRevision = null
    let activeStudyId = null
    let visitLabels = {}

    /* 页面身份：共享逻辑在 research-core/client-identity.mjs；同一标签四插件共用一个 pageId。 */
    const identityApi = window.__DSH_RESEARCH_CLIENT_IDENTITY__
    if (!identityApi) throw new Error('页面身份模块未加载，请刷新页面')
    let hostCtx = null
    const identity = identityApi.createClientIdentity({
      plugin: 'scale-desk',
      storage: (() => { try { return sessionStorage } catch { return null } })(),
      global: (typeof window !== 'undefined' ? window : globalThis),
      workspaceProvider: ctx => identityApi.workspaceFromContext(ctx),
    })
    /** 新页面身份：换一个 pageId，同时丢掉本页旧令牌与冲突标记。 */
    function newPage() { identity.newPage(); activeBinding = null; staleBinding = false; return identity.pageId() }
    let activeBinding = null
    let staleBinding = false
    let staleWatch = null

    const READ_ACTIONS = ['status','refresh','definition','textsPreview','answer','detail','answers','suspicious','importPreview','validate','studyConfig','studyPreview','capabilities']
    const CONNECT_ACTIONS = ['studyConnect','studySave']
    const BINDING_ERRORS = ['binding_conflict','binding_required','study_missing','stale_response']
    const SOURCE_LABEL = { 'page-connect': '页面连接', 'session-connect': '会话连接', explicit: '已连接', workspace: '工作区记录', project: '工作区项目配置', legacy: '旧配置来源', candidate: '候选研究', empty: '空研究' }

    async function requestTicket() {
      await identity.ready()
      const snapshot = identity.prepare(hostCtx)
      return { snapshot, headers: identity.headers(), body: identity.body() }
    }

    async function call(action, payload, query) {
      // 研究已变化时不再静默重试写入：先重新连接，避免把作答写进另一份研究。
      if (staleBinding && !READ_ACTIONS.includes(action) && !CONNECT_ACTIONS.includes(action)) {
        const stale = new Error('研究已变化，请重新连接或先导出草稿')
        stale.code = 'binding_required'
        throw stale
      }
      const ticket = await requestTicket()
      const page = ticket.body.pageId
      let url = API + '?action=' + encodeURIComponent(action) + '&pageId=' + encodeURIComponent(page)
      if (query) {
        const qs = new URLSearchParams(query).toString()
        if (qs) url += '&' + qs
      }
      const init = { headers: { 'x-scale-desk': '1', ...ticket.headers } }
      if (payload !== undefined) {
        init.method = 'POST'
        init.headers['content-type'] = 'application/json'
        const needsRevision = !READ_ACTIONS.includes(action) && !CONNECT_ACTIONS.includes(action) && activeRevision
        const submitted = { ...(needsRevision ? { expectedRevision: activeRevision } : {}), studyId: activeStudyId, ...payload, ...ticket.body }
        init.body = JSON.stringify({ action, payload: submitted })
      }
      const res = await fetch(url, init)
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        const failure = new Error((json.error && json.error.message) || 'HTTP ' + res.status)
        failure.code = json.error && json.error.code
        failure.details = json.error && json.error.details
        if (BINDING_ERRORS.includes(failure.code)) { staleBinding = true; if (staleWatch) staleWatch() }
        throw failure
      }
      identity.accept(ticket.snapshot, json.data && json.data.binding, { allowRebind: CONNECT_ACTIONS.includes(action) })
      if (json.data && json.data.binding && json.data.binding.token) activeBinding = json.data.binding.token
      if (json.data && json.data.revision) activeRevision = json.data.revision
      if (json.data && json.data.study) activeStudyId = json.data.study.id
      if (CONNECT_ACTIONS.includes(action)) staleBinding = false
      return json.data
    }

    /* ================================================================ *
     * styles
     * ================================================================ */

    const CSS = `
/* ================================================================
 * 设计令牌：暖纸 / 陶土 / 全衬线
 * 纸面 #f5f4ef · 下沉 #eeede6 · 面板 #fbfaf6 · 抬起 #fffefb
 * 线 #e3dfd4 / #eceade / #cdc7b7 · 字 #24221f / #5b564d / #726c62
 * 陶土 #c46e4f（装饰）· #a55a3c（主操作）· #8b4526（hover）
 * ================================================================ */
.sd-root{--sd-bg:#f5f4ef;--sd-sunk:#eeede6;--sd-panel:#fbfaf6;--sd-raised:#fffefb;--sd-alt:#f2f0e9;--sd-line:#e3dfd4;--sd-line-soft:#eceade;--sd-line2:#cdc7b7;--sd-text:#24221f;--sd-text2:#5b564d;--sd-text3:#726c62;--sd-brand:#a55a3c;--sd-accent:#c46e4f;--sd-accent-deep:#8b4526;--sd-accent-soft:#f4e5dd;--sd-on-accent:#fdfbf7;--sd-ok:#3f6b4f;--sd-ok-soft:#e4ebe1;--sd-warn:#7d5810;--sd-warn-soft:#f3ead3;--sd-bad:#9b3a2c;--sd-bad-soft:#f4dfd9;--sd-info:#3f5a70;--sd-info-soft:#e2e8ec;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--sd-bg);color:var(--sd-text);font-family:Cambria,"Noto Serif SC","Source Han Serif SC","Songti SC",STSong,SimSun,serif;font-size:15px;line-height:1.62;letter-spacing:0;font-variant-numeric:tabular-nums;overflow:hidden}
.sd-root *{box-sizing:border-box}
.sd-root code,.sd-root kbd,.sd-root pre,.sd-root samp{font-family:inherit}

/* ---- 顶栏：产品名 + 研究名 + 四个统计 + 刷新/导出 ---- */
.sd-top{display:flex;align-items:center;gap:20px;height:60px;padding:0 20px;border-bottom:1px solid var(--sd-line);background:var(--sd-panel);flex:none;min-width:0}
.sd-brand{display:flex;align-items:baseline;gap:10px;min-width:0;flex:0 1 auto}
.sd-brand strong{font-size:21px;font-weight:600;line-height:1.24;white-space:nowrap}
.sd-brand span{font-size:13.5px;color:var(--sd-text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:20ch}
.sd-stats{display:flex;align-items:flex-end;gap:24px;min-width:0;overflow:hidden;margin-left:16px}
.sd-stat{display:flex;flex-direction:column-reverse;line-height:1.15;white-space:nowrap}
.sd-stat b{font-size:17px;font-weight:600;line-height:1.15;font-variant-numeric:tabular-nums}
.sd-stat span{font-size:12.5px;line-height:1.3;color:var(--sd-text3);margin-bottom:3px}
.sd-stat.is-bad b{color:var(--sd-bad)}
.sd-stat.is-warn b{color:var(--sd-warn)}
.sd-actions{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none}

/* ---- 按钮：一个陶土主操作，其余米白 + 细边 ---- */
.sd-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 13px;border-radius:5px;border:1px solid transparent;background:transparent;color:var(--sd-text);font-family:inherit;font-size:15px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer;transition:background-color .14s ease,border-color .14s ease,color .14s ease}
.sd-btn:disabled{background:var(--sd-alt);border-color:var(--sd-line);color:var(--sd-text3);cursor:not-allowed}
.sd-btn-primary{background:var(--sd-brand);border-color:var(--sd-brand);color:var(--sd-on-accent)}
.sd-btn-primary:hover:not(:disabled){background:var(--sd-accent-deep);border-color:var(--sd-accent-deep)}
.sd-btn-primary:active:not(:disabled){background:var(--sd-accent-deep)}
.sd-btn-primary:disabled{background:var(--sd-sunk);border-color:var(--sd-line);color:var(--sd-text3)}
.sd-btn-outline{background:var(--sd-raised);border-color:var(--sd-line2);color:var(--sd-text)}
.sd-btn-outline:hover:not(:disabled){background:var(--sd-alt);border-color:var(--sd-text3)}
.sd-btn-ghost{border-color:transparent;color:var(--sd-text2)}
.sd-btn-ghost:hover:not(:disabled){background:var(--sd-alt);color:var(--sd-text)}
.sd-btn-sm{height:30px;padding:0 11px;font-size:13.5px;border-radius:5px}
.sd-root button:focus-visible,.sd-root summary:focus-visible,.sd-root input[type=checkbox]:focus-visible{outline:2px solid var(--sd-accent-strong,var(--sd-brand));outline-offset:2px}

/* ---- 页签：字重 + 2px 下划线，不做整块胶囊 ---- */
.sd-tabs{display:flex;align-items:flex-end;gap:22px;margin:0 20px;border-bottom:1px solid var(--sd-line);flex:none;width:auto;overflow-x:auto;scrollbar-width:none}
.sd-tabs::-webkit-scrollbar{display:none}
.sd-tab{border:0;background:none;border-bottom:2px solid transparent;margin-bottom:-1px;padding:11px 2px 9px;color:var(--sd-text3);font-family:inherit;font-size:15px;line-height:1.3;white-space:nowrap;cursor:pointer;display:inline-flex;align-items:center;gap:5px;transition:color .14s ease}
.sd-tab:hover{color:var(--sd-text)}
.sd-tab.is-active{color:var(--sd-text);font-weight:600;border-bottom-color:var(--sd-brand)}
.sd-tab b{font-size:12px;font-weight:600;color:var(--sd-text3);font-variant-numeric:tabular-nums}
.sd-tab.is-active b{color:var(--sd-text2)}

/* ---- 内容面 ---- */
.sd-scroll{flex:1;min-height:0;overflow:auto;padding:18px 20px 48px;display:flex;flex-direction:column;gap:14px}
.sd-card{border:1px solid var(--sd-line);border-radius:7px;background:var(--sd-panel);padding:16px 18px 18px;display:flex;flex-direction:column;gap:12px;min-width:0}
.sd-card p{margin:0}
.sd-card-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.sd-card-head h3{margin:0;font-size:17px;font-weight:600;line-height:1.3;color:var(--sd-text)}
.sd-card-head .sd-note{margin-left:auto}
.sd-note{font-size:13.5px;line-height:1.62;color:var(--sd-text3)}
.sd-mono{display:inline-block;max-width:100%;padding:1px 6px;border:1px solid var(--sd-line-soft);border-radius:3px;background:var(--sd-sunk);color:var(--sd-text2);font-family:inherit;font-size:13px;line-height:1.8;letter-spacing:.012em;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:middle}
.sd-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(236px,1fr))}

/* ---- 量表库卡片 ---- */
.sd-lib{border:1px solid var(--sd-line);border-radius:7px;background:var(--sd-raised);padding:13px 14px;display:flex;flex-direction:column;gap:8px;cursor:pointer;text-align:left;min-width:0;font-family:inherit;color:var(--sd-text);transition:border-color .14s ease,background-color .14s ease}
.sd-lib:hover{border-color:var(--sd-line2)}
.sd-lib.is-active{border-color:var(--sd-brand);background:#f8ece5}
.sd-lib-top{display:flex;align-items:baseline;gap:8px;min-width:0}
.sd-lib-top b{font-size:15px;font-weight:600;white-space:nowrap}
.sd-lib-top span{font-size:13px;color:var(--sd-text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.sd-lib-meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12.5px;color:var(--sd-text2)}
.sd-lib-ver{font-size:12.5px;line-height:1.5;color:var(--sd-text3);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}

/* ---- 小标签 ---- */
.sd-chip{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:4px;border:1px solid var(--sd-line);background:var(--sd-alt);color:var(--sd-text2);font-family:inherit;font-size:12.5px;line-height:1.3;white-space:nowrap;font-variant-numeric:tabular-nums}
.sd-chip.is-brand{color:var(--sd-brand);border-color:#dcb6a4;background:#f8ece5}
.sd-root button.sd-chip:hover{background:#ece8dd;border-color:var(--sd-line2);color:var(--sd-text)}
.sd-root button.sd-chip.is-brand:hover{background:var(--sd-accent-soft);border-color:var(--sd-brand);color:var(--sd-accent-deep)}
.sd-badge{display:inline-flex;align-items:center;justify-content:center;height:20px;padding:0 7px;border-radius:4px;border:1px solid transparent;font-size:12px;font-weight:600;line-height:1.2;white-space:nowrap}
.sd-badge-ok{color:var(--sd-ok);background:var(--sd-ok-soft);border-color:#cad8c8}
.sd-badge-warn{color:var(--sd-warn);background:var(--sd-warn-soft);border-color:#e1d2ab}
.sd-badge-bad{color:var(--sd-bad);background:var(--sd-bad-soft);border-color:#e0c1b7}
.sd-badge-info{color:var(--sd-info);background:var(--sd-info-soft);border-color:#cbd6dd}

/* ---- 键值格 ---- */
.sd-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:10px}
.sd-kv-item{border:1px solid var(--sd-line);border-radius:5px;background:var(--sd-raised);padding:9px 12px;display:flex;flex-direction:column;gap:3px;min-width:0}
.sd-kv-item span{font-size:12.5px;line-height:1.5;color:var(--sd-text3)}
.sd-kv-item b{font-size:15px;font-weight:600;line-height:1.4;overflow:hidden;text-overflow:ellipsis}

/* ---- 表格：表内横滚，行高压紧可扫 ---- */
.sd-table-wrap{border:1px solid var(--sd-line);border-radius:5px;overflow:auto;background:var(--sd-raised);max-height:62vh;max-width:100%}
.sd-table{width:100%;border-collapse:separate;border-spacing:0;font-size:13.5px;line-height:1.45;min-width:640px}
.sd-table th{position:sticky;top:0;z-index:1;background:var(--sd-alt);text-align:left;padding:8px 10px;height:34px;border-bottom:1px solid var(--sd-line2);font-weight:600;white-space:nowrap;font-size:12.5px;line-height:1.3;color:var(--sd-text2)}
.sd-table thead tr:nth-child(2) th{top:34px;z-index:2}
.sd-table thead tr:nth-child(1) th{z-index:3}
.sd-table td{padding:6px 10px;border-bottom:1px solid var(--sd-line-soft);white-space:nowrap;vertical-align:middle;font-variant-numeric:tabular-nums;color:var(--sd-text)}
.sd-table tbody tr{cursor:pointer}
.sd-table tbody tr:hover td{background:var(--sd-alt)}
.sd-table tbody tr.is-open td{background:#f8ece5}
.sd-table th.is-score,.sd-table td.is-score{text-align:right}
.sd-table th.sd-sticky,.sd-table td.sd-sticky{position:sticky;left:0;background:var(--sd-raised);z-index:2;border-right:1px solid var(--sd-line)}
.sd-table th.sd-sticky{background:var(--sd-alt);z-index:3}
.sd-table tbody tr:hover td.sd-sticky{background:var(--sd-alt)}
.sd-table tbody tr.is-open td.sd-sticky{background:#f8ece5}
.sd-table .sd-note{font-size:13px}
.sd-table td .sd-note{white-space:normal}
.sd-table .sd-mono{font-size:12.5px;padding:0 4px}
.sd-id{font-family:inherit;font-size:13px;font-weight:500;letter-spacing:.012em}
.sd-cell{display:inline-flex;align-items:center;gap:4px;justify-content:flex-end}
.sd-cell i{font-style:normal;font-size:11px;font-weight:600;color:var(--sd-warn)}
.sd-cell.is-bad{color:var(--sd-bad)}
.sd-cell.is-empty{color:var(--sd-text3)}

/* ---- 表单与筛选 ---- */
.sd-field{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.sd-field label{display:inline-flex;align-items:center;gap:6px;font-size:13.5px;line-height:1.4;color:var(--sd-text2);white-space:nowrap}
.sd-form-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px 14px}
.sd-form-grid label{display:flex;flex-direction:column;gap:5px;font-size:13px;line-height:1.4;color:var(--sd-text2)}
.sd-card label.sd-form-grid{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--sd-text2)}
.sd-input,.sd-select{height:34px;padding:0 10px;border:1px solid var(--sd-line2);border-radius:5px;background:var(--sd-raised);color:var(--sd-text);font-family:inherit;font-size:15px;line-height:1.5;outline:none;min-width:0}
.sd-input::placeholder{color:#948d80}
.sd-input:focus,.sd-select:focus,.sd-text-input:focus{border-color:var(--sd-brand);outline:2px solid var(--sd-brand);outline-offset:1px}
.sd-input.sd-id-input,.sd-id-input{width:110px;font-family:inherit;font-size:14px}
.sd-text-input{flex:1;min-width:0;height:32px;padding:0 9px;border:1px solid var(--sd-line2);border-radius:5px;background:var(--sd-raised);color:var(--sd-text);font-family:inherit;font-size:14px;line-height:1.5;outline:none}
.sd-select{max-width:250px}
.sd-root textarea.sd-input{font-family:inherit;font-size:14px;line-height:1.7;padding:9px 10px;min-height:72px}
/* 机器文本：同一衬线族，用下沉底色 + 1px 边框 + 1.8 行高区分，不换字体 */
.sd-root textarea.sd-code-block{background:var(--sd-sunk);border-color:var(--sd-line);font-size:13.5px;line-height:1.8;letter-spacing:.012em;padding:10px 12px}
.sd-root input[type=checkbox],.sd-root input[type=radio]{width:15px;height:15px;accent-color:var(--sd-brand);margin:0 2px 0 0;vertical-align:-2px}
.sd-legend{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;line-height:1.62;color:var(--sd-text3)}

/* ---- 题目矩阵（答题纸 / 题面 / 波次） ---- */
.sd-matrix{display:flex;flex-direction:column;border:1px solid var(--sd-line);border-radius:7px;overflow:hidden;background:var(--sd-raised)}
.sd-item-row{display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:12px;align-items:center;padding:7px 12px;border-bottom:1px solid var(--sd-line-soft);min-width:0}
.sd-item-row:last-child{border-bottom:0}
.sd-item-row.is-reverse{background:#f9f1e4}
.sd-item-no{font-family:inherit;font-size:13px;color:var(--sd-text3);display:flex;align-items:center;gap:5px;font-variant-numeric:tabular-nums}
.sd-item-text{font-size:14.5px;line-height:1.55;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.sd-item-text.is-empty{color:var(--sd-text3);font-style:italic}
.sd-opts{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;min-width:0}
.sd-opt{min-width:32px;height:28px;padding:0 8px;border-radius:4px;border:1px solid var(--sd-line2);background:var(--sd-raised);color:var(--sd-text2);font-family:inherit;font-size:13.5px;line-height:1;cursor:pointer;font-variant-numeric:tabular-nums}
.sd-opt:hover{border-color:var(--sd-accent);background:var(--sd-alt);color:var(--sd-text)}
.sd-opt.is-on{background:var(--sd-brand);border-color:var(--sd-brand);color:var(--sd-on-accent);font-weight:600}
.sd-opt.is-on:hover{background:var(--sd-accent-deep);border-color:var(--sd-accent-deep);color:var(--sd-on-accent)}

/* ---- 拖放 / 文件 ---- */
.sd-drop{display:flex;flex-direction:column;align-items:center;gap:6px;padding:26px 18px;border:1px dashed #c9a58f;border-radius:7px;background:#faf4ef;cursor:pointer;text-align:center}
.sd-drop.is-over{border-color:var(--sd-brand);background:var(--sd-accent-soft)}
.sd-drop strong{font-size:15px;font-weight:600;line-height:1.5;color:var(--sd-text)}
.sd-drop span{font-size:13px;line-height:1.6;color:var(--sd-text3)}
.sd-file{border:1px solid var(--sd-line);border-radius:5px;background:var(--sd-alt);padding:7px 10px;font-size:13.5px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;min-width:0}
.sd-file b{font-weight:600}

/* ---- 问题清单 ---- */
.sd-issues{display:flex;flex-direction:column}
.sd-issue{display:flex;gap:10px;align-items:flex-start;padding:7px 0;font-size:14px;line-height:1.62}
.sd-issue + .sd-issue{border-top:1px solid var(--sd-line-soft)}
.sd-issue .sd-badge{flex:none;margin-top:2px}
.sd-issue-body{flex:1;min-width:0;overflow-wrap:anywhere}
.sd-issue-hint{font-size:13px;line-height:1.6;color:var(--sd-text3);margin-top:2px}
.sd-split{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:18px;align-items:start}

/* ---- 空态 / 浮层 / 提示 ---- */
.sd-empty{border:1px dashed var(--sd-line2);border-radius:7px;background:var(--sd-panel);padding:34px 20px;text-align:center;color:var(--sd-text3);display:flex;flex-direction:column;align-items:center;gap:8px}
.sd-empty strong{color:var(--sd-text);font-size:15px;font-weight:600;line-height:1.4}
.sd-empty span{font-size:13.5px;line-height:1.62}
.sd-toast{position:fixed;right:20px;bottom:20px;z-index:30;border:1px solid var(--sd-line2);border-radius:7px;background:var(--sd-raised);box-shadow:0 2px 4px -1px rgba(48,42,32,.08),0 8px 20px -12px rgba(48,42,32,.22);padding:10px 14px;font-size:13.5px;line-height:1.6;max-width:420px;color:var(--sd-text)}
.sd-toast.is-bad{border-color:#d8b3a8;color:var(--sd-bad);background:#fbf1ed}
.sd-alert{display:flex;gap:10px;align-items:flex-start;padding:9px 12px;border-radius:5px;font-size:13.5px;line-height:1.62;border:1px solid transparent;margin-bottom:0}
.sd-alert-warn{color:var(--sd-warn);background:var(--sd-warn-soft);border-color:#e1d2ab}
.sd-alert-bad{color:var(--sd-bad);background:var(--sd-bad-soft);border-color:#e0c1b7}
.sd-alert-ok{color:var(--sd-ok);background:var(--sd-ok-soft);border-color:#cad8c8}
.sd-spin{width:12px;height:12px;border-radius:50%;border:2px solid rgba(165,90,60,.28);border-top-color:var(--sd-brand);display:inline-block;animation:sd-spin .7s linear infinite}
@keyframes sd-spin{to{transform:rotate(360deg)}}
.sd-details{border:1px solid var(--sd-line);border-radius:5px;background:var(--sd-raised);padding:9px 12px}
.sd-details summary{cursor:pointer;font-size:13.5px;line-height:1.5;color:var(--sd-text2);outline:none}
.sd-details summary:hover{color:var(--sd-text)}
.sd-details[open] summary{color:var(--sd-text);font-weight:600}

/* ================================================================
 * 控件尺寸统一收口：旧版 inline 尺寸（26/24px 高、11px 字）不再生效。
 * 只覆盖高度与字号，宽度与对齐仍由各处的 inline 决定。
 * ================================================================ */
.sd-root input.sd-input,.sd-root select.sd-select,.sd-root input.sd-text-input{height:34px!important;font-size:15px!important;line-height:1.5!important}
.sd-root input.sd-id-input{font-size:14px!important}
.sd-root .sd-table select.sd-select{height:30px!important;font-size:13px!important}
.sd-root textarea.sd-input{font-size:14px!important;line-height:1.7!important}

/* ---- 1100：右窄栏折单列，顶栏统计下沉为一行 ---- */
@media (max-width:1100px){
.sd-split{grid-template-columns:minmax(0,1fr)}
.sd-top{height:auto;padding:12px 16px;flex-wrap:wrap;gap:12px}
.sd-actions{order:2}
.sd-stats{order:3;width:100%;margin:0;padding-top:10px;border-top:1px solid var(--sd-line-soft);gap:28px;overflow:visible}
.sd-stats{min-width:0}
.sd-tabs{margin:0 16px}
.sd-scroll{padding:16px 16px 44px}
}

/* ---- 900：研究名收窄，版面收紧 ---- */
@media (max-width:900px){
.sd-brand span{max-width:16ch}
.sd-stats{gap:20px}
.sd-split{gap:12px}
.sd-card{padding:15px 16px 16px}
.sd-tabs{gap:18px}
}

/* ---- 700：题目行折成两行，选项铺满 ---- */
@media (max-width:700px){
.sd-brand span{display:none}
.sd-stats{gap:0;justify-content:space-between}
.sd-stat{white-space:normal}
.sd-tabs{gap:16px;margin:0 14px}
.sd-scroll{padding:14px 14px 40px;gap:12px}
.sd-card{padding:14px 14px 16px}
.sd-card-head h3{font-size:16.5px}
.sd-item-row{grid-template-columns:28px minmax(0,1fr);row-gap:8px;padding:9px 10px}
.sd-opts{grid-column:1 / -1;justify-content:flex-start}
.sd-item-text{white-space:normal;overflow-wrap:anywhere}
.sd-item-row>.sd-mono,.sd-item-row>.sd-note{grid-column:2 / -1;justify-self:start;max-width:100%;overflow-wrap:anywhere}
.sd-kv{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.sd-form-grid{grid-template-columns:minmax(0,1fr)}
.sd-drop{padding:22px 14px}
}

/* ---- 480：390 宽，输入与主按钮 40px ---- */
@media (max-width:480px){
.sd-top{padding:10px 12px;gap:10px}
.sd-brand strong{font-size:19px}
.sd-tabs{margin:0 12px;gap:12px}
.sd-tab{font-size:14px;padding:10px 1px 8px;gap:4px}
.sd-scroll{padding:12px 12px 36px}
.sd-card{padding:13px 13px 15px;gap:10px}
.sd-card-head h3{font-size:16px}
.sd-btn{height:40px;font-size:15px;padding:0 14px}
.sd-btn-sm{height:40px;padding:0 12px;font-size:15px}
.sd-opt{height:40px;min-width:42px;font-size:15px}
.sd-toast{left:12px;right:12px;max-width:none}
.sd-root input.sd-input,.sd-root select.sd-select,.sd-root input.sd-text-input{height:40px!important;font-size:16px!important}
.sd-root textarea.sd-input{font-size:16px!important}
.sd-root .sd-table select.sd-select{height:34px!important;font-size:15px!important}
}
`

    function insertStyles() {
      const mark = 'scale-desk'
      if (document.querySelector('style[data-plugin-css="' + mark + '"]')) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = mark
      tag.dataset.pluginCss = mark
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => tag.remove()
    }

    /* ================================================================ *
     * small pieces
     * ================================================================ */

    const WAVE_LABEL = {}
    const FLOW_KIND = { scale: '量表', task: '任务', paper: '纸质', demo: '人口学', audio: '音频', text: '书写', survey: '问卷', rest: '练习' }
    const LEVEL_TEXT = { bad: '高', warn: '中', info: '提示' }
    const STATUS_TEXT = { ok: '完成', prorated: '折算', incomplete: '未计分', absent: '未录', empty: '未录', partial: '部分', duplicate: '重复编号' }
    const STATUS_CLASS = { ok: 'ok', prorated: 'warn', incomplete: 'bad', absent: 'info', empty: 'info', partial: 'warn' }

    function waveName(wave) {
      return visitLabels[wave] || WAVE_LABEL[wave] || wave
    }

    function Btn({ children, onClick, kind, disabled, title, small }) {
      return h('button', {
        type: 'button',
        className: 'sd-btn ' + (kind ? 'sd-btn-' + kind : 'sd-btn-outline') + (small ? ' sd-btn-sm' : ''),
        onClick,
        disabled,
        title
      }, children)
    }

    function Badge({ level, children }) {
      return h('span', { className: 'sd-badge sd-badge-' + (level || 'info') }, children)
    }

    function Stat({ label, value, tone }) {
      return h('div', { className: 'sd-stat' + (tone ? ' is-' + tone : '') }, h('b', null, value), h('span', null, label))
    }

    function Empty({ title, children }) {
      return h('div', { className: 'sd-empty' }, h('strong', null, title), children ? h('span', null, children) : null)
    }

    function itemNumbers(value) {
      const values = Array.isArray(value) ? value : String(value || '').split(/[,，、\s]+/).filter(Boolean)
      const numbers = values.map(Number)
      if (numbers.some(no => !Number.isInteger(no) || no < 1)) throw new Error('反向题请填写整数题号，用逗号或顿号分隔')
      return [...new Set(numbers)].sort((a, b) => a - b)
    }

    function scoreText(value) {
      if (value === null || value === undefined) return '—'
      return String(value)
    }

    /* ================================================================ *
     * 量表库
     * ================================================================ */

    function LibraryTab({ data, toast, onOpenFolder, refresh }) {
      const [selected, setSelected] = useState(data.instruments[0] ? data.instruments[0].id : '')
      const [detail, setDetail] = useState(null)
      const [error, setError] = useState('')
      const [version, setVersion] = useState(0)
      const [editing, setEditing] = useState(false)
      const [draft, setDraft] = useState([])
      const [pasteText, setPasteText] = useState('')
      const [pasteIssues, setPasteIssues] = useState([])
      const [saveError, setSaveError] = useState('')
      const [busy, setBusy] = useState('')

      useEffect(() => {
        let alive = true
        setDetail(null)
        setError('')
        setEditing(false)
        setPasteText('')
        setPasteIssues([])
        setSaveError('')
        if (!selected) return () => { alive = false }
        call('definition', { id: selected })
          .then(value => { if (alive) setDetail(value) })
          .catch(err => { if (alive) setError(err.message) })
        return () => { alive = false }
      }, [selected, version])

      const instrument = data.instruments.find(item => item.id === selected)

      const parsePaste = useCallback(async () => {
        if (!pasteText.trim()) return
        setBusy('parse')
        setSaveError('')
        try {
          const parsed = await call('textsPreview', { scale: selected, text: pasteText })
          setPasteIssues(parsed.issues || [])
          if (parsed.items && parsed.items.length) {
            setDraft(prev => {
              const map = new Map(prev.map(entry => [entry.no, entry.text]))
              for (const entry of parsed.items) map.set(entry.no, entry.text)
              return [...map.entries()].map(([no, text]) => ({ no, text })).sort((a, b) => a.no - b.no)
            })
            if (!(parsed.issues || []).some(item => item.level === 'bad')) {
              toast('已填入 ' + parsed.items.length + ' 题，确认无误后点「保存题面」。')
            }
          }
        } catch (err) {
          setSaveError(err.message)
        } finally {
          setBusy('')
        }
      }, [pasteText, selected, toast])

      const saveTexts = useCallback(async () => {
        setBusy('save')
        setSaveError('')
        try {
          const result = await call('saveTexts', { scale: selected, items: draft })
          setEditing(false)
          setPasteText('')
          setPasteIssues([])
          setVersion(value => value + 1)
          toast('已保存 ' + result.scale + ' 的 ' + result.filled + '/' + result.itemCount + ' 题题面。')
          if (refresh) refresh()
        } catch (err) {
          setSaveError(err.message)
        } finally {
          setBusy('')
        }
      }, [draft, selected, toast, refresh])

      const [wavesEditing, setWavesEditing] = useState(false)
      const [wavesDraft, setWavesDraft] = useState([])
      const [waveError, setWaveError] = useState('')
      const [waveBusy, setWaveBusy] = useState('')

      const wavePrefix = list => {
        const first = (list || [])[0]
        return first ? String(first).replace(/\d+$/, '') : ''
      }
      const waveRows = detail
        ? detail.waves.map(name => ({ name, prefix: wavePrefix(detail.codes[name]) }))
        : []

      const startWaves = () => {
        setWavesDraft(waveRows.map(row => ({ ...row })))
        setWaveError('')
        setWavesEditing(true)
      }
      const addWave = () => {
        setWavesDraft(prev => {
          const numbers = prev.map(row => /^T(\d+)$/.exec(row.name)).filter(Boolean).map(match => Number(match[1]))
          const next = numbers.length ? Math.max(...numbers) + 1 : prev.length
          const name = numbers.length ? 'T' + next : ''
          const prefix = numbers.length ? 't' + next + '_' : ''
          return [...prev, { name, prefix }]
        })
      }
      const saveWaves = async () => {
        const names = wavesDraft.map(row => row.name.trim())
        if (!names.length) {
          setWaveError('至少保留一个波次')
          return
        }
        if (names.some(name => !name)) {
          setWaveError('波次名不能为空')
          return
        }
        if (new Set(names).size !== names.length) {
          setWaveError('波次名重复')
          return
        }
        setWaveBusy('save')
        setWaveError('')
        try {
          const result = await call('saveWaves', {
            scale: selected,
            waves: wavesDraft.map(row => ({ name: row.name.trim(), prefix: row.prefix.trim() }))
          })
          setWavesEditing(false)
          toast('已保存 ' + result.scale + ' 的波次：' + result.waves.join(' / '))
          setVersion(value => value + 1)
          if (refresh) refresh()
        } catch (err) {
          setWaveError(err.message)
        } finally {
          setWaveBusy('')
        }
      }

      const [creating, setCreating] = useState(false)
      const [createForm, setCreateForm] = useState({
        id: '', name: '', short: '', itemCount: '10', min: '1', max: '7',
        waves: 'T0', scoringType: 'sum', reverse: '', minAnswered: ''
      })
      const [createError, setCreateError] = useState('')
      const [editingMeta, setEditingMeta] = useState(false)
      const [metaForm, setMetaForm] = useState(null)
      const [metaError, setMetaError] = useState('')
      const [actionBusy, setActionBusy] = useState('')

      const updateCreate = (key, value) => setCreateForm(prev => ({ ...prev, [key]: value }))

      const submitCreate = async () => {
        setActionBusy('create')
        setCreateError('')
        try {
          const result = await call('createScale', {
            id: createForm.id.trim(),
            name: createForm.name.trim(),
            short: createForm.short.trim(),
            itemCount: Number(createForm.itemCount),
            min: Number(createForm.min),
            max: Number(createForm.max),
            waves: createForm.waves.split(/[,，\s]+/).map(part => part.trim()).filter(Boolean),
            scoringType: createForm.scoringType,
            reverse: itemNumbers(createForm.reverse),
            minAnswered: createForm.minAnswered ? Number(createForm.minAnswered) : undefined
          })
          toast('已新建 ' + result.id + '（' + result.itemCount + ' 题，' + result.waves.join(' / ') + '）')
          setCreating(false)
          setCreateForm({ id: '', name: '', short: '', itemCount: '10', min: '1', max: '7', waves: 'T0', scoringType: 'sum', reverse: '', minAnswered: '' })
          setSelected(result.id)
          setVersion(value => value + 1)
          if (refresh) refresh()
        } catch (err) {
          setCreateError(err.message)
        } finally {
          setActionBusy('')
        }
      }

      const startMeta = () => {
        if (!instrument) return
        setMetaForm({
          name: instrument.name,
          short: instrument.short,
          version: instrument.version || '',
          notes: instrument.notes || '',
          instructions: instrument.instructions || '',
          scoringType: instrument.scoringType,
          reverse: [...instrument.reverse],
          minAnswered: String(instrument.missing ? instrument.missing.minAnswered : ''),
          multiSub: Object.keys((detail && detail.scoring && detail.scoring.subscales) || {}).length > 1
        })
        setMetaError('')
        setEditingMeta(true)
      }

      const submitMeta = async () => {
        if (!instrument || !metaForm) return
        setActionBusy('meta')
        setMetaError('')
        try {
          const payload = {
            scale: instrument.id,
            name: metaForm.name,
            short: metaForm.short,
            version: metaForm.version,
            notes: metaForm.notes,
            instructions: metaForm.instructions
          }
          if (!metaForm.multiSub) {
            if (metaForm.scoringType !== instrument.scoringType) payload.scoringType = metaForm.scoringType
            const reverse = itemNumbers(metaForm.reverse)
            if (JSON.stringify(reverse) !== JSON.stringify(itemNumbers(instrument.reverse))) payload.reverse = reverse
            if (Number(metaForm.minAnswered) !== instrument.missing.minAnswered) payload.minAnswered = Number(metaForm.minAnswered)
          }
          await call('saveMeta', payload)
          toast('已保存 ' + instrument.id + ' 的基本信息')
          setEditingMeta(false)
          setVersion(value => value + 1)
          if (refresh) refresh()
        } catch (err) {
          setMetaError(err.message)
        } finally {
          setActionBusy('')
        }
      }

      const removeScale = async () => {
        if (!instrument) return
        if (!window.confirm('确定删除「' + instrument.short + '」？定义文件会删除，流程里引用它的步骤也会一并移除。')) return
        setActionBusy('delete')
        setMetaError('')
        try {
          const result = await call('deleteScale', { scale: instrument.id })
          toast('已删除 ' + result.removed + (result.flowRemoved ? '，并从流程移除 ' + result.flowRemoved + ' 步' : ''))
          setEditingMeta(false)
          setSelected('')
          setVersion(value => value + 1)
          if (refresh) refresh()
        } catch (err) {
          setMetaError(err.message)
        } finally {
          setActionBusy('')
        }
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-card-head' },
            h('h3', null, '量表库'),
            h('span', { className: 'sd-note' }, '定义存在 _lab/scales/defs；题面在下面直接编辑，不随插件分发'),
            h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
              h(Btn, {
                children: creating ? '取消新建' : '新建量表',
                kind: creating ? 'ghost' : 'primary',
                small: true,
                onClick: () => { setCreating(value => !value); setCreateError('') }
              }),
              Btn({ children: '打开定义文件夹', kind: 'ghost', small: true, onClick: () => onOpenFolder('scales') })
            )
          ),
          h('div', { className: 'sd-grid' },
            data.instruments.map(item => {
              const recorded = Object.values(item.data || {}).reduce((sum, entry) => sum + entry.rows, 0)
              return h('button', {
                type: 'button',
                key: item.id,
                className: 'sd-lib' + (item.id === selected ? ' is-active' : ''),
                onClick: () => setSelected(item.id)
              },
                h('div', { className: 'sd-lib-top' }, h('b', null, item.short), h('span', null, item.name)),
                h('div', { className: 'sd-lib-meta' },
                  h('span', { className: 'sd-chip' }, item.itemCount + ' 题'),
                  h('span', { className: 'sd-chip' }, item.scoringType === 'none' ? '只收集' : item.scoringType === 'mean' ? '均分' : '累加'),
                  h('span', { className: 'sd-chip' }, item.waves.join(' / ')),
                  h('span', { className: 'sd-chip is-brand' }, recorded + ' 份')
                ),
                h('div', { className: 'sd-lib-ver' }, item.version || '未写版本')
              )
            })
          )
        ),
        creating
          ? h('div', { className: 'sd-card' },
              h('div', { className: 'sd-card-head' },
                h('h3', null, '新建量表'),
                h('span', { className: 'sd-note' }, '只建定义；题面之后在「编辑题面」里补，或直接粘贴'),
                h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
                  h(Btn, { children: actionBusy === 'create' ? '保存中…' : '创建', kind: 'primary', small: true, disabled: Boolean(actionBusy), onClick: submitCreate }),
                  h(Btn, { children: '取消', kind: 'ghost', small: true, disabled: Boolean(actionBusy), onClick: () => setCreating(false) })
                )
              ),
              createError ? h('div', { className: 'sd-alert sd-alert-bad', style: { margin: 0 } }, createError) : null,
              h('div', { className: 'sd-form-grid' },
                h('label', null, '量表 id', h('input', { className: 'sd-input', value: createForm.id, placeholder: 'MY_SCALE', onChange: event => updateCreate('id', event.target.value) })),
                h('label', null, '名称', h('input', { className: 'sd-input', value: createForm.name, placeholder: '中文全名', onChange: event => updateCreate('name', event.target.value) })),
                h('label', null, '简称', h('input', { className: 'sd-input', value: createForm.short, placeholder: '面板与列名用', onChange: event => updateCreate('short', event.target.value) })),
                h('label', null, '题量', h('input', { className: 'sd-input', type: 'number', min: 1, value: createForm.itemCount, onChange: event => updateCreate('itemCount', event.target.value) })),
                h('label', null, '取值下限', h('input', { className: 'sd-input', type: 'number', value: createForm.min, onChange: event => updateCreate('min', event.target.value) })),
                h('label', null, '取值上限', h('input', { className: 'sd-input', type: 'number', value: createForm.max, onChange: event => updateCreate('max', event.target.value) })),
                h('label', null, '波次（逗号分隔）', h('input', { className: 'sd-input', value: createForm.waves, placeholder: 'T0,T1', onChange: event => updateCreate('waves', event.target.value) })),
                h('label', null, '计分方式', h('select', { className: 'sd-select', value: createForm.scoringType, onChange: event => updateCreate('scoringType', event.target.value) },
                  h('option', { value: 'sum' }, '累加'),
                  h('option', { value: 'mean' }, '均分'),
                  h('option', { value: 'none' }, '不计分（只收集）')
                )),
                h('label', null, '反向题号（逗号分隔）', h('input', { className: 'sd-input', value: createForm.reverse, placeholder: '8,9,10', onChange: event => updateCreate('reverse', event.target.value) })),
                h('label', null, '缺失门槛（题数）', h('input', { className: 'sd-input', type: 'number', value: createForm.minAnswered, placeholder: '默认 80%', onChange: event => updateCreate('minAnswered', event.target.value) }))
              )
            )
          : null,
        error ? h('div', { className: 'sd-alert sd-alert-bad' }, error) : null,
        instrument && detail
          ? h('div', { className: 'sd-split' },
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 } },
                h('div', { className: 'sd-card' },
                  h('div', { className: 'sd-card-head' },
                    h('h3', null, instrument.short + ' · ' + instrument.name),
                    h('span', { className: 'sd-note' }, instrument.itemCount + ' 题，' + (instrument.scoringType === 'mean' ? '均分' : instrument.scoringType === 'none' ? '只收集' : '累加')),
                    h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' } },
                      h('span', { className: 'sd-chip' }, instrument.response.min + '–' + instrument.response.max + ' 计分'),
                      h(Btn, { children: editingMeta ? '取消' : '编辑信息', kind: 'outline', small: true, disabled: Boolean(actionBusy), onClick: () => (editingMeta ? setEditingMeta(false) : startMeta()) }),
                      h(Btn, { children: actionBusy === 'delete' ? '删除中…' : '删除量表', kind: 'ghost', small: true, disabled: Boolean(actionBusy), onClick: removeScale })
                    )
                  ),
                  h('div', { className: 'sd-kv' },
                    h('div', { className: 'sd-kv-item' }, h('span', null, '版本'), h('b', null, instrument.version || '—')),
                    h('div', { className: 'sd-kv-item' }, h('span', null, '缺失规则'), h('b', null, instrument.missing.rule === 'strict' ? '缺一题即不计分' : `比例折算，至少 ${instrument.missing.minAnswered} 题`)),
                    h('div', { className: 'sd-kv-item' }, h('span', null, '反向题'), h('b', null, instrument.reverse.length ? instrument.reverse.join('、') : '无')),
                    h('div', { className: 'sd-kv-item' }, h('span', null, '波次'), h('b', null, instrument.waves.map(waveName).join(' / ')))
                  ),
                  h('div', { className: 'sd-legend' },
                    Object.entries(detail.response.labels).map(([value, text]) =>
                      h('span', { key: value }, value + ' = ' + text)
                    )
                  ),
                  detail.instructions
                    ? h('details', { className: 'sd-details' },
                        h('summary', null, '指导语'),
                        h('div', { className: 'sd-note', style: { marginTop: 6, whiteSpace: 'pre-wrap' } }, detail.instructions)
                      )
                    : null
                ),
                editingMeta && metaForm
                  ? h('div', { className: 'sd-card' },
                      h('div', { className: 'sd-card-head' },
                        h('h3', null, '基本信息与计分'),
                        h('span', { className: 'sd-note' }, metaForm.multiSub ? '多分量表：计分键只能在定义 JSON 里改' : '改完保存会重算 scores.csv'),
                        h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
                          h(Btn, { children: actionBusy === 'meta' ? '保存中…' : '保存', kind: 'primary', small: true, disabled: Boolean(actionBusy), onClick: submitMeta })
                        )
                      ),
                      metaError ? h('div', { className: 'sd-alert sd-alert-bad', style: { margin: 0 } }, metaError) : null,
                      h('div', { className: 'sd-form-grid' },
                        h('label', null, '名称', h('input', { className: 'sd-input', value: metaForm.name, onChange: event => setMetaForm(prev => ({ ...prev, name: event.target.value })) })),
                        h('label', null, '简称', h('input', { className: 'sd-input', value: metaForm.short, onChange: event => setMetaForm(prev => ({ ...prev, short: event.target.value })) })),
                        h('label', null, '版本', h('input', { className: 'sd-input', value: metaForm.version, onChange: event => setMetaForm(prev => ({ ...prev, version: event.target.value })) })),
                        metaForm.multiSub
                          ? null
                          : h('label', null, '计分方式', h('select', {
                              className: 'sd-select',
                              value: metaForm.scoringType,
                              onChange: event => setMetaForm(prev => ({ ...prev, scoringType: event.target.value }))
                            },
                              h('option', { value: 'sum' }, '累加'),
                              h('option', { value: 'mean' }, '均分'),
                              h('option', { value: 'none' }, '不计分（只收集）')
                            )),
                        metaForm.multiSub
                          ? null
                          : h('label', null, '反向题号（逗号分隔）', h('input', { className: 'sd-input', value: Array.isArray(metaForm.reverse) ? metaForm.reverse.join('、') : metaForm.reverse, onChange: event => setMetaForm(prev => ({ ...prev, reverse: event.target.value })) })),
                        metaForm.multiSub
                          ? null
                          : h('label', null, '缺失门槛（题数）', h('input', { className: 'sd-input', type: 'number', value: metaForm.minAnswered, onChange: event => setMetaForm(prev => ({ ...prev, minAnswered: event.target.value })) }))
                      ),
                      h('label', { style: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, color: 'var(--sd-text2)' } },
                        '计分说明',
                        h('textarea', {
                          className: 'sd-input',
                          style: { height: 54, resize: 'vertical' },
                          value: metaForm.notes,
                          onChange: event => setMetaForm(prev => ({ ...prev, notes: event.target.value }))
                        })
                      ),
                      h('label', { style: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, color: 'var(--sd-text2)' } },
                        '指导语',
                        h('textarea', {
                          className: 'sd-input',
                          style: { height: 72, resize: 'vertical' },
                          value: metaForm.instructions,
                          onChange: event => setMetaForm(prev => ({ ...prev, instructions: event.target.value }))
                        })
                      )
                    )
                  : null,
                h('div', { className: 'sd-card' },
                  h('div', { className: 'sd-card-head' },
                    h('h3', null, '题目与反向标记'),
                    h('span', { className: 'sd-note' }, editing ? '改完点「保存题面」，只动文字，不动反向标记与计分键' : '题目只存在本机 _lab，不随插件分发'),
                    h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
                      editing
                        ? [
                            h(Btn, {
                              key: 'save',
                              children: busy === 'save' ? '保存中…' : '保存题面',
                              kind: 'primary',
                              small: true,
                              disabled: Boolean(busy),
                              onClick: saveTexts
                            }),
                            h(Btn, {
                              key: 'cancel',
                              children: '取消',
                              kind: 'ghost',
                              small: true,
                              disabled: Boolean(busy),
                              onClick: () => {
                                setEditing(false)
                                setDraft([])
                                setPasteText('')
                                setPasteIssues([])
                                setSaveError('')
                              }
                            })
                          ]
                        : Btn({
                            children: '编辑题面',
                            kind: 'outline',
                            small: true,
                            onClick: () => {
                              setDraft(detail.items.map(item => ({ no: item.no, text: item.text || '' })))
                              setEditing(true)
                            }
                          })
                    )
                  ),
                  editing
                    ? h('div', { className: 'sd-card', style: { background: 'var(--sd-sunk)' } },
                        h('details', { className: 'sd-details' },
                          h('summary', null, '从 Word / Excel 粘贴题目（题号 + 题目，一行一题）'),
                          h('textarea', {
                            className: 'sd-input',
                            style: { width: '100%', height: 130, marginTop: 8, resize: 'vertical' },
                            value: pasteText,
                            placeholder: '1\t第 1 题的文字\n2\t第 2 题的文字\n（也可以只贴题目，按题号顺序自动排）',
                            onChange: event => setPasteText(event.target.value)
                          }),
                          h('div', { style: { display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' } },
                            Btn({
                              children: busy === 'parse' ? '解析中…' : '解析并填入',
                              kind: 'outline',
                              small: true,
                              disabled: Boolean(busy) || !pasteText.trim(),
                              onClick: parsePaste
                            }),
                            h('span', { className: 'sd-note' }, '解析只填进下面的输入框，还要点「保存题面」才落盘')
                          ),
                          pasteIssues.length
                            ? h('div', { className: 'sd-issues', style: { marginTop: 8 } },
                                pasteIssues.map((item, index) => h('div', { className: 'sd-issue', key: index },
                                  h('span', { className: 'sd-badge sd-badge-' + (item.level === 'bad' ? 'bad' : item.level === 'warn' ? 'warn' : 'info') }, item.level === 'bad' ? '高' : item.level === 'warn' ? '中' : '提示'),
                                  h('span', { className: 'sd-issue-body' }, item.text)
                                ))
                              )
                            : null
                        )
                      )
                    : null,
                  saveError ? h('div', { className: 'sd-alert sd-alert-bad', style: { margin: 0 } }, saveError) : null,
                  detail.instructions
                    ? h('details', { className: 'sd-details' },
                        h('summary', null, '指导语'),
                        h('div', { className: 'sd-note', style: { marginTop: 6, whiteSpace: 'pre-wrap' } }, detail.instructions)
                      )
                    : null,
                  h('div', { className: 'sd-matrix' },
                    detail.items.map(item => {
                      const current = editing
                        ? (draft.find(entry => entry.no === item.no) || { text: '' })
                        : item
                      return h('div', { className: 'sd-item-row' + (item.reverse ? ' is-reverse' : ''), key: item.no },
                        h('span', { className: 'sd-item-no' }, String(item.no), item.reverse ? h('span', { className: 'sd-badge sd-badge-warn' }, '反') : null),
                        editing
                          ? h('input', {
                              className: 'sd-input sd-text-input',
                              value: current.text || '',
                              placeholder: '第 ' + item.no + ' 题（可留空）',
                              onChange: event => {
                                const value = event.target.value
                                setDraft(prev => prev.map(entry => entry.no === item.no ? { ...entry, text: value } : entry))
                              }
                            })
                          : h('span', { className: 'sd-item-text' + (item.text ? '' : ' is-empty') }, item.text || ('第 ' + item.no + ' 题（文本未录入）')),
                        h('span', { className: 'sd-note' }, detail.codes[instrument.waves[0]] ? detail.codes[instrument.waves[0]][item.no - 1] : '')
                      )
                    })
                  ),
                  h('div', { className: 'sd-note' }, editing
                    ? '题号与反向标记固定；换中文版就整份替换文字。保存后「录入 → 答题纸」立刻用新题面。'
                    : '题目文本可选，点「编辑题面」逐题填，或从 Word 表格粘进来。')
                )
              ),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 } },
                h('div', { className: 'sd-card' },
                  h('div', { className: 'sd-card-head' },
                    h('h3', null, '波次与导出码'),
                    h('span', { className: 'sd-note' }, wavesEditing ? '已有作答的波次不能改名或删除' : detail.waves.map(waveName).join(' / ')),
                    h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
                      wavesEditing
                        ? [
                            h(Btn, { key: 'add', children: '添加波次', kind: 'ghost', small: true, disabled: Boolean(waveBusy), onClick: addWave }),
                            h(Btn, { key: 'save', children: waveBusy === 'save' ? '保存中…' : '保存波次', kind: 'primary', small: true, disabled: Boolean(waveBusy), onClick: saveWaves }),
                            h(Btn, {
                              key: 'cancel',
                              children: '取消',
                              kind: 'ghost',
                              small: true,
                              disabled: Boolean(waveBusy),
                              onClick: () => { setWavesEditing(false); setWaveError('') }
                            })
                          ]
                        : h(Btn, { children: '编辑波次', kind: 'outline', small: true, onClick: startWaves })
                    )
                  ),
                  waveError ? h('div', { className: 'sd-alert sd-alert-bad', style: { margin: 0 } }, waveError) : null,
                  h('div', { className: 'sd-matrix' },
                    (wavesEditing ? wavesDraft : waveRows).map((row, index) => {
                      const recorded = ((instrument.data || {})[row.name] || {}).rows || 0
                      return h('div', {
                        className: 'sd-item-row',
                        key: index,
                        style: { gridTemplateColumns: '92px minmax(0,1fr) auto' }
                      },
                        wavesEditing
                          ? h('input', {
                              className: 'sd-input',
                              style: { height: 26, fontSize: 11.5, width: 84 },
                              value: row.name,
                              placeholder: 'T3',
                              onChange: event => setWavesDraft(prev => prev.map((entry, at) => at === index ? { ...entry, name: event.target.value } : entry))
                            })
                          : h('span', { className: 'sd-item-no' }, row.name),
                        wavesEditing
                          ? h('input', {
                              className: 'sd-text-input',
                              value: row.prefix,
                              placeholder: '导出码前缀，如 later_garden_',
                              onChange: event => setWavesDraft(prev => prev.map((entry, at) => at === index ? { ...entry, prefix: event.target.value } : entry))
                            })
                          : h('span', { className: 'sd-note' }, row.prefix
                              ? row.prefix + '01 … ' + row.prefix + String(instrument.itemCount).padStart(2, '0')
                              : '无导出码，导入时按列名 / 题号匹配'),
                        h('span', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                          h('span', { className: 'sd-chip' }, recorded + ' 份'),
                          wavesEditing && recorded === 0
                            ? h('button', {
                                type: 'button',
                                className: 'sd-chip',
                                style: { cursor: 'pointer', height: 22 },
                                title: '删除这个波次',
                                onClick: () => setWavesDraft(prev => prev.filter((_, at) => at !== index))
                              }, '删除')
                            : null
                        )
                      )
                    })
                  ),
                  h('div', { className: 'sd-note' }, wavesEditing
                    ? '波次名会进文件名与分数列名；导出码由前缀加 01…NN 自动生成，与题量对齐。'
                    : '同一份量表在多个阶段测，就是同一份定义下多个波次；点「编辑波次」增删。')
                ),
                h('div', { className: 'sd-card' },
                  h('div', { className: 'sd-card-head' }, h('h3', null, '计分键')),
                  detail.scoring.subscales.map(sub => h('div', { key: sub.key, style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                    h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
                      h('b', { style: { fontSize: 15, fontWeight: 600 } }, sub.label),
                      h('span', { className: 'sd-chip' }, sub.items.length + ' 题'),
                      sub.range ? h('span', { className: 'sd-chip' }, '范围 ' + sub.range[0] + '–' + sub.range[1]) : null,
                      sub.multiplier !== 1 ? h('span', { className: 'sd-chip' }, '×' + sub.multiplier) : null,
                      sub.descriptive ? h('span', { className: 'sd-chip' }, '描述性') : null
                    ),
                    h('div', { className: 'sd-note mono' }, '题号 ' + sub.items.join('、')),
                    h('div', { className: 'sd-note' }, sub.minAnswered ? '至少答 ' + sub.minAnswered + ' 题' : '')
                  ))
                ),
                h('div', { className: 'sd-card' },
                  h('div', { className: 'sd-card-head' }, h('h3', null, '出处与授权')),
                  h('div', { style: { fontSize: 13.5, color: 'var(--sd-text2)', display: 'flex', flexDirection: 'column', gap: 8 } },
                    h('div', null, h('b', { style: { color: 'var(--sd-text)' } }, '来源：'), instrument.source || '—'),
                    h('div', null, h('b', { style: { color: 'var(--sd-text)' } }, '授权：'), instrument.license || '—'),
                    instrument.notes ? h('div', null, h('b', { style: { color: 'var(--sd-text)' } }, '计分说明：'), instrument.notes) : null,
                    h('div', { className: 'sd-mono' }, instrument.file || '')
                  )
                )
              )
            )
          : null
      )
    }

    /* ================================================================ *
     * 录入
     * ================================================================ */

    function answerSheetRows(data, scaleId, wave) {
      const missingKey = scaleId + '_' + wave + '_缺失'
      return data.scores.rows
        .filter(row => row.cells[missingKey] && row.cells[missingKey].status !== 'absent')
        .map(row => ({
          id: row.id,
          missing: row.cells[missingKey].value,
          status: row.cells[missingKey].status
        }))
    }

    function SheetEntry({ data, busy, onSave, onClear, toast, initial }) {
      const firstScale = initial && initial.scale && data.instruments.some(item => item.id === initial.scale)
        ? initial.scale
        : (data.instruments[0] ? data.instruments[0].id : '')
      const firstInstrument = data.instruments.find(item => item.id === firstScale) || data.instruments[0]
      const firstWave = initial && initial.wave && firstInstrument && firstInstrument.waves.includes(initial.wave)
        ? initial.wave
        : (firstInstrument ? firstInstrument.waves[0] : 'T0')
      const [scaleId, setScaleId] = useState(firstScale)
      const instrument = data.instruments.find(item => item.id === scaleId) || data.instruments[0]
      const [wave, setWave] = useState(firstWave)
      const [id, setId] = useState(initial && initial.id ? initial.id : '')
      const [values, setValues] = useState({})
      const [loaded, setLoaded] = useState(null)
      const [result, setResult] = useState(null)
      const [error, setError] = useState('')

      useEffect(() => {
        if (!instrument) return
        if (!instrument.waves.includes(wave)) setWave(instrument.waves[0])
      }, [scaleId])

      const def = instrument
      const answered = def ? Object.values(values).filter(value => String(value).trim() !== '').length : 0
      const missing = def ? def.itemCount - answered : 0

      const load = useCallback(async targetId => {
        if (!def) return
        const clean = String(targetId || id).trim()
        if (!clean) {
          setError('编号不能为空')
          return
        }
        setError('')
        try {
          const answer = await call('answer', { id: clean, scale: def.id, wave })
          setId(clean)
          setValues(answer.values || {})
          setLoaded(answer.exists)
          setResult(null)
          if (!answer.exists) toast('这个编号在这份量表里还没有记录，填完保存即新建。')
        } catch (err) {
          setError(err.message)
        }
      }, [def, wave, id, toast])

      const save = async () => {
        if (!def) return
        const clean = String(id).trim()
        if (!clean) {
          setError('编号不能为空')
          return
        }
        setError('')
        try {
          const saved = await onSave({ id: clean, scale: def.id, wave, values })
          setValues(saved.values || values)
          setLoaded(true)
          setResult(saved.scored)
          const bits = Object.entries(saved.scored.subs).map(([key, sub]) => {
            const meta = (def.subscales || []).find(item => item.key === key)
            const label = meta ? meta.label : key
            return sub.score === null ? label + ' 未计分' : label + ' ' + sub.score
          })
          const filled = Object.values(saved.values || values).filter(value => String(value).trim() !== '').length
          toast(bits.length
            ? '已保存 ' + clean + '：' + bits.join('，')
            : '已保存 ' + clean + '：' + filled + '/' + def.itemCount + ' 题')
        } catch (err) {
          setError(err.message)
        }
      }

      const clearOne = async () => {
        if (!def) return
        const clean = String(id).trim()
        if (!clean) return
        try {
          await onClear({ id: clean, scale: def.id, wave })
          setValues({})
          setLoaded(false)
          setResult(null)
          toast('已删除 ' + clean + ' 的 ' + def.short + ' ' + wave + ' 作答。')
        } catch (err) {
          setError(err.message)
        }
      }

      const recorded = def ? answerSheetRows(data, def.id, wave) : []

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-field' },
            h('label', { htmlFor: 'sd-sheet-scale' }, '量表'),
            h('select', {
              id: 'sd-sheet-scale',
              className: 'sd-select',
              value: def ? def.id : '',
              onChange: event => { setScaleId(event.target.value); setValues({}); setResult(null); setLoaded(null) }
            }, data.instruments.map(item => h('option', { key: item.id, value: item.id }, item.short + '（' + item.itemCount + ' 题）'))),
            h('label', { htmlFor: 'sd-sheet-wave' }, '波次'),
            h('select', {
              id: 'sd-sheet-wave',
              className: 'sd-select',
              style: { maxWidth: 130 },
              value: wave,
              onChange: event => { setWave(event.target.value); setValues({}); setResult(null); setLoaded(null) }
            }, (def ? def.waves : []).map(item => h('option', { key: item, value: item }, waveName(item)))),
            h('label', { htmlFor: 'sd-sheet-id' }, '编号'),
            h('input', {
              id: 'sd-sheet-id',
              className: 'sd-input sd-id-input',
              value: id,
              placeholder: 'P-001',
              onChange: event => setId(event.target.value),
              onKeyDown: event => { if (event.key === 'Enter') load() }
            }),
            Btn({ children: '载入', kind: 'outline', onClick: () => load(), disabled: busy }),
            Btn({ children: loaded ? '保存修改' : '保存', kind: 'primary', onClick: save, disabled: busy || !def }),
            loaded ? Btn({ children: '删除这份', kind: 'ghost', onClick: clearOne, disabled: busy }) : null
          ),
          error ? h('div', { className: 'sd-alert sd-alert-bad', style: { margin: 0 } }, error) : null,
          h('div', { className: 'sd-legend' },
            h('span', null, '已答 ' + answered + ' / ' + (def ? def.itemCount : 0) + (missing ? '（缺 ' + missing + ' 题）' : '')),
            def ? h('span', null, def.missing.rule === 'strict' ? '缺失规则：缺一题即不计分' : '缺失规则：比例折算，至少 ' + def.missing.minAnswered + ' 题') : null,
            def && def.reverse.length ? h('span', null, '橙底 = 反向题：' + def.reverse.join('、')) : null
          )
        ),
        def
          ? h('div', { className: 'sd-card' },
              h('div', { className: 'sd-card-head' }, h('h3', null, def.short + ' · ' + waveName(wave)),
                h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' } },
                  h('span', { className: 'sd-note' }, '按题型作答；选错再点一次取消')
                )
              ),
              def.instructions
                ? h('details', { className: 'sd-details' },
                    h('summary', null, '指导语'),
                    h('div', { className: 'sd-note', style: { marginTop: 6, whiteSpace: 'pre-wrap' } }, def.instructions)
                  )
                : null,
              h('div', { className: 'sd-matrix' },
                Array.from({ length: def.itemCount }, (_, index) => {
                  const no = index + 1
                  const entry = def.items.find(item => item.no === no) || { no, kind: 'likert', options: [] }
                  const kind = entry.kind || 'likert'
                  const current = values[no] === undefined ? '' : String(values[no])
                  const reverse = def.reverse.includes(no)
                  const itemText = entry.text || ''
                  const setValue = next => {
                    setValues(prev => {
                      const draft = { ...prev }
                      if (next === '' || next === null || next === undefined) delete draft[no]
                      else draft[no] = String(next)
                      return draft
                    })
                  }
                  const labelId = 'sd-sheet-question-' + no
                  return h('div', { className: 'sd-item-row' + (reverse ? ' is-reverse' : ''), key: no, role: 'group', 'aria-labelledby': labelId },
                    h('span', { className: 'sd-item-no' }, String(no)),
                    h('span', {
                      id: labelId,
                      className: 'sd-item-text' + (itemText ? '' : ' is-empty'),
                      title: itemText || '第 ' + no + ' 题（文本未录入）'
                    }, itemText || '第 ' + no + ' 题'),
                    h('div', { className: 'sd-opts' },
                      kind === 'text'
                        ? h('input', {
                            className: 'sd-input',
                            style: { width: 280, height: 26, fontSize: 11.5 },
                            value: current,
                            'aria-labelledby': labelId,
                            maxLength: entry.maxLength || 2000,
                            placeholder: entry.maxLength ? '文本，最多 ' + entry.maxLength + ' 字' : '文本',
                            onChange: event => setValue(event.target.value)
                          })
                        : kind === 'choice' || kind === 'multi'
                          ? (entry.options || []).map(option => {
                              const selected = kind === 'multi'
                                ? current.split(',').map(part => part.trim()).filter(Boolean).includes(option.value)
                                : current === option.value
                              return h('button', {
                                key: option.value,
                                type: 'button',
                                className: 'sd-opt' + (selected ? ' is-on' : ''),
                                'aria-pressed': selected,
                                title: option.value,
                                onClick: () => {
                                  if (kind === 'multi') {
                                    const parts = current.split(',').map(part => part.trim()).filter(Boolean)
                                    const next = selected
                                      ? parts.filter(part => part !== option.value)
                                      : [...parts, option.value]
                                    setValue(next.join(','))
                                  } else {
                                    setValue(selected ? '' : option.value)
                                  }
                                }
                              }, option.label)
                            })
                          : kind === 'number'
                            ? h('input', {
                                className: 'sd-input',
                                type: 'number',
                                'aria-labelledby': labelId,
                                min: entry.min === null || entry.min === undefined ? undefined : entry.min,
                                max: entry.max === null || entry.max === undefined ? undefined : entry.max,
                                style: { width: 120, height: 26, fontSize: 11.5, textAlign: 'right' },
                                value: current,
                                placeholder: [entry.min, entry.max].filter(value => value !== null && value !== undefined).join('–'),
                                onChange: event => setValue(event.target.value)
                              })
                            : Math.round(def.response.max - def.response.min + 1) > 12
                              ? h('input', {
                                  className: 'sd-input',
                                  type: 'number',
                                  'aria-labelledby': labelId,
                                  min: def.response.min,
                                  max: def.response.max,
                                  style: { width: 96, height: 26, fontSize: 11.5, textAlign: 'right' },
                                  value: current,
                                  placeholder: def.response.min + '–' + def.response.max,
                                  onChange: event => setValue(event.target.value)
                                })
                              : Array.from({ length: Math.round(def.response.max - def.response.min + 1) }, (_, offset) => {
                                  const value = def.response.min + offset
                                  const on = current === String(value)
                                  return h('button', {
                                    key: value,
                                    type: 'button',
                                    className: 'sd-opt' + (on ? ' is-on' : ''),
                                    'aria-pressed': on,
                                    'aria-label': String(value) + (def.response.labels[value] ? ' · ' + def.response.labels[value] : ''),
                                    title: def.response.labels[value] || '',
                                    onClick: () => setValue(on ? '' : String(value))
                                  }, String(value))
                                })
                    )
                  )
                })
              )
            )
          : null,
        result
          ? h('div', { className: 'sd-card' },
              h('div', { className: 'sd-card-head' }, h('h3', null, '这份的分数')),
              h('div', { className: 'sd-kv' },
                Object.values(result.subs).map(sub => h('div', { className: 'sd-kv-item', key: sub.key },
                  h('span', null, def ? (def.subscales.find(item => item.key === sub.key) || {}).label || sub.key : sub.key),
                  h('b', null, sub.score === null ? '未计分' : String(sub.score)),
                  h('span', null, '答 ' + sub.answered + ' / ' + (sub.answered + sub.missing))
                ))
              )
            )
          : null,
        def
          ? h('div', { className: 'sd-card' },
              h('div', { className: 'sd-card-head' },
                h('h3', null, '已录 ' + def.short + ' ' + waveName(wave)),
                h('span', { className: 'sd-note' }, recorded.length + ' 人')
              ),
              recorded.length
                ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                    recorded.map(row => h('button', {
                      type: 'button',
                      key: row.id,
                      className: 'sd-chip',
                      style: { cursor: 'pointer' },
                      title: '缺 ' + (row.missing ?? 0) + ' 题',
                      onClick: () => load(row.id)
                    }, row.id + (row.missing ? ' ·缺' + row.missing : '')))
                  )
                : h('div', { className: 'sd-note' }, '还没有人录这个量表。左边填编号与作答，或到「导入」里传问卷平台导出。')
            )
          : null
      )
    }

    function ImportPanel({ data, toast, onImported }) {
      const [files, setFiles] = useState([])
      const [text, setText] = useState('')
      const [previews, setPreviews] = useState([])
      const [focus, setFocus] = useState(0)
      const [manual, setManual] = useState({})
      const [mode, setMode] = useState('merge')
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [over, setOver] = useState(false)
      const fileRef = useRef(null)

      const readFiles = useCallback(async fileList => {
        const list = Array.from(fileList || [])
        const next = []
        for (const file of list) {
          const buffer = await file.arrayBuffer()
          const bytes = new Uint8Array(buffer)
          let binary = ''
          for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
          next.push({ name: file.name || '文件 ' + (next.length + 1), base64: btoa(binary) })
        }
        setFiles(next)
        setText('')
        setPreviews([])
        setFocus(0)
        setError('')
        if (fileRef.current) fileRef.current.value = ''
      }, [])

      const sources = () => {
        if (files.length) return files.map(file => ({ name: file.name, base64: file.base64 }))
        if (text.trim()) return [{ name: '粘贴的文本', text }]
        return []
      }

      const previewAll = async () => {
        const list = sources()
        if (!list.length) {
          setError('先选导出文件（CSV / TSV / Excel），或粘贴表格文本')
          return
        }
        setBusy('preview')
        setError('')
        const results = []
        for (const source of list) {
          try {
            const payload = source.base64
              ? { data: source.base64, filename: source.name }
              : { text: source.text, filename: source.name }
            const next = await call('importPreview', payload)
            results.push({ ...source, status: next.requiresTarget ? 'error' : 'ok', error: next.requiresTarget ? '仅有候选：' + next.targets.map(target => target.short + ' ' + target.wave).join('、') + '。请选择目标后预览。' : '', data: next, imported: false, auto: !next.requiresTarget, targets: next.targets.filter(target => target.automatic) })
          } catch (err) {
            results.push({ ...source, status: 'error', error: err.message })
          }
        }
        setPreviews(results)
        const firstOk = results.findIndex(item => item.status === 'ok')
        setFocus(firstOk >= 0 ? firstOk : 0)
        setBusy('')
      }

      const previewWithTarget = async index => {
        const entry = previews[index]
        if (!entry) return
        const choice = manual[index] || {}
        if (!choice.scale || !choice.wave) {
          setError('先给这份文件选一个量表与波次')
          return
        }
        setBusy('preview-' + index)
        setError('')
        try {
          const payload = entry.base64
            ? { data: entry.base64, filename: entry.name, scale: choice.scale, wave: choice.wave }
            : { text: entry.text, filename: entry.name, scale: choice.scale, wave: choice.wave }
          const next = await call('importPreview', payload)
          setPreviews(prev => prev.map((item, at) => at === index ? { ...item, status: 'ok', data: next, auto: false, error: '', mappingError: false } : item))
          setFocus(index)
        } catch (err) {
          setError(entry.name + '：' + err.message)
        } finally {
          setBusy('')
        }
      }

      const updateMapping = async (index, mapping, target) => {
        const entry = previews[index]
        if (!entry) return
        const scale = target ? target.scale : entry.data.scale
        const wave = target ? target.wave : entry.data.wave
        setBusy('mapping')
        setError('')
        // A failed preview must not leave an importable stale mapping behind.
        setPreviews(prev => prev.map((item, at) => at === index ? { ...item, mappingError: true } : item))
        try {
          const next = await call('importPreview', { data: entry.base64, text: entry.text, filename: entry.name, scale, wave, mapping })
          setPreviews(prev => prev.map((item, at) => at === index ? { ...item, mappingError: false, data: next, targets: (item.targets || []).map(candidate => candidate.scale === scale && candidate.wave === wave ? { ...candidate, mapping: next.mapping } : candidate) } : item))
        } catch (err) { setError(err.message) } finally { setBusy('') }
      }

      const applyEntry = async entry => {
        if (entry.mappingError) throw new Error('列映射尚未通过预览，请修正后重试')
        if (entry.auto) {
          const result = await call('importFile', {
            data: entry.base64 || undefined,
            text: entry.text || undefined,
            filename: entry.name,
            mode,
            targets: entry.targets.map(target => ({ scale: target.scale, wave: target.wave, mapping: target.scale === entry.data.scale && target.wave === entry.data.wave ? entry.data.mapping : target.mapping }))
          })
          return { multi: true, result }
        }
        const result = await call('importApply', {
          data: entry.base64 || undefined,
          text: entry.text || undefined,
          filename: entry.name,
          scale: entry.data.scale,
          wave: entry.data.wave,
          mode,
          mapping: entry.data.mapping
        })
        return { multi: false, result }
      }

      const importAt = async index => {
        const entry = previews[index]
        if (!entry || entry.status !== 'ok' || entry.imported) return
        setBusy('apply-' + index)
        setError('')
        try {
          const outcome = await applyEntry(entry)
          if (outcome.multi) {
            const bits = outcome.result.results.map(item => item.short + ' ' + waveName(item.wave) + ' ' + item.imported + ' 行')
            toast('已导入 ' + entry.name + '：' + bits.join('，'))
          } else {
            const result = outcome.result
            toast('已导入 ' + entry.name + '：' + result.imported + ' 行到 ' + result.scale + ' ' + waveName(result.wave) + '（现共 ' + result.total + ' 人）')
          }
          setPreviews(prev => prev.map((item, at) => at === index ? { ...item, imported: true } : item))
          if (onImported) onImported()
        } catch (err) {
          setError(entry.name + '：' + err.message)
        } finally {
          setBusy('')
        }
      }

      const importAll = async () => {
        const pending = previews
          .map((entry, index) => ({ entry, index }))
          .filter(item => item.entry.status === 'ok' && !item.entry.imported && !item.entry.mappingError)
        if (!pending.length) return
        setBusy('apply-all')
        setError('')
        let done = 0
        const failed = []
        for (const item of pending) {
          try {
            const result = await applyEntry(item.entry)
            done += 1
            setPreviews(prev => prev.map((entry, index) => index === item.index ? { ...entry, imported: true } : entry))
          } catch (err) {
            failed.push(item.entry.name + '：' + err.message)
          }
        }
        setBusy('')
        if (done) toast('已导入 ' + done + ' 个文件')
        if (failed.length) setError(failed.join('；'))
        if (onImported) onImported()
      }

      const focused = previews[focus]
      const headers = focused && focused.status === 'ok' ? focused.data.header : []
      const okCount = previews.filter(item => item.status === 'ok' && !item.imported && !item.mappingError).length

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-card-head' },
            h('h3', null, '导入问卷平台导出'),
            h('span', { className: 'sd-note' }, 'Excel（.xlsx）、CSV、TSV 都认；UTF-8 与 GBK 都试一遍')
          ),
          h('div', {
            className: 'sd-drop' + (over ? ' is-over' : ''),
            role: 'button',
            tabIndex: 0,
            onDragOver: event => { event.preventDefault(); setOver(true) },
            onDragLeave: () => setOver(false),
            onDrop: event => {
              event.preventDefault()
              setOver(false)
              readFiles(event.dataTransfer.files)
            },
            onClick: () => fileRef.current && fileRef.current.click(),
            onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (fileRef.current) fileRef.current.click() } }
          },
            h('strong', null, '把导出文件拖到这里，或点一下选文件（可多选）'),
            h('span', null, '专用题码可识别多个目标；通用题号、文字与顺序只提供候选，需选择量表与波次。')
          ),
          h('input', {
            ref: fileRef,
            type: 'file',
            accept: '.xlsx,.csv,.tsv,.txt',
            multiple: true,
            style: { display: 'none' },
            onChange: event => readFiles(event.target.files)
          }),
          files.length
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                files.map((file, index) => h('div', { className: 'sd-file', key: index },
                  h('span', null, h('b', null, file.name)),
                  h('span', { className: 'sd-note' }, Math.round((file.base64.length * 0.75) / 1024) + ' KB'),
                  h(Btn, {
                    children: '移除',
                    kind: 'ghost',
                    small: true,
                    onClick: () => setFiles(prev => prev.filter((_, at) => at !== index))
                  })
                ))
              )
            : null,
          h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
            h('details', { className: 'sd-details', style: { flex: '1 1 320px' } },
              h('summary', null, text ? '粘贴的文本（' + text.length + ' 字符）' : '也可以直接粘贴表格文本'),
              h('textarea', {
                className: 'sd-input',
                style: { width: '100%', height: 110, marginTop: 8, resize: 'vertical' },
                value: text,
                placeholder: 'participantId,garden_b_1,...',
                onChange: event => { setText(event.target.value); setFiles([]); setPreviews([]) }
              })
            ),
            h('div', { style: { display: 'flex', gap: 6 } },
              Btn({ children: busy === 'preview' ? '识别中…' : '预览全部', kind: 'outline', onClick: previewAll, disabled: Boolean(busy) || !sources().length }),
              previews.length
                ? Btn({ children: '清空', kind: 'ghost', onClick: () => { setPreviews([]); setFiles([]); setText(''); setError('') } })
                : null
            )
          )
        ),
        error ? h('div', { className: 'sd-alert sd-alert-bad' }, error) : null,
        previews.length
          ? h('div', { className: 'sd-card' },
              h('div', { className: 'sd-card-head' },
                h('h3', null, '待导入 ' + previews.length + ' 份'),
                h('span', { className: 'sd-note' }, '点一行看它的映射；每份可以单独导入'),
                h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
                  Btn({ children: busy === 'apply-all' ? '导入中…' : '导入已确认目标（' + okCount + '）', kind: 'primary', small: true, disabled: Boolean(busy) || !okCount, onClick: importAll })
                )
              ),
              h('div', { className: 'sd-table-wrap', style: { maxHeight: 'none' } },
                h('table', { className: 'sd-table', style: { minWidth: 720 } },
                  h('thead', null, h('tr', null,
                    h('th', null, '文件'),
                    h('th', null, '工作表'),
                    h('th', null, '识别为'),
                    h('th', { className: 'is-score' }, '行'),
                    h('th', { className: 'is-score' }, '匹配'),
                    h('th', null, '状态'),
                    h('th', null, '')
                  )),
                  h('tbody', null, previews.map((entry, index) => {
                    const ok = entry.status === 'ok'
                    return h('tr', {
                      key: index,
                      className: focus === index ? 'is-open' : '',
                      onClick: () => setFocus(index)
                    },
                      h('td', { className: 'sd-mono' }, entry.name),
                      h('td', { className: 'sd-note' }, ok ? entry.data.sheet || '—' : ''),
                      h('td', null, ok
                        ? (entry.auto
                            ? h('span', { className: 'sd-note', title: (entry.targets || []).map(t => t.short + ' ' + t.wave).join('，') },
                                (entry.targets || []).length + ' 组：' + (entry.targets || []).slice(0, 2).map(t => t.short).join('、') + ((entry.targets || []).length > 2 ? '…' : ''))
                            : entry.data.scale + ' · ' + waveName(entry.data.wave))
                        : '—'),
                      h('td', { className: 'is-score' }, ok ? String(entry.data.rows) : ''),
                      h('td', { className: 'is-score' }, ok ? entry.data.mapping.matched + '/' + entry.data.mapping.total : ''),
                      h('td', null, entry.imported
                        ? h('span', { className: 'sd-badge sd-badge-ok' }, '已导入')
                        : ok
                          ? h('span', { className: 'sd-badge sd-badge-info' }, entry.auto ? '自动匹配' : '手动指定')
                          : h('span', { className: 'sd-badge sd-badge-bad', title: entry.error }, '认不出')),
                      h('td', null, ok && !entry.imported
                        ? h(Btn, {
                            children: busy === 'apply-' + index ? '导入中…' : entry.auto ? '导入确认目标' : '导入这一组',
                            kind: 'outline',
                            small: true,
                            disabled: Boolean(busy),
                            onClick: event => { event.stopPropagation(); importAt(index) }
                          })
                        : ok
                          ? h('span', { className: 'sd-note' }, '')
                          : h('div', { style: { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }, onClick: event => event.stopPropagation() },
                              h('select', {
                                className: 'sd-select',
                                style: { height: 24, maxWidth: 110, fontSize: 11 },
                                value: (manual[index] || {}).scale || '',
                                onChange: event => setManual(prev => ({ ...prev, [index]: { ...(prev[index] || {}), scale: event.target.value, wave: '' } }))
                              },
                                h('option', { value: '' }, '选量表'),
                                data.instruments.map(item => h('option', { key: item.id, value: item.id }, item.short))
                              ),
                              h('select', {
                                className: 'sd-select',
                                style: { height: 24, maxWidth: 90, fontSize: 11 },
                                value: (manual[index] || {}).wave || '',
                                onChange: event => setManual(prev => ({ ...prev, [index]: { ...(prev[index] || {}), wave: event.target.value } }))
                              },
                                h('option', { value: '' }, '波次'),
                                (((data.instruments.find(item => item.id === (manual[index] || {}).scale) || {}).waves) || []).map(item => h('option', { key: item, value: item }, waveName(item)))
                              ),
                              h(Btn, {
                                children: busy === 'preview-' + index ? '识别中…' : '预览',
                                kind: 'ghost',
                                small: true,
                                disabled: Boolean(busy),
                                onClick: () => previewWithTarget(index)
                              })
                            ))
                    )
                  }))
                )
              ),
              h('div', { className: 'sd-field' },
                h('div', { className: 'sd-field' },
                  h('label', null, h('input', { type: 'radio', name: 'sd-mode', checked: mode === 'merge', onChange: () => setMode('merge') }), ' 合并（同编号同答案原位替换，不同答案会留两行待核对）'),
                  h('label', null, h('input', { type: 'radio', name: 'sd-mode', checked: mode === 'replace', onChange: () => setMode('replace') }), ' 覆盖整份')
                )
              )
            )
          : null,
        focused && focused.status === 'ok'
          ? h('div', { className: 'sd-card' },
              h('div', { className: 'sd-card-head' },
                h('h3', null, '映射：' + focused.name),
                h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' } },
                  h('label', { className: 'sd-field' }, '编号列', h('select', {
                    className: 'sd-select', value: focused.data.mapping.idIndex, disabled: Boolean(busy) || focused.imported,
                    onChange: event => updateMapping(focus, { ...focused.data.mapping, idIndex: Number(event.target.value) })
                  }, headers.map((name, index) => h('option', { key: index, value: index }, (index + 1) + ' · ' + name)))),
                  focused.auto ? h('label', { className: 'sd-field' }, '查看目标', h('select', {
                    className: 'sd-select', value: JSON.stringify([focused.data.scale, focused.data.wave]), disabled: Boolean(busy) || focused.imported,
                    onChange: event => { const [scale, wave] = JSON.parse(event.target.value); const target = focused.targets.find(target => target.scale === scale && target.wave === wave); updateMapping(focus, target.mapping, target) }
                  }, focused.targets.map(target => h('option', { key: JSON.stringify([target.scale,target.wave]), value: JSON.stringify([target.scale,target.wave]) }, target.short + ' ' + target.wave)))) : null,
                  h('span', { className: 'sd-chip' }, focused.data.scaleName + ' · ' + waveName(focused.data.wave)),
                  h('span', { className: 'sd-chip' }, '匹配 ' + focused.data.mapping.matched + '/' + focused.data.mapping.total),
                  h('span', { className: 'sd-chip' }, focused.data.rows + ' 行'),
                  focused.data.emptyCells ? h('span', { className: 'sd-chip' }, '空格 ' + focused.data.emptyCells) : null
                )
              ),
              focused.data.mapping.unmatched.length
                ? h('div', { className: 'sd-alert sd-alert-warn', style: { margin: 0 } }, '有 ' + focused.data.mapping.unmatched.length + ' 题没认到列：第 ' + focused.data.mapping.unmatched.join('、') + ' 题。可在下面手动指定，否则按缺失处理。')
                : null,
              h('div', { className: 'sd-table-wrap', style: { maxHeight: 'none' } },
                h('table', { className: 'sd-table' },
                  h('thead', null, h('tr', null,
                    h('th', { className: 'sd-sticky' }, '编号'),
                    h('th', { className: 'is-score' }, '已答'),
                    h('th', { className: 'is-score' }, '缺'),
                    h('th', null, '分量表预览')
                  )),
                  h('tbody', null, focused.data.preview.map(row => h('tr', { key: row.id },
                    h('td', { className: 'sd-sticky sd-id' }, row.id),
                    h('td', { className: 'is-score' }, String(row.answered)),
                    h('td', { className: 'is-score' }, row.missing ? String(row.missing) : ''),
                    h('td', { className: 'sd-mono' }, Object.entries(row.subs).map(([key, value]) => key + ' ' + (value === null ? '—' : value)).join('  '))
                  )))
                )
              ),
              h('details', { className: 'sd-details' },
                h('summary', null, '手动改列对应（' + focused.data.mapping.total + ' 题）'),
                h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 6, marginTop: 8 } },
                  focused.data.mapping.items.map(item => h('div', { key: item.no, style: { display: 'flex', gap: 6, alignItems: 'center' } },
                    h('span', { className: 'sd-note', style: { width: 34 } }, '第' + item.no),
                    h('select', {
                      className: 'sd-select',
                      style: { flex: 1, maxWidth: 'none', height: 26, fontSize: 11 },
                      value: item.index,
                       disabled: Boolean(busy) || focused.imported,
                       onChange: event => {
                         const index = Number(event.target.value)
                         updateMapping(focus, { ...focused.data.mapping, items: focused.data.mapping.items.map(candidate => candidate.no === item.no ? { ...candidate, index, column: index >= 0 ? headers[index] : null, how: 'manual' } : candidate) })
                       }
                     },
                       h('option', { value: -1 }, '（缺失）'),
                       headers.map((name, index) => h('option', { key: index, value: index }, (index + 1) + ' · ' + name))
                    )
                  ))
                )
              ),
              focused.data.issues && focused.data.issues.length
                ? h('div', { className: 'sd-issues' },
                    focused.data.issues.slice(0, 12).map((item, index) => h('div', { className: 'sd-issue', key: index },
                      h('span', { className: 'sd-badge sd-badge-' + (item.level === 'bad' ? 'bad' : item.level === 'warn' ? 'warn' : 'info') }, LEVEL_TEXT[item.level] || '提示'),
                      h('span', { className: 'sd-issue-body' }, item.text)
                    ))
                  )
                : null,
              h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
                Btn({
                  children: busy === 'apply-' + focus ? '导入中…' : focused.imported ? '已导入' : focused.auto ? '导入这份文件（确认目标）' : '导入这一组',
                  kind: 'primary',
                  disabled: Boolean(busy) || focused.imported || focused.mappingError,
                  onClick: () => importAt(focus)
                })
              )
            )
          : null,
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-card-head' }, h('h3', null, '导入记录'), h('span', { className: 'sd-note' }, '写进 _lab/scales/imports.json，含当时的定义版本')),
          data.imports && data.imports.length
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
                data.imports.map((entry, index) => h('div', { key: index, style: { display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 13, flexWrap: 'wrap' } },
                  h('span', { className: 'sd-note mono' }, String(entry.at || '').replace('T', ' ').slice(0, 16)),
                  h('span', { className: 'sd-chip' }, entry.action === 'import' ? '导入' : entry.action === 'manual' ? '手填' : entry.action === 'keep-one' ? '留一份' : entry.action === 'rename' ? '改号' : entry.action === 'delete-row' ? '删行' : '删除'),
                  h('span', { className: 'sd-mono' }, entry.scale + ' ' + entry.wave),
                  h('span', { className: 'sd-note' }, entry.file || entry.note || ''),
                  h('span', { className: 'sd-note', style: { marginLeft: 'auto' } }, entry.rows ? entry.rows + ' 行' : '')
                ))
              )
            : h('div', { className: 'sd-note' }, '还没有导入记录。')
        )
      )
    }

    /* ================================================================ *
     * 流程
     * ================================================================ */

    function FlowTab({ data, onOpenScale }) {
      const flow = data.flow || { stages: [], problems: [] }
      const recorded = (scale, wave) => {
        const instrument = data.instruments.find(item => item.id === scale)
        return instrument && instrument.data && instrument.data[wave] ? instrument.data[wave].rows : 0
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-card-head' },
            h('h3', null, '施测流程'),
            h('span', { className: 'sd-note' }, [flow.source, flow.version].filter(Boolean).join(' · ')),
            h('span', { className: 'sd-chip', style: { marginLeft: 'auto' } }, flow.stages.length + ' 个阶段')
          ),
          flow.note ? h('div', { className: 'sd-note' }, flow.note) : null,
          flow.problems && flow.problems.length
            ? h('div', { className: 'sd-issues' },
                flow.problems.map((item, index) => h('div', { className: 'sd-issue', key: index },
                  h('span', { className: 'sd-badge sd-badge-' + (item.level === 'bad' ? 'bad' : 'warn') }, item.level === 'bad' ? '高' : '中'),
                  h('span', { className: 'sd-issue-body' }, item.text)
                ))
              )
            : null
        ),
        flow.stages.map(stage => h('div', { className: 'sd-card', key: stage.id },
          h('div', { className: 'sd-card-head' },
            h('h3', null, stage.label),
            h('span', { className: 'sd-note' }, stage.steps.length + ' 步')
          ),
          stage.note ? h('div', { className: 'sd-note' }, stage.note) : null,
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
            stage.steps.map((step, index) => {
              const isScale = step.kind === 'scale'
              const instrument = isScale ? data.instruments.find(item => item.id === step.scale) : null
              return h('div', {
                key: index,
                style: {
                  display: 'grid',
                  gridTemplateColumns: '22px 56px minmax(0,1fr) auto',
                  gap: 10,
                  alignItems: 'center',
                  padding: '5px 8px',
                  border: '1px solid var(--sd-line)',
                  borderRadius: 8,
                  background: 'var(--sd-raised)'
                }
              },
                h('span', { className: 'sd-note', style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, String(index + 1)),
                h('span', { className: 'sd-chip', style: { justifyContent: 'center' } }, FLOW_KIND[step.kind] || step.kind),
                h('div', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 } },
                  h('span', {
                    style: {
                      fontSize: 14,
                      fontWeight: isScale ? 600 : 400,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }
                  }, isScale && instrument ? instrument.short + ' · ' + instrument.name : step.title),
                  step.note ? h('span', { className: 'sd-note', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, step.note) : null
                ),
                isScale
                  ? h('span', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                      h('span', { className: 'sd-chip' }, waveName(step.wave)),
                      h('span', { className: 'sd-chip' }, recorded(step.scale, step.wave) + ' 份'),
                      h('button', {
                        type: 'button',
                        className: 'sd-chip is-brand',
                        style: { cursor: 'pointer', height: 24 },
                        onClick: () => onOpenScale(step.scale, step.wave)
                      }, '录入')
                    )
                  : h('span', { className: 'sd-note' }, '')
              )
            })
          )
        ))
      )
    }

    /* ================================================================ *
     * 批量清理（编号可疑、测试提交、重复提交）
     * ================================================================ */

    function CleanupPanel({ data, toast, refresh }) {
      const [entries, setEntries] = useState([])
      const [picked, setPicked] = useState({})
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [manual, setManual] = useState('')
      const [from, setFrom] = useState('')
      const [to, setTo] = useState('')

      const load = useCallback(async () => {
        try {
          const result = await call('suspicious')
          setEntries(result.entries || [])
          setError('')
        } catch (err) {
          setError(err.message)
        }
      }, [])

      useEffect(() => { load() }, [load])

      const groups = useMemo(() => {
        const byId = new Map()
        for (const entry of entries) {
          if (!byId.has(entry.id)) byId.set(entry.id, { id: entry.id, rows: [], reasons: new Set(), where: new Set() })
          const group = byId.get(entry.id)
          group.rows.push(entry)
          for (const reason of entry.reasons) group.reasons.add(reason)
          group.where.add((entry.short || entry.scale) + ' ' + waveName(entry.wave))
        }
        return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
      }, [entries])

      const toggle = id => setPicked(prev => ({ ...prev, [id]: !prev[id] }))
      const selected = groups.filter(group => picked[group.id]).map(group => group.id)
      const allOn = groups.length > 0 && groups.every(group => picked[group.id])

      const removeIds = async ids => {
        const clean = ids.map(value => String(value || '').trim()).filter(Boolean)
        if (!clean.length) return
        setBusy('remove')
        setError('')
        try {
          const result = await call('bulkDeleteSubjects', { ids: clean })
          toast('已删除编号 ' + clean.join('、') + ' 的数据：' + result.removed + ' 行')
          setPicked({})
          setManual('')
          await load()
          if (refresh) refresh()
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy('')
        }
      }

      const rename = async () => {
        if (!from.trim() || !to.trim()) return
        setBusy('rename')
        setError('')
        try {
          const result = await call('bulkRenameSubjects', { from, to })
          toast('已把 ' + result.renamed + ' 行从 ' + result.from + ' 改成 ' + result.to + (result.merged ? '，合并重复 ' + result.merged + ' 行' : ''))
          if (result.warning) setError(result.warning)
          setFrom('')
          setTo('')
          await load()
          if (refresh) refresh()
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy('')
        }
      }

      const keepOne = async order => {
        const label = order === 'first' ? '第一份' : '最后一份'
        if (window.confirm && !window.confirm('把每个编号的重复作答都删掉，只留' + label + '？跨所有量表与波次。')) return
        setBusy('keep')
        setError('')
        try {
          const result = await call('keepOnePerId', { order })
          toast('已处理重复编号：删掉 ' + result.removed + ' 行，每个编号只留' + label)
          await load()
          if (refresh) refresh()
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy('')
        }
      }

      return h('div', { className: 'sd-card' },
        h('div', { className: 'sd-card-head' },
          h('h3', null, '批量清理'),
          h('span', { className: 'sd-note' }, '编号为空、或同一编号有多份的作答；勾选后一次删掉，跨所有量表与波次'),
          h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
            Btn({ children: '重新扫描', kind: 'ghost', small: true, onClick: load, disabled: Boolean(busy) })
          )
        ),
        error ? h('div', { className: 'sd-alert sd-alert-bad', style: { margin: 0 } }, error) : null,
        groups.length
          ? h('div', { className: 'sd-table-wrap', style: { maxHeight: 280 } },
              h('table', { className: 'sd-table', style: { minWidth: 620 } },
                h('thead', null, h('tr', null,
                  h('th', { style: { width: 34 } }, h('input', {
                    type: 'checkbox',
                    checked: allOn,
                    onChange: () => {
                      const next = {}
                      if (!allOn) for (const group of groups) next[group.id] = true
                      setPicked(next)
                    }
                  })),
                  h('th', null, '编号'),
                  h('th', { className: 'is-score' }, '行数'),
                  h('th', null, '原因'),
                  h('th', null, '出现在'),
                  h('th', null, '')
                )),
                h('tbody', null, groups.map(group => h('tr', { key: group.id },
                  h('td', null, h('input', { type: 'checkbox', checked: Boolean(picked[group.id]), onChange: () => toggle(group.id) })),
                  h('td', { className: 'sd-mono' }, group.id),
                  h('td', { className: 'is-score' }, String(group.rows.length)),
                  h('td', { className: 'sd-note' }, [...group.reasons].join('；')),
                  h('td', { className: 'sd-note', style: { maxWidth: 260 } }, [...group.where].slice(0, 6).join('、') + (group.where.size > 6 ? '…' : '')),
                  h('td', null, h(Btn, {
                    children: '改号',
                    kind: 'ghost',
                    small: true,
                    onClick: () => { setFrom(group.id); setTo('') }
                  }))
                )))
              )
            )
          : h('div', { className: 'sd-note' }, '没有编号可疑或重复的作答。'),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h('span', { className: 'sd-note' }, '同一编号交了多份：'),
          Btn({ children: busy === 'keep' ? '处理中…' : '只留最后一份', kind: 'outline', small: true, disabled: Boolean(busy), onClick: () => keepOne('last') }),
          Btn({ children: '只留第一份', kind: 'ghost', small: true, disabled: Boolean(busy), onClick: () => keepOne('first') }),
          h('span', { className: 'sd-note' }, '按导出顺序，最后一行当作最新提交')
        ),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h('span', { className: 'sd-note' }, '批量改编号：'),
          h('input', {
            className: 'sd-input',
            style: { width: 110, height: 26 },
            value: from,
            placeholder: '旧编号',
            onChange: event => setFrom(event.target.value)
          }),
          h('span', { className: 'sd-note' }, '→'),
          h('input', {
            className: 'sd-input',
            style: { width: 110, height: 26 },
            value: to,
            placeholder: '新编号',
            onChange: event => setTo(event.target.value)
          }),
          Btn({
            children: busy === 'rename' ? '改号中…' : '改',
            kind: 'outline',
            small: true,
            disabled: Boolean(busy) || !from.trim() || !to.trim(),
            onClick: rename
          }),
          h('span', { className: 'sd-note' }, '跨所有量表与波次；改完自动重算')
        ),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          Btn({
            children: busy === 'remove' ? '删除中…' : '删除选中编号的数据（' + selected.length + '）',
            kind: 'primary',
            small: true,
            disabled: Boolean(busy) || !selected.length,
            onClick: () => {
              if (window.confirm && !window.confirm('删除编号 ' + selected.join('、') + ' 在所有量表与波次里的作答？此操作不可撤销。')) return
              removeIds(selected)
            }
          }),
          h('span', { className: 'sd-note' }, '或直接填一个编号：'),
          h('input', {
            className: 'sd-input',
            style: { width: 120, height: 26 },
            value: manual,
            placeholder: '如 2030',
            onChange: event => setManual(event.target.value)
          }),
          Btn({
            children: '删除这个编号',
            kind: 'outline',
            small: true,
            disabled: Boolean(busy) || !manual.trim(),
            onClick: () => {
              if (window.confirm && !window.confirm('删除编号 ' + manual.trim() + ' 的所有作答？')) return
              removeIds([manual])
            }
          })
        )
      )
    }

    function ReviewPanel({ data, toast, refresh }) {
      const [scaleId, setScaleId] = useState(data.instruments[0] ? data.instruments[0].id : '')
      const instrument = data.instruments.find(item => item.id === scaleId) || data.instruments[0]
      const [wave, setWave] = useState(instrument ? instrument.waves[0] : 'T0')
      const [rows, setRows] = useState([])
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [drafts, setDrafts] = useState({})

      useEffect(() => {
        if (!instrument) return
        if (!instrument.waves.includes(wave)) setWave(instrument.waves[0])
      }, [scaleId])

      const load = useCallback(async () => {
        if (!instrument) return
        setBusy('load')
        setError('')
        try {
          const result = await call('answers', { scale: instrument.id, wave })
          setRows(result.rows || [])
          setDrafts({})
        } catch (err) {
          setError(err.message)
          setRows([])
        } finally {
          setBusy('')
        }
      }, [instrument && instrument.id, wave])

      useEffect(() => { load() }, [load])

      const act = async (action, payload, done) => {
        setBusy(action)
        setError('')
        try {
          const result = await call(action, payload)
          toast(done(result))
          await load()
          if (refresh) refresh()
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy('')
        }
      }

      const rename = index => {
        const row = rows.find(item => item.index === index)
        const to = (drafts[index] !== undefined ? drafts[index] : row ? row.id : '').trim()
        if (!to) return
        act('renameAnswer', { scale: instrument.id, wave, index, to },
          result => '已把第 ' + (index + 1) + ' 行的编号 ' + result.from + ' 改成 ' + result.to)
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-card-head' },
            h('h3', null, '核对与修正'),
            h('span', { className: 'sd-note' }, '改错编号、删掉多录的、重复编号里留一份；改完自动重算'),
            h('div', { style: { marginLeft: 'auto' } },
              h(Btn, { children: busy === 'load' ? '读取中…' : '刷新', kind: 'ghost', small: true, disabled: Boolean(busy), onClick: load })
            )
          ),
          h('div', { className: 'sd-field' },
            h('label', null, '量表'),
            h('select', {
              className: 'sd-select',
              value: instrument ? instrument.id : '',
              onChange: event => { setScaleId(event.target.value); setRows([]) }
            }, data.instruments.map(item => h('option', { key: item.id, value: item.id }, item.short + '（' + item.itemCount + ' 题）'))),
            h('label', null, '波次'),
            h('select', {
              className: 'sd-select',
              style: { maxWidth: 140 },
              value: wave,
              onChange: event => setWave(event.target.value)
            }, (instrument ? instrument.waves : []).map(item => h('option', { key: item, value: item }, waveName(item)))),
            h('span', { className: 'sd-note' }, rows.length + ' 份')
          ),
          error ? h('div', { className: 'sd-alert sd-alert-bad', style: { margin: 0 } }, error) : null,
          rows.length
            ? h('div', { className: 'sd-table-wrap' },
                h('table', { className: 'sd-table', style: { minWidth: 640 } },
                  h('thead', null, h('tr', null,
                    h('th', null, '#'),
                    h('th', null, '编号'),
                    h('th', { className: 'is-score' }, '已答'),
                    h('th', { className: 'is-score' }, '缺'),
                    h('th', null, '重复'),
                    h('th', null, '操作')
                  )),
                  h('tbody', null, rows.map(row => h('tr', { key: row.index },
                    h('td', { className: 'sd-note' }, String(row.index + 1)),
                    h('td', null, h('input', {
                      className: 'sd-input sd-id-input',
                      value: drafts[row.index] !== undefined ? drafts[row.index] : row.id,
                      onChange: event => setDrafts(prev => ({ ...prev, [row.index]: event.target.value })),
                      onKeyDown: event => { if (event.key === 'Enter') rename(row.index) }
                    })),
                    h('td', { className: 'is-score' }, String(row.answered)),
                    h('td', { className: 'is-score' }, row.missing ? String(row.missing) : ''),
                    h('td', null, row.copies > 1
                      ? h('span', { className: 'sd-badge sd-badge-bad' }, row.copies + ' 份')
                      : h('span', { className: 'sd-note' }, '')),
                    h('td', null, h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                      h(Btn, { children: '改编号', kind: 'outline', small: true, disabled: Boolean(busy), onClick: () => rename(row.index) }),
                      row.copies > 1
                        ? h(Btn, {
                            children: '保留这份',
                            kind: 'primary',
                            small: true,
                            disabled: Boolean(busy),
                            onClick: () => act('keepAnswer', { scale: instrument.id, wave, index: row.index },
                              result => '保留 ' + result.id + ' 的这份，删掉其余 ' + result.removed + ' 份')
                          })
                        : null,
                      h(Btn, {
                        children: '删除',
                        kind: 'ghost',
                        small: true,
                        disabled: Boolean(busy),
                        onClick: () => {
                          if (!window.confirm('删除第 ' + (row.index + 1) + ' 行（编号 ' + row.id + '）？')) return
                          act('deleteAnswerRow', { scale: instrument.id, wave, index: row.index },
                            result => '已删除 ' + result.id + ' 的这份，剩 ' + result.remaining + ' 份')
                        }
                      })
                    ))
                  )))
                )
              )
            : h(Empty, { title: busy === 'load' ? '读取中…' : '这一波次还没有作答' }, '先导入或手填，再回来核对。')
        )
      )
    }

    function EntryTab({ data, toast, refresh, initial }) {
      const [mode, setMode] = useState('sheet')
      const [busy, setBusy] = useState('')
      const save = useCallback(async payload => {
        setBusy('save')
        try {
          const result = await call('save', payload)
          refresh()
          return result
        } finally {
          setBusy('')
        }
      }, [refresh])
      const clear = useCallback(async payload => {
        setBusy('clear')
        try {
          const result = await call('clear', payload)
          refresh()
          return result
        } finally {
          setBusy('')
        }
      }, [refresh])

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'sd-tabs', style: { margin: 0 } },
          h('button', { type: 'button', className: 'sd-tab' + (mode === 'sheet' ? ' is-active' : ''), onClick: () => setMode('sheet') }, '手填答题纸'),
          h('button', { type: 'button', className: 'sd-tab' + (mode === 'import' ? ' is-active' : ''), onClick: () => setMode('import') }, '导入导出文件'),
          h('button', { type: 'button', className: 'sd-tab' + (mode === 'review' ? ' is-active' : ''), onClick: () => setMode('review') }, '核对与修正')
        ),
        mode === 'sheet'
          ? h(SheetEntry, { data, busy: Boolean(busy), onSave: save, onClear: clear, toast, initial })
          : mode === 'import'
            ? h(ImportPanel, { data, toast, onImported: refresh })
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
                h(CleanupPanel, { data, toast, refresh }),
                h(ReviewPanel, { data, toast, refresh })
              )
      )
    }

    /* ================================================================ *
     * 计分
     * ================================================================ */

    function ScoreTab({ data, busy, onScore, onExport, onOpenFolder }) {
      const [open, setOpen] = useState('')
      const [detailRow, setDetailRow] = useState(null)
      const [filter, setFilter] = useState(ALL)
      const [onlyScored, setOnlyScored] = useState(true)
      const allColumns = data.scores.columns
      const shortOf = scale => (data.instruments.find(item => item.id === scale) || {}).short || scale
      const isUnscored = scale => {
        const instrument = data.instruments.find(item => item.id === scale)
        return instrument ? instrument.scoringType === 'none' : false
      }
      const hiddenCount = allColumns.filter(col => isUnscored(col.scale)).length
      const columns = onlyScored ? allColumns.filter(col => !isUnscored(col.scale)) : allColumns
      const scoreCols = columns.filter(col => col.kind === 'score')
      const shown = data.scores.rows.filter(row => {
        if (filter === ALL) return true
        return scoreCols.some(col => {
          const cell = row.cells[col.key]
          return filter === 'incomplete' ? cell && cell.status === 'incomplete'
            : filter === 'prorated' ? cell && cell.status === 'prorated'
              : filter === 'duplicate' ? cell && cell.status === 'duplicate'
                : cell && cell.status === 'absent'
        })
      })

      const groups = useMemo(() => {
        const byScale = new Map()
        for (const col of columns) {
          if (!byScale.has(col.scale)) byScale.set(col.scale, [])
          byScale.get(col.scale).push(col)
        }
        return [...byScale.entries()]
      }, [columns])

      // One drill-down button per scale × wave, not per column.
      const units = useMemo(() => {
        const seen = new Set()
        const list = []
        for (const col of scoreCols) {
          const key = col.scale + '__' + col.wave
          if (seen.has(key)) continue
          seen.add(key)
          list.push({ scale: col.scale, wave: col.wave })
        }
        return list
      }, [scoreCols])

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-card-head' }, h('h3', null, '这张表怎么看')),
          h('div', { className: 'sd-legend' },
            h('span', null, '一行 = 一个被试的编号；一列 = 他在某个量表某个阶段算出来的分。'),
            h('span', null, '数字 = 已算出的分'),
            h('span', null, '折算 = 缺了几题，按已答的题平均补上'),
            h('span', null, '! = 缺太多，没算分'),
            h('span', null, '重复 = 同一编号有多份，先去「录入 → 核对」留一份'),
            h('span', null, '— = 这个阶段还没有他的作答'),
            h('span', null, '缺题 = 这一阶段没答的题数；0 表示一题没缺，不是 0 分'),
            h('span', null, '只收集不计分的问卷没有分数列，只有缺题列')
          ),
          h('details', { className: 'sd-details' },
            h('summary', null, '每一列是什么（点开对照）'),
            h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: '4px 12px', marginTop: 8 } },
              data.scores.columns.map(col => h('div', { key: col.key, style: { display: 'flex', gap: 8, fontSize: 13 } },
                h('span', { className: 'sd-mono', style: { color: 'var(--sd-text2)' } }, col.key),
                h('span', null, '= ' + (col.label || '') + (col.kind === 'missing' ? '' : col.range ? '（' + col.range[0] + '–' + col.range[1] + '）' : ''))
              ))
            )
          )
        ),
        data.scores.stale
          ? h('div', { className: 'sd-alert sd-alert-warn', style: { margin: 0 } }, 'scores.csv 比作答或定义旧：点「重算」重建。面板显示的是内存里实时算出的值。')
          : null,
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-card-head' },
            h('h3', null, '计分表'),
            h('span', { className: 'sd-note' }, data.scores.counts.filled + ' / ' + data.scores.counts.subjects + ' 人有分数；' + data.scores.counts.complete + ' 人各量表各波次全齐'),
            h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' } },
              Btn({ children: busy === 'score' ? '重算中…' : '重算并写 scores.csv', kind: 'primary', small: true, onClick: onScore, disabled: Boolean(busy) }),
              Btn({ children: '导出分数与报告', kind: 'outline', small: true, onClick: onExport, disabled: Boolean(busy) }),
              Btn({ children: '打开 _lab', kind: 'ghost', small: true, onClick: () => onOpenFolder('lab') })
            )
          ),
          h('div', { className: 'sd-field' },
            h('label', null, '筛选'),
            h('select', { className: 'sd-select', style: { maxWidth: 200 }, value: filter, onChange: event => setFilter(event.target.value) },
              h('option', { value: ALL }, '全部 ' + data.scores.rows.length),
              h('option', { value: 'incomplete' }, '有未计分'),
              h('option', { value: 'prorated' }, '有折算'),
              h('option', { value: 'absent' }, '有整份未录'),
              h('option', { value: 'duplicate' }, '有重复编号')
            ),
            h('label', { style: { marginLeft: 12, display: 'inline-flex', gap: 4, alignItems: 'center' } },
              h('input', { type: 'checkbox', checked: onlyScored, onChange: event => setOnlyScored(event.target.checked) }),
              '只看计分量表',
              h('span', { className: 'sd-note' }, onlyScored ? '（已隐藏 ' + hiddenCount + ' 列只收集不计分的缺题列）' : '')
            )
          ),
          shown.length
            ? h('div', { className: 'sd-table-wrap' },
                h('table', { className: 'sd-table' },
                  h('thead', null,
                    h('tr', null,
                      h('th', { className: 'sd-sticky', rowSpan: 2 }, '编号'),
                      groups.map(([scale, cols]) => h('th', { key: scale, colSpan: cols.length, title: scale, style: { textAlign: 'center', borderLeft: '1px solid var(--sd-line2)' } }, shortOf(scale)))
                    ),
                    h('tr', null,
                      groups.flatMap(([scale, cols]) => cols.map((col, index) => h('th', {
                        key: col.key,
                        className: 'is-score',
                        style: index === 0 ? { borderLeft: '1px solid var(--sd-line2)' } : undefined,
                        title: col.key
                      }, col.label.split(' · ')[1] || col.label)))
                    )
                  ),
                  h('tbody', null, shown.map(row => h(React.Fragment, { key: row.id },
                    h('tr', {
                      className: open === row.id ? 'is-open' : '',
                      tabIndex: 0,
                      'aria-label': row.id + ' 分数明细',
                      'aria-expanded': open === row.id,
                      onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen(open === row.id ? '' : row.id); setDetailRow(null) } },
                      onClick: () => {
                        if (open === row.id) {
                          setOpen('')
                          setDetailRow(null)
                        } else {
                          setOpen(row.id)
                          setDetailRow(null)
                        }
                      }
                    },
                      h('td', { className: 'sd-sticky sd-id' }, row.id),
                      groups.flatMap(([scale, cols]) => cols.map((col, index) => {
                        const cell = row.cells[col.key]
                        const isMissing = col.kind === 'missing'
                        const empty = !cell || cell.value === null || cell.value === undefined
                        const bad = cell && cell.status === 'incomplete'
                        const duplicate = cell && cell.status === 'duplicate'
                        return h('td', {
                          key: col.key,
                          className: 'is-score',
                          style: index === 0 ? { borderLeft: '1px solid var(--sd-line2)' } : undefined,
                          title: col.key + '：' + (STATUS_TEXT[cell ? cell.status : 'absent'] || '')
                        },
                          h('span', { className: 'sd-cell' + (bad || duplicate ? ' is-bad' : '') + (empty && !duplicate ? ' is-empty' : '') },
                            duplicate ? '重复' : isMissing ? (empty ? '—' : String(cell.value)) : scoreText(cell ? cell.value : null),
                            bad ? h('i', null, '!') : null
                          )
                        )
                      }))
                    ),
                    open === row.id
                      ? h('tr', null,
                          h('td', { colSpan: groups.reduce((sum, [, cols]) => sum + cols.length, 0) + 1, style: { padding: 10 } },
                            row.flags && row.flags.length
                              ? h('div', { className: 'sd-alert sd-alert-warn', style: { marginBottom: 8 } }, row.flags.join('；'))
                              : null,
                            h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 } },
                              units.map(unit => h('button', {
                                type: 'button',
                                key: unit.scale + unit.wave,
                                className: 'sd-chip',
                                style: { cursor: 'pointer', height: 24 },
                                onClick: event => {
                                  event.stopPropagation()
                                  call('detail', { id: row.id, scale: unit.scale, wave: unit.wave }).then(value => {
                                    setDetailRow({ id: row.id, value })
                                  }).catch(err => {
                                    setDetailRow({ id: row.id, value: null, error: err.message })
                                  })
                                }
                              }, unit.scale + ' ' + unit.wave + ' 每题'))
                            ),
                            detailRow && detailRow.id === row.id && detailRow.error
                              ? h('div', { className: 'sd-alert sd-alert-bad', style: { margin: 0 } }, detailRow.error)
                              : detailRow && detailRow.id === row.id && detailRow.value
                                ? h(ItemDetail, { detail: detailRow.value })
                                : h('span', { className: 'sd-note' }, '点上面的按钮看某一波次的每题明细。')
                          )
                        )
                      : null
                  ))
                )
              )
            )
            : h(Empty, { title: '还没有分数' }, '先在「录入」里手填，或导入问卷平台导出。'),
          h('div', { className: 'sd-note' }, '列名规则：单分量表用 量表_波次，多分量表用 量表_波次_分量表；每个波次另有一列「缺题」。分数在 _lab/scores.csv，每题明细在 scores_detail.csv，分数与题目合并的宽表在 data_wide.csv。')
        )
      )
    }

    function ItemDetail({ detail }) {
      if (detail.status === 'duplicate') return h('div', { className: 'sd-alert sd-alert-warn', role: 'status' }, detail.short + ' ' + waveName(detail.wave) + '：同编号有 ' + detail.copies + ' 份作答，未计分。请在「录入 → 核对」保留一份。')
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' } },
          h('b', null, detail.short + ' · ' + waveName(detail.wave)),
          h('span', { className: 'sd-note' }, '答 ' + detail.answered + ' / ' + detail.items.length),
          Object.values(detail.subs).map(sub => h('span', { className: 'sd-chip', key: sub.key }, sub.label + ' ' + (sub.score === null ? '未计分' : sub.score)))
        ),
        h('div', { className: 'sd-table-wrap', style: { maxHeight: 300 } },
          h('table', { className: 'sd-table', style: { minWidth: 480 } },
            h('thead', null, h('tr', null, h('th', null, '题号'), h('th', null, '导出码'), h('th', null, '原始值'), h('th', null, '计分值'), h('th', null, '备注'))),
            h('tbody', null, detail.items.map(item => h('tr', { key: item.no },
              h('td', null, String(item.no), item.reverse ? h('span', { className: 'sd-badge sd-badge-warn', style: { marginLeft: 5 } }, '反') : null),
              h('td', { className: 'sd-mono' }, item.code || ''),
              h('td', null, item.raw || '—'),
              h('td', null, item.scored === null || item.scored === undefined ? '—' : String(item.scored)),
              h('td', { className: 'sd-note' }, item.reason === 'range' ? '越界' : item.reason === 'unparsed' ? '认不出' : item.reason === 'empty' ? '缺失' : '')
            )))
          )
        )
      )
    }

    /* ================================================================ *
     * 校验
     * ================================================================ */

    function ValidateTab({ data, busy, onValidate }) {
      const [level, setLevel] = useState('warn')
      const [scale, setScale] = useState(ALL)
      const issues = (data.issues || []).filter(item => {
        if (level === 'bad' && item.level !== 'bad') return false
        if (level === 'warn' && item.level === 'info') return false
        if (scale !== ALL && item.scale !== scale) return false
        return true
      })
      const counts = data.issueCounts || {}

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-card-head' }, h('h3', null, '这些提示是什么意思')),
          h('div', { className: 'sd-legend' },
            h('span', null, '「必须处理」的会让分数算错或算不出来；「建议看看」多半是缺题或编号可疑；「提示」只是说明，可以不管。'),
            h('span', null, '每条都写了两行：上面说哪里有问题，下面说怎么办。'),
            h('span', null, '先看「必须处理」，没有就说明现有数据能算分。')
          )
        ),
        h('div', { className: 'sd-card' },
          h('div', { className: 'sd-card-head' },
            h('h3', null, '校验'),
            h('span', { className: 'sd-note' }, '定义与作答两边都查：题量、反向、取值域、缺失比例、导出码、版本漂移'),
            h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' } },
              busy === 'validate' ? h('span', { className: 'sd-spin' }) : null,
              Btn({ children: '重新校验', kind: 'outline', small: true, onClick: () => onValidate(), disabled: Boolean(busy) })
            )
          ),
          h('div', { className: 'sd-field' },
            h('label', null, '级别'),
            h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
              [['all', '全部 ' + (data.issues || []).length], ['bad', '高 ' + (counts.issueBad || 0)], ['warn', '中 ' + (counts.issueWarn || 0)]].map(([value, label]) =>
                h('button', {
                  type: 'button',
                  key: value,
                  className: 'sd-chip' + (level === value ? ' is-brand' : ''),
                  style: { cursor: 'pointer', height: 24 },
                  onClick: () => setLevel(value)
                }, label)
              )
            ),
            h('label', null, '量表'),
            h('select', { className: 'sd-select', style: { maxWidth: 180 }, value: scale, onChange: event => setScale(event.target.value) },
              h('option', { value: ALL }, '全部'),
              data.instruments.map(item => h('option', { key: item.id, value: item.id }, item.short))
            )
          ),
          issues.length
            ? h('div', { className: 'sd-issues' },
                issues.map((item, index) => h('div', { className: 'sd-issue', key: index },
                  h('span', { className: 'sd-badge sd-badge-' + (item.level === 'bad' ? 'bad' : item.level === 'warn' ? 'warn' : 'info') }, LEVEL_TEXT[item.level] || '提示'),
                  h('span', { className: 'sd-issue-body' },
                    h('span', null, item.text),
                    item.hint ? h('div', { className: 'sd-issue-hint' }, item.hint) : null
                  ),
                  item.scale ? h('span', { className: 'sd-chip' }, item.scale + (item.wave ? ' ' + item.wave : '')) : null
                ))
              )
            : h(Empty, { title: '没有要报的问题' }, level === 'all' ? '定义与数据都过了当前检查。' : '这一档里没有条目。')
        )
      )
    }

    function StudyTab({ data, toast, refresh }) {
      const [documentText, setDocumentText] = useState('')
      const [studyPath, setStudyPath] = useState(data.study?.path || '')
      const [preview, setPreview] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [baseRevision, setBaseRevision] = useState(data.study?.revision || '')
      const [capabilities, setCapabilities] = useState(null)
      useEffect(() => { call('studyConfig').then(result => { setDocumentText(JSON.stringify(result.definition, null, 2)); setBaseRevision(result.study.revision); setStudyPath(result.study.path || '') }).catch(error => setError(error.message)) }, [data.study?.id])
      useEffect(() => { let alive = true; call('capabilities').then(result => { if (alive) setCapabilities(result) }).catch(() => { if (alive) setCapabilities(null) }); return () => { alive = false } }, [data.binding?.bindingRevision])
      const view = data.binding || {}
      const source = SOURCE_LABEL[view.source] || view.source || '未连接'
      const run = async action => {
        setBusy(true); setError('')
        try {
          if (action === 'preview') setPreview(await call('studyPreview', { definition: documentText, path: studyPath }))
          else if (action === 'connect') { newPage(); await call('studyConnect', { path: studyPath }); setPreview(null); await refresh(); toast('已连接研究') }
          else if (action === 'save') { newPage(); await call('studySave', { definition: documentText, path: studyPath, expectedRevision: studyPath === data.study?.path ? baseRevision : undefined }); setPreview(null); await refresh(); toast('已保存并连接研究') }
          else { await call('initialize', { sample: action === 'sample' }); await refresh(); toast(action === 'sample' ? '已加入虚构示例定义' : '已初始化空研究目录') }
        } catch (error) { setError(error.message) } finally { setBusy(false) }
      }
      return h('div', { className: 'sd-card' },
        h('div', { className: 'sd-card-head' }, h('h3', null, '研究连接'), h('span', { className: 'sd-note' }, data.study?.name + ' · ' + data.study?.id)),
        h('p', { className: 'sd-note' }, '连接只改变当前页面的研究绑定：其他标签页与会话保留各自的研究。编辑名称、编号规则、访视与任务后可另存研究，相对路径以研究文件目录解析；保存前先验证。'),
        h('div', { className: 'sd-kv' },
          h('div', { className: 'sd-kv-item' }, h('span', null, '绑定来源'), h('b', null, source)),
          h('div', { className: 'sd-kv-item' }, h('span', null, '绑定实例'), h('b', { title: view.instanceId || '' }, view.instanceId ? String(view.instanceId).slice(0, 12) : '—')),
          h('div', { className: 'sd-kv-item' }, h('span', null, '绑定版本'), h('b', null, view.bindingRevision === undefined ? '—' : String(view.bindingRevision))),
          h('div', { className: 'sd-kv-item' }, h('span', null, '数据目录'), h('b', { title: data.study?.dataRoot || '' }, data.study?.dataRoot || '—'))
        ),
        capabilities
          ? h('div', { className: 'sd-note' }, '跨插件身份：' + (capabilities.consistent ? '一致' : '存在不同研究') + '；已注册：' + (capabilities.plugins || []).map(plugin => plugin.name + (plugin.matchesBinding === false ? '（未同步）' : '')).join('、'))
          : null,
        h('label', { className: 'sd-form-grid' }, '研究JSON本机路径', h('input', { className: 'sd-input', value: studyPath, placeholder: 'D:/my-study/study.json', onChange: event => { setStudyPath(event.target.value); setPreview(null) } })),
        h('div', { className: 'sd-field' }, h(Btn, { children: '连接已有研究', onClick: () => run('connect'), disabled: busy || !studyPath.trim() }), h(Btn, { children: '验证预览', onClick: () => run('preview'), disabled: busy }), h(Btn, { children: '保存并连接', kind: 'primary', onClick: () => run('save'), disabled: busy || !preview?.valid || !studyPath.trim() })),
        h('label', { className: 'sd-form-grid' }, '研究定义JSON（visits为访视，tasks为任务）', h('textarea', { className: 'sd-input sd-code-block', style: { height: 330, resize: 'vertical' }, value: documentText, onChange: event => { setDocumentText(event.target.value); setPreview(null) } })),
        preview ? h('div', { className: 'sd-alert ' + (preview.valid ? 'sd-alert-ok' : 'sd-alert-bad'), role: 'status' }, preview.valid ? '定义有效：' + preview.definition.name + '，访视 ' + (preview.definition.visits || []).length + '，任务 ' + (preview.definition.tasks || []).length : preview.problems.join('；')) : null,
        error ? h('div', { className: 'sd-alert sd-alert-bad', role: 'alert' }, error) : null,
        h('div', { className: 'sd-field' }, h(Btn, { children: '初始化空目录', onClick: () => run('blank'), disabled: busy }), h(Btn, { children: '加入虚构花园示例', onClick: () => run('sample'), disabled: busy }), h('span', { className: 'sd-note' }, '这两个动作才会创建研究数据目录；示例不含真实研究材料。')),
        h('div', { className: 'sd-note' }, '数据目录：' + data.study?.dataRoot)
      )
    }

    /* ================================================================ *
     * panel shell
     * ================================================================ */

    function Panel() {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState('')
      const [tab, setTab] = useState('library')
      const [entryTarget, setEntryTarget] = useState(null)
      const [toastState, setToastState] = useState(null)
      const [stale, setStale] = useState(false)
      const timer = useRef(null)

      // 写入被研究核心拒绝（409）时立即亮出冲突提示，别等下一次刷新。
      useEffect(() => { staleWatch = () => setStale(true); return () => { staleWatch = null } }, [])

      const openScale = useCallback((scale, wave, id) => {
        setEntryTarget({ scale, wave, id, n: Date.now() })
        setTab('entry')
      }, [])

      const toast = useCallback((message, tone) => {
        setToastState({ message, tone: tone || 'ok' })
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setToastState(null), 5200)
      }, [])

      useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

      const load = useCallback(async (hard) => {
        try {
          const next = hard ? await call('refresh') : await call('status')
          activeStudyId = next.study?.id
          activeRevision = next.revision
          visitLabels = Object.fromEntries((next.visits || []).map(visit => [visit.id, visit.label || visit.id]))
          setData(next)
          setStale(staleBinding)
          setError('')
          return next
        } catch (err) {
          setStale(staleBinding)
          setError(err.message)
          return null
        }
      }, [])

      useEffect(() => { load(false) }, [load])

      // 运行台"在量表计分中打开这个编号"的跨面板提示：只读当前实例+数据集的那一个键，
      // 2 分钟内有效，用完即清；不会把另一个本地实例的草稿应用到当前研究。
      useEffect(() => {
        if (!data) return
        let key = ''
        try {
          key = identity.focusKey()
          const raw = localStorage.getItem(key)
          if (!raw) return
          const hint = JSON.parse(raw)
          if (!hint || !hint.at || Date.now() - hint.at > 120000) { localStorage.removeItem(key); return }
          const target = (data.instruments || []).find(item => item.id === hint.scaleId)
          localStorage.removeItem(key)
          if (!target) { toast('运行台带来的量表 ' + hint.scaleId + ' 不在当前研究里'); return }
          openScale(hint.scaleId, hint.waveId, hint.participantId)
          toast('已从运行台打开：' + hint.participantId + ' · ' + hint.waveId)
        } catch { /* 损坏的提示直接忽略 */ }
      }, [data, openScale, toast])

      const refresh = useCallback(() => load(true), [load])

      const publishNote = result => {
        if (result && result.publishError) return '；发布 observation 失败：' + result.publishError
        if (result && result.publish && typeof result.publish.published === 'number') {
          const skipped = result.publish.changed ? '，跳过 ' + result.publish.changed + ' 条来源版本不同的记录' : ''
          return '；已发布 observation ' + result.publish.published + ' 条' + skipped + '（未登记待关联 ' + (result.publish.unregistered || 0) + ' 条）'
        }
        return ''
      }
      const runScore = useCallback(async () => {
        setBusy('score')
        try {
          const result = await call('score', {})
          toast('已重算并写入：' + result.rows + ' 行 × ' + result.columns + ' 列；明细 ' + result.detailRows + ' 行。' + publishNote(result), result && result.publishError ? 'bad' : 'ok')
          await refresh()
        } catch (err) {
          toast(err.message, 'bad')
        } finally {
          setBusy('')
        }
      }, [refresh, toast])

      const runExport = useCallback(async () => {
        setBusy('export')
        try {
          const result = await call('export', {})
          toast('已导出：' + result.csv + publishNote(result), result && result.publishError ? 'bad' : 'ok')
          await refresh()
        } catch (err) {
          toast(err.message, 'bad')
        } finally {
          setBusy('')
        }
      }, [refresh, toast])

      const runValidate = useCallback(async () => {
        setBusy('validate')
        try {
          const result = await call('validate')
          toast('校验完成：高 ' + result.counts.issueBad + ' 条，中 ' + result.counts.issueWarn + ' 条，提示 ' + result.counts.issueInfo + ' 条。')
          await refresh()
        } catch (err) {
          toast(err.message, 'bad')
        } finally {
          setBusy('')
        }
      }, [refresh, toast])

      const openFolder = useCallback(async target => {
        try {
          const result = await call('reveal', { target })
          toast('已打开：' + result.opened)
        } catch (err) {
          toast(err.message, 'bad')
        }
      }, [toast])

      const counts = data ? data.issueCounts : { issueBad: 0, issueWarn: 0 }
      const completed = data ? data.scores.counts.filled : 0
      const subjects = data ? data.scores.counts.subjects : 0

      return h('div', { className: 'sd-root' },
        h('button', { className: 'sd-btn sd-btn-quiet', type: 'button', style: { margin: '0 0 10px' }, onClick: openPickerFromButton }, '研究切换'),
        h('div', { className: 'sd-top' },
          h('div', { className: 'sd-brand' },
            h('strong', null, '量表计分'),
            h('span', null, data?.study?.name || '定义、作答、分数与校验')
          ),
          data
            ? h('div', { className: 'sd-stats' },
                h(Stat, { label: '有分数', value: completed + '/' + subjects }),
                h(Stat, { label: '作答份数', value: data.totals.answerRows }),
                h(Stat, { label: '高分问题', value: counts.issueBad || 0, tone: counts.issueBad ? 'bad' : undefined }),
                h(Stat, { label: '提示', value: counts.issueWarn || 0, tone: counts.issueWarn ? 'warn' : undefined })
              )
            : null,
          h('div', { className: 'sd-actions' },
            Btn({ children: busy === 'refresh' ? '刷新中…' : '刷新', kind: 'ghost', small: true, onClick: async () => { setBusy('refresh'); await refresh(); setBusy('') } }),
            Btn({ children: '导出', kind: 'outline', small: true, onClick: runExport, disabled: Boolean(busy) || !data })
          )
        ),
        data
          ? h('div', { className: 'sd-tabs' },
              [['study', '研究'], ['library', '量表库'], ['flow', '流程'], ['entry', '录入'], ['scores', '计分'], ['validate', '校验']].map(([value, label]) =>
                h('button', {
                  type: 'button',
                  key: value,
                  className: 'sd-tab' + (tab === value ? ' is-active' : ''),
                  onClick: () => setTab(value)
                }, label,
                  value === 'validate' && counts.issueBad ? h('b', { style: { color: 'var(--sd-bad)' } }, counts.issueBad) : null,
                  value === 'scores' && data.scores.stale ? h('b', { style: { color: 'var(--sd-warn)' } }, '·') : null
                )
              )
            )
          : null,
        h('div', { className: 'sd-scroll' },
          stale
            ? h('div', { className: 'sd-alert sd-alert-bad', role: 'alert' },
                h('span', null, '研究已变化，请重新连接或先导出草稿。当前页面的研究绑定已过期，写入会被拒绝，自动写入已停住。'),
                h(Btn, { children: '重新连接研究', kind: 'outline', small: true, onClick: async () => { newPage(); setStale(false); setTab('study'); await load(false) } }))
            : null,
          data?.transaction ? h('div', { className: 'sd-alert sd-alert-bad', role: 'alert' }, '存在未完成事务：' + data.transaction.action + '。恢复会回到写入前快照。', h(Btn, { children: '恢复未完成事务', onClick: async () => { try { await call('recover', {}); await refresh() } catch (error) { toast(error.message, 'bad') } } })) : null,
          data?.lastWriteError ? h('div', { className: 'sd-alert sd-alert-bad', role: 'alert' }, '上次写入失败：' + data.lastWriteError.message + '；恢复状态：' + data.lastWriteError.recovery + '。刷新核对后重试。') : null,
          error
            ? h('div', { className: 'sd-alert sd-alert-bad' }, '面板加载失败：' + error + '（检查插件是否启用，或点「刷新」）')
            : null,
          !data
            ? h(Empty, { title: '正在读取研究…' }, '状态查询不创建文件。')
            : tab === 'study'
              ? h(StudyTab, { data, toast, refresh })
              : tab === 'library'
              ? h(LibraryTab, { data, toast, refresh, onOpenFolder: openFolder })
              : tab === 'flow'
                ? h(FlowTab, { data, onOpenScale: openScale })
                : tab === 'entry'
                  ? h(EntryTab, { data, toast, refresh, initial: entryTarget })
                  : tab === 'scores'
                    ? h(ScoreTab, { data, busy, onScore: runScore, onExport: runExport, onOpenFolder: openFolder })
                    : h(ValidateTab, { data, busy, onValidate: runValidate })
        ),
        toastState
          ? h('div', { className: 'sd-toast' + (toastState.tone === 'bad' ? ' is-bad' : '') }, toastState.message)
          : null
      )
    }

    /* ================================================================ *
     * icon + mounting
     * ================================================================ */

    function Icon({ size, active }) {
      return h('svg', {
        width: size || 18,
        height: size || 18,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true
      },
        h('rect', { x: 4, y: 3, width: 16, height: 18, rx: 3 }),
        h('path', { d: 'M8 8h4M8 12h4M8 16h4' }),
        h('path', { d: 'M15.2 7.6l1.5 1.5 2.4-2.6' }),
        h('path', { d: 'M15.2 11.6l1.5 1.5 2.4-2.6' }),
        h('path', { d: 'M15.2 15.6l1.5 1.5 2.4-2.6' })
      )
    }

    /**
     * 最外层护栏：面板在真实页面里抛错时把错误画在面板上，而不是让槽位把
     * 整个面板撤掉（那会变成一片空白，且看不到原因）。
     */
    class Guard extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      componentDidCatch(error) {
        console.error('[scale-desk] panel crashed:', error)
      }
      render() {
        if (this.state.error) {
          const text = String((this.state.error && (this.state.error.stack || this.state.error.message)) || this.state.error)
          return h('div', {
            style: {
              padding: '22px',
              fontFamily: 'Cambria,"Noto Serif SC","Source Han Serif SC","Songti SC",STSong,SimSun,serif',
              fontSize: '13.5px',
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
              color: '#9b3a2c',
              background: '#f5f4ef',
              overflow: 'auto',
              height: '100%',
              boxSizing: 'border-box'
            }
          }, '量表计分面板渲染失败：\n\n' + text + '\n\n（把这段发给我即可定位）')
        }
        return this.props.children
      }
    }

  function openPickerFromButton() {
    try {
      const ui = (hostCtx && hostCtx.get && hostCtx.get('uiWorkspace')) || (hostCtx && hostCtx.uiWorkspace)
      const factory = window.__DSH_RESEARCH_PICKER__
      if (!factory) throw new Error('共享选择器模块未加载')
      const picker = factory.createStudyPicker({
        plugin: 'scale-desk', route: '/api/scale-desk',
        headers: () => ({ 'x-scale-desk': '1', ...identity.headers() }),
        pickDirectory: ui && typeof ui.pickDirectory === 'function' ? () => ui.pickDirectory() : null,
      })
      picker.install(); picker.open()
    } catch (error) {
      try { window.alert('研究选择器不可用：' + (error && error.message ? error.message : String(error))) } catch { /* 无窗口 */ }
    }
  }

    return {
      inject: ['slots'],
      identity,
      apply(ctx) {
        hostCtx = ctx
        ctx.effect(() => insertStyles(), 'scale-desk: styles')
        try {
          const ui = (ctx.get && ctx.get('uiWorkspace')) || ctx.uiWorkspace
          window.__DSH_RESEARCH_PICKER__ && window.__DSH_RESEARCH_PICKER__.createStudyPicker({
            plugin: 'scale-desk', route: '/api/scale-desk', headers: () => ({ 'x-scale-desk': '1', ...identity.headers() }),
            pickDirectory: ui && typeof ui.pickDirectory === 'function' ? () => ui.pickDirectory() : null,
          }).install()
        } catch (error) { console.warn('[scale-desk] study picker not installed', error) }
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'scale-desk', order: 32, label: '量表计分' },
            props => h(Icon, { size: (props && props.size) || 18, active: Boolean(props && props.active) })
          )
        )
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'scale-desk' }, () => h(Guard, null, h(Panel))))
      }
    }
  }
})
