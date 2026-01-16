const { app, BrowserWindow, ipcMain, nativeTheme, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const initSqlJs = require('sql.js');
const fs = require('fs');

let mainWindow;
let miniPlayerWindow = null;
let pythonProcess;
let db;

// Download queue state
let isDownloading = false;
let currentDownloadId = null;
const downloadQueue = [];

// Database file path
function getDatabasePath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'ubwavex.db');
}

// Get theme-appropriate icon
function getAppIcon(theme) {
  // If theme is passed, use it; otherwise default to dark theme (white icon)
  const isDark = theme ? theme === 'dark' : true;
  const iconName = isDark ? 'iconWhite.png' : 'iconBlack.png';
  return path.join(__dirname, '../public', iconName);
}

// Update app icon based on theme
function updateAppIcon() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIcon(getAppIcon());
  }
}

// Create main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    backgroundColor: '#1a1a1a',
    icon: getAppIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    show: false
  });

  // Load UI immediately for fast startup
  mainWindow.loadFile(path.join(__dirname, '../ui/index.html'));

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    // Initialize heavy dependencies after UI is visible
    initializeBackend();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Listen for system theme changes
  nativeTheme.on('updated', () => {
    updateAppIcon();
  });
}

// Initialize database and Python core after UI loads
async function initializeBackend() {
  try {
    // Connect to database
    await connectDatabase();

    // Start Python core
    startPythonCore();

    // Initialize download queue and resume any pending downloads
    await initializeDownloadQueue();

    // Notify renderer that backend is ready
    mainWindow.webContents.send('backend-ready');
  } catch (error) {
    console.error('Backend initialization failed:', error);
    mainWindow.webContents.send('backend-error', error.message);
  }
}

// Connect to SQLite database
async function connectDatabase() {
  try {
    const dbPath = getDatabasePath();
    const dbExists = fs.existsSync(dbPath);

    // Initialize SQL.js
    const SQL = await initSqlJs();

    // Load or create database
    if (dbExists) {
      const buffer = fs.readFileSync(dbPath);
      db = new SQL.Database(buffer);

      // Run migrations for existing database
      try {
        // Check if artist_name column exists
        const result = db.exec("PRAGMA table_info(tracks)");
        const hasArtistName = result.length > 0 && result[0].values.some(col => col[1] === 'artist_name');

        if (!hasArtistName) {
          console.log('Adding artist_name column to tracks table...');
          db.run("ALTER TABLE tracks ADD COLUMN artist_name TEXT");
          saveDatabase();
          console.log('Migration completed');
        }
      } catch (migrationError) {
        console.warn('Migration warning:', migrationError);
      }
    } else {
      db = new SQL.Database();
      console.log('Initializing new database...');
      const schemaPath = app.isPackaged
        ? path.join(process.resourcesPath, 'database', 'schema.sql')
        : path.join(__dirname, '../../database/schema.sql');

      const schema = fs.readFileSync(schemaPath, 'utf8');
      db.exec(schema);

      // Save database
      saveDatabase();
      console.log('Database schema initialized');
    }

    console.log('Database connected successfully at:', dbPath);
  } catch (error) {
    console.error('Database connection failed:', error);
    throw error;
  }
}

