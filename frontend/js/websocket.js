// --- WebSocket Connection to ROS Monitor Bridge ---

import { state, wsUrl, logger, updateConnStatus, updateBandwidthStats } from './state.js';
import {
    handleGraphUpdate,
    handleMessageEvent,
    handleLifecycleEvent,
    handleFrequencyUpdate,
    handleNodeParams,
    clearGraph,
} from './graph.js';

export function initWebSocket() {
    updateConnStatus('disconnected', 'CONNECTING...');

    if (state.socket) {
        state.socket.close();
    }

    logger(`Connecting to WebSocket bridge at ${wsUrl}...`);
    state.socket = new WebSocket(wsUrl);

    state.socket.onopen = () => {
        logger("WebSocket connection established.");
        updateConnStatus(state.isSimulationMode ? 'simulating' : 'connected', state.isSimulationMode ? 'SIMULATING' : 'CONNECTED');
        if (state.reconnectTimer) {
            clearInterval(state.reconnectTimer);
            state.reconnectTimer = null;
        }
    };

    state.socket.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);

            state.bytesReceived += event.data.length;
            updateBandwidthStats();

            if (msg.type === 'graph_update') {
                handleGraphUpdate(msg.data);
            } else if (msg.type === 'message_event') {
                handleMessageEvent({ ...msg.data, timestamp: msg.timestamp });
            } else if (msg.type === 'lifecycle_event') {
                handleLifecycleEvent(msg.data);
            } else if (msg.type === 'frequency_update') {
                handleFrequencyUpdate(msg.data);
            } else if (msg.type === 'node_params_event') {
                handleNodeParams(msg.data);
            }
        } catch (err) {
            console.error("Error processing websocket message:", err);
        }
    };

    state.socket.onerror = (error) => {
        logger("WebSocket error: " + error.message, true);
    };

    state.socket.onclose = () => {
        logger("WebSocket connection closed. Retrying in 4 seconds...", true);
        updateConnStatus('disconnected', 'DISCONNECTED');
        clearGraph();

        if (!state.reconnectTimer) {
            state.reconnectTimer = setInterval(initWebSocket, 4000);
        }
    };
}
