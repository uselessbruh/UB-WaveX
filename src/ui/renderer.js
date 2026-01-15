// UB-WaveX Renderer Process
const { ipcRenderer } = require('electron');

// State
let currentView = 'search';
let currentPlaylistId = null;
let currentPlaylistName = null;
let backendReady = false;

// Get current theme
function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
}

// DOM Elements
const searchInput = document.getElementById('search-input');
const btnSearch = document.getElementById('btn-search');
const btnClearSearch = document.getElementById('btn-clear-search');
const searchResults = document.getElementById('search-results');
const downloadsList = document.getElementById('downloads-list');
const likedList = document.getElementById('liked-list');
const playlistList = document.getElementById('playlist-list');
const btnNewPlaylist = document.getElementById('btn-new-playlist');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingMessage = document.getElementById('loading-message');
const contextMenu = document.getElementById('context-menu');
const searchHistory = document.getElementById('search-history');
const searchHistoryList = document.getElementById('search-history-list');
const recentPlays = document.getElementById('recent-plays');
const recentPlaysList = document.getElementById('recent-plays-list');

// Individual search inputs for each view
let downloadsSearchInput;
let likedSearchInput;
let settingsSearchInput;
let playlistSearchInput;

// Debounce utility function
function debounce(func, delay = 300) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Initialize view-specific search inputs
    downloadsSearchInput = document.getElementById('downloads-search-input');
    likedSearchInput = document.getElementById('liked-search-input');
    settingsSearchInput = document.getElementById('settings-search-input');
    playlistSearchInput = document.getElementById('playlist-search-input');

    setupEventListeners();
    setupNavigation();
    loadSearchHistory();
    loadRecentPlays();

    // Set correct icon for initially active tab based on theme
    const activeNavItem = document.querySelector('.nav-item.active');
    if (activeNavItem) {
        const activeIcon = activeNavItem.querySelector('.icon.theme-icon');
        if (activeIcon) {
            const theme = getCurrentTheme();
            const iconType = activeIcon.dataset.icon;
            // Dark theme: white bg, use black icon
            // Light theme: black bg, use white icon
            const activeIconSuffix = theme === 'light' ? 'White' : 'Black';
            activeIcon.src = `../public/${iconType}${activeIconSuffix}.png`;
        }
    }
});

// Save playback state before window closes
window.addEventListener('beforeunload', () => {
    if (window.player && typeof window.player.savePlaybackState === 'function') {
        window.player.savePlaybackState();
    }
});

// Backend Ready Handler
ipcRenderer.on('backend-ready', () => {
    backendReady = true;
    hideLoading();
    loadPlaylists();
    loadDownloads();
    loadLikedSongs();
    checkDownloadQueue();
});

ipcRenderer.on('backend-error', (event, error) => {
    showError(`Backend initialization failed: ${error}`);
});

// Download Queue Event Handlers
ipcRenderer.on('download-queue-updated', (event, data) => {
    console.log(`Download queue updated: ${data.queueSize} items`);
    showInfo(`Added to download queue: ${data.item.title}`);
});

ipcRenderer.on('download-started', (event, data) => {
    console.log(`Download started: ${data.queueItem.title}`);
    showInfo(`Downloading: ${data.queueItem.title} (${data.remaining} remaining)`);
});

ipcRenderer.on('download-completed', (event, data) => {
    console.log(`Download completed: ${data.queueItem.title}`);
    showSuccess(`Downloaded: ${data.queueItem.title}`);

    // Update the track UI
    const track = {
        youtube_id: data.queueItem.youtube_id,
        downloaded: true
    };
    updateTrackDownloadStatus(track, true);

    // Refresh downloads list
    loadDownloads();
});

ipcRenderer.on('download-failed', (event, data) => {
    console.log(`Download failed: ${data.queueItem.title}`);

    if (data.willRetry) {
        showWarning(`Download failed, will retry: ${data.queueItem.title}`);
    } else {
        showError(`Download permanently failed: ${data.queueItem.title}`);
    }
});

ipcRenderer.on('download-queue-completed', () => {
    console.log('All downloads completed');
    showSuccess('All downloads completed!');
});

// Setup Event Listeners
function setupEventListeners() {
    // Search View - Online Search
    searchInput.addEventListener('input', debounce(() => {
        const query = searchInput.value.trim();
        if (query) {
            performSearch();
            btnClearSearch.style.display = 'block';
        } else {
            btnClearSearch.style.display = 'none';
        }
    }, 500)); // 500ms debounce for online search

    btnSearch.addEventListener('click', handleSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });

    // Clear search button
    btnClearSearch.addEventListener('click', clearSearch);

    // Downloads View - Local Search
    downloadsSearchInput.addEventListener('input', debounce(() => {
        const query = downloadsSearchInput.value.trim();
        searchInDownloads(query);
    }, 300));

    // Liked Songs View - Local Search
    likedSearchInput.addEventListener('input', debounce(() => {
        const query = likedSearchInput.value.trim();
        searchInLikedSongs(query);
    }, 300));

    // Settings View - Filter Settings
    settingsSearchInput.addEventListener('input', debounce(() => {
        const query = settingsSearchInput.value.trim();
        filterSettings(query);
    }, 300));

    // Playlist View - Playlist Search
    playlistSearchInput.addEventListener('input', debounce(() => {
        const query = playlistSearchInput.value.trim();
        searchInPlaylist(query);
    }, 300));

    // New Playlist
    btnNewPlaylist.addEventListener('click', createNewPlaylist);

    // Shuffle buttons
    document.getElementById('btn-shuffle-downloads')?.addEventListener('click', () => {
        shufflePlay('downloads');
    });

    document.getElementById('btn-shuffle-liked')?.addEventListener('click', () => {
        shufflePlay('liked');
    });

    document.getElementById('btn-shuffle-playlist')?.addEventListener('click', () => {
        shufflePlay('playlist');
    });

    // Play All buttons
    document.getElementById('btn-play-all-downloads')?.addEventListener('click', () => {
        playAllDownloads();
    });

    document.getElementById('btn-play-all-liked')?.addEventListener('click', () => {
        playAllLiked();
    });

    document.getElementById('btn-play-all-playlist')?.addEventListener('click', () => {
        playAllPlaylist();
    });

    // Shuffle All buttons (alternative shuffle buttons in view headers)
    document.getElementById('btn-shuffle-all-downloads')?.addEventListener('click', () => {
        shufflePlay('downloads');
    });

    document.getElementById('btn-shuffle-all-liked')?.addEventListener('click', () => {
        shufflePlay('liked');
    });

    document.getElementById('btn-shuffle-all-playlist')?.addEventListener('click', () => {
        shufflePlay('playlist');
    });

    // Download All buttons
    document.getElementById('btn-download-all-liked')?.addEventListener('click', () => {
        downloadAllLiked();
    });

    document.getElementById('btn-download-all-playlist')?.addEventListener('click', () => {
        downloadAllPlaylist();
    });

    // Nav menu buttons (3-dot buttons)
    document.querySelectorAll('.nav-menu-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const view = btn.dataset.view;
            showViewContextMenu(e, view);
        });
    });

    // Right-click on Downloads and Liked nav items
    const downloadsNavItem = document.querySelector('.nav-item[data-view="downloads"]');
    const likedNavItem = document.querySelector('.nav-item[data-view="liked"]');

    downloadsNavItem?.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showViewContextMenu(e, 'downloads');
    });

    likedNavItem?.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showViewContextMenu(e, 'liked');
    });

    // Theme switcher
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.dataset.theme;
            switchTheme(theme);
        });
    });

    // Quality switcher
    document.querySelectorAll('.quality-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const quality = btn.dataset.quality;
            switchQuality(quality);
        });
    });

    // Stream quality switcher
    document.querySelectorAll('.stream-quality-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const quality = btn.dataset.streamQuality;
            switchStreamQuality(quality);
        });
    });

    // Directory settings
    document.getElementById('btn-browse-download-dir')?.addEventListener('click', async () => {
        await browseDownloadDirectory();
    });

    document.getElementById('btn-browse-database-dir')?.addEventListener('click', async () => {
        await browseDatabaseDirectory();
    });

    document.getElementById('btn-reset-download-dir')?.addEventListener('click', async () => {
        await resetDownloadDirectory();
    });

    document.getElementById('btn-reset-database-dir')?.addEventListener('click', async () => {
        await resetDatabaseDirectory();
    });

    // Playback settings
    document.getElementById('toggle-autoplay')?.addEventListener('click', function () {
        this.classList.toggle('active');
        savePlaybackSetting('autoplay', this.classList.contains('active'));
    });

    document.getElementById('toggle-gapless')?.addEventListener('click', function () {
        this.classList.toggle('active');
        savePlaybackSetting('gapless', this.classList.contains('active'));
    });

    const volumeSlider = document.getElementById('volume-slider');
    const volumeValue = document.getElementById('volume-value');
    volumeSlider?.addEventListener('input', function () {
        volumeValue.textContent = this.value + '%';
    });
    volumeSlider?.addEventListener('change', function () {
        savePlaybackSetting('defaultVolume', parseInt(this.value));
        // Update current player volume if playing
        if (window.player && window.player.audio) {
            window.player.audio.volume = parseInt(this.value) / 100;
        }
    });

    const crossfadeSlider = document.getElementById('crossfade-slider');
    const crossfadeValue = document.getElementById('crossfade-value');
    crossfadeSlider?.addEventListener('input', function () {
        crossfadeValue.textContent = this.value + 's';
    });
    crossfadeSlider?.addEventListener('change', function () {
        savePlaybackSetting('crossfadeDuration', parseFloat(this.value));
    });

    // Load saved theme
    loadTheme();
    loadQuality();
    loadStreamQuality();
    loadDirectorySettings();
    loadPlaybackSettings();

    // Context Menu
    document.addEventListener('click', () => {
        contextMenu.classList.remove('visible');
        document.getElementById('downloads-view-menu')?.classList.remove('visible');
        document.getElementById('liked-view-menu')?.classList.remove('visible');
    });

    contextMenu.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (action) {
            if (contextMenu.dataset.menuType === 'playlist') {
                handlePlaylistContextMenuAction(action);
            } else {
                handleContextMenuAction(action);
            }
        }
    });

    // Downloads view context menu
    document.getElementById('downloads-view-menu')?.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (action) {
            handleViewContextMenuAction('downloads', action);
        }
    });

    // Liked view context menu
    document.getElementById('liked-view-menu')?.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (action) {
            handleViewContextMenuAction('liked', action);
        }
    });
}

