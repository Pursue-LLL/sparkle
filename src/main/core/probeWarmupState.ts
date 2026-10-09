// [INPUT] postCoreBootstrap 的 begin/end · IPC `getProbeWarmupActive`
// [OUTPUT] beginProbeWarmup · endProbeWarmup · isProbeWarmupActive
// [POS] 把测速预热窗口状态推给渲染进程，代理页据此显示 loading 而不是误导性的「超时」。

import { mainWindow } from '..'
import { createProbeWarmupState } from './probeWarmupCore'

export const PROBE_WARMUP_CHANGED_CHANNEL = 'probeWarmupChanged'

/** 覆盖 sparkle-fast 逐点拨测 + 45s 启动宽限 + 地区组预热 + 超时节点复测（上限 150s），并留足余量。 */
const PROBE_WARMUP_MAX_MS = 8 * 60 * 1000

const state = createProbeWarmupState((active) => {
  mainWindow?.webContents.send(PROBE_WARMUP_CHANGED_CHANNEL, active)
}, PROBE_WARMUP_MAX_MS)

export const beginProbeWarmup = state.begin
export const endProbeWarmup = state.end
export const isProbeWarmupActive = state.isActive
