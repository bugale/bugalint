import type { Log, ReportingDescriptor, Result } from 'sarif'
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

function* parseSarif(input: string): Generator<Issue> {
  const log: Log = JSON.parse(input)
  for (const run of log.runs) {
    if (run.results == null) {
      continue
    }
    for (const issue of run.results) {
      yield {
        id: issue.ruleId,
        sym: issue.ruleIndex != null ? run.tool.driver.rules?.[issue.ruleIndex]?.name : undefined,
        msg: issue.message.text,
        level: issue.level,
        path: issue.locations?.[0]?.physicalLocation?.artifactLocation?.uri,
        line: issue.locations?.[0]?.physicalLocation?.region?.startLine,
        col: issue.locations?.[0]?.physicalLocation?.region?.startColumn,
        eline: issue.locations?.[0]?.physicalLocation?.region?.endLine,
        ecol: issue.locations?.[0]?.physicalLocation?.region?.endColumn
      }
    }
  }
}

const knownParsers: Record<string, Parser> = {
  pylint: parsePylint,
  sarif: parseSarif,
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

export function generateSarif(issues: Iterable<Issue>, identifier: string, analysisPath: string): Log {
  const rulesIndices: Record<string, number> = {}
  const rules: ReportingDescriptor[] = []
  const results: Result[] = []

  for (const issue of issues) {
    if (issue.sym != null && issue.id != null && rulesIndices[issue.id] == null) {
      rulesIndices[issue.id] = rules.length
      rules.push({ id: issue.id, name: issue.sym })
    }
    results.push({
      message: { text: issue.msg ?? undefined },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: issue.path != null ? normalizePath(issue.path, analysisPath) : undefined },
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

export function getKnownParser(identifier: string): Parser {
  const parser = knownParsers[identifier]
  if (parser == null) {
    throw new Error(`Unrecognized: ${identifier}`)
  }
  return parser
}

export function getRegexParser(regex: RegExp, levelMap?: Record<string, Result.level>): Parser {
  return (input: string) => parseRegex(input, regex, levelMap)
}

export async function addComments(
  issues: Iterable<Issue>,
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

  const prDiff = (await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber, mediaType: { format: 'diff' } })).data as unknown as string
  const linesSet: Record<string, Record<number, boolean>> = {}
  for (const file of parseDiff(prDiff)) {
    if (file.to == null) {
      continue
    }
    debug(`PR file diff: ${file.to} (${file.chunks.length} chunks)`)
    linesSet[file.to] = {}
    for (const chunk of file.chunks) {
      for (const change of chunk.changes) {
        if (change.type === 'add') {
          linesSet[file.to][change?.ln] = true
        }
      }
    }
  }
  debug(`linesSet: ${JSON.stringify(linesSet)}`)

  const comments = []
  for (const issue of issues) {
    debug(`Processing issue on ${issue.path}:${issue.line}`)
    if (issue.path == null || issue.line == null) {
      continue
    }

    const normalized = normalizePath(issue.path, analysisPath)
    debug(`Normalized path: ${normalized}`)

    if (
      (() => {
        for (let line = issue.line; line <= (issue.eline ?? issue.line); line++) {
          if (!linesSet?.[normalized]?.[line]) {
            return true
          }
        }
        return false
      })()
    ) {
      debug(`Skipping issue on ${normalized}:${issue.line} because it's not in the PR diff`)
      continue
    }
    if (comments.length >= 50) {
      warning('More than 50 comments detected. Only the first 50 will be posted.')
      break
    }

    const endLine = issue.eline ?? issue.line
    const args = {
      path: normalized,
      side: 'RIGHT',
      start_side: 'RIGHT',
      line: endLine,
      start_line: endLine === issue.line ? undefined : issue.line,
      body: `${commentTag}\n**${issue.msg}**\n[${[issue.level, identifier, issue.id, issue.sym].filter((n) => n).join(':')}]`
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
  normalizePath
}