// Navigation
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const view = item.dataset.view;
            if (view) {
                switchView(view);

                // Update navigation state with icons
                updateNavigationState(view);

                // Clear playlist selection
                document.querySelectorAll('.playlist-item').forEach(p =>
                    p.classList.remove('active')
                );
            }
        });
    });
}

// Helper function to update navigation state and icons - moved to bottom of file

function switchView(view) {
    currentView = view;
    currentPlaylistId = null;

    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

    // Show selected view
    document.getElementById(`view-${view}`).classList.add('active');

    // Load data for view
    if (view === 'downloads') {
        loadDownloads();
    } else if (view === 'liked') {
        loadLikedSongs();
    }
}

function switchToPlaylistView(playlistId, playlistName) {
    currentView = 'playlist';
    currentPlaylistId = playlistId;
    currentPlaylistName = playlistName;

    // Update navigation
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

    // Show playlist view
    const playlistView = document.getElementById('view-playlist');
    playlistView.classList.add('active');

    // Update playlist title
    document.getElementById('playlist-title').textContent = playlistName;

    // Load playlist tracks
    loadPlaylistTracks(playlistId);
}

// Search handler
async function handleSearch() {
    const query = searchInput.value.trim();
    if (!query) return;

    // Show clear button
    btnClearSearch.style.display = 'block';

    // Perform music search
    performSearch();
}

// Search
async function performSearch() {
    const query = searchInput.value.trim();
    if (!query) return;

    // Show clear button
    btnClearSearch.style.display = 'block';

    if (!backendReady) {
        showError('Backend is still initializing...');
        return;
    }

    // Show loading in search results area only
    searchResults.innerHTML = '<div class="empty-state"><p>Searching...</p></div>';

    try {
        // Online search
        const result = await ipcRenderer.invoke('search-music', query);

        console.log('Search results:', result);

        if (result.success) {
            saveSearchHistory(query);
            displaySearchResults(result.data);
        } else {
            searchResults.innerHTML = `<div class="empty-state"><p>Search failed: ${result.error}</p></div>`;
        }
    } catch (error) {
        searchResults.innerHTML = `<div class="empty-state"><p>Search error: ${error.message}</p></div>`;
    }
}

// Clear search results
function clearSearch() {
    searchInput.value = '';
    btnClearSearch.style.display = 'none';
    searchResults.innerHTML = '';

    // Show search history and recent plays
    if (searchHistory) searchHistory.style.display = 'block';
    if (recentPlays) recentPlays.style.display = 'block';
}

async function searchInDownloads(query) {
    const result = await ipcRenderer.invoke('db-get-downloads');

    if (result.success) {
        // Mark all as downloaded
        result.data.forEach(track => track.downloaded = true);

        if (!query || query.trim() === '') {
            // Show all downloads if query is empty
            const enrichResult = await ipcRenderer.invoke('enrich-tracks', result.data);
            const enrichedTracks = enrichResult.success ? enrichResult.data : result.data;
            displayTracks(downloadsList, enrichedTracks);
            return;
        }

        const filtered = result.data.filter(track =>
            track.title.toLowerCase().includes(query.toLowerCase()) ||
            (track.artist_name && track.artist_name.toLowerCase().includes(query.toLowerCase()))
        );

        // Enrich with liked status
        const enrichResult = await ipcRenderer.invoke('enrich-tracks', filtered);
        const enrichedTracks = enrichResult.success ? enrichResult.data : filtered;

        displayTracks(downloadsList, enrichedTracks);

        if (filtered.length === 0) {
            downloadsList.innerHTML = '<div class="empty-state"><p>No results found in downloads</p></div>';
        }
    }
}

async function searchInLikedSongs(query) {
    const result = await ipcRenderer.invoke('db-get-liked');

    if (result.success) {
        // Mark all as liked
        result.data.forEach(track => track.liked = true);

        if (!query || query.trim() === '') {
            // Show all liked songs if query is empty
            const enrichResult = await ipcRenderer.invoke('enrich-tracks', result.data);
            const enrichedTracks = enrichResult.success ? enrichResult.data : result.data;
            displayTracks(likedList, enrichedTracks);
            return;
        }

        const filtered = result.data.filter(track =>
            track.title.toLowerCase().includes(query.toLowerCase()) ||
            (track.artist_name && track.artist_name.toLowerCase().includes(query.toLowerCase()))
        );

        // Enrich with downloaded status
        const enrichResult = await ipcRenderer.invoke('enrich-tracks', filtered);
        const enrichedTracks = enrichResult.success ? enrichResult.data : filtered;

        displayTracks(likedList, enrichedTracks);

        if (filtered.length === 0) {
            likedList.innerHTML = '<div class="empty-state"><p>No results found in liked songs</p></div>';
        }
    }
}

async function searchInPlaylist(query) {
    const result = await ipcRenderer.invoke('db-get-playlist-tracks', currentPlaylistId);

    if (result.success) {
        if (!query || query.trim() === '') {
            // Show all playlist tracks if query is empty
            const enrichResult = await ipcRenderer.invoke('enrich-tracks', result.data);
            const enrichedTracks = enrichResult.success ? enrichResult.data : result.data;
            const playlistTracks = document.getElementById('playlist-tracks');
            displayTracks(playlistTracks, enrichedTracks);
            return;
        }

        const filtered = result.data.filter(track =>
            track.title.toLowerCase().includes(query.toLowerCase()) ||
            (track.artist_name && track.artist_name.toLowerCase().includes(query.toLowerCase()))
        );

        const enrichResult = await ipcRenderer.invoke('enrich-tracks', filtered);
        const enrichedTracks = enrichResult.success ? enrichResult.data : filtered;

        const playlistTracks = document.getElementById('playlist-tracks');
        displayTracks(playlistTracks, enrichedTracks);

        if (filtered.length === 0) {
            playlistTracks.innerHTML = '<div class="empty-state"><p>No results found in playlist</p></div>';
        }
    }
}

async function displaySearchResults(tracks) {
    searchResults.innerHTML = '';

    if (tracks.length === 0) {
        searchResults.innerHTML = '<div class="empty-state"><p>No results found</p></div>';
        updateSearchViewVisibility();
        return;
    }

    // Filter out invalid video IDs (channels, playlists, etc.)
    const validTracks = tracks.filter(track => {
        // YouTube video IDs are 11 characters, channel IDs start with UC and are longer
        const videoId = track.youtube_id || track.video_id;
        if (!videoId) return false;

        // Exclude channel IDs (start with UC, UU, or PL for playlists)
        if (videoId.startsWith('UC') || videoId.startsWith('UU') || videoId.startsWith('PL')) {
            console.log('Filtered out invalid ID:', videoId, track.title);
            return false;
        }

        return videoId.length === 11;
    });

    // Normalize youtube_id field for all valid tracks
    validTracks.forEach(track => {
        if (!track.youtube_id && track.video_id) {
            track.youtube_id = track.video_id;
        }
    });

    if (validTracks.length === 0) {
        searchResults.innerHTML = '<div class="empty-state"><p>No valid videos found</p></div>';
        updateSearchViewVisibility();
        return;
    }

    // Enrich tracks with liked/downloaded status from database
    const enrichResult = await ipcRenderer.invoke('enrich-tracks', validTracks);
    const enrichedTracks = enrichResult.success ? enrichResult.data : validTracks;

    console.log('Enriched tracks:', enrichedTracks);

    enrichedTracks.forEach(track => {
        const trackEl = createTrackElement(track);
        searchResults.appendChild(trackEl);
    });

    updateSearchViewVisibility();
}

// Track Element Creation
function createTrackElement(track, options = {}) {
    const div = document.createElement('div');
    div.className = 'track-item';
    div.dataset.trackId = track.id || '';
    div.dataset.youtubeId = track.youtube_id;

    // Track info
    const info = document.createElement('div');
    info.className = 'track-info';

    const title = document.createElement('div');
    title.className = 'track-title';
    title.textContent = track.title;

    const artist = document.createElement('div');
    artist.className = 'track-artist';
    artist.textContent = track.artist_name || track.artist || track.uploader || 'Unknown Artist';

    info.appendChild(title);
    info.appendChild(artist);

    // Duration
    const duration = document.createElement('div');
    duration.className = 'track-duration';
    duration.textContent = formatDuration(track.duration);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'track-actions';

    if (options.showLikeButton !== false) {
        const btnLike = document.createElement('button');
        btnLike.className = 'btn-track-action like-btn' + (track.liked ? ' liked' : '');
        btnLike.title = track.liked ? 'Unlike' : 'Like';

        const likeIcon = document.createElement('img');
        // Always use liked.png for liked songs (red, universal)
        if (track.liked) {
            likeIcon.src = '../public/liked.png';
            likeIcon.className = 'liked-icon';
            likeIcon.alt = 'Liked';
        } else {
            // Use theme-aware icons for unliked songs
            const theme = document.documentElement.hasAttribute('data-theme') ? 'light' : 'dark';
            const suffix = theme === 'light' ? 'Black' : 'White';
            likeIcon.src = `../public/like${suffix}.png`;
            likeIcon.className = 'theme-icon';
            likeIcon.dataset.icon = 'like';
            likeIcon.alt = 'Like';
        }

        btnLike.appendChild(likeIcon);
        btnLike.onclick = (e) => {
            e.stopPropagation();
            // Find the parent track-item element
            let element = e.target;
            while (element && !element.classList.contains('track-item')) {
                element = element.parentElement;
            }
            const trackData = (element && element.__trackData) || track;
            toggleLike(trackData);
        };
        actions.appendChild(btnLike);
    }

    if (options.showDownloadButton !== false) {
        const btnDownload = document.createElement('button');
        btnDownload.className = 'btn-track-action download-btn';

        const downloadIcon = document.createElement('img');
        const theme = document.documentElement.hasAttribute('data-theme') ? 'light' : 'dark';
        const suffix = theme === 'light' ? 'Black' : 'White';

        if (track.downloaded) {
            // Show downloaded indicator - clicking will delete
            downloadIcon.src = '../public/downloaded.png';
            downloadIcon.className = 'downloaded-indicator';
            downloadIcon.alt = 'Downloaded (click to delete)';
            btnDownload.title = 'Delete Download';
        } else {
            // Show download icon
            downloadIcon.src = `../public/down${suffix}.png`;
            downloadIcon.className = 'theme-icon';
            downloadIcon.dataset.icon = 'down';
            downloadIcon.alt = 'Download';
            btnDownload.title = 'Download';
        }

        btnDownload.appendChild(downloadIcon);
        btnDownload.onclick = (e) => {
            e.stopPropagation();
            if (track.downloaded) {
                deleteDownload(track);
            } else {
                downloadTrack(track);
            }
        };
        actions.appendChild(btnDownload);
    }

    // Add 3-dot menu button
    const btnMenu = document.createElement('button');
    btnMenu.className = 'btn-track-action menu-btn';
    btnMenu.title = 'More options';

    const menuIcon = document.createElement('img');
    const theme = getCurrentTheme();
    menuIcon.src = theme === 'light' ? '../public/3dotBlack.png' : '../public/3dotWhite.png';
    menuIcon.style.width = '20px';
    menuIcon.style.height = '20px';
    menuIcon.style.display = 'block';
    btnMenu.appendChild(menuIcon);

    btnMenu.onclick = (e) => {
        e.stopPropagation();
        showContextMenu(e, track);
    };
    actions.appendChild(btnMenu);

    div.appendChild(info);
    div.appendChild(duration);
    div.appendChild(actions);

    // Click to play - use context-aware playback
    div.onclick = () => {
        playTrackInContext(track, options.context);
    };

    // Right-click context menu
    div.oncontextmenu = (e) => {
        e.preventDefault();
        showContextMenu(e, track);
    };

    // Store track data on the element for later reference
    div.__trackData = track;

    return div;
}

