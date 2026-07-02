# ADR-003: Pure JavaScript ESM without TypeScript or Build Step

## Status

Accepted

## Context

SpecFuse is a Node.js CLI tool that must run directly in the user's project without compilation, transpilation, or a build pipeline. The choice of language and module system affects distribution, maintenance, debugging, and the user experience of extending the tool with custom rules.

Three approaches were considered:

1. **Pure JavaScript ESM** — Write all source code in plain JavaScript using ES module syntax (`import/export`). Run directly with Node.js ≥20. No TypeScript, no transpiler, no build step.
2. **TypeScript with compiled output** — Write source in TypeScript, compile to JavaScript for distribution. Users install the compiled output; type definitions are published alongside.
3. **JavaScript CJS (CommonJS)** — Write in plain JavaScript using `require/module.exports`. Compatible with older Node.js versions and a broader ecosystem of dependencies.

## Decision

We chose **pure JavaScript ESM** (option 1). All source files use `.js` or `.mjs` extensions with ES module syntax. The project `"type": "module"` in `package.json`. No compilation, no TypeScript, no build step.

## Rationale

### Why not TypeScript with compilation?

- **Build step burden**: Adding TypeScript means every change requires a compile step before testing. For a CLI tool that users run locally, this adds latency and complexity to the development loop.
- **Rule author friction**: SpecFuse's extensibility model relies on users writing custom rules in `.specfuse/rules.mjs`. If SpecFuse were TypeScript-first, users would either need to write rules in TypeScript (requiring their own build setup) or in JavaScript (creating a mixed-language codebase with no type safety on the user side).
- **Distribution complexity**: Publishing compiled TypeScript requires maintaining separate source and dist directories, build scripts, and source-map configurations. For a tool with ~30 source files, this overhead is disproportionate.
- **Debugging mismatch**: Stack traces and error messages reference compiled line numbers, not source lines. This makes debugging harder for both maintainers and users, especially when rules fail at runtime.

### Why not CommonJS?

- **Top-level await**: ESM supports top-level `await`, which is essential for SpecFuse's async rule loading, file reads, and sync operations. CommonJS requires wrapping all async work in function calls, adding nesting and ceremony.
- **Modern Node.js**: SpecFuse requires Node.js ≥20, which has full ESM support. CommonJS is the legacy format; choosing it would anchor the project to older conventions.
- **Dynamic imports**: The rule loader uses `import()` to dynamically load both built-in and user plugin rules. This is natural in ESM but awkward in CommonJS (requiring `createRequire` hacks for `.mjs` files).
- **Dependency alignment**: SpecFuse's dependencies (`chalk`, `commander`, `diff`, `gray-matter`) all provide ESM exports. Using CJS would require `createRequire` shims for every ESM-only dependency.

### Why pure JavaScript ESM wins

- **Zero build step**: `node bin/specfuse.js` runs immediately. No `tsc`, no `esbuild`, no `babel`. Changes to source files are instantly testable.
- **Transparent source**: Users can read, debug, and extend the exact code that runs. No compiled intermediaries, no source maps, no `dist/` directories.
- **Natural rule authoring**: User plugin rules are `.mjs` files — the same format as built-in rules. Users don't need to learn a different module system or compile pipeline to extend SpecFuse.
- **Simplified distribution**: The `package.json` `"exports"` field maps directly to source files. The npm package contains the same files that developers work with.
- **Modern standard**: ESM is the official module standard for JavaScript. Node.js ≥20 supports it fully. Choosing ESM aligns with the ecosystem's trajectory.

## Consequences

### Positive

- Developers can run, test, and debug SpecFuse with a single `node` invocation.
- User plugin rules use the same module format as built-in rules, lowering the barrier to extension.
- No build toolchain to maintain, no compilation errors to chase, no `dist/` to clean.
- Stack traces point directly to source files and line numbers.

### Negative

- **No static type checking**: Without TypeScript, there's no compile-time verification of function signatures, property access, or interface conformance. Bugs that TypeScript would catch at compile time are only discovered at runtime.
- **JSDoc-only documentation**: Type information is expressed through JSDoc comments rather than TypeScript interfaces. This is less precise and not enforced by any tooling.
- **IDE support gap**: TypeScript provides richer autocomplete, refactoring, and inline documentation in IDEs. Pure JavaScript with JSDoc offers a subset of these features.
- **Rule validation is runtime-only**: The `validateRule()` function in the rule loader checks for required fields at runtime, not at compile time. A rule with a missing `extract` function won't be caught until sync actually tries to run it.

### Mitigations

- JSDoc comments with `@typedef` and `@param` annotations provide type hints for IDEs and documentation generators.
- The `validateRule()` function in the rule loader enforces the `SyncRule` contract at load time, catching missing fields before sync execution.
- The `RuleContext` object is `Object.freeze()`-wrapped, preventing rules from mutating the context or accessing undocumented properties.
- If TypeScript adoption becomes desirable in the future, the ESM source can be incrementally migrated: individual files can be converted to `.ts` while the rest of the project stays in `.js`, using TypeScript's `allowJs` mode.
