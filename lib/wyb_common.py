"""
Common utilities and shared functionality for WatchYourBack system.
"""
import json
import logging
import os
import asyncio
import time
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple, Callable

# Configure logging
def setup_logging(name: str, log_file: Optional[str] = None, level=logging.INFO):
    """
    Set up logging configuration for a component.
    
    Args:
        name: Name of the logger
        log_file: Optional file to log to
        level: Logging level
    
    Returns:
        Logger instance
    """
    logger = logging.getLogger(name)
    logger.setLevel(level)
    
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    
    # File handler if specified
    if log_file:
        file_handler = logging.FileHandler(log_file)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    
    return logger

# Preset management
class PresetManager:
    """Manages loading, saving, and validating presets."""
    
    def __init__(self, preset_file: str, logger: logging.Logger):
        self.preset_file = preset_file
        self.presets = {}
        self.logger = logger
    
    def load(self) -> Dict[str, Any]:
        """Load presets from file."""
        if os.path.exists(self.preset_file):
            try:
                with open(self.preset_file, 'r', encoding='utf-8') as f:
                    self.presets = json.load(f)
                self.logger.info(f"Loaded {len(self.presets)} presets from {self.preset_file}")
                return self.presets
            except json.JSONDecodeError as e:
                self.logger.error(f"Error loading presets from {self.preset_file}: {e}")
                return {}
        else:
            self.logger.warning(f"Preset file {self.preset_file} not found, using empty presets")
            return {}
    
    def save(self) -> bool:
        """Save presets to file."""
        try:
            # Create backup first
            if os.path.exists(self.preset_file):
                backup_file = f"{self.preset_file}.backup"
                try:
                    import shutil
                    shutil.copy2(self.preset_file, backup_file)
                    self.logger.info(f"Created backup of presets at {backup_file}")
                except Exception as e:
                    self.logger.warning(f"Failed to create backup: {e}")
            
            # Save presets
            with open(self.preset_file, 'w', encoding='utf-8') as f:
                json.dump(self.presets, f, indent=2, ensure_ascii=False)
            
            self.logger.info(f"Saved {len(self.presets)} presets to {self.preset_file}")
            return True
        except Exception as e:
            self.logger.error(f"Error saving presets to {self.preset_file}: {e}")
            return False
    
    def check_integrity(self) -> Dict[str, Any]:
        """Check if the preset file is valid."""
        try:
            if not os.path.exists(self.preset_file):
                return {"status": "missing", "message": f"Presets file does not exist: {self.preset_file}"}
            
            # Try to read the file
            with open(self.preset_file, 'r', encoding='utf-8') as f:
                content = f.read()
                
            # Check if the file is empty
            if not content.strip():
                return {"status": "empty", "message": "Presets file is empty"}
                
            # Try to parse the file as JSON
            try:
                parsed_presets = json.loads(content)
                preset_count = len(parsed_presets)
                
                # Check if it's a dictionary
                if not isinstance(parsed_presets, dict):
                    return {
                        "status": "invalid", 
                        "message": f"Presets file is not a valid dictionary. Type: {type(parsed_presets).__name__}"
                    }
                    
                # All seems good
                return {
                    "status": "ok", 
                    "message": f"Presets file is valid with {preset_count} presets",
                    "presets": list(parsed_presets.keys())
                }
                
            except json.JSONDecodeError as e:
                return {"status": "corrupt", "message": f"Presets file is corrupt: {str(e)}"}
                
        except Exception as e:
            return {"status": "error", "message": f"Error checking presets file: {str(e)}"}
    
    def add_preset(self, name: str, data: Dict[str, Any]) -> None:
        """Add or update a preset."""
        self.presets[name] = data
        self.logger.info(f"Added/updated preset '{name}'")
    
    def get_preset(self, name: str) -> Optional[Dict[str, Any]]:
        """Get a preset by name."""
        return self.presets.get(name)
    
    def get_preset_names(self) -> List[str]:
        """Get list of preset names."""
        return list(self.presets.keys())
    
    def delete_preset(self, name: str) -> bool:
        """Delete a preset."""
        if name in self.presets:
            del self.presets[name]
            self.logger.info(f"Deleted preset '{name}'")
            return True
        return False

