#!/usr/bin/env python3
"""
Improved Kandidaten client for the WatchYourBack display system.
Includes better error handling, logging, and security.
"""
import json
import asyncio
import websockets
import uuid
import os
import sys
import pygame
from pygame.locals import *
import urllib.request
from io import BytesIO
import threading
import time
import logging
from typing import Dict, Any, Optional, Tuple

# Configuration
SERVER_URL = "ws://localhost:8765"  # Default port for Kandidaten server
CLIENT_ID_FILE = "kandidaten_client_id.txt"
SCREEN_WIDTH = 800
SCREEN_HEIGHT = 600
IMAGE_CACHE_DIR = "image_cache"  # Directory for caching images
LOG_FILE = "kandidaten_client.log"
TOKEN_FILE = "kandidaten_client_token.txt"  # New file for authentication token

# Check for custom port from environment variable or command line
if len(sys.argv) > 2 and sys.argv[1] == "--port":
    SERVER_URL = f"ws://localhost:{sys.argv[2]}"
    sys.argv.pop(1)
    sys.argv.pop(1)
elif "SERVER_PORT" in os.environ:
    SERVER_URL = f"ws://localhost:{os.environ['SERVER_PORT']}"

# Determine client number if given as argument
client_num = 1  # Default
if len(sys.argv) > 1:
    try:
        client_num = int(sys.argv[1])
        CLIENT_ID_FILE = f"kandidaten_client_id_{client_num}.txt"
        TOKEN_FILE = f"kandidaten_client_token_{client_num}.txt"
        LOG_FILE = f"kandidaten_client_{client_num}.log"
    except ValueError:
        print("Invalid client number, using default")

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(f"KANDIDATEN-CLIENT-{client_num}")

# Create image cache directory if it doesn't exist
os.makedirs(IMAGE_CACHE_DIR, exist_ok=True)

# Get or generate client ID
def get_client_id() -> str:
    """Get existing client ID or generate a new one."""
    if os.path.exists(CLIENT_ID_FILE):
        with open(CLIENT_ID_FILE, 'r') as f:
            return f.read().strip()
    else:
        # Generate a new ID
        client_id = str(uuid.uuid4())
        with open(CLIENT_ID_FILE, 'w') as f:
            f.write(client_id)
        return client_id

# Get authentication token if it exists
def get_auth_token() -> Optional[str]:
    """Get authentication token if it exists."""
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, 'r') as f:
            return f.read().strip()
    return None

# Save authentication token
def save_auth_token(token: str) -> None:
    """Save authentication token."""
    with open(TOKEN_FILE, 'w') as f:
        f.write(token)

# Image cache with LRU eviction
class ImageCache:
    """Cache for loaded images with LRU eviction policy."""
    
    def __init__(self, max_size: int = 50):
        self.cache = {}  # url -> image
        self.max_size = max_size
        self.access_times = {}  # url -> last access time
        self.lock = threading.Lock()
    
    def get(self, url: str) -> Optional[pygame.Surface]:
        """Get image from cache."""
        with self.lock:
            if url in self.cache:
                self.access_times[url] = time.time()
                return self.cache[url]
        return None
    
    def put(self, url: str, image: pygame.Surface) -> None:
        """Add image to cache."""
        with self.lock:
            # Evict least recently used if cache is full
            if len(self.cache) >= self.max_size and url not in self.cache:
                oldest_url = min(self.access_times, key=self.access_times.get)
                del self.cache[oldest_url]
                del self.access_times[oldest_url]
            
            self.cache[url] = image
            self.access_times[url] = time.time()
    
    def clear(self) -> None:
        """Clear the cache."""
        with self.lock:
            self.cache.clear()
            self.access_times.clear()

# Initialize pygame
pygame.init()

# Shift windows so they don't overlap if there are multiple clients
if client_num > 1:
    pos_x = 100 + (client_num-1) * 50
    pos_y = 100 + (client_num-1) * 50
    os.environ['SDL_VIDEO_WINDOW_POS'] = f"{pos_x},{pos_y}"

# Create display window
screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
pygame.display.set_caption(f"Kandidaten Display {client_num}")
font = pygame.font.SysFont(None, 200)

# Current display settings
current_display = {
    "mode": "color",
    "background": "#000000",
    "number": "0",
    "image": ""
}

# Create image cache
image_cache = ImageCache()

