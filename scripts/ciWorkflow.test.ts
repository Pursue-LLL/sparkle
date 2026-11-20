// [INPUT] .github/workflows/build.yml（被检查的 CI 配置，其中的 shell 脚本被取出真实执行）·
//         testing/tempDirs::makeTempDir (POS: 脚本测试共用的临时目录，退出时自动删除) · js-yaml::load (POS: 解析工作流)
// [OUTPUT] （无导出，仅测试）
// [POS] CI 失败自带可读原因的行为测试：Actions 日志要登录才能读，所以构建步骤的输出落盘、失败时写进 job summary 与错误注解。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { load } from 'js-yaml'
import { makeTempDir } from './testing/tempDirs'

interface WorkflowStep {
  id?: string
  name?: string
  if?: string
  env?: Readonly<Record<string, string>>
  run?: string
}

interface Workflow {
  jobs: {
    build: {
      env?: Readonly<Record<string, string>>
      strategy: { 'fail-fast'?: boolean }
      steps: WorkflowStep[]
    }
  }
}

const WORKFLOW_PATH = path.resolve(import.meta.dirname, '..', '.github', 'workflows', 'build.yml')
const build = (load(readFileSync(WORKFLOW_PATH, 'utf8')) as Workflow).jobs.build

/** 工作流表达式在 GitHub 上由 runner 求值；测试里用固定的矩阵取值代入。 */
const EXPRESSIONS: Readonly<Record<string, string>> = {
  'matrix.os': 'ubuntu-latest',
  'matrix.arch': 'x64',
  'matrix.format': 'deb',
  "matrix.format && '-' || ''": '-',
  "matrix.format || ''": 'deb'
}
const LABEL = 'ubuntu-latest-x64-deb'

function renderExpressions(text: string): string {
  return text.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_match, expression: string) => {
    const value = EXPRESSIONS[expression]
    assert.ok(
      value !== undefined,
      `the test has no value for the workflow expression: ${expression}`
    )
    return value
  })
}

function stepIndex(name: string): number {
  const index = build.steps.findIndex((step) => step.name === name)
  assert.notEqual(index, -1, `build.yml has no step named "${name}"`)
  return index
}

/** 步骤的 shell 脚本，工作流表达式已代入。 */
function renderedScript(name: string): string {
  const run = build.steps[stepIndex(name)].run
  assert.ok(run, `step "${name}" has no run script`)
  return renderExpressions(run)
}

/**
 * 步骤开头到退出陷阱为止的那几行：注释、把输出落盘的守卫、`_step_end` 与 `trap`。
 * 在它后面接上任何命令，就得到「一个被这样埋点的步骤」。
 */
function instruments(step: string): { prefix: string; log: string } {
  const lines = renderedScript(step).split('\n')
  const trapAt = lines.findIndex((line) => line.startsWith('trap _step_end EXIT'))
  assert.notEqual(trapAt, -1, `step "${step}" has no exit trap`)
  const guard = lines.find((line) => line.trim().startsWith('if [ -z "$CI_STEP_LOGGED" ]'))
  assert.ok(guard, `step "${step}" does not mirror its output to a file`)
  const log = /"\$RUNNER_TEMP\/([^"]+)"/.exec(guard)?.[1]
  assert.ok(log, `step "${step}" does not name a log file in $RUNNER_TEMP`)
  return { prefix: `${lines.slice(0, trapAt + 1).join('\n')}\n`, log }
}

/** 与 runner 一致的调用方式：`bash -eo pipefail <脚本文件>`（`$0` 就是脚本路径）；job 级 env 同样代入。 */
function runScript(script: string, runnerTemp: string, extraEnv: Record<string, string> = {}) {
  const file = path.join(runnerTemp, 'step.sh')
  writeFileSync(file, script)
  const jobEnv = Object.fromEntries(
    Object.entries(build.env ?? {}).map(([key, value]) => [key, renderExpressions(value)])
  )
  return spawnSync('bash', ['-eo', 'pipefail', file], {
    cwd: runnerTemp,
    env: { ...process.env, RUNNER_TEMP: runnerTemp, ...jobEnv, ...extraEnv },
    encoding: 'utf8'
  })
}

