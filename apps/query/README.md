# ArtUp Query

A Forge app for Jira Cloud that adds JQL functions which stay fresh: subtasks, links, hierarchy,
sprint history, comments and field math. It runs entirely on Atlassian Forge: no external egress
and no issue text stored.

Entry points: a global page and the admin settings page.

## Development

```bash
npm install
npm test
npm run coverage
npm run lint
forge lint
```
