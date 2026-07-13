import { register } from 'node:module'

register('./electron-hook.mjs', import.meta.url)

async function main() {
  const { generateProfile } = await import('../src/main/core/factory.ts')
  await generateProfile()
  console.log('REGENERATE_OK')
}

main().catch((error) => {
  console.error('REGENERATE_FAIL', error)
  process.exit(1)
})
