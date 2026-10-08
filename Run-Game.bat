@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if not errorlevel 1 (
    set "GAME_PYTHON=py"
    goto start_game
)

where python >nul 2>nul
if not errorlevel 1 (
    set "GAME_PYTHON=python"
    goto start_game
)

echo Python was not found.
echo Install Python, then run this file again.
pause
exit /b 1

:start_game
rem Listen on every interface, like AppServer, so a phone on the same
rem network can open the game. This PC still uses 127.0.0.1.
echo Starting game at http://127.0.0.1:8422
%GAME_PYTHON% -c "import socket; s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(('8.8.8.8', 80)); print('Phone on the same network: http://' + s.getsockname()[0] + ':8422')" 2>nul || echo Phone on the same network: http://THIS-PC-IP:8422
echo Keep this window open while playing. Press Ctrl+C to stop.
start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 700; Start-Process 'http://127.0.0.1:8422'"
%GAME_PYTHON% -m http.server 8422 --bind 0.0.0.0

if errorlevel 1 (
    echo.
    echo The game server could not start. Port 8422 may already be in use.
    pause
)
