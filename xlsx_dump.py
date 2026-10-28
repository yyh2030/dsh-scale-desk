"""Print one QuestionPro/Excel sheet as JSON: {"sheet": name, "csv": "..."}.

Called by the Host half when an import file is .xlsx. Sheet choice: a sheet
named "Raw Data" (QuestionPro's response sheet), otherwise the sheet with the
most rows among the content sheets.
"""

import csv
import io
import json
import sys
import warnings

warnings.filterwarnings('ignore')

import openpyxl

SKIP_SHEETS = {'Introduction', 'Overall Statistics'}


def pick_sheet(workbook):
    names = workbook.sheetnames
    if 'Raw Data' in names:
        return workbook['Raw Data']
    candidates = [workbook[name] for name in names if name not in SKIP_SHEETS]
    if not candidates:
        return workbook[names[0]]
    return max(candidates, key=lambda sheet: sheet.max_row or 0)


def main(path):
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        sheet = pick_sheet(workbook)
        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator='\n')
        for row in sheet.iter_rows(values_only=True):
            if row is None:
                continue
            values = ['' if value is None else value for value in row]
            if all(str(value).strip() == '' for value in values):
                continue
            writer.writerow([str(value) if not isinstance(value, str) else value for value in values])
        payload = {'sheet': sheet.title, 'csv': buffer.getvalue()}
    finally:
        workbook.close()
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: xlsx_dump.py <file.xlsx>', file=sys.stderr)
        sys.exit(2)
    try:
        main(sys.argv[1])
    except Exception as error:  # noqa: BLE001 - report the reason to the Host
        sys.stderr.write(f'{type(error).__name__}: {error}')
        sys.exit(1)
