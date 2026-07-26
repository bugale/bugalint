import '@microsoft/jest-sarif'
import { readFileSync } from 'fs'
import type { Region } from 'sarif'
import { getOctokit } from '@actions/github'
import { warning } from '@actions/core'
import {
  generateSarif,
  getKnownParser,
  getRegexParser,
  getDiffParser,
  parseDiffLines,
  isNewIssue,
  isCommentableIssue,
  failOnIssues,
  filterNewIssues,
  addComments,
  _testExports,
  type Parser
} from '../src/bugalint'

jest.mock('@actions/github', () => ({ getOctokit: jest.fn() }))
jest.mock('@actions/core', () => ({ ...jest.requireActual('@actions/core'), warning: jest.fn() }))

/* eslint camelcase: ["error", {allow: ['^comment_id$', '^start_side$', '^start_line$', '^in_reply_to_id$']}] */

describe('fullConversion', () => {
  it.each([
    ['mypy', getKnownParser('mypy'), '.'],
    ['pylint', getKnownParser('pylint'), '.'],
    ['flake8', getKnownParser('flake8'), '.'],
    ['mdl', getKnownParser('mdl'), '.'],
    ['yamllint', getKnownParser('yamllint'), '.'],
    ['ghalint', getKnownParser('ghalint'), '.'],
    ['sarif', getKnownParser('sarif'), '.'],
    ['sariffix', getKnownParser('sarif'), '.'],
    ['diff', getKnownParser('diff'), '.'],
    ['flake8subpath', getKnownParser('flake8'), 'A\\B'],
    ['noissues', getKnownParser('flake8'), '.'],
    [
      'custom',
      getRegexParser(
        /^(?<path>[^-\n]+)(?:-(?<line>\d+))?(?:-(?<col>\d+))?(?:-(?<eline>\d+))?(?:-(?<ecol>\d+))? (?<level>[^:\s]+):(?<id>[^:\s]+):(?<sym>[^:\s]+) (?<msg>.+)$/gm,
        { err: 'error', warn: 'warning', info: 'note' }
      ),
      '.'
    ]
  ])('%s', (name: string, parser: Parser, analysisPath: string) => {
    const input = readFileSync(`__tests__/${name}.input.txt`, 'utf-8').replace(/\r/g, '')
    const output = readFileSync(`__tests__/${name}.output.json`, 'utf-8').replace(/\r/g, '')
    const result = generateSarif(parser(input), 'test', analysisPath)
    expect(result).toBeValidSarifLog()
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(JSON.parse(output))
  })
})

