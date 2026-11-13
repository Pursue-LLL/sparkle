# src/shared — 模块架构

主进程与渲染进程共享的类型与生成常量。

## 文件清单

| 文件 | 职责 |
|------|------|
| `types/` | 全局 TypeScript 类型（`app.d.ts` · `types.d.ts` · `controller.d.ts`，含跨进程 `AgyProbeSample`（rttMs / checkedAt / state：usable|unusable|failed / reason）与 `AgyProbeSnapshot`） |
| `buildStamp.ts` | **生成物**：`SPARKLE_BUILD_STAMP`（`YYYY.MMDD.HHMM`）+ `SPARKLE_SEMVER` + `SPARKLE_GIT_COMMIT` + `SPARKLE_GIT_DIRTY`；由 `scripts/write-build-stamp.ts` 写入，禁止手改 |

## 数据流

```
scripts/writeBuildStampCore.ts → scripts/write-build-stamp.ts
  → src/shared/buildStamp.ts
  → src/main/utils/ipc.ts (getBuildStamp)
  → src/renderer/src/utils/init.ts → proxies.tsx Chip
  → src/main/core/buildDriftCore.ts / scripts/check-build-drift.ts / scripts/sparkleDistFreshnessCore.ts（漂移与 dist 新鲜度判定）
```

## 依赖

- 生成脚本：`scripts/writeBuildStampCore.ts`（POS: 构建标识格式 SSOT）
- 消费方：`src/main/utils/ipc.ts` · `src/main/core/buildDriftCore.ts` · `scripts/check-build-drift.ts` · `scripts/sparkleDistFreshnessCore.ts` · `src/renderer/src/pages/proxies.tsx`