# Client management
class ClientManager:
    """Manages connected clients and their state."""
    
    def __init__(self, system_name: str, logger: logging.Logger):
        self.system_name = system_name
        self.logger = logger
        self.clients = {}  # client_id -> client_data
        self.admin_clients = set()  # Set of client_ids that are admins
    
    async def register_client(self, client_id: str, websocket, info: Dict[str, Any], 
                             display_defaults: Dict[str, Any]) -> Dict[str, Any]:
        """Register a new client."""
        self.clients[client_id] = {
            'websocket': websocket,
            'last_seen': datetime.now().isoformat(),
            'info': info,
            'status': 'online',
            'display': display_defaults
        }
        
        # Check if this is an admin client
        if 'admin' in info.get('capabilities', []):
            self.admin_clients.add(client_id)
        
        self.logger.info(f"Client {client_id} registered with system {self.system_name}")
        
        return {
            'type': 'registered',
            'client_id': client_id,
            'system': self.system_name
        }
    
    def update_heartbeat(self, client_id: str, status_data: Optional[Dict[str, Any]] = None) -> None:
        """Update client heartbeat timestamp and status."""
        if client_id in self.clients:
            self.clients[client_id]['last_seen'] = datetime.now().isoformat()
            self.clients[client_id]['status'] = 'online'
            
            # Update status data if provided
            if status_data:
                for key, value in status_data.items():
                    if key in self.clients[client_id]['display']:
                        self.clients[client_id]['display'][key] = value
    
    async def update_display(self, target_clients: List[str], display_data: Dict[str, Any]) -> List[str]:
        """Update display settings for specified clients."""
        updated_clients = []
        
        for target_id in target_clients:
            if target_id in self.clients:
                client = self.clients[target_id]
                
                # Update display data
                for key, value in display_data.items():
                    client['display'][key] = value
                
                # Send update to client
                try:
                    await client['websocket'].send(json.dumps({
                        'type': 'display_update',
                        'display': display_data
                    }))
                    updated_clients.append(target_id)
                except Exception as e:
                    self.logger.error(f"Failed to send update to client {target_id}: {e}")
        
        return updated_clients
    
    def get_client_list(self) -> Dict[str, Dict[str, Any]]:
        """Get list of clients with their status and display info."""
        return {
            cid: {
                'last_seen': client['last_seen'],
                'status': client['status'],
                'info': client['info'],
                'display': client['display']
            } for cid, client in self.clients.items()
        }
    
    async def broadcast_client_status(self) -> None:
        """Broadcast client status to all admin clients."""
        client_list = self.get_client_list()
        
        status_message = json.dumps({
            'type': 'client_list',
            'clients': client_list,
            'system': self.system_name
        })
        
        # Send to all admin clients
        for client_id in self.admin_clients:
            if client_id in self.clients:
                try:
                    await self.clients[client_id]['websocket'].send(status_message)
                except Exception as e:
                    self.logger.error(f"Failed to broadcast status to admin {client_id}: {e}")
    
    def mark_client_offline(self, client_id: str) -> None:
        """Mark a client as offline."""
        if client_id in self.clients:
            self.clients[client_id]['status'] = 'offline'
            self.logger.info(f"Client {client_id} marked as offline")
    
    async def check_client_status(self) -> None:
        """Periodically check client status based on last heartbeat."""
        while True:
            current_time = datetime.now()
            status_changed = False
            
            for client_id, client in list(self.clients.items()):
                last_seen = datetime.fromisoformat(client['last_seen'])
                time_diff = (current_time - last_seen).total_seconds()
                
                # If more than 10 seconds without heartbeat, mark as 'lost'
                if time_diff > 10 and client['status'] == 'online':
                    client['status'] = 'lost'
                    status_changed = True
                    self.logger.warning(f"Client {client_id} marked as lost (no heartbeat for {time_diff:.1f}s)")
                    
                # After 60 seconds, mark as offline
                elif time_diff > 60 and client['status'] != 'offline':
                    client['status'] = 'offline'
                    status_changed = True
                    self.logger.warning(f"Client {client_id} marked as offline (no heartbeat for {time_diff:.1f}s)")
            
            # Broadcast status updates if any changes
            if status_changed:
                await self.broadcast_client_status()
            
            await asyncio.sleep(5)  # Check every 5 seconds

# Message validation
def validate_message(message: Dict[str, Any], required_fields: List[str]) -> Tuple[bool, Optional[str]]:
    """
    Validate that a message contains all required fields.
    
    Args:
        message: The message to validate
        required_fields: List of required field names
    
    Returns:
        Tuple of (is_valid, error_message)
    """
    for field in required_fields:
        if field not in message:
            return False, f"Missing required field: {field}"
    return True, None

# Authentication
class SimpleAuthenticator:
    """Simple token-based authentication for WebSocket connections."""
    
    def __init__(self, tokens: Dict[str, str], logger: logging.Logger):
        """
        Initialize authenticator with tokens.
        
        Args:
            tokens: Dictionary mapping client_id to token
            logger: Logger instance
        """
        self.tokens = tokens
        self.logger = logger
    
    def authenticate(self, client_id: str, token: str) -> bool:
        """
        Authenticate a client.
        
        Args:
            client_id: Client ID
            token: Authentication token
        
        Returns:
            True if authenticated, False otherwise
        """
        if client_id not in self.tokens:
            self.logger.warning(f"Authentication failed: Unknown client {client_id}")
            return False
        
        if self.tokens[client_id] != token:
            self.logger.warning(f"Authentication failed: Invalid token for client {client_id}")
            return False
        
        self.logger.info(f"Client {client_id} authenticated successfully")
        return True
    
    def generate_token(self, client_id: str) -> str:
        """
        Generate a new token for a client.
        
        Args:
            client_id: Client ID
        
        Returns:
            New token
        """
        import secrets
        token = secrets.token_hex(16)
        self.tokens[client_id] = token
        return token

