"""
Source-file parsing — pure domain logic, no I/O.

Turns the raw bytes of an uploaded CSV/Excel file into an ordered header list
plus one JSON object per data row, so the file's real columns and rows can be
persisted in Postgres and profiled server-side.

Used by DiscoverDatasetService (upload) and the profiling flow.
"""
from __future__ import annotations

import csv
import io
import logging
import re
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timedelta

from features.discover.domain.validation import normalise_column_labels

logger = logging.getLogger(__name__)

# Guard rails — a single cell or header cannot be unbounded.
MAX_CELL_LENGTH = 10_000
CSV_SNIFF_BYTES = 8192
SUPPORTED_DELIMITERS = ",;\t|"


class SourceFileParseError(ValueError):
    """Raised when an uploaded file cannot be read as a table."""


@dataclass
class ParsedSourceFile:
    """The real shape of an uploaded file."""

    column_labels: list[str]
    """Original header labels, in file order, exactly as they appear."""

    internal_names: list[str]
    """De-duplicated keys used for the row JSON objects (parallel to column_labels)."""

    rows: list[dict[str, str]]
    """One object per data row, keyed by internal_name. Missing cells are ''."""

    @property
    def row_count(self) -> int:
        return len(self.rows)

    @property
    def column_count(self) -> int:
        return len(self.column_labels)


# ── decoding ──────────────────────────────────────────────────────────────────


def _decode(raw: bytes) -> str:
    """Decode file bytes, tolerating BOMs and non-UTF-8 exports from Excel."""
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    # latin-1 never fails, but keep the fallback explicit.
    return raw.decode("latin-1", errors="replace")


def _sniff_delimiter(sample: str) -> str:
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=SUPPORTED_DELIMITERS)
        return dialect.delimiter
    except csv.Error:
        return ","


# ── shaping ───────────────────────────────────────────────────────────────────


def _clean_cell(value: object) -> str:
    if value is None:
        return ""
    text = value if isinstance(value, str) else str(value)
    text = text.strip()
    return text[:MAX_CELL_LENGTH]


def _build(header_row: list[str], data_rows: list[list[str]]) -> ParsedSourceFile:
    """Normalise a raw header + rows pair into a ParsedSourceFile."""
    column_labels = [
        label if label else f"Column {idx + 1}"
        for idx, label in enumerate(_clean_cell(cell) for cell in header_row)
    ]
    if not column_labels:
        raise SourceFileParseError(
            "The file does not contain a header row. Add column headers and upload again."
        )

    internal_names = [
        entry["internal_name"] for entry in normalise_column_labels(column_labels)
    ]

    rows: list[dict[str, str]] = []
    for raw_row in data_rows:
        cells = [_clean_cell(cell) for cell in raw_row]
        # Ignore rows that are entirely empty (trailing newlines, spacer rows).
        if not any(cells):
            continue
        # Pad short rows / drop overflow so every row matches the header shape.
        rows.append(
            {
                name: cells[idx] if idx < len(cells) else ""
                for idx, name in enumerate(internal_names)
            }
        )

    return ParsedSourceFile(
        column_labels=column_labels, internal_names=internal_names, rows=rows
    )


# ── parsers ───────────────────────────────────────────────────────────────────


def parse_csv_bytes(raw: bytes) -> ParsedSourceFile:
    """Parse CSV/TSV bytes into headers + row objects."""
    text = _decode(raw)
    if not text.strip():
        raise SourceFileParseError("The uploaded file is empty.")

    delimiter = _sniff_delimiter(text[:CSV_SNIFF_BYTES])
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)

    try:
        all_rows = [row for row in reader]
    except csv.Error as exc:
        raise SourceFileParseError(f"The CSV file could not be read: {exc}") from exc

    if not all_rows:
        raise SourceFileParseError("The uploaded file is empty.")

    return _build(all_rows[0], all_rows[1:])


def parse_excel_bytes(raw: bytes) -> ParsedSourceFile:
    """Parse the first worksheet of an .xlsx/.xlsm workbook into headers + row objects."""
    sheets = _read_workbook_sheets(raw)
    all_rows = sheets[0][1] if sheets else []

    if not all_rows:
        raise SourceFileParseError("The uploaded workbook has no rows.")

    return _build(all_rows[0], all_rows[1:])


