#!/usr/bin/env bash
# Install Kandinsky for the current user: CLI + app binaries, desktop entries, icon, quick-capture script.
# Re-runnable; touches only ~/.cargo/bin, ~/.local/bin and ~/.local/share/{applications,icons} — and, in
# KDE Plasma, gives Kandinsky Capture a global key when it has none (kde-shortcut.sh: never replaces one).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); root=$(dirname "$here")
# release builds in a memory-capped scope of their own: systemd-oomd kills a build, never the terminal (heavy.sh)
[ -z "${KANDINSKY_HEAVY:-}" ] && exec bash "$root/scripts/dev/heavy.sh" bash "$here/install.sh" "$@"
echo "[install] building UI";            npm --prefix "$root/ui" run build >/dev/null
# The UI also as files (~/.local/share/kandinsky/ui): the desktop app serves it from there, and an open
# window reloads into a new one on its own — no restart for interface changes (ui_files.rs).
echo "[install] installing the UI";      ui_dest="${XDG_DATA_HOME:-$HOME/.local/share}/kandinsky/ui"
mkdir -p "$ui_dest.new" && cp -r "$root/ui/dist/." "$ui_dest.new/" && rm -rf "$ui_dest" && mv "$ui_dest.new" "$ui_dest"
# PDFium (~/.local/share/kandinsky/lib): the core draws PDF covers with it, no poppler needed (crates/kandinsky-core/src/pdfium.rs)
if [ "$(uname -sm)" = "Linux x86_64" ]; then
  bash "$root/scripts/dev/fetch-pdfium.sh" linux-x64 >/dev/null
  install -Dm644 "$root/local/pdfium/8086-linux-x64/lib/libpdfium.so" "${XDG_DATA_HOME:-$HOME/.local/share}/kandinsky/lib/libpdfium.so"
  echo "[install] PDFium in ${XDG_DATA_HOME:-$HOME/.local/share}/kandinsky/lib"
fi
bin="${CARGO_HOME:-$HOME/.cargo}/bin" # where cargo install puts the binaries
echo "[install] installing kandinsky CLI";   cargo install --quiet --locked --path "$root/crates/kandinsky"
echo "[install] installing kandinsky-app";   cargo install --quiet --locked --path "$root/crates/kandinsky-app"
echo "[install] installing kandinsky-capture"; cargo install --quiet --locked --path "$root/crates/kandinsky-capture"
install -Dm755 "$here/kandinsky-quick-capture" "$HOME/.local/bin/kandinsky-quick-capture"
# The desktop entry starts the installed binary by its full path (a launcher's PATH may lack
# ~/.cargo/bin). An entry that already starts Kandinsky on a chosen folder keeps its command: that line
# is the user's.
desk="$HOME/.local/share/applications/kandinsky.desktop"
exec_line="Exec=$bin/kandinsky-app"
if [ -f "$desk" ]; then
  old=$(grep -m1 '^Exec=' "$desk" || true)
  case "$old" in *kandinsky-app\ ?*) exec_line="$old"; echo "[install] keeping the desktop entry's command: ${old#Exec=}";; esac
fi
tmp=$(mktemp); sed "s|^Exec=.*|$exec_line|" "$here/kandinsky.desktop" > "$tmp"
install -Dm644 "$tmp" "$desk"; rm -f "$tmp"
# Same for the capture entry: ~/.local/bin is not on a KDE session's PATH, so a bare name never starts.
tmp=$(mktemp); sed "s|^Exec=.*|Exec=$HOME/.local/bin/kandinsky-quick-capture|" "$here/kandinsky-capture.desktop" > "$tmp"
install -Dm644 "$tmp" "$HOME/.local/share/applications/kandinsky-capture.desktop"; rm -f "$tmp"
# KWin lets a program take window pictures (ScreenShot2) when a desktop file with that program's path in Exec= says so:
# the capture box's picture of the window you were on (docs/guides/CAPTURE.md). Hidden from the menu.
tmp=$(mktemp); sed "s|^Exec=.*|Exec=$bin/kandinsky-capture|" "$here/kandinsky-capture-box.desktop" > "$tmp"
install -Dm644 "$tmp" "$HOME/.local/share/applications/kandinsky-capture-box.desktop"; rm -f "$tmp"
# the icon at every size KDE asks for (launcher, task bar, Alt+Tab), plus the master for any other scale
icons="$HOME/.local/share/icons/hicolor"
for s in 32x32 64x64 128x128; do install -Dm644 "$root/crates/kandinsky-app/icons/$s.png" "$icons/$s/apps/kandinsky.png"; done
install -Dm644 "$root/crates/kandinsky-app/icons/128x128@2x.png" "$icons/256x256/apps/kandinsky.png"
install -Dm644 "$root/crates/kandinsky-app/icons/icon.png" "$icons/512x512/apps/kandinsky.png"
install -Dm644 "$root/packaging/icon/kandinsky.svg" "$icons/scalable/apps/kandinsky.svg"
gtk-update-icon-cache -q -t "$icons" 2>/dev/null || true
# "Kandinsky (dev)": the UI from this repository's Vite dev server — edits to the UI show at once, no rebuild.
# KANDINSKY_REPO: auto-install.sh builds from a temporary copy and names the real repository here.
repo="${KANDINSKY_REPO:-$root}"
sed -e "s|^Exec=.*|Exec=env KANDINSKY_DEV=1 KANDINSKY_REPO=$repo $bin/kandinsky-app|" -e "s|^Name=.*|Name=Kandinsky (dev)|" \
  -e "s|^Comment=.*|Comment=Kandinsky with the UI live from $repo/ui (hot reload)|" "$here/kandinsky.desktop" > "$HOME/.local/share/applications/kandinsky-dev.desktop"
# hidden from the menu: Plasma shows one of two entries starting the same program, and it showed the dev one
#; start it with `gtk-launch kandinsky-dev`
# and without the window class: the taskbar named the normal window after whichever entry claimed it
sed -i '/^StartupWMClass=/d' "$HOME/.local/share/applications/kandinsky-dev.desktop"
echo "NoDisplay=true" >> "$HOME/.local/share/applications/kandinsky-dev.desktop"
command -v update-desktop-database >/dev/null && update-desktop-database "$HOME/.local/share/applications" || true
# the global key for the capture box (KDE): a key already chosen is kept; KANDINSKY_CAPTURE_KEY=none skips it
bash "$here/kde-shortcut.sh" || echo "[install] shortcut: not set (bind a key to 'Kandinsky Capture' in System Settings → Shortcuts)"
echo "[install] done"
