import { readFileSync, writeFileSync } from 'fs'
import type { Result } from 'sarif'
import { context } from '@actions/github'
import { getInput, getBooleanInput, debug, info, setFailed } from '@actions/core'
import {
  generateSarif,
  getKnownParser,
  getRegexParser,
  getDiffParser,
  getPrDiff,
  addComments,
  createSummary,
  failOnIssues,
  filterNewIssues,
  type Parser
} from '../src/bugalint'

function getParser(inputFormat: string, inputRegex: string, levelMap: string, message: string): Parser {
  if (inputFormat === '') {
    return getRegexParser(new RegExp(inputRegex, 'gm'), levelMap === '' ? undefined : (JSON.parse(levelMap) as Record<string, Result.level>))
  }
  if (inputFormat === 'diff') {
    return getDiffParser(message)
  }
  return getKnownParser(inputFormat)
}

export async function run(): Promise<void> {
  try {
    if (process.env.INPUT_FAILONLYNEW !== undefined) {
      throw new Error(
        'The `failOnlyNew` input was renamed to `onlyNew`, which now filters the SARIF, the log, the summary and the comments, not only the failure. ' +
          'Uploading a filtered SARIF to code scanning resolves the alerts of the unchanged code.'
      )
    }
    const inputFile: string = getInput('inputFile')
    const sarif: string = getInput('sarif')
    const comment: boolean = getBooleanInput('comment')
    const summary: boolean = getBooleanInput('summary')
    const fail: boolean = getBooleanInput('fail')
    const onlyNew: boolean = getBooleanInput('onlyNew')
    const toolName: string = getInput('toolName')
    const inputFormat: string = getInput('inputFormat')
    const inputRegex: string = getInput('inputRegex')
    const levelMap: string = getInput('levelMap')
    const analysisPath: string = getInput('analysisPath')
    const githubToken: string = getInput('githubToken')
    const message: string = getInput('message')

    const parser: Parser = getParser(inputFormat, inputRegex, levelMap, message)
    const raw = readFileSync(inputFile, 'utf-8')
    const input = inputFormat === 'diff' ? raw : raw.replace(/\r/g, '')
    debug(`input: ${input}`)

    const prNumber = context.payload.pull_request?.number
    let issues = [...parser(input)]
    let prDiff: string | undefined
    if (onlyNew) {
      if (prNumber == null) {
        throw new Error('No pull request number found.')
      }
      prDiff = await getPrDiff(githubToken, context.repo.owner, context.repo.repo, prNumber)
      issues = filterNewIssues(issues, prDiff, analysisPath)
    }

    const output = generateSarif(issues, toolName, analysisPath)
    info(`SARIF output: ${JSON.stringify(output, null, 2)}`)
    if (sarif !== '') {
      writeFileSync(sarif, JSON.stringify(output))
    }
    if (comment) {
      if (prNumber == null) {
        throw new Error('No pull request number found.')
      }
      prDiff ??= await getPrDiff(githubToken, context.repo.owner, context.repo.repo, prNumber)
      await addComments(issues, prDiff, githubToken, toolName, context.repo.owner, context.repo.repo, prNumber, analysisPath)
    }
    if (summary) {
      await createSummary(issues, toolName, analysisPath)
    }
    if (fail) {
      failOnIssues(issues, toolName)
    }
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message)
    }
  }
}

void run().finally((): void => {})
