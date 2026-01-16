"""
UB-WaveX Python Core
Music extraction, metadata resolution, and download manager
"""

import sys
import json
import os
import shutil
from typing import Dict, Any, Optional
import yt_dlp
import requests
import sqlite3
from datetime import datetime, timedelta
import hashlib
from pathlib import Path

class MusicCore:
    """Main class handling all music operations"""
    
    def __init__(self):
        # Use same database path as Electron (Roaming, not Local)
        appdata_roaming = Path(os.getenv('APPDATA')) / 'ub-wavex'
        appdata_roaming.mkdir(parents=True, exist_ok=True)
        
        self.db_path = appdata_roaming / 'ubwavex.db'
        self.db_connection = None
        self.cache_dir = appdata_roaming / 'cache'
        self.download_dir = Path(os.getenv('USERPROFILE')) / 'Music' / 'UB-WaveX'
        
        # Download settings
        self.download_settings = {
            'autoDownload': False,
            'concurrentDownloads': 3,
            'embedMetadata': True
        }
        self.active_downloads = 0
        
        # Set FFmpeg path (bundled with app)
        self.ffmpeg_path = self._get_ffmpeg_path()
        
        # Create directories
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.download_dir.mkdir(parents=True, exist_ok=True)
        
        # Connect to database
        self.connect_database()
    
    def _get_ffmpeg_path(self) -> str:
        """Get the path to bundled FFmpeg executable"""
        if getattr(sys, 'frozen', False):
            # Running as compiled executable (packaged with Electron)
            # FFmpeg is in the same resources folder, under executables
            exe_dir = Path(sys.executable).parent
            # Go up from python folder to resources, then into executables
            ffmpeg_exe = exe_dir.parent / 'executables' / 'ffmpeg.exe'
            if ffmpeg_exe.exists():
                return str(ffmpeg_exe)
            # Fallback: check in same directory as music_core.exe
            ffmpeg_exe = exe_dir / 'ffmpeg.exe'
            if ffmpeg_exe.exists():
                return str(ffmpeg_exe)
        else:
            # Running in development
            base_path = Path(__file__).parent.parent.parent
            ffmpeg_exe = base_path / 'executables' / 'ffmpeg.exe'
            if ffmpeg_exe.exists():
                return str(ffmpeg_exe)
        
        # Last resort: hope ffmpeg is in PATH
        return 'ffmpeg'
        
    def connect_database(self):
        """Connect to SQLite database"""
        try:
            self.db_connection = sqlite3.connect(str(self.db_path), check_same_thread=False)
            self.db_connection.row_factory = sqlite3.Row
        except Exception as e:
            self.log_error(f"Database connection failed: {str(e)}")
            
    def search(self, query: str, limit: int = 20) -> list:
        """Search for music on YouTube"""
        try:
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
                'extract_flat': True,
                'default_search': 'ytsearch',
                'ffmpeg_location': self.ffmpeg_path,
                'noprogress': True,
                'logger': None,
            }
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                results = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
                
                tracks = []
                if results and 'entries' in results:
                    for entry in results['entries']:
                        if entry:
                            track = {
                                'youtube_id': entry.get('id'),
                                'title': entry.get('title'),
                                'duration': entry.get('duration', 0),
                                'uploader': entry.get('uploader', 'Unknown Artist')
                            }
                            tracks.append(track)
                
                return tracks
        except Exception as e:
            self.log_error(f"Search failed: {str(e)}")
            raise
            
    def get_stream_url(self, video_id: str, quality: str = 'high') -> Dict[str, Any]:
        """Get direct audio stream URL for playback"""
        try:
            # Check cache first (include quality in cache key)
            cached = self.get_from_cache(f"stream_{video_id}_{quality}", 'stream_url')
            if cached:
                return json.loads(cached)
            
            # Map quality levels to format strings
            quality_formats = {
                'low': 'worstaudio/worst',
                'medium': 'bestaudio[abr<=128]/bestaudio',
                'high': 'bestaudio[abr<=192]/bestaudio',
                'best': 'bestaudio/best'
            }
            
            format_string = quality_formats.get(quality, 'bestaudio[abr<=192]/bestaudio')
            
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
                'format': format_string,
                'ffmpeg_location': self.ffmpeg_path,
                'noprogress': True,
            }
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
                
                stream_data = {
                    'url': info['url'],
                    'title': info.get('title'),
                    'duration': info.get('duration', 0),
                    'artist': info.get('artist') or info.get('uploader', 'Unknown Artist'),
                    'thumbnail': info.get('thumbnail')
                }
                
                # Cache for 6 hours (stream URLs expire)
                self.save_to_cache(
                    f"stream_{video_id}_{quality}", 
                    'stream_url', 
                    json.dumps(stream_data),
                    hours=6
                )
                
                # Ensure track exists in database and get metadata
                self.ensure_track_exists(video_id, stream_data)
                
                return stream_data
        except Exception as e:
            self.log_error(f"Failed to get stream URL: {str(e)}")
            raise
            
    def download_track(self, video_id: str, track_data: Dict[str, Any]) -> Dict[str, Any]:
        """Download a track with metadata from YouTube"""
        try:
            # Check concurrent download limit
            if self.active_downloads >= self.download_settings['concurrentDownloads']:
                return {
                    'success': False,
                    'error': 'Concurrent download limit reached. Please wait for active downloads to complete.'
                }
            
            self.active_downloads += 1
            
            try:
                # Get quality setting (default to 320 if not provided)
                quality = str(track_data.get('quality', '320'))
                
                # Determine codec and quality based on setting
                if quality.lower() == 'flac':
                    codec = 'flac'
                    quality_value = '0'  # FLAC doesn't use bitrate
                else:
                    codec = 'mp3'
                    quality_value = quality
                
                # Setup download options
                output_template = str(self.download_dir / '%(title)s.%(ext)s')
                
                # Base postprocessors
                postprocessors = [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': codec,
                    'preferredquality': quality_value,
                }]
                
                # Add metadata embedding if enabled
                if self.download_settings['embedMetadata']:
                    postprocessors.append({
                        'key': 'FFmpegMetadata',
                        'add_metadata': True,
                    })
                    # Add thumbnail embedding for album art
                    postprocessors.append({
                        'key': 'EmbedThumbnail',
                        'already_have_thumbnail': False,
                    })
                
                ydl_opts = {
                    'format': 'bestaudio/best',
                    'outtmpl': output_template,
                    'quiet': True,
                    'no_warnings': True,
                    'ffmpeg_location': self.ffmpeg_path,
                    'noprogress': True,
                    'writethumbnail': self.download_settings['embedMetadata'],  # Download thumbnail for album art
                    'postprocessors': postprocessors,
                }
                
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)
                    
                    # Get the actual file path
                    file_path = ydl.prepare_filename(info)
                    file_path = file_path.rsplit('.', 1)[0] + f'.{codec}'
                    
                    # Use YouTube data directly
                    title = info.get('title', track_data.get('title', 'Unknown'))
                    artist = info.get('uploader', track_data.get('uploader', 'Unknown Artist'))
                    duration = info.get('duration', track_data.get('duration', 0))
                    
                    # Save to database
                    metadata = {
                        'title': title,
                        'artist': artist,
                        'duration': duration,
                        'youtube_id': video_id
                    }
                    
                    track_id = self.save_track_to_db(video_id, metadata)
                    self.save_download_to_db(track_id, file_path)
                    
                    return {
                        'track_id': track_id,
                        'file_path': file_path,
                        'title': title,
                        'artist': artist
                    }
            finally:
                self.active_downloads -= 1
                
        except Exception as e:
            self.log_error(f"Download failed: {str(e)}")
            self.active_downloads = max(0, self.active_downloads - 1)
            raise
            
    def resolve_metadata(self, track_info: Dict[str, Any]) -> Dict[str, Any]:
        """Resolve metadata using MusicBrainz and Cover Art Archive"""
        try:
            title = track_info.get('title', '')
            artist = track_info.get('artist', track_info.get('uploader', 'Unknown Artist'))
            
            # Check cache
            cache_key = hashlib.md5(f"{title}_{artist}".encode()).hexdigest()
            cached = self.get_from_cache(cache_key, 'metadata')
            if cached:
                return json.loads(cached)
            
            metadata = {
                'title': title,
                'artist': artist,
                'album': None,
                'release_date': None,
                'cover_art_url': track_info.get('thumbnail'),
                'musicbrainz_artist_id': None,
                'musicbrainz_album_id': None
            }
            
            # Query MusicBrainz
            try:
                mb_url = "https://musicbrainz.org/ws/2/recording/"
                params = {
                    'query': f'recording:"{title}" AND artist:"{artist}"',
                    'fmt': 'json',
                    'limit': 1
                }
                headers = {'User-Agent': 'UB-WaveX/1.0'}
                
                response = requests.get(mb_url, params=params, headers=headers, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    if data.get('recordings'):
                        recording = data['recordings'][0]
                        
                        # Get artist info
                        if recording.get('artist-credit'):
                            artist_credit = recording['artist-credit'][0]
                            if artist_credit.get('artist'):
                                metadata['artist'] = artist_credit['artist']['name']
                                metadata['musicbrainz_artist_id'] = artist_credit['artist']['id']
                        
                        # Get album info
                        if recording.get('releases'):
                            release = recording['releases'][0]
                            metadata['album'] = release.get('title')
                            metadata['release_date'] = release.get('date')
                            metadata['musicbrainz_album_id'] = release.get('id')
                            
                            # Try to get cover art
                            if metadata['musicbrainz_album_id']:
                                cover_art = self.fetch_cover_art(metadata['musicbrainz_album_id'])
                                if cover_art:
                                    metadata['cover_art_url'] = cover_art
            except Exception as e:
                self.log_error(f"MusicBrainz query failed: {str(e)}")
            
            # Cache metadata for 30 days
            self.save_to_cache(cache_key, 'metadata', json.dumps(metadata), days=30)
            
            return metadata
        except Exception as e:
            self.log_error(f"Metadata resolution failed: {str(e)}")
            return track_info
            
    def fetch_cover_art(self, release_id: str) -> Optional[str]:
        """Fetch cover art from Cover Art Archive"""
        try:
            url = f"https://coverartarchive.org/release/{release_id}"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('images'):
                    # Get front cover
                    for image in data['images']:
                        if image.get('front'):
                            return image['image']
                    # Fallback to first image
                    return data['images'][0]['image']
        except Exception as e:
            self.log_error(f"Cover art fetch failed: {str(e)}")
        return None
        
    def download_cover_image(self, url: str, video_id: str) -> str:
        """Download and cache cover image"""
        try:
            # Check if already cached
            cache_path = self.cache_dir / 'covers' / f"{video_id}.jpg"
            cache_path.parent.mkdir(exist_ok=True)
            
            if cache_path.exists():
                return str(cache_path)
            
            # Download image
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                with open(cache_path, 'wb') as f:
                    f.write(response.content)
                return str(cache_path)
        except Exception as e:
            self.log_error(f"Cover image download failed: {str(e)}")
        return ""
        
    def ensure_track_exists(self, video_id: str, track_data: Dict[str, Any]):
        """Ensure track exists in database with YouTube metadata"""
        try:
            cursor = self.db_connection.cursor()
            
            # Check if track exists
            cursor.execute("SELECT id FROM tracks WHERE youtube_id = ?", (video_id,))
            existing = cursor.fetchone()
            
            if not existing:
                # Use YouTube data directly
                title = track_data.get('title', 'Unknown')
                artist = track_data.get('uploader', 'Unknown Artist')
                duration = track_data.get('duration', 0)
                
                # Save track
                cursor.execute("""
                    INSERT INTO tracks (title, artist_name, duration, youtube_id, created_at)
                    VALUES (?, ?, ?, ?, datetime('now'))
                """, (
                    title,
                    artist,
                    duration,
                    video_id
                ))
                
                self.db_connection.commit()
            
            cursor.close()
        except Exception as e:
            self.log_error(f"Failed to ensure track exists: {str(e)}")
            
    def save_artist(self, name: str, musicbrainz_id: Optional[str] = None) -> int:
        """Save artist to database and return ID"""
        cursor = self.db_connection.cursor()
        
        # Check if artist exists
        cursor.execute("SELECT id FROM artists WHERE name = ?", (name,))
        existing = cursor.fetchone()
        
        if existing:
            artist_id = existing[0]
        else:
            cursor.execute(
                "INSERT INTO artists (name, musicbrainz_id) VALUES (?, ?)",
                (name, musicbrainz_id)
            )
            artist_id = cursor.lastrowid
        
        cursor.close()
        return artist_id
        
    def save_album(self, title: str, artist_id: int, release_date: Optional[str], 
                   musicbrainz_id: Optional[str] = None) -> int:
        """Save album to database and return ID"""
        cursor = self.db_connection.cursor()
        
        # Check if album exists
        cursor.execute(
            "SELECT id FROM albums WHERE title = ? AND artist_id = ?",
            (title, artist_id)
        )
        existing = cursor.fetchone()
        
        if existing:
            album_id = existing[0]
        else:
            cursor.execute("""
                INSERT INTO albums (title, artist_id, release_date, musicbrainz_id)
                VALUES (?, ?, ?, ?)
            """, (title, artist_id, release_date, musicbrainz_id))
            album_id = cursor.lastrowid
        
        cursor.close()
        return album_id
        
    def save_track_to_db(self, video_id: str, metadata: Dict[str, Any]) -> int:
        """Save track to database and return ID"""
        cursor = self.db_connection.cursor()
        
        artist_name = metadata.get('artist', 'Unknown Artist')
        
        # Check if track exists
        cursor.execute("SELECT id FROM tracks WHERE youtube_id = ?", (video_id,))
        existing = cursor.fetchone()
        
        if existing:
            track_id = existing[0]
            # Update artist if provided
            cursor.execute(
                "UPDATE tracks SET artist_name = ? WHERE id = ?",
                (artist_name, track_id)
            )
            self.db_connection.commit()
        else:
            # Insert new track
            cursor.execute("""
                INSERT INTO tracks (title, artist_name, duration, youtube_id, created_at)
                VALUES (?, ?, ?, ?, datetime('now'))
            """, (
                metadata['title'],
                artist_name,
                metadata.get('duration', 0),
                video_id
            ))
            track_id = cursor.lastrowid
            self.db_connection.commit()
        
        cursor.close()
        return track_id
        
    def save_download_to_db(self, track_id: int, file_path: str):
        """Record download in database"""
        cursor = self.db_connection.cursor()
        
        file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
        
        cursor.execute("""
            INSERT OR REPLACE INTO downloads (track_id, file_path, file_size, quality)
            VALUES (?, ?, ?, ?)
        """, (track_id, file_path, file_size, '320kbps'))
        
        self.db_connection.commit()
        cursor.close()
        
    def get_from_cache(self, cache_key: str, cache_type: str) -> Optional[str]:
        """Get data from cache if not expired"""
        try:
            cursor = self.db_connection.cursor()
            cursor.execute("""
                SELECT cache_data FROM cache 
                WHERE cache_key = ? AND cache_type = ? 
                AND (expires_at IS NULL OR expires_at > datetime('now'))
            """, (cache_key, cache_type))
            
            result = cursor.fetchone()
            cursor.close()
            
            if result:
                return result[0]
        except Exception as e:
            self.log_error(f"Cache read failed: {str(e)}")
        return None
        
    def save_to_cache(self, cache_key: str, cache_type: str, data: str, 
                    hours: int = 0, days: int = 0):
        """Save data to cache with expiration"""
        try:
            cursor = self.db_connection.cursor()
            
            expires_at = None
            if hours or days:
                total_hours = hours + (days * 24)
                expires_at = f"datetime('now', '+{total_hours} hours')"
                cursor.execute(f"""
                    INSERT OR REPLACE INTO cache (cache_key, cache_type, cache_data, expires_at)
                    VALUES (?, ?, ?, {expires_at})
                """, (cache_key, cache_type, data))
            else:
                cursor.execute("""
                    INSERT OR REPLACE INTO cache (cache_key, cache_type, cache_data, expires_at)
                    VALUES (?, ?, ?, NULL)
                """, (cache_key, cache_type, data))
            
            self.db_connection.commit()
            cursor.close()
        except Exception as e:
            self.log_error(f"Cache write failed: {str(e)}")
            
    def log_error(self, message: str):
        """Log error to stderr"""
        print(f"ERROR: {message}", file=sys.stderr)


class IPCHandler:
    """Handles JSON-based IPC communication via STDIN/STDOUT"""
    
    def __init__(self):
        self.music_core = MusicCore()
        
    def handle_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """Process incoming request and return response"""
        request_id = request.get('request_id')
        action = request.get('action')
        params = request.get('params', {})
        
        try:
            if action == 'search':
                result = self.music_core.search(params.get('query', ''))
                return self.success_response(request_id, result)
                
            elif action == 'get_stream_url':
                result = self.music_core.get_stream_url(
                    params.get('video_id'),
                    params.get('quality', 'high')
                )
                return self.success_response(request_id, result)
                
            elif action == 'download_track':
                result = self.music_core.download_track(
                    params.get('video_id'),
                    params
                )
                return self.success_response(request_id, result)
                
            elif action == 'resolve_metadata':
                result = self.music_core.resolve_metadata(params)
                return self.success_response(request_id, result)
            
            elif action == 'update_directories':
                # Update directories from settings
                download_dir = params.get('download_directory')
                database_dir = params.get('database_directory')
                
                if download_dir:
                    self.music_core.download_dir = Path(download_dir)
                    self.music_core.download_dir.mkdir(parents=True, exist_ok=True)
                
                if database_dir:
                    # Reconnect to database in new location
                    new_db_path = Path(database_dir) / 'ubwavex.db'
                    if self.music_core.db_connection:
                        self.music_core.db_connection.close()
                    self.music_core.db_path = new_db_path
                    self.music_core.connect_database()
                
                return self.success_response(request_id, {
                    'download_dir': str(self.music_core.download_dir),
                    'db_path': str(self.music_core.db_path)
                })
            
            elif action == 'update_download_settings':
                # Update download settings from renderer
                settings = params.get('settings', {})
                self.music_core.download_settings.update(settings)
                return self.success_response(request_id, {
                    'settings': self.music_core.download_settings
                })
                
            else:
                return self.error_response(request_id, f"Unknown action: {action}")
                
        except Exception as e:
            return self.error_response(request_id, str(e))
            
    def success_response(self, request_id: int, data: Any) -> Dict[str, Any]:
        """Create success response"""
        return {
            'request_id': request_id,
            'status': 'success',
            'data': data
        }
        
    def error_response(self, request_id: int, error: str) -> Dict[str, Any]:
        """Create error response"""
        return {
            'request_id': request_id,
            'status': 'error',
            'error': error
        }
        
    def run(self):
        """Main IPC loop - read from STDIN, write to STDOUT"""
        while True:
            try:
                line = sys.stdin.readline()
                if not line:
                    break
                    
                request = json.loads(line.strip())
                
                # Handle commands without request_id (like update_directories)
                if 'command' in request and 'request_id' not in request:
                    command = request.get('command')
                    if command == 'update_directories':
                        download_dir = request.get('download_directory')
                        database_dir = request.get('database_directory')
                        
                        if download_dir:
                            self.music_core.download_dir = Path(download_dir)
                            self.music_core.download_dir.mkdir(parents=True, exist_ok=True)
                        
                        if database_dir:
                            # Reconnect to database in new location
                            new_db_path = Path(database_dir) / 'ubwavex.db'
                            if self.music_core.db_connection:
                                self.music_core.db_connection.close()
                            self.music_core.db_path = new_db_path
                            self.music_core.connect_database()
                    elif command == 'update_download_settings':
                        settings = request.get('settings', {})
                        self.music_core.download_settings.update(settings)
                    elif command == 'clear_cache':
                        # Clear cache directory
                        if self.music_core.cache_dir.exists():
                            for item in self.music_core.cache_dir.glob('*'):
                                try:
                                    if item.is_file():
                                        item.unlink()
                                    elif item.is_dir():
                                        shutil.rmtree(item, ignore_errors=True)
                                except Exception as e:
                                    print(f"Failed to delete cache item {item}: {e}", file=sys.stderr)
                    continue
                
                response = self.handle_request(request)
                
                # Write response to STDOUT
                print(json.dumps(response), flush=True)
                
            except json.JSONDecodeError:
                continue
            except Exception as e:
                print(f"ERROR: {str(e)}", file=sys.stderr)


if __name__ == '__main__':
    handler = IPCHandler()
    handler.run()
