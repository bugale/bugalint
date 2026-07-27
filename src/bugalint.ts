import type { Log, Region, ReportingDescriptor, Result } from 'sarif'
import { getOctokit } from '@actions/github'
import { debug, warning, summary } from '@actions/core'
import path from 'path'
import parseDiff from 'parse-diff'
import type { SummaryTableRow } from '@actions/core/lib/summary'

interface Issue {
  id?: string
  sym?: string
  msg?: string
  level?: Result.level
  path?: string
  line?: number
  col?: number
  eline?: number
  ecol?: number
  fix?: string[]
}

export type Parser = (input: string) => Generator<Issue>

function* parseRegex(input: string, regex: RegExp, levelMap?: Record<string, Result.level>): Generator<Issue> {
  for (const match of input.matchAll(regex)) {
    const groups = match.groups ?? {}
    yield {
      id: groups.id,
      sym: groups.sym,
      msg: groups.msg,
      level: levelMap == null ? (groups.level as Result.level) : levelMap[groups.level],
      path: groups.path,
      line: groups.line != null ? parseInt(groups.line) : undefined,
      col: groups.col != null ? parseInt(groups.col) : undefined,
      eline: groups.eline != null ? parseInt(groups.eline) : undefined,
      ecol: groups.ecol != null ? parseInt(groups.ecol) : undefined
    }
  }
}

function* parsePylint(input: string): Generator<Issue> {
  const levelMap: Record<string, Result.level> = {
    convention: 'note',
    usage: 'note',
    refactor: 'note',
    warning: 'warning',
    error: 'error'
  }
  for (const issue of JSON.parse(input)) {
    yield {
      id: issue['message-id'],
      sym: issue.symbol,
      msg: issue.message,
      level: levelMap[issue.type],
      path: issue.path,
      line: issue.line,
      col: issue.column != null ? issue.column + 1 : undefined,
      eline: issue.endLine,
      ecol: issue.endColumn != null ? issue.endColumn + 1 : undefined
    }
  }
}

function parseSarifFix(result: Result, region?: Region): string[] | undefined {
  const replacement = result.fixes?.[0]?.artifactChanges?.[0]?.replacements?.[0]
  const text = replacement?.insertedContent?.text
  if (replacement == null || text == null || region?.startLine == null) {
    return undefined
  }
  const deleted = replacement.deletedRegion
  const endLine = region.endLine ?? region.startLine
  if (deleted.startLine !== region.startLine || (deleted.startColumn ?? 1) !== 1) {
    return undefined
  }
  if (deleted.endColumn == null) {
    return (deleted.endLine ?? deleted.startLine) === endLine ? (text === '' ? [] : text.split('\n')) : undefined
  }
  return deleted.endColumn === 1 && deleted.endLine === endLine + 1 ? (text === '' ? [] : text.replace(/\n$/, '').split('\n')) : undefined
}

function* parseSarif(input: string): Generator<Issue> {
  const log: Log = JSON.parse(input)
  for (const run of log.runs) {
    if (run.results == null) {
      continue
    }
    for (const issue of run.results) {
      const region = issue.locations?.[0]?.physicalLocation?.region
      yield {
        id: issue.ruleId,
        sym: issue.ruleIndex != null ? run.tool.driver.rules?.[issue.ruleIndex]?.name : undefined,
        msg: issue.message.text,
        level: issue.level,
        path: issue.locations?.[0]?.physicalLocation?.artifactLocation?.uri,
        line: region?.startLine,
        col: region?.startColumn,
        eline: region?.endLine,
        ecol: region?.endColumn,
        fix: parseSarifFix(issue, region)
      }
    }
  }
}

function normalizeDiffLineEndings(diff: string): string {
  return /^(?:diff --git |@@ ).*\r$/m.test(diff) ? diff.replace(/\r\n/g, '\n') : diff
}

function borrowNeighbor(
  changes: parseDiff.Change[],
  start: number,
  end: number,
  fix: string[],
  range?: Pick<Issue, 'line' | 'eline'>
): Pick<Issue, 'line' | 'eline' | 'fix'> | undefined {
  const before = changes[start - 1]
  const after = changes[end]
  if (before?.type === 'normal') {
    return { line: before.ln1, eline: range?.eline ?? before.ln1, fix: [before.content.slice(1), ...fix] }
  }
  if (after?.type === 'normal') {
    return { line: range?.line ?? after.ln1, eline: after.ln1, fix: [...fix, after.content.slice(1)] }
  }
  return undefined
}

