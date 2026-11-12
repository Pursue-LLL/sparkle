const logfmtFieldPattern = /([A-Za-z0-9_.-]+)=("(?:\\.|[^"\\])*"|[^\s]+)/g

const logfmtEscapes: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  '"': '"',
  '\\': '\\'
}

// 单趟解码：逐个替换会把转义的反斜杠与其后的 n/r/t 误认成控制字符（C:\\new → 换行）
function unquoteLogfmtValue(value: string): string {
  if (!(value.startsWith('"') && value.endsWith('"'))) return value

  return value.slice(1, -1).replace(/\\([nrt"\\])/g, (_, escaped: string) => logfmtEscapes[escaped])
}

function parseLogfmtLine(line: string): Record<string, string> {
  const fields: Record<string, string> = {}

  for (const match of line.matchAll(logfmtFieldPattern)) {
    const [, key, rawValue] = match
    fields[key] = unquoteLogfmtValue(rawValue)
  }

  return fields
}

function normalizeOutLogTime(value?: string): string | undefined {
  if (!value) return undefined

  const normalizedValue = value.replace(/(\.\d{3})\d+([+-]\d{2}:\d{2}|Z)$/, '$1$2')
  const parsedTime = new Date(normalizedValue)

  if (Number.isNaN(parsedTime.getTime())) {
    return undefined
  }

  return parsedTime.toLocaleString()
}

function normalizeOutLogLevel(level: string | undefined, fallbackType: LogLevel): LogLevel {
  switch (level) {
    case 'error':
      return 'error'
    case 'warn':
    case 'warning':
      return 'warning'
    case 'info':
      return 'info'
    case 'debug':
      return 'debug'
    default:
      return fallbackType
  }
}

/**
 * 把内核 stdout 的一行转成控制器日志：logfmt 行取 level / msg / time；
 * 没有这些字段的纯文本行整行作为 payload，等级用调用方给的兜底值。
 */
export function createControllerLogFromOutLine(
  line: string,
  fallbackType: LogLevel
): ControllerLog {
  const fields = parseLogfmtLine(line)

  return {
    type: normalizeOutLogLevel(fields.level, fallbackType),
    payload: fields.msg?.trim() || line,
    time: normalizeOutLogTime(fields.time)
  }
}
