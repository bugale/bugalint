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

- `sarif`: The path to the output SARIF file this action should generate. If not specified, the action will generate a `sarif.json` file in the root of the
  repository. If set to an empty string, the action will not write a SARIF file. The SARIF is always generated and printed to the workflow log.

- `comment`: Set to true to comment on the PR with the issues. If set to false or ommitted, the action will not comment on the PR. Issues that carry a fix are
  commented as [suggested changes](#suggested-changes). An issue is commented on only if every line it spans is part of the pull request's diff, as GitHub
  rejects comments anchored outside it.

- `summary`: True by default - generates a markdown summary for the job. If set to false, the action will not generate a markdown summary.

- `fail`: True by default - fails the step if the linter found any issues. If set to false, the action will not fail the step.

- `failOnlyNew`: Set to true to fail only on issues found on lines added in the pull request (requires running on a pull request). If set to false or
  omitted, the action will fail on any issue. Ignored if `fail` is set to false. An issue spanning several lines is considered new if any one of them was
  added, since fixing such an issue usually requires changing the lines around it as well.

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
  for it, or create comments on the PR. This is also the only input format that can carry [suggested changes](#suggested-changes).

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

### Suggested Changes

When an issue carries a fix, the comment posted on the pull request contains it as a
[suggested change](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/incorporating-feedback-in-your-pull-request),
which a reviewer can apply in one click. Fixes are read from the first `replacements` entry of the first `artifactChanges` entry of the result's first `fixes`
entry, so they are only available when `inputFormat` is `sarif`:

```json
{
  "message": { "text": "Not formatted correctly" },
  "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "test.py" }, "region": { "startLine": 3, "endLine": 4 } } }],
  "fixes": [
    {
      "artifactChanges": [
        {
          "artifactLocation": { "uri": "test.py" },
          "replacements": [{ "deletedRegion": { "startLine": 3, "endLine": 4 }, "insertedContent": { "text": "def f():\n    return 1" } }]
        }
      ]
    }
  ]
}
```

GitHub replaces whole lines, so a fix is rendered only when its `deletedRegion` covers exactly the lines of the result's own region, which is what the comment
is anchored to. Following the SARIF specification, in which an absent `endColumn` means the end of the text of `endLine`, both of the usual ways of writing
such a region are accepted:

- `{ "startLine": 3, "endLine": 4 }` covers the text of lines 3 to 4 without the line terminator ending line 4, so `insertedContent.text` is the new text of
  those lines and must not end with a newline.

- `{ "startLine": 3, "startColumn": 1, "endLine": 5, "endColumn": 1 }` covers the same lines including the line terminator ending line 4, so
  `insertedContent.text` must end with a newline. Exactly one is removed when rendering the suggestion.

Any other `deletedRegion`, such as one replacing a part of a line or lines other than the reported ones, cannot be rendered as a suggestion. Such a fix is
ignored, and the issue is commented on without one.

The text itself is never trimmed beyond the single line terminator described above, so an additional trailing newline is rendered as a trailing empty line.
An empty `insertedContent.text` renders as an empty suggestion, which deletes the lines. A replacement consisting of a single empty line is written exactly the
same way in either form, so it is indistinguishable from a deletion and cannot be expressed. A producer that needs one should widen the replacement to include
a neighbouring line.

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
