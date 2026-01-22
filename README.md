# Bugalint

This GitHub Action converts various linter outputs to standard formats (including SARIF), and supports custom linter output formats using regular expressions.
This action can be used in conjunction with
[GitHub's Code Scanning feature](https://docs.github.com/en/github/finding-security-vulnerabilities-and-errors-in-your-code/about-code-scanning) to
[report linter issues as code scanning alerts](#basic-example).
This action can also auto-comment on the PR in the relevant lines, which is an alternative to uploading a SARIF (which is only available with GitHub Advanced Security).
This action can also generate a markdown report for the job.

## Usage

### Basic Example

This is a basic example of a GitHub Workflow that uses this action to run [pylint](https://github.com/pylint-dev/pylint) and report its issues as code scanning alerts:

```yaml
steps:
  - uses: actions/checkout@v3
  - uses: actions/setup-python@v4
  - run: pip install pylint
  - run: pylint --output-format=json my_python_file.py > lint.txt
  - uses: bugale/bugalint@v2
    if: always()
    with:
      inputFile: lint.txt
      toolName: pylint
      inputFormat: pylint
  - uses: github/codeql-action/upload-sarif@v2
    if: always()
    with:
      sarif_file: sarif.json
```

### Input Parameters

- `inputFile`: _(required)_ The path to the input file, i.e. the file containing the output of the linter.

- `sarif`: True by default - generates a SARIF file as an output. If set to false, the action will not generate a SARIF file.

- `comment`: Set to true to comment on the PR with the issues. If set to false or ommitted, the action will not comment on the PR.

- `summary`: True by default - generates a markdown summary for the job. If set to false, the action will not generate a markdown summary.

- `outputFile`: The path to the output SARIF file this action should generate. If not specified, the action will generate a `sarif.json` file in the root of
  the repository.

- `toolName`: _(required)_ The `tool name` that will be written in the SARIF output. This is used by both code scanning and auto-pr-commenting to resolve fixed
  issues.

- `inputFormat`: The name of a linter output format that this action [natively supports](#natively-supported-linter-output-formats). If not specified, the
  action will expect `inputRegex` input to be specified.

- `inputRegex`: The [JS-style regular expression to parse the input file](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions).
  It should include [named groups for the different issues' metadata](#input-regex-named-groups). If not specified, the action will expect `inputFormat` input
  to be specified.

- `levelMap`: An optional JSON object mapping between the linter's levels and the SARIF levels (`note`/`warning`/`error`). Ignored unless `inputRegex` is
  specified.

- `analysisPath`: The path to the directory from which the analysis was run, relative to the repository's root. By default, the action will use the repository's
  root. This is required only when the linter's output contains paths that are relative but not to the repository's root, for which this action will
  re-relativize them.

- `githubToken`: Relevant only for "comment" mode. The GitHub token to use to post the comment. If not specified, the action will use the action's token.

#### Natively Supported Linter Output Formats

This action supports a bunch of linter output formats, for which no `inputRegex` is required:

- `pylint`: The format of [pylint](https://github.com/pylint-dev/pylint) linter's JSON output (requires using `--output-format=json` in pylint's command line).

- `flake8`: The format of [flake8](https://github.com/PyCQA/flake8) linter's default output.

- `mypy`: The format of [mypy](https://github.com/python/mypy) linter's default output. It is possible and recommended to pass `--show-column-numbers` and
  `--show-error-end` in mypy's command line to have the richest SARIF.

- `markdownlint`: The format of [markdownlint](https://github.com/markdownlint/markdownlint) linter's default output.

- `yamllint`: The format of [yamllint](https://yamllint.readthedocs.io/en/stable/) linter's parsable output (requires using `-f parsable` in yamllint's command
  line).

- `ghalint`: The format of [ghallint](https://github.com/suzuki-shunsuke/ghalint/cmd/ghalint/) linter's parsable output.

- `SARIF`: A [standard format for static analysis](https://sarifweb.azurewebsites.net/). This is useful if you already have a SARIF file and want to create a summary
  for it, or create comments on the PR.

#### Input Regex Named Groups

When using a custom regular expression, it must contains named groups for Bugalint to successfully understand which parts of each line are the issue's
metadata. Most of the named groups are optional.

The supported named groups are:

- `msg`: _(required)_ The message. Required by the SARIF schema.

- `id`: A unique identifier of the rule by which the issue was generated. Example: `E123`

- `sym`: A unique human-readable identifier of the rule by which the issue was generated. Example: `no-unused-import`

- `level`: The level of this issue. Should be one of `error`/`warning`/`note`. If the linter uses different levels, you can use the `levelMap` input to map
  between the linter's levels and the SARIF levels.

- `path`: The path of the file on which the issue was reported. Example: `src/my_python_file.py`

- `line`: The line on which the issue was reported.

- `col`: The column on which the issue was reported.

- `eline`: The end line on which the issue was reported.

- `ecol`: The end column on which the issue was reported.

### Example With Custom Regex

This is an example of how this action can be used to parse the output of a hypothetical custom linter called `mylinter`, which outputs issues in the following
format:

```text
test.py-3-1-4-10 info:N123:some-note Message 1
test.py-3-1 warn:E124:some-warning Message 2
test.py err:E125:some-error Message 3
Finished running
```

```yaml
steps:
  - uses: actions/checkout@v3
  - uses: actions/setup-python@v4
  - run: pip install mylinter
  - run: mylinter test.py > lint.txt
  - uses: bugale/bugalint@v2
    if: always()
    with:
      inputFile: lint.txt
      toolName: mylinter
      inputRegex: '^(?<path>[^-\n]+)(?:-(?<line>\d+))?(?:-(?<col>\d+))?(?:-(?<eline>\d+))?(?:-(?<ecol>\d+))? (?<level>[^:\s]+):(?<id>[^:\s]+):(?<sym>[^:\s]+) (?<msg>.+)$'
      levelMap: '{ "err": "error", "warn": "warning", "info": "note" }'
  - uses: github/codeql-action/upload-sarif@v2
    if: always()
    with:
      sarif_file: sarif.json
```
