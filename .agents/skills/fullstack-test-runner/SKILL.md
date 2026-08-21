---
name: fullstack-test-runner
description: Runs, analyzes, and debugs unit tests, e2e tests, and code quality checks for both NestJS backend and Nuxt 4 frontend.
---

# Fullstack Test & Quality Runner

Use this skill when running tests, diagnosing test suite errors, or checking TypeScript / ESLint health before merging changes.

## Commands Reference

### Backend (NestJS)
Run in `backend/`:
```bash
# Run unit tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run e2e tests
npm run test:e2e

# Run linter and formatting
npm run lint
```

### Frontend (Nuxt)
Run in `frontend/`:
```bash
# Typecheck
npx nuxi typecheck

# Build check
npm run build
```

## Diagnosis Workflow
1. **Run target test suite** using `run_command`.
2. **Analyze failure outputs**: Look for unhandled promise rejections, missing mock providers (e.g. `SupabaseService`, `ConfigService`), or DTO validation mismatches.
3. **Fix and verify**: Apply fixes in the respective controller/service/test file and re-run the test suite until all pass.
