// public/play/play.js - Mobile Controller Client Logic
const socket = io();

const STORAGE_KEYS = {
  PLAYER_ID: 'anomaly_player_id',
  PLAYER_NAME: 'anomaly_player_name'
};

// DOM Elements
const joinView = document.getElementById('join-view');
const lobbyView = document.getElementById('lobby-view');
const runningView = document.getElementById('running-view');

const joinForm = document.getElementById('join-form');
const nameInput = document.getElementById('player-name-input');
const charCount = document.getElementById('char-count');
const errorMsg = document.getElementById('error-msg');

const lobbyPlayerDot = document.getElementById('lobby-player-dot');
const lobbyPlayerName = document.getElementById('lobby-player-name');
const runningPlayerDot = document.getElementById('running-player-dot');
const runningPlayerName = document.getElementById('running-player-name');

let localPlayer = null;
let currentGameState = 'LOBBY';

// Screen Wake Lock & Portrait Lock
async function requestDeviceLocks() {
  // Screen Wake Lock
  if ('wakeLock' in navigator) {
    try {
      await navigator.wakeLock.request('screen');
      console.log('[Phone] Screen WakeLock acquired');
    } catch (err) {
      console.log('[Phone] WakeLock request failed:', err.message);
    }
  }

  // Portrait Orientation Lock
  if (screen.orientation && screen.orientation.lock) {
    try {
      await screen.orientation.lock('portrait');
      console.log('[Phone] Screen orientation locked to portrait');
    } catch (err) {
      console.log('[Phone] Orientation lock not supported or denied');
    }
  }
}

// Block pull-to-refresh and pinch-to-zoom gestures
document.addEventListener('touchmove', (e) => {
  if (e.scale !== undefined && e.scale !== 1) {
    e.preventDefault();
  }
}, { passive: false });

// Update character counter
nameInput.addEventListener('input', () => {
  charCount.textContent = nameInput.value.length;
});

// Switch visible view
function showView(viewId) {
  [joinView, lobbyView, runningView].forEach(v => v.classList.remove('active'));
  if (viewId === 'join') joinView.classList.add('active');
  if (viewId === 'lobby') lobbyView.classList.add('active');
  if (viewId === 'running') runningView.classList.add('active');
}

// Apply assigned player color to UI
function applyPlayerTheme(player) {
  if (!player || !player.color) return;
  document.documentElement.style.setProperty('--player-theme-color', player.color.hex);
  lobbyPlayerDot.style.backgroundColor = player.color.hex;
  lobbyPlayerDot.style.boxShadow = `0 0 10px ${player.color.hex}`;
  lobbyPlayerName.textContent = player.name;

  runningPlayerDot.style.backgroundColor = player.color.hex;
  runningPlayerDot.style.boxShadow = `0 0 10px ${player.color.hex}`;
  runningPlayerName.textContent = player.name;
}

// Handle Form Submission
joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  requestDeviceLocks();

  const name = nameInput.value.trim().slice(0, 12);
  if (!name) {
    errorMsg.textContent = 'Please enter a racer name';
    return;
  }

  const existingPlayerId = localStorage.getItem(STORAGE_KEYS.PLAYER_ID);
  socket.emit('join_game', {
    playerId: existingPlayerId || null,
    name: name
  });
});

// Socket Event: Successfully joined
socket.on('joined_success', (data) => {
  localPlayer = data.player;
  currentGameState = data.gameState || 'LOBBY';

  // Save in localStorage for reloads
  localStorage.setItem(STORAGE_KEYS.PLAYER_ID, localPlayer.id);
  localStorage.setItem(STORAGE_KEYS.PLAYER_NAME, localPlayer.name);

  applyPlayerTheme(localPlayer);

  if (currentGameState === 'RUNNING') {
    showView('running');
  } else {
    showView('lobby');
  }
});

// Socket Event: Game state broadcasts
socket.on('game_state_update', (publicState) => {
  currentGameState = publicState.state;

  if (localPlayer) {
    if (currentGameState === 'RUNNING') {
      showView('running');
    } else if (currentGameState === 'LOBBY') {
      showView('lobby');
    }
  }
});

// Socket Event: Errors
socket.on('error_message', (data) => {
  errorMsg.textContent = data.message || 'Error occurred';
});

// Auto-reconnect if already joined previously
window.addEventListener('DOMContentLoaded', () => {
  const savedId = localStorage.getItem(STORAGE_KEYS.PLAYER_ID);
  const savedName = localStorage.getItem(STORAGE_KEYS.PLAYER_NAME);

  if (savedName) {
    nameInput.value = savedName;
    charCount.textContent = savedName.length;
  }

  if (savedId && savedName) {
    console.log('[Phone] Auto-reconnecting saved player:', savedName);
    socket.emit('join_game', {
      playerId: savedId,
      name: savedName
    });
  }
});