// Save database to disk
function saveDatabase() {
  try {
    const dbPath = getDatabasePath();
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (error) {
    console.error('Database save failed:', error);
  }
}

// Reload database from disk (to see changes made by Python)
async function reloadDatabase() {
  try {
    const dbPath = getDatabasePath();
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    db.close();
    db = new SQL.Database(buffer);
    console.log('Database reloaded from disk');
  } catch (error) {
    console.error('Database reload failed:', error);
  }
}

// Start Python core executable
function startPythonCore() {
  let pythonCmd, pythonArgs;

  if (app.isPackaged) {
    // Production: use bundled executable
    pythonCmd = path.join(process.resourcesPath, 'python', 'music_core.exe');
    pythonArgs = [];
  } else {
    // Development: use Python script
    pythonCmd = 'python';
    pythonArgs = [path.join(__dirname, '../python/music_core.py')];
  }

  pythonProcess = spawn(pythonCmd, pythonArgs, {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  pythonProcess.stdout.on('data', (data) => {
    handlePythonResponse(data);
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`Python Error: ${data}`);
  });

  pythonProcess.on('close', (code) => {
    console.log(`Python process exited with code ${code}`);
  });

  console.log('Python core started successfully');

  // Send directory settings to Python after startup
  setTimeout(() => {
    const settings = loadSettings();
    if (pythonProcess && pythonProcess.stdin && !pythonProcess.stdin.destroyed) {
      const updateDirsCommand = {
        command: 'update_directories',
        download_directory: settings.downloadDirectory,
        database_directory: settings.databaseDirectory
      };
      pythonProcess.stdin.write(JSON.stringify(updateDirsCommand) + '\n');
    }
  }, 1000);
}

// Handle responses from Python core
const pendingRequests = new Map();
let requestIdCounter = 0;

function handlePythonResponse(data) {
  try {
    const responses = data.toString().split('\n').filter(line => line.trim());

    responses.forEach(responseStr => {
      const response = JSON.parse(responseStr);

      if (response.request_id && pendingRequests.has(response.request_id)) {
        const { resolve, reject } = pendingRequests.get(response.request_id);

        if (response.status === 'success') {
          resolve(response.data);
        } else {
          reject(new Error(response.error || 'Unknown error'));
        }

        pendingRequests.delete(response.request_id);
      }
    });
  } catch (error) {
    console.error('Error parsing Python response:', error);
  }
}

// Send request to Python core
function sendPythonRequest(action, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++requestIdCounter;

    const request = {
      request_id: requestId,
      action: action,
      params: params
    };

    pendingRequests.set(requestId, { resolve, reject });

    pythonProcess.stdin.write(JSON.stringify(request) + '\n');

    // Timeout after 60 seconds
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }
    }, 60000);
  });
}

// IPC Handlers for renderer process

