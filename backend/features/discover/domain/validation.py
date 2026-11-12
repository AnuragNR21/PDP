"""
Import validation engine — pure domain logic, no I/O.

Implements the validation rules from AC-DWS-VALIDATE-001 through
AC-DWS-VALIDATE-006 as stateless functions so they are testable
independently from the database layer.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from features.discover.domain.models import AdminImportConfig


@dataclass
class ValidationIssue:
    issue_type: str
    detail: str
    severity: str = "warning"
    is_blocking: bool = False
    column_ordinal: int | None = None
    original_label: str | None = None
    internal_name: str | None = None


@dataclass
class ValidationOutcome:
    is_blocking: bool
    issues: list[ValidationIssue] = field(default_factory=list)
    normalised_columns: list[dict] = field(default_factory=list)
    """
    normalised_columns entries:
      {
        'source_label': str,      # original label from file header
        'internal_name': str,     # de-duped identifier safe for internal use
        'ordinal': int,           # 1-based position
        'duplicate_group_key': str | None,
      }
    """


def normalise_column_labels(
    labels: list[str], suffix_pattern: str = "__{n}"
) -> list[dict]:
    """
    Given a list of raw column header labels from a source file:
    - Preserve every original label exactly.
    - When a label appears more than once, generate a deterministic internal_name
      by appending the configured suffix pattern (default `__{n}` where n ≥ 2).
    - First occurrence keeps its label as the internal_name.
    - Sets duplicate_group_key to the original label for all members of a
      duplicate group (AC-DWS-VALIDATE-003, AC-DWS-VALIDATE-006,
      AC-DWS-COLUMN-002, AC-DWS-COLUMN-004).
    """
    seen: dict[str, int] = {}  # label -> occurrence count so far
    result: list[dict] = []

    for ordinal, label in enumerate(labels, start=1):
        seen[label] = seen.get(label, 0) + 1
        occurrence = seen[label]

        # Basic type inference: if the label contains 'id' treat as identifier,
        # numeric keywords → Integer/Decimal, otherwise String.
        label_lower = label.lower()
        if any(kw in label_lower for kw in ("revenue", "amount", "price", "salary")):
            inferred_type = "Decimal"
        elif any(kw in label_lower for kw in ("count", "number", "qty", "quantity", "employees", "age")):
            inferred_type = "Integer"
        elif any(kw in label_lower for kw in ("date", "time", "at", "created", "updated")):
            inferred_type = "DateTime"
        else:
            inferred_type = "String"

        if occurrence == 1:
            internal_name = label
            result.append(
                {
                    "source_label": label,
                    "internal_name": internal_name,
                    "inferred_datatype": inferred_type,
                    "ordinal": ordinal,
                    "is_nullable": True,
                    "duplicate_group_key": None,
                }
            )
        else:
            suffix = suffix_pattern.replace("{n}", str(occurrence))
            internal_name = f"{label}{suffix}"
            result.append(
                {
                    "source_label": label,
                    "internal_name": internal_name,
                    "inferred_datatype": inferred_type,
                    "ordinal": ordinal,
                    "is_nullable": True,
                    "duplicate_group_key": label,
                }
            )

    # Second pass: mark the *first* occurrence of any label that was later
    # duplicated so all members of a duplicate group carry the group key.
    duplicate_labels = {
        entry["source_label"]
        for entry in result
        if entry["duplicate_group_key"] is not None
    }
    for entry in result:
        if entry["source_label"] in duplicate_labels and entry["duplicate_group_key"] is None:
            # First occurrence of a label that turned out to be duplicated —
            # give it the group key but keep its internal_name as-is (no suffix).
            entry["duplicate_group_key"] = entry["source_label"]

    return result


def run_import_validation(
    column_labels: list[str],
    row_count: int,
    has_header_row: bool,
    config: AdminImportConfig,
) -> ValidationOutcome:
    """
    Execute all import validation rules against Admin-configured limits.

    Returns a ValidationOutcome containing:
      - issues: all detected issues (blocking and non-blocking)
      - is_blocking: True if any blocking issue was found
      - normalised_columns: normalised column list (even on failure, for display)

    Blocking conditions (AC-DWS-VALIDATE-005):
      - Missing header row when required   (AC-DWS-VALIDATE-002)
      - Exceeds max columns                (AC-DWS-VALIDATE-001)
      - Exceeds max rows                   (AC-DWS-VALIDATE-001)
    """
    issues: list[ValidationIssue] = []

    # AC-DWS-VALIDATE-002: header row required
    if config.require_header_row and not has_header_row:
        issues.append(
            ValidationIssue(
                issue_type="missing_header_row",
                detail="The source file does not contain a valid header row. "
                "Import cannot proceed until a header row is present.",
                severity="error",
                is_blocking=True,
            )
        )

    # AC-DWS-VALIDATE-001: max columns
    col_count = len(column_labels)
    if col_count > config.max_columns:
        issues.append(
            ValidationIssue(
                issue_type="max_columns_exceeded",
                detail=(
                    f"File contains {col_count} columns which exceeds the "
                    f"configured maximum of {config.max_columns}."
                ),
                severity="error",
                is_blocking=True,
            )
        )

    # AC-DWS-VALIDATE-001: max rows
    if row_count > config.max_rows:
        issues.append(
            ValidationIssue(
                issue_type="max_rows_exceeded",
                detail=(
                    f"File contains {row_count} rows which exceeds the "
                    f"configured maximum of {config.max_rows}."
                ),
                severity="error",
                is_blocking=True,
            )
        )

    # Normalise columns — always run so original labels are preserved
    normalised = normalise_column_labels(
        column_labels, config.duplicate_suffix_pattern
    )

    # AC-DWS-VALIDATE-003: surface duplicate column label issues
    duplicate_labels = {
        entry["source_label"]
        for entry in normalised
        if entry["duplicate_group_key"] is not None
    }
    for entry in normalised:
        if entry["source_label"] in duplicate_labels:
            issues.append(
                ValidationIssue(
                    issue_type="duplicate_column_label",
                    detail=(
                        f"Column label '{entry['source_label']}' appears more than once. "
                        f"Internal name set to '{entry['internal_name']}' "
                        f"(original label preserved)."
                    ),
                    severity="warning",
                    is_blocking=False,
                    column_ordinal=entry["ordinal"],
                    original_label=entry["source_label"],
                    internal_name=entry["internal_name"],
                )
            )

    is_blocking = any(i.is_blocking for i in issues)
    return ValidationOutcome(
        is_blocking=is_blocking,
        issues=issues,
        normalised_columns=normalised,
    )
