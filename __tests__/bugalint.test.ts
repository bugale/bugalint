import '@microsoft/jest-sarif'
import { readFileSync } from 'fs'
import { generateSarif, getKnownParser, getRegexParser, type Parser } from '../src/bugalint'

describe('fullConversion', () => {
  it.each([
    ['mypy', getKnownParser('mypy'), '.'],
    ['pylint', getKnownParser('pylint'), '.'],
    ['flake8', getKnownParser('flake8'), '.'],
    ['mdl', getKnownParser('mdl'), '.'],
    ['sarif', getKnownParser('sarif'), '.'],
    ['flake8subpath', getKnownParser('flake8'), 'A\\B'],
    [
      'custom',
      getRegexParser(
        /^(?<path>[^-\n]+)(?:-(?<line>\d+))?(?:-(?<col>\d+))?(?:-(?<eline>\d+))?(?:-(?<ecol>\d+))? (?<level>[^:\s]+):(?<id>[^:\s]+):(?<sym>[^:\s]+) (?<msg>.+)$/gm,
        { err: 'error', warn: 'warning', info: 'note' }
      ),
      '.'
    ]
  ])('%s', (name: string, parser: Parser, analysisPath: string) => {
    const input = readFileSync(`__tests__/${name}.input.txt`, 'utf-8')
    const output = readFileSync(`__tests__/${name}.output.json`, 'utf-8')
    const result = generateSarif(parser(input), 'test', analysisPath)
    expect(result).toBeValidSarifLog()
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(JSON.parse(output))
  })
})
