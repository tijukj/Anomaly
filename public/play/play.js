// public/play/play.js - Mobile Controller Client Logic
const socket = io({
  transports: ['websocket', 'polling']
});

const STORAGE_KEYS = {
  PLAYER_ID: 'anomaly_player_id',
  PLAYER_NAME: 'anomaly_player_name'
};

// DOM Elements - Views
const joinView = document.getElementById('join-view');
const lobbyView = document.getElementById('lobby-view');
const runningView = document.getElementById('running-view');
const endedView = document.getElementById('ended-view');

// Overlay Elements
const countdownOverlay = document.getElementById('countdown-overlay');
const countdownNum = document.getElementById('countdown-num');

// Form Elements
const joinForm = document.getElementById('join-form');
const nameInput = document.getElementById('player-name-input');
const charCount = document.getElementById('char-count');
const errorMsg = document.getElementById('error-msg');

// Lobby & Player Badges
const lobbyPlayerDot = document.getElementById('lobby-player-dot');
const lobbyPlayerName = document.getElementById('lobby-player-name');
const runningPlayerDot = document.getElementById('running-player-dot');
const runningPlayerName = document.getElementById('running-player-name');

// Running HUD Elements
const hudRank = document.getElementById('hud-rank');
const hudTimer = document.getElementById('hud-timer');
const hudScore = document.getElementById('hud-score');
const hudKeyBadge = document.getElementById('hud-key-badge');
const hudMission = document.getElementById('hud-mission');

// Ended View Elements
const endedRank = document.getElementById('ended-rank');
const endedScore = document.getElementById('ended-score');

// Controller Elements
const joystickZone = document.getElementById('joystick-zone');
const joystickBase = document.getElementById('joystick-base');
const joystickKnob = document.getElementById('joystick-knob');
const actionBtn = document.getElementById('action-btn');
const actionText = document.getElementById('action-text');

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
    } catch (err) {}
  }

  if (screen.orientation && screen.orientation.lock) {
    try {
      await screen.orientation.lock('portrait');
    } catch (err) {}
  }
}

// Block pinch-to-zoom and gestures
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

nameInput.addEventListener('input', () => {
  charCount.textContent = nameInput.value.length;
});

function formatTime(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function showView(viewId) {
  [joinView, lobbyView, runningView, endedView].forEach(v => {
    if (v) v.classList.remove('active');
  });

  if (viewId === 'join' && joinView) joinView.classList.add('active');
  if (viewId === 'lobby' && lobbyView) lobbyView.classList.add('active');
  if (viewId === 'running' && runningView) runningView.classList.add('active');
  if (viewId === 'ended' && endedView) endedView.classList.add('active');
}

function applyPlayerTheme(player) {
  if (!player || !player.color) return;
  document.documentElement.style.setProperty('--player-theme-color', player.color.hex);
  
  if (lobbyPlayerDot) {
    lobbyPlayerDot.style.backgroundColor = player.color.hex;
    lobbyPlayerDot.style.boxShadow = `0 0 10px ${player.color.hex}`;
  }
  if (lobbyPlayerName) {
    lobbyPlayerName.textContent = player.name;
  }

  if (runningPlayerDot) {
    runningPlayerDot.style.backgroundColor = player.color.hex;
    runningPlayerDot.style.boxShadow = `0 0 10px ${player.color.hex}`;
  }
  if (runningPlayerName) {
    runningPlayerName.textContent = player.name;
  }
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

      joystickKnob.style.transform = `translate(calc(-50% + ${clampedX}px), calc(-50% + ${clampedY}px))`;

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
// Smart Action Button Handlers
// -------------------------------------------------------------
function triggerHaptic(duration = 40) {
  if (navigator.vibrate) {
    try { navigator.vibrate(duration); } catch (e) {}
  }
}

actionBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  actionBtn.classList.add('pressed');
  currentInput.action = true;
  triggerHaptic(50);
  transmitInputIfChanged(true);
});

const releaseAction = (e) => {
  if (currentInput.action) {
    actionBtn.classList.remove('pressed');
    currentInput.action = false;
    transmitInputIfChanged(true);
  }
};

actionBtn.addEventListener('pointerup', releaseAction);
actionBtn.addEventListener('pointercancel', releaseAction);
actionBtn.addEventListener('pointerleave', releaseAction);

// -------------------------------------------------------------
// Input Transmission Loop (20Hz + 250ms Heartbeat)
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

socket.on('joined_success', (data) => {
  localPlayer = data.player;
  currentGameState = data.gameState || 'LOBBY';

  localStorage.setItem(STORAGE_KEYS.PLAYER_ID, localPlayer.id);
  localStorage.setItem(STORAGE_KEYS.PLAYER_NAME, localPlayer.name);

  applyPlayerTheme(localPlayer);

  if (currentGameState === 'RUNNING') {
    showView('running');
    if (countdownOverlay) countdownOverlay.classList.add('hidden');
  } else if (currentGameState === 'COUNTDOWN') {
    showView('running');
    if (countdownOverlay) countdownOverlay.classList.remove('hidden');
  } else if (currentGameState === 'ENDED') {
    showView('ended');
    if (countdownOverlay) countdownOverlay.classList.add('hidden');
  } else {
    showView('lobby');
    if (countdownOverlay) countdownOverlay.classList.add('hidden');
  }
});

// Socket Event: Countdown Tick (5..4..3..2..1)
socket.on('countdown_tick', (data) => {
  if (countdownOverlay && countdownNum) {
    if (data.count > 0) {
      countdownOverlay.classList.remove('hidden');
      countdownNum.textContent = data.count;
      triggerHaptic(80);
    } else {
      countdownOverlay.classList.add('hidden');
      triggerHaptic(150);
    }
  }
});

