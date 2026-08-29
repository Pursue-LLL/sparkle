import { patchAppConfig } from '../config'

/** Sticky macOS 26 GUI preference — once user opts in via flag/env, persist for Dock launches. */
export async function persistMacOs26ForceGuiIfRequested(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  alreadyPersisted: boolean | undefined,
): Promise<void> {
  if (alreadyPersisted === true) {
    return
  }
  const { wantsMacOs26ForceGui } = await import('./macos26ElectronMitigationCore')
  if (!wantsMacOs26ForceGui(argv, env, false)) {
    return
  }
  await patchAppConfig({ macos26ForceGui: true })
}