def _read_workbook_sheets(raw: bytes) -> list[tuple[str, list[list[str]]]]:
    """
    Every sheet of an uploaded workbook, as (name, rows of text).

    The reader below needs nothing but the standard library, because an .xlsx
    is a zip of XML documents and Python can already open both. That matters
    more than elegance here: for a while this depended on openpyxl being
    installed, and every server that was missing it answered an upload with
    "tell whoever runs the server to install a package" — which is not an
    answer to someone who has a file to import.

    openpyxl is still used, when it is present, as a second opinion on a file
    the plain reader chokes on. It is not required, and nothing waits for it.
    """
    try:
        return read_xlsx_sheets(raw)
    except SourceFileParseError:
        raise
    except Exception as exc:  # pragma: no cover - an unusual file shape
        logger.warning("Falling back to openpyxl for an unusual workbook: %s", exc)
        return _read_workbook_sheets_with_openpyxl(raw, exc)


def _read_workbook_sheets_with_openpyxl(
    raw: bytes, original_error: Exception
) -> list[tuple[str, list[list[str]]]]:
    """The same, through openpyxl — only reached when the plain reader fails."""
    try:
        from openpyxl import load_workbook
    except ImportError:  # pragma: no cover - depends on deployment env
        raise SourceFileParseError(
            f"The Excel file could not be read: {original_error}"
        ) from original_error

    try:
        workbook = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    except Exception as exc:
        raise SourceFileParseError(f"The Excel file could not be read: {exc}") from exc
    try:
        return [
            (
                name,
                [
                    ["" if cell is None else cell for cell in row]
                    for row in workbook[name].iter_rows(values_only=True)
                ],
            )
            for name in workbook.sheetnames
        ]
    finally:
        workbook.close()


@dataclass
class ParsedTable:
    """One table found inside an uploaded file, and what it was called there."""

    name: str
    """The sheet's name, or the title written above a block in a CSV. Empty when
    the file holds a single unnamed table."""

    table: ParsedSourceFile


def _looks_like_title(cells: list[str]) -> bool:
    """A row with exactly one filled cell above a table is its name, not its header."""
    filled = [cell for cell in cells if cell.strip()]
    return len(filled) == 1


def split_csv_blocks(raw: bytes) -> list[ParsedTable]:
    """
    A CSV that holds several tables, one after another.

    Teams that keep each table on its own sheet in Excel do the same thing in
    CSV by stacking the tables with a blank line between them, often with the
    table's name on a line of its own above the header. So a blank line ends a
    block, and a first row with a single filled cell is read as that block's
    name rather than as its header.
    """
    text = _decode(raw)
    if not text.strip():
        raise SourceFileParseError("The uploaded file is empty.")

    delimiter = _sniff_delimiter(text[:CSV_SNIFF_BYTES])
    try:
        all_rows = [row for row in csv.reader(io.StringIO(text), delimiter=delimiter)]
    except csv.Error as exc:
        raise SourceFileParseError(f"The CSV file could not be read: {exc}") from exc

    blocks: list[list[list[str]]] = []
    current: list[list[str]] = []
    for row in all_rows:
        if any(_clean_cell(cell) for cell in row):
            current.append(row)
        elif current:
            blocks.append(current)
            current = []
    if current:
        blocks.append(current)

    tables: list[ParsedTable] = []
    for index, block in enumerate(blocks):
        name = ""
        if len(block) > 1 and _looks_like_title([_clean_cell(c) for c in block[0]]):
            name = next(_clean_cell(c) for c in block[0] if _clean_cell(c))
            block = block[1:]
        # A block of one row is a stray note, not a table: a header with nothing
        # under it would import as an empty source and clutter the session.
        if len(block) < 2:
            continue
        tables.append(ParsedTable(name or f"Table {index + 1}", _build(block[0], block[1:])))

    if not tables:
        raise SourceFileParseError(
            "No table could be read from this file. A table needs a header row and at "
            "least one row of data."
        )
    return tables


