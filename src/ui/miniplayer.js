const { ipcRenderer } = require('electron');

// DOM elements
const miniTitle = document.getElementById('mini-title');
const miniArtist = document.getElementById('mini-artist');
const miniPlayPauseBtn = document.getElementById('mini-play-pause');
const miniPlayIcon = document.getElementById('mini-play-icon');
const miniPauseIcon = document.getElementById('mini-pause-icon');
const miniPrevBtn = document.getElementById('mini-prev');
const miniNextBtn = document.getElementById('mini-next');
const miniExpandBtn = document.getElementById('mini-expand');
const miniCloseBtn = document.getElementById('close-mini-player');
const miniProgressBar = document.getElementById('mini-progress-bar');
const miniProgressFill = document.getElementById('mini-progress-fill');
const miniCurrentTime = document.getElementById('mini-current-time');
const miniDuration = document.getElementById('mini-duration');

let isPlaying = false;
let currentTrack = null;

// Load theme from localStorage
function loadTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    applyTheme(savedTheme);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
    updateIcons(theme);
}

function updateIcons(theme) {
    const suffix = theme === 'light' ? 'Black' : 'White';

    // Update all theme icons
    document.querySelectorAll('.theme-icon').forEach(icon => {
        const iconType = icon.dataset.icon;
        if (iconType) {
            const newSrc = `../public/${iconType}${suffix}.png`;
            icon.src = newSrc;
        }
    });
}

// Initialize theme on load
loadTheme();

// Format time
function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Update UI with track info
ipcRenderer.on('mini-player-update', (event, data) => {
    console.log('Mini player update received:', data);

    if (data.track) {
        currentTrack = data.track;
        miniTitle.textContent = data.track.title || 'Unknown Title';
        miniArtist.textContent = data.track.artist || 'Unknown Artist';

        console.log('Artist set to:', miniArtist.textContent);
    }

    if (data.isPlaying !== undefined) {
        isPlaying = data.isPlaying;
        updatePlayPauseButton();
    }

    if (data.currentTime !== undefined) {
        miniCurrentTime.textContent = formatTime(data.currentTime);
    }

    if (data.duration !== undefined) {
        miniDuration.textContent = formatTime(data.duration);
    }

    if (data.progress !== undefined) {
        miniProgressFill.style.width = `${data.progress}%`;
    }
});

// Update play/pause button
function updatePlayPauseButton() {
    if (isPlaying) {
        miniPlayIcon.style.display = 'none';
        miniPauseIcon.style.display = 'block';
        miniPlayPauseBtn.title = 'Pause';
    } else {
        miniPlayIcon.style.display = 'block';
        miniPauseIcon.style.display = 'none';
        miniPlayPauseBtn.title = 'Play';
    }
}

// Control buttons
miniPlayPauseBtn.addEventListener('click', () => {
    ipcRenderer.send('mini-player-action', 'play-pause');
});

miniPrevBtn.addEventListener('click', () => {
    ipcRenderer.send('mini-player-action', 'previous');
});

miniNextBtn.addEventListener('click', () => {
    ipcRenderer.send('mini-player-action', 'next');
});

miniExpandBtn.addEventListener('click', () => {
    ipcRenderer.send('mini-player-action', 'expand');
});

miniCloseBtn.addEventListener('click', () => {
    ipcRenderer.send('close-mini-player');
});

// Progress bar seeking
miniProgressBar.addEventListener('click', (e) => {
    const rect = miniProgressBar.getBoundingClientRect();
    const percent = ((e.clientX - rect.left) / rect.width) * 100;
    ipcRenderer.send('mini-player-action', 'seek', percent);
});

// Listen for theme changes from main window
ipcRenderer.on('theme-changed', (event, theme) => {
    applyTheme(theme);
});

// Request initial state
ipcRenderer.send('mini-player-ready');