function* parseFormatDiff(input: string): Generator<Issue> {
  for (const file of parseDiff(normalizeDiffLineEndings(input))) {
    const filePath = file.from ?? file.to
    if (filePath == null) {
      continue
    }
    for (const chunk of file.chunks) {
      const changes = chunk.changes.filter((change) => !change.content.startsWith('\\'))
      let index = 0
      while (index < changes.length) {
        const start = index
        const deleted: parseDiff.DeleteChange[] = []
        const inserted: string[] = []
        while (index < changes.length) {
          const change = changes[index]
          if (change.type !== 'del') {
            break
          }
          deleted.push(change)
          index++
        }
        while (index < changes.length) {
          const change = changes[index]
          if (change.type !== 'add') {
            break
          }
          inserted.push(change.content.slice(1))
          index++
        }
        let location: Pick<Issue, 'line' | 'eline' | 'fix'> | undefined
        if (deleted.length > 0) {
          const line = deleted[0].ln
          const eline = deleted[deleted.length - 1].ln
          const removed = deleted.map((change) => change.content.slice(1))
          if (removed.length === inserted.length && removed.every((content, offset) => content === inserted[offset])) {
            location = { line, eline }
          } else if (inserted.length === 1 && inserted[0] === '') {
            location = borrowNeighbor(changes, start, index, inserted, { line, eline }) ?? { line, eline }
          } else {
            location = { line, eline, fix: inserted }
          }
        } else if (inserted.length > 0) {
          location = borrowNeighbor(changes, start, index, inserted)
        } else {
          index++
        }
        if (location != null) {
          yield { level: 'warning', path: filePath, ...location }
        }
      }
    }
  }
}

const knownParsers: Record<string, Parser> = {
  pylint: parsePylint,
  sarif: parseSarif,
  diff: parseFormatDiff,
  mypy: (input: string) =>
    parseRegex(
      input,
      /^(?<path>[^:\n]+):(?:(?<line>\d+):)?(?:(?<col>\d+):)?(?:(?<eline>\d+):)?(?:(?<ecol>\d+):)? (?<level>[^:\s]+): (?<msg>.+?)\s*(?:\[(?<id>\S+)\])?$/gm
    ),
  flake8: (input: string) => parseRegex(input, /^(?<path>[^:\n]+):(?<line>\d+):(?<col>\d+): (?<id>\w\d+) (?<msg>[^\n]+)$/gm),
  mdl: (input: string) => parseRegex(input, /^(?<path>[^:\n]+)(?::(?<line>\d+))?(?::(?<col>\d+))? (?<id>[^/\n]+)\/(?<sym>[^\s]+) (?<msg>[^\n]+)$/gm),
  yamllint: (input: string) => parseRegex(input, /^(?<path>[^:\n]+):(?<line>\d+):(?<col>\d+): \[(?<level>[^\n\]]+)\] (?<msg>[^\n]+) \((?<id>[^\n)]+)\)$/gm),
  ghalint: (input: string) =>
    parseRegex(input, /^(?=.*\berror="(?<msg>[^\n=]*)")(?=.*\bpolicy_name=(?<sym>[^\s=\n]*))(?=.*\bworkflow_file_path=(?<path>[^\s=\n]*))[^\n]*$/gm)
}

function normalizePath(givenPath: string, analysisPath: string): string {
  const fileUrlPrefix = 'file:///'
  if (givenPath.startsWith(fileUrlPrefix)) {
    givenPath = givenPath.slice(fileUrlPrefix.length)
  }
  analysisPath = analysisPath.replace(/\\/g, '/')
  givenPath = givenPath.replace(/\\/g, '/')
  if (path.isAbsolute(givenPath)) {
    return path.relative('.', givenPath).replace(/\\/g, '/')
  }
  return path.relative('.', path.join(analysisPath, givenPath)).replace(/\\/g, '/')
}

function* appendMessage(issues: Generator<Issue>, message: string): Generator<Issue> {
  for (const issue of issues) {
    const msg = [issue.msg, message].filter((part) => part != null && part !== '').join(' ')
    yield { ...issue, msg: msg === '' ? undefined : msg }
  }
}