# Load image from URL
def load_image(url: str) -> Optional[pygame.Surface]:
    """Load image from URL or file path."""
    if not url:
        return None
    
    # Check cache first
    cached_image = image_cache.get(url)
    if cached_image:
        return cached_image
    
    try:
        # Create cache filename (URL to safe filename)
        cache_filename = os.path.join(IMAGE_CACHE_DIR, uuid.uuid5(uuid.NAMESPACE_URL, url).hex + ".png")
        
        # Check if image is already in cache
        if os.path.exists(cache_filename):
            try:
                image = pygame.image.load(cache_filename)
                image_cache.put(url, image)
                return image
            except Exception as e:
                logger.error(f"Error loading cached image {url}: {e}")
        
        # Download image
        logger.info(f"Downloading image: {url}")
        try:
            if url.startswith("http"):
                # URL download
                with urllib.request.urlopen(url) as response:
                    image_data = response.read()
                    image = pygame.image.load(BytesIO(image_data))
            elif os.path.exists(url):
                # Local file
                image = pygame.image.load(url)
            else:
                # Path as relative to the server
                # Strip leading / if present for relative path
                local_url = url.lstrip('/')
                if os.path.exists(local_url):
                    image = pygame.image.load(local_url)
                else:
                    logger.error(f"Cannot find image: {url}")
                    return None
        except Exception as e:
            logger.error(f"Error loading image {url}: {e}")
            return None
        
        # Save to cache
        try:
            pygame.image.save(image, cache_filename)
        except Exception as e:
            logger.error(f"Could not save image to cache: {e}")
            
        # Add to cache
        image_cache.put(url, image)
        return image
    except Exception as e:
        logger.error(f"Unexpected error loading image {url}: {e}")
        return None

# Load image in background
def load_image_async(url: str) -> None:
    """Load image asynchronously in background thread."""
    def _load_and_save():
        load_image(url)
    
    if url and not image_cache.get(url):
        threading.Thread(target=_load_and_save).start()

# Update screen with current settings
def update_screen() -> None:
    """Update the screen with current display settings."""
    if current_display["mode"] == "color":
        # Convert color code to RGB
        bg_color = current_display["background"]
        bg_rgb = tuple(int(bg_color.lstrip('#')[i:i+2], 16) for i in (0, 2, 4))
        
        # Set background color
        screen.fill(bg_rgb)
        
    elif current_display["mode"] == "image" and current_display["image"]:
        # Load image
        image = load_image(current_display["image"])
        
        if image:
            # Calculate dimensions to cover entire screen
            img_rect = image.get_rect()
            scale_factor = max(SCREEN_WIDTH / img_rect.width, SCREEN_HEIGHT / img_rect.height)
            
            new_width = int(img_rect.width * scale_factor)
            new_height = int(img_rect.height * scale_factor)
            
            scaled_image = pygame.transform.scale(image, (new_width, new_height))
            
            # Center image
            x = (SCREEN_WIDTH - new_width) // 2
            y = (SCREEN_HEIGHT - new_height) // 2
            
            # Draw background (black)
            screen.fill((0, 0, 0))
            
            # Draw image
            screen.blit(scaled_image, (x, y))
        else:
            # Fallback to black background
            screen.fill((0, 0, 0))
    else:
        # Fallback to black background
        screen.fill((0, 0, 0))
    
    # Display number (always on top)
    number_text = current_display["number"]
    if number_text:
        text_surface = font.render(number_text, True, (255, 255, 255))
        text_rect = text_surface.get_rect(center=(SCREEN_WIDTH/2, SCREEN_HEIGHT/2))
        
        # Add shadow for better readability
        shadow_surface = font.render(number_text, True, (0, 0, 0))
        shadow_rect = shadow_surface.get_rect(center=(SCREEN_WIDTH/2 + 4, SCREEN_HEIGHT/2 + 4))
        
        screen.blit(shadow_surface, shadow_rect)
        screen.blit(text_surface, text_rect)
    
    # Update screen
    pygame.display.flip()

