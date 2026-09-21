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
  reporter: string | null;
  created: string | null;
  updated: string | null;
  url: string;
}

/** Raw shape returned by `/rest/api/3/search/jql`, narrowed to what we read. */
export interface RawIssue {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string; name?: string } };
    issuetype?: { name?: string };
    project?: { key?: string };
    parent?: { key?: string; fields?: { summary?: string } };
    reporter?: { displayName?: string };
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
