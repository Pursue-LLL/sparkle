// [INPUT] vpsDelayTestPolicyCore.isVpsCursorLeafNode
// [OUTPUT] partitionGroupMembersForDelayTest · shouldRunManagedVpsGroupDelayTest
// [POS] Cursor 专用组含 DIRECT 时，组测速须只 batch VPS leaf，不能因 isVpsCursorLeafBatch 全组失败而静默跳过。

import { isVpsCursorLeafNode } from './vpsDelayTestPolicyCore'

export interface GroupDelayTestPartition {
  vpsLeafNames: string[]
  otherNames: string[]
}

export function partitionGroupMembersForDelayTest(
  memberNames: readonly string[],
): GroupDelayTestPartition {
  const vpsLeafNames: string[] = []
  const otherNames: string[] = []
  for (const rawName of memberNames) {
    const name = rawName.trim()
    if (!name) {
      continue
    }
    if (isVpsCursorLeafNode(name)) {
      vpsLeafNames.push(name)
      continue
    }
    otherNames.push(name)
  }
  return { vpsLeafNames, otherNames }
}

export function shouldRunManagedVpsGroupDelayTest(partition: GroupDelayTestPartition): boolean {
  return partition.vpsLeafNames.length > 0
}
