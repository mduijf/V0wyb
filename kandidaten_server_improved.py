#!/usr/bin/env python3
"""
Improved Kandidaten server for the WatchYourBack display system.
Includes better error handling, logging, and security.
"""
import json
import asyncio
import websockets
import os
import sys
from datetime import datetime
from typing import Dict, Any, List, Optional, Set

# Import our shared library
from lib.wyb_common import (
    setup_logging,
    PresetManager,
    ClientManager,
    validate_message,
    SimpleAuthenticator
)

# Configuration
HOST = "0.0.0.0"  # Listen on all interfaces
PORT = 8765  # Default port for Kandidaten system
PRESETS_FILE = "kandidaten_presets.json"
LOG_FILE = "kandidaten_server.log"
AUTH_FILE = "kandidaten_auth.json"  # New file for authentication tokens

# Check for custom port from environment variable
if "PORT" in os.environ:
    try:
        PORT = int(os.environ["PORT"])
    except ValueError:
        print(f"Invalid port in environment variable: {os.environ['PORT']}. Using default.")

# Setup logging
logger = setup_logging("KANDIDATEN", LOG_FILE)

# Initialize authentication
auth_tokens = {}
if os.path.exists(AUTH_FILE):
    try:
        with open(AUTH_FILE, 'r') as f:
            auth_tokens = json.load(f)
        logger.info(f"Loaded {len(auth_tokens)} authentication tokens")
    except Exception as e:
        logger.error(f"Failed to load authentication tokens: {e}")

authenticator = SimpleAuthenticator(auth_tokens, logger)

# Initialize preset manager
preset_manager = PresetManager(PRESETS_FILE, logger)

# Initialize client manager
client_manager = ClientManager("kandidaten", logger)

# Message handlers
async def handle_register(websocket, data: Dict[str, Any]) -> Dict[str, Any]:
    """Handle client registration."""
    # Validate required fields
    valid, error = validate_message(data, ['client_id', 'info'])
    if not valid:
        return {'type': 'error', 'message': error}
    
    client_id = data['client_id']
    
    # Check authentication if enabled and not a new client
    if auth_tokens and client_id in auth_tokens:
        token = data.get('token')
        if not token or not authenticator.authenticate(client_id, token):
            return {'type': 'error', 'message': 'Authentication failed'}
    
    # Default display settings
    display_defaults = data.get('display', {
        'mode': 'color',
        'background': '#000000',
        'number': '0',
        'image': ''
    })
    
    # Register client
    response = await client_manager.register_client(
        client_id, websocket, data.get('info', {}), display_defaults
    )
    
    # If this is a new client and authentication is enabled, generate a token
    if auth_tokens and client_id not in auth_tokens:
        token = authenticator.generate_token(client_id)
        response['token'] = token
        
        # Save updated tokens
        with open(AUTH_FILE, 'w') as f:
            json.dump(auth_tokens, f, indent=2)
    
    # Broadcast updated client list
    await client_manager.broadcast_client_status()
    
    return response

async def handle_heartbeat(data: Dict[str, Any]) -> None:
    """Handle client heartbeat."""
    valid, error = validate_message(data, ['client_id'])
    if not valid:
        logger.warning(f"Invalid heartbeat message: {error}")
        return
    
    client_id = data['client_id']
    client_manager.update_heartbeat(client_id)

async def handle_update_display(data: Dict[str, Any]) -> Dict[str, Any]:
    """Handle display update request."""
    valid, error = validate_message(data, ['clients', 'display'])
    if not valid:
        return {'type': 'error', 'message': error}
    
    target_clients = data['clients']
    display_data = data['display']
    
    # Validate display data
    if 'mode' in display_data and display_data['mode'] not in ['color', 'image']:
        return {'type': 'error', 'message': f"Invalid mode: {display_data['mode']}"}
    
    # Update clients
    updated_clients = await client_manager.update_display(target_clients, display_data)
    
    # Broadcast updated client status
    await client_manager.broadcast_client_status()
    
    return {
        'type': 'display_updated',
        'updated_clients': updated_clients
    }

async def handle_save_preset(data: Dict[str, Any]) -> Dict[str, Any]:
    """Handle save preset request."""
    valid, error = validate_message(data, ['name'])
    if not valid:
        return {'type': 'error', 'message': error}
    
    preset_name = data['name']
    
    # Create preset data from current client states
    preset_data = {
        'clients': {
            cid: client['display'] 
            for cid, client in client_manager.clients.items()
        }
    }
    
    # Save preset
    preset_manager.add_preset(preset_name, preset_data)
    preset_manager.save()
    
    return {
        'type': 'preset_saved',
        'name': preset_name,
        'system': 'kandidaten'
    }

