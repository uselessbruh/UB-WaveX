// UB-WaveX Audio Player Engine

class AudioPlayer {
    constructor() {
        this.audio = document.getElementById('audio-player');

        // Safety check
        if (!this.audio) {
            console.error('Audio player element not found!');
            return;
        }

        this.currentTrack = null;
        this.queue = [];
        this.queueIndex = -1;
        this.preloadCache = new Map(); // Cache for preloaded tracks (max 5 or 30 mins)
        this.maxPreloadTracks = 5;
        this.maxPreloadDuration = 1800; // 30 minutes in seconds
        this.isPlaying = false;

        // Playback context tracking
        this.playbackContext = {
            type: null, // 'online', 'playlist', 'liked', 'downloads'
            id: null, // playlist ID if applicable
            name: null, // Display name (e.g., playlist name)
            tracks: [], // Full list of tracks in current context
            shuffle: false // Shuffle state
        };

        // Shuffle state
        this.shuffledIndices = [];
        this.originalQueue = [];

        // DOM elements
        this.btnPlayPause = document.getElementById('btn-play-pause');
        this.btnPrevious = document.getElementById('btn-previous');
        this.btnNext = document.getElementById('btn-next');
        this.seekBar = document.getElementById('seek-bar');
        this.volumeBar = document.getElementById('volume-bar');
        this.currentTimeEl = document.getElementById('current-time');
        this.totalTimeEl = document.getElementById('total-time');
        this.playerTitle = document.getElementById('player-title');
        this.playerArtist = document.getElementById('player-artist');

        this.setupEventListeners();
        this.loadVolume();
    }

