@echo off
rem Starts the Listen Together server on this PC at http://localhost:3000 (for local testing).
cd /d "%~dp0"
node server.js
pause