async def handle_load_preset(data: Dict[str, Any]) -> Dict[str, Any]:
    """Handle load preset request."""
    valid, error = validate_message(data, ['name'])
    if not valid:
        return {'type': 'error', 'message': error}
    
    preset_name = data['name']
    preset = preset_manager.get_preset(preset_name)
    
    if not preset:
        return {'type': 'error', 'message': f"Preset not found: {preset_name}"}
    
    # Apply preset to clients
    updated_clients = []
    
    for preset_client_id, display_data in preset['clients'].items():
        if preset_client_id in client_manager.clients:
            # Update this client
            client_updated = await client_manager.update_display([preset_client_id], display_data)
            if client_updated:
                updated_clients.extend(client_updated)
    
    # Broadcast updated client status
    await client_manager.broadcast_client_status()
    
    return {
        'type': 'preset_loaded',
        'name': preset_name,
        'updated_clients': updated_clients,
        'system': 'kandidaten'
    }

async def handle_get_clients() -> Dict[str, Any]:
    """Handle get clients request."""
    return {
        'type': 'client_list',
        'clients': client_manager.get_client_list(),
        'system': 'kandidaten'
    }

async def handle_get_presets() -> Dict[str, Any]:
    """Handle get presets request."""
    return {
        'type': 'preset_list',
        'presets': preset_manager.get_preset_names(),
        'system': 'kandidaten'
    }

async def handle_check_presets_integrity() -> Dict[str, Any]:
    """Handle check presets integrity request."""
    result = preset_manager.check_integrity()
    return {
        'type': 'presets_integrity_result',
        'result': result,
        'system': 'kandidaten'
    }

# Main client handler
async def handle_client(websocket):
    """Handle client WebSocket connection."""
    client_id = None
    
    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                message_type = data.get('type')
                
                # Handle different message types
                if message_type == 'register':
                    response = await handle_register(websocket, data)
                    await websocket.send(json.dumps(response))
                    
                    # Store client_id for cleanup
                    client_id = data.get('client_id')
                
                elif message_type == 'heartbeat':
                    await handle_heartbeat(data)
                
                elif message_type == 'update_display':
                    response = await handle_update_display(data)
                    await websocket.send(json.dumps(response))
                
                elif message_type == 'save_preset':
                    response = await handle_save_preset(data)
                    await websocket.send(json.dumps(response))
                
                elif message_type == 'load_preset':
                    response = await handle_load_preset(data)
                    await websocket.send(json.dumps(response))
                
                elif message_type == 'get_clients':
                    response = await handle_get_clients()
                    await websocket.send(json.dumps(response))
                
                elif message_type == 'get_presets':
                    response = await handle_get_presets()
                    await websocket.send(json.dumps(response))
                
                elif message_type == 'check_presets_integrity':
                    response = await handle_check_presets_integrity()
                    await websocket.send(json.dumps(response))
                
                else:
                    logger.warning(f"Unknown message type: {message_type}")
                    await websocket.send(json.dumps({
                        'type': 'error',
                        'message': f"Unknown message type: {message_type}"
                    }))
            
            except json.JSONDecodeError:
                logger.error(f"Invalid JSON received: {message[:100]}...")
                await websocket.send(json.dumps({
                    'type': 'error',
                    'message': "Invalid JSON message"
                }))
            
            except Exception as e:
                logger.error(f"Error processing message: {e}", exc_info=True)
                await websocket.send(json.dumps({
                    'type': 'error',
                    'message': f"Server error: {str(e)}"
                }))
    
    except websockets.exceptions.ConnectionClosed as e:
        logger.info(f"Connection closed: {e.code} {e.reason}")
    
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
    
    finally:
        # Mark client as offline if we have its ID
        if client_id and client_id in client_manager.clients:
            client_manager.mark_client_offline(client_id)
            await client_manager.broadcast_client_status()

# Start the server
async def main():
    """Main server function."""
    # Load presets
    preset_manager.load()
    
    # Start background tasks
    status_task = asyncio.create_task(client_manager.check_client_status())
    
    # Start WebSocket server
    async with websockets.serve(handle_client, HOST, PORT):
        logger.info(f"Kandidaten server started on ws://{HOST}:{PORT}")
        
        try:
            await asyncio.Future()  # Run forever
        except asyncio.CancelledError:
            logger.info("Server shutdown requested")
        finally:
            # Cancel background tasks
            status_task.cancel()
            try:
                await status_task
            except asyncio.CancelledError:
                pass

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        sys.exit(1)

