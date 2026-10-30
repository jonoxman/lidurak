# Autonomous Agent Rules (STRICT)
1. **Scope:** Only implement the requirements specified in the assigned `.tickets/T-XX.md` file. Never touch host orchestration scripts (`autopilot.sh`, `start-workspace.sh`, etc.).
2. **Resuming Partial Work:** Always start by running `git status` and `git diff` to see existing progress. Do not duplicate or overwrite working code.
3. **Mandatory Testing:** You MUST run the project test suite in the terminal and fix all errors before finishing.
4. **No Git Commits:** Never run `git commit`, `git checkout`, or `git branch`. The host orchestrator manages Git.
5. **Reviewer Communication Channel (`.reviews/agent_notes.md`):** Before signaling completion, write a concise summary of what you implemented—and, if responding to a code review, explain how you fixed each item or why any specific item is out-of-scope or intentional by design—into `.reviews/agent_notes.md`. The Principal Reviewer reads this file directly.
6. **Completion Sentinel (CRITICAL):** As your final step—and ONLY after all tests pass and `.reviews/agent_notes.md` is written—run this exact shell command:
   `echo "DONE" > .tickets/STATUS`
