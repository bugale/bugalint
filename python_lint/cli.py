"""The CLI of python-lint"""

import sys
import argparse
import os
import subprocess
import re
import dataclasses
import tempfile
import asyncio
import logging
import json
from typing import Any, NoReturn, Optional

logger = logging.getLogger('python-lint')


@dataclasses.dataclass
class Issue:
    """An issue found by a linter"""
    file: Optional[str]
    line: Optional[str]
    col: Optional[str]
    code: Optional[str]
    text: Optional[str]
    source: str


@dataclasses.dataclass
class Linter:
    """A class representing a linter"""
    name: str
    cmdline: str
    regex: str

    async def lint(self, cmdline_args: dict[str, Any]) -> list[Issue]:
        """Run the linter and return a list of issues"""
        cmdline = self.cmdline.format(**cmdline_args)
        logger.debug(f'{self.name} cmdline: {cmdline}')
        proc = await asyncio.create_subprocess_shell(cmdline, shell=True, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, stderr = await proc.communicate()
        logger.debug(f'{self.name} wrote:\nstdout: {stdout!r}\nstderr: {stderr!r}, return code: {proc.returncode}')
        cregex = re.compile(self.regex)
        issues: list[Issue] = []
        for line in stdout.decode('utf-8').splitlines():
            result = cregex.fullmatch(line)
            if result:
                groupdict = result.groupdict()
                issues.append(Issue(file=groupdict.get('file', None), line=groupdict.get('line', None), col=groupdict.get('col', None),
                                    code=groupdict.get('code', None), text=groupdict.get('text', None), source=self.name))
        if not issues and proc.returncode != 0:
            issues.append(Issue(file=None, line=None, col=None, code=None, text='Non-zero return code', source=self.name))
        return issues


def lintly(issues: list[Issue]) -> None:
    """Run lintly on the issues"""
    issues_json = [{'path': issue.file, 'line': issue.line, 'column': issue.col, 'message-id': issue.code, 'message': issue.text, 'symbol': issue.source}
                   for issue in issues]
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as lintly_cmd:
        lintly_cmd.write('from lintly.cli import main\nmain()')
    subprocess.run([sys.executable, lintly_cmd.name, '--log', '--no-request-changes', '--use-checks', '--format=pylint-json'], check=False,
                   input=json.dumps(issues_json), text=True)


async def amain(argv: list[str]) -> int:
    """Run linting tools on the code"""
    parser = argparse.ArgumentParser()
    parser.add_argument('--path', default='.')
    parser.add_argument('--lintly', action='store_true')
    option = parser.parse_args(argv[1:])

    logging.basicConfig(level=logging.DEBUG)

    linters = [
        Linter(name='mypy', cmdline='"{exe}" -m mypy --namespace-packages "{path}"',
               regex='(?P<file>.*\\.py):(?:(?P<line>\\d*):)?(?:(?P<col>\\d*):)? [^:]*: (?P<text>.*)'),
        Linter(name='pylint', cmdline='"{exe}" -m pylint {files}', regex='(?P<file>[^:]*):(?P<line>\\d*):(?P<col>\\d*): (?P<code>[^:]*): (?P<text>.*)'),
        Linter(name='flake8', cmdline='"{exe}" -m flake8 "{path}"', regex='(?P<file>[^:]*):(?P<line>\\d*):(?P<col>\\d*): (?P<code>[^ ]*) (?P<text>.*)'),
    ]

    def has_dot(path: str) -> bool:
        return any(part.startswith('.') and part not in ('.', '..') for part in path.split(os.path.sep))

    files = [os.path.join(root, file) for root, _, files in os.walk(option.path) for file in files if file.endswith('.py') and not has_dot(root)]
    cmdline_args = {'exe': sys.executable, 'path': option.path, 'files': ' '.join((f'"{file}"' for file in files))}

    issues: list[Issue] = sum(list(await asyncio.gather(*[linter.lint(cmdline_args) for linter in linters])), start=[])

    for issue in issues:
        logger.error(repr(issue))

    if not issues:
        logger.info('No issues found :)')

    if option.lintly:
        lintly(issues)

    return len(issues)


def main() -> NoReturn:
    """The exposed main function"""
    sys.exit(asyncio.run(amain(sys.argv)))


if __name__ == '__main__':
    main()
