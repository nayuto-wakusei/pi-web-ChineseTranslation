#!/usr/bin/env sh
set -eu

npm install -g @chainingintention/pi-web-cn --allow-scripts=node-pty
pi-web install
