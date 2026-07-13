#!/usr/bin/env node
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const result = spawnSync('pnpm', ['exec', 'tsx', path.join(__dirname, 'patch-work-config.ts')], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  env: process.env
})

process.exit(result.status ?? 1)
