#!/usr/bin/env bash
# Pin HOME to the login user's real home directory (passwd entry).
# Sandboxed shells (e.g. IDE agents) override $HOME, while Sparkle itself writes logs, config and
# guard state under the real home — gates reading $HOME or os.homedir() would inspect an empty tree.

sparkle_pin_login_home() {
  local login_home
  login_home="$(dscl . -read "/Users/$(id -un)" NFSHomeDirectory 2>/dev/null | sed 's/^NFSHomeDirectory: //')"
  if [[ -n "$login_home" && -d "$login_home" ]]; then
    export HOME="$login_home"
  fi
}