/** 步骤的第一条命令（注释不算），工作流表达式已代入。 */
function firstCommandLine(name: string): string {
  const line = renderedScript(name)
    .split('\n')
    .find((text) => text.trim() !== '' && !text.trim().startsWith('#'))
  assert.ok(line, `step "${name}" has no command`)
  return line
}

/** 步骤体里的一条命令：往 runs.txt 追加一行。守卫若让脚本跑了两遍（子进程一遍、外层 shell 再一遍），行数就是 2。 */
const RECORD_RUN = 'echo ran >> runs.txt\n'

function recordedRuns(runnerTemp: string): number {
  return readFileSync(path.join(runnerTemp, 'runs.txt'), 'utf8').split('\n').filter(Boolean).length
}

/** 被埋点的两个步骤：步骤名、落盘的日志，以及 Report Failure 读取其结果所用的环境变量。 */
const INSTRUMENTED = [
  {
    step: 'Install Dependencies and Prepare',
    log: 'ci-install.log',
    outcomeEnv: 'INSTALL_OUTCOME'
  },
  { step: 'Build', log: 'ci-build.log', outcomeEnv: 'BUILD_OUTCOME' }
] as const

describe('build.yml: failures explain themselves without a login', () => {
  it('lets every target finish, so one run shows all platforms', () => {
    assert.equal(build.strategy['fail-fast'], false)
  })

  for (const { step, log: expectedLog } of INSTRUMENTED) {
    it(`mirrors the output of "${step}" to ${expectedLog} before doing anything else`, () => {
      assert.equal(instruments(step).log, expectedLog)
      assert.match(firstCommandLine(step), /^if \[ -z "\$CI_STEP_LOGGED" \]; then /)
    })

    it(`runs "${step}" once and keeps its failing exit code and output`, () => {
      const { prefix, log } = instruments(step)
      const runnerTemp = makeTempDir('sparkle-ci-guard-')
      const script = `${prefix}echo before-failure\n${RECORD_RUN}false | cat\necho never-reached\n`
      const result = runScript(script, runnerTemp)
      assert.notEqual(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`)
      assert.doesNotMatch(result.stdout, /never-reached/, 'the step stops at the first failure')
      assert.equal(
        recordedRuns(runnerTemp),
        1,
        'the outer shell must not run the body again after the guard'
      )
      assert.match(result.stdout, /before-failure/)
      const logged = readFileSync(path.join(runnerTemp, log), 'utf8')
      assert.match(logged, /before-failure/)
      assert.ok(
        result.stdout.includes(`::error title=${step} failed (${LABEL})::`),
        `the annotation must name the step that failed: ${result.stdout}`
      )
    })

    it(`runs "${step}" once and stays quiet when it succeeds`, () => {
      const { prefix } = instruments(step)
      const runnerTemp = makeTempDir('sparkle-ci-guard-')
      const result = runScript(`${prefix}echo all-good\n${RECORD_RUN}`, runnerTemp)
      assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`)
      assert.equal(recordedRuns(runnerTemp), 1, 'a successful step must not be built a second time')
      assert.doesNotMatch(result.stdout, /::error/)
    })
  }

  it('reports only after the build, and only when something failed', () => {
    const report = build.steps[stepIndex('Report Failure')]
    assert.equal(report.if, 'failure()')
    assert.ok(stepIndex('Report Failure') > stepIndex('Build'))
  })

  for (const { step, outcomeEnv } of INSTRUMENTED) {
    it(`hands the outcome of "${step}" to the report`, () => {
      const { id } = build.steps[stepIndex(step)]
      assert.ok(id, `step "${step}" needs an id so that its outcome can be read`)
      const report = build.steps[stepIndex('Report Failure')]
      assert.equal(report.env?.[outcomeEnv], `\${{ steps.${id}.outcome }}`)
    })
  }
})

