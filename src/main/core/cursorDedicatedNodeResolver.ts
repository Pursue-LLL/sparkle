// [INPUT] mihomoApi · cursorProxyGroup
// [OUTPUT] resolveCursorDedicatedActiveNode
// [POS] Cursor dedicated selector active leaf — shared by rescue/warmth executors (no MTDO circular import).

let testActiveNodeOverride: string | undefined | null = null

export function setCursorDedicatedActiveNodeOverrideForTests(
  node: string | undefined | null,
): void {
  testActiveNodeOverride = node
}

export function resetCursorDedicatedNodeResolverStateForTests(): void {
  testActiveNodeOverride = null
}

export async function resolveCursorDedicatedActiveNode(): Promise<string | undefined> {
  if (testActiveNodeOverride !== null) {
    return testActiveNodeOverride
  }
  const { mihomoGroups } = await import('./mihomoApi')
  const { resolveCursorStableSelectorGroup } = await import('./cursorProxyGroup')
  const groups = await mihomoGroups()
  return resolveCursorStableSelectorGroup(groups)?.now
}
