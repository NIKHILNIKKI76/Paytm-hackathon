# Shared development versions

Use this baseline in both the frontend repository and the Node.js backend repository, including all three backend categories. Exact package versions were checked against the npm registry on 2026-11-14. These are setup targets, not dependencies already installed in this repository.

| Tool or package | Exact version | Purpose |
| --- | --- | --- |
| Node.js | 24.22.3 | Shared runtime |
| npm | 11.21.2 | Shared package manager |
| react | 19.3.1 | Frontend UI |
| react-dom | 19.3.1 | React browser rendering |
| typescript | 7.0.2 | Type checking |
| tailwindcss | 4.3.5 | Frontend styling |
| @tailwindcss/vite | 4.3.5 | Tailwind integration with Vite |
| vite | 8.3.8 | Frontend development server and build |
| @vitejs/plugin-react | 6.3.0 | React integration with Vite |
| @types/react | 19.3.0 | React TypeScript definitions |
| @types/react-dom | 19.3.0 | React DOM TypeScript definitions |
| express | 5.3.0 | Proposed backend HTTP framework |

Express is a proposed choice for future implementation. No framework or application code has been installed. Add other dependencies to this table when the team selects them; do not assume versions for tools that have not been chosen.

## Set up the shared runtime

With nvm installed, run from the repository root:

```bash
nvm install
nvm use
npm install --global npm@11.21.2
node --version
npm --version
```

Expected output: `v24.22.3` and `11.21.2`. The root `.nvmrc` records the Node.js version. Copy the same runtime settings to the separate frontend repository.

## Keep dependency installs identical

- When creating each application's `package.json`, use the exact versions above, without `^`, `~`, or `latest`.
- The root `.npmrc` enables `save-exact=true` for future npm installs within this repository. Use the same setting in the frontend repository.
- Commit each application's `package.json` and generated `package-lock.json` together. A version reference alone does not pin transitive dependencies.
- Once a lockfile exists, teammates and CI should run `npm ci` in the directory containing it. Do not run it before the initial manifest and lockfile have been created.
- Agree on any version change as a team, then update this file, the relevant manifests, and their lockfiles together.

The three backend folders should follow the same baseline. Whether they share one package manifest or run as separate applications remains an implementation decision.
