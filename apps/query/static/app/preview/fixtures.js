import { shippedFunctions, usage } from '../../../src/core/catalog.js';

/**
 * Fixture data for the local preview: the screen/state matrix, the getStatus and adminStatus answers per state
 * and the projects of the fixture site.
 */

export const SCREENS = {
  global: ['reference', 'reference-empty-search', 'status-idle', 'status-building', 'status-errors', 'unlicensed'],
  admin: ['admin', 'admin-busy', 'admin-reset-dialog', 'admin-forbidden'],
};

const NOW = Date.parse('2026-10-03T09:30:00Z');
const MINUTE = 60 * 1000;

export const PROJECTS = [
  { key: 'DEMO', name: 'Demo service desk' },
  { key: 'OPS', name: 'Operations' },
  { key: 'HR', name: 'People and hiring' },
  { key: 'PLAT', name: 'Платформа и инфраструктура' },
  { key: 'MOBILE', name: 'モバイルアプリ' },
];

const FUNCTIONS = shippedFunctions().map((f) => ({ name: f.name, group: f.group, usage: usage(f), examples: f.examples }));

const READY = {
  sprint: { done: 48210, total: 48210, finishedAt: NOW - 90 * MINUTE, readyAt: NOW - 90 * MINUTE },
  comments: { done: 48210, total: 48210, finishedAt: NOW - 80 * MINUTE, readyAt: NOW - 80 * MINUTE },
};

const BUILDING = {
  sprint: { done: 12400, total: 48210, finishedAt: null, readyAt: null },
  comments: { done: 0, total: 48210, finishedAt: null, readyAt: null },
};

const ERRORS = [
  { at: NOW - 3 * MINUTE, functionName: 'parentsOf', message: 'Usage: parentsOf(subquery)' },
  { at: NOW - 25 * MINUTE, functionName: 'linkedIssuesOfRecursiveLimited', message: 'The depth must be a whole number from 1 to 10, for example linkedIssuesOfRecursiveLimited("key = DEMO-1", "3", "blocks").' },
  { at: NOW - 70 * MINUTE, functionName: 'expression', message: 'Unknown field "storypoints" in timespent > storypoints * 1.2' },
];

const IDLE = { queue: { pending: false, running: false }, lastRefresh: { at: NOW - 4 * MINUTE }, errors: [], progress: READY, excluded: [] };

const STATUS_BY_STATE = {
  'status-building': { queue: { pending: true, running: true }, lastRefresh: { at: NOW - MINUTE }, errors: [], progress: BUILDING, excluded: ['HR', 'OPS'] },
  'status-errors': { ...IDLE, errors: ERRORS },
};

/** getStatus answer for a global state. */
export function statusFor(state) {
  return { functions: FUNCTIONS, ...(STATUS_BY_STATE[state] ?? IDLE) };
}

/** adminStatus answer for an admin state: an index that is still building, with one excluded project. */
export function adminStatusFor() {
  return { excluded: ['HR'], progress: BUILDING, parts: ['sprint', 'comments'] };
}
