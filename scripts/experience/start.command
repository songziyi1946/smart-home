#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 1
./runtime/node backend/server.mjs --open-browser
status=$?
if [ "$status" -ne 0 ]; then
  printf '\nSmart Home could not start. Press Enter to close this window.\n'
  read -r unused
fi
exit "$status"
