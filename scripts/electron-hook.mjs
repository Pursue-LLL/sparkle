import { pathToFileURL } from 'node:url'

const mockUrl = new URL('./electron-mock.mjs', import.meta.url).href
const toolkitMockUrl = new URL('./electron-toolkit-mock.mjs', import.meta.url).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: mockUrl, shortCircuit: true }
  }
  if (specifier === '@electron-toolkit/utils') {
    return { url: toolkitMockUrl, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
