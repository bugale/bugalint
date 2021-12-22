"""The CLI of bugalint"""

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
import configparser
import glob
from typing import Any, Coroutine, Iterator, NoReturn, Optional, Dict, List, Tuple

logger = logging.getLogger('bugalint')


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

    async def lint(self, identifier: str, cmdline_args: Dict[str, Any]) -> List[Issue]:
        """Run the linter and return a list of issues"""
        cmdline = self.cmdline.format(**cmdline_args)
        logger.debug('%s %s cmdline: %s', self.name, identifier, cmdline)
        proc = await asyncio.create_subprocess_shell(cmdline, shell=True, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, stderr = await proc.communicate()
        logger.debug('%s %s wrote:\nstdout: %s\nstderr: %s, return code: {proc.returncode}', self.name, identifier, stdout, stderr)
        cregex = re.compile(self.regex)
        issues: List[Issue] = []
        for line in stdout.decode('utf-8').splitlines():
            result = cregex.fullmatch(line)
            if result:
                groupdict = result.groupdict()
                issues.append(Issue(file=groupdict.get('file', None), line=groupdict.get('line', None), col=groupdict.get('col', None),
                                    code=groupdict.get('code', None), text=groupdict.get('text', None), source=self.name))
        if not issues and proc.returncode != 0:
            issues.append(Issue(file=None, line=None, col=None, code=None, text='Non-zero return code', source=self.name))
        return issues


def lintly(issues: List[Issue]) -> None:
    """Run lintly on the issues"""
    issues_json = [{
        'path': issue.file,
        'line': int(issue.line or '1'),
        'column': int(issue.col or '0'),
        'message-id': issue.code or '',
        'message': issue.text or '',
        'symbol': issue.source} for issue in issues if issue.file]
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as lintly_cmd:
        lintly_cmd.write('from lintly.cli import main\nmain()')
    subprocess.run([sys.executable, lintly_cmd.name, '--log', '--no-request-changes', '--format=pylint-json'], check=False,
                   input=json.dumps(issues_json), text=True)


def sections_starting_with(config: configparser.ConfigParser, prefix: str) -> Iterator[Tuple[str, configparser.SectionProxy]]:
    """Returns all sections starting with the prefix"""
    for section_name in config.sections():
        if section_name.startswith(prefix):
            yield section_name[len(prefix):], config[section_name]


def get_linters_from_config(config: configparser.ConfigParser) -> Dict[str, Linter]:
    """Parses the configuration and returns all linters discovered"""
    linters: Dict[str, Linter] = {}
    for linter_name, linter_config in sections_starting_with(config, 'bugalint.linters.'):
        linters[linter_name] = Linter(name=linter_name, cmdline=linter_config['cmdline'], regex=linter_config['regex'])
        logger.debug('Added linter %s: cmdline=%s, regex=%s', linter_name, linter_config['cmdline'], linter_config['regex'])
    return linters


def initiate_lints(config: configparser.ConfigParser, linters: Dict[str, Linter]) -> List[Coroutine[None, None, List[Issue]]]:
    """Initiates the lints"""
    lints: List[Coroutine[None, None, List[Issue]]] = []
    for lint_name, lint_config in sections_starting_with(config, 'bugalint.lints.'):
        for path in glob.iglob(lint_config['path'], recursive=True):
            logger.info('Linting %s', path)
            cmdline_args = {'path': path, 'py_files': ' '.join((f'"{file}"' for file in glob.glob(os.path.join(path, '**', '*.py'), recursive=True)))}
            for linter_name, linter in linters.items():
                if lint_config.get(linter_name):
                    lints.append(linter.lint(identifier=lint_name, cmdline_args=cmdline_args))
    return lints


async def amain(argv: List[str]) -> int:
    """Run linting tools on the code"""
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', default='setup.cfg', help='The config file to use')
    parser.add_argument('--verbose', action='store_true')
    parser.add_argument('--lintly', action='store_true')
    option = parser.parse_args(argv[1:])

    logging.basicConfig(level=logging.DEBUG if option.verbose else logging.INFO)

    config = configparser.ConfigParser()
    config.read([os.path.join(os.path.dirname(__file__), 'defaults.ini'), option.config])
    linters = get_linters_from_config(config=config)
    lints = initiate_lints(config=config, linters=linters)

    issues: List[Issue] = sum(list(await asyncio.gather(*lints)), start=[])
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
