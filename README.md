# ArtUp Export

A Forge app for Confluence Cloud that exports pages to git-ready Markdown.

See [developer.atlassian.com/platform/forge/](https://developer.atlassian.com/platform/forge) for documentation and tutorials explaining Forge.

## Requirements

See [Set up Forge](https://developer.atlassian.com/platform/forge/set-up-forge/) for instructions to get set up.

## Quick start

- Backend resolvers live in `src/`; `src/access.js` decides licence status, `src/resolvers.js` registers the
  Forge resolver functions, and `src/index.js` re-exports the resolver handler for `manifest.yml`.
- The Custom UI frontend lives in `static/app` (added in a later task).

```
npm test        # run the vitest suite
npm run lint    # lint src/
forge lint      # validate manifest.yml and app code
```

- Build and deploy your app by running:
```
forge deploy
```

- Install your app in an Atlassian site by running:
```
forge install
```

- Develop your app by running `forge tunnel` to proxy invocations locally:
```
forge tunnel
```

### Notes
- Use the `forge deploy` command when you want to persist code changes.
- Use the `forge install` command when you want to install the app on a new site.
- Once the app is installed on a site, the site picks up the new app changes you deploy without needing to rerun the install command.
