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

// Controller Elements
const joystickZone = document.getElementById('joystick-zone');
const joystickBase = document.getElementById('joystick-base');
const joystickKnob = document.getElementById('joystick-knob');
const actionBtn = document.getElementById('action-btn');

let localPlayer = null;
let currentGameState = 'LOBBY';

// Input State
const MAX_JOYSTICK_RADIUS = 50;
let joystickActive = false;
let joystickTouchId = null;
let joystickCenterX = 0;
let joystickCenterY = 0;

let currentInput = { x: 0, y: 0, action: false };
let lastSentInput = { x: 0, y: 0, action: false };
let lastSendTimestamp = 0;
const HEARTBEAT_MS = 250;
const SEND_INTERVAL_MS = 50; // 20Hz

// Device Locks
async function requestDeviceLocks() {
  if ('wakeLock' in navigator) {
    try {
      await navigator.wakeLock.request('screen');
    } catch (err) {
      console.log('[Phone] WakeLock not allowed:', err.message);
    }
  }

  if (screen.orientation && screen.orientation.lock) {
    try {
      await screen.orientation.lock('portrait');
    } catch (err) {
      // Ignore if not supported on iOS Safari
    }
  }
}

// Block pinch-to-zoom and gestures
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

// Update name char count
nameInput.addEventListener('input', () => {
  charCount.textContent = nameInput.value.length;
});

function showView(viewId) {
  [joinView, lobbyView, runningView].forEach(v => v.classList.remove('active'));
  if (viewId === 'join') joinView.classList.add('active');
  if (viewId === 'lobby') lobbyView.classList.add('active');
  if (viewId === 'running') runningView.classList.add('active');
}

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

// -------------------------------------------------------------
// Floating Analog Joystick Logic
// -------------------------------------------------------------
joystickZone.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (joystickActive) return;

  const touch = e.changedTouches[0];
  joystickTouchId = touch.identifier;
  joystickActive = true;

  const rect = joystickZone.getBoundingClientRect();
  joystickCenterX = touch.clientX - rect.left;
  joystickCenterY = touch.clientY - rect.top;

  joystickBase.style.left = `${joystickCenterX}px`;
  joystickBase.style.top = `${joystickCenterY}px`;
  joystickKnob.style.transform = 'translate(-50%, -50%)';
  joystickBase.style.display = 'block';

  currentInput.x = 0;
  currentInput.y = 0;
  transmitInputIfChanged();
}, { passive: false });

joystickZone.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (!joystickActive) return;

  for (let i = 0; i < e.changedTouches.length; i++) {
    const touch = e.changedTouches[i];
    if (touch.identifier === joystickTouchId) {
      const rect = joystickZone.getBoundingClientRect();
      const touchX = touch.clientX - rect.left;
      const touchY = touch.clientY - rect.top;

      const deltaX = touchX - joystickCenterX;
      const deltaY = touchY - joystickCenterY;
      const distance = Math.hypot(deltaX, deltaY);

      let clampedX = deltaX;
      let clampedY = deltaY;

      if (distance > MAX_JOYSTICK_RADIUS) {
        clampedX = (deltaX / distance) * MAX_JOYSTICK_RADIUS;
        clampedY = (deltaY / distance) * MAX_JOYSTICK_RADIUS;
      }

      // Move visual knob
      joystickKnob.style.transform = `translate(calc(-50% + ${clampedX}px), calc(-50% + ${clampedY}px))`;

      // Normalized output vector [-1.0, 1.0]
      currentInput.x = Math.round((clampedX / MAX_JOYSTICK_RADIUS) * 100) / 100;
      currentInput.y = Math.round((clampedY / MAX_JOYSTICK_RADIUS) * 100) / 100;
      transmitInputIfChanged();
      break;
    }
  }
}, { passive: false });

function resetJoystick() {
  joystickActive = false;
  joystickTouchId = null;
  joystickBase.style.display = 'none';
  joystickKnob.style.transform = 'translate(-50%, -50%)';
  currentInput.x = 0;
  currentInput.y = 0;
  transmitInputIfChanged();
}

joystickZone.addEventListener('touchend', (e) => {
  for (let i = 0; i < e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier === joystickTouchId) {
      resetJoystick();
      break;
    }
  }
});
joystickZone.addEventListener('touchcancel', resetJoystick);

// -------------------------------------------------------------
// Action Button Logic
// -------------------------------------------------------------
function triggerHaptic() {
  if (navigator.vibrate) {
    try {
      navigator.vibrate(40);
    } catch (e) {}
  }
}

actionBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  actionBtn.classList.add('pressed');
  currentInput.action = true;
  triggerHaptic();
  transmitInputIfChanged();
});

const releaseAction = (e) => {
  if (currentInput.action) {
    actionBtn.classList.remove('pressed');
    currentInput.action = false;
    transmitInputIfChanged();
  }
};

actionBtn.addEventListener('pointerup', releaseAction);
actionBtn.addEventListener('pointercancel', releaseAction);
actionBtn.addEventListener('pointerleave', releaseAction);

// -------------------------------------------------------------
// Low-Latency Input Transmission Loop (20Hz + 250ms Heartbeat)
// -------------------------------------------------------------
function transmitInputIfChanged(force = false) {
  if (!localPlayer || currentGameState !== 'RUNNING') return;

  const now = performance.now();
  const hasChanged = 
    currentInput.x !== lastSentInput.x ||
    currentInput.y !== lastSentInput.y ||
    currentInput.action !== lastSentInput.action;

  const heartbeatExpired = (now - lastSendTimestamp) >= HEARTBEAT_MS;

  if (force || hasChanged || heartbeatExpired) {
    socket.emit('player_input', currentInput);
    lastSentInput = { ...currentInput };
    lastSendTimestamp = now;
  }
}

// 20Hz Input Heartbeat Timer
setInterval(() => {
  transmitInputIfChanged();
}, SEND_INTERVAL_MS);

// -------------------------------------------------------------
// Join Form Submission
// -------------------------------------------------------------
joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  requestDeviceLocks();

  const name = nameInput.value.trim().slice(0, 12);
  if (!name) {
    errorMsg.textContent = 'Please enter a racer handle';
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

  localStorage.setItem(STORAGE_KEYS.PLAYER_ID, localPlayer.id);
  localStorage.setItem(STORAGE_KEYS.PLAYER_NAME, localPlayer.name);

  applyPlayerTheme(localPlayer);

  if (currentGameState === 'RUNNING') {
    showView('running');
  } else {
    showView('lobby');
  }
});

// Socket Event: Game state updates
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

socket.on('error_message', (data) => {
  errorMsg.textContent = data.message || 'Error occurred';
});

// Auto-reconnect on load
window.addEventListener('DOMContentLoaded', () => {
  const savedId = localStorage.getItem(STORAGE_KEYS.PLAYER_ID);
  const savedName = localStorage.getItem(STORAGE_KEYS.PLAYER_NAME);

  if (savedName) {
    nameInput.value = savedName;
    charCount.textContent = savedName.length;
  }

  if (savedId && savedName) {
    console.log('[Phone] Auto-reconnecting saved racer:', savedName);
    socket.emit('join_game', {
      playerId: savedId,
      name: savedName
    });
  }
});
