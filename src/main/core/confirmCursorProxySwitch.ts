import { dialog } from 'electron'
import { isCursorSelectorGroupName } from './cursorProxyGroup'

function formatMarathonSwitchBlockDetail(
  reason: string,
  cursorConnectionCount: number,
  marathonTruthActive: boolean,
): string {
  if (reason === 'blocked_marathon_active') {
    return (
      `马拉松会话进行中（marathon_truth_active=1，cursor_conn=${cursorConnectionCount}）。` +
      '赛中切换会断连并浪费 Included 次数。请等会话结束后再切换，或使用冷启动 gate 切 TLS。'
    )
  }
  if (reason === 'blocked_mid_session') {
    return (
      `Agent 连接活跃（cursor_conn=${cursorConnectionCount}）。` +
      '赛中切换会断连并浪费 Included 次数。请等 cursor_conn=0 后再切换。'
    )
  }
  if (reason === 'blocked_suboptimal_lateral') {
    return '冷启动下禁止 QUIC/Reality 协议横向切换。请使用「一键切 TLS」升级到 JP-VPS-TLS。'
  }
  if (reason === 'blocked_auto_suboptimal') {
    return '自动/启动流程禁止回落到 HY2/TUIC/Reality。请手动选择或使用 gate 一键切 TLS。'
  }
  return `切换被 Marathon Protocol Contract 拒绝（reason=${reason}，marathon_truth=${marathonTruthActive ? 1 : 0}）。`
}

export async function confirmCursorProxySwitch(
  groupName: string,
  fromProxy: string,
  toProxy: string
): Promise<boolean> {
  if (!isCursorSelectorGroupName(groupName)) {
    return true
  }
  if (fromProxy === toProxy) {
    return false
  }

  const { evaluateMarathonProtocolSwitchBlock } = await import('./marathonProtocolContract')
  const block = await evaluateMarathonProtocolSwitchBlock({
    group: groupName,
    fromNode: fromProxy,
    toNode: toProxy,
    source: 'manual',
  })
  if (block.blocked) {
    await dialog.showMessageBox({
      type: 'warning',
      buttons: ['知道了'],
      defaultId: 0,
      cancelId: 0,
      title: 'Cursor 节点切换被阻断',
      message: `无法在此时从「${fromProxy}」切换到「${toProxy}」`,
      detail: formatMarathonSwitchBlockDetail(
        block.reason,
        block.cursorConnectionCount,
        block.marathonTruthActive,
      ),
    })
    return false
  }

  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['取消', '确认切换'],
    defaultId: 0,
    cancelId: 0,
    title: '切换 Cursor 节点',
    message: `将「${groupName}」从「${fromProxy}」切换到「${toProxy}」`,
    detail: '运行中的 Cursor Agent 长连接会断开，可能触发额外计次。',
  })
  return response === 1
}
