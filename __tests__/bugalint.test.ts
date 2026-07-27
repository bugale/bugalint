import '@microsoft/jest-sarif'
import { readFileSync } from 'fs'
import type { Region } from 'sarif'
import { generateSarif, getKnownParser, getRegexParser, parseAddedLines, isNewIssue, failOnIssues, _testExports, type Parser } from '../src/bugalint'

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
  const addedLines = parseAddedLines(diff)

  it('collects added line numbers per file', () => {
    expect(addedLines).toStrictEqual({ 'A/B/test.py': { 2: true, 3: true } })
  })

  it('accepts issues contained in added lines', () => {
    expect(isNewIssue({ path: 'A/B/test.py', line: 2 }, addedLines, '.')).toBe(true)
    expect(isNewIssue({ path: 'A/B/test.py', line: 2, eline: 3 }, addedLines, '.')).toBe(true)
    expect(isNewIssue({ path: 'test.py', line: 3 }, addedLines, 'A\\B')).toBe(true)
  })

  it('rejects issues not fully contained in added lines', () => {
    expect(isNewIssue({ path: 'A/B/test.py', line: 1 }, addedLines, '.')).toBe(false)
    expect(isNewIssue({ path: 'A/B/test.py', line: 1, eline: 2 }, addedLines, '.')).toBe(false)
    expect(isNewIssue({ path: 'A/B/other.py', line: 2 }, addedLines, '.')).toBe(false)
    expect(isNewIssue({ line: 2 }, addedLines, '.')).toBe(false)
    expect(isNewIssue({ path: 'A/B/test.py' }, addedLines, '.')).toBe(false)
  })

  describe('failOnIssues', () => {
    it('does nothing when no issues are found', () => {
      expect(() => {
        failOnIssues([], 'test', '.')
      }).not.toThrow()
    })

    it('throws when issues are found', () => {
      expect(() => {
        failOnIssues([{ path: 'a.py', line: 1 }, { msg: 'x' }], 'test', '.')
      }).toThrow('test found 2 issues')
    })

    it('throws only on new issues when a diff is given', () => {
      const issues = [
        { path: 'A/B/test.py', line: 1 },
        { path: 'A/B/test.py', line: 2 }
      ]
      expect(() => {
        failOnIssues(issues, 'test', '.', diff)
      }).toThrow('test found 1 issues')
    })

    it('does nothing when a diff is given and all issues are old', () => {
      expect(() => {
        failOnIssues([{ path: 'A/B/test.py', line: 1 }], 'test', '.', diff)
      }).not.toThrow()
    })
  })
})

describe('commentBody', () => {
  const tag = '<!-- bugale/bugalint test -->'
  const header = `${tag}\n**Message**\n[warning:test]`
  const issue = { level: 'warning' as const, msg: 'Message' }
  const body = (fix?: string): string => _testExports.buildCommentBody(tag, 'test', fix === undefined ? issue : { ...issue, fix })

  it('omits the suggestion when the issue has no fix', () => {
    expect(body()).toBe(header)
  })

  it('appends the suggestion after the identifier line', () => {
    expect(body('x = 1')).toBe(`${header}\n\`\`\`suggestion\nx = 1\n\`\`\``)
  })

  it('keeps a multi line fix verbatim', () => {
    expect(body('def f():\n    return 1')).toBe(`${header}\n\`\`\`suggestion\ndef f():\n    return 1\n\`\`\``)
  })

  it('renders an empty fix as an empty suggestion, which deletes the lines', () => {
    expect(body('')).toBe(`${header}\n\`\`\`suggestion\n\`\`\``)
  })

  it('preserves a trailing newline, which keeps a trailing empty line', () => {
    expect(body('x = 1\n')).toBe(`${header}\n\`\`\`suggestion\nx = 1\n\n\`\`\``)
  })

  it('uses a fence longer than the longest backtick run in the fix', () => {
    expect(body('doc = "```"')).toBe(`${header}\n\`\`\`\`suggestion\ndoc = "\`\`\`"\n\`\`\`\``)
  })
})

describe('sarifFix', () => {
  const fixOf = (region: Region, deletedRegion: Region, text: string): string | undefined => {
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
    expect(fixOf({ startLine: 3, endLine: 4 }, { startLine: 3, endLine: 4 }, 'a\nb')).toBe('a\nb')
    expect(fixOf({ startLine: 3 }, { startLine: 3 }, 'a')).toBe('a')
  })

  it('drops the line terminator of a region ending at the beginning of the following line', () => {
    expect(fixOf({ startLine: 3, endLine: 4 }, { startLine: 3, startColumn: 1, endLine: 5, endColumn: 1 }, 'a\nb\n')).toBe('a\nb')
    expect(fixOf({ startLine: 3 }, { startLine: 3, startColumn: 1, endLine: 4, endColumn: 1 }, 'a\n')).toBe('a')
  })

  it('keeps a trailing empty line of both forms', () => {
    expect(fixOf({ startLine: 3, endLine: 4 }, { startLine: 3, endLine: 4 }, 'a\nb\n')).toBe('a\nb\n')
    expect(fixOf({ startLine: 3, endLine: 4 }, { startLine: 3, startColumn: 1, endLine: 5, endColumn: 1 }, 'a\nb\n\n')).toBe('a\nb\n')
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

describe('windowsFileUrl', () => {
  if (process.platform === 'win32') {
    it('should convert Windows file URLs to relative URLs', () => {
      process.chdir('C:\\')
      expect(_testExports.normalizePath('file:///C:/a/test.txt', 'C:\\')).toBe('a/test.txt')
      expect(_testExports.normalizePath('file:///C:/a/test.txt', '.')).toBe('a/test.txt')
    })
  }
})
