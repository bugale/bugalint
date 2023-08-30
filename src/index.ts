import { readFileSync, writeFileSync } from 'fs'
import { getInput, getBooleanInput, info, setFailed } from '@actions/core'
import { convert, getKnownParser, getRegexParser, type Parser } from '../src/bugalint'

export function run(): void {
  try {
    const inputFile: string = getInput('inputFile')
    const outputFile: string = getInput('outputFile')
    const toolName: string = getInput('toolName')
    const inputFormat: string = getInput('inputFormat')
    const inputRegex: string = getInput('inputRegex')
    const levelMap: string = getInput('levelMap')
    const verbose: boolean = getBooleanInput('verbose')

    const parser: Parser =
      inputFormat === '' ? getRegexParser(new RegExp(inputRegex, 'gm'), levelMap === '' ? undefined : JSON.parse(levelMap)) : getKnownParser(inputFormat)
    const input = readFileSync(inputFile, 'utf-8')
    if (verbose) {
      info(`input: ${input}`)
    }
    const output = convert(parser, input, toolName)
    if (verbose) {
      info(`output: ${JSON.stringify(output, null, 2)}`)
    }
    writeFileSync(outputFile, JSON.stringify(output))
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message)
    }
  }
}

run()
