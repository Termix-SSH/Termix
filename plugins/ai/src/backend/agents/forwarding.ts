import { shellQuote } from "./types.js";

export const FORWARDING_ADMIN_SCRIPT = String.raw`set -eu
account=$1
peer=$2
[ "$(uname -s)" = Linux ] || { echo 'Automatic SSH configuration currently requires Linux with systemd and OpenSSH'; exit 1; }
sshd=/usr/sbin/sshd
config=/etc/ssh/sshd_config
[ -x "$sshd" ] && [ -f "$config" ] || { echo 'OpenSSH server configuration not found'; exit 1; }
"$sshd" -t
if systemctl is-active --quiet ssh; then service=ssh; elif systemctl is-active --quiet sshd; then service=sshd; else echo 'No active systemd SSH service found'; exit 1; fi
lock=/etc/ssh/.termix-agent-forward.lock
mkdir "$lock" 2>/dev/null || { echo 'Another SSH configuration operation is running'; exit 1; }
candidate=
backup=
changed=0
committed=0
cleanup() {
  code=$?
  trap - EXIT
  if [ "$changed" = 1 ] && [ "$committed" = 0 ]; then
    echo 'Restoring previous SSH configuration'
    cp -p "$backup" "$config"
    "$sshd" -t && systemctl reload "$service" || echo "SSH rollback reload failed; restore $backup manually"
  fi
  if [ -n "$candidate" ] && [ -f "$candidate" ]; then rm "$candidate"; fi
  rmdir "$lock"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
context="user=$account,addr=$peer,host=termix"
effective=$("$sshd" -T -C "$context")
echo "SSH account: $account; observed connection source: $peer"
if printf '%s\n' "$effective" | grep -qx 'disableforwarding yes'; then
  echo 'DisableForwarding is enabled; an administrator must review this policy first'
  exit 1
fi
tcp=$(printf '%s\n' "$effective" | awk '$1 == "allowtcpforwarding" {print $2}')
listen=$(printf '%s\n' "$effective" | awk '$1 == "permitlisten" {$1=""; print}')
case "$tcp" in
  yes|all|remote)
    for rule in $listen; do
      case "$rule" in any|'127.0.0.1:*'|'*:*') echo 'Loopback remote forwarding is already allowed'; exit 0;; esac
    done;;
esac
# Preserve an already allowed local forwarding capability.
case "$tcp" in yes|all|local) tcp=yes;; *) tcp=remote;; esac
begin="# BEGIN Termix Agent $account $peer"
end="# END Termix Agent $account $peer"
block=$(printf '%s\nMatch User %s Address %s\n  AllowTcpForwarding %s\n  PermitListen 127.0.0.1:*\n  GatewayPorts no\n%s\n' "$begin" "$account" "$peer" "$tcp" "$end")
candidate=$(mktemp /etc/ssh/.termix-sshd.XXXXXX)
cp -p "$config" "$candidate"
awk -v begin="$begin" -v end="$end" -v block="$block" '
  $0 == begin { skip=1; next }
  $0 == end { skip=0; next }
  !skip {
    if (!inserted && ($0 ~ /^[ \t]*Match[ \t]/ || $0 ~ /^# BEGIN Termix Agent /)) { print block; inserted=1 }
    print
  }
  END { if (!inserted) print block }
' "$config" > "$candidate"
"$sshd" -t -f "$candidate"
check=$("$sshd" -T -f "$candidate" -C "$context")
printf '%s\n' "$check" | grep -qx "allowtcpforwarding $tcp"
printf '%s\n' "$check" | grep -Fqx 'permitlisten 127.0.0.1:*'
printf '%s\n' "$check" | grep -qx 'gatewayports no'
printf '%s\n' "$check" | grep -qx 'disableforwarding no'
mkdir -p /etc/ssh/termix-agent-backups
chmod 700 /etc/ssh/termix-agent-backups
backup=$(mktemp /etc/ssh/termix-agent-backups/sshd_config.XXXXXX)
cp -p "$config" "$backup"
echo "Backup: $backup"
changed=1
mv "$candidate" "$config"
systemctl reload "$service"
"$sshd" -t
committed=1
echo 'Enabled loopback remote forwarding for this SSH account and source only'
`;

export function forwardingScript(): string {
  return `set -eu
account=$(id -un)
peer=$(printf '%s' "$SSH_CONNECTION" | cut -d ' ' -f 1)
printf '%s' "$account" | grep -Eq '^[A-Za-z0-9_.-]+$' || { echo 'Unsupported SSH account name'; exit 1; }
printf '%s' "$peer" | grep -Eq '^[0-9a-fA-F:.]+$' || { echo 'Unable to determine the SSH connection source'; exit 1; }
script=${shellQuote(FORWARDING_ADMIN_SCRIPT)}
if [ "$(id -u)" = 0 ]; then
  exec sh -c "$script" termix "$account" "$peer"
else
  exec sudo -n sh -c "$script" termix "$account" "$peer"
fi
`;
}
