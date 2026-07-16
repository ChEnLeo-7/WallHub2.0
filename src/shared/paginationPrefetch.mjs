export function getNextPagePrefetchPlan({ enabled, page, totalPages, alreadyCached }) {
  const currentPage = Number(page) || 1;
  const lastPage = Number(totalPages) || 0;
  if (!enabled || alreadyCached || currentPage < 1 || currentPage >= lastPage) return null;
  return { page: currentPage + 1 };
}