// Context-aware track playback
function playTrackInContext(track, context) {
    if (!context) {
        // No context - play single track (from search)
        window.playTrack(track);
        return;
    }

    // Get all tracks from the current context
    let allTracks = [];
    let contextType = context.type;
    let contextId = context.id || null;
    let contextName = context.name || null;

    const activeView = document.querySelector('.view.active');
    if (!activeView) {
        window.playTrack(track);
        return;
    }

    const trackList = activeView.querySelector('.track-list');
    if (trackList) {
        // Get all track elements and extract track data
        const trackElements = trackList.querySelectorAll('.track-item');
        trackElements.forEach(el => {
            const youtubeId = el.dataset.youtubeId;
            if (youtubeId) {
                // Find the track in our data by youtube_id
                const trackData = el.__trackData;
                if (trackData) {
                    allTracks.push(trackData);
                }
            }
        });
    }

    if (allTracks.length === 0) {
        window.playTrack(track);
        return;
    }

    // Find the index of the clicked track
    const startIndex = allTracks.findIndex(t => t.youtube_id === track.youtube_id);

    // Play with context
    window.playContext({
        type: contextType,
        id: contextId,
        name: contextName,
        tracks: allTracks,
        startIndex: startIndex >= 0 ? startIndex : 0,
        shuffle: false
    });
}

// Shuffle play from a view
async function shufflePlay(viewType) {
    let tracks = [];
    let contextId = null;
    let contextName = null;

    try {
        if (viewType === 'downloads') {
            const result = await ipcRenderer.invoke('db-get-downloads');
            if (result.success && result.data.length > 0) {
                result.data.forEach(track => track.downloaded = true);
                const enrichResult = await ipcRenderer.invoke('enrich-tracks', result.data);
                tracks = enrichResult.success ? enrichResult.data : result.data;
                contextName = 'Downloads';
            }
        } else if (viewType === 'liked') {
            const result = await ipcRenderer.invoke('db-get-liked');
            if (result.success && result.data.length > 0) {
                const enrichResult = await ipcRenderer.invoke('enrich-tracks', result.data);
                tracks = enrichResult.success ? enrichResult.data : result.data;
                contextName = 'Liked Songs';
            }
        } else if (viewType === 'playlist') {
            if (!currentPlaylistId) {
                showError('No playlist selected');
                return;
            }
            const result = await ipcRenderer.invoke('db-get-playlist-tracks', currentPlaylistId);
            if (result.success && result.data.length > 0) {
                const enrichResult = await ipcRenderer.invoke('enrich-tracks', result.data);
                tracks = enrichResult.success ? enrichResult.data : result.data;
                contextId = currentPlaylistId;
                contextName = currentPlaylistName || 'Playlist';
            }
        }

        if (tracks.length === 0) {
            showInfo('No tracks to play');
            return;
        }

        // Start shuffle playback from random track
        const randomIndex = Math.floor(Math.random() * tracks.length);

        window.playContext({
            type: viewType,
            id: contextId,
            name: contextName,
            tracks: tracks,
            startIndex: randomIndex,
            shuffle: true
        });

        showInfo(`Shuffle playing ${contextName}`);

    } catch (error) {
        console.error('Shuffle play error:', error);
        showError('Failed to start shuffle playback');
    }
}

// Downloads
async function loadDownloads() {
    try {
        const result = await ipcRenderer.invoke('db-get-downloads');

        if (result.success) {
            // Mark all as downloaded
            result.data.forEach(track => track.downloaded = true);

            // Enrich with liked status
            const enrichResult = await ipcRenderer.invoke('enrich-tracks', result.data);
            const enrichedTracks = enrichResult.success ? enrichResult.data : result.data;

            displayTracks(downloadsList, enrichedTracks, { context: { type: 'downloads', name: 'Downloads' } });
        }
    } catch (error) {
        console.error('Failed to load downloads:', error);
    }
}

// Liked Songs
async function loadLikedSongs() {
    try {
        const result = await ipcRenderer.invoke('db-get-liked');

        if (result.success) {
            // Mark all as liked and check if downloaded
            result.data.forEach(track => track.liked = true);

            // Enrich with downloaded status
            const enrichResult = await ipcRenderer.invoke('enrich-tracks', result.data);
            const enrichedTracks = enrichResult.success ? enrichResult.data : result.data;

            displayTracks(likedList, enrichedTracks, { context: { type: 'liked', name: 'Liked Songs' } });
        }
    } catch (error) {
        console.error('Failed to load liked songs:', error);
    }
}

async function toggleLike(track) {
    try {
        let trackId;
        if (track.id) {
            trackId = track.id;
        } else {
            trackId = await getOrCreateTrackId(track);
        }

        if (!trackId) {
            console.error('Failed to get track ID, cannot toggle like');
            showError('Failed to like track: Could not create track record');
            return;
        }

        const result = await ipcRenderer.invoke('db-toggle-like', trackId);

        if (result.success) {
            // Update UI
            track.liked = result.liked;

            // Update the like button icon in all track items with this track
            document.querySelectorAll(`.track-item[data-youtube-id="${track.youtube_id}"]`).forEach(trackEl => {
                const likeBtn = trackEl.querySelector('.like-btn');
                const likeIcon = likeBtn?.querySelector('img');

                if (likeIcon) {
                    if (result.liked) {
                        // Changed to liked - use red liked icon
                        likeIcon.src = '../public/liked.png';
                        likeIcon.className = 'liked-icon';
                        likeIcon.removeAttribute('data-icon');
                        likeBtn.classList.add('liked');
                        likeBtn.title = 'Unlike';
                    } else {
                        // Changed to unliked - use theme-aware icon
                        const theme = document.documentElement.hasAttribute('data-theme') ? 'light' : 'dark';
                        const suffix = theme === 'light' ? 'Black' : 'White';
                        likeIcon.src = `../public/like${suffix}.png`;
                        likeIcon.className = 'theme-icon';
                        likeIcon.dataset.icon = 'like';
                        likeBtn.classList.remove('liked');
                        likeBtn.title = 'Like';
                    }
                }
            });

            // Refresh views
            if (currentView === 'liked') {
                loadLikedSongs();
            }
        }
    } catch (error) {
        showError(`Failed to toggle like: ${error.message}`);
    }
}

// Playlists
async function loadPlaylists() {
    try {
        const result = await ipcRenderer.invoke('db-get-playlists');

        if (result.success) {
            // Check download status for each playlist
            const playlistsWithStatus = await Promise.all(result.data.map(async (playlist) => {
                const tracksResult = await ipcRenderer.invoke('db-get-playlist-tracks', playlist.id);
                if (tracksResult.success && tracksResult.data.length > 0) {
                    // Check if all tracks are downloaded
                    const allDownloaded = tracksResult.data.every(track => track.downloaded);
                    playlist.allDownloaded = allDownloaded;
                    playlist.trackCount = tracksResult.data.length;
                } else {
                    playlist.allDownloaded = false;
                    playlist.trackCount = 0;
                }
                return playlist;
            }));

            displayPlaylists(playlistsWithStatus);
        }
    } catch (error) {
        console.error('Failed to load playlists:', error);
    }
}

function displayPlaylists(playlists) {
    playlistList.innerHTML = '';

    playlists.forEach(playlist => {
        const div = document.createElement('div');
        div.className = 'playlist-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'playlist-name';
        nameSpan.textContent = playlist.name;

        const iconsContainer = document.createElement('div');
        iconsContainer.style.cssText = 'display: flex; align-items: center; gap: 8px;';

        // Show downloaded icon if all tracks are downloaded
        if (playlist.allDownloaded && playlist.trackCount > 0) {
            const downloadedIcon = document.createElement('img');
            downloadedIcon.src = '../public/downloaded.png';
            downloadedIcon.className = 'playlist-downloaded-icon';
            downloadedIcon.style.cssText = 'width: 16px; height: 16px; opacity: 0.7;';
            downloadedIcon.title = 'All tracks downloaded';
            iconsContainer.appendChild(downloadedIcon);
        }

        const menuBtn = document.createElement('button');
        menuBtn.className = 'playlist-menu-btn';
        menuBtn.title = 'Playlist options';

        const menuIcon = document.createElement('img');
        const theme = getCurrentTheme();
        menuIcon.src = theme === 'light' ? '../public/3dotBlack.png' : '../public/3dotWhite.png';
        menuIcon.style.width = '18px';
        menuIcon.style.height = '18px';
        menuIcon.style.display = 'block';
        menuBtn.appendChild(menuIcon);

        menuBtn.onclick = (e) => {
            e.stopPropagation();
            showPlaylistContextMenu(e, playlist);
        };

        iconsContainer.appendChild(menuBtn);

        div.appendChild(nameSpan);
        div.appendChild(iconsContainer);

        div.onclick = () => {
            const theme = getCurrentTheme();

            // Update all playlist items and their icons
            document.querySelectorAll('.playlist-item').forEach(p => {
                p.classList.remove('active');
                const btn = p.querySelector('.playlist-menu-btn img');
                if (btn) {
                    // Inactive playlist: Black for light theme, White for dark theme
                    btn.src = theme === 'light' ? '../public/3dotBlack.png' : '../public/3dotWhite.png';
                }
            });

            div.classList.add('active');

            // Active playlist: White for light theme (black bg), Black for dark theme (white bg)
            const activeMenuIcon = div.querySelector('.playlist-menu-btn img');
            if (activeMenuIcon) {
                activeMenuIcon.src = theme === 'light' ? '../public/3dotWhite.png' : '../public/3dotBlack.png';
            }

            switchToPlaylistView(playlist.id, playlist.name);
        };

        // Right-click context menu for playlist
        div.oncontextmenu = (e) => {
            e.preventDefault();
            showPlaylistContextMenu(e, playlist);
        };

        playlistList.appendChild(div);
    });
}

