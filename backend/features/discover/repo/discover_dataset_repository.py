"""
DiscoverDatasetRepository — authoritative persistence for parsed source-file
content (discovery_parsed_file + discovery_source_row) and for the profiling
results computed from it.

The uploaded file is parsed once on the server, stored as JSON rows in
Postgres, and every downstream read (columns, profile statistics, data preview)
is served from that persisted data — never from client state — so refreshing or
reopening a session shows the same numbers.
"""
import json
import re
from uuid import uuid4

from features.discover.domain.file_parsing import ParsedSourceFile
from shared.db import get_connection, utc_now_iso

# How many rows are inserted per INSERT statement.
_INSERT_BATCH_SIZE = 500
# How many values are sampled per column for type inference.
TYPE_SAMPLE_SIZE = 500
# How many distinct values are kept for the value-distribution chart.
DISTRIBUTION_LIMIT = 10


#: The shape the platform generates source file ids in — `sf_` and twelve hex
#: digits. Checked before an id is put into a FROM clause; see `_scoped`.
_SOURCE_FILE_ID = re.compile(r"^sf_[0-9a-f]{12}$")


def _scoped(view: str, base: str, key: str, source_file_id: str, alias: str = "") -> str:
    """
    The table expression to read one table's rows, columns or profile from.

    Without an id this is the `active_…` view: whichever table the session is
    working on, which is what every screen wants. With one it is that table
    and nothing else — and that is what allows several tables to be checked at
    the same time. The active table is a single column on a single session
    row, so two workers cannot each have their own; passing the id instead is
    what takes the shared state out of the run.

    The id is validated and interpolated rather than passed as a parameter
    because it forms part of a FROM clause, where a placeholder is not
    allowed. `_SOURCE_FILE_ID` is the whole of the defence, so it stays next
    to the interpolation where it cannot be overlooked.
    """
    if not source_file_id:
        return view if not alias else f"{view} {alias}"
    if not _SOURCE_FILE_ID.match(source_file_id):
        raise ValueError(f"Not a source file id: {source_file_id!r}")
    # A subquery must be named, and a query that already names the table its
    # own way keeps that name — otherwise the expression carries two aliases
    # and Postgres rejects it.
    return (
        f"(SELECT * FROM {base} WHERE {key} = '{source_file_id}') AS {alias or view}"
    )


