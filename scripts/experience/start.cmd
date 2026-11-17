@echo off
setlocal
"%~dp0runtime\node.exe" "%~dp0backend\server.mjs" --open-browser
set "status=%ERRORLEVEL%"
if not "%status%"=="0" pause
exit /b %status%
