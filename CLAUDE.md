# Project Instructions

## Deploy Command

Every response that includes a code change MUST end with the following deploy command block:

```
cd C:\Users\yamas\minpaku-fix && git fetch origin && git checkout -f claude/review-handoff-docs-5WgKR && git reset --hard origin/claude/review-handoff-docs-5WgKR && node deploy-all.js
```
