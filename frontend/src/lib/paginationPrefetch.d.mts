export function getNextPagePrefetchPlan(input: {
  enabled: boolean;
  page: number;
  totalPages: number;
  alreadyCached: boolean;
}): { page: number } | null;
