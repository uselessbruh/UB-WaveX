@echo off
echo ========================================
echo UB-WaveX Setup Script
echo ========================================
echo.

REM Check Node.js
echo [1/6] Checking Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)
echo Node.js: OK

REM Check Python
echo [2/6] Checking Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python from https://www.python.org/
    pause
    exit /b 1
)
echo Python: OK

REM Check MySQL
echo [3/6] Checking MySQL...
mysql --version >nul 2>&1
if %errorlevel% neq 0 (
    echo WARNING: MySQL command line not found in PATH
    echo Make sure MySQL Server is installed and running
)
echo MySQL: Check manually if server is running

REM Check FFmpeg
echo [4/6] Checking FFmpeg...
ffmpeg -version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: FFmpeg is not installed or not in PATH
    echo Please install FFmpeg from https://ffmpeg.org/
    echo And add it to system PATH
    pause
    exit /b 1
)
echo FFmpeg: OK

REM Install Node dependencies
echo.
echo [5/6] Installing Node.js dependencies...
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install Node.js dependencies
    pause
    exit /b 1
)
echo Node dependencies: OK

REM Install Python dependencies
echo.
echo [6/6] Installing Python dependencies...
cd src\python
call pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo ERROR: Failed to install Python dependencies
    pause
    exit /b 1
)
cd ..\..
echo Python dependencies: OK

echo.
echo ========================================
echo Setup Complete!
echo ========================================
echo.
echo Next steps:
echo 1. Start MySQL server if not running: net start MySQL80
echo 2. Create database: mysql -u root -p ^< database\schema.sql
echo 3. Run application: npm start
echo.
echo See README.md for detailed instructions
echo.
pause
