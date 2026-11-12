import type { ModelPackage } from './modelPackages';

/**
 * Grouping a picker's models under their Packages, the way Model Selection
 * lists them. Pure (no React, no store) so the rules are tested on their own;
 * the panels pass in what they already filtered.
 */

export type PackageGroup<T> = {
  pkg: ModelPackage;
  /** Every model of the package, whatever the filters — the count Model Selection shows. */
  total: number;
  /** What the package shows, in the order given. */
  entries: T[];
  /** The search matched the package's own name, so all its (filtered) models show. */
  packageMatch: boolean;
};

export type GroupingInput<T> = {
  /** Every model of the picker (for the totals). */
  all: T[];
  /** Models that pass the kind and Active filters, before the search. */
  passing: T[];
  /** Models the search kept (a subset of `passing`); the same as `passing` without a search. */
  shown: T[];
  /** The search, lower-cased and trimmed; empty for none. */
  query: string;
  /** Whether the kind or Active filter narrows anything. */
  filtered: boolean;
};

/**
 * Models under their packages, packages in the order given (Shared Models
 * first, then by name — `orderedPackages`).
 *
 * As in Model Selection: a package whose name the search matches shows all of
 * its filtered models; a search or filter hides packages with nothing to show;
 * with neither, an empty package still shows, so the structure stays readable.
 */
export function groupByPackage<T>(
  packages: ModelPackage[],
  packageOf: (entry: T) => string,
  input: GroupingInput<T>,
): PackageGroup<T>[] {
  const known = new Set(packages.map((pkg) => pkg.id));
  const fallback = packages[0]?.id;
  // A model placed in a package that no longer exists sits in the first one (Shared Models).
  const home = (entry: T) => {
    const id = packageOf(entry);
    return known.has(id) ? id : fallback;
  };
  const query = input.query;
  return packages
    .map((pkg) => {
      const packageMatch = Boolean(query) && pkg.name.toLocaleLowerCase().includes(query);
      const source = packageMatch ? input.passing : input.shown;
      return {
        pkg,
        total: input.all.filter((entry) => home(entry) === pkg.id).length,
        entries: source.filter((entry) => home(entry) === pkg.id),
        packageMatch,
      };
    })
    .filter((group) => {
      if (query) return group.packageMatch || group.entries.length > 0;
      if (input.filtered) return group.entries.length > 0;
      return true;
    });
}
