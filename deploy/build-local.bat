@echo off
cd /d "%~dp0.."
call npm install
call npm run install:disparador
call npm run build
if not exist portfolio mkdir portfolio
xcopy /E /I /Y "portfolio pessoal\dist" "portfolio\dist"
echo.
echo Build concluido. Envie a pasta para a VPS e siga deploy\DEPLOY.md
pause
