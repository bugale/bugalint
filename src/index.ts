import { readFileSync, writeFileSync } from 'fs'
import { context } from '@actions/github'
import { getInput, getBooleanInput, debug, setFailed } from '@actions/core'
import { generateSarif, getKnownParser, getRegexParser, addComments, createSummary, type Parser } from '../src/bugalint'

export async function run(): Promise<void> {
  try {
    const inputFile: string = getInput('inputFile')
    const sarif: boolean = getBooleanInput('sarif')
    const comment: boolean = getBooleanInput('comment')
    const summary: boolean = getBooleanInput('summary')
    const outputFile: string = getInput('outputFile')
    const toolName: string = getInput('toolName')
    const inputFormat: string = getInput('inputFormat')
    const inputRegex: string = getInput('inputRegex')
    const levelMap: string = getInput('levelMap')
    const analysisPath: string = getInput('analysisPath')
    const githubToken: string = getInput('githubToken')

    const parser: Parser =
      inputFormat === '' ? getRegexParser(new RegExp(inputRegex, 'gm'), levelMap === '' ? undefined : JSON.parse(levelMap)) : getKnownParser(inputFormat)
    const input = readFileSync(inputFile, 'utf-8').replace(/\r/g, '')
    debug(`input: ${input}`)
    if (sarif) {
      const output = generateSarif(parser(input), toolName, analysisPath)
      debug(`SARIF output: ${JSON.stringify(output, null, 2)}`)
      writeFileSync(outputFile, JSON.stringify(output))
    }
    if (comment) {
      const prNumber = context.payload.pull_request?.number
      if (prNumber == null) {
        throw new Error('No pull request number found.')
      }
      await addComments(parser(input), githubToken, toolName, context.repo.owner, context.repo.repo, prNumber, analysisPath)
    }
    if (summary) {
      await createSummary(parser(input), toolName, analysisPath)
    }
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message)
    }
  }
}

void run().finally((): void => {})
