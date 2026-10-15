@echo off
setlocal
cd /d "%~dp0"
py -3 -c "import sys;sys.exit(0 if sys.version_info >= (3,11) else 1)" >nul 2>&1
if not errorlevel 1 (
 py -3 "%~dp0companion\launcher.py" stop
 goto finished
)
python -c "import sys;sys.exit(0 if sys.version_info >= (3,11) else 1)" >nul 2>&1
if not errorlevel 1 (
 python "%~dp0companion\launcher.py" stop
 goto finished
)
echo Installa Python 3.11 o successivo dal sito ufficiale e leggi README.html.
pause
exit /b 1
:finished
if errorlevel 1 (
 echo Operazione non riuscita. Leggi README.html.
 pause
 exit /b 1
)
echo Collegamento locale fermato.