async function createNewPlaylist() {
    // Create custom dialog since prompt() is not supported in Electron
    const dialog = document.createElement('div');
    dialog.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 1000;';

    const form = document.createElement('div');
    form.style.cssText = 'background: var(--bg-secondary); padding: 20px; border-radius: 8px; min-width: 300px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);';

    const title = document.createElement('h3');
    title.textContent = 'New Playlist';
    title.style.cssText = 'margin: 0 0 15px 0; color: var(--text-primary);';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Enter playlist name';
    input.className = 'dialog-input';

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'btn-secondary';

    const createBtn = document.createElement('button');
    createBtn.textContent = 'Create';
    createBtn.className = 'btn-primary';

    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(createBtn);

    form.appendChild(title);
    form.appendChild(input);
    form.appendChild(buttonContainer);
    dialog.appendChild(form);
    document.body.appendChild(dialog);

    input.focus();

    // Handle create
    const handleCreate = async () => {
        const name = input.value.trim();
        if (!name) return;

        document.body.removeChild(dialog);

        try {
            const result = await ipcRenderer.invoke('db-create-playlist', name);

            if (result.success) {
                loadPlaylists();
            } else {
                showError(`Failed to create playlist: ${result.error}`);
            }
        } catch (error) {
            showError(`Failed to create playlist: ${error.message}`);
        }
    };

    // Handle cancel
    const handleCancel = () => {
        document.body.removeChild(dialog);
    };

    // Event listeners
    createBtn.addEventListener('click', handleCreate);
    cancelBtn.addEventListener('click', handleCancel);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleCreate();
        } else if (e.key === 'Escape') {
            handleCancel();
        }
    });
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) {
            handleCancel();
        }
    });
}

async function loadPlaylistTracks(playlistId) {
    try {
        const result = await ipcRenderer.invoke('db-get-playlist-tracks', playlistId);

        if (result.success) {
            // Enrich tracks with liked/downloaded status
            const enrichResult = await ipcRenderer.invoke('enrich-tracks', result.data);
            const enrichedTracks = enrichResult.success ? enrichResult.data : result.data;

            const container = document.getElementById('playlist-tracks');
            displayTracks(container, enrichedTracks, {
                context: {
                    type: 'playlist',
                    id: playlistId,
                    name: currentPlaylistName || 'Playlist'
                }
            });
        }
    } catch (error) {
        console.error('Failed to load playlist tracks:', error);
    }
}

// Download Track
async function downloadTrack(track) {
    if (!backendReady) {
        showError('Backend is still initializing...');
        return;
    }

    try {
        const result = await ipcRenderer.invoke('download-track', {
            video_id: track.youtube_id,
            title: track.title,
            artist: track.artist || track.uploader,
            duration: track.duration,
            quality: getDownloadQuality()
        });

        if (result.success) {
            showInfo(`Added to download queue: ${track.title}`);
        } else {
            showError(`Failed to add to queue: ${result.error}`);
        }
    } catch (error) {
        showError(`Download error: ${error.message}`);
    }
}

async function deleteDownload(track) {
    if (!backendReady) {
        showError('Backend is still initializing...');
        return;
    }

    showConfirm(`Delete "${track.title}" from downloads?`, async () => {
        try {
            const result = await ipcRenderer.invoke('delete-download', track.youtube_id);

            if (result.success) {
                showSuccess(`Deleted: ${track.title}`);
                track.downloaded = false;

                // Update UI to show download button instead of downloaded indicator
                updateTrackDownloadStatus(track, false);

                // Refresh downloads list
                loadDownloads();
            } else {
                showError(`Delete failed: ${result.error}`);
            }
        } catch (error) {
            showError(`Delete error: ${error.message}`);
        }
    });
}

// Context Menu
let contextMenuTrack = null;
let contextMenuPlaylist = null;
let originalContextMenuContent = '';
let currentMenuType = 'track'; // 'track' or 'playlist'

function showContextMenu(event, track) {
    contextMenuTrack = track;
    currentMenuType = 'track';

    // Store position for potential submenu
    window.lastContextMenuX = event.pageX;
    window.lastContextMenuY = event.pageY;

    // Generate dynamic context menu based on track state
    const menuItems = [];

    // Playback options
    menuItems.push('<div class="context-menu-item" data-action="play">Play</div>');
    menuItems.push('<div class="context-menu-item" data-action="play-next">Play Next</div>');
    menuItems.push('<div class="context-menu-item" data-action="add-to-queue">Add to Queue</div>');
    menuItems.push('<div class="context-menu-divider"></div>');

    // Download option - changes based on downloaded state
    if (track.downloaded) {
        menuItems.push('<div class="context-menu-item" data-action="remove-download">Remove Download</div>');
    } else {
        menuItems.push('<div class="context-menu-item" data-action="download">Download</div>');
    }

    // Like option - changes based on liked state
    if (track.liked) {
        menuItems.push('<div class="context-menu-item" data-action="unlike">Unlike</div>');
    } else {
        menuItems.push('<div class="context-menu-item" data-action="like">Like</div>');
    }

    menuItems.push('<div class="context-menu-divider"></div>');

    // Playlist options
    if (currentView === 'playlist' && currentPlaylistId) {
        menuItems.push('<div class="context-menu-item" data-action="remove-from-playlist">Remove from Playlist</div>');
    }
    menuItems.push('<div class="context-menu-item" data-action="add-to-playlist">Add to Playlist</div>');

    contextMenu.innerHTML = menuItems.join('');

    // Save as original content for restoration
    if (!originalContextMenuContent) {
        originalContextMenuContent = contextMenu.innerHTML;
    }

    // First show menu to calculate its dimensions
    contextMenu.classList.add('visible');

    // Get menu dimensions
    const menuWidth = contextMenu.offsetWidth;
    const menuHeight = contextMenu.offsetHeight;

    // Get viewport dimensions
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Calculate position
    let left = event.pageX;
    let top = event.pageY;

    // Adjust if menu would go beyond right edge
    if (left + menuWidth > viewportWidth) {
        left = viewportWidth - menuWidth - 10;
    }

    // Adjust if menu would go beyond bottom edge
    if (top + menuHeight > viewportHeight) {
        top = viewportHeight - menuHeight - 10;
    }

    // Ensure menu stays within left and top boundaries
    left = Math.max(10, left);
    top = Math.max(10, top);

    contextMenu.style.left = left + 'px';
    contextMenu.style.top = top + 'px';
}

function handleContextMenuAction(action) {
    if (!contextMenuTrack) return;

    switch (action) {
        case 'play':
            window.playTrack(contextMenuTrack);
            break;
        case 'play-next':
            window.addToQueue(contextMenuTrack, true);
            break;
        case 'add-to-queue':
            window.addToQueue(contextMenuTrack, false);
            break;
        case 'download':
            downloadTrack(contextMenuTrack);
            break;
        case 'remove-download':
            deleteDownload(contextMenuTrack);
            break;
        case 'like':
        case 'unlike':
            toggleLike(contextMenuTrack);
            break;
        case 'add-to-playlist':
            showAddToPlaylistDialog(contextMenuTrack);
            break;
        case 'remove-from-playlist':
            removeFromCurrentPlaylist(contextMenuTrack);
            break;
    }

    contextMenu.classList.remove('visible');

    // Restore track menu content if it was a playlist menu
    if (currentMenuType === 'playlist' && originalContextMenuContent) {
        setTimeout(() => {
            contextMenu.innerHTML = originalContextMenuContent;
            delete contextMenu.dataset.menuType;
            currentMenuType = 'track';
        }, 200);
    }
}

// Playlist Context Menu
const playlistContextMenuHtml = `
    <div class="context-menu-item" data-action="open">Open Playlist</div>
    <div class="context-menu-item" data-action="play-next">Play Next</div>
    <div class="context-menu-item" data-action="add-to-queue">Add to Queue</div>
    <div class="context-menu-divider"></div>
    <div class="context-menu-item" data-action="download-playlist">Download Playlist</div>
    <div class="context-menu-item" data-action="rename">Rename</div>
    <div class="context-menu-divider"></div>
    <div class="context-menu-item" data-action="delete">Delete Playlist</div>
`;

function showPlaylistContextMenu(event, playlist) {
    contextMenuPlaylist = playlist;
    currentMenuType = 'playlist';

    // Save original content if not already saved
    if (!originalContextMenuContent) {
        originalContextMenuContent = contextMenu.innerHTML;
    }

    // Change to playlist menu content
    contextMenu.innerHTML = playlistContextMenuHtml;
    contextMenu.dataset.menuType = 'playlist';

    // First show menu to calculate its dimensions
    contextMenu.classList.add('visible');
    contextMenu.dataset.menuType = 'playlist';

    // Get menu dimensions
    const menuWidth = contextMenu.offsetWidth;
    const menuHeight = contextMenu.offsetHeight;

    // Get viewport dimensions
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Calculate position
    let left = event.pageX;
    let top = event.pageY;

    // Adjust if menu would go beyond right edge
    if (left + menuWidth > viewportWidth) {
        left = viewportWidth - menuWidth - 10;
    }

    // Adjust if menu would go beyond bottom edge
    if (top + menuHeight > viewportHeight) {
        top = viewportHeight - menuHeight - 10;
    }

    // Ensure menu stays within left and top boundaries
    left = Math.max(10, left);
    top = Math.max(10, top);

    contextMenu.style.left = left + 'px';
    contextMenu.style.top = top + 'px';
}