describe('newIssues', () => {
  const diff = `diff --git a/A/B/test.py b/A/B/test.py
index 1111111..2222222 100644
--- a/A/B/test.py
+++ b/A/B/test.py
@@ -1,2 +1,3 @@
 import os
+import sys
+x = 1
`
  const diffLines = parseDiffLines(diff)

  it('collects the lines of the diff per file, marking the added ones', () => {
    expect(diffLines).toStrictEqual({ 'A/B/test.py': { 1: false, 2: true, 3: true } })
  })

  it('accepts issues overlapping an added line', () => {
    expect(isNewIssue({ path: 'A/B/test.py', line: 2 }, diffLines, '.')).toBe(true)
    expect(isNewIssue({ path: 'A/B/test.py', line: 2, eline: 3 }, diffLines, '.')).toBe(true)
    expect(isNewIssue({ path: 'A/B/test.py', line: 1, eline: 2 }, diffLines, '.')).toBe(true)
    expect(isNewIssue({ path: 'test.py', line: 3 }, diffLines, 'A\\B')).toBe(true)
  })

  it('rejects issues not overlapping any added line', () => {
    expect(isNewIssue({ path: 'A/B/test.py', line: 1 }, diffLines, '.')).toBe(false)
    expect(isNewIssue({ path: 'A/B/other.py', line: 2 }, diffLines, '.')).toBe(false)
    expect(isNewIssue({ line: 2 }, diffLines, '.')).toBe(false)
    expect(isNewIssue({ path: 'A/B/test.py' }, diffLines, '.')).toBe(false)
  })

  it('comments only on issues whose whole range is in the diff', () => {
    expect(isCommentableIssue({ path: 'A/B/test.py', line: 1, eline: 3 }, diffLines, '.')).toBe(true)
    expect(isCommentableIssue({ path: 'A/B/test.py', line: 3, eline: 4 }, diffLines, '.')).toBe(false)
    expect(isCommentableIssue({ path: 'A/B/other.py', line: 1 }, diffLines, '.')).toBe(false)
    expect(isCommentableIssue({ path: 'A/B/test.py' }, diffLines, '.')).toBe(false)
  })

  describe('failOnIssues', () => {
    it('does nothing when no issues are found', () => {
      expect(() => {
        failOnIssues([], 'test')
      }).not.toThrow()
    })

    it('throws when issues are found', () => {
      expect(() => {
        failOnIssues([{ path: 'a.py', line: 1 }, { msg: 'x' }], 'test')
      }).toThrow('test found 2 issues')
    })
  })

  describe('filterNewIssues', () => {
    it('keeps only the issues overlapping an added line', () => {
      const issues = [
        { path: 'A/B/test.py', line: 1 },
        { path: 'A/B/test.py', line: 2 },
        { path: 'A/B/test.py', line: 1, eline: 2 },
        { path: 'A/B/other.py', line: 2 }
      ]
      expect(filterNewIssues(issues, diff, '.')).toStrictEqual([issues[1], issues[2]])
    })

    it('keeps nothing when all issues are old', () => {
      expect(filterNewIssues([{ path: 'A/B/test.py', line: 1 }], diff, '.')).toStrictEqual([])
    })

    it('relativizes the issue paths to the analysis path', () => {
      expect(filterNewIssues([{ path: 'test.py', line: 3 }], diff, 'A\\B')).toHaveLength(1)
    })
  })
})

describe('commentBody', () => {
  const issue = { level: 'warning' as const, msg: 'Message' }
  const header = '**Message**\n[warning:test]'
  const built = (fix?: string[]): ReturnType<typeof _testExports.buildComment> =>
    _testExports.buildComment('test', fix === undefined ? issue : { ...issue, fix })
  const body = (fix?: string[]): string => built(fix).body.replace(/^<!-- bugale\/bugalint test [0-9a-f]{16} -->\n/, '')

  it('starts with an invisible tag carrying the identifier and the fingerprint', () => {
    expect(built().body).toBe(`<!-- bugale/bugalint test ${built().fingerprint} -->\n${header}`)
    expect(built().fingerprint).toMatch(/^[0-9a-f]{16}$/)
  })

  it('omits the suggestion when the issue has no fix', () => {
    expect(body()).toBe(header)
  })

  it('appends the suggestion after the identifier line', () => {
    expect(body(['x = 1'])).toBe(`${header}\n\`\`\`suggestion\nx = 1\n\`\`\``)
  })

  it('keeps a multi line fix verbatim', () => {
    expect(body(['def f():', '    return 1'])).toBe(`${header}\n\`\`\`suggestion\ndef f():\n    return 1\n\`\`\``)
  })

  it('renders a fix with no lines as an empty suggestion, which deletes the lines', () => {
    expect(body([])).toBe(`${header}\n\`\`\`suggestion\n\`\`\``)
  })

  it('renders a single empty line as a suggestion blanking the lines, not deleting them', () => {
    expect(body([''])).toBe(`${header}\n\`\`\`suggestion\n\n\`\`\``)
  })

  it('preserves a trailing empty line', () => {
    expect(body(['x = 1', ''])).toBe(`${header}\n\`\`\`suggestion\nx = 1\n\n\`\`\``)
  })

  it('uses a fence longer than the longest backtick run in the fix', () => {
    expect(body(['doc = "```"'])).toBe(`${header}\n\`\`\`\`suggestion\ndoc = "\`\`\`"\n\`\`\`\``)
  })

  it('gives the same fingerprint to the same rendered comment and a different one to any change', () => {
    expect(built(['x = 1']).fingerprint).toBe(built(['x = 1']).fingerprint)
    expect(built(['x = 1']).fingerprint).not.toBe(built(['x = 2']).fingerprint)
    expect(built(['x = 1']).fingerprint).not.toBe(built().fingerprint)
    expect(built().fingerprint).not.toBe(_testExports.buildComment('test', { ...issue, msg: 'Other' }).fingerprint)
    expect(built().fingerprint).not.toBe(_testExports.buildComment('test', { ...issue, level: 'error' }).fingerprint)
    expect(built().fingerprint).not.toBe(_testExports.buildComment('other', issue).fingerprint)
  })
})

