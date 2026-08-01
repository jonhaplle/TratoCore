@echo off
cd /d %%~dp0
git add .
set /p MSG=Descricao do commit:
git commit -m "%%MSG%%"
git push
pause
