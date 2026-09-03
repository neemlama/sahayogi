# Safety model — human-approval boundary

FormBuddy is autonomous *until* a consequential action, then it stops. This is the property judges evaluate under **Good Neighbor / Technical Implementation**.

```
Chat/page → inspect_form / inspect_provided_html (read-only, Haiku sub-agent)
    ↓
Match fields against user profile / document_parser extraction
    ↓
Missing required field? → ask user, never invent (ValueError lists labels)
    ↓
log_decision(fields_matched) → propose_form_fill (refuses if required empty, proposal.py:89)
    ↓
status=pending_approval, requires_human_approval=True
    ↓
HUMAN reviews exact plan: URL, every {label, field_type, selector, required, value}, submit_selector, summary_for_human, fill_mode
    ↓
resume_after_approval(decision=approved|rejected) — idempotency guard, KeyError/ValueError if already decided
    ↓
Cloud: fill_and_submit_form (form_filler.py:87) via AgentCore Browser → submission_completed / submission_failed
Extension: background.js fillFieldsInPage (no submit) → you click Submit → record_extension_fill_result → same finalization
    ↓
Audit trail (audit_log.py) — actor agent/human, timestamp, detail, for every step
```

## Guarantees

*   **Never invents** a required value. Both orchestrator prompt (`orchestrator.py:73`) and `propose_form_fill` guard enforce it.
*   **No submission tool on the agent.** `fill_and_submit_form` is *not* a `@tool` — only `resume_after_approval` calls it after a recorded human decision.
*   **Idempotency:** double approve/reject or replayed extension reports are refused (`proposal.py:166`, `proposal.py:228`).
*   **Audit completeness:** `local JSONL` for demo, `DynamoDB` / `AgentCore Memory` for deployed — same interface, same trail.

## Scope limits (stated, not hidden)

*   Reads first `<form>` only; multi-form pages may need a hint
*   Static/server-rendered forms only; no login walls, no CAPTCHA solving, no JS-SPA that needs complex interaction (returns `ok:false` with notes)
*   No auto-retry on `submission_failed` — human follow-up required
