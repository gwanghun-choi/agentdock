/**
 * Binary-relevance retrieval metrics for one ranked list. `hits[i]` says
 * whether the row at rank i+1 is relevant; `relevant` is how many rows of the
 * corpus are, so recall and NDCG are measured against the whole answer, not
 * against whatever search happened to return. Shared by the two evaluation
 * sets, search.eval.test.ts and search.multilingual.eval.test.ts.
 */
export function caseMetrics(hits: boolean[], relevant: number) {
  const within = (k: number) => hits.slice(0, k).filter(Boolean).length;
  const first = hits.indexOf(true);
  const gain = (i: number) => 1 / Math.log2(i + 2);
  const dcg = hits.slice(0, 10).reduce((sum, hit, i) => sum + (hit ? gain(i) : 0), 0);
  let ideal = 0;
  for (let i = 0; i < Math.min(relevant, 10); i++) ideal += gain(i);
  return {
    p5: within(5) / 5,
    p10: within(10) / 10,
    recall10: relevant > 0 ? within(10) / relevant : 0,
    rr: first === -1 ? 0 : 1 / (first + 1),
    ndcg10: ideal > 0 ? dcg / ideal : 0,
    top1: hits[0] === true,
  };
}
