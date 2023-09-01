"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.comment = exports.getRegexParser = exports.getKnownParser = exports.generateSarif = void 0;
const github = __importStar(require("@actions/github"));
const core_1 = require("@actions/core");
const parse_diff_1 = __importDefault(require("parse-diff"));
function* parseRegex(input, regex, levelMap) {
    for (const match of input.matchAll(regex)) {
        const groups = match.groups ?? {};
        yield {
            id: groups.id,
            sym: groups.sym,
            msg: groups.msg,
            level: levelMap == null ? groups.level : levelMap[groups.level],
            path: groups.path,
            line: groups.line != null ? parseInt(groups.line) : undefined,
            col: groups.col != null ? parseInt(groups.col) : undefined,
            eline: groups.eline != null ? parseInt(groups.eline) : undefined,
            ecol: groups.ecol != null ? parseInt(groups.ecol) : undefined
        };
    }
}
function* parsePylint(input) {
    const levelMap = {
        convention: 'note',
        usage: 'note',
        refactor: 'note',
        warning: 'warning',
        error: 'error'
    };
    for (const issue of JSON.parse(input)) {
        yield {
            id: issue['message-id'],
            sym: issue.symbol,
            msg: issue.message,
            level: levelMap[issue.type],
            path: issue.path,
            line: issue.line,
            col: issue.column != null ? issue.column + 1 : undefined,
            eline: issue.endLine,
            ecol: issue.endColumn != null ? issue.endColumn + 1 : undefined
        };
    }
}
function* parseSarif(input) {
    const log = JSON.parse(input);
    for (const run of log.runs) {
        if (run.results == null) {
            continue;
        }
        for (const issue of run.results) {
            yield {
                id: issue.ruleId,
                sym: issue.ruleIndex != null ? run.tool.driver.rules?.[issue.ruleIndex]?.name : undefined,
                msg: issue.message.text,
                level: issue.level,
                path: issue.locations?.[0]?.physicalLocation?.artifactLocation?.uri,
                line: issue.locations?.[0]?.physicalLocation?.region?.startLine,
                col: issue.locations?.[0]?.physicalLocation?.region?.startColumn,
                eline: issue.locations?.[0]?.physicalLocation?.region?.endLine,
                ecol: issue.locations?.[0]?.physicalLocation?.region?.endColumn
            };
        }
    }
}
const knownParsers = {
    pylint: parsePylint,
    sarif: parseSarif,
    mypy: (input) => parseRegex(input, /^(?<path>[^:\n]+):(?:(?<line>\d+):)?(?:(?<col>\d+):)?(?:(?<eline>\d+):)?(?:(?<ecol>\d+):)? (?<level>[^:\s]+): (?<msg>.+?)\s*(?:\[(?<id>\S+)\])?$/gm),
    flake8: (input) => parseRegex(input, /^(?<path>[^:\n]+):(?<line>\d+):(?<col>\d+): (?<id>\w\d+) (?<msg>.+)$/gm),
    mdl: (input) => parseRegex(input, /^(?<path>[^:\n]+)(?::(?<line>\d+))?(?::(?<col>\d+))? (?<id>[^//n]+)\/(?<sym>[^\s]+) (?<msg>.+)$/gm)
};
function normalizePath(path) {
    return path.replace(/^\.[\\/]/gm, ''); // Remove leading "./" or ".\", since GitHub doesn't accept it
}
function generateSarif(issues, name) {
    const rulesIndices = {};
    const rules = [];
    const results = [];
    for (const issue of issues) {
        if (issue.sym != null && issue.id != null && rulesIndices[issue.id] == null) {
            rulesIndices[issue.id] = rules.length;
            rules.push({ id: issue.id, name: issue.sym });
        }
        results.push({
            message: { text: issue.msg ?? undefined },
            locations: [
                {
                    physicalLocation: {
                        artifactLocation: { uri: issue.path != null ? normalizePath(issue.path) : undefined },
                        region: issue.line != null || issue.col != null || issue.eline != null || issue.ecol != null
                            ? {
                                startLine: issue.line ?? undefined,
                                startColumn: issue.col ?? undefined,
                                endLine: issue.eline ?? undefined,
                                endColumn: issue.ecol ?? undefined
                            }
                            : undefined
                    }
                }
            ],
            level: issue.level ?? undefined,
            ruleId: issue.id ?? issue.sym ?? undefined,
            ruleIndex: issue.id != null ? rulesIndices[issue.id] : undefined
        });
    }
    return {
        version: '2.1.0',
        $schema: 'http://json.schemastore.org/sarif-2.1.0-rtm.6',
        runs: [{ tool: { driver: { name, rules } }, results }]
    };
}
exports.generateSarif = generateSarif;
function getKnownParser(name) {
    const parser = knownParsers[name];
    if (parser == null) {
        throw new Error(`Unrecognized: ${name}`);
    }
    return parser;
}
exports.getKnownParser = getKnownParser;
function getRegexParser(regex, levelMap) {
    return (input) => parseRegex(input, regex, levelMap);
}
exports.getRegexParser = getRegexParser;
async function comment(issues, githubToken, commentTag, owner, repo, prNumber) {
    const octokit = github.getOctokit(githubToken);
    (0, core_1.debug)('Deleting old comments');
    const commentTag_ = `<!-- bugale/bugalint ${commentTag} -->`;
    for await (const { data: comments } of octokit.paginate.iterator(octokit.rest.pulls.listReviewComments, { owner, repo, pull_number: prNumber })) {
        const c = comments.find((x) => x?.body?.includes(commentTag_));
        if (c?.id != null) {
            (0, core_1.debug)(`Deleting old comment ${c.id}`);
            await octokit.rest.pulls.deleteReviewComment({ owner, repo, comment_id: c?.id });
        }
    }
    // Get PR diff
    const prDiff = (await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber, mediaType: { format: 'diff' } })).data;
    const lineMap = {};
    for (const file of (0, parse_diff_1.default)(prDiff)) {
        if (file.to == null) {
            continue;
        }
        (0, core_1.debug)(`PR diff: ${file.to} (${file.chunks.length} chunks)`);
        lineMap[file.to] = {};
        let relativeLine = -1;
        for (const chunk of file.chunks) {
            relativeLine++;
            for (const change of chunk.changes) {
                relativeLine++;
                lineMap[file.to][change.ln] = relativeLine;
            }
        }
    }
    (0, core_1.debug)(`lineMap: ${JSON.stringify(lineMap)}`);
    //octokit.rest.pulls.createReview({ owner, repo, pull_number: prNumber, event: 'COMMENT', body: commentTag_ })
}
exports.comment = comment;
//# sourceMappingURL=bugalint.js.map