class DiscoverDatasetRepository:
    def __init__(self, db_url: str, source_file_id: str = "") -> None:
        """
        `source_file_id` pins this repository to one table.

        Left out, every read follows the session's active table, which is what
        the screens want. Given, the reads are pinned to that table whatever
        the session's active one happens to be — so a worker checking table
        three is unaffected by another worker, or by the person clicking a tab
        while it runs. A pinned repository is one worker's own object; nothing
        is shared between them but the database.
        """
        self._db_url = db_url
        self._source_file_id = source_file_id
        self._rows = _scoped(
            "active_source_row", "discovery_source_row", "source_file_id", source_file_id
        )
        self._cols = _scoped(
            "active_source_column", "source_column", "source_file_id", source_file_id
        )
        # The mapped-column join names these its own way.
        self._cols_sc = _scoped(
            "active_source_column", "source_column", "source_file_id", source_file_id, "sc"
        )
        self._dcols_dc = _scoped(
            "active_discovery_column", "discovery_column", "source_file_id",
            source_file_id, "dc",
        )
        self._parsed = _scoped(
            "active_parsed_file", "discovery_parsed_file", "source_file_id", source_file_id
        )
        self._dcols = _scoped(
            "active_discovery_column", "discovery_column", "source_file_id", source_file_id
        )

    def for_table(self, source_file_id: str) -> "DiscoverDatasetRepository":
        """The same repository, reading one named table instead of the active one."""
        return DiscoverDatasetRepository(self._db_url, source_file_id)

    # ── writes ───────────────────────────────────────────────────────────────

    def persist_parsed_file(
        self,
        session_id: str,
        source_file_id: str,
        parsed: ParsedSourceFile,
    ) -> None:
        """
        Store this file's real headers and rows.

        A session holds several files, so only this file's own content is
        replaced — re-uploading one file must not wipe the others.
        """
        now = utc_now_iso()
        with get_connection(self._db_url) as conn:
            conn.execute(
                "DELETE FROM discovery_source_row WHERE source_file_id = %s",
                (source_file_id,),
            )
            conn.execute(
                "DELETE FROM discovery_parsed_file WHERE source_file_id = %s",
                (source_file_id,),
            )
            conn.execute(
                "INSERT INTO discovery_parsed_file "
                "(parsed_file_id, session_id, source_file_id, column_labels_json, "
                "internal_names_json, row_count, column_count, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    f"pf_{uuid4().hex[:12]}",
                    session_id,
                    source_file_id,
                    json.dumps(parsed.column_labels),
                    json.dumps(parsed.internal_names),
                    parsed.row_count,
                    parsed.column_count,
                    now,
                ),
            )

            batch: list[tuple] = []
            for row_number, row in enumerate(parsed.rows, start=1):
                batch.append(
                    (
                        f"dsr_{uuid4().hex[:12]}",
                        session_id,
                        source_file_id,
                        row_number,
                        json.dumps(row, ensure_ascii=False),
                        now,
                    )
                )
                if len(batch) >= _INSERT_BATCH_SIZE:
                    self._insert_rows(conn, batch)
                    batch = []
            if batch:
                self._insert_rows(conn, batch)

    @staticmethod
    def _insert_rows(conn, batch: list[tuple]) -> None:
        values_sql = ", ".join(["(%s, %s, %s, %s, %s::jsonb, %s)"] * len(batch))
        params: list = []
        for entry in batch:
            params.extend(entry)
        conn.execute(
            "INSERT INTO discovery_source_row "
            "(row_id, session_id, source_file_id, row_number, row_data, created_at) "
            f"VALUES {values_sql}",
            params,
        )

    def delete_for_file(self, source_file_id: str) -> None:
        """Remove one file's parsed content, leaving the session's others intact."""
        with get_connection(self._db_url) as conn:
            conn.execute(
                "DELETE FROM discovery_source_row WHERE source_file_id = %s",
                (source_file_id,),
            )
            conn.execute(
                "DELETE FROM discovery_parsed_file WHERE source_file_id = %s",
                (source_file_id,),
            )

    def clear_validation_results(self, source_file_id: str) -> None:
        """
        Remove earlier validation results (and their issues, which cascade) so a
        re-run reports this file's issues rather than accumulating them.
        """
        with get_connection(self._db_url) as conn:
            conn.execute(
                "DELETE FROM discovery_import_validation_result WHERE source_file_id = %s",
                (source_file_id,),
            )

    def clear_quality_checks(self, source_file_id: str) -> None:
        """
        Drop the findings and run records for this file, so the Quality step
        returns to its first-run state instead of reporting on data that is no
        longer there. Other files in the session keep their results.

        Runs go with the findings deliberately. A run is evidence about bytes
        that are no longer in the session, and leaving it behind would make the
        newest run of a file that has none.
        """
        with get_connection(self._db_url) as conn:
            conn.execute(
                "DELETE FROM discovery_quality_check WHERE source_file_id = %s",
                (source_file_id,),
            )
            conn.execute(
                "DELETE FROM discovery_quality_run WHERE source_file_id = %s",
                (source_file_id,),
            )

    def clear_profiling_results(self, source_file_id: str) -> None:
        """
        Drop the profile computed for one file. source_column and
        column_profile_result cascade from source_dataset, so removing this
        file's dataset clears its whole legacy profile projection — and only its.
        """
        with get_connection(self._db_url) as conn:
            conn.execute(
                "DELETE FROM source_dataset WHERE source_file_id = %s", (source_file_id,)
            )

    # ── reads ────────────────────────────────────────────────────────────────

    def get_parsed_file(self, session_id: str, source_file_id: str = "") -> dict | None:
        """
        The persisted header/shape metadata of one table.

        Without a source_file_id this is the table being worked on, which is
        what the screens want. With one it is that table, which is what a
        worker wants: several of them profile different tables of the same
        session at once, and "the active one" is not a thing they can share.
        """
        columns = (
            "parsed_file_id, session_id, source_file_id, column_labels_json, "
            "internal_names_json, row_count, column_count, created_at"
        )
        with get_connection(self._db_url) as conn:
            if source_file_id:
                row = conn.execute(
                    f"SELECT {columns} FROM discovery_parsed_file WHERE source_file_id = %s "
                    "ORDER BY created_at DESC LIMIT 1",
                    (source_file_id,),
                ).fetchone()
            else:
                row = conn.execute(
                    f"SELECT {columns} FROM {self._parsed} WHERE session_id = %s "
                    "ORDER BY created_at DESC LIMIT 1",
                    (session_id,),
                ).fetchone()
        if row is None:
            return None
        return {
            "parsed_file_id": row["parsed_file_id"],
            "session_id": row["session_id"],
            "source_file_id": row["source_file_id"],
            "column_labels": json.loads(row["column_labels_json"]),
            "internal_names": json.loads(row["internal_names_json"]),
            "row_count": row["row_count"],
            "column_count": row["column_count"],
            "created_at": row["created_at"],
        }

    def list_rows(self, session_id: str, limit: int = 50, offset: int = 0) -> list[dict]:
        """Return persisted data rows for the session, oldest first."""
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                f"SELECT row_number, row_data FROM {self._rows} "
                "WHERE session_id = %s ORDER BY row_number OFFSET %s LIMIT %s",
                (session_id, max(0, offset), max(1, min(limit, 1000))),
            ).fetchall()
        return [
            {"row_number": row["row_number"], "row_data": row["row_data"]}
            for row in rows
        ]

    def count_rows(self, session_id: str, source_file_id: str = "") -> int:
        with get_connection(self._db_url) as conn:
            if source_file_id:
                row = conn.execute(
                    "SELECT COUNT(*) AS total FROM discovery_source_row "
                    "WHERE source_file_id = %s",
                    (source_file_id,),
                ).fetchone()
            else:
                row = conn.execute(
                    f"SELECT COUNT(*) AS total FROM {self._rows} WHERE session_id = %s",
                    (session_id,),
                ).fetchone()
        return int(row["total"]) if row else 0

    def sample_column_values(
        self,
        session_id: str,
        internal_name: str,
        limit: int = TYPE_SAMPLE_SIZE,
        source_file_id: str = "",
    ) -> list[str]:
        """Return the first N values of a column, for data-driven type inference."""
        if source_file_id:
            with get_connection(self._db_url) as conn:
                rows = conn.execute(
                    "SELECT COALESCE(row_data->>%s, '') AS value FROM discovery_source_row "
                    "WHERE source_file_id = %s ORDER BY row_number LIMIT %s",
                    (internal_name, source_file_id, limit),
                ).fetchall()
            return [row["value"] for row in rows]
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                f"SELECT COALESCE(row_data->>%s, '') AS value FROM {self._rows} "
                "WHERE session_id = %s ORDER BY row_number LIMIT %s",
                (internal_name, session_id, limit),
            ).fetchall()
        return [row["value"] for row in rows]

    # ── automatic profiling metrics ──────────────────────────────────────────
    # Everything below is computed from the stored rows alone: no rule, model
    # constraint or configuration is needed, which is what separates profiling
    # from the governed quality checks.

    #: Values matching this are treated as numbers for min/max and outliers.
    NUMERIC_RE = r"^-?\d+(\.\d+)?$"

    def column_extremes(self, session_id: str, internal_name: str, datatype: str) -> dict:
        """
        Smallest and largest value in a column, plus the shortest and longest
        text length. Numeric and date columns are ordered by value; everything
        else falls back to ordinary text ordering.
        """
        numeric = datatype in ("Integer", "Decimal")
        with get_connection(self._db_url) as conn:
            if numeric:
                row = conn.execute(
                    "SELECT MIN(v)::text AS min_value, MAX(v)::text AS max_value FROM ("
                    f"  SELECT (row_data->>%s)::numeric AS v FROM {self._rows} "
                    "  WHERE session_id = %s AND COALESCE(row_data->>%s, '') ~ %s"
                    ") t",
                    (internal_name, session_id, internal_name, self.NUMERIC_RE),
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT MIN(v) AS min_value, MAX(v) AS max_value FROM ("
                    f"  SELECT row_data->>%s AS v FROM {self._rows} "
                    "  WHERE session_id = %s AND COALESCE(row_data->>%s, '') <> ''"
                    ") t",
                    (internal_name, session_id, internal_name),
                ).fetchone()

            lengths = conn.execute(
                "SELECT MIN(LENGTH(v)) AS min_length, MAX(LENGTH(v)) AS max_length FROM ("
                f"  SELECT row_data->>%s AS v FROM {self._rows} "
                "  WHERE session_id = %s AND COALESCE(row_data->>%s, '') <> ''"
                ") t",
                (internal_name, session_id, internal_name),
            ).fetchone()

        return {
            "min_value": row["min_value"] if row else None,
            "max_value": row["max_value"] if row else None,
            "min_length": int(lengths["min_length"]) if lengths and lengths["min_length"] is not None else None,
            "max_length": int(lengths["max_length"]) if lengths and lengths["max_length"] is not None else None,
        }

    def column_patterns(
        self, session_id: str, internal_name: str, limit: int = 5
    ) -> list[dict]:
        """
        The shapes values take, most common first. Each value is masked —
        letters become A/a and digits 9, punctuation is kept — so "C-001" and
        "C-002" collapse to the single pattern "A-999". Values longer than 40
        characters are grouped as free text rather than producing a giant mask.
        """
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT pattern, COUNT(*) AS count, MIN(v) AS example FROM ("
                "  SELECT v, CASE WHEN LENGTH(v) > 40 THEN '(long text)' ELSE "
                "    regexp_replace("
                "      regexp_replace("
                "        regexp_replace(v, '[A-Z]', 'A', 'g'),"
                "      '[a-z]', 'a', 'g'),"
                "    '[0-9]', '9', 'g') END AS pattern "
                f"  FROM (SELECT row_data->>%s AS v FROM {self._rows} "
                "        WHERE session_id = %s AND COALESCE(row_data->>%s, '') <> '') raw"
                ") masked GROUP BY pattern ORDER BY COUNT(*) DESC, pattern LIMIT %s",
                (internal_name, session_id, internal_name, limit),
            ).fetchall()
        return [
            {"pattern": r["pattern"], "count": int(r["count"]), "example": r["example"]}
            for r in rows
        ]

    def column_outliers(self, session_id: str, internal_name: str) -> dict:
        """
        Numeric values that sit far outside the middle of the distribution,
        using the interquartile rule (below Q1 − 1.5×IQR or above Q3 + 1.5×IQR).
        Returns an empty result for columns with no usable numbers.
        """
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "WITH nums AS ("
                f"  SELECT (row_data->>%s)::numeric AS v FROM {self._rows} "
                "  WHERE session_id = %s AND COALESCE(row_data->>%s, '') ~ %s"
                "), bounds AS ("
                "  SELECT percentile_cont(0.25) WITHIN GROUP (ORDER BY v) AS q1, "
                "         percentile_cont(0.75) WITHIN GROUP (ORDER BY v) AS q3, "
                "         COUNT(*) AS n FROM nums"
                ") "
                "SELECT b.n, "
                "       (b.q1 - 1.5 * (b.q3 - b.q1))::text AS lower_bound, "
                "       (b.q3 + 1.5 * (b.q3 - b.q1))::text AS upper_bound, "
                "       COUNT(*) FILTER ("
                "         WHERE n.v < b.q1 - 1.5 * (b.q3 - b.q1) "
                "            OR n.v > b.q3 + 1.5 * (b.q3 - b.q1)) AS outliers "
                "FROM nums n CROSS JOIN bounds b GROUP BY b.n, b.q1, b.q3",
                (internal_name, session_id, internal_name, self.NUMERIC_RE),
            ).fetchone()

            if row is None or int(row["n"] or 0) < 4 or int(row["outliers"] or 0) == 0:
                return {
                    "count": 0,
                    "lower_bound": row["lower_bound"] if row else None,
                    "upper_bound": row["upper_bound"] if row else None,
                    "samples": [],
                    "numeric_values": int(row["n"]) if row else 0,
                }

            samples = conn.execute(
                "WITH nums AS ("
                f"  SELECT (row_data->>%s)::numeric AS v, row_number FROM {self._rows} "
                "  WHERE session_id = %s AND COALESCE(row_data->>%s, '') ~ %s"
                ") SELECT v::text AS value, row_number FROM nums "
                "WHERE v < %s::numeric OR v > %s::numeric ORDER BY row_number LIMIT 5",
                (
                    internal_name, session_id, internal_name, self.NUMERIC_RE,
                    row["lower_bound"], row["upper_bound"],
                ),
            ).fetchall()

        return {
            "count": int(row["outliers"]),
            "lower_bound": row["lower_bound"],
            "upper_bound": row["upper_bound"],
            "samples": [{"value": s["value"], "row_number": int(s["row_number"])} for s in samples],
            "numeric_values": int(row["n"]),
        }

    def get_discovery_column(
        self, session_id: str, discovery_column_id: str
    ) -> dict | None:
        """Look up one persisted discovery column by its id."""
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT discovery_column_id, session_id, source_file_id, source_label, "
                "internal_name, inferred_datatype, ordinal, is_nullable, duplicate_group_key "
                "FROM active_discovery_column WHERE session_id = %s AND discovery_column_id = %s",
                (session_id, discovery_column_id),
            ).fetchone()
        return None if row is None else dict(row)

    def column_value_counts(
        self, session_id: str, internal_name: str, limit: int = 50
    ) -> list[dict]:
        """
        Return the column's distinct values with how often each occurs — the
        real variants of the field — most frequent first.
        """
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT COALESCE(row_data->>%s, '') AS value, COUNT(*) AS count "
                f"FROM {self._rows} WHERE session_id = %s "
                "GROUP BY 1 ORDER BY COUNT(*) DESC, 1 LIMIT %s",
                (internal_name, session_id, max(1, min(limit, 1000))),
            ).fetchall()
        return [{"value": row["value"], "count": int(row["count"])} for row in rows]

    def profile_column(
        self, session_id: str, internal_name: str, source_file_id: str = ""
    ) -> dict:
        """
        Compute real statistics for one column directly in Postgres, so large
        files are never loaded into memory.

        Naming the table matters here: workers profile several tables of one
        session at the same time, and "the active table" is a single value they
        would otherwise be fighting over.
        """
        # An id given here wins; otherwise the repository's own scope applies,
        # which is the active table unless this repository was pinned to one.
        pinned = source_file_id or self._source_file_id
        scope = "source_file_id = %s" if pinned else "session_id = %s"
        source = "discovery_source_row" if pinned else "active_source_row"
        key = pinned or session_id
        with get_connection(self._db_url) as conn:
            stats = conn.execute(
                "SELECT COUNT(*) AS total_rows, "
                "COUNT(*) FILTER (WHERE COALESCE(row_data->>%s, '') = '') AS blank_count, "
                "COUNT(DISTINCT row_data->>%s) "
                "  FILTER (WHERE COALESCE(row_data->>%s, '') <> '') AS distinct_count "
                f"FROM {source} WHERE {scope}",
                (internal_name, internal_name, internal_name, key),
            ).fetchone()

            distribution_rows = conn.execute(
                "SELECT COALESCE(row_data->>%s, '') AS value, COUNT(*) AS count "
                f"FROM {source} WHERE {scope} "
                "GROUP BY 1 ORDER BY COUNT(*) DESC, 1 LIMIT %s",
                (internal_name, key, DISTRIBUTION_LIMIT),
            ).fetchall()

        total_rows = int(stats["total_rows"]) if stats else 0
        blank_count = int(stats["blank_count"]) if stats else 0
        distinct_count = int(stats["distinct_count"]) if stats else 0
        return {
            "total_rows": total_rows,
            "blank_count": blank_count,
            "non_blank_count": total_rows - blank_count,
            "distinct_count": distinct_count,
            "value_distribution": [
                {"value": row["value"] or "(blank)", "count": int(row["count"])}
                for row in distribution_rows
            ],
        }

    # ── data-quality queries ─────────────────────────────────────────────────

    @staticmethod
    def _ignore_clause(internal_name: str, ignored: list[str] | None) -> tuple[str, tuple]:
        """
        SQL that leaves out the values a rule says mean "no answer yet".

        A source system rarely leaves a cell empty — it writes "unknown" or
        "not applicable". Those rows are neither right nor wrong, so they are
        removed from the question entirely rather than counted as failures.
        Matched without regard to case, because the same placeholder is written
        both ways in the same file.
        """
        values = [str(v).strip().lower() for v in (ignored or []) if str(v).strip()]
        if not values:
            return "", ()
        return (
            " AND LOWER(COALESCE(row_data->>%s, '')) <> ALL(%s)",
            (internal_name, values),
        )

    def column_counts(
        self, session_id: str, internal_name: str, ignored: list[str] | None = None
    ) -> dict:
        """
        Row counts for one column with the ignored values left out, for the
        checks that are judged by counting rather than by testing each value.
        """
        clause, params = self._ignore_clause(internal_name, ignored)
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS total, "
                "COUNT(*) FILTER (WHERE COALESCE(row_data->>%s, '') = '') AS blank, "
                "COUNT(DISTINCT row_data->>%s) "
                "  FILTER (WHERE COALESCE(row_data->>%s, '') <> '') AS distinct_count "
                f"FROM {self._rows} WHERE session_id = %s{clause}",
                (internal_name, internal_name, internal_name, session_id, *params),
            ).fetchone()
        total = int(row["total"]) if row else 0
        blank = int(row["blank"]) if row else 0
        distinct = int(row["distinct_count"]) if row else 0
        filled = total - blank
        return {
            "total": total,
            "missing": blank,
            "filled": filled,
            "distinct": distinct,
            "duplicates": max(0, filled - distinct),
        }

    def duplicate_values(
        self, session_id: str, internal_name: str, limit: int = 5,
        ignored: list[str] | None = None,
    ) -> list[dict]:
        """Values that appear more than once in a column, most repeated first."""
        clause, ig = self._ignore_clause(internal_name, ignored)
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT row_data->>%s AS value, COUNT(*) AS count "
                f"FROM {self._rows} "
                f"WHERE session_id = %s AND COALESCE(row_data->>%s, '') <> ''{clause} "
                "GROUP BY 1 HAVING COUNT(*) > 1 "
                "ORDER BY COUNT(*) DESC, 1 LIMIT %s",
                (internal_name, session_id, internal_name, *ig, limit),
            ).fetchall()
        return [{"value": row["value"], "count": int(row["count"])} for row in rows]

    def type_violations(
        self,
        session_id: str,
        internal_name: str,
        pattern: str,
        case_insensitive: bool = False,
        sample_limit: int = 5,
        ignored: list[str] | None = None,
    ) -> dict:
        """
        Count (and sample) the values in a column that do not match the shape
        the field's datatype requires.
        """
        operator = "!~*" if case_insensitive else "!~"
        clause, ig = self._ignore_clause(internal_name, ignored)
        with get_connection(self._db_url) as conn:
            count_row = conn.execute(
                f"SELECT COUNT(*) AS violations FROM {self._rows} "
                f"WHERE session_id = %s AND COALESCE(row_data->>%s, '') <> ''{clause} "
                f"AND row_data->>%s {operator} %s",
                (session_id, internal_name, *ig, internal_name, pattern),
            ).fetchone()
            sample_rows = conn.execute(
                f"SELECT DISTINCT row_data->>%s AS value FROM {self._rows} "
                f"WHERE session_id = %s AND COALESCE(row_data->>%s, '') <> ''{clause} "
                f"AND row_data->>%s {operator} %s LIMIT %s",
                (internal_name, session_id, internal_name, *ig, internal_name, pattern, sample_limit),
            ).fetchall()
        return {
            "violations": int(count_row["violations"]) if count_row else 0,
            "samples": [row["value"] for row in sample_rows],
        }

    def invalid_date_values(
        self,
        session_id: str,
        internal_name: str,
        date_format: str = "any",
        sample_limit: int = 5,
        ignored: list[str] | None = None,
    ) -> dict:
        """
        Count (and sample) values in a date column that are not real calendar
        dates in the stated format. Shape alone is not enough — `31/02/2026`
        looks like a date and is not one — so this asks Postgres's calendar,
        not a pattern, and asks it in the convention the field actually uses.
        """
        clause, ig = self._ignore_clause(internal_name, ignored)
        with get_connection(self._db_url) as conn:
            count_row = conn.execute(
                f"SELECT COUNT(*) AS violations FROM {self._rows} "
                f"WHERE session_id = %s AND COALESCE(row_data->>%s, '') <> ''{clause} "
                "AND NOT pdp_is_valid_date(row_data->>%s, %s)",
                (session_id, internal_name, *ig, internal_name, date_format),
            ).fetchone()
            sample_rows = conn.execute(
                f"SELECT DISTINCT row_data->>%s AS value FROM {self._rows} "
                f"WHERE session_id = %s AND COALESCE(row_data->>%s, '') <> ''{clause} "
                "AND NOT pdp_is_valid_date(row_data->>%s, %s) LIMIT %s",
                (internal_name, session_id, internal_name, *ig, internal_name,
                 date_format, sample_limit),
            ).fetchall()
        return {
            "violations": int(count_row["violations"]) if count_row else 0,
            "samples": [row["value"] for row in sample_rows],
        }

    def values_outside_list(
        self,
        session_id: str,
        internal_name: str,
        allowed: list[str],
        case_sensitive: bool = False,
        sample_limit: int = 5,
        ignored: list[str] | None = None,
        count_blanks: bool = True,
    ) -> dict:
        """
        Count (and sample) values that are not in an approved reference list —
        the DQ-ALLOWED-VALUES rule, where the list is a session parameter.

        A blank counts as a breach by default: no vocabulary contains the empty
        string, so a row with nothing in the field is not carrying an approved
        value. They are counted apart as well, because "2,253 wrong values and
        129,434 empty ones" is two different pieces of work.
        """
        if not allowed:
            return {"violations": 0, "samples": [], "blanks": 0, "populated_violations": 0}
        expression = "row_data->>%s" if case_sensitive else "LOWER(row_data->>%s)"
        candidates = allowed if case_sensitive else [str(a).lower() for a in allowed]
        placeholders = ", ".join(["%s"] * len(candidates))
        clause, ig = self._ignore_clause(internal_name, ignored)
        with get_connection(self._db_url) as conn:
            count_row = conn.execute(
                f"SELECT COUNT(*) AS violations FROM {self._rows} "
                f"WHERE session_id = %s AND COALESCE(row_data->>%s, '') <> ''{clause} "
                f"AND {expression} NOT IN ({placeholders})",
                (session_id, internal_name, *ig, internal_name, *candidates),
            ).fetchone()
            # Rows with nothing in the field. An empty cell is not one of the
            # approved values, so it breaks the rule as surely as a wrong one
            # does — and it was the larger half of the breach on the file this
            # was found with: 129,434 blank rows reported as passing while the
            # approved list held two voltages.
            blank_row = conn.execute(
                f"SELECT COUNT(*) AS blanks FROM {self._rows} "
                f"WHERE session_id = %s AND COALESCE(row_data->>%s, '') = ''",
                (session_id, internal_name),
            ).fetchone()
            sample_rows = conn.execute(
                f"SELECT DISTINCT row_data->>%s AS value FROM {self._rows} "
                f"WHERE session_id = %s AND COALESCE(row_data->>%s, '') <> ''{clause} "
                f"AND {expression} NOT IN ({placeholders}) LIMIT %s",
                (
                    internal_name, session_id, internal_name, *ig, internal_name,
                    *candidates, sample_limit,
                ),
            ).fetchall()
        populated = int(count_row["violations"]) if count_row else 0
        blanks = int(blank_row["blanks"]) if blank_row else 0
        if not count_blanks:
            blanks = 0
        return {
            "violations": populated + blanks,
            "populated_violations": populated,
            "blanks": blanks,
            "samples": [row["value"] for row in sample_rows],
        }

    def values_outside_range(
        self,
        session_id: str,
        internal_name: str,
        min_value: float | None,
        max_value: float | None,
        sample_limit: int = 5,
        ignored: list[str] | None = None,
    ) -> dict:
        """
        Count (and sample) numeric values outside an expected range. Values that
        are not numeric at all are left to the type check rather than reported
        twice here.
        """
        if min_value is None and max_value is None:
            return {"violations": 0, "samples": [], "non_numeric": 0}
        numeric = (
            "COALESCE(row_data->>%s, '') ~ '^-?[0-9]+(\\.[0-9]+)?$'"
        )
        bounds, params_tail = [], []
        if min_value is not None:
            bounds.append("(row_data->>%s)::numeric < %s")
            params_tail.extend([internal_name, min_value])
        if max_value is not None:
            bounds.append("(row_data->>%s)::numeric > %s")
            params_tail.extend([internal_name, max_value])
        clause, ig = self._ignore_clause(internal_name, ignored)
        where = (
            f"session_id = %s AND COALESCE(row_data->>%s, '') <> ''{clause} "
            f"AND {numeric} AND ({' OR '.join(bounds)})"
        )
        head = (session_id, internal_name, *ig, internal_name)
        with get_connection(self._db_url) as conn:
            count_row = conn.execute(
                f"SELECT COUNT(*) AS violations FROM {self._rows} WHERE {where}",
                (*head, *params_tail),
            ).fetchone()
            sample_rows = conn.execute(
                f"SELECT DISTINCT row_data->>%s AS value FROM {self._rows} "
                f"WHERE {where} LIMIT %s",
                (internal_name, *head, *params_tail, sample_limit),
            ).fetchall()
            non_numeric = conn.execute(
                f"SELECT COUNT(*) AS c FROM {self._rows} "
                f"WHERE session_id = %s AND COALESCE(row_data->>%s, '') <> '' AND NOT {numeric}",
                (session_id, internal_name, internal_name),
            ).fetchone()
        return {
            "violations": int(count_row["violations"]) if count_row else 0,
            "samples": [row["value"] for row in sample_rows],
            "non_numeric": int(non_numeric["c"]) if non_numeric else 0,
        }

    def values_failing_comparison(
        self,
        session_id: str,
        internal_name: str,
        sql_operator: str,
        value: float,
        sample_limit: int = 5,
    ) -> dict:
        """
        Count (and sample) numeric values that do NOT satisfy a comparison.

        The rule states what must be true — "at least 8" — so what is reported is
        its negation, the rows that break it. Non-numeric values cannot satisfy a
        numeric comparison and cannot be judged against it either, so they are
        counted separately rather than silently swelling the violation count and
        making a type problem look like a threshold breach.

        `sql_operator` is never taken from user input: the caller resolves it
        from a comparator key through `rule_builder.comparator_sql`, so only the
        six known operators can ever reach this string.
        """
        if sql_operator not in (">", ">=", "<", "<=", "=", "<>"):
            raise ValueError(f"Unsupported comparison operator: {sql_operator!r}")

        numeric = "COALESCE(row_data->>%s, '') ~ '^-?[0-9]+(\\.[0-9]+)?$'"
        # The violation is the negation of the rule, over numeric values only.
        where = (
            "session_id = %s AND COALESCE(row_data->>%s, '') <> '' "
            f"AND {numeric} AND NOT ((row_data->>%s)::numeric {sql_operator} %s)"
        )
        params = (session_id, internal_name, internal_name, internal_name, value)
        with get_connection(self._db_url) as conn:
            count_row = conn.execute(
                f"SELECT COUNT(*) AS violations FROM {self._rows} WHERE {where}",
                params,
            ).fetchone()
            sample_rows = conn.execute(
                f"SELECT DISTINCT row_data->>%s AS value FROM {self._rows} "
                f"WHERE {where} LIMIT %s",
                (internal_name, *params, sample_limit),
            ).fetchall()
            non_numeric = conn.execute(
                f"SELECT COUNT(*) AS c FROM {self._rows} "
                f"WHERE session_id = %s AND COALESCE(row_data->>%s, '') <> '' AND NOT {numeric}",
                (session_id, internal_name, internal_name),
            ).fetchone()
            comparable = conn.execute(
                f"SELECT COUNT(*) AS c FROM {self._rows} "
                f"WHERE session_id = %s AND COALESCE(row_data->>%s, '') <> '' AND {numeric}",
                (session_id, internal_name, internal_name),
            ).fetchone()
        return {
            "violations": int(count_row["violations"]) if count_row else 0,
            "samples": [row["value"] for row in sample_rows],
            "non_numeric": int(non_numeric["c"]) if non_numeric else 0,
            "comparable": int(comparable["c"]) if comparable else 0,
        }

    def value_counts_by_group(
        self, session_id: str, internal_name: str, group_by_internal: str | None = None
    ) -> list[dict]:
        """
        How often each value of a field occurs, optionally split by another
        field — the raw counts a classification-share rule is evaluated from.
        """
        with get_connection(self._db_url) as conn:
            if group_by_internal:
                rows = conn.execute(
                    "SELECT COALESCE(row_data->>%s, '(no value)') AS group_value, "
                    "COALESCE(row_data->>%s, '') AS value, COUNT(*) AS count "
                    f"FROM {self._rows} WHERE session_id = %s "
                    "GROUP BY 1, 2 ORDER BY 1, 3 DESC",
                    (group_by_internal, internal_name, session_id),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT '' AS group_value, COALESCE(row_data->>%s, '') AS value, "
                    f"COUNT(*) AS count FROM {self._rows} WHERE session_id = %s "
                    "GROUP BY 1, 2 ORDER BY 3 DESC",
                    (internal_name, session_id),
                ).fetchall()
        return [
            {"group_value": r["group_value"], "value": r["value"], "count": int(r["count"])}
            for r in rows
        ]

    def missing_row_numbers(
        self, session_id: str, internal_name: str, limit: int = 5
    ) -> list[int]:
        """Row numbers where a column has no value — so a user can go and fix them."""
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                f"SELECT row_number FROM {self._rows} "
                "WHERE session_id = %s AND COALESCE(row_data->>%s, '') = '' "
                "ORDER BY row_number LIMIT %s",
                (session_id, internal_name, limit),
            ).fetchall()
        return [int(row["row_number"]) for row in rows]

    def value_overlap(
        self, session_id: str, left_name: str, right_name: str, sample_limit: int = 3
    ) -> dict:
        """
        Distinct values that appear in both columns. A real overlap between two
        different fields usually means shifted or copy-pasted data.
        """
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT value FROM ("
                f"  SELECT DISTINCT row_data->>%s AS value FROM {self._rows} "
                "  WHERE session_id = %s AND COALESCE(row_data->>%s, '') <> '' "
                "  INTERSECT "
                f"  SELECT DISTINCT row_data->>%s FROM {self._rows} "
                "  WHERE session_id = %s AND COALESCE(row_data->>%s, '') <> '' "
                ") shared ORDER BY value",
                (left_name, session_id, left_name, right_name, session_id, right_name),
            ).fetchall()
        values = [row["value"] for row in rows]
        return {"shared_count": len(values), "samples": values[:sample_limit]}

    def placeholder_counts(
        self, session_id: str, internal_name: str, placeholders: list[str]
    ) -> dict:
        """
        Populated values that stand in for an answer: unknown, n/a, none, "-".

        Counted here rather than inferred from the value list, because the list
        the screen shows is the top N and the stand-ins are not always at the
        top. Matched on the trimmed, lower-cased value, so "Unknown " and
        "UNKNOWN" are the same answer.
        """
        if not placeholders:
            return {"total": 0, "values": []}
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                f"SELECT row_data->>%s AS value, COUNT(*) AS n FROM {self._rows} "
                "WHERE session_id = %s "
                "  AND LOWER(BTRIM(COALESCE(row_data->>%s, ''))) = ANY(%s) "
                "GROUP BY 1 ORDER BY n DESC",
                (
                    internal_name,
                    session_id,
                    internal_name,
                    [p.lower() for p in placeholders],
                ),
            ).fetchall()
        values = [{"value": r["value"], "count": int(r["n"])} for r in rows]
        return {"total": sum(v["count"] for v in values), "values": values}

    def duplicate_rows(self, session_id: str, internal_names: list[str]) -> dict:
        """
        Rows that repeat across the given columns — the same record twice.

        The keys matter. This once hashed the whole stored row whatever it was
        asked for, while the row-level counter that feeds "what is breaking"
        partitioned by the columns it was given. On a session with one mapped
        field the two answered the same question differently: "no two rows
        repeat" sat directly above "137,908 duplicate rows, 100%", and the
        second number drove the headline. One definition now, used by both.

        The whole-row hash survives as a fast path for the case it was written
        for — every column of the table, which is what Profile asks for. A row
        holds exactly the columns the file was parsed into and jsonb keeps its
        keys in a canonical order, so hashing the whole value asks the same
        question as listing all of them, once per row instead of ninety times.
        On a 90-column, 140,000-row file that is ten seconds against one.
        """
        if not internal_names:
            return {"duplicate_groups": 0, "duplicate_rows": 0}

        with get_connection(self._db_url) as conn:
            parsed = self.get_parsed_file(session_id)
            all_columns = set((parsed or {}).get("internal_names") or [])
            whole_row = bool(all_columns) and set(internal_names) >= all_columns

            if whole_row:
                grouping, params = "md5(row_data::text)", (session_id,)
            else:
                grouping = ", ".join(["row_data->>%s"] * len(internal_names))
                params = (session_id, *internal_names)

            # Two numbers, because two questions are asked of this. Three
            # identical rows are three rows *involved* in a repeat and two
            # rows that have to go. `duplicate_rows` is the first — what
            # Profile reports. `duplicate_copies` is the second, and it is
            # exactly what the row-level counter produces
            # (ROW_NUMBER() OVER (PARTITION BY ...) > 1), so a rule and the
            # rows it flags can no longer disagree.
            row = conn.execute(
                "SELECT COUNT(*) AS groups, COALESCE(SUM(c - 1), 0) AS copies, "
                "       COALESCE(SUM(c), 0) AS in_groups FROM ("
                f"  SELECT COUNT(*) AS c FROM {self._rows} WHERE session_id = %s "
                f"  GROUP BY {grouping} HAVING COUNT(*) > 1"
                ") d",
                params,
            ).fetchone()
        return {
            "duplicate_groups": int(row["groups"]) if row else 0,
            "duplicate_rows": int(row["in_groups"]) if row else 0,
            "duplicate_copies": int(row["copies"]) if row else 0,
            # Both sides of the screen can now say what "duplicate" meant here.
            "duplicate_keys": [] if whole_row else list(internal_names),
            "compared_on": "every column" if whole_row else f"{len(internal_names)} field(s)",
        }

    def row_usability(
        self, session_id: str, specs: list[dict], duplicate_keys: list[str]
    ) -> dict:
        """
        Decide, row by row, whether a record is usable.

        A row is unusable when any mapped field breaks a rule the model sets —
        a required value is missing, a value does not fit the field's type, or a
        value repeats in a field that must be unique — or when the row is a
        duplicate copy of another. Everything is evaluated in one pass so rows
        with several problems are still counted once.

        `specs` carries one entry per mapped field:
            internal_name, required, unique, pattern, case_insensitive
        """
        conditions: list[str] = []
        params: list = []

        for spec in specs:
            name = spec["internal_name"]
            if spec.get("required"):
                conditions.append("COALESCE(row_data->>%s, '') = ''")
                params.append(name)
            if spec.get("is_date"):
                # Dates are judged by the calendar, not by their shape, so the
                # row-level verdict has to agree with the field-level check.
                conditions.append(
                    "(COALESCE(row_data->>%s, '') <> '' "
                    "AND NOT pdp_is_valid_date(row_data->>%s, %s))"
                )
                params.extend([name, name, spec.get("date_format") or "any"])
            elif spec.get("pattern"):
                operator = "!~*" if spec.get("case_insensitive") else "!~"
                conditions.append(
                    f"(COALESCE(row_data->>%s, '') <> '' AND row_data->>%s {operator} %s)"
                )
                params.extend([name, name, spec["pattern"]])
            if spec.get("unique"):
                conditions.append(
                    "(COALESCE(row_data->>%s, '') <> '' AND row_data->>%s IN ("
                    "  SELECT val FROM ("
                    f"    SELECT row_data->>%s AS val FROM {self._rows} "
                    "    WHERE session_id = %s AND COALESCE(row_data->>%s, '') <> '' "
                    "    GROUP BY 1 HAVING COUNT(*) > 1"
                    "  ) repeated"
                    "))"
                )
                params.extend([name, name, name, session_id, name])

        problem_sql = " OR ".join(conditions) if conditions else "FALSE"

        if duplicate_keys:
            partition = ", ".join(["row_data->>%s"] * len(duplicate_keys))
            dup_sql = f"ROW_NUMBER() OVER (PARTITION BY {partition} ORDER BY row_number) > 1"
            dup_params = list(duplicate_keys)
        else:
            dup_sql, dup_params = "FALSE", []

        sql = (
            "WITH flagged AS ("
            f"  SELECT ({problem_sql}) AS field_problem, ({dup_sql}) AS duplicate_copy "
            f"   FROM {self._rows} WHERE session_id = %s"
            ") "
            "SELECT COUNT(*) AS total, "
            "       COUNT(*) FILTER (WHERE field_problem OR duplicate_copy) AS unusable, "
            "       COUNT(*) FILTER (WHERE field_problem) AS field_problem_rows, "
            "       COUNT(*) FILTER (WHERE duplicate_copy) AS duplicate_copies "
            "FROM flagged"
        )

        with get_connection(self._db_url) as conn:
            row = conn.execute(sql, (*params, *dup_params, session_id)).fetchone()

        total = int(row["total"]) if row else 0
        unusable = int(row["unusable"]) if row else 0
        usable = max(0, total - unusable)
        return {
            "total_rows": total,
            "usable_rows": usable,
            "unusable_rows": unusable,
            "usable_percent": round(usable / total * 100, 1) if total else 0.0,
            "unusable_percent": round(unusable / total * 100, 1) if total else 0.0,
            "rows_with_field_problems": int(row["field_problem_rows"]) if row else 0,
            "duplicate_copies": int(row["duplicate_copies"]) if row else 0,
        }

    # ── how many ROWS a rule flags, as opposed to how many values ───────────
    #
    # `observed_count` on a finding counts offending *values* in one field.
    # Adding those up across fields counts the same row once per bad field,
    # which is how a 419,000-row dataset came to report 8.6 million rows
    # flagged. A row is one row however many of a rule's fields it breaks, so
    # a rule's tests are OR-ed together and the rows counted once.
    #
    # Each test below mirrors the WHERE tail of the violation query of the same
    # name further up this file. They are meant to agree, so change them
    # together: if one says 12 values are not in the approved list, the other
    # must say those values sit in at most 12 rows.

    _NUMERIC = "COALESCE(row_data->>%s, '') ~ '^-?[0-9]+(\\.[0-9]+)?$'"

    def _row_test_sql(self, session_id: str, test: dict) -> tuple[str, list]:
        """One row-level test as a boolean expression plus its parameters."""
        kind = test.get("kind")
        name = test.get("column") or ""
        ignore_sql, ignore_params = self._ignore_clause(name, test.get("ignored"))
        filled = f"COALESCE(row_data->>%s, '') <> ''{ignore_sql}"
        filled_params = [name, *ignore_params]
        nothing: tuple[str, list] = ("FALSE", [])

        if kind == "missing":
            return f"(COALESCE(row_data->>%s, '') = ''{ignore_sql})", [name, *ignore_params]

        if kind == "pattern":
            if not test.get("pattern"):
                return nothing
            operator = "!~*" if test.get("case_insensitive") else "!~"
            return (
                f"({filled} AND row_data->>%s {operator} %s)",
                [*filled_params, name, test["pattern"]],
            )

        if kind == "date":
            return (
                f"({filled} AND NOT pdp_is_valid_date(row_data->>%s, %s))",
                [*filled_params, name, test.get("date_format") or "any"],
            )

        if kind == "unique":
            # The repeated values themselves, then the rows carrying them. Both
            # copies of a repeated pair are flagged, which is what the field
            # check counts too.
            return (
                f"({filled} AND row_data->>%s IN ("
                "  SELECT val FROM ("
                f"    SELECT row_data->>%s AS val FROM {self._rows} "
                f"    WHERE session_id = %s AND {filled} "
                "    GROUP BY 1 HAVING COUNT(*) > 1"
                "  ) repeated))",
                [*filled_params, name, name, session_id, *filled_params],
            )

        if kind == "not_in_list":
            values = test.get("values") or []
            if not values:
                return nothing
            case_sensitive = bool(test.get("case_sensitive"))
            expression = "row_data->>%s" if case_sensitive else "LOWER(row_data->>%s)"
            candidates = values if case_sensitive else [str(v).lower() for v in values]
            placeholders = ", ".join(["%s"] * len(candidates))
            # A blank fails too, so the rows this rule flags are the same rows
            # the field check counts. Before, the row test quietly let empty
            # cells through while the field check failed them, and the two
            # halves of one result disagreed on screen.
            return (
                f"(COALESCE(row_data->>%s, '') = '' "
                f"OR ({filled} AND {expression} NOT IN ({placeholders})))",
                [name, *filled_params, name, *candidates],
            )

        if kind == "outside_range":
            bounds, tail = [], []
            if test.get("min") is not None:
                bounds.append("(row_data->>%s)::numeric < %s")
                tail.extend([name, test["min"]])
            if test.get("max") is not None:
                bounds.append("(row_data->>%s)::numeric > %s")
                tail.extend([name, test["max"]])
            if not bounds:
                return nothing
            return (
                f"({filled} AND {self._NUMERIC} AND ({' OR '.join(bounds)}))",
                [*filled_params, name, *tail],
            )

        if kind == "comparison":
            operator = test.get("operator")
            if operator not in (">", ">=", "<", "<=", "=", "<>"):
                return nothing
            return (
                f"({filled} AND {self._NUMERIC} "
                f"AND NOT ((row_data->>%s)::numeric {operator} %s))",
                [*filled_params, name, name, test["value"]],
            )

        if kind == "duplicate_row":
            keys = [k for k in (test.get("keys") or []) if k]
            if not keys:
                return nothing
            partition = ", ".join(["row_data->>%s"] * len(keys))
            # The first copy is the record; the rest are the duplicates.
            return (
                f"(ROW_NUMBER() OVER (PARTITION BY {partition} "
                "ORDER BY row_number) > 1)",
                list(keys),
            )

        return nothing

    def rows_failing_by_group(self, session_id: str, groups: list[dict]) -> dict[str, int]:
        """
        How many distinct rows each group of tests flags — in a single pass.

        `groups` is [{"key": str, "tests": [test, ...]}, ...]. The result maps
        each key to its row count, and adds `__any__` (rows failing anything at
        all, the only honest "rows flagged" for a table) and `__total__` (rows
        in the table, so a caller can see the count is within it).

        One scan, not one per group: a ninety-column table is expensive to read
        and there is no reason to read it eleven times.
        """
        selects: list[str] = []
        params: list = []
        for index, group in enumerate(groups):
            fragments: list[str] = []
            for test in group.get("tests") or []:
                sql, test_params = self._row_test_sql(session_id, test)
                if sql == "FALSE":
                    continue
                fragments.append(sql)
                params.extend(test_params)
            selects.append(f"({' OR '.join(fragments) if fragments else 'FALSE'}) AS g{index}")

        if not selects:
            return {"__any__": 0, "__total__": self.count_rows(session_id)}

        aggregates = ", ".join(
            f"COUNT(*) FILTER (WHERE g{i}) AS c{i}" for i in range(len(selects))
        )
        any_of_them = " OR ".join(f"g{i}" for i in range(len(selects)))
        sql = (
            f"WITH flagged AS (SELECT {', '.join(selects)} "
            f" FROM {self._rows} WHERE session_id = %s) "
            f"SELECT COUNT(*) AS total, {aggregates}, "
            f"       COUNT(*) FILTER (WHERE {any_of_them}) AS any_rows "
            "FROM flagged"
        )
        with get_connection(self._db_url) as conn:
            row = conn.execute(sql, (*params, session_id)).fetchone()

        if row is None:
            return {"__any__": 0, "__total__": 0}
        counted = {
            "__total__": int(row["total"]),
            "__any__": int(row["any_rows"]),
        }
        for index, group in enumerate(groups):
            counted[group["key"]] = int(row[f"c{index}"])
        return counted

    def get_node_properties(self, node_id: str) -> list[str]:
        """Property names declared on a structure node — the model's own rules."""
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT p.name FROM hierarchy_model_node_instance_property ip "
                "JOIN hierarchy_model_node_type_property p ON p.property_id = ip.property_type_id "
                "WHERE ip.node_instance_id = %s",
                (node_id,),
            ).fetchall()
        return [row["name"] for row in rows]

    def get_node_type_name(self, node_id: str) -> str | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                "SELECT t.name FROM hierarchy_model_node_instance n "
                "LEFT JOIN hierarchy_model_node_type t ON t.node_type_id = n.node_type_id "
                "WHERE n.node_instance_id = %s",
                (node_id,),
            ).fetchone()
        return row["name"] if row and row["name"] else None

    def list_mapped_columns_everywhere(self, session_id: str) -> list[dict]:
        """
        Every mapped column of the session, whichever table it belongs to.

        The active-file view is right for running checks — those read one
        table's rows — but wrong for choosing rules: a person maps three tables
        and then picks rules for what they mapped, not for whichever table
        happens to be open. Each row carries the table it came from so the
        choice can be shown table by table.
        """
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT sc.column_id, sc.column_name, sc.ordinal, sc.detected_type, "
                "       sc.source_file_id, f.original_filename AS table_name, "
                "       (f.source_file_id = s.active_source_file_id) AS is_active_table, "
                "       m.target_node_id, n.name AS target_name, "
                "       dc.internal_name, dc.inferred_datatype, dc.is_nullable "
                "FROM column_mapping m "
                "JOIN source_column sc ON sc.column_id = m.column_id "
                "JOIN discovery_source_file f ON f.source_file_id = sc.source_file_id "
                "JOIN discovery_session s ON s.session_id = f.session_id "
                "LEFT JOIN hierarchy_model_node_instance n ON n.node_instance_id = m.target_node_id "
                "LEFT JOIN discovery_column dc "
                "       ON dc.source_file_id = sc.source_file_id AND dc.source_label = sc.column_name "
                "WHERE m.session_id = %s "
                "ORDER BY f.uploaded_at, sc.ordinal",
                (session_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def list_mapped_columns(self, session_id: str) -> list[dict]:
        """
        The columns that have been mapped to a model field, joined to the
        discovery column that knows their JSON key and datatype. Only these are
        checked — unmapped columns are not part of the model yet.
        """
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT sc.column_id, sc.column_name, sc.ordinal, sc.detected_type, "
                "       m.target_node_id, n.name AS target_name, "
                "       dc.internal_name, dc.inferred_datatype, dc.is_nullable "
                "FROM column_mapping m "
                f"JOIN {self._cols_sc} ON sc.column_id = m.column_id "
                "LEFT JOIN hierarchy_model_node_instance n ON n.node_instance_id = m.target_node_id "
                f"LEFT JOIN {self._dcols_dc} "
                "       ON dc.session_id = sc.session_id AND dc.source_label = sc.column_name "
                "WHERE m.session_id = %s "
                "ORDER BY sc.ordinal",
                (session_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def record_quality_run(
        self,
        session_id: str,
        source_file_id: str,
        execution_id: str,
        findings: list[dict],
        file_hash: str = "",
        mapping_version: str = "",
        rule_version: str = "",
        mapping_snapshot: list[dict] | None = None,
        rule_snapshot: list[dict] | None = None,
        table_name: str = "",
        run_group_id: str = "",
        checked_columns: int = 0,
        rows_total: int = 0,
        requested_by: str = "",
    ) -> str:
        """
        Write one completed run, and the findings belonging to it.

        Nothing is deleted. This used to replace the previous run in place,
        which meant the only question the database could answer was "what is
        true now" — a finding could never be explained once the mapping or a
        threshold had moved, because what it was measured against was gone.

        The snapshots are what makes the run explainable rather than merely
        identifiable: `rule_version` proves two runs were measured the same
        way, and `rule_snapshot` says what that way was.

        Returns the run's id, which every one of its findings carries.
        """
        now = utc_now_iso()
        quality_run_id = f"qrun_{uuid4().hex[:12]}"
        failed = sum(1 for f in findings if f.get("status") == "failed")
        warnings = sum(1 for f in findings if f.get("status") == "warning")
        with get_connection(self._db_url) as conn:
            conn.execute(
                "INSERT INTO discovery_quality_run "
                "(quality_run_id, session_id, source_file_id, table_name, execution_id, "
                "run_group_id, status, file_hash, mapping_version, rule_version, "
                "mapping_snapshot_json, rule_snapshot_json, checked_columns, findings_total, "
                "failed_count, warning_count, rows_total, requested_by, completed_at, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
                "%s, %s, %s)",
                (
                    quality_run_id,
                    session_id,
                    source_file_id,
                    table_name,
                    execution_id,
                    run_group_id,
                    "completed",
                    file_hash,
                    mapping_version,
                    rule_version,
                    json.dumps(mapping_snapshot or [], ensure_ascii=False),
                    json.dumps(rule_snapshot or [], ensure_ascii=False),
                    checked_columns,
                    len(findings),
                    failed,
                    warnings,
                    rows_total,
                    requested_by,
                    now,
                    now,
                ),
            )
            for finding in findings:
                conn.execute(
                    "INSERT INTO discovery_quality_check "
                    "(quality_check_id, session_id, source_file_id, execution_id, scope, "
                    "column_id, column_name, target_node_id, target_name, check_type, status, "
                    "rule_source, observed_count, total_count, metric_value, message, "
                    "detail_json, created_at, file_hash, mapping_version, rule_version, "
                    "quality_run_id) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
                    "%s, %s, %s, %s, %s, %s)",
                    (
                        f"qc_{uuid4().hex[:12]}",
                        session_id,
                        source_file_id,
                        execution_id,
                        finding.get("scope", "column"),
                        finding.get("column_id"),
                        finding["column_name"],
                        finding.get("target_node_id"),
                        finding.get("target_name"),
                        finding["check_type"],
                        finding["status"],
                        finding.get("rule_source", "default"),
                        finding.get("observed_count", 0),
                        finding.get("total_count", 0),
                        finding.get("metric_value", 0.0),
                        finding["message"],
                        json.dumps(finding.get("detail", {}), ensure_ascii=False),
                        now,
                        file_hash,
                        mapping_version,
                        rule_version,
                        quality_run_id,
                    ),
                )
        return quality_run_id

    # ── run history ──────────────────────────────────────────────────────────
    #
    # `_LATEST_RUN` is joined by every reader that wants "the current state".
    # A finding written before runs existed carries no run id, and there is no
    # run row for its file either, so the NULL branch keeps it visible instead
    # of making the Quality step go blank on an older session.

    _LATEST_RUN = (
        "LEFT JOIN LATERAL ("
        "  SELECT r.quality_run_id FROM discovery_quality_run r "
        "   WHERE r.session_id = q.session_id AND r.source_file_id = q.source_file_id "
        "   ORDER BY r.completed_at DESC, r.created_at DESC, r.quality_run_id DESC "
        "   LIMIT 1"
        ") latest ON TRUE "
    )
    _IS_LATEST = "(latest.quality_run_id IS NULL OR q.quality_run_id = latest.quality_run_id)"

    @staticmethod
    def _run_row(row) -> dict:
        data = dict(row)
        data["mapping_snapshot"] = json.loads(data.pop("mapping_snapshot_json") or "[]")
        data["rule_snapshot"] = json.loads(data.pop("rule_snapshot_json") or "[]")
        return data

    _RUN_COLUMNS = (
        "quality_run_id, session_id, source_file_id, table_name, execution_id, run_group_id, "
        "status, file_hash, mapping_version, rule_version, mapping_snapshot_json, "
        "rule_snapshot_json, checked_columns, findings_total, failed_count, warning_count, "
        "rows_total, requested_by, completed_at, created_at"
    )

    def list_quality_runs(self, session_id: str, source_file_id: str = "") -> list[dict]:
        """Every run the session holds, newest first — the evidence trail."""
        where = "session_id = %s"
        params: list = [session_id]
        if source_file_id:
            where += " AND source_file_id = %s"
            params.append(source_file_id)
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                f"SELECT {self._RUN_COLUMNS} FROM discovery_quality_run "
                f"WHERE {where} ORDER BY completed_at DESC, created_at DESC, quality_run_id DESC",
                tuple(params),
            ).fetchall()
        return [self._run_row(row) for row in rows]

    def get_quality_run(self, quality_run_id: str) -> dict | None:
        with get_connection(self._db_url) as conn:
            row = conn.execute(
                f"SELECT {self._RUN_COLUMNS} FROM discovery_quality_run "
                "WHERE quality_run_id = %s",
                (quality_run_id,),
            ).fetchone()
        return None if row is None else self._run_row(row)

    def list_quality_checks_for_run(self, quality_run_id: str) -> list[dict]:
        """The findings of one run, however old, exactly as they were written."""
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT q.quality_check_id, q.session_id, q.source_file_id, q.execution_id, "
                "q.scope, q.column_id, q.column_name, q.target_node_id, q.target_name, "
                "q.check_type, q.status, q.rule_source, q.observed_count, q.total_count, "
                "q.metric_value, q.message, q.detail_json, q.created_at, "
                "q.file_hash, q.mapping_version, q.rule_version, q.quality_run_id "
                "FROM discovery_quality_check q WHERE q.quality_run_id = %s "
                "ORDER BY q.column_name, q.check_type",
                (quality_run_id,),
            ).fetchall()
        return [
            {**dict(row), "detail": json.loads(row["detail_json"] or "{}")} for row in rows
        ]

    def list_quality_checks(
        self, session_id: str, include_profile: bool = False
    ) -> list[dict]:
        """
        The findings of one table: the one this repository is pinned to, or
        the session's active table when it is not pinned.

        Profile observations are stored with the run but are not Quality Check
        results, so they are left out unless a caller says otherwise. The one
        caller that says otherwise is the report builder, which needs to know
        a run happened even when no governed rule produced a finding.
        """
        if self._source_file_id:
            scope = "q.source_file_id = %s"
            params = (session_id, self._source_file_id)
        else:
            scope = "q.source_file_id = s.active_source_file_id"
            params = (session_id,)
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT q.quality_check_id, q.session_id, q.source_file_id, q.execution_id, "
                "q.scope, q.column_id, q.column_name, q.target_node_id, q.target_name, "
                "q.check_type, q.status, q.rule_source, q.observed_count, q.total_count, "
                "q.metric_value, q.message, q.detail_json, q.created_at, "
                "q.file_hash, q.mapping_version, q.rule_version "
                "FROM discovery_quality_check q "
                "JOIN discovery_session s ON s.session_id = q.session_id "
                + self._LATEST_RUN +
                f"WHERE q.session_id = %s AND {scope} AND {self._IS_LATEST} "
                # Profile observations are stored with the run as evidence but
                # are not Quality Check results and never count towards one.
                + ("" if include_profile else "AND q.scope <> 'profile' ")
                + "ORDER BY q.column_name, q.check_type",
                params,
            ).fetchall()
        return [
            {**dict(row), "detail": json.loads(row["detail_json"] or "{}")} for row in rows
        ]

    def list_quality_checks_everywhere(
        self, session_id: str, include_profile: bool = False
    ) -> list[dict]:
        """
        Every finding the session holds, from every table, with the table named.

        `list_quality_checks` shows the table being worked on, which is right
        for a screen about that table. A question like "which rule is failing
        most" is not about one table: answering it from the active file alone
        would report the one table in front of you and call it the session.
        """
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT q.quality_check_id, q.session_id, q.source_file_id, q.execution_id, "
                "q.scope, q.column_id, q.column_name, q.target_node_id, q.target_name, "
                "q.check_type, q.status, q.rule_source, q.observed_count, q.total_count, "
                "q.metric_value, q.message, q.detail_json, q.created_at, "
                "f.original_filename AS table_name, "
                "(f.source_file_id = s.active_source_file_id) AS is_active_table "
                "FROM discovery_quality_check q "
                "JOIN discovery_session s ON s.session_id = q.session_id "
                "LEFT JOIN discovery_source_file f ON f.source_file_id = q.source_file_id "
                + self._LATEST_RUN +
                f"WHERE q.session_id = %s AND {self._IS_LATEST} "
                + ("" if include_profile else "AND q.scope <> 'profile' ")
                + "ORDER BY f.original_filename, q.column_name, q.check_type",
                (session_id,),
            ).fetchall()
        return [
            {
                **dict(row),
                "table_name": row["table_name"] or "Unknown table",
                "is_active_table": bool(row["is_active_table"]),
                "detail": json.loads(row["detail_json"] or "{}"),
            }
            for row in rows
        ]

    def list_profile_observations(self, session_id: str) -> list[dict]:
        """
        The automatic risk observations of the table being worked on.

        Missing values, repeated records, fields that overlap, values that do
        not parse. No rule is needed to notice any of them, so they belong to
        Profile and not to the Quality Check verdict — which is the whole point
        of keeping the two stages apart.
        """
        if self._source_file_id:
            scope = "q.source_file_id = %s"
            params = (session_id, self._source_file_id)
        else:
            scope = "q.source_file_id = s.active_source_file_id"
            params = (session_id,)
        with get_connection(self._db_url) as conn:
            rows = conn.execute(
                "SELECT q.quality_check_id, q.session_id, q.source_file_id, "
                "q.column_id, q.column_name, q.target_name, q.check_type, q.status, "
                "q.observed_count, q.total_count, q.metric_value, q.message, "
                "q.detail_json, q.created_at "
                "FROM discovery_quality_check q "
                "JOIN discovery_session s ON s.session_id = q.session_id "
                + self._LATEST_RUN +
                f"WHERE q.session_id = %s AND {scope} AND {self._IS_LATEST} "
                "AND q.scope = 'profile' "
                "ORDER BY q.column_name, q.check_type",
                params,
            ).fetchall()
        return [
            {**dict(row), "detail": json.loads(row["detail_json"] or "{}")} for row in rows
        ]

    # ── legacy profiling projection ──────────────────────────────────────────

    def write_profiling_results(
        self,
        session_id: str,
        source_file_id: str,
        source_name: str,
        row_count: int,
        columns: list[dict],
    ) -> None:
        """
        Persist the computed profile into the legacy source_dataset /
        source_column / column_profile_result tables that the Profile, Mapping
        and Quality panels read from.

        Each entry in `columns` must carry:
          column_label, internal_name, ordinal, detected_type,
          distinct_count, blank_count, value_distribution, sample_values
        """
        now = utc_now_iso()
        dataset_id = f"ds_{uuid4().hex[:12]}"
        with get_connection(self._db_url) as conn:
            conn.execute(
                "DELETE FROM source_dataset WHERE source_file_id = %s", (source_file_id,)
            )
            conn.execute(
                "INSERT INTO source_dataset "
                "(dataset_id, session_id, source_file_id, source_name, row_count, "
                "import_status, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (dataset_id, session_id, source_file_id, source_name, row_count,
                 "completed", now),
            )
            for column in columns:
                column_id = f"col_{uuid4().hex[:12]}"
                conn.execute(
                    "INSERT INTO source_column "
                    "(column_id, session_id, source_file_id, dataset_id, column_name, "
                    "ordinal, detected_type, sample_values_json, created_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (
                        column_id,
                        session_id,
                        source_file_id,
                        dataset_id,
                        column["column_label"],
                        column["ordinal"],
                        column["detected_type"],
                        json.dumps(column.get("sample_values", [])),
                        now,
                    ),
                )
                conn.execute(
                    "INSERT INTO column_profile_result "
                    "(profile_id, session_id, column_id, distinct_count, null_count, "
                    "blank_count, inferred_kind, value_distribution_json, profiled_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (
                        f"prof_{uuid4().hex[:12]}",
                        session_id,
                        column_id,
                        column["distinct_count"],
                        0,
                        column["blank_count"],
                        column["detected_type"],
                        json.dumps(column["value_distribution"]),
                        now,
                    ),
                )
            conn.execute(
                "UPDATE discovery_session SET source_name = %s, status = %s, updated_at = %s "
                "WHERE session_id = %s",
                (source_name, "ready", now, session_id),
            )
