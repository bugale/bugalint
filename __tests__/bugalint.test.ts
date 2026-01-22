import '@microsoft/jest-sarif'
import { readFileSync } from 'fs'
import { generateSarif, getKnownParser, getRegexParser, _testExports, type Parser } from '../src/bugalint'

describe('fullConversion', () => {
  it.each([
    ['mypy', getKnownParser('mypy'), '.'],
    ['pylint', getKnownParser('pylint'), '.'],
    ['flake8', getKnownParser('flake8'), '.'],
    ['mdl', getKnownParser('mdl'), '.'],
    ['yamllint', getKnownParser('yamllint'), '.'],
    ['ghalint', getKnownParser('ghalint'), '.'],
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
    const input = readFileSync(`__tests__/${name}.input.txt`, 'utf-8').replace(/\r/g, '')
    const output = readFileSync(`__tests__/${name}.output.json`, 'utf-8').replace(/\r/g, '')
    const result = generateSarif(parser(input), 'test', analysisPath)
    expect(result).toBeValidSarifLog()
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(JSON.parse(output))
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
