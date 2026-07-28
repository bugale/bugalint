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

- `onlyNew`: Set to true to ignore every issue that is not on a line added in the pull request (requires running on a pull request). The issues are filtered
  before anything else happens, so the SARIF file, the workflow log, the summary, the comments and the step's success or failure all reflect only the new
  issues. If set to false or omitted, the action considers every issue. An issue spanning several lines is considered new if any one of them was added, since
  fixing such an issue usually requires changing the lines around it as well.

  Note that this also removes the old issues from the SARIF, so uploading it to code scanning resolves their alerts. Leave it unset when the SARIF is uploaded
  and the alerts of the whole repository should be kept.

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

- `message`: An additional message to append to the message of every issue found. Input formats that carry no message of their own, currently only `diff`, end
  up with this as their whole message. Empty by default, which leaves the issues of such a format with no message at all.

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
  for it, or create comments on the PR. It can carry [suggested changes](#suggested-changes).

- `diff`: The output of `git diff`, which turns [any formatter that rewrites files in place](#formatter-diffs) into a linter reporting suggested changes.

#### Formatter Diffs

The `diff` input format turns the output of `git diff` into issues, which makes any formatter that can rewrite files in place a linter reporting
[suggested changes](#suggested-changes):

```yaml
- run: clang-format -i $(git ls-files '*.cpp')
- run: git diff > clang-format.diff
- uses: bugale/bugalint@v1
  with:
    inputFile: 'clang-format.diff'
    toolName: 'clang-format'
    inputFormat: 'diff'
    message: 'Not formatted according to .clang-format'
    comment: true
```

Every contiguous run of changed lines becomes one issue, rather than every hunk, so the context lines `git diff` prints around each change do not widen the
reported range. Issues are anchored on the lines of the old side of the diff, which are the lines of the committed file that the pull request shows and that
comments can be attached to, while the new side becomes the fix. A run that only adds lines has no line of its own to anchor to, so it is extended to a
neighbouring line, preferring the preceding one, whose content is repeated in the fix. The marker `git diff` prints for a file that does not end with a newline
is kept out of the fix, so the last line of such a file is reported like any other. When the formatter adds that terminator, the fix ends with an empty line,
which is how a suggestion asks GitHub for a newline at the end of a file rather than for a blank line; a change of the terminator alone is therefore reported
with a suggestion whose text repeats the line and adds that empty line. Removing the terminator is reported without a fix, since no suggestion can express it. A
run replacing lines with nothing deletes them, while one replacing them with an empty line blanks them, which is what a formatter stripping the whitespace of a
blank line produces. GitHub cannot render a suggestion whose whole content is one empty line, so such a run is extended to a neighbouring line as well, and is
reported without a fix when there is no line to extend to.

Note that a formatter that fails without writing anything produces an empty diff, which is indistinguishable from a formatter that found nothing to fix. The
step running the formatter should therefore fail the job by itself.

Unlike the other input formats, a diff is read byte for byte, since a carriage return in it may be content rather than a line terminator. A repository storing
its files with CRLF therefore gets suggestions with CRLF in them, instead of suggestions that silently rewrite the line endings of every line they touch.

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
which a reviewer can apply in one click. Fixes are produced by the [`diff` input format](#formatter-diffs), and are read from the first `replacements` entry of
the first `artifactChanges` entry of the result's first `fixes` entry when `inputFormat` is `sarif`:

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

An `endLine` before its own `startLine` describes no range at all. In every input format such an end line is ignored and the issue is anchored on its start
line alone, which is also what its fix is matched against. The generated SARIF therefore never reports a region ending before it starts.

The text itself is never trimmed beyond the single line terminator described above, so an additional trailing newline is rendered as a trailing empty line.
An empty `insertedContent.text` renders as an empty suggestion, which deletes the lines, in both forms. Replacing the lines with a single empty line is
therefore expressible only in the second form, as a text of exactly one newline — in the first form that same replacement is written as an empty text, which
cannot be told apart from a deletion. A producer restricted to the first form should widen the replacement to include a neighbouring line.

GitHub itself cannot render such a replacement either: a suggestion whose whole content is one empty line is drawn, and applied, exactly like an empty one, so
it deletes the lines instead of blanking them. A fix replacing the lines with a single empty line is therefore read and written faithfully, but is never
commented as a suggestion. To have one commented, widen the replacement to cover a neighbouring line as well, so that its text is not a lone newline.

The fixes Bugalint writes out always use the second form, so a fix survives being read back from a SARIF file that Bugalint itself generated.

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