export function generateSarif(issues: Iterable<Issue>, identifier: string, analysisPath: string): Log {
  const rulesIndices: Record<string, number> = {}
  const rules: ReportingDescriptor[] = []
  const results: Result[] = []

  for (const issue of issues) {
    if (issue.sym != null && issue.id != null && rulesIndices[issue.id] == null) {
      rulesIndices[issue.id] = rules.length
      rules.push({ id: issue.id, name: issue.sym })
    }
    const uri = issue.path != null ? normalizePath(issue.path, analysisPath) : undefined
    results.push({
      message: { text: issue.msg ?? '' },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri },
            region:
              issue.line != null || issue.col != null || issue.eline != null || issue.ecol != null
                ? {
                    startLine: issue.line ?? undefined,
                    startColumn: issue.col ?? undefined,
                    endLine: issue.eline ?? undefined,
                    endColumn: issue.ecol ?? undefined
                  }
                : undefined
          }
        }
      ],
      fixes:
        issue.fix != null && uri != null && issue.line != null
          ? [
              {
                artifactChanges: [
                  {
                    artifactLocation: { uri },
                    replacements: [
                      {
                        deletedRegion: { startLine: issue.line, startColumn: 1, endLine: (issue.eline ?? issue.line) + 1, endColumn: 1 },
                        insertedContent: { text: issue.fix.map((line) => `${line}\n`).join('') }
                      }
                    ]
                  }
                ]
              }
            ]
          : undefined,
      level: issue.level ?? undefined,
      ruleId: issue.id ?? issue.sym ?? undefined,
      ruleIndex: issue.id != null ? rulesIndices[issue.id] : undefined
    })
  }
  return {
    version: '2.1.0',
    $schema: 'http://json.schemastore.org/sarif-2.1.0-rtm.6',
    runs: [{ tool: { driver: { name: identifier, rules } }, results }]
  }
}

export function getKnownParser(identifier: string, message: string): Parser {
  const parser = knownParsers[identifier]
  if (parser == null) {
    throw new Error(`Unrecognized: ${identifier}`)
  }
  return (input: string) => appendMessage(parser(input), message)
}

export function getRegexParser(regex: RegExp, message: string, levelMap?: Record<string, Result.level>): Parser {
  return (input: string) => appendMessage(parseRegex(input, regex, levelMap), message)
}

