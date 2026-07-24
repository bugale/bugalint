import { readFileSync, writeFileSync } from 'fs'
import type { Result } from 'sarif'
import { context } from '@actions/github'
import { getInput, getBooleanInput, debug, info, setFailed } from '@actions/core'
import { generateSarif, getKnownParser, getRegexParser, getPrDiff, addComments, createSummary, failOnIssues, type Parser } from '../src/bugalint'

export async function run(): Promise<void> {
  try {
    const inputFile: string = getInput('inputFile')
    const sarif: string = getInput('sarif')
    const comment: boolean = getBooleanInput('comment')
    const summary: boolean = getBooleanInput('summary')
    const fail: boolean = getBooleanInput('fail')
    const failOnlyNew: boolean = getBooleanInput('failOnlyNew')
    const toolName: string = getInput('toolName')
    const inputFormat: string = getInput('inputFormat')
    const inputRegex: string = getInput('inputRegex')
    const levelMap: string = getInput('levelMap')
    const analysisPath: string = getInput('analysisPath')
    const githubToken: string = getInput('githubToken')

    const parser: Parser =
      inputFormat === ''
        ? getRegexParser(new RegExp(inputRegex, 'gm'), levelMap === '' ? undefined : (JSON.parse(levelMap) as Record<string, Result.level>))
        : getKnownParser(inputFormat)
    const input = readFileSync(inputFile, 'utf-8').replace(/\r/g, '')
    debug(`input: ${input}`)
    const output = generateSarif(parser(input), toolName, analysisPath)
    info(`SARIF output: ${JSON.stringify(output, null, 2)}`)
    if (sarif !== '') {
      writeFileSync(sarif, JSON.stringify(output))
    }
    let prDiff: string | undefined
    if (comment || (fail && failOnlyNew)) {
      const prNumber = context.payload.pull_request?.number
      if (prNumber == null) {
        throw new Error('No pull request number found.')
      }
      prDiff = await getPrDiff(githubToken, context.repo.owner, context.repo.repo, prNumber)
      if (comment) {
        await addComments(parser(input), prDiff, githubToken, toolName, context.repo.owner, context.repo.repo, prNumber, analysisPath)
      }
    }
    if (summary) {
      await createSummary(parser(input), toolName, analysisPath)
    }
    if (fail) {
      failOnIssues(parser(input), toolName, analysisPath, failOnlyNew ? prDiff : undefined)
    }
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message)
    }
  }
}

void run().finally((): void => {})
