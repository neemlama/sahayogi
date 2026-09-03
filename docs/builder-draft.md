# Builder Draft — publish on builder.aws.com for bonus points

**Title:** Agents for Humans: FormBuddy — A Good Neighbor Agent That Fills Public-Service Forms Without Ever Guessing

**Tags:** `Agents for Humans`, `Strands Agents SDK`, `Bedrock`, `AgentCore Browser`, `Good Neighbor`

**Body (800–1000 words, include architecture.png):**

1. **The repetitive work I wanted to erase** — Maya’s story: 12 forms/year, ward letters, scholarships, same fields retyped, co-op ×30. Why browser autofill fails for communities.

2. **Why an agent, not an app** — “Runs quietly, surfaces only for a decision.” How that maps to Strands: orchestrator reasons, proposes, then *stops* at `propose_form_fill`.

3. **Building with Strands + AgentCore Browser** — Two modes one brain `agent/orchestrator.py:40`. Haiku sub-agents for `inspect_form`/`fill_and_submit_form` to cut cost 5x (measured). Extension path `inspect_provided_html` avoids Browser cost entirely. Code snippets: `proposal.py:89` guard, `form_filler.py:146` cleanup.

4. **Safety as a feature, not a footnote** — Never invents required, no submission tool, dual audit trail `audit_log.py`, idempotency, extension never clicks submit. Why this matters for Good Neighbor trust.

5. **Cost-conscious build on $181 credits** — Local-first, `41 tests $0`, ephemeral Runtime (`COST.md`, `docs/deploy.md`). Video recorded in 30 min.

6. **What I learned & next** — AgentCore Memory for cooperatives (shared vault), observability traces, S3-hosted demo for stable Browser URLs.

**Include:** `docs/architecture.png`, screenshot `extension_sidepanel_final.png`, link to repo (public), demo URL.

**Publish checklist:**
- [ ] Title contains “Agents for Humans”
- [ ] Public before Sep 14 5pm PDT
- [ ] Add to Devpost submission as bonus link