def split_excel_sheets(raw: bytes) -> list[ParsedTable]:
    """Every sheet of a workbook as its own table, named after the sheet."""
    tables: list[ParsedTable] = []
    skipped: list[str] = []
    for sheet_name, sheet_rows in _read_workbook_sheets(raw):
        rows = [row for row in sheet_rows if any(_clean_cell(cell) for cell in row)]
        # An empty sheet, or one holding a single line of notes, is not a
        # table. Skipping it quietly beats importing a source with no rows.
        if len(rows) < 2:
            skipped.append(sheet_name)
            continue
        tables.append(ParsedTable(sheet_name, _build(rows[0], rows[1:])))

    if not tables:
        raise SourceFileParseError(
            "No sheet in this workbook holds a table. A sheet needs a header row and "
            "at least one row of data."
            + (f" Sheets read but empty: {', '.join(skipped)}." if skipped else "")
        )
    return tables


def parse_source_tables(raw: bytes, filename: str) -> list[ParsedTable]:
    """
    Every table the file holds, for a file that keeps more than one.

    The extension decides how the file is cut up: a workbook by its sheets, a
    CSV by its blank lines.
    """
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension in ("xlsx", "xlsm"):
        return split_excel_sheets(raw)
    if extension in ("csv", "tsv", "txt"):
        return split_csv_blocks(raw)
    # Anything else has one table at most; parse_source_file explains the rest.
    return [ParsedTable("", parse_source_file(raw, filename))]


def parse_source_file(raw: bytes, filename: str) -> ParsedSourceFile:
    """Dispatch to the right parser based on the file extension."""
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension in ("csv", "tsv", "txt"):
        return parse_csv_bytes(raw)
    if extension in ("xlsx", "xlsm"):
        return parse_excel_bytes(raw)
    if extension == "xls":
        raise SourceFileParseError(
            "Legacy .xls workbooks are not supported. "
            "Save the file as .xlsx or .csv and upload again."
        )
    raise SourceFileParseError(
        f"Unsupported file type '.{extension}'. Upload a CSV or Excel (.xlsx) file."
    )



# ── reading .xlsx without a third-party package ───────────────────────────────
# An .xlsx file is a zip of XML documents, which the standard library can open
# on its own. openpyxl is used only as a second opinion on a file this reader
# chokes on: the platform no longer depends on it being installed, because a
# server missing one pip install should not be a server that cannot read the
# files its users have.

#: Excel's built-in number formats that mean "this is a date or a time".
_DATE_FORMAT_IDS = frozenset({14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47})
#: A custom format is a date format when it uses date/time codes outside quotes.
_DATE_CODE_RE = re.compile(r'(\[[^\]]*\])|("[^"]*")|(\\.)|([ymdhs])', re.IGNORECASE)
#: Excel counts days from this day; 1904 workbooks count from 1904-01-01.
_EXCEL_EPOCH = datetime(1899, 12, 30)
_EXCEL_EPOCH_1904 = datetime(1904, 1, 1)


def _tag(element_tag: str) -> str:
    """The local name of an XML tag, with its namespace dropped."""
    return element_tag.rsplit("}", 1)[-1]


def _is_date_format(code: str) -> bool:
    """True when a number-format string renders a date or a time."""
    for _brackets, _quoted, _escaped, date_code in _DATE_CODE_RE.findall(code):
        if date_code:
            return True
    return False


def _column_index(reference: str) -> int:
    """"C7" is the third column, so index 2. Letters only; digits end it."""
    index = 0
    for char in reference:
        if char.isalpha():
            index = index * 26 + (ord(char.upper()) - 64)
        else:
            break
    return max(0, index - 1)


def _shared_strings(archive: zipfile.ZipFile) -> list[str]:
    """The workbook's string table. Cells of type "s" hold offsets into it."""
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    strings: list[str] = []
    with archive.open("xl/sharedStrings.xml") as stream:
        parts: list[str] = []
        for _event, element in ET.iterparse(stream, events=("end",)):
            name = _tag(element.tag)
            if name == "t":
                parts.append(element.text or "")
            elif name == "si":
                # A string can be split across runs of different formatting;
                # the value is all of them, in order.
                strings.append("".join(parts))
                parts = []
                element.clear()
    return strings


