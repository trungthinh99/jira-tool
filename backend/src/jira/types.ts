/** The slice of a Jira issue this tool actually renders. */
export interface IssueSummary {
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  issueType: string;
  projectKey: string;
  parentKey: string | null;
  parentSummary: string | null;
  /** Parent's own status — Jira returns it inline, so it costs no extra call. */
  parentStatus: string | null;
  parentStatusCategory: string | null;
  parentType: string | null;
  reporter: string | null;
  assignee: string | null;
  created: string | null;
  updated: string | null;
  url: string;
  /**
   * Set when the row is on the report because it is still in progress, rather
   * than because its status changed that day. See `fetchDayActivity()`.
   */
  wip?: boolean;
}

/** Raw shape returned by `/rest/api/3/search/jql`, narrowed to what we read. */
export interface RawIssue {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string; name?: string } };
    issuetype?: { name?: string };
    project?: { key?: string };
    parent?: {
      key?: string;
      fields?: {
        summary?: string;
        status?: { name?: string; statusCategory?: { key?: string } };
        issuetype?: { name?: string };
      };
    };
    // `accountId` only matters where the reporter is used as an assignee
    // default; the board rows just print `displayName`.
    reporter?: { displayName?: string; accountId?: string };
    assignee?: { displayName?: string } | null;
    created?: string;
    updated?: string;
  };
}

export interface SearchResponse {
  issues?: RawIssue[];
  nextPageToken?: string;
  isLast?: boolean;
}

export interface TransitionOption {
  id: string;
  name: string;
  to: string;
}

/** A person who can be mentioned in a report. */
export interface JiraUser {
  accountId: string;
  displayName: string;
}

/**
 * Outcome of the Slack ping that follows a posted report.
 *
 * `skipped` means Slack was never configured — that is the normal state, not a
 * failure, and the UI stays silent about it.
 */
export interface SlackPing {
  sent: boolean;
  skipped: boolean;
  error?: string;
}

export interface PostedReport {
  commentId: string;
  url: string;
}

/** Raw shape returned by `/rest/api/3/user/assignable/search`. */
export interface RawUser {
  accountId?: string;
  displayName?: string;
  active?: boolean;
  accountType?: string;
}

/**
 * The leading `[New]` / `[Update N]` heading of a story's description.
 *
 * The BA opens every round of a story with one, in red, as the first block —
 * `[New] 02/11/2026` for a story just written, `[Update 12] 29/10/2026` for a
 * revision. It carries the two facts a QA title needs: the round's date, and
 * which update it is.
 */
export interface StoryHeading {
  /** `YYMMDD`, converted from the heading's `DD/MM/YYYY`. */
  stamp: string;
  /** The update number, or null for a `[New]` story. */
  update: number | null;
}
