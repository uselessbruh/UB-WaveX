# 🎵 UB-WaveX - Project Overview

## What is UB-WaveX?

UB-WaveX is a **full-featured desktop music streaming and downloading application** that provides a Spotify-like experience for discovering, streaming, and downloading music from YouTube. It runs entirely locally with no cloud dependencies or external servers.

## ✨ Key Features

### Music Operations
- 🔍 **Search** - Find any song, artist, or album from YouTube
- ▶️ **Stream** - Play music directly without downloading
- ⬇️ **Download** - Save high-quality MP3s (320kbps) with full metadata
- 🎨 **Cover Art** - Automatic fetching from Cover Art Archive
- 📊 **Metadata** - Enhanced track info via MusicBrainz

### Library Management
- 📁 **Downloads** - All your downloaded tracks in one place
- ❤️ **Liked Songs** - Favorite tracks for easy access
- 📝 **Playlists** - Create and manage custom playlists
- 🔄 **Queue System** - Sequential playback with auto-next

### Playback
- 🎧 **Smart Player** - Seamless audio playback
- ⚡ **Preloading** - Next 5 tracks cached for gap-free experience
- 🎚️ **Full Controls** - Play, pause, skip, seek, volume
- ⌨️ **Keyboard Shortcuts** - Space to play/pause

### Technical Highlights
- 🚀 **Fast Startup** - UI loads instantly, heavy operations load after
- 💾 **Smart Caching** - Reduces repeated API calls
- 🔒 **Offline-First** - No server required, runs entirely locally
- 📦 **Single Executable** - Easy distribution and deployment

## 🏗️ Architecture

### Three-Tier Design

```
┌─────────────────────────────┐
│    Electron Frontend        │  ← User Interface
│    (HTML/CSS/JavaScript)    │
└──────────────┬──────────────┘
               │ IPC (JSON)
┌──────────────▼──────────────┐
│  Electron Main Process      │  ← Coordinator
│  (Node.js + MySQL)          │
└──────────────┬──────────────┘
               │ STDIN/STDOUT
┌──────────────▼──────────────┐
│   Python Core (EXE)         │  ← Music Engine
│   (yt-dlp + MusicBrainz)    │
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────┐
│      MySQL Database         │  ← Persistence
└─────────────────────────────┘
```

### Communication Flow

1. **User Action** → Electron UI
2. **UI Request** → Electron Main Process (via IPC)
3. **Processing**:
   - Database queries → Direct MySQL connection
   - Music operations → Python Core (via STDIN/STDOUT)
4. **Response** → Back through chain to UI
5. **UI Update** → Display results

### Why This Design?

- ✅ **Separation of Concerns**: Each component has a clear responsibility
- ✅ **Performance**: Heavy Python operations don't block the UI
- ✅ **Reliability**: Python crashes don't kill the whole app
- ✅ **Maintainability**: Easy to update individual components
- ✅ **Distribution**: Single package includes everything

## 📦 Components Breakdown

### 1. Electron Frontend (`src/ui/`)

**Files:**
- `index.html` - UI structure
- `styles.css` - Modern dark theme styling
- `renderer.js` - UI logic, search, library management
- `player.js` - Audio playback engine

**Responsibilities:**
- Render user interface
- Handle user interactions
- Audio playback via HTML5 Audio API
- Display track information
- Manage player controls
- Read from database (via main process)

**Key Features:**
- Responsive layout
- Real-time search
- Track visualization
- Playlist management UI
- Context menus

### 2. Electron Main Process (`src/electron/main.js`)

**Responsibilities:**
- Create and manage application window
- Spawn Python core process
- Connect to MySQL database
- Route IPC messages between UI and Python
- Handle database queries
- Manage application lifecycle

**Key Features:**
- Fast startup (UI first, backend after)
- IPC request/response handling
- Database connection pooling
- Python process management
- Error handling and recovery

### 3. Python Core (`src/python/music_core.py`)

**Responsibilities:**
- Search YouTube (via yt-dlp)
- Extract audio stream URLs
- Download tracks with metadata
- Query MusicBrainz for enhanced metadata
- Fetch cover art from Cover Art Archive
- Cache management
- Write to database

**Key Features:**
- JSON-based IPC over STDIN/STDOUT
- Comprehensive error handling
- Smart caching (stream URLs, metadata)
- Cover art downloading and caching
- High-quality audio conversion (320kbps MP3)
- Metadata embedding in files

**Dependencies:**
- `yt-dlp` - YouTube extraction
- `requests` - HTTP client
- `mysql-connector-python` - Database driver

### 4. MySQL Database (`database/schema.sql`)

**Tables:**
- `tracks` - All music tracks
- `artists` - Artist information
- `albums` - Album information
- `downloads` - Download records
- `liked_songs` - User likes
- `playlists` - User playlists
- `playlist_tracks` - Playlist-track relationships
- `cache` - Metadata and URL cache
- `cover_art_cache` - Cached cover images
- `settings` - Application settings

**Features:**
- Proper indexing for performance
- Foreign keys with cascading
- Normalized structure
- UTF-8 support for international characters

## 🔄 Data Flow Examples

### Example 1: Playing a Track

1. User clicks track in UI
2. `renderer.js` calls `playTrack(track)`
3. `player.js` checks if track is downloaded:
   - **Yes**: Play local file
   - **No**: Request stream URL
4. If streaming:
   - Main process sends request to Python via STDIN
   - Python extracts stream URL via yt-dlp
   - Python saves track metadata to database
   - Python returns stream URL via STDOUT
   - Main process forwards to renderer
5. `player.js` loads audio and plays
6. Track marked as "playing" in UI

### Example 2: Downloading a Track

