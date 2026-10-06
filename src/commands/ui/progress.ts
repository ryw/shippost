/** Progress is scoped to the active target; setup's [1/3] is not generation. */
export function generationProgress(log: string[], plannedPosts = 0): { current: number; total: number; label: string } | null {
  let start = log.length - 1;
  while (start >= 0 && !log[start].startsWith('▸ ')) start--;
  if (start < 0) return null;
  const lines = log.slice(start + 1);
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].trim().match(/^Substep (\d+)\/(\d+) · (.+)$/);
    if (match && +match[1] >= 0 && +match[2] > 0 && +match[1] <= +match[2]) {
      // Older live workers counted drafting and evaluation as separate steps.
      const posts = lines.map(line => line.match(/Generating (\d+) posts\.\.\./)?.[1]).find(Boolean);
      if (posts && /^(Drafting|Evaluating) social posts$/.test(match[3]) && +match[2] === Number(posts) * 2) {
        return { current: Math.ceil(+match[1] / 2), total: Number(posts), label: match[3] };
      }
      return { current: +match[1], total: +match[2], label: match[3] };
    }
  }
  // Workers started before progress logging was added still report post counts.
  if (log[start].startsWith('▸ social:')) {
    const generating = lines.findIndex(line => /Generating \d+ posts\.\.\./.test(line));
    if (generating >= 0) {
      for (let i = lines.length - 1; i > generating; i--) {
        const match = lines[i].trim().match(/^\[(\d+)\/(\d+)\] /);
        if (match && +match[1] >= 0 && +match[2] > 0 && +match[1] <= +match[2]) {
          return { current: +match[1], total: +match[2], label: 'Social posts' };
        }
      }
    }
  }
  if (log[start].startsWith('▸ social:') && plannedPosts > 0) {
    return { current: 0, total: plannedPosts, label: 'Preparing social posts' };
  }
  return null;
}
