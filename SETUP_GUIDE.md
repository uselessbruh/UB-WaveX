# UB-WaveX Quick Setup Guide

## Quick Start (Windows)

### 1. Install Prerequisites

**Node.js:**
```powershell
# Download and install from https://nodejs.org/
# Verify installation:
node --version
npm --version
```

**Python:**
```powershell
# Download and install from https://www.python.org/
# Verify installation:
python --version
pip --version
```

**MySQL:**
```powershell
# Download and install from https://dev.mysql.com/downloads/mysql/
# Remember your root password!
```

**FFmpeg:**
```powershell
# Download from https://ffmpeg.org/download.html
# Extract and add to PATH
# Verify:
ffmpeg -version
```

### 2. Setup Project

```powershell
# Navigate to project
cd C:\Users\ASUS\Desktop\UB-WaveX

# Install Node dependencies
npm install

# Install Python dependencies
cd src\python
pip install -r requirements.txt
cd ..\..
```

### 3. Setup Database

```powershell
# Start MySQL service
net start MySQL80

# Create database (replace 'root' and 'your_password' with your credentials)
mysql -u root -p < database\schema.sql
```

### 4. Run Application

```powershell
# Development mode
npm start

# Or with debugging
npm run dev
```

## First Time Setup Checklist

- [ ] Node.js installed and in PATH
- [ ] Python installed and in PATH
- [ ] MySQL server installed and running
- [ ] FFmpeg installed and in PATH
- [ ] Database created with schema.sql
- [ ] Node modules installed (npm install)
- [ ] Python packages installed (pip install -r requirements.txt)

## Common Commands

```powershell
# Start application
npm start

# Build Python executable
npm run build:python

# Build Windows installer
npm run build

# Check if services are running
# MySQL:
sc query MySQL80
# If stopped, start it:
net start MySQL80
```

## Default Configuration

**Database:**
- Host: localhost
- User: root
- Password: (empty by default - change in code if you set one)
- Database: ubwavex

**Paths:**
- Downloads: `C:\Users\ASUS\Music\UB-WaveX`
- Cache: `C:\Users\ASUS\AppData\Local\UB-WaveX\cache`

## Testing the Application

1. **Start the app**: `npm start`
2. **Wait for "Backend Ready"** message
3. **Search for a song**: Type in search bar and click Search
4. **Click a track**: Should start playing immediately
5. **Download a track**: Click the download icon
6. **Check Downloads**: Navigate to Downloads section

## Troubleshooting Quick Fixes

**"Backend initialization failed"**
```powershell
# Check MySQL is running
net start MySQL80

# Check Python dependencies
cd src\python
pip install -r requirements.txt
cd ..\..
```

**"Database connection failed"**
```powershell
# Test MySQL connection
mysql -u root -p
# If successful, check credentials in:
# - src/electron/main.js (line 12-16)
# - src/python/music_core.py (line 17-20)
```

**"Search returns no results"**
- Check internet connection
- Verify FFmpeg is in PATH: `ffmpeg -version`

**"No audio playback"**
- Check browser console (Ctrl+Shift+I in app)
- Verify internet connection
- Try a different track

## Building Executable

### Python Core:
```powershell
npm run build:python
# Creates: src/python/dist/music_core.exe
```

### Windows Installer:
```powershell
npm run build
# Creates: dist/UB-WaveX Setup.exe
```

## Development Tips

**Debug Python Core:**
```powershell
cd src\python
python music_core.py
# Then send JSON via STDIN for testing
```

**Debug Electron:**
```powershell
npm run dev
# Opens DevTools automatically
```

**Check Database:**
```powershell
mysql -u root -p ubwavex
# Then run queries:
SHOW TABLES;
SELECT * FROM tracks LIMIT 10;
```

## Support

If you encounter issues:
1. Check this guide first
2. Verify all prerequisites are installed
3. Check the main README.md for detailed troubleshooting
4. Look at console/terminal for error messages

---

Happy Streaming! 🎵
