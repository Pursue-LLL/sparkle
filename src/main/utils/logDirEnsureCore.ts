// [INPUT] none
// [OUTPUT] ensureDirectoryExists
// [POS] R-17 — mkdir-before-write SSOT for Sparkle log paths.

export function ensureDirectoryExists(
  dirPath: string,
  existsFn: (path: string) => boolean,
  mkdirFn: (path: string, options: { recursive: boolean }) => void,
): void {
  if (!existsFn(dirPath)) {
    mkdirFn(dirPath, { recursive: true })
  }
}
