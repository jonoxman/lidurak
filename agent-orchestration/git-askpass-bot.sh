#!/usr/bin/env bash
case "$1" in
  *Username*) echo "x-access-token" ;;
  *Password*) echo "${AGENT_PUSH_TOKEN:-}" ;;
esac
