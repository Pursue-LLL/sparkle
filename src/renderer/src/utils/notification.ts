import { toast, type ButtonProps } from '@heroui-v3/react'
import { getAppConfig } from './ipc'

type AppNotificationVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger'

export interface AppNotificationPayload {
  id?: string
  title: string
  body?: string
  persistent?: boolean
  url?: string
  variant?: AppNotificationVariant
  actionKind?: 'copy-bug-report'
  timeout?: number
  onClose?: () => void
  /** 通知上的动作按钮属性（透传给 UI 组件）。 */
  actionProps?: Record<string, unknown>
}

const toastKeys = new Map<string, string>()

interface AppNotificationOptions extends Omit<AppNotificationPayload, 'title'> {
  forceToast?: boolean
}

export function notify(title: unknown, options: AppNotificationOptions = {}): void {
  const { forceToast = false, ...payload } = options
  void showNotification({ ...payload, title: formatNotificationText(title) }, forceToast)
}

export function showToastNotification(payload: AppNotificationPayload): void {
  const { title, body } = normalizeToastPayload(payload)
  if (payload.id) {
    const previousKey = toastKeys.get(payload.id)
    if (previousKey) {
      toast.close(previousKey)
      toastKeys.delete(payload.id)
    }
  }

  let key = ''
  key = toast(title, {
    actionProps: resolveToastActionProps(payload),
    description: body,
    onClose: () => {
      if (payload.id && toastKeys.get(payload.id) === key) {
        toastKeys.delete(payload.id)
      }
      payload.onClose?.()
    },
    timeout: payload.persistent ? 0 : payload.timeout,
    variant: payload.variant ?? 'default'
  })
  if (payload.id) {
    toastKeys.set(payload.id, key)
  }
}

export function dismissToastNotification(id: string): void {
  const key = toastKeys.get(id)
  if (!key) return

  toast.close(key)
  toastKeys.delete(id)
}

async function showNotification(
  payload: AppNotificationPayload,
  forceToast: boolean
): Promise<void> {
  if (forceToast) {
    showToastNotification(payload)
    return
  }

  try {
    const { notificationMode = 'system' } = await getAppConfig()
    if (notificationMode === 'toast') {
      showToastNotification(payload)
      return
    }
  } catch {
    // fall back to the current system notification behavior
  }

  const notification = new window.Notification(payload.title, {
    body: payload.body,
    requireInteraction: payload.persistent
  })
  notification.onclick = payload.url
    ? () => {
        window.open(payload.url, '_blank', 'noopener,noreferrer')
        notification.close()
      }
    : null
  notification.onclose = payload.onClose ?? null
}

function resolveToastActionProps(payload: AppNotificationPayload): ButtonProps | undefined {
  if (payload.actionKind === 'copy-bug-report') {
    return {
      children: '复制 Bug 信息',
      onPress: () => {
        void copyCollectiveDeathBugReportToClipboard()
      },
    }
  }
  if (payload.url) {
    return {
      children: '打开',
      onPress: () => window.open(payload.url, '_blank', 'noopener,noreferrer'),
    }
  }
  return undefined
}

async function copyCollectiveDeathBugReportToClipboard(): Promise<void> {
  try {
    const text = (await window.electron.ipcRenderer.invoke('getCollectiveDeathBugReport')) as
      | string
      | null
    if (!text || !text.trim()) {
      notify('暂无可复制的诊断信息', { forceToast: true, variant: 'warning', timeout: 4000 })
      return
    }
    await navigator.clipboard.writeText(text)
    notify('Bug 信息已复制', { forceToast: true, variant: 'success', timeout: 3000 })
  } catch (error) {
    notify(formatNotificationText(error), { forceToast: true, variant: 'danger', timeout: 5000 })
  }
}

function normalizeToastPayload(payload: AppNotificationPayload): { title: string; body?: string } {
  const title = formatNotificationText(payload.title)
  const body = payload.body ? formatNotificationText(payload.body) : undefined

  if (body || !title.includes('\n')) {
    return { title, body }
  }

  const [firstLine, ...bodyLines] = title.split('\n')
  return { title: firstLine, body: bodyLines.join('\n') || undefined }
}

function formatNotificationText(value: unknown): string {
  let text = value instanceof Error ? value.message : String(value)
  text = text.replace(/\\r\\n|\\n|\\r/g, '\n').replace(/\r\n|\r/g, '\n')
  text = text.replace(/^Error:\s*/i, '')
  return text.trim()
}
