# Autonomous Agent Rules (STRICT)
1. **Scope:** Only implement the requirements specified in the assigned `.tickets/T-XX.md` file.
2. **Resuming Partial Work:** Always start by running `git status` and `git diff` to check if a previous session already partially implemented this ticket. Do not duplicate or overwrite working code.
3. **Mandatory Testing:** You MUST run the project test suite in the terminal and fix all errors before finishing.
4. **No Git Commits:** Never run `git commit`, `git checkout`, or `git branch`. The host orchestrator manages Git.
5. **Completion Sentinel (CRITICAL):** As your final step—and ONLY after all tests pass—run this exact shell command:
   `echo "DONE" > .tickets/STATUS`