describe('commentReconciliation', () => {
  type Issue = Parameters<typeof addComments>[0] extends Iterable<infer T> ? T : never

  interface ReviewComment {
    id: number
    body: string
    path: string
    line?: number
    start_line?: number | null
    in_reply_to_id?: number
  }

  interface DraftComment {
    path: string
    side: string
    start_side: string
    line: number
    start_line?: number
    body: string
  }

  interface Calls {
    posted: DraftComment[][]
    deleted: number[]
    order: string[]
  }

  const identifier = 'test'
  const file = 'a.py'
  const otherFile = 'b.py'
  const warnings = jest.mocked(warning)
  const bodyOf = (issue: Issue, tool = identifier): string => _testExports.buildComment(tool, issue).body

  const diff = (count: number): string =>
    [file, otherFile]
      .map((name) =>
        [
          `diff --git a/${name} b/${name}`,
          `--- a/${name}`,
          `+++ b/${name}`,
          `@@ -0,0 +1,${count} @@`,
          ...Array.from({ length: count }, (_, index) => `+line ${index + 1}`),
          ''
        ].join('\n')
      )
      .join('')

  const issueAt = (line: number, fix?: string[], eline?: number): Issue => ({ msg: 'Message', level: 'warning', path: file, line, eline, fix })

  const commentOf = (id: number, issue: Issue, overrides: Partial<ReviewComment> = {}): ReviewComment => ({
    id,
    body: bodyOf(issue),
    path: file,
    line: issue.eline ?? issue.line,
    start_line: issue.eline == null ? null : issue.line,
    ...overrides
  })

  const run = async (existing: ReviewComment[], issues: Issue[], lines = 10, tool = identifier): Promise<Calls> => {
    const calls: Calls = { posted: [], deleted: [], order: [] }
    const pages: ReviewComment[][] = []
    for (let index = 0; index < existing.length; index += 2) {
      pages.push(existing.slice(index, index + 2))
    }
    const octokit = {
      paginate: {
        async *iterator(): AsyncGenerator<{ data: ReviewComment[] }> {
          for (const page of pages) {
            yield { data: page }
          }
        }
      },
      rest: {
        pulls: {
          listReviewComments: {},
          createReview: async (args: { comments: DraftComment[] }): Promise<void> => {
            calls.posted.push(args.comments)
            calls.order.push('post')
          },
          deleteReviewComment: async (args: { comment_id: number }): Promise<void> => {
            calls.deleted.push(args.comment_id)
            calls.order.push(`delete ${args.comment_id}`)
          }
        }
      }
    }
    jest.mocked(getOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof getOctokit>)
    await addComments(issues, diff(lines), 'token', tool, 'owner', 'repo', 1, '.')
    return calls
  }

  beforeEach(() => {
    warnings.mockClear()
  })

  it('posts a comment of a finding that does not have one yet', async () => {
    const issue = issueAt(2, ['x = 1'])
    const calls = await run([], [issue])
    expect(calls.posted).toStrictEqual([[{ path: file, side: 'RIGHT', start_side: 'RIGHT', line: 2, start_line: undefined, body: bodyOf(issue) }]])
    expect(calls.deleted).toStrictEqual([])
  })

  it('leaves the comment of an unchanged finding alone, neither deleting nor reposting it', async () => {
    const issue = issueAt(2, ['x = 1'])
    const calls = await run([commentOf(1, issue)], [issue])
    expect(calls.posted).toStrictEqual([])
    expect(calls.deleted).toStrictEqual([])
  })

  it('deletes the comment of a finding that disappeared', async () => {
    const calls = await run([commentOf(1, issueAt(2, ['x = 1']))], [])
    expect(calls.posted).toStrictEqual([])
    expect(calls.deleted).toStrictEqual([1])
  })

  it('replaces the comment of a finding whose suggestion changed', async () => {
    const changed = issueAt(2, ['x = 2'])
    const calls = await run([commentOf(1, issueAt(2, ['x = 1']))], [changed])
    expect(calls.posted).toStrictEqual([[expect.objectContaining({ line: 2, body: bodyOf(changed) })]])
    expect(calls.deleted).toStrictEqual([1])
  })

  it('replaces the comment of a finding whose message changed', async () => {
    const changed = { ...issueAt(2), msg: 'Other' }
    const calls = await run([commentOf(1, issueAt(2))], [changed])
    expect(calls.posted).toStrictEqual([[expect.objectContaining({ body: bodyOf(changed) })]])
    expect(calls.deleted).toStrictEqual([1])
  })

  it('posts before deleting, so a rejected review leaves the old comments in place', async () => {
    const calls = await run([commentOf(1, issueAt(2, ['x = 1']))], [issueAt(3, ['y = 1'])])
    expect(calls.order).toStrictEqual(['post', 'delete 1'])
  })

  it('matches the line GitHub currently reports, so a comment that moved with the diff is kept', async () => {
    const shifted = commentOf(1, issueAt(2, ['x = 1']), { line: 5, start_line: null })
    const calls = await run([shifted], [issueAt(5, ['x = 1'])])
    expect(calls.posted).toStrictEqual([])
    expect(calls.deleted).toStrictEqual([])
  })

  it('replaces a comment that GitHub no longer anchors to any line', async () => {
    const issue = issueAt(2, ['x = 1'])
    const calls = await run([commentOf(1, issue, { line: undefined })], [issue])
    expect(calls.posted).toStrictEqual([[expect.objectContaining({ body: bodyOf(issue) })]])
    expect(calls.deleted).toStrictEqual([1])
  })

  it('matches the whole range of a multi line comment', async () => {
    const issue = issueAt(2, ['x = 1', 'y = 2'], 3)
    expect((await run([commentOf(1, issue)], [issue])).deleted).toStrictEqual([])
    const widened = issueAt(1, ['x = 1', 'y = 2'], 3)
    const calls = await run([commentOf(1, issue)], [widened])
    expect(calls.posted).toStrictEqual([[expect.objectContaining({ line: 3, start_line: 1 })]])
    expect(calls.deleted).toStrictEqual([1])
  })

  it('never deletes a comment that was replied to', async () => {
    const reply: ReviewComment = { id: 2, body: 'Why?', path: file, line: 2, in_reply_to_id: 1 }
    const calls = await run([commentOf(1, issueAt(2, ['x = 1'])), reply], [])
    expect(calls.deleted).toStrictEqual([])
  })

  it('keeps a comment that was replied to even when its finding changed, posting the new one beside it', async () => {
    const reply: ReviewComment = { id: 2, body: 'Why?', path: file, line: 2, in_reply_to_id: 1 }
    const changed = issueAt(2, ['x = 2'])
    const calls = await run([commentOf(1, issueAt(2, ['x = 1'])), reply], [changed])
    expect(calls.posted).toStrictEqual([[expect.objectContaining({ body: bodyOf(changed) })]])
    expect(calls.deleted).toStrictEqual([])
  })

  it('replaces a comment of an older version, whose tag carries no fingerprint', async () => {
    const issue = issueAt(2, ['x = 1'])
    const legacy: ReviewComment = { id: 1, body: `<!-- bugale/bugalint ${identifier} -->\n**Message**\n[warning:test]`, path: file, line: 2 }
    const calls = await run([legacy], [issue])
    expect(calls.posted).toStrictEqual([[expect.objectContaining({ body: bodyOf(issue) })]])
    expect(calls.deleted).toStrictEqual([1])
  })

  it('deletes a comment of an older version whose finding disappeared', async () => {
    const legacy: ReviewComment = { id: 1, body: `<!-- bugale/bugalint ${identifier} -->\n**Message**`, path: file, line: 2 }
    expect((await run([legacy], [])).deleted).toStrictEqual([1])
  })

  it('touches neither comments of other tools nor comments of humans', async () => {
    const others: ReviewComment[] = [
      { id: 1, body: '<!-- bugale/bugalint other 0123456789abcdef -->\n**Message**', path: file, line: 2 },
      { id: 2, body: `<!-- bugale/bugalint ${identifier}ing 0123456789abcdef -->\n**Message**`, path: file, line: 2 },
      { id: 3, body: 'Looks good to me', path: file, line: 2 },
      { id: 4, body: `Quoting <!-- bugale/bugalint ${identifier} 0123456789abcdef -->`, path: file, line: 2 }
    ]
    expect((await run(others, [])).deleted).toStrictEqual([])
  })

  it('reads a tool name literally rather than as a pattern', async () => {
    const issue = issueAt(2, ['x = 1'])
    const tool = 'a.b+c'
    const foreign: ReviewComment = { id: 1, body: bodyOf(issue, 'aXb+c'), path: file, line: 2 }
    const calls = await run([foreign, { ...commentOf(2, issue), body: bodyOf(issue, tool) }], [issue], 10, tool)
    expect(calls.posted).toStrictEqual([])
    expect(calls.deleted).toStrictEqual([])
  })

  it('keeps exactly one comment per identical finding', async () => {
    const issue = issueAt(2, ['x = 1'])
    const existing = [commentOf(1, issue), commentOf(2, issue)]
    const both = await run(existing, [issue, issue])
    expect(both.posted).toStrictEqual([])
    expect(both.deleted).toStrictEqual([])
    const one = await run([commentOf(1, issue), commentOf(2, issue)], [issue])
    expect(one.posted).toStrictEqual([])
    expect(one.deleted).toStrictEqual([2])
    const three = await run([commentOf(1, issue), commentOf(2, issue)], [issue, issue, issue])
    expect(three.posted[0]).toHaveLength(1)
    expect(three.deleted).toStrictEqual([])
  })

  it('still skips a finding whose range leaves the pull request diff', async () => {
    expect((await run([], [issueAt(9, undefined, 12)])).posted).toStrictEqual([])
  })

  it('tells apart the same finding reported on the same line of two files', async () => {
    const issue = issueAt(2, ['x = 1'])
    const other = { ...issue, path: otherFile }
    const both = await run([commentOf(1, issue), { ...commentOf(2, other), path: otherFile }], [issue, other])
    expect(both.posted).toStrictEqual([])
    expect(both.deleted).toStrictEqual([])
    const moved = await run([{ ...commentOf(1, other), path: otherFile }], [issue])
    expect(moved.posted).toStrictEqual([[expect.objectContaining({ path: file, line: 2 })]])
    expect(moved.deleted).toStrictEqual([1])
  })

  it('posts at most 50 comments', async () => {
    const issues = Array.from({ length: 55 }, (_, index) => issueAt(index + 1))
    const calls = await run([], issues, 60)
    expect(calls.posted[0]).toHaveLength(50)
    expect(warnings).toHaveBeenCalledWith('More than 50 comments detected. Only the first 50 will be posted.')
  })

  it('does not warn about exactly 50 comments', async () => {
    const issues = Array.from({ length: 50 }, (_, index) => issueAt(index + 1))
    const calls = await run([], issues, 60)
    expect(calls.posted[0]).toHaveLength(50)
    expect(warnings).not.toHaveBeenCalled()
  })

  it('counts the comments it keeps against the 50 comment cap', async () => {
    const issues = Array.from({ length: 55 }, (_, index) => issueAt(index + 1))
    const existing = issues.slice(0, 48).map((issue, index) => commentOf(index + 1, issue))
    const calls = await run(existing, issues, 60)
    expect(calls.posted).toStrictEqual([[expect.objectContaining({ line: 49 }), expect.objectContaining({ line: 50 })]])
    expect(calls.deleted).toStrictEqual([])
    expect(warnings).toHaveBeenCalled()
  })

  it('posts nothing when the comments it keeps already fill the 50 comment cap', async () => {
    const issues = Array.from({ length: 55 }, (_, index) => issueAt(index + 1))
    const existing = issues.slice(0, 50).map((issue, index) => commentOf(index + 1, issue))
    const calls = await run(existing, issues, 60)
    expect(calls.posted).toStrictEqual([])
    expect(calls.deleted).toStrictEqual([])
    expect(warnings).toHaveBeenCalled()
  })
})

