#!/usr/bin/env bash
# macOS 26 SSOT — open Sparkle with GUI (default Dock launch is headless-only).
set -euo pipefail
open -a Sparkle --args --sparkle-force-gui
