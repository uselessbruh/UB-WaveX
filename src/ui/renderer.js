// UB-WaveX Renderer Process
const { ipcRenderer } = require('electron');

// State
let currentView = 'search';
let currentPlaylistId = null;
let backendReady = false;

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

    // Load saved theme
    loadTheme();
    loadQuality();
    loadStreamQuality();

    // Context Menu
    document.addEventListener('click', () => {
        contextMenu.classList.remove('visible');
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

                // Update active state
                navItems.forEach(n => n.classList.remove('active'));
                item.classList.add('active');

                // Clear playlist selection
                document.querySelectorAll('.playlist-item').forEach(p =>
                    p.classList.remove('active')
                );
            }
        });
    });
}

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

    // Perform music search
    performSearch();
}

// Search
async function performSearch() {
    const query = searchInput.value.trim();
    if (!query) return;

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

    // Enrich tracks with liked/downloaded status from database
    const enrichResult = await ipcRenderer.invoke('enrich-tracks', tracks);
    const enrichedTracks = enrichResult.success ? enrichResult.data : tracks;

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
            toggleLike(track);
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
    btnMenu.innerHTML = '⋮'; // Vertical ellipsis character
    btnMenu.style.fontSize = '20px';
    btnMenu.style.fontWeight = 'bold';
    btnMenu.style.color = 'var(--text-secondary)';

    btnMenu.onclick = (e) => {
        e.stopPropagation();
        showContextMenu(e, track);
    };
    actions.appendChild(btnMenu);

    div.appendChild(info);
    div.appendChild(duration);
    div.appendChild(actions);

    // Click to play
    div.onclick = () => {
        window.playTrack(track);
    };

    // Right-click context menu
    div.oncontextmenu = (e) => {
        e.preventDefault();
        showContextMenu(e, track);
    };

    return div;
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

            displayTracks(downloadsList, enrichedTracks);
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

            displayTracks(likedList, enrichedTracks);
        }
    } catch (error) {
        console.error('Failed to load liked songs:', error);
    }
}

