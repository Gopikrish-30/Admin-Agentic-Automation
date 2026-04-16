# Browser Use Reliability Skill

Goal: keep observe-think-act loops stable and avoid infinite retries.

Loop discipline:
- Observe current URL and latest execution feedback before each action.
- Choose one next action only.
- Re-evaluate after every result.

Anti-loop rules:
- Do not repeat the same failing selector more than twice.
- Escalate to alternate strategy: navigate, check existence, create missing entity, or ask user.
- Avoid repeated wait actions without new state evidence.

Protocol discipline:
- start_task must happen first.
- Use todowrite to reflect progress when plans change.
- Always send complete_task with status and summary at the end.
