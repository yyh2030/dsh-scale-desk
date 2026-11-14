# @local/scale-desk

[中文](README.md) · English

A research plugin written for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`): the scale scoring desk. Scale definitions, response entry, column-mapped import, one-click scoring and quality checks live in one panel, and it is traceable which version of the definition and which version of the responses produced a score.

Version 0.3.2 · Requires DSH ≥ 0.2.2-rc.1 · MIT license · Depends on [`@local/research-core`](https://github.com/yyh2030/dsh-research-core)

## Why it exists

Scale data usually goes wrong not by being computed incorrectly but by being correct yet unexplainable: one reverse-scored item was missed, the missing-data rule changed, item numbers shifted between two imports, or one person answered the questionnaire twice and both copies went into the score. What these have in common is that afterwards nobody can answer "how was this score produced".

The scoring desk splits definitions, responses and scores into three layers, each with a hash: a definition change produces a new definition snapshot, responses are saved by submission batch, and a recompute produces a new generation recording the input response set, the identifier set, the definition and the scoring code. Past generations are never overwritten, so old scores remain explainable.

## What it does

- **Scale library**: each scale declares item count, response range, waves, export codes, missing-data rules and scoring method (total and subscales, multiplier, reverse-scored items). Definitions are first validated against the raw schema, item numbers and reverse conflicts, then normalized.
- **Flow view**: lists, by wave, how many responses each scale has and who is still missing, so you can see at a glance where data collection stands.
- **Manual entry**: fill in item by item, with decimals supported for numeric items; missing codes and valid options are recognized separately, and a wrong entry is flagged rather than silently recorded as missing.
- **Questionnaire platform import**: map columns by position (`idIndex`, `items[].index` start at 0, missing columns are -1), and the preview lets you change columns and recompute; generic item numbers and item text only produce candidates, and nothing is written until you explicitly specify the scale and wave.
- **Duplicate response handling**: multiple responses from the same person keep every original value, are consistently marked as duplicate in the wide table, detail view, tools and exports, and produce no official score; an official score appears only after you select one on the review page.
- **Scoring and derivation**: one recompute produces scale scores, item detail and the wide table at the same time. Subscales can specify `minAnswered`; when unspecified it is computed from the declared `minProportion` or the whole-scale threshold proportion; the `strict` rule gives no score when one item is missing.
- **Quality checks**: item count, reverse-scored items, value range, missing proportion, export codes and definition version drift are checked one by one, returning a problem list that separates high priority from hints, without changing data.
- **Version traceability**: each item response carries `definitionHash` and `submissionId`; definition snapshots are kept in `definition-history`, old CSVs remain readable but are marked as an unknown definition version, and queries never write back to old responses.
- **Publishing to the core**: with `publishFlow` enabled, scoring and export publish results as observations into the shared core's datasets for the ops desk and analysis to use; it is off by default, to avoid adding directory structure to an existing study without authorization.

### Agent tools

| Tool | Purpose |
|---|---|
| `scale_list` | Scale library inventory: item count, scoring method, reverse-scored items, waves, response count and version |
| `scale_flow` | List the flow in administration order: questionnaires, scales and tasks at each stage, and response counts per wave |
| `scale_score` | Given an ID, show that participant's scores per scale and wave, missing item count and reasons for unscored; without an ID, show a whole-table summary |
| `scale_validate` | Check definitions and response data, returning a problem list (high/medium/hint) |

Tool queries return only identifiers and counts by default, never names.

## Installation

```powershell
git clone https://github.com/yyh2030/dsh-research-core.git
git clone https://github.com/yyh2030/dsh-scale-desk.git
dsh plugin --profile <profile> add link:<parent directory>\dsh-scale-desk
```

Or use the git form:

```powershell
dsh plugin --profile <profile> add git+https://github.com/yyh2030/dsh-scale-desk.git
```

Both ways require `research-core` to be a sibling of this plugin; the plugin references the shared core through the relative path `../research-core/host.mjs`. The repositories are private and require access before installation. After installing, restart the process hosting `dsh web`; panel changes require a page refresh.

## Configuration

| Key | Default | Description |
|---|---|---|
| `studyPath` | empty | Study definition JSON; when empty, `_lab` under the working directory is used as the data directory |
| `projectRoot` | session working directory | Base for relative paths, and the default root when no study is configured |
| `labDir` | the study's `dataRoot` | Data directory |
| `scalesDir` | `<labDir>/scales` | Scale definitions (`defs/`), responses (`answers/`), `imports.json`, `flow.json` |
| `subjectsPath` | the study's `participants.path`, otherwise `<labDir>/subjects.csv` | Participant table |
| `pythonPath` | `DSH_PYTHON_PATH`, otherwise `python` on PATH | Only needed for reading `.xlsx`; plain CSV/TSV needs no Python |
| `crossProcessLock` | `false` | When enabled, write operations additionally take a cross-process lock |
| `publishFlow` | `false` | When enabled, scoring and export publish observations to the shared core |

Output locations: `<labDir>/scores.csv`, `scores_detail.csv`, `data_wide.csv`, `export/`, `scores-manifest.json`, and generation directories under `score-generations/`. The flat CSVs are only compatibility mirrors; readers should prefer the immutable generation paths in the manifest — if the process is killed, the mirror is not guaranteed to be on the same generation.

The parts of the study definition relevant to this plugin are `visits`, `tasks` and the participant table; scale definitions live separately in `scalesDir/defs`:

```json
{
  "schema": 1,
  "id": "GARDEN",
  "name": "Sample questionnaire",
  "version": "fictional-1",
  "items": [
    { "no": 1, "text": "Item one", "kind": "likert", "reverse": false },
    { "no": 2, "text": "Item two", "kind": "likert", "reverse": true }
  ],
  "response": { "min": 1, "max": 5 },
  "waves": ["baseline", "followup"],
  "codes": { "baseline": ["sample_b_1", "sample_b_2"] },
  "missing": { "rule": "prorate", "minProportion": 0.75 },
  "scoring": { "type": "mean", "subscales": { "total": { "label": "Total", "items": [1, 2], "multiplier": 1, "range": [1, 5] } } }
}
```

The `sample-def.json` and `sample-study.json` in the repository are entirely fictional demo materials with no research or clinical validity; nothing is written to disk unless you click "Initialize empty directory" or "Add fictional sample", and the definition stays blank after everything is deleted.

## Data and privacy

- No network access. Column mapping and scoring are all done locally, and `.xlsx` is read with local Python/openpyxl.
- No names or contact details are stored: identifiers are treated as strings, preserving leading zeros, letters and Unicode; groups are stored separately in the participant table.
- Tools and exports contain only identifiers by default, never names.
- Every data write first saves a transaction snapshot; ordinary exceptions roll back the original responses, logs and compatibility derivations; if a process interruption leaves a pending-recovery state, further writes are blocked and the UI offers "Recover unfinished transaction".

## Known limitations

- Display formatting that Excel has already lost cannot be recovered automatically; complex Office display formats such as numeric dates need to be checked in the preview.
- Definition versions can only be identified by hash: old responses lacking `definitionHash` are marked as an unknown definition version, and no guess is made about which version they correspond to.
- Import never learns or overwrites definition mappings automatically; fuzzy item text only produces candidates and is never auto-confirmed.
- The in-instance write queue is not a lock between multiple Host processes; enable `crossProcessLock` explicitly when cross-process protection is needed.
- Scoring keys for multiple subscales must be changed in the definition JSON; the UI only offers quick adjustment for a single subscale.
- The flat CSV mirror may lag behind the generation if the process is force-killed; the authoritative read path is `scores-manifest.json`.

## Self-test

```powershell
npm test
npm run test:host
```

Tests use only temporary fictional studies and cover mapping, identifiers, definition traceability, derived manifests and concurrent conflicts.

## License

MIT, see `LICENSE` in the repository root (Copyright © 2026 Yuhui YANG). The license covers plugin code only, not research data: participant information, questionnaire responses, study definitions and data derived from them remain the property of the research party and are not licensed under it.