// Search for music
ipcMain.handle('search-music', async (event, params) => {
  try {
    // Handle both old string format and new object format
    const query = typeof params === 'string' ? params : params.query;
    const limit = typeof params === 'object' ? params.limit : 20;

    const results = await sendPythonRequest('search', { query, limit });
    return { success: true, data: results };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Enrich tracks with liked/downloaded status from database
ipcMain.handle('enrich-tracks', async (event, tracks) => {
  try {
    const enrichedTracks = tracks.map(track => {
      const enriched = { ...track };

      // Check if track exists in database and get its ID
      const trackResult = db.exec(`SELECT id FROM tracks WHERE youtube_id = ?`, [track.youtube_id]);

      if (trackResult.length > 0 && trackResult[0].values.length > 0) {
        const trackId = trackResult[0].values[0][0];
        enriched.id = trackId;

        // Check if liked
        const likedResult = db.exec(`SELECT id FROM liked_songs WHERE track_id = ?`, [trackId]);
        enriched.liked = likedResult.length > 0 && likedResult[0].values.length > 0;

        // Check if downloaded
        const downloadResult = db.exec(`SELECT file_path FROM downloads WHERE track_id = ?`, [trackId]);
        enriched.downloaded = downloadResult.length > 0 && downloadResult[0].values.length > 0;
        if (enriched.downloaded) {
          enriched.file_path = downloadResult[0].values[0][0];
        }
      } else {
        enriched.liked = false;
        enriched.downloaded = false;
      }

      return enriched;
    });

    return { success: true, data: enrichedTracks };
  } catch (error) {
    console.error('Failed to enrich tracks:', error);
    return { success: false, error: error.message };
  }
});

// Get stream URL for playback
ipcMain.handle('get-stream-url', async (event, params) => {
  try {
    const videoId = typeof params === 'string' ? params : params.videoId;
    const quality = typeof params === 'object' ? params.quality : 'high';
    const streamData = await sendPythonRequest('get_stream_url', {
      video_id: videoId,
      quality: quality
    });
    return { success: true, data: streamData };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Download track
ipcMain.handle('download-track', async (event, trackData) => {
  try {
    // Add to queue instead of downloading immediately
    await addToDownloadQueue(trackData);

    // Start processing queue if not already downloading
    if (!isDownloading) {
      processDownloadQueue();
    }

    return { success: true, message: 'Added to download queue' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Download Queue Management Functions

async function initializeDownloadQueue() {
  try {
    console.log('Initializing download queue...');

    // Create download_queue table if it doesn't exist
    db.run(`
      CREATE TABLE IF NOT EXISTS download_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        youtube_id TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT,
        duration INTEGER,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'downloading', 'completed', 'failed')),
        error_message TEXT,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME,
        completed_at DATETIME,
        retry_count INTEGER DEFAULT 0
      )
    `);
    saveDatabase();

    // Reset any 'downloading' status to 'pending' (in case app crashed)
    db.run("UPDATE download_queue SET status = 'pending', started_at = NULL WHERE status = 'downloading'");
    saveDatabase();

    // Remove completed downloads from queue
    db.run("DELETE FROM download_queue WHERE status = 'completed'");
    saveDatabase();

    // Remove invalid video IDs from queue (channel IDs, playlist IDs, etc.)
    // Valid YouTube video IDs are 11 characters and don't start with UC, UU, or PL
    const invalidIdsResult = db.exec(
      "SELECT id, youtube_id, title FROM download_queue WHERE status IN ('pending', 'failed')"
    );

    if (invalidIdsResult.length > 0 && invalidIdsResult[0].values.length > 0) {
      invalidIdsResult[0].values.forEach(row => {
        const id = row[0];
        const youtubeId = row[1];
        const title = row[2];

        if (!youtubeId ||
          youtubeId.length !== 11 ||
          youtubeId.startsWith('UC') ||
          youtubeId.startsWith('UU') ||
          youtubeId.startsWith('PL')) {
          console.log(`Removing invalid download from queue: ${title} (${youtubeId})`);
          db.run('DELETE FROM download_queue WHERE id = ?', [id]);
        }
      });
      saveDatabase();
    }

    // Load pending downloads into memory
    const result = db.exec("SELECT * FROM download_queue WHERE status = 'pending' OR status = 'failed' ORDER BY added_at ASC");

    if (result.length > 0) {
      downloadQueue.length = 0; // Clear array
      result[0].values.forEach(row => {
        const queueItem = {};
        result[0].columns.forEach((col, i) => queueItem[col] = row[i]);
        downloadQueue.push(queueItem);
      });

      console.log(`Loaded ${downloadQueue.length} pending downloads from queue`);

      // Auto-resume downloads
      if (downloadQueue.length > 0) {
        console.log('Resuming download queue...');
        processDownloadQueue();
      }
    }
  } catch (error) {
    console.error('Failed to initialize download queue:', error);
  }
}

async function addToDownloadQueue(trackData) {
  try {
    // Check if already in queue or downloaded
    const existsInQueue = db.exec(`
      SELECT id FROM download_queue 
      WHERE youtube_id = '${trackData.video_id}' 
      AND status IN ('pending', 'downloading')
    `);

    if (existsInQueue.length > 0 && existsInQueue[0].values.length > 0) {
      console.log('Track already in download queue:', trackData.title);
      return;
    }

    // Check if already downloaded
    const trackExists = db.exec(`
      SELECT t.id FROM tracks t
      INNER JOIN downloads d ON t.id = d.track_id
      WHERE t.youtube_id = '${trackData.video_id}'
    `);

    if (trackExists.length > 0 && trackExists[0].values.length > 0) {
      console.log('Track already downloaded:', trackData.title);
      return;
    }

    // Add to database queue
    db.run(`
      INSERT INTO download_queue (youtube_id, title, artist, duration, status)
      VALUES (?, ?, ?, ?, 'pending')
    `, [trackData.video_id, trackData.title, trackData.artist || 'Unknown', trackData.duration || 0]);
    saveDatabase();

    // Get the inserted ID
    const idResult = db.exec('SELECT last_insert_rowid() as id');
    const queueId = idResult[0].values[0][0];

    // Add to memory queue
    const queueItem = {
      id: queueId,
      youtube_id: trackData.video_id,
      title: trackData.title,
      artist: trackData.artist || 'Unknown',
      duration: trackData.duration || 0,
      status: 'pending',
      retry_count: 0
    };

    downloadQueue.push(queueItem);

    console.log(`Added to download queue: ${trackData.title} (Queue size: ${downloadQueue.length})`);

    // Notify renderer
    if (mainWindow) {
      mainWindow.webContents.send('download-queue-updated', {
        queueSize: downloadQueue.length,
        item: queueItem
      });
    }
  } catch (error) {
    console.error('Failed to add to download queue:', error);
    throw error;
  }
}

async function processDownloadQueue() {
  if (isDownloading || downloadQueue.length === 0) {
    return;
  }

  isDownloading = true;

  while (downloadQueue.length > 0) {
    const queueItem = downloadQueue[0];
    currentDownloadId = queueItem.id;

    // Validate video ID before attempting download
    const youtubeId = queueItem.youtube_id;
    if (!youtubeId ||
      youtubeId.length !== 11 ||
      youtubeId.startsWith('UC') ||
      youtubeId.startsWith('UU') ||
      youtubeId.startsWith('PL')) {
      console.log(`Skipping invalid video ID: ${queueItem.title} (${youtubeId})`);

      // Mark as failed and remove from queue
      db.run(
        'UPDATE download_queue SET status = \'failed\', error_message = ? WHERE id = ?',
        ['Invalid video ID (not a downloadable video)', queueItem.id]
      );
      saveDatabase();
      downloadQueue.shift();

      // Notify renderer
      if (mainWindow) {
        mainWindow.webContents.send('download-failed', {
          queueItem,
          error: 'Invalid video ID (not a downloadable video)',
          remaining: downloadQueue.length,
          willRetry: false
        });
      }

      continue;
    }

    try {
      console.log(`Processing download: ${queueItem.title} (${downloadQueue.length} remaining)`);

      // Update status to downloading
      db.run(`
        UPDATE download_queue 
        SET status = 'downloading', started_at = CURRENT_TIMESTAMP 
        WHERE id = ${queueItem.id}
      `);
      saveDatabase();

      // Notify renderer
      if (mainWindow) {
        mainWindow.webContents.send('download-started', {
          queueItem,
          remaining: downloadQueue.length
        });
      }

      // Perform the actual download
      const result = await sendPythonRequest('download_track', {
        video_id: queueItem.youtube_id,
        title: queueItem.title,
        artist: queueItem.artist,
        duration: queueItem.duration
      });

      // Reload database from disk to see Python's changes
      await reloadDatabase();

      // Mark as completed
      db.run(`
        UPDATE download_queue 
        SET status = 'completed', completed_at = CURRENT_TIMESTAMP 
        WHERE id = ${queueItem.id}
      `);
      saveDatabase();

      // Remove from queue
      downloadQueue.shift();

      console.log(`Download completed: ${queueItem.title}`);

      // Notify renderer
      if (mainWindow) {
        mainWindow.webContents.send('download-completed', {
          queueItem,
          remaining: downloadQueue.length,
          result
        });
      }

      // Small delay between downloads
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.error(`Download failed: ${queueItem.title}`, error);

      // Increment retry count
      const retryCount = (queueItem.retry_count || 0) + 1;

      if (retryCount < 3) {
        // Retry up to 3 times
        db.run(`
          UPDATE download_queue 
          SET status = 'pending', retry_count = ${retryCount}, error_message = ? 
          WHERE id = ${queueItem.id}
        `, [error.message]);
        saveDatabase();

        // Move to end of queue for retry
        queueItem.retry_count = retryCount;
        downloadQueue.push(downloadQueue.shift());

        console.log(`Retrying download later (attempt ${retryCount}/3): ${queueItem.title}`);
      } else {
        // Mark as failed after 3 retries
        db.run(`
          UPDATE download_queue 
          SET status = 'failed', error_message = ? 
          WHERE id = ${queueItem.id}
        `, [error.message]);
        saveDatabase();

        // Remove from queue
        downloadQueue.shift();

        console.log(`Download permanently failed: ${queueItem.title}`);
      }

      // Notify renderer
      if (mainWindow) {
        mainWindow.webContents.send('download-failed', {
          queueItem,
          error: error.message,
          remaining: downloadQueue.length,
          willRetry: retryCount < 3
        });
      }
    }
  }

  isDownloading = false;
  currentDownloadId = null;

  console.log('Download queue completed');

  // Notify renderer
  if (mainWindow) {
    mainWindow.webContents.send('download-queue-completed');
  }
}

// Get download queue status
ipcMain.handle('get-download-queue', async () => {
  try {
    return {
      success: true,
      data: {
        queue: downloadQueue,
        isDownloading,
        currentDownloadId
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Clear completed/failed downloads from queue
ipcMain.handle('clear-download-queue', async () => {
  try {
    db.run("DELETE FROM download_queue WHERE status IN ('completed', 'failed')");
    saveDatabase();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Delete download
ipcMain.handle('delete-download', async (event, youtubeId) => {
  try {
    // Get track and download info
    const trackResult = db.exec(`
      SELECT t.id, d.file_path 
      FROM tracks t 
      INNER JOIN downloads d ON t.id = d.track_id 
      WHERE t.youtube_id = ?
    `, [youtubeId]);

    if (trackResult.length === 0 || trackResult[0].values.length === 0) {
      return { success: false, error: 'Download not found' };
    }

    const trackId = trackResult[0].values[0][0];
    const filePath = trackResult[0].values[0][1];

    // Notify renderer to check if this track is currently playing
    const isPlaying = await new Promise((resolve) => {
      mainWindow.webContents.send('check-if-playing', youtubeId);

      // Wait for response with timeout
      const timeout = setTimeout(() => resolve(false), 1000);

      ipcMain.once('check-if-playing-response', (e, playing) => {
        clearTimeout(timeout);
        resolve(playing);
      });
    });

    // If track is playing, notify renderer to stop it
    if (isPlaying) {
      mainWindow.webContents.send('stop-track-for-deletion', youtubeId);
      // Wait much longer for Windows to release the file handle
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Delete file from filesystem with retry logic
    if (filePath && fs.existsSync(filePath)) {
      let deleteSuccess = false;
      let lastError = null;
      
      // Try up to 5 times with longer delays for Windows file handles
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          fs.unlinkSync(filePath);
          console.log(`Deleted file: ${filePath}`);
          deleteSuccess = true;
          break;
        } catch (fileError) {
          lastError = fileError;
          console.warn(`Delete attempt ${attempt + 1}/5 failed: ${filePath}`, fileError.message);

          if (fileError.code === 'EBUSY' || fileError.code === 'EPERM') {
            // Wait progressively longer before retrying (1s, 2s, 3s, 4s)
            if (attempt < 4) {
              const delay = 1000 * (attempt + 1);
              console.log(`Waiting ${delay}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          } else {
            // For non-busy errors, don't retry
            break;
          }
        }
      }
      
      // If still failed after retries, return error
      if (!deleteSuccess && lastError && (lastError.code === 'EBUSY' || lastError.code === 'EPERM')) {
        console.error(`Failed to delete file after 5 attempts: ${filePath}`, lastError);
        return {
          success: false,
          error: 'File is still locked after multiple attempts. The audio file may be held by Windows. Try again in a moment.'
        };
      }
    }

    // Remove from downloads table
    db.run('DELETE FROM downloads WHERE track_id = ?', [trackId]);
    saveDatabase();

    console.log(`Deleted download for youtube_id: ${youtubeId}`);

    return { success: true };
  } catch (error) {
    console.error('Failed to delete download:', error);
    return { success: false, error: error.message };
  }
});

// Download playlist
ipcMain.handle('download-playlist', async (event, playlistId) => {
  try {
    const result = await sendPythonRequest('download_playlist', { playlist_id: playlistId });
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Resolve metadata
ipcMain.handle('resolve-metadata', async (event, trackInfo) => {
  try {
    const metadata = await sendPythonRequest('resolve_metadata', trackInfo);
    return { success: true, data: metadata };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Database queries

// Get all tracks
ipcMain.handle('db-get-tracks', async () => {
  try {
    const result = db.exec('SELECT * FROM tracks ORDER BY created_at DESC');
    const rows = result.length > 0 ? result[0].values.map(row => {
      const obj = {};
      result[0].columns.forEach((col, i) => obj[col] = row[i]);
      return obj;
    }) : [];
    return { success: true, data: rows };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get track by YouTube ID
ipcMain.handle('db-get-track-by-youtube-id', async (event, youtubeId) => {
  try {
    const result = db.exec('SELECT * FROM tracks WHERE youtube_id = ?', [youtubeId]);
    if (result.length > 0 && result[0].values.length > 0) {
      const obj = {};
      result[0].columns.forEach((col, i) => obj[col] = result[0].values[0][i]);
      return { success: true, data: obj };
    }
    return { success: true, data: null };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Create track
ipcMain.handle('db-create-track', async (event, trackData) => {
  try {
    db.run(
      'INSERT INTO tracks (youtube_id, title, artist_name, duration) VALUES (?, ?, ?, ?)',
      [trackData.youtube_id, trackData.title, trackData.artist || 'Unknown', trackData.duration || 0]
    );
    const result = db.exec('SELECT last_insert_rowid() as id');
    const trackId = result[0].values[0][0];
    saveDatabase();
    return { success: true, data: { id: trackId } };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get downloaded tracks
ipcMain.handle('db-get-downloads', async () => {
  try {
    const result = db.exec(`
      SELECT t.*, d.file_path, d.downloaded_at 
      FROM tracks t 
      INNER JOIN downloads d ON t.id = d.track_id 
      ORDER BY d.downloaded_at DESC
    `);
    const rows = result.length > 0 ? result[0].values.map(row => {
      const obj = {};
      result[0].columns.forEach((col, i) => obj[col] = row[i]);
      return obj;
    }) : [];
    return { success: true, data: rows };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get liked songs
ipcMain.handle('db-get-liked', async () => {
  try {
    const result = db.exec(`
      SELECT t.*, l.liked_at 
      FROM tracks t 
      INNER JOIN liked_songs l ON t.id = l.track_id 
      ORDER BY l.liked_at DESC
    `);
    const rows = result.length > 0 ? result[0].values.map(row => {
      const obj = {};
      result[0].columns.forEach((col, i) => obj[col] = row[i]);
      return obj;
    }) : [];
    return { success: true, data: rows };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get recent plays
ipcMain.handle('db-get-recent-plays', async () => {
  try {
    const result = db.exec(`
      SELECT t.*, MAX(ph.played_at) as last_played
      FROM tracks t 
      INNER JOIN playback_history ph ON t.id = ph.track_id 
      GROUP BY t.id
      ORDER BY last_played DESC
      LIMIT 20
    `);
    const rows = result.length > 0 ? result[0].values.map(row => {
      const obj = {};
      result[0].columns.forEach((col, i) => obj[col] = row[i]);
      return obj;
    }) : [];
    return { success: true, data: rows };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Record playback history
ipcMain.handle('db-record-playback', async (event, { trackId, playDuration, completed }) => {
  try {
    db.run(
      'INSERT INTO playback_history (track_id, play_duration, completed) VALUES (?, ?, ?)',
      [trackId, playDuration || 0, completed ? 1 : 0]
    );
    return { success: true };
  } catch (error) {
    console.error('Failed to record playback:', error);
    return { success: false, error: error.message };
  }
});

// Clear playback history
ipcMain.handle('db-clear-playback-history', async () => {
  try {
    db.run('DELETE FROM playback_history');
    saveDatabase();
    return { success: true };
  } catch (error) {
    console.error('Failed to clear playback history:', error);
    return { success: false, error: error.message };
  }
});

// Clear old playback history
ipcMain.handle('db-clear-old-playback-history', async (event, days) => {
  try {
    const cutoffDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();
    db.run('DELETE FROM playback_history WHERE played_at < ?', [cutoffDate]);
    saveDatabase();
    return { success: true };
  } catch (error) {
    console.error('Failed to clear old playback history:', error);
    return { success: false, error: error.message };
  }
});

// Clear cache
ipcMain.handle('clear-cache', async () => {
  try {
    // Send clear cache command to Python
    if (pythonProcess && !pythonProcess.killed) {
      const command = {
        command: 'clear_cache'
      };
      pythonProcess.stdin.write(JSON.stringify(command) + '\n');
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to clear cache:', error);
    return { success: false, error: error.message };
  }
});

// Toggle like status
ipcMain.handle('db-toggle-like', async (event, trackId) => {
  try {
    // Check if already liked
    const result = db.exec('SELECT id FROM liked_songs WHERE track_id = ?', [trackId]);
    const existing = result.length > 0 && result[0].values.length > 0;

    if (existing) {
      // Unlike
      db.run('DELETE FROM liked_songs WHERE track_id = ?', [trackId]);
      saveDatabase();
      return { success: true, liked: false };
    } else {
      // Like
      db.run('INSERT INTO liked_songs (track_id) VALUES (?)', [trackId]);
      saveDatabase();
      return { success: true, liked: true };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get all playlists
ipcMain.handle('db-get-playlists', async () => {
  try {
    const result = db.exec('SELECT * FROM playlists ORDER BY created_at DESC');
    const rows = result.length > 0 ? result[0].values.map(row => {
      const obj = {};
      result[0].columns.forEach((col, i) => obj[col] = row[i]);
      return obj;
    }) : [];
    return { success: true, data: rows };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Create playlist
ipcMain.handle('db-create-playlist', async (event, name) => {
  try {
    db.run('INSERT INTO playlists (name) VALUES (?)', [name]);
    const result = db.exec('SELECT last_insert_rowid()');
    const playlistId = result[0].values[0][0];
    saveDatabase();
    return { success: true, playlistId };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get playlist tracks
ipcMain.handle('db-get-playlist-tracks', async (event, playlistId) => {
  try {
    const result = db.exec(`
      SELECT t.*, pt.position 
      FROM tracks t 
      INNER JOIN playlist_tracks pt ON t.id = pt.track_id 
      WHERE pt.playlist_id = ? 
      ORDER BY pt.position
    `, [playlistId]);
    const rows = result.length > 0 ? result[0].values.map(row => {
      const obj = {};
      result[0].columns.forEach((col, i) => obj[col] = row[i]);
      return obj;
    }) : [];
    return { success: true, data: rows };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Add track to playlist
ipcMain.handle('db-add-to-playlist', async (event, { playlistId, trackId }) => {
  try {
    // Get max position
    const result = db.exec(
      'SELECT MAX(position) as max_pos FROM playlist_tracks WHERE playlist_id = ?',
      [playlistId]
    );
    const maxPos = (result.length > 0 && result[0].values[0][0]) || 0;
    const position = maxPos + 1;

    db.run(
      'INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)',
      [playlistId, trackId, position]
    );
    saveDatabase();

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Remove track from playlist
ipcMain.handle('db-remove-from-playlist', async (event, { playlistId, trackId }) => {
  try {
    db.run(
      'DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?',
      [playlistId, trackId]
    );
    saveDatabase();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Rename playlist
ipcMain.handle('db-rename-playlist', async (event, { playlistId, name }) => {
  try {
    db.run('UPDATE playlists SET name = ? WHERE id = ?', [name, playlistId]);
    saveDatabase();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Delete playlist
ipcMain.handle('db-delete-playlist', async (event, playlistId) => {
  try {
    db.run('DELETE FROM playlists WHERE id = ?', [playlistId]);
    saveDatabase();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Update app icon when theme changes
ipcMain.handle('update-app-icon', async (event, theme) => {
  try {
    const iconName = theme === 'dark' ? 'iconWhite.png' : 'iconBlack.png';
    const iconPath = path.join(__dirname, '../public', iconName);
    console.log('Updating app icon to:', iconPath);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIcon(iconPath);
    }
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
      miniPlayerWindow.setIcon(iconPath);
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to update app icon:', error);
    return { success: false, error: error.message };
  }
});

// Settings: Directory Selection and Management

// Get default directories
function getDefaultDownloadDirectory() {
  return path.join(app.getPath('music'), 'UB-WaveX');
}

function getDefaultDatabaseDirectory() {
  return app.getPath('userData');
}

// Get settings file path
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

// Load settings from file
function loadSettings() {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
  return {
    downloadDirectory: getDefaultDownloadDirectory(),
    databaseDirectory: getDefaultDatabaseDirectory()
  };
}

// Save settings to file
function saveSettings(settings) {
  try {
    const settingsPath = getSettingsPath();
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Failed to save settings:', error);
    return false;
  }
}

// Get current settings
ipcMain.handle('get-settings', async () => {
  try {
    return {
      success: true,
      settings: loadSettings(),
      defaults: {
        downloadDirectory: getDefaultDownloadDirectory(),
        databaseDirectory: getDefaultDatabaseDirectory()
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Browse for directory
ipcMain.handle('browse-directory', async (event, options) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: options.title || 'Select Directory',
      defaultPath: options.defaultPath || app.getPath('home')
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, path: result.filePaths[0] };
    }
    return { success: false, canceled: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Update settings
ipcMain.handle('update-settings', async (event, settings) => {
  try {
    // Validate directories exist or create them
    if (settings.downloadDirectory) {
      if (!fs.existsSync(settings.downloadDirectory)) {
        fs.mkdirSync(settings.downloadDirectory, { recursive: true });
      }
    }

    if (settings.databaseDirectory) {
      if (!fs.existsSync(settings.databaseDirectory)) {
        fs.mkdirSync(settings.databaseDirectory, { recursive: true });
      }
    }

    const success = saveSettings(settings);
    if (success) {
      // Send settings to Python process if directory changed
      if (pythonProcess && pythonProcess.stdin && !pythonProcess.stdin.destroyed) {
        const updateDirsCommand = {
          command: 'update_directories',
          download_directory: settings.downloadDirectory,
          database_directory: settings.databaseDirectory
        };
        pythonProcess.stdin.write(JSON.stringify(updateDirsCommand) + '\n');
      }

      return { success: true };
    }
    return { success: false, error: 'Failed to save settings' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Validate if directory exists
ipcMain.handle('validate-directory', async (event, { path: dirPath }) => {
  try {
    if (!dirPath) {
      return { success: false, error: 'No path provided' };
    }

    const exists = fs.existsSync(dirPath);
    return { success: exists, exists };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Create directory
ipcMain.handle('create-directory', async (event, { path: dirPath }) => {
  try {
    if (!dirPath) {
      return { success: false, error: 'No path provided' };
    }

    // Create directory recursively
    fs.mkdirSync(dirPath, { recursive: true });

    // Verify it was created
    if (fs.existsSync(dirPath)) {
      return { success: true };
    } else {
      return { success: false, error: 'Directory creation failed' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Update download settings
ipcMain.handle('update-download-settings', async (event, settings) => {
  try {
    // Send settings to Python process
    if (pythonProcess && !pythonProcess.killed) {
      const command = {
        command: 'update_download_settings',
        settings: settings
      };
      pythonProcess.stdin.write(JSON.stringify(command) + '\n');
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to update download settings:', error);
    return { success: false, error: error.message };
  }
});

// ================================
// Mini Player Window Management
// ================================

// Get mini player position coordinates based on setting
function getMiniPlayerPosition(position, width, height) {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { workArea } = primaryDisplay;
  const margin = 20;

  switch (position) {
    case 'top-left':
      return { x: workArea.x + margin, y: workArea.y + margin };
    case 'top-right':
      return { x: workArea.x + workArea.width - width - margin, y: workArea.y + margin };
    case 'middle':
      return {
        x: workArea.x + Math.round((workArea.width - width) / 2),
        y: workArea.y + Math.round((workArea.height - height) / 2)
      };
    case 'bottom-left':
      return { x: workArea.x + margin, y: workArea.y + workArea.height - height - margin };
    case 'bottom-right':
      return { x: workArea.x + workArea.width - width - margin, y: workArea.y + workArea.height - height - margin };
    default:
      return { x: workArea.x + workArea.width - width - margin, y: workArea.y + margin };
  }
}

function createMiniPlayer(settings = {}) {
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow.focus();
    return;
  }

  const width = 320;
  const height = 160;
  const position = settings.miniPlayerPosition || 'top-right';
  const alwaysOnTop = settings.miniPlayerAlwaysOnTop !== false;
  const opacity = (settings.miniPlayerOpacity || 100) / 100;
  const { x, y } = getMiniPlayerPosition(position, width, height);

  miniPlayerWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: false,
    resizable: false,
    alwaysOnTop,
    skipTaskbar: true,
    backgroundColor: '#0d0d0d',
    opacity,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  miniPlayerWindow.loadFile(path.join(__dirname, '../ui/miniplayer.html'));

  miniPlayerWindow.on('closed', () => {
    miniPlayerWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mini-player-closed');
    }
  });
}

function closeMiniPlayer() {
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow.close();
    miniPlayerWindow = null;
  }
}

function updateMiniPlayer(data) {
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow.webContents.send('mini-player-update', data);
  }
}

// IPC handlers for mini player
ipcMain.on('open-mini-player', (event, settings) => {
  createMiniPlayer(settings || {});
  // Hide main window when mini player opens
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
});

ipcMain.on('close-mini-player', () => {
  closeMiniPlayer();
  // Show main window when mini player closes
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.on('update-mini-player', (event, data) => {
  updateMiniPlayer(data);
});

// Handle mini player settings update
ipcMain.on('update-mini-player-settings', (event, settings) => {
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    // Update always on top
    if (settings.miniPlayerAlwaysOnTop !== undefined) {
      miniPlayerWindow.setAlwaysOnTop(settings.miniPlayerAlwaysOnTop);
    }
    // Update opacity
    if (settings.miniPlayerOpacity !== undefined) {
      miniPlayerWindow.setOpacity(settings.miniPlayerOpacity / 100);
    }
    // Update position
    if (settings.miniPlayerPosition) {
      const { x, y } = getMiniPlayerPosition(settings.miniPlayerPosition, 320, 160);
      miniPlayerWindow.setPosition(x, y);
    }
  }
});

ipcMain.on('mini-player-action', (event, action, ...args) => {
  if (action === 'expand') {
    // If main window doesn't exist or is destroyed, recreate it
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
    // Close mini player
    closeMiniPlayer();
    return;
  }

  // For other actions, send to main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mini-player-action', action, ...args);
  }
});

ipcMain.on('mini-player-ready', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mini-player-request-state');
  }
});

ipcMain.on('focus-main-window', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.on('theme-changed', (event, theme) => {
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow.webContents.send('theme-changed', theme);
  }
});

// App lifecycle
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('quit', () => {
  // Cleanup
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow.close();
  }
  if (pythonProcess) {
    pythonProcess.kill();
  }
  if (db) {
    saveDatabase();
    db.close();
  }
});