describe('build.yml: the failure report', () => {
  const report = renderedScript('Report Failure')
  const lines = Array.from({ length: 150 }, (_, index) => `line ${index + 1}`)

  /** runner 把两个埋点步骤的结果交给 Report Failure（环境变量）；failedStep 为空表示失败发生在别的步骤。 */
  function reportFor(
    failedStep: (typeof INSTRUMENTED)[number]['step'] | undefined,
    logs: Readonly<Record<string, string>>
  ) {
    const runnerTemp = makeTempDir('sparkle-ci-report-')
    for (const [name, content] of Object.entries(logs)) {
      writeFileSync(path.join(runnerTemp, name), content)
    }
    const summary = path.join(runnerTemp, 'summary.md')
    const outcomes = Object.fromEntries(
      INSTRUMENTED.map(({ step, outcomeEnv }) => [
        outcomeEnv,
        step === failedStep ? 'failure' : 'success'
      ])
    )
    const result = runScript(report, runnerTemp, { GITHUB_STEP_SUMMARY: summary, ...outcomes })
    return { result, summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '' }
  }

  it('puts the last 120 lines of the failed step into the summary, without colour codes', () => {
    const log = [...lines, '\u001b[31m⨯ boom 100%\u001b[0m'].join('\n')
    const { result, summary } = reportFor('Build', { 'ci-build.log': log })
    assert.equal(result.status, 0, result.stderr)
    assert.ok(summary.includes(`### Build failed: ${LABEL}`))
    assert.match(summary, /ci-build\.log/)
    assert.match(summary, /^line 32$/m)
    assert.doesNotMatch(summary, /^line 31$/m)
    assert.ok(summary.includes('⨯ boom 100%'))
    assert.ok(!summary.includes('\u001b'), 'colour codes are stripped')
  })

  it('annotates the error lines, with percent signs escaped as the runner requires', () => {
    const { result } = reportFor('Build', { 'ci-build.log': `${lines.join('\n')}\n⨯ boom 100%\n` })
    assert.ok(result.stdout.includes(`::error title=Build failed (${LABEL})::⨯ boom 100%25`))
  })

  it('reports the install log, and not a build log, when the install step failed', () => {
    const { result, summary } = reportFor('Install Dependencies and Prepare', {
      'ci-install.log': 'ERR_PNPM_FAILED nothing to install\n',
      'ci-build.log': 'output of an earlier build\n'
    })
    const title = `Install Dependencies and Prepare failed (${LABEL})`
    assert.equal(result.status, 0, result.stderr)
    assert.ok(summary.includes(`### Install Dependencies and Prepare failed: ${LABEL}`))
    assert.ok(summary.includes('ERR_PNPM_FAILED'))
    assert.ok(!summary.includes('earlier build'))
    assert.ok(result.stdout.includes(`::error title=${title}::ERR_PNPM_FAILED`))
  })

  it('stays silent when another step failed, whatever the logs of the passed steps contain', () => {
    const { result, summary } = reportFor(undefined, {
      'ci-install.log': 'ERR_PNPM_WARN something harmless\n',
      'ci-build.log': '⨯ a warning that did not fail the build\n'
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '')
    assert.equal(summary, '')
  })

  it('does not fail by itself when the log has nothing that looks like an error', () => {
    const { result, summary } = reportFor('Build', { 'ci-build.log': 'all quiet\n' })
    assert.equal(result.status, 0, result.stderr)
    assert.ok(summary.includes('all quiet'))
  })

  it('says so when the failed step left no output', () => {
    const { result, summary } = reportFor('Build', {})
    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.stdout.includes(`::error title=Build failed (${LABEL})::`))
    assert.equal(summary, '')
  })
})
