import type { Log, ReportingDescriptor, Result } from 'sarif'

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

const knownParsers: Record<string, Parser> = {
  pylint: parsePylint,
  mypy: (input: string) =>
    parseRegex(
      input,
      /^(?<path>[^:\n]+):(?:(?<line>\d+):)?(?:(?<col>\d+):)?(?:(?<eline>\d+):)?(?:(?<ecol>\d+):)? (?<level>[^:\s]+): (?<msg>.+?)\s*(?:\[(?<id>\S+)\])?$/gm
    ),
  flake8: (input: string) => parseRegex(input, /^(?<path>[^:\n]+):(?<line>\d+):(?<col>\d+): (?<id>\w\d+) (?<msg>.+)$/gm),
  mdl: (input: string) => parseRegex(input, /^(?<path>[^:\n]+)(?::(?<line>\d+))?(?::(?<col>\d+))? (?<id>[^//n]+)\/(?<sym>[^\s]+) (?<msg>.+)$/gm)
}

function normalizePath(path: string): string {
  return path.replace(/^\.[\\/]/gm, '') // Remove leading "./" or ".\", since GitHub doesn't accept it
}

function generateSarif(issues: Iterable<Issue>, name: string): Log {
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
            artifactLocation: { uri: issue.path != null ? normalizePath(issue.path) : undefined },
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
    runs: [{ tool: { driver: { name, rules } }, results }]
  }
}

export function getKnownParser(name: string): Parser {
  const parser = knownParsers[name]
  if (parser == null) {
    throw new Error(`Unrecognized: ${name}`)
  }
  return parser
}

export function getRegexParser(regex: RegExp, levelMap?: Record<string, Result.level>): Parser {
  return (input: string) => parseRegex(input, regex, levelMap)
}

export function convert(parser: Parser, input: string, name: string): Log {
  return generateSarif(parser(input), name)
}
