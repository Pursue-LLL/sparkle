import { dialog } from 'electron'
import { isCursorSelectorGroupName } from './cursorProxyGroup'

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

  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['取消', '确认切换'],
    defaultId: 0,
    cancelId: 0,
    title: '切换 Cursor 节点',
    message: `将「${groupName}」从「${fromProxy}」切换到「${toProxy}」`,
    detail: '运行中的 Cursor Agent 长连接会断开，可能触发额外计次。'
  })
  return response === 1
}
