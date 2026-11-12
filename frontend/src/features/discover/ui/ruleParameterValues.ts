/**
 * How a rule's parameter values move between the form and the server.
 *
 * List parameters — allowed values, required fields — are typed as ordinary
 * text and parsed only when the rule is saved. Parsing on every keystroke made
 * the field impossible to use: typing `Wood,` split into `["Wood", ""]`, the
 * empty entry was dropped as noise, and the comma the user had just pressed
 * vanished before they could type the next value. The text is the thing being
 * edited; the array is only how it is stored.
 */

/** Render a stored value as the text a user edits. */
export function listToText(value: unknown): string {
  if (Array.isArray(value)) return (value as unknown[]).map(String).join(", ");
  return value === null || value === undefined ? "" : String(value);
}

/** Parse typed text into the list that is stored and checked against. */
export function parseListValue(value: unknown): string[] {
  const parts = Array.isArray(value)
    ? (value as unknown[]).map(String)
    : String(value ?? "").split(",");
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Convert every list-typed parameter from typed text into its stored form,
 * leaving the other parameter types exactly as they are.
 */
export function normaliseParameters(
  permitted: Array<{ key: string; type: string }>,
  values: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...values };
  for (const parameter of permitted) {
    if (parameter.type === "list" && parameter.key in result) {
      result[parameter.key] = parseListValue(result[parameter.key]);
    }
  }
  return result;
}
