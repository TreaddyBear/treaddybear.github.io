@echo off
setlocal
cd /d "%~dp0"

set "NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    set "NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  )
)

"%NODE%" tools\export-maps.mjs --out map-exports\lawn-maps.json
if errorlevel 1 (
  echo.
  echo Export failed. Make sure Node.js is installed or available on PATH.
  exit /b 1
)

echo.
echo Exported maps to map-exports\lawn-maps.json
