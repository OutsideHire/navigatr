#!/usr/bin/env bash
# PreToolUse(Bash) guard: block commands that write DIRECTLY to production so the
# ship pipeline (PR -> main/staging -> promote-production) is enforced. Reads the
# hook JSON on stdin, denies via permissionDecision when the command is a direct
# prod write, otherwise stays silent (allow). Override: include ALLOW_PROD_WRITE.
set -euo pipefail
input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"

# Deliberate, logged override for a genuine hotfix.
if printf '%s' "$cmd" | grep -q 'ALLOW_PROD_WRITE'; then
  exit 0
fi

blocked=""

# (a) A supabase WRITE verb aimed at the production project ref.
if printf '%s' "$cmd" | grep -Eq 'ogvcveimjjeywfdkkinb' \
   && printf '%s' "$cmd" | grep -Eq 'db[[:space:]]+push|functions[[:space:]]+deploy|secrets[[:space:]]+(set|unset)|migration'; then
  blocked="a supabase write against the production project (ogvcveimjjeywfdkkinb)"
fi

# (b) A git push that targets the release (production) branch.
if [ -z "$blocked" ] \
   && printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+push' \
   && printf '%s' "$cmd" | grep -Eq '(^|[[:space:]:])release([^A-Za-z0-9_./-]|$)'; then
  blocked="a git push to the release (production) branch"
fi

if [ -n "$blocked" ]; then
  reason="Blocked: direct production write ($blocked). Use the pipeline (PR -> main -> promote-production workflow). For a genuine hotfix, re-run with ALLOW_PROD_WRITE in the command after the user confirms."
  jq -n --arg r "$reason" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
fi
exit 0