    setupEventListeners() {
        // Play/Pause
        this.btnPlayPause.addEventListener('click', () => this.togglePlayPause());

        // Previous/Next
        this.btnPrevious.addEventListener('click', () => this.playPrevious());
        this.btnNext.addEventListener('click', () => this.playNext());

        // Skip 10 seconds forward/backward
        const btnForward10 = document.getElementById('btn-forward-10');
        const btnBackward10 = document.getElementById('btn-backward-10');

        if (btnForward10) {
            btnForward10.addEventListener('click', () => this.skip(10));
        }

        if (btnBackward10) {
            btnBackward10.addEventListener('click', () => this.skip(-10));
        }

        // Volume button (mute/unmute)
        const btnVolume = document.getElementById('btn-volume');
        if (btnVolume) {
            btnVolume.addEventListener('click', () => this.toggleMute());
        }

        // Seek
        this.seekBar.addEventListener('input', (e) => {
            const time = (e.target.value / 100) * this.audio.duration;
            this.audio.currentTime = time;

            // Update visual immediately - only show black if progress > 0
            const progress = e.target.value;
            if (progress > 0) {
                this.seekBar.style.background = `linear-gradient(to right, #000 0%, #000 ${progress}%, var(--bg-tertiary) ${progress}%, var(--bg-tertiary) 100%)`;
            } else {
                this.seekBar.style.background = 'var(--bg-tertiary)';
            }
        });

        // Initially disable seek bar
        this.seekBar.disabled = true;
        this.seekBar.value = 0;
        this.seekBar.style.background = 'var(--bg-tertiary)';

        // Volume
        this.volumeBar.addEventListener('input', (e) => {
            this.audio.volume = e.target.value / 100;

            // Update visual - hide black fill when volume is 0
            if (e.target.value == 0) {
                this.volumeBar.classList.add('muted');
            } else {
                this.volumeBar.classList.remove('muted');
            }

            this.saveVolume();
            this.updateVolumeIcon();
        });

        // Audio events
        this.audio.addEventListener('timeupdate', () => {
            this.updateProgress();
            // Save state periodically (every 2 seconds)
            if (!this.saveStateTimeout) {
                this.saveStateTimeout = setTimeout(() => {
                    this.savePlaybackState();
                    this.saveStateTimeout = null;
                }, 2000);
            }
        });
        this.audio.addEventListener('ended', () => this.onTrackEnded());
        this.audio.addEventListener('play', () => this.onPlay());
        this.audio.addEventListener('pause', () => this.onPause());
        this.audio.addEventListener('error', (e) => this.onError(e));
        this.audio.addEventListener('loadedmetadata', () => this.onMetadataLoaded());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
                e.preventDefault();
                this.togglePlayPause();
            } else if (e.code === 'ArrowRight' && e.target.tagName !== 'INPUT') {
                e.preventDefault();
                this.skip(10);
            } else if (e.code === 'ArrowLeft' && e.target.tagName !== 'INPUT') {
                e.preventDefault();
                this.skip(-10);
            }
        });
    }

    async playTrack(track) {
        // Single track playback (from search/online) - no auto-play next
        this.playbackContext = {
            type: 'online',
            id: null,
            name: null,
            tracks: [track],
            shuffle: false
        };
        this.queue = [track];
        this.queueIndex = 0;
        await this.loadAndPlayTrack(track);
        this.updatePlaybackSourceUI();
    }

    async playQueue(tracks, startIndex = 0) {
        // Play a list of tracks as a queue (deprecated - use playContext instead)
        this.queue = tracks;
        this.queueIndex = startIndex;
        await this.loadAndPlayTrack(tracks[startIndex]);

        // Preload upcoming tracks
        this.preloadUpcomingTracks();
    }

    async playContext(context) {
        // Play from a specific context (playlist, liked, downloads)
        // context = { type: 'playlist'|'liked'|'downloads', id, name, tracks, startIndex, shuffle }
        this.playbackContext = {
            type: context.type,
            id: context.id || null,
            name: context.name || this.getContextDisplayName(context.type),
            tracks: context.tracks || [],
            shuffle: context.shuffle || false
        };

        // Setup queue based on shuffle
        if (context.shuffle) {
            this.enableShuffle(context.tracks, context.startIndex || 0);
        } else {
            this.queue = [...context.tracks];
            this.queueIndex = context.startIndex || 0;
        }

        if (this.queue.length > 0) {
            await this.loadAndPlayTrack(this.queue[this.queueIndex]);
            this.preloadUpcomingTracks();
            this.updatePlaybackSourceUI();
        }
    }

    getContextDisplayName(type) {
        switch (type) {
            case 'liked': return 'Liked Songs';
            case 'downloads': return 'Downloads';
            case 'online': return null;
            default: return null;
        }
    }

    enableShuffle(tracks, currentIndex = 0) {
        // Create shuffled indices array
        this.originalQueue = [...tracks];
        const currentTrack = tracks[currentIndex];

        // Create array of all indices except current
        const indices = tracks.map((_, i) => i).filter(i => i !== currentIndex);

        // Fisher-Yates shuffle
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
        }

        // Put current track first, then shuffled tracks
        this.shuffledIndices = [currentIndex, ...indices];
        this.queue = this.shuffledIndices.map(i => tracks[i]);
        this.queueIndex = 0; // Current track is now at index 0
        this.playbackContext.shuffle = true;
    }

    disableShuffle() {
        if (this.originalQueue.length > 0 && this.currentTrack) {
            // Find current track in original queue
            const currentIndex = this.originalQueue.findIndex(
                t => t.youtube_id === this.currentTrack.youtube_id
            );

            this.queue = [...this.originalQueue];
            this.queueIndex = currentIndex >= 0 ? currentIndex : 0;
            this.playbackContext.shuffle = false;
            this.shuffledIndices = [];
            this.originalQueue = [];
        }
    }

    toggleShuffle() {
        if (this.playbackContext.shuffle) {
            this.disableShuffle();
        } else if (this.playbackContext.tracks.length > 0) {
            this.enableShuffle(this.playbackContext.tracks, this.queueIndex);
        }
        this.updatePlaybackSourceUI();
        return this.playbackContext.shuffle;
    }

    async loadAndPlayTrack(track) {
        try {
            console.log('Loading track:', track);
            this.currentTrack = track;
            this.updatePlayerUI(track);

            // Check if track is downloaded
            if (track.file_path && track.downloaded) {
                // Play local file
                console.log('Playing local file:', track.file_path);
                this.audio.src = `file:///${track.file_path.replace(/\\/g, '/')}`;
            } else {
                // Check preload cache
                if (this.preloadCache.has(track.youtube_id)) {
                    const cachedData = this.preloadCache.get(track.youtube_id);
                    console.log('Using preloaded stream URL');
                    this.audio.src = cachedData.url;
                } else {
                    // Get stream URL
                    console.log('Fetching stream URL for:', track.youtube_id);
                    window.appAPI.showLoading('Loading track...');
                    const result = await window.ipcRenderer.invoke('get-stream-url', track.youtube_id);
                    window.appAPI.hideLoading();

                    console.log('Stream URL result:', result);

                    if (result.success) {
                        this.audio.src = result.data.url;
                        console.log('Set audio source to:', result.data.url);

                        // Update track info with resolved metadata
                        if (result.data.title) track.title = result.data.title;
                        if (result.data.artist) track.artist = result.data.artist;

                        this.updatePlayerUI(track);
                    } else {
                        throw new Error(result.error);
                    }
                }
            }

            // Play
            console.log('Attempting to play audio...');
            await this.audio.play();
            console.log('Audio playing');

            // Mark track as playing in UI
            this.markTrackAsPlaying(track);

            // Save playback state
            this.savePlaybackState();

        } catch (error) {
            console.error('Playback error:', error);
            window.appAPI.showError(`Failed to play track: ${error.message}`);
        }
    }

    async preloadUpcomingTracks() {
        // Preload next tracks in queue (up to maxPreloadTracks or maxPreloadDuration)
        const tracksToPreload = [];
        let totalDuration = 0;

        for (let i = 1; i <= this.maxPreloadTracks && (this.queueIndex + i) < this.queue.length; i++) {
            const track = this.queue[this.queueIndex + i];

            // Stop if we exceed 30 minutes
            if (totalDuration + (track.duration || 0) > this.maxPreloadDuration) {
                break;
            }

            // Skip if already cached or downloaded
            if (this.preloadCache.has(track.youtube_id) || track.downloaded) {
                continue;
            }

            tracksToPreload.push(track);
            totalDuration += track.duration || 0;
        }

        // Preload tracks in background
        for (const track of tracksToPreload) {
            try {
                const result = await window.ipcRenderer.invoke('get-stream-url', {
                    videoId: track.youtube_id,
                    quality: window.renderer?.getStreamQuality?.() || localStorage.getItem('streamQuality') || 'high'
                });

                if (result.success) {
                    // Add to cache
                    this.preloadCache.set(track.youtube_id, {
                        url: result.data.url,
                        track: track,
                        timestamp: Date.now(),
                        duration: track.duration || 0
                    });

                    // Maintain cache size limit
                    this.cleanupPreloadCache();
                }
            } catch (error) {
                console.error(`Failed to preload track ${track.youtube_id}:`, error);
            }
        }
    }

    cleanupPreloadCache() {
        // Keep only the most recent tracks within limits
        if (this.preloadCache.size > this.maxPreloadTracks) {
            const entries = Array.from(this.preloadCache.entries());

            // Calculate total duration
            let totalDuration = entries.reduce((sum, [, data]) => sum + (data.duration || 0), 0);

            // Sort by timestamp (oldest first)
            entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

            // Remove oldest entries if over limits
            while (entries.length > this.maxPreloadTracks || totalDuration > this.maxPreloadDuration) {
                const [key, data] = entries.shift();
                this.preloadCache.delete(key);
                totalDuration -= (data.duration || 0);
            }
        }
    }

    updatePlayerUI(track) {
        const title = track.title || 'Unknown Title';
        const artist = track.artist_name || track.artist || track.uploader || 'Unknown Artist';

        this.playerTitle.textContent = title;
        this.playerArtist.textContent = artist;

        // Enable seek bar when track is loaded
        this.seekBar.disabled = false;

        // Remove scrolling class first
        this.playerTitle.classList.remove('scrolling');

        // Add scrolling if title is long (check actual width)
        setTimeout(() => {
            const titleWidth = this.playerTitle.offsetWidth;
            const containerWidth = this.playerTitle.parentElement.offsetWidth;

            if (titleWidth > containerWidth) {
                // Duplicate text with separator for seamless scrolling
                this.playerTitle.textContent = title + '    •    ' + title + '    •    ' + title;
                this.playerTitle.classList.add('scrolling');
            }
        }, 100);
    }

    updatePlaybackSourceUI() {
        // Update UI to show where music is playing from
        const sourceElement = document.getElementById('playback-source');

        if (!sourceElement) {
            // Create source element if it doesn't exist
            const wrapper = document.querySelector('.player-title-wrapper');
            if (wrapper) {
                const source = document.createElement('div');
                source.id = 'playback-source';
                source.className = 'playback-source';
                wrapper.appendChild(source);
            }
        }

        const source = document.getElementById('playback-source');
        if (source) {
            if (this.playbackContext.type && this.playbackContext.type !== 'online') {
                let displayText = '';

                if (this.playbackContext.name) {
                    displayText = this.playbackContext.name;
                } else {
                    displayText = this.getContextDisplayName(this.playbackContext.type);
                }

                if (this.playbackContext.shuffle) {
                    displayText += ' • Shuffle';
                }

                source.textContent = displayText;
                source.style.display = 'block';
            } else {
                source.style.display = 'none';
            }
        }
    }

    markTrackAsPlaying(track) {
        // Remove playing class from all tracks
        document.querySelectorAll('.track-item.playing').forEach(el => {
            el.classList.remove('playing');
        });

        // Add playing class to current track
        const trackEl = document.querySelector(`[data-youtube-id="${track.youtube_id}"]`);
        if (trackEl) {
            trackEl.classList.add('playing');
        }
    }

    togglePlayPause() {
        if (this.isPlaying) {
            this.audio.pause();
        } else {
            if (this.audio.src) {
                this.audio.play();
            }
        }
    }

    async playNext() {
        if (this.queueIndex < this.queue.length - 1) {
            this.queueIndex++;
            await this.loadAndPlayTrack(this.queue[this.queueIndex]);

            // Preload more tracks
            this.preloadUpcomingTracks();
        }
    }

    async playPrevious() {
        if (this.audio.currentTime > 3) {
            // Restart current track if more than 3 seconds played
            this.audio.currentTime = 0;
        } else if (this.queueIndex > 0) {
            // Play previous track
            this.queueIndex--;
            await this.loadAndPlayTrack(this.queue[this.queueIndex]);
        }
    }

    addToQueue(track, playNext = false) {
        if (playNext && this.queueIndex >= 0) {
            // Insert after current track
            this.queue.splice(this.queueIndex + 1, 0, track);

            // If in shuffle mode, also update originalQueue
            if (this.playbackContext.shuffle && this.originalQueue.length > 0) {
                this.originalQueue.splice(this.queueIndex + 1, 0, track);
            }
        } else {
            // Add to end of queue
            this.queue.push(track);

            // If in shuffle mode, also update originalQueue
            if (this.playbackContext.shuffle && this.originalQueue.length > 0) {
                this.originalQueue.push(track);
            }
        }

        // Update context tracks if adding to an active context
        if (this.playbackContext.tracks.length > 0) {
            if (playNext) {
                this.playbackContext.tracks.splice(this.queueIndex + 1, 0, track);
            } else {
                this.playbackContext.tracks.push(track);
            }
        }
    }

    clearQueue() {
        this.queue = [];
        this.queueIndex = -1;
        this.preloadCache.clear();
    }

    // Event Handlers
    onPlay() {
        this.isPlaying = true;
        const playPauseIcon = this.btnPlayPause.querySelector('.play-pause-icon');
        if (playPauseIcon) {
            const theme = document.documentElement.hasAttribute('data-theme') ? 'light' : 'dark';
            const suffix = theme === 'light' ? 'Black' : 'White';
            playPauseIcon.src = `../public/pause${suffix}.png`;
            playPauseIcon.dataset.icon = 'pause';
            playPauseIcon.alt = 'Pause';
        }
    }

    onPause() {
        this.isPlaying = false;
        const playPauseIcon = this.btnPlayPause.querySelector('.play-pause-icon');
        if (playPauseIcon) {
            const theme = document.documentElement.hasAttribute('data-theme') ? 'light' : 'dark';
            const suffix = theme === 'light' ? 'Black' : 'White';
            playPauseIcon.src = `../public/play${suffix}.png`;
            playPauseIcon.dataset.icon = 'play';
            playPauseIcon.alt = 'Play';
        }
    }

    async onTrackEnded() {
        // Auto-play next track based on context
        if (this.playbackContext.type === 'online') {
            // Single track from search - don't auto-play
            this.isPlaying = false;
            const playPauseIcon = this.btnPlayPause.querySelector('.play-pause-icon');
            if (playPauseIcon) {
                const theme = document.documentElement.hasAttribute('data-theme') ? 'light' : 'dark';
                const suffix = theme === 'light' ? 'Black' : 'White';
                playPauseIcon.src = `../public/play${suffix}.png`;
                playPauseIcon.dataset.icon = 'play';
                playPauseIcon.alt = 'Play';
            }
        } else if (this.queueIndex < this.queue.length - 1) {
            // Auto-play next in context (playlist, liked, downloads, or custom queue)
            await this.playNext();
        } else {
            // Queue finished
            this.isPlaying = false;
            const playPauseIcon = this.btnPlayPause.querySelector('.play-pause-icon');
            if (playPauseIcon) {
                const theme = document.documentElement.hasAttribute('data-theme') ? 'light' : 'dark';
                const suffix = theme === 'light' ? 'Black' : 'White';
                playPauseIcon.src = `../public/play${suffix}.png`;
                playPauseIcon.dataset.icon = 'play';
                playPauseIcon.alt = 'Play';
            }
        }
    }

    onError(error) {
        console.error('Audio playback error:', error);
        window.appAPI.showError('Playback error occurred');
    }

    onMetadataLoaded() {
        this.totalTimeEl.textContent = window.appAPI.formatDuration(this.audio.duration);
    }

    updateProgress() {
        if (this.audio.duration) {
            const progress = (this.audio.currentTime / this.audio.duration) * 100;
            this.seekBar.value = progress;

            // Update visual progress - only show black if progress > 0
            if (progress > 0) {
                this.seekBar.style.background = `linear-gradient(to right, #000 0%, #000 ${progress}%, var(--bg-tertiary) ${progress}%, var(--bg-tertiary) 100%)`;
            } else {
                this.seekBar.style.background = 'var(--bg-tertiary)';
            }

            this.currentTimeEl.textContent = window.appAPI.formatDuration(this.audio.currentTime);
        }
    }

    skip(seconds) {
        if (this.audio.src && this.audio.duration) {
            const newTime = Math.max(0, Math.min(this.audio.currentTime + seconds, this.audio.duration));
            this.audio.currentTime = newTime;
        }
    }

    toggleMute() {
        if (this.audio.volume > 0) {
            this.previousVolume = this.audio.volume;
            this.audio.volume = 0;
            this.volumeBar.value = 0;
            this.volumeBar.classList.add('muted');
        } else {
            this.audio.volume = this.previousVolume || 1;
            this.volumeBar.value = (this.previousVolume || 1) * 100;
            this.volumeBar.classList.remove('muted');
        }
        this.updateVolumeIcon();
    }

    updateVolumeIcon() {
        const btnVolume = document.getElementById('btn-volume');
        const volumeIcon = btnVolume?.querySelector('.volume-icon');
        if (volumeIcon) {
            const theme = document.documentElement.hasAttribute('data-theme') ? 'light' : 'dark';
            const suffix = theme === 'light' ? 'Black' : 'White';

            if (this.audio.volume === 0) {
                volumeIcon.src = `../public/mute${suffix}.png`;
                volumeIcon.dataset.icon = 'mute';
                volumeIcon.alt = 'Muted';
            } else if (this.audio.volume < 0.33) {
                volumeIcon.src = `../public/vol1${suffix}.png`;
                volumeIcon.dataset.icon = 'vol1';
                volumeIcon.alt = 'Low Volume';
            } else if (this.audio.volume < 0.66) {
                volumeIcon.src = `../public/vol2${suffix}.png`;
                volumeIcon.dataset.icon = 'vol2';
                volumeIcon.alt = 'Medium Volume';
            } else {
                volumeIcon.src = `../public/vol3${suffix}.png`;
                volumeIcon.dataset.icon = 'vol3';
                volumeIcon.alt = 'High Volume';
            }
        }
    }

    // Volume persistence
    loadVolume() {
        const savedVolume = localStorage.getItem('playerVolume');
        if (savedVolume !== null) {
            this.audio.volume = parseFloat(savedVolume);
            this.volumeBar.value = parseFloat(savedVolume) * 100;
        }

        // Add muted class if volume is 0
        if (this.audio.volume === 0) {
            this.volumeBar.classList.add('muted');
        }

        this.updateVolumeIcon();
    }

    saveVolume() {
        localStorage.setItem('playerVolume', this.audio.volume.toString());
    }

    // Save current playback state
    savePlaybackState() {
        if (this.currentTrack) {
            const state = {
                track: this.currentTrack,
                currentTime: this.audio.currentTime || 0,
                isPlaying: this.isPlaying,
                queue: this.queue,
                queueIndex: this.queueIndex
            };
            localStorage.setItem('lastPlaybackState', JSON.stringify(state));
            console.log('Saved playback state:', state);
        }
    }

    // Load and restore playback state
    async loadPlaybackState() {
        const savedState = localStorage.getItem('lastPlaybackState');
        if (savedState) {
            try {
                const state = JSON.parse(savedState);
                console.log('Restoring playback state:', state);

                // Restore queue
                this.queue = state.queue || [];
                this.queueIndex = state.queueIndex || 0;

                // Load the track
                await this.loadAndPlayTrack(state.track);

                // Seek to saved position
                if (state.currentTime > 0) {
                    this.audio.currentTime = state.currentTime;
                }

                // If it wasn't playing, pause it
                if (!state.isPlaying) {
                    this.audio.pause();
                }

            } catch (error) {
                console.error('Failed to restore playback state:', error);
            }
        }
    }
}

// Initialize player when DOM is ready
let player;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        player = new AudioPlayer();
        exposePlayerFunctions();
        // Restore last playback state
        setTimeout(() => player.loadPlaybackState(), 1000);
    });
} else {
    player = new AudioPlayer();
    exposePlayerFunctions();
    // Restore last playback state
    setTimeout(() => player.loadPlaybackState(), 1000);
}

function exposePlayerFunctions() {
    // Expose player functions globally
    window.player = player;
    window.playTrack = (track) => player.playTrack(track);
    window.playQueue = (tracks, startIndex = 0) => player.playQueue(tracks, startIndex);
    window.playContext = (context) => player.playContext(context);
    window.addToQueue = (track, playNext = false) => player.addToQueue(track, playNext);
    window.toggleShuffle = () => player.toggleShuffle();
}
