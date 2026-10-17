#!/bin/bash
# Point web-ide.com at this machine and forward port 80 to the UI dev server,
# so the IDE opens at http://web-ide.com (no port in the URL).
#
# Usage (once after every reboot):
#   sudo ./scripts/setup-local-domain.sh
#
# Undo:
#   sudo pfctl -f /etc/pf.conf        # restore the default pf ruleset
#   sudo sed -i '' '/web-ide\.com/d' /etc/hosts
set -euo pipefail

DOMAIN=web-ide.com
UI_PORT=3099

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo $0" >&2
  exit 1
fi

if ! grep -q "$DOMAIN" /etc/hosts; then
  printf '127.0.0.1 %s\n' "$DOMAIN" >> /etc/hosts
  echo "Added $DOMAIN -> 127.0.0.1 to /etc/hosts"
else
  echo "/etc/hosts already maps $DOMAIN"
fi

# Replace the active pf ruleset with just this redirect (an empty filter
# ruleset passes all traffic, so nothing else is blocked). The rule does not
# survive a reboot; rerun this script to restore it.
echo "rdr pass on lo0 proto tcp from any to any port 80 -> 127.0.0.1 port $UI_PORT" | pfctl -f -
pfctl -e 2>/dev/null || true
echo "Forwarded port 80 -> 127.0.0.1:$UI_PORT"
echo "Open http://$DOMAIN (after 'npm run dev')"
