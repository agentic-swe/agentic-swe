@echo off
REM Polyglot CMD/bash wrapper for Windows compatibility.
REM On Windows: runs via CMD. On Unix: falls through to bash.
REM Usage: hooks/run-hook.cmd <hook-name>

if "%OS%"=="Windows_NT" (
    REM Windows path: use bash from Git for Windows
    where bash >nul 2>&1
    if %errorlevel% equ 0 (
        bash "%~dp0%~1" %2 %3 %4 %5
    ) else (
        echo ERROR: bash not found. Install Git for Windows.
        exit /b 1
    )
    exit /b %errorlevel%
)

# Unix fallback (this file is sourced by sh/bash)
exec "$(dirname "$0")/$1" "$@"