async function handlePlaylistContextMenuAction(action) {
    if (!contextMenuPlaylist) return;

    switch (action) {
        case 'open':
            switchToPlaylistView(contextMenuPlaylist.id, contextMenuPlaylist.name);
            break;
        case 'play-next':
            await addPlaylistToQueue(contextMenuPlaylist, true);
            break;
        case 'add-to-queue':
            await addPlaylistToQueue(contextMenuPlaylist, false);
            break;
        case 'download-playlist':
            await downloadPlaylist(contextMenuPlaylist);
            break;
        case 'rename':
            await renamePlaylist(contextMenuPlaylist);
            break;
        case 'delete':
            await deletePlaylist(contextMenuPlaylist);
            break;
    }

    contextMenu.classList.remove('visible');

    // Restore track menu content after closing
    if (originalContextMenuContent) {
        setTimeout(() => {
            contextMenu.innerHTML = originalContextMenuContent;
            delete contextMenu.dataset.menuType;
            currentMenuType = 'track';
        }, 200);
    }
}

async function renamePlaylist(playlist) {
    const dialog = document.createElement('div');
    dialog.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 1000;';

    const form = document.createElement('div');
    form.style.cssText = 'background: var(--bg-secondary); padding: 20px; border-radius: 8px; min-width: 300px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);';

    const title = document.createElement('h3');
    title.textContent = 'Rename Playlist';
    title.style.cssText = 'margin: 0 0 15px 0; color: var(--text-primary);';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = playlist.name;
    input.placeholder = 'Enter new playlist name';
    input.className = 'dialog-input';

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'btn-secondary';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.className = 'btn-primary';

    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(saveBtn);

    form.appendChild(title);
    form.appendChild(input);
    form.appendChild(buttonContainer);
    dialog.appendChild(form);

    cancelBtn.onclick = () => document.body.removeChild(dialog);

    saveBtn.onclick = async () => {
        const newName = input.value.trim();
        if (newName) {
            const result = await ipcRenderer.invoke('db-rename-playlist', { playlistId: playlist.id, name: newName });
            if (result.success) {
                document.body.removeChild(dialog);
                loadPlaylists();
                showToast('Playlist renamed', 'success');
            } else {
                showToast(`Failed to rename playlist: ${result.error}`, 'error');
            }
        }
    };

    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveBtn.click();
    });

    document.body.appendChild(dialog);
    input.focus();
    input.select();
}

async function deletePlaylist(playlist) {
    showConfirm(`Are you sure you want to delete the playlist "${playlist.name}"?`, async () => {
        const result = await ipcRenderer.invoke('db-delete-playlist', playlist.id);
        if (result.success) {
            loadPlaylists();
            if (currentPlaylistId === playlist.id) {
                switchView('search');
                updateNavigationState('search');
            }
            showSuccess('Playlist deleted');
        } else {
            showError(`Failed to delete playlist: ${result.error}`);
        }
    });
}

// Add Playlist to Queue
async function addPlaylistToQueue(playlist, playNext = false) {
    try {
        const result = await ipcRenderer.invoke('db-get-playlist-tracks', playlist.id);

        if (result.success && result.data && result.data.length > 0) {
            const tracks = result.data;

            if (playNext) {
                // Add all tracks to play next (in reverse order to maintain order)
                for (let i = tracks.length - 1; i >= 0; i--) {
                    window.addToQueue(tracks[i], true);
                }
                showInfo(`Added ${tracks.length} track(s) from "${playlist.name}" to play next`);
            } else {
                // Add all tracks to end of queue
                tracks.forEach(track => window.addToQueue(track, false));
                showInfo(`Added ${tracks.length} track(s) from "${playlist.name}" to queue`);
            }
        } else {
            showError('Playlist is empty or could not be loaded');
        }
    } catch (error) {
        console.error('Failed to add playlist to queue:', error);
        showError('Failed to add playlist to queue');
    }
}

// Download Playlist
async function downloadPlaylist(playlist) {
    if (!backendReady) {
        showError('Backend is still initializing...');
        return;
    }

    try {
        const result = await ipcRenderer.invoke('db-get-playlist-tracks', playlist.id);

        if (result.success && result.data && result.data.length > 0) {
            const tracks = result.data;
            let addedCount = 0;
            let skippedCount = 0;

            for (const track of tracks) {
                // Skip if already downloaded
                if (track.is_downloaded) {
                    skippedCount++;
                    continue;
                }

                try {
                    const downloadResult = await ipcRenderer.invoke('download-track', {
                        video_id: track.youtube_id,
                        title: track.title,
                        artist: track.artist || track.uploader,
                        duration: track.duration,
                        quality: getDownloadQuality()
                    });

                    if (downloadResult.success) {
                        addedCount++;
                    }
                } catch (error) {
                    console.error(`Failed to download track: ${track.title}`, error);
                }
            }

            if (addedCount > 0) {
                showInfo(`Added ${addedCount} track(s) from "${playlist.name}" to download queue${skippedCount > 0 ? ` (${skippedCount} already downloaded)` : ''}`);
            } else if (skippedCount > 0) {
                showInfo(`All tracks from "${playlist.name}" are already downloaded`);
            } else {
                showError('No tracks could be added to download queue');
            }
        } else {
            showError('Playlist is empty or could not be loaded');
        }
    } catch (error) {
        console.error('Failed to download playlist:', error);
        showError('Failed to download playlist');
    }
}

// Remove Track from Current Playlist
async function removeFromCurrentPlaylist(track) {
    if (!currentPlaylistId) {
        showError('Not viewing a playlist');
        return;
    }

    try {
        const trackId = track.id;
        if (!trackId) {
            showError('Track ID not found');
            return;
        }

        const result = await ipcRenderer.invoke('db-remove-from-playlist', {
            playlistId: currentPlaylistId,
            trackId: trackId
        });

        if (result.success) {
            showSuccess('Removed from playlist');
            // Reload the playlist to update the view
            loadPlaylistTracks(currentPlaylistId);
        } else {
            showError(`Failed to remove track: ${result.error}`);
        }
    } catch (error) {
        showError(`Error removing track: ${error.message}`);
    }
}

// Add Track to Playlist Dialog
async function showAddToPlaylistDialog(track) {
    // Get all playlists
    const result = await ipcRenderer.invoke('db-get-playlists');
    if (!result.success || result.data.length === 0) {
        showError('No playlists available. Create a playlist first.');
        return;
    }

    const playlists = result.data;

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'playlist-selection-overlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 1000;';

    // Create dialog container
    const dialog = document.createElement('div');
    dialog.className = 'playlist-selection-dialog';
    dialog.style.cssText = 'background: var(--bg-secondary); border-radius: 8px; padding: 24px; min-width: 320px; max-width: 400px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);';

    // Title
    const title = document.createElement('h3');
    title.textContent = 'Add to Playlist';
    title.style.cssText = 'margin: 0 0 8px 0; color: var(--text-primary); font-size: 18px; font-weight: 600;';

    // Track name
    const trackName = document.createElement('p');
    trackName.textContent = track.title;
    trackName.style.cssText = 'margin: 0 0 20px 0; color: var(--text-secondary); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';

    // Playlist list container
    const playlistList = document.createElement('div');
    playlistList.className = 'playlist-selection-list';
    playlistList.style.cssText = 'max-height: 300px; overflow-y: auto;';

    playlists.forEach(playlist => {
        const item = document.createElement('div');
        item.className = 'playlist-selection-item';
        item.textContent = playlist.name;
        item.style.cssText = 'padding: 12px 16px; margin-bottom: 8px; background: var(--bg-tertiary); border-radius: 6px; cursor: pointer; transition: all 0.2s; color: var(--text-primary); font-size: 14px;';

        item.addEventListener('mouseenter', () => {
            item.style.backgroundColor = 'var(--bg-hover)';
        });

        item.addEventListener('mouseleave', () => {
            item.style.backgroundColor = 'var(--bg-tertiary)';
        });

        item.addEventListener('click', async () => {
            await addTrackToPlaylist(track, playlist.id, playlist.name);
            document.body.removeChild(overlay);
        });

        playlistList.appendChild(item);
    });

    // Assemble dialog
    dialog.appendChild(title);
    dialog.appendChild(trackName);
    dialog.appendChild(playlistList);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            document.body.removeChild(overlay);
        }
    });

    // Close on Escape key
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            document.body.removeChild(overlay);
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
}

async function addTrackToPlaylist(track, playlistId, playlistName) {
    try {
        // First, ensure the track exists in the database
        const trackId = track.id || await getOrCreateTrackId(track);

        // Add track to playlist using correct IPC handler
        const result = await ipcRenderer.invoke('db-add-to-playlist', { playlistId, trackId });

        if (result.success) {
            showSuccess(`Added to ${playlistName || 'playlist'}`);

            // If we're currently viewing this playlist, reload it
            if (currentView === 'playlist' && currentPlaylistId === playlistId) {
                loadPlaylistTracks(playlistId);
            }
        } else {
            showError(`Failed to add track: ${result.error}`);
        }
    } catch (error) {
        showError(`Error adding track: ${error.message}`);
    }
}

async function getOrCreateTrackId(track) {
    try {
        // Check if track exists in database
        const checkResult = await ipcRenderer.invoke('db-get-track-by-youtube-id', track.youtube_id);

        if (checkResult.success && checkResult.data) {
            return checkResult.data.id;
        }

        // Track doesn't exist, create it
        const trackData = {
            youtube_id: track.youtube_id,
            title: track.title,
            artist: track.artist_name || track.artist || track.uploader || 'Unknown',
            duration: track.duration || 0
        };

        const createResult = await ipcRenderer.invoke('db-create-track', trackData);

        if (createResult.success && createResult.data) {
            return createResult.data.id;
        }

        console.error('Failed to create track:', createResult.error || 'Unknown error');
        throw new Error('Failed to create track in database');
    } catch (error) {
        console.error('Error in getOrCreateTrackId:', error);
        return undefined;
    }
}

// Utility Functions
function displayTracks(container, tracks, options = {}) {
    container.innerHTML = '';

    if (tracks.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No tracks</p></div>';
        return;
    }

    tracks.forEach(track => {
        const trackEl = createTrackElement(track, options);
        container.appendChild(trackEl);
    });
}

