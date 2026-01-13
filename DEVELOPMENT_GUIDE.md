# UB-WaveX Development Guide

## Architecture Overview

### Component Layers

```
┌─────────────────────────────────────────┐
│         Electron UI (Renderer)          │
│  HTML + CSS + JavaScript + Audio API    │
└────────────────┬────────────────────────┘
                 │ IPC (JSON)
┌────────────────▼────────────────────────┐
│       Electron Main Process             │
│  - IPC Routing                          │
│  - Database Queries (MySQL)             │
│  - Python Process Management            │
└────────────────┬────────────────────────┘
                 │ STDIN/STDOUT
┌────────────────▼────────────────────────┐
│          Python Core (EXE)              │
│  - YouTube Extraction (yt-dlp)          │
│  - Metadata Resolution (MusicBrainz)    │
│  - Cover Art (Cover Art Archive)        │
│  - File Downloads + Metadata Embedding  │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│         MySQL Database                  │
│  Persistent Storage for Everything      │
└─────────────────────────────────────────┘
```

## File Structure Explained

```
UB-WaveX/
├── src/
│   ├── electron/
│   │   └── main.js              # Electron main process
│   │       - Window management
│   │       - IPC handlers for UI
│   │       - Database connection
│   │       - Python process spawning
│   │
│   ├── python/
│   │   ├── music_core.py        # Python core logic
│   │   │   - MusicCore class (all operations)
│   │   │   - IPCHandler class (STDIN/STDOUT)
│   │   │   - Search, stream, download, metadata
│   │   ├── requirements.txt     # Python dependencies
│   │   └── music_core.spec      # PyInstaller configuration
│   │
│   └── ui/
│       ├── index.html           # Main UI structure
│       ├── styles.css           # All styling
│       ├── renderer.js          # UI logic and interactions
│       │   - Search handling
│       │   - Library management
│       │   - Playlist operations
│       │   - IPC communication
│       └── player.js            # Audio player engine
│           - Playback control
│           - Queue management
│           - Track preloading
│
├── database/
│   └── schema.sql               # Complete database schema
│
├── build/                       # Build resources (icons, etc.)
├── config.json                  # App configuration
├── package.json                 # Node.js project config
├── setup.bat                    # Windows setup script
└── start.bat                    # Quick start script
```

## Key Technologies

### Frontend
- **Electron 28**: Desktop application framework
- **HTML5 Audio API**: Audio playback
- **Vanilla JavaScript**: No frameworks for simplicity
- **CSS Grid/Flexbox**: Responsive layout

### Backend
- **Python 3.10+**: Core logic
- **yt-dlp**: YouTube extraction
- **requests**: HTTP client for APIs
- **mysql-connector-python**: Database driver

### Database
- **MySQL 8.0**: Relational database
- Indexed for performance
- Foreign keys for data integrity

### Build Tools
- **electron-builder**: Create Windows installer
- **PyInstaller**: Package Python as EXE

## Development Workflow

### 1. Environment Setup

```bash
# Clone/download project
cd C:\Users\ASUS\Desktop\UB-WaveX

# Install dependencies
npm install
cd src/python
pip install -r requirements.txt
cd ../..

# Setup database
mysql -u root -p < database/schema.sql
```

### 2. Running in Development

```bash
# Terminal 1: Run Electron
npm start

# Terminal 2 (optional): Monitor Python logs
cd src/python
python music_core.py
```

### 3. Making Changes

#### UI Changes
1. Edit files in `src/ui/`
2. Reload app (Ctrl+R in Electron window)
3. Check console for errors (Ctrl+Shift+I)

#### Python Changes
1. Edit `src/python/music_core.py`
2. Restart app (changes apply on next spawn)
3. For immediate testing: Run Python directly

#### Database Changes
1. Edit `database/schema.sql`
2. Drop and recreate database:
   ```sql
   DROP DATABASE ubwavex;
   CREATE DATABASE ubwavex;
   USE ubwavex;
   SOURCE database/schema.sql;
   ```

### 4. Testing

#### Manual Testing Checklist
- [ ] Search for music
- [ ] Play a track (streaming)
- [ ] Download a track
- [ ] Like/unlike tracks
- [ ] Create playlist
- [ ] Add tracks to playlist
- [ ] Play playlist (queue)
- [ ] Skip tracks
- [ ] Volume control
- [ ] Seek control

#### Debug Tools
```javascript
// In renderer process (DevTools Console)
console.log(window.player);           // Player instance
console.log(window.player.queue);     // Current queue
console.log(window.player.preloadCache); // Preload cache

// Check backend status
console.log(backendReady);
```

```sql
-- In MySQL
-- Check data
SELECT * FROM tracks LIMIT 10;
SELECT * FROM cache WHERE cache_type = 'stream_url';
SELECT COUNT(*) FROM downloads;
```

## Common Development Tasks

### Adding a New IPC Handler

**1. Add to Electron (main.js):**
```javascript
ipcMain.handle('my-new-action', async (event, params) => {
  try {
    // Process request
    const result = await processMyAction(params);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

**2. Call from Renderer (renderer.js):**
```javascript
async function myNewAction(params) {
  const result = await ipcRenderer.invoke('my-new-action', params);
  if (result.success) {
    // Handle success
  } else {
    showError(result.error);
  }
}
```

### Adding a Python Action

**1. Add method to MusicCore class:**
```python
def my_new_action(self, params: Dict[str, Any]) -> Any:
    """Your action description"""
    try:
        # Implementation
        return result
    except Exception as e:
        self.log_error(f"Action failed: {str(e)}")
        raise
