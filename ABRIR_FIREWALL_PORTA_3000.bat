@echo off
netsh advfirewall firewall add rule name="TratoCore Porta 3000" dir=in action=allow protocol=TCP localport=3000
if errorlevel 1 (
  echo Execute este arquivo como ADMINISTRADOR.
) else (
  echo Porta 3000 liberada no Firewall do Windows.
)
pause