# Main client communication function
async def client_handler() -> None:
    """Handle communication with the server."""
    client_id = get_client_id()
    auth_token = get_auth_token()
    reconnect_delay = 1  # Start with 1 second delay
    
    while True:
        try:
            logger.info(f"Connecting to Kandidaten server: {SERVER_URL}")
            
            async with websockets.connect(SERVER_URL) as websocket:
                # Register with the server
                register_data = {
                    "type": "register",
                    "client_id": client_id,
                    "info": {
                        "name": f"KandidaatDisplay-{client_num}",
                        "ip": "0.0.0.0",
                        "capabilities": ["display", "image"]
                    },
                    "display": current_display
                }
                
                # Add token if we have one
                if auth_token:
                    register_data["token"] = auth_token
                
                await websocket.send(json.dumps(register_data))
                
                # Wait for confirmation
                response = await websocket.recv()
                data = json.loads(response)
                
                if data.get("type") == "registered":
                    logger.info(f"Registered with Kandidaten server as {client_id}")
                    
                    # Save token if provided
                    if "token" in data:
                        auth_token = data["token"]
                        save_auth_token(auth_token)
                        logger.info("Received and saved authentication token")
                    
                    # Reset reconnect delay on successful connection
                    reconnect_delay = 1
                    
                    # Start heartbeat task
                    heartbeat_task = asyncio.create_task(send_heartbeat(websocket, client_id))
                    
                    # Process messages from server
                    try:
                        async for message in websocket:
                            try:
                                data = json.loads(message)
                                message_type = data.get("type")
                                
                                if message_type == "display_update":
                                    # Update display settings
                                    display_data = data.get("display", {})
                                    
                                    # Update current_display with received values
                                    for key, value in display_data.items():
                                        current_display[key] = value
                                    
                                    # If an image is specified, preload it in the background
                                    if "image" in display_data and display_data["image"]:
                                        load_image_async(display_data["image"])
                                    
                                    update_screen()
                                    logger.info(f"Display update received: {display_data}")
                                
                                elif message_type == "error":
                                    logger.error(f"Error from server: {data.get('message')}")
                                
                                else:
                                    logger.warning(f"Unknown message type: {message_type}")
                            
                            except json.JSONDecodeError:
                                logger.error(f"Invalid JSON received: {message[:100]}...")
                            
                            except Exception as e:
                                logger.error(f"Error processing message: {e}")
                    
                    except websockets.exceptions.ConnectionClosed as e:
                        logger.warning(f"Connection closed: {e.code} {e.reason}")
                    
                    finally:
                        heartbeat_task.cancel()
                        try:
                            await heartbeat_task
                        except asyncio.CancelledError:
                            pass
                
                elif data.get("type") == "error":
                    logger.error(f"Registration error: {data.get('message')}")
                    # If authentication failed, clear token
                    if "Authentication failed" in data.get('message', ''):
                        auth_token = None
                        if os.path.exists(TOKEN_FILE):
                            os.remove(TOKEN_FILE)
                        logger.warning("Authentication token cleared")
                
                else:
                    logger.error(f"Unexpected response: {data}")
        
        except (websockets.exceptions.ConnectionError, 
                websockets.exceptions.InvalidStatusCode,
                ConnectionRefusedError) as e:
            logger.error(f"Connection error: {e}")
        
        except Exception as e:
            logger.error(f"Unexpected error: {e}")
        
        # Wait before reconnecting with exponential backoff
        logger.info(f"Reconnecting in {reconnect_delay} seconds...")
        await asyncio.sleep(reconnect_delay)
        reconnect_delay = min(reconnect_delay * 2, 60)  # Max 60 seconds

# Send periodic heartbeat messages
async def send_heartbeat(websocket, client_id: str) -> None:
    """Send periodic heartbeat messages to the server."""
    while True:
        try:
            await websocket.send(json.dumps({
                "type": "heartbeat",
                "client_id": client_id
            }))
            await asyncio.sleep(5)  # Send every 5 seconds
        except Exception as e:
            logger.error(f"Error sending heartbeat: {e}")
            break

# Process pygame events
async def handle_pygame_events() -> None:
    """Handle pygame events."""
    while True:
        for event in pygame.event.get():
            if event.type == QUIT:
                pygame.quit()
                return
        
        await asyncio.sleep(0.1)

# Start the client
async def main() -> None:
    """Main client function."""
    logger.info(f"Kandidaten client {client_num} starting, connecting to {SERVER_URL}")
    
    # Initial screen update
    update_screen()
    
    # Start background tasks
    event_task = asyncio.create_task(handle_pygame_events())
    client_task = asyncio.create_task(client_handler())
    
    # Wait for tasks to complete
    try:
        await asyncio.gather(event_task, client_task)
    except asyncio.CancelledError:
        logger.info("Client shutdown requested")
    finally:
        pygame.quit()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info(f"Kandidaten client {client_num} stopped by user")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        pygame.quit()