function formatDuration(seconds) {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function showLoading(message = 'Loading...') {
    loadingMessage.textContent = message;
    loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    loadingOverlay.classList.add('hidden');
}

function showError(message) {
    showToast(message, 'error');
    console.error(message);
}

function showSuccess(message) {
    showToast(message, 'success');
    console.log(message);
}

function showInfo(message) {
    showToast(message, 'info');
    console.log('INFO:', message);
}

function showWarning(message) {
    showToast(message, 'warning');
    console.warn('WARNING:', message);
}

// Toast Notification System
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        padding: 12px 20px;
        background: var(--bg-secondary);
        color: var(--text-primary);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        animation: slideIn 0.3s ease-out;
        max-width: 400px;
        border-left: 4px solid ${type === 'error' ? 'var(--danger)' : type === 'success' ? 'var(--success)' : type === 'warning' ? '#f59e0b' : 'var(--accent-primary)'};
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => document.body.removeChild(toast), 300);
    }, 3000);
}

// Custom Confirmation Dialog
function showConfirm(message, onConfirm, onCancel) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background: var(--bg-secondary); padding: 24px; border-radius: 8px; min-width: 320px; max-width: 400px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);';

    const messageEl = document.createElement('p');
    messageEl.textContent = message;
    messageEl.style.cssText = 'margin: 0 0 20px 0; color: var(--text-primary); font-size: 14px; line-height: 1.5;';

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'btn-secondary';

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Confirm';
    confirmBtn.className = 'btn-primary';

    cancelBtn.onclick = () => {
        document.body.removeChild(overlay);
        if (onCancel) onCancel();
    };

    confirmBtn.onclick = () => {
        document.body.removeChild(overlay);
        if (onConfirm) onConfirm();
    };

    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(confirmBtn);
    dialog.appendChild(messageEl);
    dialog.appendChild(buttonContainer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            document.body.removeChild(overlay);
            if (onCancel) onCancel();
        }
    });

    // Focus confirm button
    confirmBtn.focus();
}

async function checkDownloadQueue() {
    try {
        const result = await ipcRenderer.invoke('get-download-queue');
        if (result.success && result.data.queue.length > 0) {
            console.log(`Resuming ${result.data.queue.length} pending downloads...`);
        }
    } catch (error) {
        console.error('Failed to check download queue:', error);
    }
}

function updateTrackDownloadStatus(track, isDownloaded = true) {
    // Update all track items with this youtube_id to show downloaded/not downloaded status
    document.querySelectorAll(`.track-item[data-youtube-id="${track.youtube_id}"]`).forEach(trackEl => {
        const actions = trackEl.querySelector('.track-actions');
        const downloadBtn = Array.from(actions.querySelectorAll('.btn-track-action.download-btn')).find(btn => btn);

        if (downloadBtn) {
            const icon = downloadBtn.querySelector('img');
            const theme = document.documentElement.hasAttribute('data-theme') ? 'light' : 'dark';
            const suffix = theme === 'light' ? 'Black' : 'White';

            if (isDownloaded) {
                // Change to downloaded indicator
                icon.src = '../public/downloaded.png';
                icon.className = 'downloaded-indicator';
                icon.alt = 'Downloaded (click to delete)';
                icon.removeAttribute('data-icon');
                downloadBtn.title = 'Delete Download';
            } else {
                // Change to download icon
                icon.src = `../public/down${suffix}.png`;
                icon.className = 'theme-icon';
                icon.dataset.icon = 'down';
                icon.alt = 'Download';
                downloadBtn.title = 'Download';
            }
        }
    });
}

// Icon Management
function getIconPath(iconName, theme = null) {
    // Get current theme if not specified
    if (!theme) {
        const root = document.documentElement;
        theme = root.hasAttribute('data-theme') ? 'light' : 'dark';
    }

    // Liked icon is always red (universal)
    if (iconName === 'liked') {
        return '../public/liked.png';
    }

    // For theme-aware icons, use Black for light mode, White for dark mode
    const suffix = theme === 'light' ? 'Black' : 'White';
    return `../public/${iconName}${suffix}.png`;
}

function updateAllIcons() {
    const theme = document.documentElement.hasAttribute('data-theme') ? 'light' : 'dark';

    // Update all theme-aware icons
    document.querySelectorAll('.theme-icon').forEach(icon => {
        const iconName = icon.dataset.icon;
        if (iconName) {
            // Check if this icon belongs to an active nav item
            const parentNavItem = icon.closest('.nav-item');
            if (parentNavItem && parentNavItem.classList.contains('active')) {
                // Active items: Black icon for dark theme (white bg), White icon for light theme (black bg)
                const suffix = theme === 'light' ? 'White' : 'Black';
                icon.src = `../public/${iconName}${suffix}.png`;
            } else {
                // Inactive items: use regular theme icons
                icon.src = getIconPath(iconName, theme);
            }
        }
    });

    // Update nav menu 3-dot icons
    document.querySelectorAll('.nav-item').forEach(item => {
        const menuIcon = item.querySelector('.nav-menu-btn img');
        if (menuIcon) {
            if (item.classList.contains('active')) {
                // Active nav: White for light theme, Black for dark theme
                menuIcon.src = theme === 'light' ? '../public/3dotWhite.png' : '../public/3dotBlack.png';
            } else {
                // Inactive nav: Black for light theme, White for dark theme
                menuIcon.src = theme === 'light' ? '../public/3dotBlack.png' : '../public/3dotWhite.png';
            }
        }
    });

    // Update playlist 3-dot icons
    document.querySelectorAll('.playlist-item').forEach(item => {
        const menuIcon = item.querySelector('.playlist-menu-btn img');
        if (menuIcon) {
            if (item.classList.contains('active')) {
                // Active playlist: White for light theme, Black for dark theme
                menuIcon.src = theme === 'light' ? '../public/3dotWhite.png' : '../public/3dotBlack.png';
            } else {
                // Inactive playlist: Black for light theme, White for dark theme
                menuIcon.src = theme === 'light' ? '../public/3dotBlack.png' : '../public/3dotWhite.png';
            }
        }
    });

    // Update about section logo
    const aboutLogo = document.getElementById('about-logo');
    if (aboutLogo) {
        const iconSuffix = theme === 'light' ? 'black' : 'white';
        aboutLogo.src = `../public/wavex${iconSuffix}.png`;
    }
}

// Theme Management
function switchTheme(theme) {
    const root = document.documentElement;

    if (theme === 'light') {
        root.setAttribute('data-theme', 'light');
    } else {
        root.removeAttribute('data-theme');
    }

    // Update active button
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.theme === theme) {
            btn.classList.add('active');
        }
    });

    // Update all icons to match new theme
    updateAllIcons();

    // Update app icon in taskbar/titlebar
    ipcRenderer.invoke('update-app-icon', theme).catch(err => {
        console.error('Failed to update app icon:', err);
    });

    // Save preference
    localStorage.setItem('theme', theme);
}

function loadTheme() {
    let theme = localStorage.getItem('theme');

    // If no saved preference, detect system theme
    if (!theme) {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        theme = prefersDark ? 'dark' : 'light';
        console.log('Detected system theme:', theme);
    }

    switchTheme(theme);

    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        // Only auto-switch if user hasn't manually set a preference
        if (!localStorage.getItem('theme')) {
            const newTheme = e.matches ? 'dark' : 'light';
            console.log('System theme changed to:', newTheme);
            switchTheme(newTheme);
        }
    });
}

// Quality Management
function switchQuality(quality) {
    // Update active button
    document.querySelectorAll('.quality-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.quality === quality) {
            btn.classList.add('active');
        }
    });

    // Save preference
    localStorage.setItem('downloadQuality', quality);

    console.log(`Download quality set to ${quality} kbps`);
}

function loadQuality() {
    const savedQuality = localStorage.getItem('downloadQuality') || '320';
    switchQuality(savedQuality);
}

function getDownloadQuality() {
    return localStorage.getItem('downloadQuality') || '320';
}

// Stream Quality Management
function switchStreamQuality(quality) {
    // Update active button
    document.querySelectorAll('.stream-quality-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.streamQuality === quality) {
            btn.classList.add('active');
        }
    });

    // Save preference
    localStorage.setItem('streamQuality', quality);

    console.log(`Streaming quality set to ${quality}`);
}

function loadStreamQuality() {
    const savedQuality = localStorage.getItem('streamQuality') || 'high';
    switchStreamQuality(savedQuality);
}

function getStreamQuality() {
    return localStorage.getItem('streamQuality') || 'high';
}

// Search History Functions
function saveSearchHistory(query) {
    let history = JSON.parse(localStorage.getItem('searchHistory') || '[]');

    // Remove if already exists
    history = history.filter(item => item !== query);

    // Add to beginning
    history.unshift(query);

    // Keep only last 10 searches
    history = history.slice(0, 10);

    localStorage.setItem('searchHistory', JSON.stringify(history));
    loadSearchHistory();
}

function loadSearchHistory() {
    const history = JSON.parse(localStorage.getItem('searchHistory') || '[]');

    searchHistoryList.innerHTML = '';

    if (history.length > 0) {
        history.forEach(query => {
            const item = document.createElement('div');
            item.className = 'search-history-item';
            item.textContent = query;
            item.addEventListener('click', () => {
                searchInput.value = query;
                performSearch();
            });
            searchHistoryList.appendChild(item);
        });
    }

    // Show/hide based on whether we have search results or history/recent plays
    updateSearchViewVisibility();
}

async function loadRecentPlays() {
    try {
        const result = await ipcRenderer.invoke('db-get-recent-plays');

        recentPlaysList.innerHTML = '';

        if (result.success && result.data.length > 0) {
            // Enrich with liked/downloaded status
            const enrichResult = await ipcRenderer.invoke('enrich-tracks', result.data);
            const enrichedTracks = enrichResult.success ? enrichResult.data : result.data;

            enrichedTracks.slice(0, 10).forEach(track => {
                const cube = createRecentPlayCube(track);
                recentPlaysList.appendChild(cube);
            });
        }

        updateSearchViewVisibility();
    } catch (error) {
        console.error('Failed to load recent plays:', error);
    }
}

function updateSearchViewVisibility() {
    const history = JSON.parse(localStorage.getItem('searchHistory') || '[]');
    const hasHistory = history.length > 0;
    const hasRecentPlays = recentPlaysList && recentPlaysList.children.length > 0;
    const hasSearchResults = searchResults.children.length > 0 && !searchResults.children[0].classList.contains('empty-state');

    if (currentView === 'search') {
        if (hasSearchResults) {
            // Show search results, hide everything else
            searchHistory.style.display = 'none';
            recentPlays.style.display = 'none';
            const emptyState = searchResults.querySelector('.empty-state');
            if (emptyState) emptyState.style.display = 'none';
        } else {
            // Show history and recent plays if available
            if (hasHistory || hasRecentPlays) {
                const emptyState = searchResults.querySelector('.empty-state');
                if (emptyState) emptyState.style.display = 'none';
            }
            searchHistory.style.display = hasHistory ? 'block' : 'none';
            recentPlays.style.display = hasRecentPlays ? 'block' : 'none';
        }
    }
}