def _date_styles(archive: zipfile.ZipFile) -> set[int]:
    """Which style indexes render their number as a date."""
    if "xl/styles.xml" not in archive.namelist():
        return set()
    custom: dict[int, str] = {}
    cell_formats: list[int] = []
    with archive.open("xl/styles.xml") as stream:
        in_cell_xfs = False
        for event, element in ET.iterparse(stream, events=("start", "end")):
            name = _tag(element.tag)
            if name == "numFmt" and event == "end":
                try:
                    custom[int(element.get("numFmtId", "0"))] = element.get("formatCode", "")
                except ValueError:
                    pass
            elif name == "cellXfs":
                in_cell_xfs = event == "start"
            elif name == "xf" and event == "end" and in_cell_xfs:
                try:
                    cell_formats.append(int(element.get("numFmtId", "0")))
                except ValueError:
                    cell_formats.append(0)
    dated = set()
    for style_index, format_id in enumerate(cell_formats):
        if format_id in _DATE_FORMAT_IDS or _is_date_format(custom.get(format_id, "")):
            dated.add(style_index)
    return dated


def _sheet_parts(archive: zipfile.ZipFile) -> list[tuple[str, str]]:
    """Each sheet's name and the path of the XML holding its rows, in order."""
    relations: dict[str, str] = {}
    rels_path = "xl/_rels/workbook.xml.rels"
    if rels_path in archive.namelist():
        with archive.open(rels_path) as stream:
            for _event, element in ET.iterparse(stream, events=("end",)):
                if _tag(element.tag) == "Relationship":
                    target = element.get("Target", "")
                    relations[element.get("Id", "")] = (
                        target[1:] if target.startswith("/") else f"xl/{target.lstrip('/')}"
                    )

    sheets: list[tuple[str, str]] = []
    with archive.open("xl/workbook.xml") as stream:
        for _event, element in ET.iterparse(stream, events=("end",)):
            if _tag(element.tag) != "sheet":
                continue
            name = element.get("name") or f"Sheet {len(sheets) + 1}"
            rel_id = next((v for k, v in element.attrib.items() if _tag(k) == "id"), "")
            path = relations.get(rel_id, "")
            if path in archive.namelist():
                sheets.append((name, path))
    if sheets:
        return sheets
    # A workbook whose relationships could not be read still has its sheets on
    # disk, in order, so fall back to those rather than reading nothing.
    return [
        (f"Sheet {index + 1}", path)
        for index, path in enumerate(
            sorted(p for p in archive.namelist() if p.startswith("xl/worksheets/sheet"))
        )
    ]


def _is_1904(archive: zipfile.ZipFile) -> bool:
    """Some workbooks — classic Mac Excel — count their days from 1904."""
    with archive.open("xl/workbook.xml") as stream:
        for _event, element in ET.iterparse(stream, events=("end",)):
            if _tag(element.tag) == "workbookPr":
                return element.get("date1904", "false") in ("1", "true")
    return False


def _serial_to_text(serial: str, epoch: datetime) -> str:
    """Excel stores a date as a day count; write it the way a person reads it."""
    try:
        moment = epoch + timedelta(days=float(serial))
    except (ValueError, OverflowError):
        return str(serial)
    if moment.hour or moment.minute or moment.second:
        return moment.strftime("%Y-%m-%d %H:%M:%S")
    return moment.strftime("%Y-%m-%d")


def _number_text(value: str) -> str:
    """A whole number reads as "63", not "63.0"; anything else keeps its form."""
    try:
        number = float(value)
    except ValueError:
        return value
    return str(int(number)) if number.is_integer() else value