1. User clicks download icon
2. `renderer.js` calls `downloadTrack(track)`
3. Main process sends download request to Python
4. Python:
   - Extracts audio via yt-dlp
   - Queries MusicBrainz for metadata
   - Fetches cover art from Cover Art Archive
   - Downloads and converts to MP3
   - Embeds metadata and cover art
   - Saves file to download folder
   - Records download in database
5. Success response returns to UI
6. UI updates to show download icon as active
7. Track appears in Downloads section

### Example 3: Playing a Playlist

1. User clicks playlist
2. UI loads all playlist tracks from database
3. User clicks first track
4. `player.js`:
   - Loads entire playlist into queue
   - Plays first track
   - Preloads next 5 tracks in background
5. When track ends:
   - Automatically plays next in queue
   - Preloads additional tracks
   - Cleans up old preloaded tracks (memory management)
6. Continues until playlist ends

## 📊 Performance Characteristics

### Startup Time
- **UI Visible**: < 1 second
- **Backend Ready**: 2-3 seconds
- **First Playback**: 3-5 seconds (network dependent)

### Memory Usage
- **Base Application**: ~100-150 MB
- **Per Preloaded Track**: ~5-10 MB
- **Maximum**: ~200 MB (5 preloaded tracks)

### Caching
- **Stream URLs**: 6 hours expiry
- **Metadata**: 30 days expiry
- **Cover Images**: Permanent (local files)

### Database Size Growth
- **Per Track**: ~500 bytes
- **Per Download Record**: ~200 bytes
- **Per Cache Entry**: ~1-5 KB
- **1000 Tracks**: ~1-2 MB

## 🔐 Security & Privacy

### Data Storage
- ✅ All data stored locally
- ✅ No cloud sync or external transmission
- ✅ Database only accessible from localhost
- ✅ No analytics or tracking

### External APIs
- **YouTube**: Search and stream extraction (public)
- **MusicBrainz**: Metadata (rate-limited, public)
- **Cover Art Archive**: Artwork (public)

All API calls respect rate limits and best practices.

## 📈 Scalability

### Current Limits
- **Tracks in Library**: No hard limit (tested up to 10,000)
- **Playlists**: No hard limit
- **Queue Size**: No hard limit
- **Preload Cache**: 5 tracks (configurable)

### Bottlenecks
- **Database**: MySQL can handle millions of records
- **Disk Space**: Downloads limited by available storage
- **Network**: YouTube and API rate limits

## 🛠️ Customization Points

### Easy to Modify
1. **UI Theme**: Edit `src/ui/styles.css`
2. **Default Paths**: Edit `config.json`
3. **Cache Duration**: Edit `src/python/music_core.py`
4. **Preload Count**: Edit `src/ui/player.js`
5. **Audio Quality**: Edit yt-dlp options in Python

### Advanced Modifications
1. **Add New Features**: Follow patterns in existing code
2. **Change Database**: Update schema and queries
3. **Add APIs**: Extend Python core
4. **Custom UI**: Replace entire `src/ui/` folder

## 📚 Documentation Files

- **README.md** - Main documentation
- **SETUP_GUIDE.md** - Installation and quick start
- **API_DOCUMENTATION.md** - Complete API reference
- **DEVELOPMENT_GUIDE.md** - Developer instructions
- **PROJECT_SUMMARY.md** - This file

## 🎯 Use Cases

1. **Music Discovery**: Search and try before downloading
2. **Offline Library**: Download favorites for offline listening
3. **Playlist Creation**: Organize music into collections
4. **Background Music**: Queue playlists for uninterrupted playback
5. **High-Quality Archive**: Save music with proper metadata

## 🔮 Future Enhancement Ideas

- [ ] Lyrics display integration
- [ ] Equalizer controls
- [ ] Auto-playlists (most played, recent, etc.)
- [ ] Import/export playlists
- [ ] Batch operations
- [ ] Advanced search filters
- [ ] Theme customization
- [ ] Mini player mode
- [ ] System media controls integration
- [ ] Discord Rich Presence

## 📝 Technical Specifications

### Requirements
- **OS**: Windows 10/11
- **Node.js**: 18+
- **Python**: 3.10+
- **MySQL**: 8.0+
- **FFmpeg**: Latest stable
- **RAM**: 4 GB minimum, 8 GB recommended
- **Disk**: 500 MB app + storage for downloads

### Performance Targets
- ✅ UI loads < 1 second
- ✅ Search results < 3 seconds
- ✅ Playback starts < 5 seconds
- ✅ Downloads at max available bandwidth
- ✅ No UI blocking during operations

## 🎓 Learning Outcomes

Building this project teaches:
- **Electron** desktop app development
- **IPC** inter-process communication
- **Python** process management
- **MySQL** database design and optimization
- **Audio** playback in web technologies
- **API** integration (REST APIs)
- **Caching** strategies
- **Queue** management algorithms
- **Build** and packaging processes
- **User Experience** design

## 🏆 Project Achievements

✅ **Complete Architecture**: Three-tier separation of concerns
✅ **No Server Required**: Fully local operation
✅ **Fast Startup**: UI-first loading strategy
✅ **Smart Caching**: Reduces redundant operations
✅ **Queue Management**: Seamless playlist playback
✅ **Metadata Resolution**: Enhanced track information
✅ **Professional UI**: Spotify-like experience
✅ **Comprehensive Documentation**: Multiple guides
✅ **Easy Setup**: Automated installation scripts
✅ **Production Ready**: Build and packaging configured

---

**UB-WaveX** represents a complete, production-ready desktop music application with professional architecture, comprehensive features, and excellent user experience.

Built with ❤️ for music lovers who want control over their listening experience.
