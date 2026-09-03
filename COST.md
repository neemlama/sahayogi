# COST Guard — Stay under $20 of your $181 credits

> Goal: ship a winning Good Neighbor demo **without burning credits**. AgentCore Browser is the only meter that moves fast.

## Budget (us-east-1, Haiku tiering already at `agent/tools/form_inspector.py:35` / `form_filler.py:30`)

| Service | Cost | FormBuddy usage | Free-tier |
|---|---|---|---|
| Bedrock Haiku | ~$0.25 / 1M input | orchestrator Sonnet only for reasoning, inspector/filler/parser on Haiku (5x cheaper than Sonnet) | $0 |
| Bedrock Sonnet | ~$3 / 1M input | only `agent/orchestrator.py:98` | — |
| AgentCore Browser | ~$0.04–0.10 / full fill (billed per minute + per action) | `inspect_form:130` + `fill_and_submit_form:87` each spin a remote Chrome | **watch this** |
| DynamoDB on-demand | ~$0 | `session_store.py:36`, `audit_log.py:22` tables `formbuddy-sessions` / `formbuddy-audit-log`, <1KB / session | 25GB free |
| AgentCore Runtime | ~$0.05/hr | `api/main.py:44` only when video is recording | — |

`uv run pytest tests/ -q` = **41 tests, $0** (no AWS).

## Golden rules

1. **Default to `local`** — `SESSION_STORE_SOURCE=local` + `AUDIT_LOG_SOURCE=local` for 95% of dev. DynamoDB only when the Runtime is up.
2. **Prefer extension mode** — `inspect_provided_html:168` + `background.js:28` costs **$0 Browser** vs cloud mode. Show extension as primary in video, cloud for 30s proof.
3. **Max 3 live Browser runs** — 1) pre-video smoke test 2) video take 3) backup. Each run already calls `browser_tool._cleanup():146` to avoid idle `session_timeout_seconds=3600`.
4. **Ephemeral deploy** — Runtime up → record → down in <30 min (see `docs/deploy.md`). Do not leave Runtime running until Sep 14 deadline.
5. **No loops** — never `while True` over `manual_*.py`.

## Set a Billing alarm now (2 min)

```bash
# Create a $20 actual / $50 forecast alarm on your $181 credits
aws budgets create-budget --account-id $(aws sts get-caller-identity --query Account --output text) --budget '{
  "BudgetName": "formbuddy-guard",
  "BudgetLimit": {"Amount": "20", "Unit": "USD"},
  "TimeUnit": "MONTHLY",
  "BudgetType": "COST"
}' --notifications-with-subscribers '[
  {"Notification": {"NotificationType": "ACTUAL","ComparisonOperator": "GREATER_THAN","Threshold": 80,"ThresholdType": "PERCENTAGE"},"Subscribers": [{"SubscriptionType": "EMAIL","Address": "you@example.com"}]}
]'
# Or via Console: Billing → Budgets → Create budget → $20 → 80% + 100% email alerts
```

Also enable **AWS Cost Anomaly Detection** (free) for AgentCore/Bedrock.

## Teardown checklist (run after video)

```bash
# Stop Runtime (console or CLI)
# Delete DynamoDB tables only if you created them for the video
aws dynamodb delete-table --table-name formbuddy-sessions --region us-east-1
aws dynamodb delete-table --table-name formbuddy-audit-log --region us-east-1
# Revert extension to local
# extension/sidepanel.js:6 BACKEND_URL = "http://localhost:8000"
```

## When to spend

*   Video day: ~$1–2 total (1–2 Browser sessions + 30 min Runtime).
*   Judge evaluation rerun: they may trigger your public URL — if you took the Runtime down, leave a note in README “Deployed on demand; video shows live AgentCore Browser run” — judges accept this, and you save $10+ idle cost.

Keep this file next to `docs/deploy.md` and check `Billing → Cost Explorer → Group by Service` daily.
