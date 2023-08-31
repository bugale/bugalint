import '@microsoft/jest-sarif'
import { readFileSync } from 'fs'
import { convert, getKnownParser, getRegexParser, type Parser } from '../src/bugalint'

describe('fullConversion', () => {
  it.each([
    ['mypy', undefined],
    ['pylint', undefined],
    ['flake8', undefined],
    ['mdl', undefined],
    [
      'custom',
      getRegexParser(
        /^(?<path>[^-\n]+)(?:-(?<line>\d+))?(?:-(?<col>\d+))?(?:-(?<eline>\d+))?(?:-(?<ecol>\d+))? (?<level>[^:\s]+):(?<id>[^:\s]+):(?<sym>[^:\s]+) (?<msg>.+)$/gm,
        { err: 'error', warn: 'warning', info: 'note' }
      )
    ]
  ])('%s', (name: string, parser?: Parser) => {
    const input = readFileSync(`__tests__/${name}.input.txt`, 'utf-8')
    const output = readFileSync(`__tests__/${name}.output.json`, 'utf-8')
    const result = convert(parser ?? getKnownParser(name), input, 'test')
    expect(result).toBeValidSarifLog()
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(JSON.parse(output))
  })
})
