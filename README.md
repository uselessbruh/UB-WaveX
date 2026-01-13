# UB-WaveX

A full-featured desktop music streaming and downloading application built with Electron and Python.

## Features

- 🔍 **Search & Stream** - Search and play music directly from YouTube
- ⬇️ **High-Quality Downloads** - Download tracks with embedded metadata and cover art
- 📁 **Library Management** - Organize your music with downloads, liked songs, and playlists
- 🎵 **Smart Playback** - Automatic queue management with track preloading
- 🎨 **Modern UI** - Spotify-like interface with dark theme
- 💾 **Offline Operation** - Runs entirely locally with no backend server required
- 🖼️ **Cover Art** - Automatic fetching and caching from Cover Art Archive
- 📊 **Metadata Resolution** - Enhanced metadata from MusicBrainz

## Architecture

### Components

1. **Electron Frontend** - Desktop UI, playback controls, and database reads
2. **Python Core** (Packaged as EXE) - Music extraction, metadata resolution, downloads
3. **MySQL Database** - All persistent storage
4. **IPC Protocol** - JSON-based communication via STDIN/STDOUT

### Technology Stack

- **Frontend**: Electron, HTML5, CSS3, JavaScript
- **Backend**: Python 3.x with yt-dlp, requests, mysql-connector
- **Database**: MySQL 8.0+
- **Build Tools**: electron-builder, PyInstaller

## Prerequisites

### Required Software

1. **Node.js** (v18 or higher)
   - Download: https://nodejs.org/

2. **Python** (3.10 or higher)
   - Download: https://www.python.org/downloads/
   - Make sure to add Python to PATH during installation

3. **MySQL Server** (8.0 or higher)
   - Download: https://dev.mysql.com/downloads/mysql/
   - Note your root password during installation

4. **FFmpeg** (Required for yt-dlp audio conversion)
   - Download: https://ffmpeg.org/download.html
   - Add FFmpeg to system PATH

## Installation

### 1. Clone or Download the Project

```bash
cd C:\Users\ASUS\Desktop\UB-WaveX
```

### 2. Install Node Dependencies

```bash
npm install
```

### 3. Install Python Dependencies

```bash
cd src/python
pip install -r requirements.txt
cd ../..
```

### 4. Setup MySQL Database

1. Start MySQL server
2. Open MySQL command line or MySQL Workbench
3. Run the database schema:

```bash
mysql -u root -p < database/schema.sql
```

Or manually:
- Open MySQL Workbench
- Create a new connection to localhost
- Open `database/schema.sql`
- Execute the script

4. Update database credentials if needed in:
   - `src/electron/main.js` (lines 11-17)
   - `src/python/music_core.py` (lines 16-21)

### 5. Build Python Executable (Optional for Development)

For development, you can run the Python script directly. For production:

```bash
npm run build:python
```

This creates `src/python/dist/music_core.exe`

## Usage

### Development Mode

1. Start the application:

```bash
npm start
```

Or for development mode with debugging:

```bash
npm run dev
```

### Search and Play Music

1. Enter a song name or artist in the search bar
2. Click **Search** or press Enter
3. Click on any track to play it immediately
4. Use the player controls at the bottom

### Download Music

- Click the download icon (⬇️) on any track
- Or right-click and select "Download"
- Downloaded tracks appear in the Downloads section
- Downloads include full metadata and cover art

### Manage Library

**Downloads Section**:
- View all downloaded tracks
- Play offline without internet

**Liked Songs**:
- Click the heart icon (❤️) to like a track
- Access all liked songs in one place

**Playlists**:
- Click the **+** button to create a new playlist
- Click a playlist to view its tracks
- Right-click tracks to add to playlists
- Download entire playlists at once

### Playback Features

- **Queue Management**: Tracks auto-play sequentially in playlists
- **Preloading**: Next 5 tracks preload for seamless playback
- **Seek**: Click/drag the progress bar
- **Volume**: Adjust with the volume slider
- **Keyboard**: Press Space to play/pause

## Building for Distribution

### Build the Application

```bash
npm run build
```

This creates a Windows installer in the `dist` folder.

### Distribution Package Includes

- Electron application
- Python core executable
- All dependencies bundled
- Installer with optional installation directory

## Configuration

### Default Paths

- **Downloads**: `C:\Users\ASUS\Music\UB-WaveX`
- **Cache**: `C:\Users\ASUS\AppData\Local\UB-WaveX\cache`

These can be changed in the database `settings` table.

### Audio Quality

- Default: Best available (typically 320kbps MP3)
- Format: MP3 with embedded metadata and artwork

## Project Structure

```
UB-WaveX/
├── src/
│   ├── electron/
│   │   └── main.js              # Electron main process
│   ├── python/
│   │   ├── music_core.py        # Python core logic
│   │   ├── requirements.txt     # Python dependencies
│   │   └── music_core.spec      # PyInstaller config
│   └── ui/
│       ├── index.html           # Main UI
│       ├── styles.css           # Styling
│       ├── renderer.js          # UI logic
│       └── player.js            # Audio player engine
├── database/
│   └── schema.sql               # MySQL database schema
├── package.json                 # Node.js configuration
└── README.md                    # This file
```

## Troubleshooting

### Database Connection Failed

- Ensure MySQL server is running
- Check credentials in `src/electron/main.js` and `src/python/music_core.py`
- Verify database `ubwavex` exists

### Python Core Not Starting

- Ensure Python is in system PATH
- Check all Python dependencies are installed: `pip install -r src/python/requirements.txt`
- For packaged app, rebuild: `npm run build:python`

### FFmpeg Not Found

- Download FFmpeg from https://ffmpeg.org/
- Extract and add the `bin` folder to system PATH
- Restart terminal/command prompt after adding to PATH

### No Audio Playback

- Check internet connection (for streaming)
- Verify FFmpeg is installed
- Check browser console for errors (Ctrl+Shift+I)

### Search Returns No Results

- Verify internet connection
- Check if YouTube is accessible
- Try different search terms

## Database Schema

### Main Tables

- **tracks** - All music tracks
- **artists** - Artist information
- **albums** - Album information
- **downloads** - Downloaded track records
- **liked_songs** - User's liked tracks
- **playlists** - User playlists
- **playlist_tracks** - Playlist-track mappings
- **cache** - Metadata and stream URL cache
- **cover_art_cache** - Cached cover images

## Performance Optimization

### Caching Strategy

- Stream URLs cached for 6 hours
- Metadata cached for 30 days
- Cover images cached permanently
- Maximum 5 tracks preloaded in memory

### Database Optimization

- Indexed on frequently queried columns
- Foreign keys with appropriate cascading
- Connection pooling for efficiency

## License

MIT License - See LICENSE file for details

## Credits

- **yt-dlp** - YouTube audio extraction
- **MusicBrainz** - Metadata resolution
- **Cover Art Archive** - Album artwork
- **Electron** - Desktop application framework

## Support

For issues, questions, or contributions, please create an issue in the project repository.

---

**UB-WaveX** - Your personal music streaming and downloading companion
