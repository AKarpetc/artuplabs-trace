import { ERR, FAIL, LOG } from '../core/errors.js';
import { evaluate, fieldValue, parseExpression } from '../core/expression.js';
import { sortIds } from '../core/ids.js';
import { FIELD_EVAL_CHUNK } from '../core/limits.js';

const PSEUDO_NAME = { firstcommented: 'firstCommented', lastcommented: 'lastCommented' };
const pseudoOf = (name) => PSEUDO_NAME[String(name).toLowerCase()] ?? null;
const lower = (v) => String(v ?? '').toLowerCase();
const named = (functionName, failure) => ({ error: ERR.withFunction(functionName, failure.error), log: failure.log });

/**
 * Value sources of dateCompare and expression: the subquery's issues whose field expression is true. Fields are read by id or display name,
 * in slices of FIELD_EVAL_CHUNK issues; firstCommented and lastCommented come from the comment index, which counts only comments visible to everyone.
 */
export function createFieldCompute({ jira, repo, commentsShipped, commentGate = async () => null }) {
  async function fieldIds(names) {
    const all = (await jira.fields()) ?? [];
    const out = new Map();
    for (const name of names) {
      if (pseudoOf(name)) continue;
      const byId = all.find((f) => lower(f.id) === lower(name));
      const byName = byId ? [byId] : all.filter((f) => lower(f.name) === lower(name));
      if (!byName.length) return FAIL.notFound('Field', name);
      if (byName.length > 1) return FAIL.ambiguous('Field', name, byName.length);
      out.set(name, byName[0].id);
    }
    return { ids: out };
  }

  async function matchingIds(inner, parsed, map, pseudo, mode) {
    const wanted = [...new Set(map.values())].sort();
    const out = [];
    for (let i = 0; i < inner.length; i += FIELD_EVAL_CHUNK) {
      const slice = inner.slice(i, i + FIELD_EVAL_CHUNK);
      const issues = await jira.bulkIssues(slice, wanted);
      const bounds = pseudo.length ? await repo.commentBounds(slice) : new Map();
      for (const issue of issues ?? []) {
        const valueOf = (name) => {
          const p = pseudoOf(name);
          if (p) return bounds.get(String(issue.id))?.[p === 'firstCommented' ? 'first' : 'last'] ?? null;
          return fieldValue(issue.fields?.[map.get(name)]);
        };
        if (evaluate(parsed.ast, valueOf, mode) === true) out.push(issue.id);
      }
    }
    return sortIds(out);
  }

  const run = (functionName, mode) => async ({ subquery, expression }, { reconcile }) => {
    const parsed = parseExpression(expression);
    if (parsed.error) return { error: ERR.withFunction(functionName, parsed.error), log: LOG.invalidExpression() };
    const pseudo = parsed.fields.map(pseudoOf).filter(Boolean);
    if (pseudo.length && !commentsShipped()) return { error: ERR.withFunction(functionName, ERR.needsCommentIndex(pseudo[0])), log: LOG.commentIndexNotShipped() };
    if (pseudo.length) {
      const gate = await commentGate();
      if (gate) return { error: gate, log: gate };
    }
    const map = await fieldIds(parsed.fields);
    if (map.error) return named(functionName, map);
    const inner = sortIds(await jira.searchIds(subquery, { reconcile }));
    return { ids: await matchingIds(inner, parsed, map.ids, pseudo, mode), field: 'id', watch: inner };
  };

  return { dateCompare: run('dateCompare', 'date'), expression: run('expression', 'number') };
}
