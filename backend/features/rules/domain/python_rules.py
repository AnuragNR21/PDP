"""
Custom rules written in Python, in the shape of an ESRI attribute rule.

The author writes the *body* of a check and ends it with `return`. The engine
wraps that body in a function, so the script never declares one:

    if not is_number(value):
        return {"errorMessage": "Height must be a number"}
    return float(value) > params["min"]

Validation here is authoring-time only: it answers "is this script well formed
and allowed?" so the mistake is caught while the person is still looking at it.
It is not the sandbox. Nothing in this module executes the script, and the
guards below are for clear errors, not for containment — running a script has
to happen in an isolated process, with its own restricted builtins.
"""
from __future__ import annotations

import ast
import hashlib

#: The wrapper the body is compiled inside. One line, so reported line numbers
#: only need to be shifted by one to match what the author sees.
WRAPPER = "def check(value, row, params):\n"

#: The body sits inside the wrapper, indented by this much.
INDENT = "    "

MAX_SCRIPT_BYTES = 10_000

#: Names a rule must never reach for. Blocked by name so the message can say
#: which one and why, rather than failing later with an obscure error.
FORBIDDEN_NAMES = {
    "__import__": "imports are not available to a rule",
    "eval": "evaluating code from a string is not allowed",
    "exec": "running code from a string is not allowed",
    "compile": "compiling code is not allowed",
    "open": "a rule cannot read or write files",
    "input": "a rule cannot ask for input while it runs",
    "breakpoint": "a rule cannot open a debugger",
    "globals": "a rule cannot reach the surrounding program",
    "locals": "a rule cannot reach the surrounding program",
    "vars": "a rule cannot reach the surrounding program",
    "getattr": "look the value up directly instead",
    "setattr": "a rule cannot change objects it is given",
    "delattr": "a rule cannot change objects it is given",
}

#: Attribute names that walk out of the value and into the interpreter.
FORBIDDEN_ATTRS = {"format", "format_map"}

#: What the script is handed, and what it may call. Shown beside the editor so
#: the author does not have to guess.
CONTEXT = [
    {"name": "value", "detail": "The value of the field being checked, as text."},
    {"name": "row", "detail": 'Every mapped field of the row, e.g. row["Install_Date"].'},
    {"name": "params", "detail": 'The rule\'s own parameters, e.g. params["min"].'},
]

HELPERS = [
    {"signature": "is_number(v)", "detail": "True when the value reads as a number."},
    {"signature": "is_date(v, fmt='any')", "detail": "True when the value is a real date; fmt: any, iso, dmy, mdy."},
    {"signature": "matches(v, pattern)", "detail": "True when the value matches a regular expression."},
    {"signature": "in_list(v, values)", "detail": "True when the value is one of the values given."},
    {"signature": "is_unique(v)", "detail": "True when this value appears once in the column."},
    {"signature": "count_of(v)", "detail": "How many rows carry this value."},
]

TEMPLATE = (
    "# value = the field being checked · row = the row's mapped fields\n"
    "# params = this rule's parameters · return True when the value is good\n"
    "if not is_number(value):\n"
    '    return {"errorMessage": "Must be a number"}\n'
    'return float(value) > params["min"]\n'
)

#: Parameters a script rule accepts alongside the shared ones. A script reads
#: them through `params`, so they are named by the author rather than by a check.
SCRIPT_PARAM_HELP = 'Anything the script reads from params, e.g. min = 5. One per line, name = value.'


class ScriptError(ValueError):
    """A script that cannot be saved, with the position of the problem."""

    def __init__(self, message: str, line: int = 0, column: int = 0) -> None:
        super().__init__(message)
        self.message = message
        self.line = line
        self.column = column

    def as_dict(self) -> dict:
        return {"message": self.message, "line": self.line, "column": self.column}


