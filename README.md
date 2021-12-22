# Bugalint

An abstraction package for running linters on code, outputting the results in a unified format.

## Usage

First, `pip` install bugalint:

    $ pip install bugalint

> Bugalint requires Python 3.7+.

Next, you need to setup a configuration file, named by default `setup.cfg`:
```
[bugalint.lints.example]
path = source_code/
mypy = True
flake8 = True
pylint = True
```

Now, simply run `bugalint` from the directory in which `setup.cfg` resides:

    $ bugalint

`bugalint` will run the selected 3 linters (mypy, flake8, and pylint) on the selected path (`source_code/`)

## Supported Built-in Linters

- [flake8](http://flake8.pycqa.org/en/latest/)
- [pylint](https://www.pylint.org/)
- [mypy](https://mypy.readthedocs.io/en/stable/)

Additional linters can be added in the `setup.cfg` file.

## Adding Lint Runs

Bugalint can run linters on more than one directory. It looks for any section of the form `[bugalint.lints.<name>]` in the configuration file,
and expects it to contain a key named `path`, which supports glob syntax, and any other key with a name of a linter, and the value `True`.
Bugalint will run the given linters, with `path` as their working directory.

For example, suppose we have the following file structure:
```
+-- foo
|   +-- file.py
+-- bar
|   +-- foo1
|   |   +-- bar
|   |   |   +-- file.py
|   +-- foo2
|   |   +-- bar
|   |   |   +-- file.py
```

And suppose we have the following configuration file:
```
[bugalint.lints.lint1]
path = foo
mypy = True

[bugalint.lints.lint2]
path = bar/*/bar
mypy = True
flake8 = True
```

Bugalint will run the following:
 - `mypy .` with `foo` as its working directory
 - `mypy .` with `bar/foo1/bar` as its working directory
 - `mypy .` with `bar/foo2/bar` as its working directory
 - `flake8 .` with `bar/foo1/bar` as its working directory
 - `flake8 .` with `bar/foo2/bar` as its working directory

Bugalint will combine all of their warnings to a unified output format.

## Using Additional Linters

For running a linter that isn't built-in, Bugalint needs only two strings:
 - The command line to run
 - The regular expression to apply on its standard output

This information needs to be placed inside the `setup.cfg` file in the working directory of Bugalint.
An example of the configuration file adding a new linter called my-lint can be:
```
[bugalint.linters.my-lint]
cmdline = my-lint --my-flag .
regex = ^(?P<file>[^:]*):(?P<line>\d*):(?P<col>\d*): (?P<code>[^:]*): (?P<text>.*)$
```

Bugalint will run the given command line, and try to match each line of its standard output to the given regular expression.
If the regular expression matches a line, it will be considered "a linter warning", and some named captures from the regular expression
will be used to determine its location in the code, message, etc.

### Linter Regex Named Captures

Bugalint will use named captures from the regular expression to determine the information about a linter warning. All of the named captures are optional.
The list of supported named captures is:
 - `file` - The path to the file in which the warning was triggered. Can be absolute, or relative to the working directory of the linter
 - `line` - The line number in which the warning was triggered
 - `col` - The column number in which the warning was triggered
 - `code` - A short code or number representing the issue found
 - `text` - A free text describing the issue

## Modifying Built-in Linters Behavior

In most cases, modifying the behavior of one of the built-in linters can and should be done using a configuration file (see docs relevant to that linter).
Nevertheless, in some cases, you might want to change the command line that Bugalint runs.

Doing this is simple, and similar to defining new linters.
Adding the following to the configuration file, will modify the command line of `mypy`:
```
[bugalint.linters.mypy]
cmdline = mypy --additional-flag .
```

Similarly, the regex of a built-in linter can be modified too:
```
[bugalint.linters.mypy]
cmdline = mypy --additional-flag .
regex = ^my new regex$
```

### Command line

A list of all configuration values can be viewed by running `bugalint --help`.

```
usage: bugalint [-h] [--config CONFIG] [--verbose] [--output {textual,json}]

optional arguments:
  -h, --help            show this help message and exit
  --config CONFIG       The config file to use (default: setup.cfg)
  --verbose             Write debug log messages to stderr (default: False)
  --output {textual,json}
                        The output format (default: textual)
```

The return value of Bugalint is the number of linter warnings it detected (0 = no warnings)

## Integration with Lintly

Bugalint can be easily integrated with [Lintly](https://github.com/grantmcconnaughey/Lintly).
It supports the command line argument `--output=json`, which outputs the warnings in a JSON format similar to that of pylint.
It can then be passed to Lintly:
```
bugalint --output=json | lintly --format=pylint-json
```

Bugalint will output file paths relative to its working directory, so as long as it is being run from the root of the repository,
lintly will receive paths it can handle correctly.

A full example of a GitHub check workflow:
```
name: Lint

on:
  pull_request:
    paths:
      - 'python_project/**/*'

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v2
    - uses: actions/setup-python@v2
      with:
        python-version: 3.8
    - name: Install dependencies
      run: |
        python -m pip install bugalint lintly mypy pylint flake8
    - name: Lint
      run: |
        bugalint --output=json | lintly --format=pylint-json
      env:
        LINTLY_API_KEY: ${{ secrets.GITHUB_TOKEN }}
```