function createRecentPlayCube(track) {
    const cube = document.createElement('div');
    cube.className = 'recent-play-cube';

    // Store track data on element for like button and other operations
    cube.__trackData = track;

    // Track info
    const title = document.createElement('div');
    title.className = 'cube-title';
    title.textContent = track.title;

    const artist = document.createElement('div');
    artist.className = 'cube-artist';
    artist.textContent = track.artist_name || track.artist || 'Unknown Artist';

    cube.appendChild(title);
    cube.appendChild(artist);

    // Click to play
    cube.onclick = () => {
        window.playTrack(track);
    };

    // Right-click context menu
    cube.oncontextmenu = (e) => {
        e.preventDefault();
        showContextMenu(e, track);
    };

    return cube;
}

function hideSearchHistory() {
    updateSearchViewVisibility();
}

// Filter Functions
function filterSettings(query) {
    const settingsSections = document.querySelectorAll('.settings-section');

    if (!query) {
        // Show all sections
        settingsSections.forEach(section => {
            section.style.display = 'block';
        });
        // Remove no results message if exists
        const settingsContainer = document.querySelector('.settings-container');
        const existingMessage = settingsContainer?.querySelector('.no-settings-results');
        if (existingMessage) {
            existingMessage.remove();
        }
        return;
    }

    const lowerQuery = query.toLowerCase();
    let visibleCount = 0;

    settingsSections.forEach(section => {
        const heading = section.querySelector('h3')?.textContent.toLowerCase() || '';
        const labels = Array.from(section.querySelectorAll('label')).map(l => l.textContent.toLowerCase());
        const descriptions = Array.from(section.querySelectorAll('.setting-description')).map(d => d.textContent.toLowerCase());
        const allText = [heading, ...labels, ...descriptions].join(' ');

        if (allText.includes(lowerQuery)) {
            section.style.display = 'block';
            visibleCount++;
        } else {
            section.style.display = 'none';
        }
    });

    // Show message if no results
    const settingsContainer = document.querySelector('.settings-container');
    const existingMessage = settingsContainer.querySelector('.no-settings-results');

    if (visibleCount === 0) {
        if (!existingMessage) {
            const noResults = document.createElement('div');
            noResults.className = 'empty-state no-settings-results';
            noResults.innerHTML = '<p>No settings found matching your search</p>';
            settingsContainer.appendChild(noResults);
        }
    } else {
        if (existingMessage) {
            existingMessage.remove();
        }
    }
}

// Expose functions to player.js
window.appAPI = {
    formatDuration,
    showError,
    showLoading,
    hideLoading
};

// Expose renderer functions for player.js
window.renderer = {
    downloadTrack,
    toggleLike,
    getStreamQuality
};

// Expose ipcRenderer for player.js
window.ipcRenderer = ipcRenderer;

// Play All Functions
async function playAllDownloads() {
    try {
        const result = await ipcRenderer.invoke('db-get-downloads');
        if (result.success && result.data.length > 0) {
            result.data.forEach(track => track.downloaded = true);
            const enrichResult = await ipcRenderer.invoke('enrich-tracks', result.data);
            const tracks = enrichResult.success ? enrichResult.data : result.data;

            window.playContext({
                type: 'downloads',
                name: 'Downloads',
                tracks: tracks,
                startIndex: 0,
                shuffle: false
            });

            showInfo('Playing all downloads');
        } else {
            showInfo('No downloads to play');
        }
    } catch (error) {
        console.error('Play all downloads error:', error);
        showError('Failed to play downloads');
    }
}

async function playAllLiked() {
    try {
        const result = await ipcRenderer.invoke('db-get-liked');
        if (result.success && result.data.length > 0) {
            const enrichResult = await ipcRenderer.invoke('enrich-tracks', result.data);
            const tracks = enrichResult.success ? enrichResult.data : result.data;

            window.playContext({
                type: 'liked',
                name: 'Liked Songs',
                tracks: tracks,
                startIndex: 0,
                shuffle: false
            });

            showInfo('Playing all liked songs');
        } else {
            showInfo('No liked songs to play');
        }
    } catch (error) {
        console.error('Play all liked error:', error);
        showError('Failed to play liked songs');
    }
}

async function playAllPlaylist() {
    if (!currentPlaylistId) {
        showError('No playlist selected');
        return;
    }

    try {
        const result = await ipcRenderer.invoke('db-get-playlist-tracks', currentPlaylistId);
        if (result.success && result.data.length > 0) {
            const enrichResult = await ipcRenderer.invoke('enrich-tracks', result.data);
            const tracks = enrichResult.success ? enrichResult.data : result.data;

            window.playContext({
                type: 'playlist',
                id: currentPlaylistId,
                name: currentPlaylistName || 'Playlist',
                tracks: tracks,
                startIndex: 0,
                shuffle: false
            });

            showInfo(`Playing ${currentPlaylistName || 'playlist'}`);
        } else {
            showInfo('No tracks in playlist to play');
        }
    } catch (error) {
        console.error('Play all playlist error:', error);
        showError('Failed to play playlist');
    }
}

// Download All Functions
async function downloadAllLiked() {
    if (!backendReady) {
        showError('Backend is still initializing...');
        return;
    }

    try {
        const result = await ipcRenderer.invoke('db-get-liked');
        if (result.success && result.data && result.data.length > 0) {
            const tracks = result.data;
            let addedCount = 0;
            let skippedCount = 0;

            for (const track of tracks) {
                // Skip if already downloaded
                if (track.downloaded || track.is_downloaded) {
                    skippedCount++;
                    continue;
                }

                try {
                    const downloadResult = await ipcRenderer.invoke('download-track', {
                        video_id: track.youtube_id,
                        title: track.title,
                        artist: track.artist_name || track.artist || track.uploader,
                        duration: track.duration,
                        quality: getDownloadQuality()
                    });

                    if (downloadResult.success) {
                        addedCount++;
                    }
                } catch (error) {
                    console.error(`Failed to download track: ${track.title}`, error);
                }
            }

            if (addedCount > 0) {
                showInfo(`Added ${addedCount} liked song(s) to download queue${skippedCount > 0 ? ` (${skippedCount} already downloaded)` : ''}`);
            } else if (skippedCount > 0) {
                showInfo('All liked songs are already downloaded');
            } else {
                showError('No tracks could be added to download queue');
            }
        } else {
            showError('No liked songs to download');
        }
    } catch (error) {
        console.error('Failed to download all liked:', error);
        showError('Failed to download liked songs');
    }
}

async function downloadAllPlaylist() {
    if (!backendReady) {
        showError('Backend is still initializing...');
        return;
    }

    if (!currentPlaylistId) {
        showError('No playlist selected');
        return;
    }

    try {
        const result = await ipcRenderer.invoke('db-get-playlist-tracks', currentPlaylistId);
        if (result.success && result.data && result.data.length > 0) {
            const tracks = result.data;
            let addedCount = 0;
            let skippedCount = 0;

            for (const track of tracks) {
                // Skip if already downloaded
                if (track.downloaded || track.is_downloaded) {
                    skippedCount++;
                    continue;
                }

                try {
                    const downloadResult = await ipcRenderer.invoke('download-track', {
                        video_id: track.youtube_id,
                        title: track.title,
                        artist: track.artist_name || track.artist || track.uploader,
                        duration: track.duration,
                        quality: getDownloadQuality()
                    });

                    if (downloadResult.success) {
                        addedCount++;
                    }
                } catch (error) {
                    console.error(`Failed to download track: ${track.title}`, error);
                }
            }

            if (addedCount > 0) {
                showInfo(`Added ${addedCount} track(s) from "${currentPlaylistName || 'playlist'}" to download queue${skippedCount > 0 ? ` (${skippedCount} already downloaded)` : ''}`);
            } else if (skippedCount > 0) {
                showInfo(`All tracks from "${currentPlaylistName || 'playlist'}" are already downloaded`);
            } else {
                showError('No tracks could be added to download queue');
            }
        } else {
            showError('Playlist is empty or could not be loaded');
        }
    } catch (error) {
        console.error('Failed to download playlist:', error);
        showError('Failed to download playlist');
    }
}