class _Policy(ast.NodeVisitor):
    """Walks the body and refuses what a rule is not allowed to do."""

    def __init__(self) -> None:
        self.returns = 0
        self.row_fields: set[str] = set()
        self.param_names: set[str] = set()

    def _refuse(self, node: ast.AST, message: str) -> None:
        # The body is indented by INDENT to sit inside the wrapper, so both the
        # line and the column have to come back to what the author typed.
        raise ScriptError(
            message,
            getattr(node, "lineno", 1) - 1,
            max(getattr(node, "col_offset", 0) - len(INDENT), 0),
        )

    def visit_Import(self, node: ast.Import) -> None:
        self._refuse(node, "A rule cannot import anything. Use the helpers listed beside the editor.")

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        self._refuse(node, "A rule cannot import anything. Use the helpers listed beside the editor.")

    def visit_While(self, node: ast.While) -> None:
        # A rule runs once per row over a whole file, so an endless loop there
        # stalls the run rather than failing it. `for` over the values a rule
        # is given is bounded and stays allowed.
        self._refuse(node, "`while` is not allowed — a rule must finish on every row.")

    def visit_Global(self, node: ast.Global) -> None:
        self._refuse(node, "A rule cannot use `global`.")

    def visit_Nonlocal(self, node: ast.Nonlocal) -> None:
        self._refuse(node, "A rule cannot use `nonlocal`.")

    def visit_Name(self, node: ast.Name) -> None:
        reason = FORBIDDEN_NAMES.get(node.id)
        if reason:
            self._refuse(node, f"`{node.id}` is not available — {reason}.")
        if node.id.startswith("__"):
            self._refuse(node, f"`{node.id}` is not available to a rule.")
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr.startswith("_"):
            self._refuse(node, f"`.{node.attr}` is not available to a rule.")
        if node.attr in FORBIDDEN_ATTRS:
            self._refuse(node, f"`.{node.attr}` is not available — build the text with an f-string instead.")
        self.generic_visit(node)

    def visit_Return(self, node: ast.Return) -> None:
        self.returns += 1
        self.generic_visit(node)

    def visit_Subscript(self, node: ast.Subscript) -> None:
        # row["X"] tells the engine which fields to read, so it can select only
        # those instead of every column.
        if isinstance(node.value, ast.Name) and isinstance(node.slice, ast.Constant):
            key = node.slice.value
            if isinstance(key, str):
                if node.value.id == "row":
                    self.row_fields.add(key)
                elif node.value.id == "params":
                    self.param_names.add(key)
        self.generic_visit(node)


def validate(script: str) -> dict:
    """
    Check a script without running it.

    Returns the same shape whether it passed or not, so the editor can render
    one result panel: `ok`, the errors to show, and what the script reads.
    """
    text = (script or "").strip("\n")
    if not text.strip():
        return _failed(ScriptError("Write the check first.", 1, 0))
    if len(text.encode("utf-8")) > MAX_SCRIPT_BYTES:
        return _failed(ScriptError(f"A rule is limited to {MAX_SCRIPT_BYTES:,} characters.", 1, 0))

    indented = "".join(f"{INDENT}{line}\n" for line in text.split("\n"))
    try:
        tree = ast.parse(WRAPPER + indented, filename="<rule>", mode="exec")
    except SyntaxError as exc:
        # The wrapper occupies line 1, so shift back to the author's numbering.
        return _failed(ScriptError(
            exc.msg or "This is not valid Python.",
            max((exc.lineno or 2) - 1, 1),
            max((exc.offset or 1) - 1 - len(INDENT), 0),
        ))
    except ValueError as exc:  # e.g. a null byte in the source
        return _failed(ScriptError(str(exc), 1, 0))

    policy = _Policy()
    try:
        policy.visit(tree)
    except ScriptError as exc:
        return _failed(exc)

    if policy.returns == 0:
        return _failed(ScriptError("The rule never returns. End with `return True` when the value is good.", 1, 0))

    return {
        "ok": True,
        "errors": [],
        "row_fields": sorted(policy.row_fields),
        "param_names": sorted(policy.param_names),
        "sha256": sha256(text),
        "summary": summarise(sorted(policy.row_fields)),
    }


def _failed(error: ScriptError) -> dict:
    return {
        "ok": False,
        "errors": [error.as_dict()],
        "row_fields": [],
        "param_names": [],
        "sha256": "",
        "summary": "",
    }


def summarise(row_fields: list[str]) -> str:
    """One line for the library list."""
    if row_fields:
        return "Custom script · also reads " + ", ".join(row_fields)
    return "Custom script"


def sha256(script: str) -> str:
    """Identifies the exact script a result was produced by."""
    return hashlib.sha256(script.strip("\n").encode("utf-8")).hexdigest()


def authoring_help() -> dict:
    """Everything the editor shows beside the script."""
    return {
        "template": TEMPLATE,
        "context": CONTEXT,
        "helpers": HELPERS,
        "max_bytes": MAX_SCRIPT_BYTES,
        "params_help": SCRIPT_PARAM_HELP,
    }