async function toggleLike(track) {
    try {
        const trackId = track.id || await getOrCreateTrackId(track);
        const result = await ipcRenderer.invoke('db-toggle-like', trackId);

        if (result.success) {
            // Update UI
            track.liked = result.liked;

            // Update the like button icon in all track items with this track
            document.querySelectorAll(`.track-item[data-youtube-id="${track.youtube_id}"]`).forEach(trackEl => {
                const likeBtn = trackEl.querySelector('.btn-track-action');
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
            displayPlaylists(result.data);
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

        const menuBtn = document.createElement('button');
        menuBtn.className = 'playlist-menu-btn';
        menuBtn.title = 'Playlist options';
        menuBtn.innerHTML = '⋮'; // Vertical ellipsis character
        menuBtn.style.fontSize = '18px';
        menuBtn.style.fontWeight = 'bold';

        menuBtn.onclick = (e) => {
            e.stopPropagation();
            showPlaylistContextMenu(e, playlist);
        };

        div.appendChild(nameSpan);
        div.appendChild(menuBtn);

        div.onclick = () => {
            document.querySelectorAll('.playlist-item').forEach(p =>
                p.classList.remove('active')
            );
            div.classList.add('active');
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
    dialog.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 1000;';

    const form = document.createElement('div');
    form.style.cssText = 'background: #181818; padding: 20px; border-radius: 8px; min-width: 300px;';

    const title = document.createElement('h3');
    title.textContent = 'New Playlist';
    title.style.cssText = 'margin: 0 0 15px 0; color: #fff;';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Enter playlist name';
    input.style.cssText = 'width: 100%; padding: 8px; margin-bottom: 15px; background: #282828; border: 1px solid #404040; color: #fff; border-radius: 4px; font-size: 14px;';

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding: 8px 16px; background: #282828; color: #fff; border: none; border-radius: 4px; cursor: pointer;';

    const createBtn = document.createElement('button');
    createBtn.textContent = 'Create';
    createBtn.style.cssText = 'padding: 8px 16px; background: #1db954; color: #fff; border: none; border-radius: 4px; cursor: pointer;';

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
            const container = document.getElementById('playlist-tracks');
            displayTracks(container, result.data);
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

    if (!confirm(`Delete "${track.title}" from downloads?`)) {
        return;
    }

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

    // Save original content if not already saved
    if (!originalContextMenuContent) {
        originalContextMenuContent = contextMenu.innerHTML;
    }

    // Ensure track menu content is shown
    if (contextMenu.dataset.menuType === 'playlist') {
        contextMenu.innerHTML = originalContextMenuContent;
        delete contextMenu.dataset.menuType;
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
        case 'like':
            toggleLike(contextMenuTrack);
            break;
        case 'add-to-playlist':
            showAddToPlaylistDialog(contextMenuTrack);
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
    dialog.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 1000;';

    const form = document.createElement('div');
    form.style.cssText = 'background: var(--bg-secondary); padding: 20px; border-radius: 8px; min-width: 300px;';

    const title = document.createElement('h3');
    title.textContent = 'Rename Playlist';
    title.style.cssText = 'margin: 0 0 15px 0; color: var(--text-primary);';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = playlist.name;
    input.placeholder = 'Enter new playlist name';
    input.style.cssText = 'width: 100%; padding: 8px; margin-bottom: 15px; background: var(--bg-tertiary); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 4px; font-size: 14px;';

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
            const result = await ipcRenderer.invoke('db-update-playlist', playlist.id, { name: newName });
            if (result.success) {
                document.body.removeChild(dialog);
                loadPlaylists();
                showSuccess('Playlist renamed');
            } else {
                showError(`Failed to rename playlist: ${result.error}`);
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
    if (confirm(`Are you sure you want to delete the playlist "${playlist.name}"?`)) {
        const result = await ipcRenderer.invoke('db-delete-playlist', playlist.id);
        if (result.success) {
            loadPlaylists();
            if (currentPlaylistId === playlist.id) {
                switchView('search');
                document.querySelector('[data-view="search"]').classList.add('active');
            }
            showSuccess('Playlist deleted');
        } else {
            showError(`Failed to delete playlist: ${result.error}`);
        }
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

    // Build playlist menu HTML
    let playlistMenuHtml = '';
    playlists.forEach(playlist => {
        playlistMenuHtml += `<div class="context-menu-item" data-playlist-id="${playlist.id}">${playlist.name}</div>`;
    });

    // Save current menu state
    const wasPlaylistMenu = currentMenuType === 'playlist';
    const previousContent = contextMenu.innerHTML;

    // Set playlist selection menu
    contextMenu.innerHTML = playlistMenuHtml;
    contextMenu.dataset.menuType = 'playlist-selection';

    // Position near the mouse
    const rect = contextMenu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = Math.min(window.lastContextMenuX || window.innerWidth / 2, viewportWidth - 220);
    let top = Math.min(window.lastContextMenuY || window.innerHeight / 2, viewportHeight - (playlists.length * 40 + 20));

    left = Math.max(10, left);
    top = Math.max(10, top);

    contextMenu.style.left = left + 'px';
    contextMenu.style.top = top + 'px';
    contextMenu.classList.add('visible');

    // Handle playlist selection
    const handlePlaylistClick = async (e) => {
        const playlistId = e.target.dataset.playlistId;
        if (playlistId) {
            await addTrackToPlaylist(track, parseInt(playlistId));
            contextMenu.classList.remove('visible');

            // Restore previous menu content
            setTimeout(() => {
                contextMenu.innerHTML = wasPlaylistMenu ? playlistContextMenuHtml : (originalContextMenuContent || previousContent);
                delete contextMenu.dataset.menuType;
                contextMenu.removeEventListener('click', handlePlaylistClick);
            }, 200);
        }
    };

    contextMenu.addEventListener('click', handlePlaylistClick);

    // Close on outside click
    const closeHandler = (e) => {
        if (!contextMenu.contains(e.target)) {
            contextMenu.classList.remove('visible');
            setTimeout(() => {
                contextMenu.innerHTML = wasPlaylistMenu ? playlistContextMenuHtml : (originalContextMenuContent || previousContent);
                delete contextMenu.dataset.menuType;
                contextMenu.removeEventListener('click', handlePlaylistClick);
            }, 200);
            document.removeEventListener('click', closeHandler);
        }
    };

    setTimeout(() => {
        document.addEventListener('click', closeHandler);
    }, 100);
}

async function addTrackToPlaylist(track, playlistId) {
    try {
        // First, ensure the track exists in the database
        const trackId = track.id || await getOrCreateTrackId(track);

        // Add track to playlist
        const result = await ipcRenderer.invoke('db-add-track-to-playlist', playlistId, trackId);

        if (result.success) {
            showSuccess('Track added to playlist');

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
    // Check if track exists in database
    const checkResult = await ipcRenderer.invoke('db-get-track-by-youtube-id', track.youtube_id);

    if (checkResult.success && checkResult.data) {
        return checkResult.data.id;
    }

    // Track doesn't exist, create it
    const createResult = await ipcRenderer.invoke('db-create-track', {
        youtube_id: track.youtube_id,
        title: track.title,
        artist: track.artist_name || track.artist || track.uploader,
        duration: track.duration
    });

    if (createResult.success) {
        return createResult.data.id;
    }

    throw new Error('Failed to create track in database');
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
    alert(message); // TODO: Better error display
    console.error(message);
}

function showSuccess(message) {
    // TODO: Toast notification
    console.log(message);
}

function showInfo(message) {
    // TODO: Toast notification
    console.log('INFO:', message);
}

function showWarning(message) {
    // TODO: Toast notification
    console.warn('WARNING:', message);
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

async function getOrCreateTrackId(track) {
    // If track doesn't have an ID, we need to ensure it's in the database
    // This is handled by the Python core when getting stream URL
    return track.id;
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
            icon.src = getIconPath(iconName, theme);
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
