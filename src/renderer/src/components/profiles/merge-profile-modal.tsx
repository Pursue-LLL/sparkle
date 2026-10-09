import { Button, Input, Label, Modal, Separator, Surface, Switch } from '@heroui-v3/react'
import React, { useState } from 'react'
import { notify } from '@renderer/utils/notification'

const DEFAULT_REGIONS = '台湾、日本、新加坡、韩国、美国、越南、菲律宾、马来西亚'
const DEFAULT_DEDICATED_REGIONS = '香港'

const splitRegions = (text: string): string[] => text.split(/[\s,，、]+/).filter(Boolean)

interface Props {
  /** 可作为来源的订阅（不含合并订阅本身） */
  candidates: ProfileItem[]
  onSubmit: (item: Partial<ProfileItem>) => Promise<void>
  onClose: () => void
}

const MergeProfileModal: React.FC<Props> = ({ candidates, onSubmit, onClose }) => {
  const [name, setName] = useState('合并版')
  const [base, setBase] = useState(candidates[0]?.id ?? '')
  const [sources, setSources] = useState<string[]>(candidates.map((item) => item.id))
  const [regions, setRegions] = useState(DEFAULT_REGIONS)
  const [dedicatedRegions, setDedicatedRegions] = useState(DEFAULT_DEDICATED_REGIONS)

  const toggleSource = (id: string, selected: boolean): void => {
    setSources((prev) => (selected ? [...prev, id] : prev.filter((source) => source !== id)))
  }

  const onSave = async (): Promise<void> => {
    const regionList = splitRegions(regions)
    if (!name.trim() || !base || sources.length === 0 || regionList.length === 0) {
      notify('请填写名称，选择策略组来源与节点来源，并至少保留一个地区', { variant: 'danger' })
      return
    }
    await onSubmit({
      name: name.trim(),
      type: 'local',
      // 按订阅列表顺序而非点选顺序，保证节点顺序稳定
      merge: {
        base,
        sources: candidates.filter((item) => sources.includes(item.id)).map((item) => item.id),
        regions: regionList,
        dedicatedRegions: splitRegions(dedicatedRegions)
      }
    })
    onClose()
  }

  return (
    <Modal>
      <Modal.Backdrop
        isOpen={true}
        onOpenChange={onClose}
        variant="blur"
        className="top-12 h-[calc(100%-48px)]"
      >
        <Modal.Container scroll="inside">
          <Modal.Dialog className="w-[min(600px,calc(100%-24px))] max-w-none">
            <Modal.Header className="app-drag pb-1">
              <Modal.Heading>新建合并订阅</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="no-scrollbar max-h-[70vh] overflow-y-auto pt-1 pb-2">
              <Surface variant="transparent" className="flex flex-col gap-3">
                <Input
                  aria-label="名称"
                  placeholder="名称"
                  value={name}
                  variant="secondary"
                  onChange={(event) => setName(event.target.value)}
                />
                <Input
                  aria-label="保留地区"
                  placeholder="保留地区，用顿号或逗号分隔"
                  value={regions}
                  variant="secondary"
                  onChange={(event) => setRegions(event.target.value)}
                />
                <Input
                  aria-label="专用地区"
                  placeholder="专用地区：只出现在 Sparkle 专用组（如 Sparkle-香港），可留空"
                  value={dedicatedRegions}
                  variant="secondary"
                  onChange={(event) => setDedicatedRegions(event.target.value)}
                />
                <Separator variant="tertiary" className="bg-default-100/70" />
                <Label className="text-sm text-foreground-500">
                  节点：开启的订阅里名称含上述地区的节点会被合并；策略组与规则：只能选一个订阅
                </Label>
                {candidates.map((item) => (
                  <Surface
                    key={item.id}
                    variant="transparent"
                    className="flex items-center justify-between gap-3"
                  >
                    <Label className="min-w-0 flex-1 truncate">{item.name}</Label>
                    <Switch
                      aria-label={`${item.name} 提供节点`}
                      size="sm"
                      isSelected={sources.includes(item.id)}
                      onChange={(selected) => toggleSource(item.id, selected)}
                    >
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                    </Switch>
                    <Button
                      size="sm"
                      variant={base === item.id ? 'primary' : 'secondary'}
                      onPress={() => setBase(item.id)}
                    >
                      {base === item.id ? '策略组与规则 ✓' : '策略组与规则'}
                    </Button>
                  </Surface>
                ))}
              </Surface>
            </Modal.Body>
            <Modal.Footer className="justify-end pt-2">
              <Button size="sm" variant="secondary" onPress={onClose}>
                取消
              </Button>
              <Button size="sm" variant="primary" onPress={onSave}>
                创建
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

export default MergeProfileModal
