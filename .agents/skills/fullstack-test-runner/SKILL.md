---
name: fullstack-test-runner
description: Runs, analyzes, and debugs unit tests, e2e tests, and build/lint checks for both the NestJS backend and the Nuxt 4 frontend.
---

# Fullstack Test & Quality Runner

Use this skill when running tests, diagnosing failures, or checking health before merging changes.

## Commands Reference

### Backend (NestJS) — run in `backend_vamos-aprendiendo/`
```bash
npm run test        # unit tests (Jest)
npm run test:watch
npm run test:cov    # coverage
npm run test:e2e    # e2e (Supertest)
npm run lint        # eslint --fix (modifies files)
npm run build
```

### Frontend (Nuxt) — run in `frontend-vamos-aprendiendo/`
The frontend has no test runner configured.
```bash
npx nuxi typecheck
npm run build
```

## Diagnosis Workflow
1. **Run the target suite** with the Bash tool in the right folder.
2. **Analyze failures**: unhandled promise rejections, missing mock providers (`SupabaseService`, `ConfigService`, `JwtService`), DTO validation mismatches.
3. **Fix and verify** in the controller/service/spec and re-run until everything passes.

## Context7 validation (required before tests)
For every code change, first validate the libraries and APIs used against current docs via the Context7 MCP (`resolve-library-id`, then `query-docs`) using the versions in `package.json`. Fix any mismatch, then run the commands above. Report which libraries were checked; if Context7 is not connected, say so.
