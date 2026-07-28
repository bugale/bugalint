import '@microsoft/jest-sarif'
import { readFileSync } from 'fs'
import type { Region } from 'sarif'
import {
  generateSarif,
  getKnownParser,
  getRegexParser,
  parseDiffLines,
  isNewIssue,
  isCommentableIssue,
  failOnIssues,
  filterNewIssues,
  _testExports,
  type Parser
} from '../src/bugalint'

describe('fullConversion', () => {
  it.each([
    ['mypy', getKnownParser('mypy', ''), '.'],
    ['pylint', getKnownParser('pylint', ''), '.'],
    ['flake8', getKnownParser('flake8', ''), '.'],
    ['mdl', getKnownParser('mdl', ''), '.'],
    ['yamllint', getKnownParser('yamllint', ''), '.'],
    ['ghalint', getKnownParser('ghalint', ''), '.'],
    ['sarif', getKnownParser('sarif', ''), '.'],
    ['sariffix', getKnownParser('sarif', ''), '.'],
    ['diff', getKnownParser('diff', 'Not formatted correctly'), '.'],
    ['flake8subpath', getKnownParser('flake8', 'Fix it'), 'A\\B'],
    ['noissues', getKnownParser('flake8', ''), '.'],
    [
      'custom',
      getRegexParser(
        /^(?<path>[^-\n]+)(?:-(?<line>\d+))?(?:-(?<col>\d+))?(?:-(?<eline>\d+))?(?:-(?<ecol>\d+))? (?<level>[^:\s]+):(?<id>[^:\s]+):(?<sym>[^:\s]+) (?<msg>.+)$/gm,
        '',
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
  const tag = '<!-- bugale/bugalint test -->'
  const header = `${tag}\n**Message**\n[warning:test]`
  const issue = { level: 'warning' as const, msg: 'Message' }
  const body = (fix?: string[]): string => _testExports.buildCommentBody(tag, 'test', fix === undefined ? issue : { ...issue, fix })

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

  it('renders no suggestion for a single empty line, which GitHub cannot tell apart from a deletion', () => {
    expect(body([''])).toBe(header)
  })

  it('preserves a trailing empty line', () => {
    expect(body(['x = 1', ''])).toBe(`${header}\n\`\`\`suggestion\nx = 1\n\n\`\`\``)
  })

  it('uses a fence longer than the longest backtick run in the fix', () => {
    expect(body(['doc = "```"'])).toBe(`${header}\n\`\`\`\`suggestion\ndoc = "\`\`\`"\n\`\`\`\``)
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
    return [...getKnownParser('sarif', '')(JSON.stringify(log))][0].fix
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

  it('reaches the comment builder with a single empty line, which it renders without a suggestion', () => {
    const fix = fixOf({ startLine: 3 }, { startLine: 3, startColumn: 1, endLine: 4, endColumn: 1 }, '\n')
    expect(_testExports.buildCommentBody('<!-- bugale/bugalint test -->', 'test', { level: 'warning', msg: 'Message', fix })).toBe(
      '<!-- bugale/bugalint test -->\n**Message**\n[warning:test]'
    )
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

describe('invertedRange', () => {
  interface ParsedIssue {
    line?: number
    eline?: number
    fix?: string[]
  }

  const sarifLog = (region: Region, fix = false, deleted: Region = { startLine: 12 }): string =>
    JSON.stringify({
      version: '2.1.0',
      runs: [
        {
          tool: { driver: { name: 'test' } },
          results: [
            {
              message: { text: 'Message' },
              locations: [{ physicalLocation: { artifactLocation: { uri: 'test.py' }, region } }],
              fixes: fix
                ? [
                    {
                      artifactChanges: [{ artifactLocation: { uri: 'test.py' }, replacements: [{ deletedRegion: deleted, insertedContent: { text: 'x' } }] }]
                    }
                  ]
                : undefined
            }
          ]
        }
      ]
    })

  const sarifOf = (region: Region, fix = false, deleted?: Region): ParsedIssue => [...getKnownParser('sarif', '')(sarifLog(region, fix, deleted))][0]
  const pylintOf = (line: number, endLine: number): ParsedIssue =>
    [...getKnownParser('pylint', '')(JSON.stringify([{ type: 'warning', path: 'a.py', line, endLine }]))][0]
  const regexOf = (input: string): ParsedIssue => [...getRegexParser(/^(?<line>\d+):(?<eline>\d+)$/gm, '')(input)][0]

  it('drops a SARIF end line preceding the start line, keeping the anchor the producer got right', () => {
    expect(sarifOf({ startLine: 12, endLine: 10 }).eline).toBeUndefined()
    expect(sarifOf({ startLine: 12, endLine: 10 }).line).toBe(12)
    expect(sarifOf({ startLine: 12, endLine: 12 }).eline).toBe(12)
    expect(sarifOf({ startLine: 12, endLine: 14 }).eline).toBe(14)
  })

  it('drops a pylint end line preceding the start line', () => {
    expect(pylintOf(12, 10).eline).toBeUndefined()
    expect(pylintOf(12, 14).eline).toBe(14)
  })

  it('drops a captured end line preceding the start line', () => {
    expect(regexOf('12:10').eline).toBeUndefined()
    expect(regexOf('12:14').eline).toBe(14)
  })

  it('drops an end line one before the start line, where only the result region would have inverted', () => {
    expect(sarifOf({ startLine: 12, endLine: 11 }).eline).toBeUndefined()
    expect(pylintOf(12, 11).eline).toBeUndefined()
    expect(regexOf('12:11').eline).toBeUndefined()
  })

  it('matches the fix of an inverted region against the start line alone', () => {
    expect(sarifOf({ startLine: 12, endLine: 10 }, true).fix).toStrictEqual(['x'])
    expect(sarifOf({ startLine: 12, endLine: 11 }, true).fix).toStrictEqual(['x'])
  })

  it('ignores a fix whose own deleted region ends before it starts', () => {
    expect(sarifOf({ startLine: 12, endLine: 10 }, true, { startLine: 12, endLine: 10 }).fix).toBeUndefined()
    expect(sarifOf({ startLine: 12, endLine: 11 }, true, { startLine: 12, endLine: 11 }).fix).toBeUndefined()
  })

  it('regenerates neither region of an inverted result inverted', () => {
    for (const endLine of [10, 11]) {
      const output = generateSarif([...getKnownParser('sarif', '')(sarifLog({ startLine: 12, endLine }, true))], 'test', '.')
      expect(output).toBeValidSarifLog()
      expect(output.runs[0].results?.[0].locations?.[0].physicalLocation?.region).toStrictEqual({
        startLine: 12,
        startColumn: undefined,
        endLine: undefined,
        endColumn: undefined
      })
      expect(output.runs[0].results?.[0].fixes?.[0].artifactChanges[0].replacements[0].deletedRegion).toStrictEqual({
        startLine: 12,
        startColumn: 1,
        endLine: 13,
        endColumn: 1
      })
    }
  })

  it('never reaches a comment anchor whose start follows its end', () => {
    const diffLines = parseDiffLines('diff --git a/t.py b/t.py\n--- a/t.py\n+++ b/t.py\n@@ -1,1 +1,3 @@\n x\n+y\n+z\n')
    expect(isCommentableIssue({ path: 't.py', line: 2, eline: 3 }, diffLines, '.')).toBe(true)
    expect(isCommentableIssue({ path: 't.py', line: 3, eline: 2 }, diffLines, '.')).toBe(false)
  })
})

describe('diffFormat', () => {
  const diffOf = (lines: string[], terminator = '\n'): string => lines.map((line) => `${line}${terminator}`).join('')
  const header = ['diff --git a/a.c b/a.c', 'index 1111111..2222222 100644', '--- a/a.c', '+++ b/a.c', '@@ -1,1 +1,1 @@']
  const firstIssue = (lines: string[], terminator = '\n'): unknown => [...getKnownParser('diff', '')(diffOf(lines, terminator))][0]

  it('carries no message of its own, so the configured one becomes the whole message', () => {
    const input = diffOf([...header, '-int  a=0;', '+int a = 0;'])
    expect([...getKnownParser('diff', 'Run clang-format')(input)][0].msg).toBe('Run clang-format')
    expect([...getKnownParser('diff', '')(input)][0].msg).toBeUndefined()
  })

  it('appends the configured message to the message a parser produces on its own', () => {
    expect([...getKnownParser('flake8', 'Fix it')('a.py:1:1: E1 Bad')][0].msg).toBe('Bad Fix it')
    expect([...getRegexParser(/^(?<msg>.+)$/gm, 'Fix it')('Bad')][0].msg).toBe('Bad Fix it')
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

  it('distinguishes blanking a line from deleting it, extending it to the preceding line', () => {
    expect(firstIssue(['diff --git a/a.c b/a.c', '--- a/a.c', '+++ b/a.c', '@@ -5,3 +5,3 @@', ' int a = 0;', '-    ', '+', ' return a;'])).toMatchObject({
      line: 5,
      eline: 6,
      fix: ['int a = 0;', '']
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

  it('keeps the marker of a file not ending with a newline out of the fix', () => {
    expect(firstIssue([...header, '-int  a=0;', '\\ No newline at end of file', '+int a = 0;'])).toMatchObject({
      line: 1,
      eline: 1,
      fix: ['int a = 0;', '']
    })
  })

  it('suggests a trailing empty line for a terminator added at the end of a file', () => {
    expect(firstIssue([...header, '-int a = 0;', '\\ No newline at end of file', '+int a = 0;'])).toMatchObject({
      line: 1,
      eline: 1,
      fix: ['int a = 0;', '']
    })
  })

  it('reports a terminator removed at the end of a file without a fix', () => {
    const issue = firstIssue([...header, '-int a = 0;', '+int a = 0;', '\\ No newline at end of file'])
    expect(issue).toMatchObject({ line: 1, eline: 1 })
    expect(issue).not.toHaveProperty('fix')
  })

  it('adds no trailing empty line when neither side of the change ends with a newline', () => {
    expect(firstIssue([...header, '-int  a=0;', '\\ No newline at end of file', '+int a = 0;', '\\ No newline at end of file'])).toMatchObject({
      line: 1,
      eline: 1,
      fix: ['int a = 0;']
    })
  })

  it('extends a blanked line at the top of a file to the following line', () => {
    expect(firstIssue(['diff --git a/a.c b/a.c', '--- a/a.c', '+++ b/a.c', '@@ -1,2 +1,2 @@', '-    ', '+', ' int a = 0;'])).toMatchObject({
      line: 1,
      eline: 2,
      fix: ['', 'int a = 0;']
    })
  })

  it('reports a blanked line with no line to extend to without a fix', () => {
    const issue = firstIssue(['diff --git a/a.c b/a.c', '--- a/a.c', '+++ b/a.c', '@@ -1,1 +1,1 @@', '-    ', '+'])
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

describe('prDiff', () => {
  const decode = (data: unknown): string => _testExports.decodeDiff(data)

  it('passes through a diff returned as text', () => {
    expect(decode('diff --git a/a.c b/a.c')).toBe('diff --git a/a.c b/a.c')
  })

  it('decodes a diff returned as a buffer, which happens when the content type is not recognised as text', () => {
    const bytes = new TextEncoder().encode('diff --git a/a.c b/a.c')
    expect(decode(bytes.buffer)).toBe('diff --git a/a.c b/a.c')
    expect(decode(bytes)).toBe('diff --git a/a.c b/a.c')
  })

  it('fails loudly on a diff that is neither, rather than matching every issue against nothing', () => {
    expect(() => decode({ message: 'Not Found' })).toThrow('returned as object rather than text')
  })

  it('rejects a non-empty diff that yields no file, which a decoded response cannot rule out', () => {
    expect(() => parseDiffLines('<html><body>Proxy Error</body></html>')).toThrow('no file could be parsed from it')
    expect(() => parseDiffLines('')).not.toThrow()
    expect(() => parseDiffLines('diff --git a/a.c b/a.c\ndeleted file mode 100644\n--- a/a.c\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-int a;\n')).not.toThrow()
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
