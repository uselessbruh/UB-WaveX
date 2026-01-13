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
        this.preloadCache = new Map(); // Cache for preloaded tracks (max 5)
        this.maxPreloadTracks = 5;
        this.isPlaying = false;

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
        // Clear queue and start single track playback
        this.queue = [track];
        this.queueIndex = 0;
        await this.loadAndPlayTrack(track);
    }

    async playQueue(tracks, startIndex = 0) {
        // Play a list of tracks as a queue
        this.queue = tracks;
        this.queueIndex = startIndex;
        await this.loadAndPlayTrack(tracks[startIndex]);

        // Preload upcoming tracks
        this.preloadUpcomingTracks();
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
        // Preload next tracks in queue (up to maxPreloadTracks)
        const tracksToPreload = [];

        for (let i = 1; i <= this.maxPreloadTracks && (this.queueIndex + i) < this.queue.length; i++) {
            const track = this.queue[this.queueIndex + i];

            // Skip if already cached or downloaded
            if (this.preloadCache.has(track.youtube_id) || track.downloaded) {
                continue;
            }

            tracksToPreload.push(track);
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
                        timestamp: Date.now()
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
        // Keep only the most recent maxPreloadTracks
        if (this.preloadCache.size > this.maxPreloadTracks) {
            const entries = Array.from(this.preloadCache.entries());
            entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

            // Remove oldest entries
            const toRemove = entries.slice(0, entries.length - this.maxPreloadTracks);
            toRemove.forEach(([key]) => this.preloadCache.delete(key));
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
        } else {
            // Add to end of queue
            this.queue.push(track);
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
        // Auto-play next track in queue
        if (this.queueIndex < this.queue.length - 1) {
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
    window.addToQueue = (track, playNext = false) => player.addToQueue(track, playNext);
}