// View Context Menu Functions
function showViewContextMenu(event, viewType) {
    event.preventDefault();
    event.stopPropagation();

    // Close all menus first
    document.querySelectorAll('.context-menu').forEach(menu => {
        menu.classList.remove('visible');
    });

    let menuElement;

    if (viewType === 'downloads') {
        menuElement = document.getElementById('downloads-view-menu');
    } else if (viewType === 'liked') {
        menuElement = document.getElementById('liked-view-menu');
    } else {
        return;
    }

    // First show menu to calculate its dimensions
    menuElement.classList.add('visible');

    // Get menu dimensions
    const menuWidth = menuElement.offsetWidth;
    const menuHeight = menuElement.offsetHeight;

    // Get viewport dimensions
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Calculate position
    let left = event.pageX;
    let top = event.pageY;

    // Adjust if menu would go beyond right edge
    if (left + menuWidth > viewportWidth) {
        left = viewportWidth - menuWidth - 10;
    }

    // Adjust if menu would go beyond bottom edge
    if (top + menuHeight > viewportHeight) {
        top = viewportHeight - menuHeight - 10;
    }

    // Ensure menu stays within left and top boundaries
    left = Math.max(10, left);
    top = Math.max(10, top);

    menuElement.style.left = left + 'px';
    menuElement.style.top = top + 'px';

    // Store view type for handler
    menuElement.dataset.viewType = viewType;

    // Add click listener to menu items
    const handleMenuClick = (e) => {
        const action = e.target.dataset.action;
        if (action) {
            handleViewContextMenuAction(viewType, action);
            menuElement.classList.remove('visible');
        }
    };

    // Remove old listener if exists
    menuElement.removeEventListener('click', menuElement._clickHandler);
    menuElement._clickHandler = handleMenuClick;
    menuElement.addEventListener('click', handleMenuClick);

    // Close menu when clicking outside
    const closeMenu = (e) => {
        if (!menuElement.contains(e.target) && e.target !== event.target) {
            menuElement.classList.remove('visible');
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

function handleViewContextMenuAction(viewType, action) {
    // Close the menu
    document.getElementById('downloads-view-menu')?.classList.remove('visible');
    document.getElementById('liked-view-menu')?.classList.remove('visible');

    if (viewType === 'downloads') {
        if (action === 'play-all') {
            playAllDownloads();
        } else if (action === 'shuffle') {
            shufflePlay('downloads');
        } else if (action === 'remove-all') {
            removeAllDownloads();
        }
    } else if (viewType === 'liked') {
        if (action === 'play-all') {
            playAllLiked();
        } else if (action === 'shuffle') {
            shufflePlay('liked');
        } else if (action === 'download-all') {
            downloadAllLiked();
        } else if (action === 'unlike-all') {
            removeAllLiked();
        }
    }
}

// Update updateNavigationState to handle 3-dot menu icons
function updateNavigationState(view) {
    const theme = getCurrentTheme();
    const navItems = document.querySelectorAll('.nav-item');

    // Update all nav items
    navItems.forEach(n => {
        n.classList.remove('active');
        const icon = n.querySelector('.icon.theme-icon');
        if (icon) {
            const iconType = icon.dataset.icon;
            // Inactive icons: Black for light theme, White for dark theme
            const suffix = theme === 'light' ? 'Black' : 'White';
            icon.src = `../public/${iconType}${suffix}.png`;
        }

        // Update 3-dot menu icon for inactive nav items
        const menuBtn = n.querySelector('.nav-menu-btn img');
        if (menuBtn) {
            // Inactive: Black for light theme, White for dark theme
            menuBtn.src = theme === 'light' ? '../public/3dotBlack.png' : '../public/3dotWhite.png';
        }
    });

    // Activate the target nav item
    const targetNavItem = document.querySelector(`[data-view="${view}"]`);
    if (targetNavItem) {
        targetNavItem.classList.add('active');

        // Set active icon based on theme
        const activeIcon = targetNavItem.querySelector('.icon.theme-icon');
        if (activeIcon) {
            const iconType = activeIcon.dataset.icon;
            const activeIconSuffix = theme === 'light' ? 'White' : 'Black';
            activeIcon.src = `../public/${iconType}${activeIconSuffix}.png`;
        }

        // Update 3-dot menu icon for active nav item
        const activeMenuBtn = targetNavItem.querySelector('.nav-menu-btn img');
        if (activeMenuBtn) {
            // Active: White for light theme (black bg), Black for dark theme (white bg)
            activeMenuBtn.src = theme === 'light' ? '../public/3dotWhite.png' : '../public/3dotBlack.png';
        }
    }

    // Clear playlist selection
    document.querySelectorAll('.playlist-item').forEach(p =>
        p.classList.remove('active')
    );
}

// Handle deletion checks from main process
ipcRenderer.on('check-if-playing', (event, youtubeId) => {
    const isPlaying = window.player &&
        window.player.currentTrack &&
        window.player.currentTrack.youtube_id === youtubeId &&
        window.player.isPlaying;

    ipcRenderer.send('check-if-playing-response', isPlaying);
});

ipcRenderer.on('stop-track-for-deletion', (event, youtubeId) => {
    if (window.player &&
        window.player.currentTrack &&
        window.player.currentTrack.youtube_id === youtubeId) {
        // Stop playback and move to next track or clear
        if (window.player.hasNext()) {
            window.player.playNext();
        } else {
            window.player.pause();
            window.player.audio.src = '';
            window.player.currentTrack = null;
            window.player.updatePlayerUI();
        }
    }
});

// ================================
// Directory Settings Management
// ================================

let currentSettings = {
    downloadDirectory: '',
    databaseDirectory: ''
};

// Load directory settings from main process
async function loadDirectorySettings() {
    try {
        const result = await ipcRenderer.invoke('get-settings');
        if (result.success) {
            currentSettings = result.settings;
            const defaults = result.defaults;

            // Update UI
            const downloadInput = document.getElementById('download-directory-input');
            const databaseInput = document.getElementById('database-directory-input');

            if (downloadInput) {
                downloadInput.value = currentSettings.downloadDirectory || defaults.downloadDirectory;
                downloadInput.title = currentSettings.downloadDirectory || defaults.downloadDirectory;
            }

            if (databaseInput) {
                databaseInput.value = currentSettings.databaseDirectory || defaults.databaseDirectory;
                databaseInput.title = currentSettings.databaseDirectory || defaults.databaseDirectory;
            }
        }
    } catch (error) {
        console.error('Failed to load directory settings:', error);
    }
}

// Browse for download directory
async function browseDownloadDirectory() {
    try {
        const result = await ipcRenderer.invoke('browse-directory', {
            title: 'Select Download Directory',
            defaultPath: currentSettings.downloadDirectory
        });

        if (result.success && !result.canceled) {
            currentSettings.downloadDirectory = result.path;
            await saveDirectorySettings();
            await loadDirectorySettings();
            showNotification('Download directory updated successfully');
        }
    } catch (error) {
        console.error('Failed to browse download directory:', error);
        showNotification('Failed to update download directory', 'error');
    }
}

// Browse for database directory
async function browseDatabaseDirectory() {
    try {
        const result = await ipcRenderer.invoke('browse-directory', {
            title: 'Select Database Directory',
            defaultPath: currentSettings.databaseDirectory
        });

        if (result.success && !result.canceled) {
            currentSettings.databaseDirectory = result.path;
            await saveDirectorySettings();
            await loadDirectorySettings();
            showNotification('Database directory updated. Please restart the app for changes to take effect.', 'warning');
        }
    } catch (error) {
        console.error('Failed to browse database directory:', error);
        showNotification('Failed to update database directory', 'error');
    }
}

// Reset download directory to default
async function resetDownloadDirectory() {
    try {
        const result = await ipcRenderer.invoke('get-settings');
        if (result.success) {
            currentSettings.downloadDirectory = result.defaults.downloadDirectory;
            await saveDirectorySettings();
            await loadDirectorySettings();
            showNotification('Download directory reset to default');
        }
    } catch (error) {
        console.error('Failed to reset download directory:', error);
        showNotification('Failed to reset download directory', 'error');
    }
}

// Reset database directory to default
async function resetDatabaseDirectory() {
    try {
        const result = await ipcRenderer.invoke('get-settings');
        if (result.success) {
            currentSettings.databaseDirectory = result.defaults.databaseDirectory;
            await saveDirectorySettings();
            await loadDirectorySettings();
            showNotification('Database directory reset. Please restart the app for changes to take effect.', 'warning');
        }
    } catch (error) {
        console.error('Failed to reset database directory:', error);
        showNotification('Failed to reset database directory', 'error');
    }
}

// Save directory settings
async function saveDirectorySettings() {
    try {
        const result = await ipcRenderer.invoke('update-settings', currentSettings);
        if (!result.success) {
            throw new Error(result.error || 'Failed to save settings');
        }
    } catch (error) {
        console.error('Failed to save directory settings:', error);
        throw error;
    }
}

// Simple notification function
function showNotification(message, type = 'success') {
    // You can enhance this with a proper notification UI later
    console.log(`[${type.toUpperCase()}] ${message}`);

    // For now, just show an alert for important messages
    if (type === 'warning' || type === 'error') {
        alert(message);
    }
}

// ================================
// Playback Settings Management
// ================================

// Default playback settings
const defaultPlaybackSettings = {
    autoplay: false,
    defaultVolume: 70,
    crossfadeDuration: 0,
    gapless: false
};

let playbackSettings = { ...defaultPlaybackSettings };

// Load playback settings from localStorage
function loadPlaybackSettings() {
    try {
        const saved = localStorage.getItem('playbackSettings');
        if (saved) {
            playbackSettings = { ...defaultPlaybackSettings, ...JSON.parse(saved) };
        }

        // Update UI
        const autoplayToggle = document.getElementById('toggle-autoplay');
        if (autoplayToggle) {
            if (playbackSettings.autoplay) {
                autoplayToggle.classList.add('active');
            }
        }

        const gaplessToggle = document.getElementById('toggle-gapless');
        if (gaplessToggle) {
            if (playbackSettings.gapless) {
                gaplessToggle.classList.add('active');
            }
        }

        const volumeSlider = document.getElementById('volume-slider');
        const volumeValue = document.getElementById('volume-value');
        if (volumeSlider && volumeValue) {
            volumeSlider.value = playbackSettings.defaultVolume;
            volumeValue.textContent = playbackSettings.defaultVolume + '%';
        }

        const crossfadeSlider = document.getElementById('crossfade-slider');
        const crossfadeValue = document.getElementById('crossfade-value');
        if (crossfadeSlider && crossfadeValue) {
            crossfadeSlider.value = playbackSettings.crossfadeDuration;
            crossfadeValue.textContent = playbackSettings.crossfadeDuration + 's';
        }

        // Apply default volume to player if available
        if (window.player && window.player.audio) {
            window.player.audio.volume = playbackSettings.defaultVolume / 100;
        }

        // Handle autoplay on startup
        if (playbackSettings.autoplay) {
            handleAutoplay();
        }
    } catch (error) {
        console.error('Failed to load playback settings:', error);
    }
}

// Save individual playback setting
function savePlaybackSetting(key, value) {
    try {
        playbackSettings[key] = value;
        localStorage.setItem('playbackSettings', JSON.stringify(playbackSettings));
        console.log(`Playback setting saved: ${key} = ${value}`);
    } catch (error) {
        console.error('Failed to save playback setting:', error);
    }
}

// Handle autoplay on startup
async function handleAutoplay() {
    try {
        // Wait a bit for player to be ready
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (!window.player) return;

        // Get last played track from localStorage
        const lastTrackId = localStorage.getItem('lastPlayedTrackId');
        const lastPosition = parseFloat(localStorage.getItem('lastPlayedPosition') || '0');

        if (lastTrackId) {
            // Try to find track in database
            const track = await ipcRenderer.invoke('db-get-track-by-youtube-id', lastTrackId);
            if (track) {
                // Resume playback
                await window.player.loadAndPlayTrack(track);
                if (lastPosition > 0 && window.player.audio) {
                    window.player.audio.currentTime = lastPosition;
                }
            }
        }
    } catch (error) {
        console.error('Autoplay failed:', error);
    }
}

// Export playback settings for use in player
function getPlaybackSettings() {
    return playbackSettings;
}

// Make it globally accessible
window.getPlaybackSettings = getPlaybackSettings;
