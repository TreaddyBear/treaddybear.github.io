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

set "INPUT=map-exports\lawn-maps.json"
if not "%~1"=="" set "INPUT=%~1"

"%NODE%" tools\import-maps.mjs "%INPUT%" --out map-exports\lawn-levels.generated.ts
if errorlevel 1 (
  echo.
  echo Import failed. Make sure Node.js is installed or available on PATH.
  exit /b 1
)

echo.
echo Generated map-exports\lawn-levels.generated.ts
