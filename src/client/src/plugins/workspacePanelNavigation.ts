import { isContributionQueryLocalKey, readContributionQuery, setContributionQueryKey, type ContributionQuerySnapshot } from "../namespacedQueryArgs";
import type { ContributionQueryValue, QualifiedContributionId, WorkspacePanelNavigationV1 } from "./types";

export function createWorkspacePanelNavigation(
  contributionId: QualifiedContributionId,
  aliases: readonly QualifiedContributionId[],
  isCurrent: () => boolean,
  onChange: () => void,
  restoredQuery?: ContributionQuerySnapshot,
): WorkspacePanelNavigationV1 {
  const query = restoredQuery ?? (isCurrent() ? readContributionQuery(contributionId, aliases) : Object.freeze({}));
  let expectedQuery = query;
  return Object.freeze({
    version: 1,
    contributionId,
    query,
    set: (key: string, value: ContributionQueryValue | undefined | null, options?: { replace?: boolean | undefined }) => {
      if (!isContributionQueryLocalKey(key)) throw new Error(`Invalid contribution navigation key: ${key}`);
      if (!isCurrent() || !sameQuery(readContributionQuery(contributionId, aliases), expectedQuery)) return false;
      if (setContributionQueryKey(contributionId, aliases, key, value, options)) {
        expectedQuery = readContributionQuery(contributionId, aliases);
        onChange();
      }
      return true;
    },
  });
}

function sameQuery(left: Readonly<Record<string, string | readonly string[]>>, right: Readonly<Record<string, string | readonly string[]>>): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => {
    if (!Object.hasOwn(right, key)) return false;
    const a = left[key];
    const b = right[key];
    return typeof a === "string" ? a === b : Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]);
  });
}