describe('sarifFix', () => {
  const fixOf = (region: Region, deletedRegion: Region, text: string): string[] | undefined => {
    const log = {
      version: '2.1.0',
      runs: [
        {
          tool: { driver: { name: 'test' } },
          results: [
            {
              message: { text: 'Message' },
              locations: [{ physicalLocation: { artifactLocation: { uri: 'test.py' }, region } }],
              fixes: [{ artifactChanges: [{ artifactLocation: { uri: 'test.py' }, replacements: [{ deletedRegion, insertedContent: { text } }] }] }]
            }
          ]
        }
      ]
    }
    return [...getKnownParser('sarif')(JSON.stringify(log))][0].fix
  }

  it('takes the text of a region ending at the end of the last reported line', () => {
    expect(fixOf({ startLine: 3, endLine: 4 }, { startLine: 3, endLine: 4 }, 'a\nb')).toStrictEqual(['a', 'b'])
    expect(fixOf({ startLine: 3 }, { startLine: 3 }, 'a')).toStrictEqual(['a'])
  })

  it('drops the line terminator of a region ending at the beginning of the following line', () => {
    expect(fixOf({ startLine: 3, endLine: 4 }, { startLine: 3, startColumn: 1, endLine: 5, endColumn: 1 }, 'a\nb\n')).toStrictEqual(['a', 'b'])
    expect(fixOf({ startLine: 3 }, { startLine: 3, startColumn: 1, endLine: 4, endColumn: 1 }, 'a\n')).toStrictEqual(['a'])
  })

  it('keeps a trailing empty line of both forms', () => {
    expect(fixOf({ startLine: 3, endLine: 4 }, { startLine: 3, endLine: 4 }, 'a\nb\n')).toStrictEqual(['a', 'b', ''])
    expect(fixOf({ startLine: 3, endLine: 4 }, { startLine: 3, startColumn: 1, endLine: 5, endColumn: 1 }, 'a\nb\n\n')).toStrictEqual(['a', 'b', ''])
  })

  it('reads an empty text as a deletion in both forms', () => {
    expect(fixOf({ startLine: 3 }, { startLine: 3 }, '')).toStrictEqual([])
    expect(fixOf({ startLine: 3 }, { startLine: 3, startColumn: 1, endLine: 4, endColumn: 1 }, '')).toStrictEqual([])
  })

  it('reads a lone terminator as a single empty line, which only the second form can express', () => {
    expect(fixOf({ startLine: 3 }, { startLine: 3, startColumn: 1, endLine: 4, endColumn: 1 }, '\n')).toStrictEqual([''])
  })

  it('ignores a fix replacing a part of a line', () => {
    expect(fixOf({ startLine: 3 }, { startLine: 3, startColumn: 5, endLine: 3, endColumn: 7 }, '===')).toBeUndefined()
    expect(fixOf({ startLine: 3 }, { startLine: 3, endLine: 3, endColumn: 10 }, 'a')).toBeUndefined()
  })

  it('ignores a fix replacing lines other than the reported ones', () => {
    expect(fixOf({ startLine: 3 }, { startLine: 3, endLine: 4 }, 'a')).toBeUndefined()
    expect(fixOf({ startLine: 3 }, { startLine: 4 }, 'a')).toBeUndefined()
    expect(fixOf({ startLine: 3, endLine: 4 }, { startLine: 3, startColumn: 1, endLine: 4, endColumn: 1 }, 'a\n')).toBeUndefined()
  })
})