// Socket Event: Mission Completed (Flash screen & vibration)
socket.on('mission_completed', (data) => {
  triggerHaptic([100, 50, 100]);

  document.body.classList.add('mission-complete-flash');
  setTimeout(() => {
    document.body.classList.remove('mission-complete-flash');
  }, 600);

  if (hudMission) {
    hudMission.textContent = `✓ COMPLETED: "${data.title}" (+${data.reward} PTS)!`;
    hudMission.style.color = '#39FF14';
    setTimeout(() => {
      if (hudMission) hudMission.style.color = '#00F0FF';
    }, (data.nextInSec || 3) * 1000);
  }
});

// Socket Event: Public Clue Found Notification
socket.on('public_clue_found', (data) => {
  triggerHaptic([60, 40, 60]);

  if (hudMission) {
    hudMission.textContent = `📜 CLUE #${data.step}: "${data.text}"`;
    hudMission.style.color = '#FFE600';
    setTimeout(() => {
      if (hudMission) hudMission.style.color = '#00F0FF';
    }, 5000);
  }
});

// Socket Event: Final Revelation Notification
socket.on('final_revelation', (data) => {
  triggerHaptic([100, 50, 100]);

  if (hudMission) {
    hudMission.textContent = `👑 FINAL REVELATION: VAULT EXPOSED IN CASTLE!`;
    hudMission.style.color = '#FFE600';
    setTimeout(() => {
      if (hudMission) hudMission.style.color = '#00F0FF';
    }, 6000);
  }
});

// Socket Event: Legendary Treasure Claimed
socket.on('legendary_found', (data) => {
  triggerHaptic([150, 80, 150]);

  if (hudMission) {
    hudMission.textContent = `👑 ${data.playerName.toUpperCase()} CLAIMED LEGENDARY (+150 PTS)!`;
    hudMission.style.color = '#FFE600';
    setTimeout(() => {
      if (hudMission) hudMission.style.color = '#00F0FF';
    }, 6000);
  }
});

// Socket Event: Personal Player HUD (Rank, Timer, Score, Mission & Smart Button)
socket.on('player_hud', (data) => {
  if (!data) return;

  // Update Rank & Score
  if (hudRank) hudRank.textContent = `#${data.rank || 1}`;
  if (hudScore) hudScore.textContent = `${data.score || 0}`;

  // Update Match Timer
  if (hudTimer && data.timeRemaining !== undefined) {
    hudTimer.textContent = formatTime(data.timeRemaining);
  }

  if (data.hasKey) {
    if (hudKeyBadge) hudKeyBadge.classList.remove('hidden');
  } else {
    if (hudKeyBadge) hudKeyBadge.classList.add('hidden');
  }

  if (data.mission && hudMission && !hudMission.textContent.startsWith('📜') && !hudMission.textContent.startsWith('👑')) {
    hudMission.textContent = data.mission;
  }

  // Update Smart Action Button
  const btnState = data.actionBtn;
  if (btnState && btnState.available) {
    actionBtn.classList.remove('disabled');
    actionText.textContent = btnState.label || 'ACTION';
    if (btnState.color) {
      document.documentElement.style.setProperty('--action-btn-color', btnState.color);
    }
  } else {
    actionBtn.classList.add('disabled');
    actionText.textContent = (btnState && btnState.label) || 'NO TARGET';
    document.documentElement.style.setProperty('--action-btn-color', '#333344');
  }
});

// Socket Event: Match Ended (Podium & Final Result)
socket.on('match_ended', (data) => {
  currentGameState = 'ENDED';
  if (countdownOverlay) countdownOverlay.classList.add('hidden');
  
  if (localPlayer && data && data.leaderboard) {
    const myEntry = data.leaderboard.find(p => p.id === localPlayer.id);
    if (myEntry) {
      if (endedRank) endedRank.textContent = `#${myEntry.rank}`;
      if (endedScore) endedScore.textContent = `${myEntry.score} PTS`;
    }
  }

  showView('ended');
  triggerHaptic(200);
});

// Socket Event: Global Game State Updates
socket.on('game_state_update', (publicState) => {
  currentGameState = publicState.state;

  if (localPlayer) {
    if (currentGameState === 'RUNNING') {
      showView('running');
      if (countdownOverlay) countdownOverlay.classList.add('hidden');
    } else if (currentGameState === 'COUNTDOWN') {
      showView('running');
      if (countdownOverlay) countdownOverlay.classList.remove('hidden');
    } else if (currentGameState === 'ENDED') {
      showView('ended');
      if (countdownOverlay) countdownOverlay.classList.add('hidden');
    } else if (currentGameState === 'LOBBY') {
      showView('lobby');
      if (countdownOverlay) countdownOverlay.classList.add('hidden');
    }
  }
});

socket.on('error_message', (data) => {
  if (errorMsg) errorMsg.textContent = data.message || 'Error occurred';
});

// Auto-reconnect on load
window.addEventListener('DOMContentLoaded', () => {
  const savedId = localStorage.getItem(STORAGE_KEYS.PLAYER_ID);
  const savedName = localStorage.getItem(STORAGE_KEYS.PLAYER_NAME);

  if (savedName && nameInput) {
    nameInput.value = savedName;
    if (charCount) charCount.textContent = savedName.length;
  }

  if (savedId && savedName) {
    socket.emit('join_game', {
      playerId: savedId,
      name: savedName
    });
  }
});
