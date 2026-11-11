/**
 * 09/T01：scale-desk 旧测试的合成研究宿主。
 *
 * 06 之后页面写入按 pageId + 研究绑定令牌解析研究：只给 {projectRoot, labDir}
 * 的旧夹具会被识别成 probe 身份，并复用进程级 store 里的旧记录，于是报
 * "当前绑定的研究定义已不存在"。这里把测试准备升级成真实链路：
 *   - 每个测试文件用临时 DSH_RESEARCH_STORE（由测试文件自己设置）；
 *   - 宿主提供 workspaceRegistry/sessions/workingDirectory 入口；
 *   - 每个页面一个 pageId（x-dsh-page/x-dsh-workspace 头 + 载荷 pageId）；
 *   - 请求先 studyConnect，之后写请求自动附带 binding token。
 *
 * 这里只做身份与准备工作，不改变插件行为，也不写入任何真实研究数据。
 */
import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'

/** 最小宿主：捕获插件注册的路由与工具，服务形状与 research-core/tests/harness.mjs 一致。 */
export function makeHost(root, { workspaceId = 'ws-test' } = {}) {
  const routes = new Map()
  const tools = new Map()
  const services = {
    workspaceRegistry: { list: () => [{ id: workspaceId, path: root, title: '合成工作区' }] },
    sessions: { get: () => undefined },
    workingDirectory: { defaultDirectory: root, get: session => session?.effectiveCwd || session?.header?.cwd || root },
    webServer: {
      register(spec) { routes.set(spec.path, spec.handler); return () => routes.delete(spec.path) },
    },
    tools: {
      register(definition) { tools.set(definition.name, definition); return () => tools.delete(definition.name) },
    },
  }
  const ctx = {
    get: name => services[name],
    effect: fn => { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
    inject: (_deps, callback) => callback(ctx),
    on: () => () => {},
  }
  return { ctx, routes, tools }
}

/**
 * 一个页面身份。pageId 随机且合法（[A-Za-z0-9_-]{8,80}），避免多个夹具
 * 共用同一条绑定记录；write 请求默认带上读 status / studyConnect 得到的令牌。
 * options.binding 可以显式发送旧令牌（用于验证 A-B-A 之后旧令牌失效）。
 */
export function makePage(handler, { workspaceId = 'ws-test', workspacePath, pageId } = {}) {
  const id = pageId || 'page-' + randomBytes(8).toString('hex')
  let token = null
  async function send(action, payload = {}, options = {}) {
    const bodyPayload = { ...payload }
    if (bodyPayload.pageId === undefined) bodyPayload.pageId = id
    const binding = options.binding !== undefined ? options.binding : token
    if (binding && bodyPayload.binding === undefined) bodyPayload.binding = binding
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ action, payload: bodyPayload }))]), {
      method: 'POST',
      url: '/api/scale-desk',
      headers: {
        'x-scale-desk': '1',
        'content-type': 'application/json',
        'x-dsh-page': id,
        ...(workspaceId ? { 'x-dsh-workspace': workspaceId } : {}),
        ...(workspacePath ? { 'x-dsh-workspace-path': workspacePath } : {}),
      },
    })
    let text = ''
    const res = { statusCode: 0, setHeader() {}, end(value) { text = value } }
    await handler(req, res)
    const json = JSON.parse(text)
    if (!json.ok) throw Object.assign(Error(json.error.message), { code: json.error.code, status: res.statusCode })
    // 读、写、studyConnect/studySave 都会回传绑定视图；令牌随页面切换自动推进。
    if (json.data && json.data.binding && json.data.binding.token) token = json.data.binding.token
    return json.data
  }
  return {
    pageId: id,
    request: send,
    get token() { return token },
    connect(studyPath) { return send('studyConnect', { path: studyPath }) },
  }
}

/** 合成研究定义：tasks/visits/plugins 都显式给出，dataRoot 指向测试自己的临时目录。 */
export function syntheticStudy({
  studyId,
  name = '合成研究 ' + studyId,
  dataRoot = './data',
  participantId = {},
  visits = [],
  tasks = [],
  plugins = { scales: {} },
} = {}) {
  return {
    schemaVersion: 1,
    studyId,
    name,
    dataRoot,
    participantId,
    visits,
    tasks,
    followups: [],
    plugins,
  }
}
