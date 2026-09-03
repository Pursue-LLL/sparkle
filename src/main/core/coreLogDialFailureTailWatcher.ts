// [INPUT] core log file · cursorDedicatedDialFailureClusterRuntime
// [OUTPUT] startCoreLogDialFailureTailWatcher · stopCoreLogDialFailureTailWatcher
// [POS] BUG-2026-09-03-007 — tail core log file for dial failure clusters (macOS 26 headless / ws path gap).

import { createReadStream, existsSync, statSync } from 'fs'
import { resolveLogPath } from '../utils/log'

let tailTimer: NodeJS.Timeout | undefined
let tailOffset = 0
let tailInFlight = false
let tailLogPath: string | undefined

function ingestLine(line: string): void {
  if (!line.includes('dial 🎯 Cursor 专用')) {
    return
  }
  void import('./cursorDedicatedDialFailureClusterRuntime').then(
    ({ ingestCoreLogLineForDialFailureCluster }) => {
      ingestCoreLogLineForDialFailureCluster(line)
    },
  )
}

async function pollCoreLogTail(): Promise<void> {
  if (tailInFlight) {
    return
  }
  const logPath = tailLogPath ?? resolveLogPath('core')
  tailLogPath = logPath
  if (!existsSync(logPath)) {
    return
  }
  tailInFlight = true
  try {
    const size = statSync(logPath).size
    if (size < tailOffset) {
      tailOffset = 0
    }
    if (size <= tailOffset) {
      return
    }
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(logPath, {
        start: tailOffset,
        end: size - 1,
        encoding: 'utf-8',
      })
      let buffer = ''
      stream.on('data', (chunk: string) => {
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.trim()) {
            ingestLine(line)
          }
        }
      })
      stream.on('end', () => {
        if (buffer.trim()) {
          ingestLine(buffer)
        }
        tailOffset = size
        resolve()
      })
      stream.on('error', reject)
    })
  } catch {
    // ignore transient read races during log rotation
  } finally {
    tailInFlight = false
  }
}

export function startCoreLogDialFailureTailWatcher(pollMs = 1_000): void {
  if (tailTimer) {
    return
  }
  tailLogPath = resolveLogPath('core')
  if (existsSync(tailLogPath)) {
    try {
      tailOffset = statSync(tailLogPath).size
    } catch {
      tailOffset = 0
    }
  }
  void pollCoreLogTail()
  tailTimer = setInterval(() => {
    void pollCoreLogTail()
  }, pollMs)
  tailTimer.unref?.()
}

export function stopCoreLogDialFailureTailWatcher(): void {
  if (tailTimer) {
    clearInterval(tailTimer)
    tailTimer = undefined
  }
}

export function resetCoreLogDialFailureTailWatcherForTests(): void {
  stopCoreLogDialFailureTailWatcher()
  tailOffset = 0
  tailLogPath = undefined
  tailInFlight = false
}
