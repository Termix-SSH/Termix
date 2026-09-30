!include MUI2.nsh
!include nsDialogs.nsh
!include LogicLib.nsh

!ifndef BUILD_UNINSTALLER
Var TermixDesktopCheckbox
Var TermixDesktopChoice

; Keep electron-builder's --no-desktop-shortcut flag, adding the UI choice.
!macro _TermixNoDesktopShortcut _a _b _t _f
  StrCmp $TermixDesktopChoice ${BST_UNCHECKED} `${_t}` 0
  ${StdUtils.TestParameter} $R9 "no-desktop-shortcut"
  StrCmp $R9 "true" `${_t}` `${_f}`
!macroend
!undef isNoDesktopShortcut
!define isNoDesktopShortcut `"" TermixNoDesktopShortcut ""`

; Defined here, not at include time: electron-builder includes this file
; before it adds the StdUtils plugin directory that isUpdated needs.
!macro customPageAfterChangeDir
  Page custom TermixShortcutPage TermixShortcutPageLeave

  Function TermixShortcutPage
    ; Updates retain electron-builder's existing keep-shortcuts behavior.
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "Shortcuts" "Choose whether to create a desktop shortcut."
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateCheckbox} 0 0 100% 16u "Create a desktop shortcut"
    Pop $TermixDesktopCheckbox
    ${If} $TermixDesktopChoice == ""
      StrCpy $TermixDesktopChoice ${BST_CHECKED}
    ${EndIf}
    ${StdUtils.TestParameter} $R9 "no-desktop-shortcut"
    ${If} $R9 == "true"
      StrCpy $TermixDesktopChoice ${BST_UNCHECKED}
      EnableWindow $TermixDesktopCheckbox 0
    ${EndIf}
    ${NSD_SetState} $TermixDesktopCheckbox $TermixDesktopChoice
    nsDialogs::Show
  FunctionEnd

  Function TermixShortcutPageLeave
    ${NSD_GetState} $TermixDesktopCheckbox $TermixDesktopChoice
  FunctionEnd
!macroend

!endif
