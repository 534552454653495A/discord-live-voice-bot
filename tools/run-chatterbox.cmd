@echo off
rem Chatterbox local TTS server (uses the venv python). Device is auto-detected (cuda if available).
rem Usage: tools\run-chatterbox.cmd [extra args]   (e.g. --device cpu, --port 8021, --stt medium)
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
if not exist "%~dp0..\.venv-chatterbox\Scripts\python.exe" (
	echo No virtual environment yet. Run the setup first: powershell -NoProfile -ExecutionPolicy Bypass -File tools\setup-chatterbox.ps1
	pause
	exit /b 1
)
"%~dp0..\.venv-chatterbox\Scripts\python.exe" "%~dp0chatterbox_server.py" --port 8020 --model multilingual --stt small %*
if errorlevel 1 (
	echo.
	echo The server exited with an error (exit code %errorlevel%). Read the message above; not enough memory/disk is the most common cause.
	pause
)