```

**2. Add handler in IPCHandler:**
```python
def handle_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
    # ... existing code ...
    elif action == 'my_new_action':
        result = self.music_core.my_new_action(params)
        return self.success_response(request_id, result)
```

**3. Call from Electron:**
```javascript
const result = await sendPythonRequest('my_new_action', { param: value });
```

### Adding a Database Table

**1. Update schema.sql:**
```sql
CREATE TABLE IF NOT EXISTS my_table (
    id INT AUTO_INCREMENT PRIMARY KEY,
    column1 VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_column1 (column1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**2. Add query handler in main.js:**
```javascript
ipcMain.handle('db-get-my-data', async () => {
  try {
    const [rows] = await dbConnection.execute('SELECT * FROM my_table');
    return { success: true, data: rows };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

### Adding a UI View

**1. Add HTML structure (index.html):**
```html
<div id="view-myview" class="view">
    <h2>My View</h2>
    <div id="myview-content" class="track-list">
        <!-- Content here -->
    </div>
</div>
```

**2. Add navigation item:**
```html
<a href="#" class="nav-item" data-view="myview">
    <span class="icon">📋</span>
    <span>My View</span>
</a>
```

**3. Add logic (renderer.js):**
```javascript
function loadMyView() {
  switchView('myview');
  // Load data
  const content = document.getElementById('myview-content');
  // Populate content
}
```

## Performance Optimization Tips

### UI Performance
1. **Debounce search input**: Prevent excessive queries
2. **Virtual scrolling**: For large track lists (future enhancement)
3. **Image lazy loading**: Load cover art on demand

### Database Performance
1. **Indexes**: Add on frequently queried columns
2. **Connection pooling**: Already configured
3. **Batch operations**: Use transactions for multiple inserts

### Python Performance
1. **Caching**: Already implemented for metadata and streams
2. **Async operations**: Consider for multiple downloads
3. **Memory management**: Clean up preload cache

### Network Performance
1. **Stream URL caching**: 6 hours (adjustable)
2. **Metadata caching**: 30 days (adjustable)
3. **Rate limiting**: Respect API limits

## Debugging

### Electron Issues

```javascript
// Enable detailed logging in main.js
const debug = true;

if (debug) {
  console.log('[IPC]', action, params);
  console.log('[Response]', response);
}

// Open DevTools automatically in dev mode
if (process.argv.includes('--dev')) {
  mainWindow.webContents.openDevTools();
}
```

### Python Issues

```python
# Add debug logging in music_core.py
import logging
logging.basicConfig(level=logging.DEBUG)

# In methods:
logging.debug(f"Processing: {params}")
```

### Database Issues

```sql
-- Enable query logging
SET GLOBAL general_log = 'ON';
SET GLOBAL log_output = 'TABLE';

-- View logs
SELECT * FROM mysql.general_log ORDER BY event_time DESC LIMIT 100;
```

## Building for Production

### 1. Build Python Executable

```bash
npm run build:python
# Or manually:
cd src/python
pyinstaller --onefile --clean music_core.spec
cd ../..
```

**Output**: `src/python/dist/music_core.exe`

### 2. Build Electron App

```bash
npm run build
```

**Output**: `dist/UB-WaveX Setup.exe`

### 3. Test Built Application

1. Install from `dist/UB-WaveX Setup.exe`
2. Test all features
3. Check for missing dependencies
4. Verify file paths work correctly

## Common Pitfalls

### 1. Path Issues
- **Problem**: File paths differ between dev and production
- **Solution**: Use `app.getPath()` and check `app.isPackaged`

### 2. Python Not Found
- **Problem**: Python executable not spawning
- **Solution**: Check path logic in `getPythonExecutablePath()`

### 3. Database Connection Fails
- **Problem**: MySQL not running or wrong credentials
- **Solution**: Verify service is running, check credentials

### 4. Stream URLs Expire
- **Problem**: Playback fails after some time
- **Solution**: Re-fetch URLs, adjust cache expiry

### 5. FFmpeg Missing
- **Problem**: Downloads fail
- **Solution**: Bundle FFmpeg or require in prerequisites

## Code Style Guidelines

### JavaScript
- Use `const` for constants, `let` for variables
- Async/await for asynchronous operations
- Clear function names describing actions
- Comments for complex logic

### Python
- Follow PEP 8 style guide
- Type hints for function parameters
- Docstrings for all methods
- Error handling with try/except

### SQL
- UPPERCASE for SQL keywords
- Lowercase for table/column names
- Proper indentation
- Comments for complex queries

## Contributing

1. **Fork** the repository
2. **Create** a feature branch
3. **Make** changes with clear commits
4. **Test** thoroughly
5. **Submit** pull request with description

## Version Control Best Practices

```bash
# Create feature branch
git checkout -b feature/my-feature

# Make commits
git add .
git commit -m "Add: Description of change"

# Types: Add, Fix, Update, Remove, Refactor
```

## Resources

- **Electron Docs**: https://www.electronjs.org/docs
- **yt-dlp**: https://github.com/yt-dlp/yt-dlp
- **MusicBrainz API**: https://musicbrainz.org/doc/MusicBrainz_API
- **Cover Art Archive**: https://coverartarchive.org/
- **MySQL Docs**: https://dev.mysql.com/doc/

## Support & Questions

For questions or issues during development:
1. Check this guide first
2. Review API_DOCUMENTATION.md
3. Check existing code for examples
4. Test in isolation to identify issues

---

Happy coding! 🚀
