#!/usr/bin/env bash
# A scratch vault with every catalog plugin, served on :7799 by the dev build.
set -e
A="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)" # the repository
V=$PWD/vault
rm -rf "$V"; mkdir -p "$V/.kandinsky/plugins" "$V/notes"
for id in catalog catalog-web catalog-papers catalog-books catalog-music catalog-anime catalog-youtube catalog-wikipedia catalog-tmdb catalog-letterboxd; do
  [ -d "$A/plugins/beta/$id" ] || { echo "skip $id: not in this checkout"; continue; }
  mkdir -p "$V/.kandinsky/plugins/$id"
  cp -r "$A/plugins/beta/$id/"* "$V/.kandinsky/plugins/$id/"
  rm -rf "$V/.kandinsky/plugins/$id/__pycache__" "$V/.kandinsky/plugins/$id/engine"
done
sed -i "s|^run = .*|run = \"$A/target/debug/catalog\"|" "$V/.kandinsky/plugins/catalog/plugin.toml"
echo ok
