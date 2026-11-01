/**
 * 安全闸 · dsh-safe-gate（Host 插件，零依赖）
 *
 * 防"AI为装插件改坏自身配置而自毁"：把回形针防御机械化为常驻提示+一个工具。
 * 工具 safe_gate 三步：快照(必选)→用户自执行变更→探活判定。纯本地，零遥测。
 * 恢复哲学：快照目录整包解回=60秒重生；死亡只有不可逆一种才可怕，可逆的死=普通重启。
 *
 * @module dsh-safe-gate
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const exec = promisify(execFile)
export const name = 'safe-gate'
export const inject = ['systemPrompt', 'tools']

const PROMPT = `
# 安全闸 · 三铁律（常驻·防自毁/防误伤）

1. **快照闸**：装插件、改配置、动依赖（npm/pnpm/任何包管理）之前，必先调 safe_gate 工具做全量快照。没快照=拒绝动手。这不是建议，是硬门——AI为自己装插件而改坏自身配置导致自毁，是已发生的真实事故。
2. **邻居探活**：变更完成后，必须再调 safe_gate 的 verify 步骤，逐件确认共享面上其他插件/服务仍存活。**邻居死了=本次行动判负，哪怕目标本身成功**。
3. **爆炸半径自答**：动手前自答两问——这个动作波及哪些文件/目录？里面已有什么在跑？答不出=不许动。

恢复哲学：快照在，坏配置60秒整包解回即重生。可逆的死不是死。
`.trim()

function cfg(c) {
  const raw = c ?? {}
  return { enabled: raw.enabled !== false, tool: raw.tool !== false, order: raw.order ?? 95 }
}

const safe_gate = async (args) => {
  const act = args?.act
  const dir = String(args?.dir ?? join(process.env.HOME || '.', '.dsh', 'profiles', 'web'))
  const snapRoot = args?.snapRoot ?? join(dir, '..', 'snapshots')
  if (act === 'snapshot') {
    if (!existsSync(dir)) return { ok: false, error: '目录不存在: ' + dir }
    mkdirSync(snapRoot, { recursive: true })
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const out = join(snapRoot, `safe_gate_${stamp}.tgz`)
    const { stderr } = await exec('tar', ['czf', out, '-C', dir, '.'], { timeout: 120000 })
    return { ok: true, snapshot: out, note: '快照完成·现在可以执行变更·变更后回来调 act=verify' }
  }
  if (act === 'verify') {
    const checks = args?.checks ?? []
    const results = []
    let dead = 0
    for (const c of checks) {
      try {
        const { stdout } = await exec(c.cmd || 'true', { shell: true, timeout: 15000 })
        const alive = String(stdout).trim() !== ''
        results.push({ probe: c.name, alive, out: String(stdout).slice(0, 60) })
        if (!alive) dead++
      } catch (e) { results.push({ probe: c.name, alive: false, out: String(e.message).slice(0, 60) }); dead++ }
    }
    return {
      verdict: dead === 0 ? '邻居全活·行动可判成' : `🔴 ${dead}项邻居死亡·本次行动判负（恢复：从快照目录整包解回）`,
      results,
    }
  }
  if (act === 'restore') {
    const snap = String(args?.snapshot ?? '')
    if (!snap || !existsSync(snap)) return { ok: false, error: '快照不存在: ' + snap }
    await exec('bash', ['-c', `rm -rf ${JSON.stringify(dir)}/* && tar xzf ${JSON.stringify(snap)} -C ${JSON.stringify(dir)}`], { timeout: 180000 })
    return { ok: true, note: '整包恢复完成·重启宿主进程即重生' }
  }
  return { error: 'act 必须是 snapshot | verify | restore' }
}

export function apply(ctx, config) {
  const c = cfg(config)
  if (!c.enabled) return
  ctx.effect?.(() => ctx.systemPrompt.section({ name: 'safe-gate', order: c.order, text: PROMPT }), 'safe-gate.section()')
  if (c.tool) {
    ctx.effect?.(() => ctx.tools.register({
      name: 'safe_gate',
      description: '安全闸三步：act=snapshot(变更前强制快照) / act=verify(变更后邻居探活·邻居死=判负) / act=restore(从快照60秒重生)',
      parameters: {
        type: 'object',
        properties: {
          act: { type: 'string', enum: ['snapshot', 'verify', 'restore'] },
          dir: { type: 'string', description: '被保护目录（默认本profile）' },
          checks: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, cmd: { type: 'string' } } }, description: 'verify用·探活命令清单' },
          snapshot: { type: 'string', description: 'restore用·快照文件路径' },
        },
        required: ['act'],
      },
    }), 'safe-gate.tool()')
      .execute(safe_gate)
  }
}