function buildCommentBody(commentTag: string, identifier: string, issue: Issue): string {
  const identifiers = `[${[issue.level, identifier, issue.id, issue.sym].filter((n) => n).join(':')}]`
  const body = `${commentTag}\n${[issue.msg != null && issue.msg !== '' ? `**${issue.msg}**` : undefined, identifiers].filter((n) => n).join('\n')}`
  if (issue.fix == null || (issue.fix.length === 1 && issue.fix[0] === '')) {
    return body
  }
  const fence = '`'.repeat(Math.max(3, ...Array.from(issue.fix.join('\n').matchAll(/`+/g), (m) => m[0].length + 1)))
  return `${body}\n${fence}suggestion\n${issue.fix.map((line) => `${line}\n`).join('')}${fence}`
}

export async function addComments(
  issues: Iterable<Issue>,
  prDiff: string,
  githubToken: string,
  identifier: string,
  owner: string,
  repo: string,
  prNumber: number,
  analysisPath: string
): Promise<void> {
  /* eslint camelcase: ["error", {allow: ['^pull_number$', '^comment_id$', '^start_side$', '^start_line$']}] */
  const octokit = getOctokit(githubToken)

  debug('Deleting old comments')
  const commentTag = `<!-- bugale/bugalint ${identifier} -->`
  for await (const { data: comments } of octokit.paginate.iterator(octokit.rest.pulls.listReviewComments, { owner, repo, pull_number: prNumber })) {
    for (const c of comments) {
      if (c?.id != null && c?.body?.includes(commentTag)) {
        debug(`Deleting comment ${c?.id}`)
        await octokit.rest.pulls.deleteReviewComment({ owner, repo, comment_id: c?.id })
      }
    }
  }

  const diffLines = parseDiffLines(prDiff)

  const comments = []
  for (const issue of issues) {
    debug(`Processing issue on ${issue.path}:${issue.line}`)
    if (!isCommentableIssue(issue, diffLines, analysisPath)) {
      debug(`Skipping issue on ${issue.path}:${issue.line} because it is not on lines the pull request diff shows`)
      continue
    }
    if (comments.length >= 50) {
      warning('More than 50 comments detected. Only the first 50 will be posted.')
      break
    }

    const endLine = issue.eline ?? issue.line
    const args = {
      path: normalizePath(issue.path, analysisPath),
      side: 'RIGHT',
      start_side: 'RIGHT',
      line: endLine,
      start_line: endLine === issue.line ? undefined : issue.line,
      body: buildCommentBody(commentTag, identifier, issue)
    }
    debug(`Generating comment ${JSON.stringify(args)}`)
    comments.push(args)
  }
  if (comments.length === 0) {
    debug('No comments to post')
    return
  }
  debug('Sending comments')
  await octokit.rest.pulls.createReview({ owner, repo, pull_number: prNumber, event: 'COMMENT', comments })
  debug('Sent comments')
}

export type DiffLines = Record<string, Record<number, boolean>>

function decodeDiff(data: unknown): string {
  if (typeof data === 'string') {
    return data
  }
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data)
  }
  throw new Error(`The pull request diff was returned as ${typeof data} rather than text, so no issue can be matched against the pull request`)
}

export async function getPrDiff(githubToken: string, owner: string, repo: string, prNumber: number): Promise<string> {
  const octokit = getOctokit(githubToken)
  return decodeDiff((await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber, mediaType: { format: 'diff' } })).data)
}

export function parseDiffLines(diff: string): DiffLines {
  const diffLines: DiffLines = {}
  for (const file of parseDiff(diff)) {
    if (file.to == null) {
      continue
    }
    debug(`PR file diff: ${file.to} (${file.chunks.length} chunks)`)
    diffLines[file.to] = {}
    for (const chunk of file.chunks) {
      for (const change of chunk.changes) {
        if (change.type === 'add') {
          diffLines[file.to][change.ln] = true
        } else if (change.type === 'normal') {
          diffLines[file.to][change.ln2] = false
        }
      }
    }
  }
  debug(`diffLines: ${JSON.stringify(diffLines)}`)
  return diffLines
}

function issueLines(line: number, eline?: number): number[] {
  return Array.from({ length: (eline ?? line) - line + 1 }, (_, offset) => line + offset)
}

export function isNewIssue(issue: Issue, diffLines: DiffLines, analysisPath: string): issue is Issue & Required<Pick<Issue, 'path' | 'line'>> {
  if (issue.path == null || issue.line == null) {
    return false
  }
  const lines: Record<number, boolean> | undefined = diffLines[normalizePath(issue.path, analysisPath)]
  return issueLines(issue.line, issue.eline).some((line) => lines?.[line] ?? false)
}

export function isCommentableIssue(issue: Issue, diffLines: DiffLines, analysisPath: string): issue is Issue & Required<Pick<Issue, 'path' | 'line'>> {
  if (!isNewIssue(issue, diffLines, analysisPath)) {
    return false
  }
  const lines: Record<number, boolean> | undefined = diffLines[normalizePath(issue.path, analysisPath)]
  return issueLines(issue.line, issue.eline).every((line) => lines?.[line] != null)
}

export function filterNewIssues(issues: Iterable<Issue>, prDiff: string, analysisPath: string): Issue[] {
  const diffLines = parseDiffLines(prDiff)
  return [...issues].filter((issue) => isNewIssue(issue, diffLines, analysisPath))
}

export function failOnIssues(issues: Iterable<Issue>, toolName: string): void {
  const failing = [...issues]
  if (failing.length > 0) {
    throw new Error(`${toolName} found ${failing.length} issues`)
  }
}

export async function createSummary(issues: Iterable<Issue>, identifier: string, analysisPath: string): Promise<void> {
  const table: SummaryTableRow[] = [
    [
      { data: 'Location', header: true },
      { data: 'Message', header: true },
      { data: 'Identifier', header: true }
    ]
  ]
  for (const issue of issues) {
    const normalized = `<b>${normalizePath(issue.path ?? '?', analysisPath)}</b>`
    table.push([
      `${[normalized, issue.line, issue.col, issue.eline, issue.ecol].filter((n) => n).join(':')}`,
      issue.msg ?? '',
      [issue.level, issue.id, issue.sym].filter((n) => n).join(':')
    ])
  }
  if (table.length > 1) {
    summary.addHeading(`${identifier} Analysis Found Issues ❌`)
    summary.addTable(table)
  } else {
    summary.addHeading(`${identifier} Analysis Did Not Find Issues ✅`)
  }
  await summary.write()
}

export const _testExports = {
  normalizePath,
  buildCommentBody,
  decodeDiff
}
