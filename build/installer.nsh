!macro customInstall
  SetDetailsPrint both
  SetDetailsView show
  aurel_setup_ai:
  DetailPrint "Setting up AI transcription. The first installation downloads several GB."
  ${If} $installMode == "all"
    nsExec::ExecToLog '"$appExe" --install-ai-engine-for-machine'
  ${Else}
    nsExec::ExecToLog '"$appExe" --install-ai-engine'
  ${EndIf}
  Pop $0
  ${If} $0 != "0"
    DetailPrint "AI setup did not finish. You can retry in Aurel under Settings > AI Engine."
    ${If} ${Silent}
      SetErrorLevel 1
      Quit
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Aurel is installed, but AI setup did not finish. Check your connection and available disk space. Retry now, or use Settings > AI Engine to finish setup later." IDRETRY aurel_setup_ai
  ${EndIf}
!macroend