describe('diffFormat', () => {
  const diffOf = (lines: string[], terminator = '\n'): string => lines.map((line) => `${line}${terminator}`).join('')
  const header = ['diff --git a/a.c b/a.c', 'index 1111111..2222222 100644', '--- a/a.c', '+++ b/a.c', '@@ -1,1 +1,1 @@']
  const firstIssue = (lines: string[], terminator = '\n'): unknown => [...getKnownParser('diff')(diffOf(lines, terminator))][0]

  it('uses the configured message, falling back to a generic one', () => {
    const input = diffOf([...header, '-int  a=0;', '+int a = 0;'])
    expect([...getDiffParser('Run clang-format')(input)][0].msg).toBe('Run clang-format')
    expect([...getDiffParser('')(input)][0].msg).toBe('Not formatted correctly')
    expect([...getKnownParser('diff')(input)][0].msg).toBe('Not formatted correctly')
  })

  it('anchors on the lines of the old side of the diff', () => {
    const lines = [
      'diff --git a/a.c b/a.c',
      '--- a/a.c',
      '+++ b/a.c',
      '@@ -10,4 +2,3 @@',
      ' int a = 0;',
      '-int  b=1;',
      '-int  c=2;',
      '+int b = 1, c = 2;',
      ' return a;'
    ]
    expect(firstIssue(lines)).toMatchObject({ path: 'a.c', line: 11, eline: 12, fix: ['int b = 1, c = 2;'] })
  })

  it('reports a deletion as a fix with no lines', () => {
    expect(firstIssue(['diff --git a/a.c b/a.c', '--- a/a.c', '+++ b/a.c', '@@ -5,3 +5,2 @@', ' int a = 0;', '-', ' return a;'])).toMatchObject({
      line: 6,
      eline: 6,
      fix: []
    })
  })

  it('distinguishes blanking a line from deleting it', () => {
    expect(firstIssue(['diff --git a/a.c b/a.c', '--- a/a.c', '+++ b/a.c', '@@ -5,3 +5,3 @@', ' int a = 0;', '-    ', '+', ' return a;'])).toMatchObject({
      line: 6,
      eline: 6,
      fix: ['']
    })
  })

  it('extends an insertion to the preceding line', () => {
    expect(firstIssue(['diff --git a/a.c b/a.c', '--- a/a.c', '+++ b/a.c', '@@ -4,2 +4,3 @@', ' int a = 0;', '+int b = 1;', ' return a;'])).toMatchObject({
      line: 4,
      eline: 4,
      fix: ['int a = 0;', 'int b = 1;']
    })
  })

  it('extends an insertion at the top of a file to the following line', () => {
    expect(firstIssue(['diff --git a/a.c b/a.c', '--- a/a.c', '+++ b/a.c', '@@ -1,2 +1,3 @@', '+// header', ' int a = 0;', ' return a;'])).toMatchObject({
      line: 1,
      eline: 1,
      fix: ['// header', 'int a = 0;']
    })
  })

  it('ignores the marker of a file not ending with a newline', () => {
    expect(firstIssue([...header, '-int  a=0;', '\\ No newline at end of file', '+int a = 0;'])).toMatchObject({ line: 1, eline: 1, fix: ['int a = 0;'] })
  })

  it('reports a change of the line terminator alone without a fix replacing a line with itself', () => {
    const issue = firstIssue([...header, '-int a = 0;', '\\ No newline at end of file', '+int a = 0;'])
    expect(issue).toMatchObject({ line: 1, eline: 1 })
    expect(issue).not.toHaveProperty('fix')
  })

  it('keeps carriage returns that are part of the content', () => {
    expect(firstIssue([...header, '-int  a=0;\r', '+int a = 0;\r'])).toMatchObject({ fix: ['int a = 0;\r'] })
  })

  it('strips the carriage returns of a diff whose own lines are terminated by them', () => {
    expect(firstIssue([...header, '-int  a=0;', '+int a = 0;'], '\r\n')).toMatchObject({ fix: ['int a = 0;'] })
    expect(firstIssue([...header, '-int  a=0;\r', '+int a = 0;\r'], '\r\n')).toMatchObject({ fix: ['int a = 0;\r'] })
  })
})

describe('windowsFileUrl', () => {
  if (process.platform === 'win32') {
    it('should convert Windows file URLs to relative URLs', () => {
      process.chdir('C:\\')
      expect(_testExports.normalizePath('file:///C:/a/test.txt', 'C:\\')).toBe('a/test.txt')
      expect(_testExports.normalizePath('file:///C:/a/test.txt', '.')).toBe('a/test.txt')
    })
  }
})
