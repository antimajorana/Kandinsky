; Installer hooks (tauri.windows.conf.json `installerHooks`): the capture box in the Start menu, with a global key.
; A Start-menu shortcut's key works from anywhere in Windows; Ctrl+Alt+Shift+C (the Windows key cannot be given to a
; shortcut, and Ctrl+Alt alone is AltGr on many layouts). kandinsky-capture.exe sits beside the app (externalBin).
!macro NSIS_HOOK_POSTINSTALL
  CreateShortCut "$SMPROGRAMS\Kandinsky Capture.lnk" "$INSTDIR\kandinsky-capture.exe" "" "$INSTDIR\kandinsky-capture.exe" 0 SW_SHOWNORMAL "ALT|CONTROL|SHIFT|C" "Capture a thought into today's log"
  ; the same shortcut under the name it had before the rename (Kandinsky is based on Atlas): two would claim one key
  Delete "$SMPROGRAMS\Atlas Capture.lnk"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$SMPROGRAMS\Kandinsky Capture.lnk"
  Delete "$SMPROGRAMS\Atlas Capture.lnk"
!macroend