def _read_sheet_rows(
    archive: zipfile.ZipFile,
    path: str,
    strings: list[str],
    date_styles: set[int],
    epoch: datetime,
) -> list[list[str]]:
    """One worksheet's cells as rows of text, gaps included."""
    rows: list[list[str]] = []
    with archive.open(path) as stream:
        row: list[str] = []
        cell_index = 0
        cell_type = "n"
        style_index = 0
        text_parts: list[str] = []
        for event, element in ET.iterparse(stream, events=("start", "end")):
            name = _tag(element.tag)
            if event == "start":
                if name == "row":
                    row = []
                elif name == "c":
                    cell_index = _column_index(element.get("r", ""))
                    cell_type = element.get("t", "n")
                    try:
                        style_index = int(element.get("s", "0"))
                    except ValueError:
                        style_index = 0
                    text_parts = []
                continue

            if name in ("t", "v"):
                text_parts.append(element.text or "")
            elif name == "c":
                raw_value = "".join(text_parts)
                if cell_type == "s":
                    try:
                        value = strings[int(raw_value)]
                    except (ValueError, IndexError):
                        value = ""
                elif cell_type == "b":
                    value = "TRUE" if raw_value == "1" else "FALSE"
                elif cell_type in ("str", "inlineStr", "e"):
                    value = raw_value
                elif raw_value == "":
                    value = ""
                elif style_index in date_styles:
                    value = _serial_to_text(raw_value, epoch)
                else:
                    value = _number_text(raw_value)
                # Cells are written only when they hold something, so a row can
                # skip columns; pad up to where this one actually sits.
                while len(row) < cell_index:
                    row.append("")
                row.append(value)
                element.clear()
            elif name == "row":
                rows.append(row)
                element.clear()
    return rows


def read_xlsx_sheets(raw: bytes) -> list[tuple[str, list[list[str]]]]:
    """
    Every sheet of an .xlsx/.xlsm workbook, as (name, rows), using no packages.

    It reads the values the file already holds — the cached results of any
    formulas, the same ones openpyxl returns with data_only — and converts the
    two kinds Excel stores as numbers rather than text: dates and booleans.
    """
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as exc:
        raise SourceFileParseError(
            "This file is not a readable Excel workbook. If it was saved as .xls "
            "or simply renamed, save it again as .xlsx or CSV."
        ) from exc

    with archive:
        if "xl/workbook.xml" not in archive.namelist():
            raise SourceFileParseError("This file is a zip archive but not an Excel workbook.")
        strings = _shared_strings(archive)
        date_styles = _date_styles(archive)
        epoch = _EXCEL_EPOCH_1904 if _is_1904(archive) else _EXCEL_EPOCH
        return [
            (name, _read_sheet_rows(archive, path, strings, date_styles, epoch))
            for name, path in _sheet_parts(archive)
        ]

# ── data-driven type inference ────────────────────────────────────────────────
# Vocabulary matches normalise_column_labels() so persisted discovery_column
# rows stay consistent however they were produced.

_INTEGER_RE = re.compile(r"^-?\d+$")
_DECIMAL_RE = re.compile(r"^-?\d+\.\d+$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$")
_DATE_SLASH_RE = re.compile(r"^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$")
_BOOLEAN_VALUES = {"true", "false", "yes", "no"}


# A column is treated as typed when this share of its values fit the type. Using
# a majority rather than "every value" matters: if one bad cell could flip the
# column to String, the quality check would have nothing left to catch it on.
TYPE_DOMINANCE_THRESHOLD = 0.8


def infer_datatype(values: list[str]) -> str:
    """
    Infer a column's datatype from its actual values.

    The dominant type wins, so a handful of malformed cells do not disguise a
    numeric or date column as free text — they show up as quality findings
    instead.
    """
    non_blank = [value.strip() for value in values if value and value.strip()]
    if not non_blank:
        return "String"

    total = len(non_blank)

    def share(predicate) -> float:
        return sum(1 for value in non_blank if predicate(value)) / total

    if share(lambda v: bool(_INTEGER_RE.match(v))) >= TYPE_DOMINANCE_THRESHOLD:
        return "Integer"
    if share(
        lambda v: bool(_DECIMAL_RE.match(v) or _INTEGER_RE.match(v))
    ) >= TYPE_DOMINANCE_THRESHOLD:
        return "Decimal"
    if share(lambda v: v.lower() in _BOOLEAN_VALUES) >= TYPE_DOMINANCE_THRESHOLD:
        return "Boolean"
    if share(
        lambda v: bool(_DATE_RE.match(v) or _DATE_SLASH_RE.match(v))
    ) >= TYPE_DOMINANCE_THRESHOLD:
        return "DateTime"
    return "String"
