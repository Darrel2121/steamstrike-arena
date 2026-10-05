$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $DesktopPath "Steamstrike Server.lnk"
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "D:\!Annet_game\start_server.bat"
$Shortcut.WorkingDirectory = "D:\!Annet_game"
$Shortcut.WindowStyle = 1
$Shortcut.Description = "Start Steamstrike Tactical Arena Server"
$Shortcut.IconLocation = "D:\!Annet_game\steamstrike.ico,0"
$Shortcut.Save()
Write-Host "SHORTCUT_CREATED_AT: $ShortcutPath"
