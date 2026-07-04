---
title: Protocol Token Count
description: Count Markdown words, characters, and tokenizer tokens for the Strategy Research Protocol.
---

# Protocol Token Count

Use the protocol token-count script to estimate how much context an LLM needs to
read the Strategy Research Protocol files.

```bash
npm run research:protocol-size
```

The script scans `strategy-research-protocol/**/*.md`,
`strategy-research-protocol/**/*.json`, and the research-memory files defined
by `strategy-research-protocol/MEMORY.md`. It then prints:

1. a numbered Markdown-file table,
2. a numbered JSON-file table,
3. a numbered research-memory-file table,
4. a deduplicated combined total across all sections.

Each table includes per-file words, characters, and tokens.

By default, hidden files and hidden directories are excluded. This means files
under `strategy-research-protocol/.notes/` are not counted unless explicitly
requested:

```bash
npm run research:protocol-size -- --include-hidden
```

## Tokenizer

The script uses `tiktoken` and defaults to the `o200k_base` encoding:

```bash
npm run research:protocol-size -- --encoding o200k_base
```

For OpenAI models known by the installed `tiktoken` package, use `--model`:

```bash
npm run research:protocol-size -- --model gpt-5
```

If `tiktoken` does not know a model name, the script exits with an error. In
that case, use the closest published encoding for the model family, or update
`tiktoken` if the package has added the model mapping.

## Provider Limits

The token count is exact for the tokenizer/encoding being used. It is not a
universal token count for every LLM provider.

Anthropic Claude models use Anthropic tokenization, not `tiktoken`. For Claude
Opus-family models, treat the `o200k_base` result as a rough planning estimate
only unless the script is extended to call an Anthropic tokenizer or token-count
API.

## Included Files

The default file list is every non-hidden Markdown and JSON file under
`strategy-research-protocol/`, including nested folders such as:

- `strategy-research-protocol/modules/`
- `strategy-research-protocol/rules/`
- `strategy-research-protocol/tools/`
- `strategy-research-protocol/examples/`

Use `--include-hidden` when prompt scratchpads, private notes, or other hidden
Markdown or JSON files should be included in the estimate.

The Research Memory Files section follows the memory surfaces described in
`strategy-research-protocol/MEMORY.md`:

- `strategy-research-protocol/LESSONS.md`
- `src/strategies/research/INDEX.json`
- `src/strategies/research/<family>/FAMILY.md`
- `src/strategies/research/<family>/FAMILY.json`

If a file appears in more than one section, the combined total counts it once.
