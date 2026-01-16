// UB-WaveX Website Script

// Theme Management
const themeToggle = document.getElementById('theme-toggle');
const root = document.documentElement;

// Load saved theme
function loadTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    const themeText = document.getElementById('theme-text');
    if (savedTheme === 'light') {
        root.setAttribute('data-theme', 'light');
        if (themeText) themeText.textContent = 'Dark';
    } else {
        root.removeAttribute('data-theme');
        if (themeText) themeText.textContent = 'Light';
    }
}

// Toggle theme
function toggleTheme() {
    const currentTheme = root.hasAttribute('data-theme') ? 'light' : 'dark';
    const themeText = document.getElementById('theme-text');

    if (currentTheme === 'dark') {
        root.setAttribute('data-theme', 'light');
        if (themeText) themeText.textContent = 'Dark';
        localStorage.setItem('theme', 'light');
    } else {
        root.removeAttribute('data-theme');
        if (themeText) themeText.textContent = 'Light';
        localStorage.setItem('theme', 'dark');
    }
}

// Initialize
loadTheme();
themeToggle.addEventListener('click', toggleTheme);

// Mobile Menu Toggle
const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
const navLinks = document.querySelector('.nav-links');

if (mobileMenuToggle) {
    mobileMenuToggle.addEventListener('click', () => {
        mobileMenuToggle.classList.toggle('active');
        navLinks.classList.toggle('active');
    });

    // Close menu when clicking nav links
    document.querySelectorAll('.nav-link, .nav-btn').forEach(link => {
        link.addEventListener('click', () => {
            mobileMenuToggle.classList.remove('active');
            navLinks.classList.remove('active');
        });
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.nav-links') && !e.target.closest('.mobile-menu-toggle')) {
            mobileMenuToggle.classList.remove('active');
            navLinks.classList.remove('active');
        }
    });
}

// Update logo based on theme
function updateLogo() {
    const heroLogo = document.getElementById('hero-logo');
    const navLogo = document.getElementById('nav-logo');
    const favicon = document.getElementById('favicon');
    const theme = root.hasAttribute('data-theme') ? 'light' : 'dark';

    if (heroLogo) {
        // Hero uses full WaveX logo: Dark theme = white, Light theme = black
        heroLogo.src = theme === 'light' ? 'wavexblack.png' : 'wavexwhite.png';
    }

    if (navLogo) {
        // Navbar uses icon only: Dark theme = white, Light theme = black
        navLogo.src = theme === 'light' ? 'iconBlack.png' : 'iconWhite.png';
    }

    if (favicon) {
        // Dark theme: white icon, Light theme: black icon
        favicon.href = theme === 'light' ? 'iconBlack.png' : 'iconWhite.png';
    }
}

// Listen for theme changes
const observer = new MutationObserver(updateLogo);
observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Add download click tracking (optional)
document.querySelectorAll('.download-card').forEach(card => {
    card.addEventListener('click', function (e) {
        const platform = this.querySelector('h3').textContent;
        console.log(`Download started for: ${platform}`);
        // Add analytics tracking here if needed
    });
});

// Parallax effect on scroll (subtle)
let ticking = false;

function updateParallax() {
    const scrolled = window.pageYOffset;
    const header = document.querySelector('.header');

    if (header) {
        header.style.transform = `translateY(${scrolled * 0.3}px)`;
        header.style.opacity = 1 - (scrolled / 500);
    }

    ticking = false;
}

window.addEventListener('scroll', function () {
    if (!ticking) {
        window.requestAnimationFrame(updateParallax);
        ticking = true;
    }
});
