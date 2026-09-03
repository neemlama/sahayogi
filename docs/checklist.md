# Devpost Submission Checklist — Good Neighbor track

**Deadline:** Sep 14 2026 5pm PDT (11 days) | Hackathon: agentsforhumans.devpost.com

## Required artifacts (upload before deadline)
- [ ] **Public GitHub repo URL** — push `building-phases` to public, ensure `LICENSE` MIT visible
- [ ] **README** with architecture — `README.md:1` already embeds `docs/architecture.png`
- [ ] **Architecture diagram** — `docs/architecture.png` + `docs/architecture.mmd` (commit)
- [ ] **Demo video ≤5 min** — follow `docs/video-script.md` (upload to YouTube/Vimeo public)
- [ ] **Text description** — problem (Maya/co-op repetitive forms), who (Nepal students/co-ops), why it matters (2 hrs/batch, audit trail, no invention)
- [ ] **AWS Builder ID** — create at builder.aws.com
- [ ] **Bonus:** publish `docs/builder-draft.md` on builder.aws.com with title containing “Agents for Humans” before deadline

## Good Neighbor specifics to emphasize
- Community batch: one agent helps 30 families via same form
- Document photos: citizenship/SEE parsing `document_parser.py:104`
- Safety: approval boundary `proposal.py:46`, audit `audit_log.py`

## Cost protection
- [ ] Keep Runtime ephemeral — `docs/deploy.md` + `COST.md` budget $20 alarm set
- [ ] Screenshots: ensure curated 4 (`extension_sidepanel_final.png`, `extension_filled_form.png`, `generic_ui_check.png`, `rsvp_form.png`) are committed (others are optional)

## Pre-submit run
```bash
uv run pytest tests/ -q   # expect 41 passed
git status                # should be clean
gh repo view --web        # or push origin/building-phases then set public
```
