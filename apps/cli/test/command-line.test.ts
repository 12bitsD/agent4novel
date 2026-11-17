import { describe, expect, it } from 'vitest'
import { helpFor, parseCommandLine } from '../src/command-line.js'

function expectUsage(args: string[]) {
  let thrown: unknown
  try {
    parseCommandLine(args)
  } catch (error) {
    thrown = error
  }
  expect(thrown).toMatchObject({ code: 'usage' })
  expect(thrown).toBeInstanceOf(Error)
  if (thrown instanceof Error) {
    expect(thrown.message.split('\n')).toHaveLength(1)
    expect(thrown.message).not.toContain('private-')
  }
}

describe('CLI command-line pure functions', () => {
  it.each([['--help'], ['-h']])('shows global help content: %j', (...args) => {
    const help = helpFor(args)
    expect(help).toContain('agent4novel cli')
    expect(help).not.toContain('private-')
  })

  it.each([
    ['--help', 'advance', 'work-synthetic'],
    ['--url', 'get', '--timeout-ms', '5', 'advance', 'work-synthetic', '-h'],
  ])('finds the help command without treating option values as commands: %j', (...args) => {
    const help = helpFor(args)
    expect(help).toContain('用法: a4n advance')
    expect(help).not.toContain('用法: a4n get')
  })

  it.each([
    'list', 'create', 'get', 'run-step', 'start-chapter', 'select', 'save-outline', 'approve',
    'approve-setting', 'approve-beat', 'regenerate-beat', 'approve-prose', 'regenerate-prose',
    'save-prose', 'config', 'logs', 'smoke',
  ])('offers scoped %s help content', command => {
    for (const helpFlag of ['--help', '-h']) {
      const help = helpFor([command, helpFlag, '--file', '/missing/private-file', '--unknown'])
      expect(help).toContain(`用法: a4n ${command}`)
      expect(help).toContain('示例:')
      expect(help).toContain('副作用:')
      expect(help).not.toContain('private-file')
    }
  })

  it.each([
    ['get', 'work-synthetic', '--knd', 'private-option-value'],
    ['private-unknown-command'],
    ['advance', '-x'],
    ['advance', 'work-synthetic', '--url', 'private-option-value', '--url', 'private-other-value'],
    ['advance', 'work-synthetic', '--url'],
    ['advance', 'work-synthetic', '--url', '--timeout-ms', '1000'],
    ['advance', 'work-synthetic', '--url='],
    ['advance', 'work-synthetic', '--url', '   '],
    ['advance', 'work-synthetic', '--private-option-name', 'private-option-value'],
    ['start-chapter', 'work-synthetic', '--file', '/missing/private-file', '--chapter', '2'],
  ])('rejects invalid syntax at the parser: %j', (...args) => {
    expectUsage(args)
  })

  it.each([
    ['config', 'private-extra'],
    ['create', '--seed', 'synthetic', 'private-extra'],
    ['smoke', '--seed', 'synthetic', 'private-extra'],
    ['get', 'work-synthetic', 'private-extra'],
    ['advance', 'work-synthetic', 'private-extra'],
    ['start-chapter', 'work-synthetic', '--file', '/missing/private-file', 'private-extra'],
    ['select', 'work-synthetic', 'direction-synthetic', 'private-extra'],
    ['approve', 'work-synthetic', 'outline', 'private-extra'],
    ['save-outline', 'work-synthetic', '--file', '/missing/private-file', 'private-extra'],
    ['approve-setting', 'work-synthetic', '--file', '/missing/private-file', 'private-extra'],
    ['approve-beat', 'work-synthetic', '--file', '/missing/private-file', 'private-extra'],
    ['regenerate-beat', 'work-synthetic', '--file', '/missing/private-file', 'private-extra'],
    ['logs', 'work-synthetic', 'private-extra'],
    ['run-step', 'caption', '--seed-file', '/missing/private-file', 'private-extra'],
    ['get'], ['advance'], ['select'], ['approve', 'work-synthetic'],
    ['start-chapter', '--file', '/missing/private-file'],
    ['save-outline', '--file', '/missing/private-file'],
    ['approve-setting', '--file', '/missing/private-file'],
    ['approve-beat', '--file', '/missing/private-file'],
    ['regenerate-beat', '--file', '/missing/private-file'],
    ['logs'], ['run-step', '--seed-file', '/missing/private-file'],
    ['advance', '   '], ['select', 'work-synthetic', ''],
  ])('rejects missing, extra or blank positionals at the parser: %j', (...args) => {
    expectUsage(args)
  })

  it.each([
    ['smoke'], ['run-step', 'caption'],
    ['create', '--seed', 'private-seed', '--seed-file', '/missing/private-file'],
    ['smoke', '--seed', 'private-seed', '--seed-file', '/missing/private-file'],
    ['run-step', 'caption', '--input-file', '/missing/private-input', '--seed-file', '/missing/private-file'],
    ['save-outline', 'work-synthetic'], ['approve-setting', 'work-synthetic'],
    ['start-chapter', 'work-synthetic'],
    ['approve-beat', 'work-synthetic'], ['regenerate-beat', 'work-synthetic'],
  ])('rejects missing or mutually exclusive inputs at the parser: %j', (...args) => {
    expectUsage(args)
  })
})
