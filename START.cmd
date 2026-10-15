@echo off
setlocal
cd /d "%~dp0"
py -3 -c "import sys;sys.exit(0 if sys.version_info >= (3,11) else 1)" >nul 2>&1
if not errorlevel 1 (
 py -3 "%~dp0companion\launcher.py" start
 goto finished
)
python -c "import sys;sys.exit(0 if sys.version_info >= (3,11) else 1)" >nul 2>&1
if not errorlevel 1 (
 python "%~dp0companion\launcher.py" start
 goto finished
)
echo Install Python 3.11 or newer from python.org and read README.html.
pause
exit /b 1
:finished
if errorlevel 1 (
 echo The operation failed. Read README.html.
 pause
 exit /b 1
)
echo Open Rewards Adviser, choose a reader and select Save and connect.
