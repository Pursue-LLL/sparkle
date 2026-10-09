export function pickLatestSuccessfulProviderDelay(
  history: ControllerProxiesHistory[]
): ControllerProxiesHistory | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]
    if (entry && entry.delay > 0) {
      return entry
    }
  }
  return undefined
}
