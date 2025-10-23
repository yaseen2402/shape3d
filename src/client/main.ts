import * as THREE from 'three';
import {
  InitResponse,
  JoinGameResponse,
  PlaceShapeResponse,
  PlaceShapeRequest,
  ShapeType,
  ShapeColor,
  Position3D,
  GameState,
  PlayerScore
} from '../shared/types/api';

// Game state
let gameState: GameState | null = null;
let username: string = '';
let gameStarted = false;
let lastShapeCount = 0;
let updateInterval: NodeJS.Timeout | null = null;

// Selected tool state
let selectedShape: ShapeType = 'cube';
let selectedColor: ShapeColor = 'red';

// Preview position control
// Initialize preview position to center of grid (grid coordinates: -9 to 9 for 20x20 grid)
let previewPosition: Position3D = { x: 0, y: 0, z: 0 };
let isPreviewMode = false;

// 3D Scene setup
const canvas = document.getElementById('bg') as HTMLCanvasElement;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Sky blue

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(22, 22, 22); // Moved back to accommodate larger grid
camera.lookAt(0, 0, 0);

// Camera controls
let isMouseDown = false;
let mouseX = 0;
let mouseY = 0;
const cameraDistance = 35; // Increased for larger grid
let cameraAngleX = Math.PI / 6; // 30 degrees
let cameraAngleY = Math.PI / 4; // 45 degrees

const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
renderer.setPixelRatio(window.devicePixelRatio ?? 1);
renderer.setSize(window.innerWidth, window.innerHeight);
// Shadows disabled for cleaner look
renderer.shadowMap.enabled = false;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(10, 20, 5);
// Shadow casting disabled
scene.add(directionalLight);

// Ground plane - White surface with larger grid squares for bigger shapes
const GRID_SIZE = 20; // Number of grid squares (same as before)
const GRID_SPACING = 1.5; // Spacing between grid lines (increased for larger shapes)
const TOTAL_SIZE = GRID_SIZE * GRID_SPACING; // Total physical size

const groundGeometry = new THREE.PlaneGeometry(TOTAL_SIZE, TOTAL_SIZE);
const groundMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff }); // White surface
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Grid lines - Larger spacing for bigger shapes
const gridHelper = new THREE.GridHelper(TOTAL_SIZE, GRID_SIZE, 0x000000, 0x000000);
if (gridHelper.material instanceof THREE.Material) {
  gridHelper.material.opacity = 0.3;
  gridHelper.material.transparent = true;
}
scene.add(gridHelper);

// Game objects
const placedShapes = new Map<string, THREE.Mesh>();
const challengeHighlights: THREE.Mesh[] = [];
let previewShape: THREE.Mesh | null = null;

// Raycasting for mouse interaction (commented out as not currently used)
// const raycaster = new THREE.Raycaster();
// const mouse = new THREE.Vector2();

// Create shape geometries - Larger sizes for better visibility
function createShapeGeometry(type: ShapeType): THREE.BufferGeometry {
  switch (type) {
    case 'cube':
      return new THREE.BoxGeometry(1.2, 1.2, 1.2); // Increased from 0.8
    case 'triangle':
      return new THREE.ConeGeometry(0.7, 1.4, 3); // Increased from 0.5, 1.0
    case 'sphere':
      return new THREE.SphereGeometry(0.6, 16, 12); // Increased from 0.4
  }
}

// Create shape material
function createShapeMaterial(color: ShapeColor, isPreview = false): THREE.MeshLambertMaterial {
  const colorMap: Record<ShapeColor, number> = {
    red: 0xff0000,
    blue: 0x0000ff,
    green: 0x00ff00,
    yellow: 0xffff00,
    purple: 0x800080,
    orange: 0xffa500
  };

  return new THREE.MeshLambertMaterial({
    color: colorMap[color],
    transparent: isPreview,
    opacity: isPreview ? 0.5 : 1.0
  });
}

// Create and add shape to scene
function createShape(type: ShapeType, color: ShapeColor, position: Position3D, isPreview = false): THREE.Mesh {
  const geometry = createShapeGeometry(type);
  const material = createShapeMaterial(color, isPreview);
  const mesh = new THREE.Mesh(geometry, material);

  // Center shapes in grid squares with new spacing
  mesh.position.set(
    (position.x + 0.5) * GRID_SPACING,
    position.y + 0.6,
    (position.z + 0.5) * GRID_SPACING
  );

  return mesh;
}

// Grid snapping (commented out as not currently used)
// function snapToGrid(worldPos: THREE.Vector3): Position3D {
//   const halfGrid = GRID_SIZE / 2;
//   const x = Math.round(Math.max(-halfGrid + 0.5, Math.min(halfGrid - 0.5, worldPos.x)));
//   const z = Math.round(Math.max(-halfGrid + 0.5, Math.min(halfGrid - 0.5, worldPos.z)));
//   const y = Math.max(0, Math.round(worldPos.y));
//   
//   return { x, y, z };
// }

// Camera control functions
function updateCameraPosition(): void {
  const x = Math.cos(cameraAngleY) * Math.cos(cameraAngleX) * cameraDistance;
  const y = Math.sin(cameraAngleX) * cameraDistance;
  const z = Math.sin(cameraAngleY) * Math.cos(cameraAngleX) * cameraDistance;

  camera.position.set(x, y, z);
  camera.lookAt(0, 0, 0);
}

// Handle mouse movement for camera and preview
function onMouseMove(event: MouseEvent): void {
  if (isMouseDown) {
    // Camera rotation
    const deltaX = event.clientX - mouseX;
    const deltaY = event.clientY - mouseY;

    cameraAngleY += deltaX * 0.01;
    cameraAngleX += deltaY * 0.01;

    // Clamp vertical angle
    cameraAngleX = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, cameraAngleX));

    updateCameraPosition();
  }

  mouseX = event.clientX;
  mouseY = event.clientY;

  // Always update preview shape position when in preview mode
  if (gameStarted && isPreviewMode) {
    updatePreviewShape();
  }
}

// Update preview shape position
function updatePreviewShape(position?: Position3D): void {
  const pos = position || previewPosition;

  if (previewShape) {
    scene.remove(previewShape);
  }

  // Check if current position and shape/color combination is valid
  const validation = validatePlacement(pos, selectedShape, selectedColor);

  // Create preview shape with visual feedback
  previewShape = createShape(selectedShape, selectedColor, pos, true);

  // Change preview material based on validity
  const material = previewShape.material as THREE.MeshLambertMaterial;
  if (validation.valid) {
    // Valid placement - show in selected color with green tint
    material.opacity = 0.7;
    material.emissive = new THREE.Color(0x004400); // Green glow
  } else {
    // Invalid placement - show in red
    material.color = new THREE.Color(0xff0000); // Red color
    material.opacity = 0.5;
    material.emissive = new THREE.Color(0x440000); // Red glow
  }

  scene.add(previewShape);
}

// Move preview with WASD or arrow buttons
function movePreview(direction: 'up' | 'down' | 'left' | 'right' | 'higher' | 'lower'): void {
  if (!gameStarted) return;

  const halfGrid = Math.floor(GRID_SIZE / 2);

  switch (direction) {
    case 'up':
      previewPosition.z = Math.max(-halfGrid, previewPosition.z - 1);
      break;
    case 'down':
      previewPosition.z = Math.min(halfGrid - 1, previewPosition.z + 1);
      break;
    case 'left':
      previewPosition.x = Math.max(-halfGrid, previewPosition.x - 1);
      break;
    case 'right':
      previewPosition.x = Math.min(halfGrid - 1, previewPosition.x + 1);
      break;
    case 'higher':
      previewPosition.y = Math.min(10, previewPosition.y + 1);
      break;
    case 'lower':
      previewPosition.y = Math.max(0, previewPosition.y - 1);
      break;
  }

  updatePreviewShape();
}

// Camera perspective controls
function setCameraPerspective(angle: 'top' | 'front' | 'side' | 'iso'): void {
  switch (angle) {
    case 'top':
      cameraAngleX = Math.PI / 2 - 0.1;
      cameraAngleY = 0;
      break;
    case 'front':
      cameraAngleX = 0;
      cameraAngleY = 0;
      break;
    case 'side':
      cameraAngleX = 0;
      cameraAngleY = Math.PI / 2;
      break;
    case 'iso':
      cameraAngleX = Math.PI / 6;
      cameraAngleY = Math.PI / 4;
      break;
  }
  updateCameraPosition();
}

// Handle click (no longer places shapes automatically)
function onClick(_event: MouseEvent): void {
  // Click no longer places shapes - only Space key and Place button do
}

// API calls
async function initGame(): Promise<void> {
  try {
    const response = await fetch('/api/init');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = (await response.json()) as InitResponse;
    if (data.type === 'init') {
      username = data.username;
      gameState = data.gameState;

      document.getElementById('title')!.textContent = `Welcome ${username}!`;
      updateGameDisplay();
    }
  } catch (err) {
    console.error('Error initializing game:', err);
  }
}

async function joinGame(): Promise<void> {
  const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
  const originalText = startBtn.textContent;

  try {
    // Show loading state
    startBtn.textContent = 'Joining...';
    startBtn.disabled = true;

    // Add timeout to prevent hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = (await response.json()) as JoinGameResponse;
    if (data.success) {
      gameState = data.gameState;
      gameStarted = true;
      lastShapeCount = gameState.shapes.length;
      updateGameDisplay();

      // Initialize preview mode
      isPreviewMode = true;
      updatePreviewShape();

      // Start polling for updates
      startGameUpdates();

      // Hide start screen, show game UI
      document.getElementById('start-screen')!.style.display = 'none';
      document.getElementById('toolbox')!.style.display = 'block';

      // Setup toolbox event listeners
      setupToolboxEventListeners();
    } else {
      throw new Error('Failed to join game');
    }
  } catch (err) {
    console.error('Error joining game:', err);

    // Reset button state
    startBtn.textContent = originalText;
    startBtn.disabled = false;

    // Show error message
    showToast('Failed to join game. Please try again.', 'error');
  }
}

// How to Play modal functions
function showHowToPlay(): void {
  document.getElementById('how-to-play-modal')!.style.display = 'block';
}

function closeHowToPlay(): void {
  document.getElementById('how-to-play-modal')!.style.display = 'none';
}

// Start polling for game updates
function startGameUpdates(): void {
  if (updateInterval) {
    clearInterval(updateInterval);
  }

  updateInterval = setInterval(async () => {
    try {
      const response = await fetch('/api/init');
      if (response.ok) {
        const data = (await response.json()) as InitResponse;
        if (data.type === 'init') {
          const newGameState = data.gameState;

          // Check for new shapes placed by other players
          if (newGameState.shapes.length > lastShapeCount) {
            const newShapes = newGameState.shapes.slice(lastShapeCount);
            newShapes.forEach(shape => {
              if (shape.playerId !== username) {
                showToast(`${shape.playerId} placed a ${shape.color} ${shape.type}`, 'info');
              }
            });
          }

          lastShapeCount = newGameState.shapes.length;
          gameState = newGameState;
          updateGameDisplay();
        }
      }
    } catch (err) {
      console.error('Error polling for updates:', err);
    }
  }, 2000); // Poll every 2 seconds
}

async function placeShape(type: ShapeType, color: ShapeColor, position: Position3D): Promise<void> {
  try {
    const request: PlaceShapeRequest = { type, color, position };
    const response = await fetch('/api/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = (await response.json()) as PlaceShapeResponse;
    if (data.success) {
      gameState = data.gameState;
      updateGameDisplay();

      // Show success toast for all users
      if (data.message) {
        showToast(data.message, 'success');
      }
    } else {
      // Show error notification for position occupied
      if (data.message) {
        showToast(data.message, 'error');
      }
    }
  } catch (err) {
    console.error('Error placing shape:', err);
    showToast('Failed to place shape. Please try again.', 'error');
  }
}

// Update game display
function updateGameDisplay(): void {
  if (!gameState) return;

  // Update leaderboard
  updateLeaderboard();

  // Clear existing shapes
  placedShapes.forEach(mesh => scene.remove(mesh));
  placedShapes.clear();

  // Add all placed shapes
  gameState.shapes.forEach(shape => {
    const mesh = createShape(shape.type, shape.color, shape.position);
    scene.add(mesh);
    placedShapes.set(shape.id, mesh);
  });

  // Update challenge highlights
  challengeHighlights.forEach(highlight => scene.remove(highlight));
  challengeHighlights.length = 0;

  if (gameState.currentChallenge) {
    gameState.currentChallenge.positions.forEach((pos, index) => {
      // Check if this position already has the correct shape placed
      const requiredShape = gameState?.currentChallenge?.shapes[index];
      const requiredColor = gameState?.currentChallenge?.colors[index];

      const isPositionCompleted = gameState?.shapes.some(shape =>
        shape.position.x === pos.x &&
        shape.position.y === pos.y &&
        shape.position.z === pos.z &&
        shape.type === requiredShape &&
        shape.color === requiredColor
      );

      // Only show highlights for incomplete positions
      if (!isPositionCompleted) {
        // Create the yellow ring highlight - Larger to match bigger shapes
        const highlightGeometry = new THREE.RingGeometry(0.6, 0.9, 8);
        const highlightMaterial = new THREE.MeshBasicMaterial({
          color: 0xffff00,
          transparent: true,
          opacity: 0.7
        });
        const highlight = new THREE.Mesh(highlightGeometry, highlightMaterial);
        // Center highlight in grid square with new spacing
        highlight.position.set(
          (pos.x + 0.5) * GRID_SPACING,
          pos.y + 0.01,
          (pos.z + 0.5) * GRID_SPACING
        );
        highlight.rotation.x = -Math.PI / 2;

        scene.add(highlight);
        challengeHighlights.push(highlight);

        // Create the required shape preview
        if (requiredShape && requiredColor) {
          const previewShape = createShape(requiredShape, requiredColor, pos, true);
          // No additional Y offset - let createShape handle proper positioning

          // Make it glow/pulse to indicate it's a target
          const glowMaterial = previewShape.material as THREE.MeshLambertMaterial;
          glowMaterial.emissive = new THREE.Color(0x222222);

          scene.add(previewShape);
          challengeHighlights.push(previewShape);
        }
      }
    });

    // Show challenge info only if game has started
    if (gameStarted) {
      document.getElementById('challenge-info')!.style.display = 'block';
      updateChallengeInfo(gameState.currentChallenge);
    }
  } else {
    // Hide challenge info when no active challenge
    document.getElementById('challenge-info')!.style.display = 'none';

    // Show brief completion message if we just completed a challenge
    if (challengeHighlights.length > 0) {
      showChallengeCompletionMessage();
    }
  }
}

// Update challenge info with specific shapes and colors
function updateChallengeInfo(challenge: any): void {
  const challengeTitle = document.querySelector('.challenge-title') as HTMLElement;
  const challengeDesc = document.querySelector('.challenge-desc') as HTMLElement;

  if (challengeTitle && challengeDesc && challenge && gameState) {
    // Count completed positions
    let completedCount = 0;
    const totalCount = challenge.positions.length;

    challenge.positions.forEach((pos: Position3D, index: number) => {
      const requiredShape = challenge.shapes[index];
      const requiredColor = challenge.colors[index];

      const isCompleted = gameState!.shapes.some(shape =>
        shape.position.x === pos.x &&
        shape.position.y === pos.y &&
        shape.position.z === pos.z &&
        shape.type === requiredShape &&
        shape.color === requiredColor
      );

      if (isCompleted) completedCount++;
    });

    challengeTitle.textContent = `Challenge (${completedCount}/${totalCount})`;

    // Show only remaining requirements
    const remainingRequirements = challenge.shapes
      .map((shape: string, index: number) => {
        const pos = challenge.positions[index];
        const color = challenge.colors[index];

        const isCompleted = gameState!.shapes.some(s =>
          s.position.x === pos.x &&
          s.position.y === pos.y &&
          s.position.z === pos.z &&
          s.type === shape &&
          s.color === color
        );

        if (!isCompleted) {
          const shapeIcon = getShapeIcon(shape);
          return `${shapeIcon} ${color}`;
        }
        return null;
      })
      .filter((req: string | null) => req !== null);

    if (remainingRequirements.length > 0) {
      challengeDesc.textContent = `Place: ${remainingRequirements.join(', ')}`;
    } else {
      challengeDesc.textContent = 'Challenge Complete!';
    }
  }
}

// Get shape icon for display
function getShapeIcon(shapeType: string): string {
  switch (shapeType) {
    case 'cube': return '■';
    case 'triangle': return '▲';
    case 'sphere': return '⬤';
    default: return '?';
  }
}



// Show challenge completion feedback
function showChallengeCompletionMessage(): void {
  const completionMsg = document.createElement('div');
  completionMsg.className = 'challenge-completion';
  completionMsg.innerHTML = `
    <div class="completion-icon">🎉</div>
    <div class="completion-text">Challenge Completed!</div>
    <div class="completion-subtext">Next challenge in 30 seconds</div>
  `;

  document.body.appendChild(completionMsg);

  // Remove message after 3 seconds
  setTimeout(() => {
    if (completionMsg.parentNode) {
      completionMsg.parentNode.removeChild(completionMsg);
    }
  }, 3000);
}

// Show toast notification
function showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-message">${message}</div>
  `;

  // Add to toast container or create one
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }

  toastContainer.appendChild(toast);

  // Animate in
  setTimeout(() => toast.classList.add('toast-show'), 100);

  // Remove after 4 seconds
  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 4000);
}

// Toolbox setup
function setupToolbox(): void {
  const shapes: ShapeType[] = ['cube', 'triangle', 'sphere'];
  const colors: ShapeColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];

  const shapeButtons = document.getElementById('shape-buttons')!;
  const colorButtons1 = document.getElementById('color-buttons-1')!;
  const colorButtons2 = document.getElementById('color-buttons-2')!;

  // Shape icons mapping
  const shapeIcons: Record<ShapeType, string> = {
    cube: '■',       // Black square for cube
    triangle: '▲',   // Black triangle
    sphere: '⬤'      // Larger black circle for sphere
  };

  // Setup shape buttons
  shapes.forEach(shape => {
    const btn = document.createElement('button');
    btn.textContent = shapeIcons[shape];
    btn.title = shape.charAt(0).toUpperCase() + shape.slice(1); // Tooltip with shape name
    btn.className = shape === selectedShape ? 'selected' : '';
    btn.onclick = () => {
      selectedShape = shape;
      document.querySelectorAll('#shape-buttons button').forEach(b => b.className = '');
      btn.className = 'selected';
      updatePlaceButtonText();
    };
    shapeButtons.appendChild(btn);
  });

  // Setup color buttons - first 3 colors in row 1
  colors.slice(0, 3).forEach(color => {
    const btn = document.createElement('button');
    btn.style.backgroundColor = color;
    btn.className = color === selectedColor ? 'selected' : '';
    btn.onclick = () => {
      selectedColor = color;
      document.querySelectorAll('#color-buttons-1 button, #color-buttons-2 button').forEach(b => b.className = '');
      btn.className = 'selected';
    };
    colorButtons1.appendChild(btn);
  });

  // Setup color buttons - last 3 colors in row 2
  colors.slice(3, 6).forEach(color => {
    const btn = document.createElement('button');
    btn.style.backgroundColor = color;
    btn.className = color === selectedColor ? 'selected' : '';
    btn.onclick = () => {
      selectedColor = color;
      document.querySelectorAll('#color-buttons-1 button, #color-buttons-2 button').forEach(b => b.className = '');
      btn.className = 'selected';
    };
    colorButtons2.appendChild(btn);
  });

  updatePlaceButtonText();
}

// Update place button text based on selected shape
function updatePlaceButtonText(): void {
  const placeBtn = document.getElementById('place-btn') as HTMLButtonElement;
  if (placeBtn) {
    placeBtn.textContent = `Place ${selectedShape.charAt(0).toUpperCase() + selectedShape.slice(1)}`;
  }
}

// Toggle toolbox content with slide animation
function toggleToolboxContent(): void {
  console.log('Toggle toolbox content called');
  const toolbox = document.getElementById('toolbox');
  const toggleBtn = document.getElementById('toolbox-toggle');

  if (!toolbox || !toggleBtn) {
    console.error('Toolbox or toggle button not found');
    return;
  }

  console.log('Current collapsed state:', toolbox.classList.contains('collapsed'));

  if (toolbox.classList.contains('collapsed')) {
    // Expand - slide up
    toolbox.classList.remove('collapsed');
    toggleBtn.textContent = '▼';
    console.log('Expanded toolbox');
  } else {
    // Collapse - slide down
    toolbox.classList.add('collapsed');
    toggleBtn.textContent = '▲';
    console.log('Collapsed toolbox');
  }
}



// Validate if placement is allowed at current position
function validatePlacement(position: Position3D, shapeType: ShapeType, shapeColor: ShapeColor): { valid: boolean; message?: string } {
  if (!gameState?.currentChallenge) {
    return { valid: false, message: 'No active challenge! Wait for the next challenge to start.' };
  }

  const challenge = gameState.currentChallenge;

  // Find if this position matches any challenge position
  const challengeIndex = challenge.positions.findIndex(pos =>
    pos.x === position.x && pos.y === position.y && pos.z === position.z
  );

  if (challengeIndex === -1) {
    return { valid: false, message: 'You can only place shapes at the highlighted challenge positions!' };
  }

  // Check if the shape type matches
  const requiredShape = challenge.shapes[challengeIndex];
  if (!requiredShape || requiredShape !== shapeType) {
    const shapeNames: Record<ShapeType, string> = { cube: 'Cube', triangle: 'Triangle', sphere: 'Sphere' };
    return {
      valid: false,
      message: `Wrong shape! This position requires a ${requiredShape ? shapeNames[requiredShape] : 'unknown shape'}, but you selected a ${shapeNames[shapeType]}.`
    };
  }

  // Check if the color matches
  const requiredColor = challenge.colors[challengeIndex];
  if (requiredColor !== shapeColor) {
    return {
      valid: false,
      message: `Wrong color! This position requires ${requiredColor}, but you selected ${shapeColor}.`
    };
  }

  return { valid: true };
}

// Place current shape
function placeCurrentShape(): void {
  console.log('Place button clicked!');
  console.log('Game started:', gameStarted);
  console.log('Preview shape exists:', !!previewShape);
  console.log('Preview mode:', isPreviewMode);
  console.log('Selected shape:', selectedShape);
  console.log('Selected color:', selectedColor);

  if (gameStarted && previewShape) {
    const position = isPreviewMode ? previewPosition : {
      x: previewShape.position.x / GRID_SPACING - 0.5, // Convert back from world to grid coordinates
      y: previewShape.position.y - 0.6,
      z: previewShape.position.z / GRID_SPACING - 0.5
    };

    // Validate placement before attempting
    const validation = validatePlacement(position, selectedShape, selectedColor);
    if (!validation.valid) {
      showToast(validation.message!, 'error');
      return;
    }

    console.log('Placing shape at position:', position);
    placeShape(selectedShape, selectedColor, position);
  } else {
    console.log('Cannot place shape - game not started or no preview shape');
  }
}

// Event listeners
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('mousemove', onMouseMove);
window.addEventListener('click', onClick);

// Mouse controls for camera
window.addEventListener('mousedown', (event) => {
  if (event.button === 0) { // Left mouse button
    isMouseDown = true;
    mouseX = event.clientX;
    mouseY = event.clientY;
  }
});

window.addEventListener('mouseup', () => {
  isMouseDown = false;
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (updateInterval) {
    clearInterval(updateInterval);
  }
});

// Keyboard controls for preview movement
window.addEventListener('keydown', (event) => {
  if (!gameStarted) return;

  switch (event.key.toLowerCase()) {
    case 'w':
      movePreview('up');
      isPreviewMode = true;
      break;
    case 's':
      movePreview('down');
      isPreviewMode = true;
      break;
    case 'a':
      movePreview('left');
      isPreviewMode = true;
      break;
    case 'd':
      movePreview('right');
      isPreviewMode = true;
      break;
    case 'q':
      movePreview('higher');
      isPreviewMode = true;
      break;
    case 'e':
      movePreview('lower');
      isPreviewMode = true;
      break;
    case 'arrowup':
      movePreview('higher');
      isPreviewMode = true;
      break;
    case 'arrowdown':
      movePreview('lower');
      isPreviewMode = true;
      break;
    case 'arrowleft':
      movePreview('left');
      isPreviewMode = true;
      break;
    case 'arrowright':
      movePreview('right');
      isPreviewMode = true;
      break;
    case ' ':
      event.preventDefault();
      if (previewShape) {
        // Validate placement before attempting
        const validation = validatePlacement(previewPosition, selectedShape, selectedColor);
        if (!validation.valid) {
          showToast(validation.message!, 'error');
          return;
        }
        placeShape(selectedShape, selectedColor, previewPosition);
      }
      break;
  }
});

document.getElementById('start-btn')!.addEventListener('click', joinGame);
document.getElementById('how-to-play-btn')!.addEventListener('click', showHowToPlay);

// Setup modal buttons immediately on page load
setupModalButtons();

// Add event listener for toolbox toggle when the game starts
function setupToolboxEventListeners(): void {
  const toggleBtn = document.getElementById('toolbox-toggle');
  if (toggleBtn) {
    // Remove any existing listeners
    toggleBtn.removeEventListener('click', toggleToolboxContent);
    // Add the event listener
    toggleBtn.addEventListener('click', toggleToolboxContent);
    console.log('Toolbox toggle event listener added');

    // Test that the button is clickable
    toggleBtn.style.cursor = 'pointer';
    toggleBtn.style.border = '1px solid red'; // Temporary debug border
  } else {
    console.error('Toolbox toggle button not found!');
  }

  // Add event listeners for movement buttons (only once)
  setTimeout(() => {
    setupMovementButtons();
    setupPlaceButton();
    setupModalButtons();
  }, 100);
}

// Setup place button event listener as backup
function setupPlaceButton(): void {
  const placeBtn = document.getElementById('place-btn');
  if (placeBtn) {
    placeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('Place button clicked via event listener');
      placeCurrentShape();
    });
    console.log('Place button event listener added');
  } else {
    console.error('Place button not found!');
  }
}

// Setup modal button event listeners as backup
function setupModalButtons(): void {
  // Close button for how to play modal
  const closeBtn = document.querySelector('.close');
  if (closeBtn) {
    // Remove any existing onclick to avoid conflicts
    closeBtn.removeAttribute('onclick');
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('Close button clicked via event listener');
      closeHowToPlay();
    });
    console.log('Close button event listener added');
  } else {
    console.error('Close button not found!');
  }

  // Also close modal when clicking outside of it
  const modal = document.getElementById('how-to-play-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeHowToPlay();
      }
    });
    console.log('Modal background click listener added');
  }
}

// Setup movement button event listeners with both click and long press
function setupMovementButtons(): void {
  const movementButtons = document.querySelectorAll('.move-btn');
  console.log('Found movement buttons:', movementButtons.length);

  let moveInterval: NodeJS.Timeout | null = null;
  let longPressTimer: NodeJS.Timeout | null = null;

  movementButtons.forEach((button, index) => {
    const btn = button as HTMLButtonElement;
    const direction = getDirectionFromButton(btn);

    if (direction) {
      // Mouse down - start long press detection
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();

        // First immediate move
        movePreview(direction);
        console.log('Movement button pressed:', direction);

        // Start long press timer
        longPressTimer = setTimeout(() => {
          console.log('Started continuous movement:', direction);

          // Start continuous movement
          moveInterval = setInterval(() => {
            movePreview(direction);
          }, 150); // Move every 150ms while held
        }, 300); // Wait 300ms before starting continuous movement
      });

      // Mouse up - stop long press
      btn.addEventListener('mouseup', () => {
        stopMovement();
      });

      // Mouse leave - stop long press (safety)
      btn.addEventListener('mouseleave', () => {
        stopMovement();
      });

      // Click handler - only for single clicks (not long press)
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Don't do anything here - mousedown already handled the movement
      });

      console.log(`Added listeners for button ${index}: ${direction}`);
    }
  });

  // Stop movement function
  function stopMovement() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    if (moveInterval) {
      clearInterval(moveInterval);
      moveInterval = null;
      console.log('Stopped continuous movement');
    }
  }

  // Also stop movement on window mouse up (safety)
  window.addEventListener('mouseup', stopMovement);
}

// Get direction from button text
function getDirectionFromButton(button: HTMLButtonElement): 'up' | 'down' | 'left' | 'right' | 'higher' | 'lower' | null {
  const text = button.textContent?.trim();
  switch (text) {
    case '↑': return 'up';
    case '↓': return 'down';
    case '←': return 'left';
    case '→': return 'right';
    case '▲': return 'higher';
    case '▼': return 'lower';
    default: return null;
  }
}

// Animation loop
function animate(): void {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

// Make functions globally accessible for HTML onclick handlers
(window as any).movePreview = movePreview;
(window as any).setCameraPerspective = setCameraPerspective;
(window as any).showHowToPlay = showHowToPlay;
(window as any).closeHowToPlay = closeHowToPlay;
(window as any).toggleToolboxContent = toggleToolboxContent;
(window as any).placeCurrentShape = placeCurrentShape;

// Update leaderboard display
function updateLeaderboard(): void {
  if (!gameState) return;

  const leaderboardList = document.getElementById('leaderboard-list');
  if (!leaderboardList) return;

  if (gameState.leaderboard.length === 0) {
    leaderboardList.innerHTML = '<div class="leaderboard-empty">No scores yet - be the first to complete a challenge!</div>';
    return;
  }

  leaderboardList.innerHTML = gameState.leaderboard
    .slice(0, 10) // Show top 10 players
    .map((player, index) => {
      const isCurrentUser = player.playerId === username;
      return `
        <div class="leaderboard-entry ${isCurrentUser ? 'current-user' : ''}">
          <span class="leaderboard-rank">#${index + 1}</span>
          <span class="leaderboard-name">${player.playerId}</span>
          <span class="leaderboard-score">${player.score}</span>
        </div>
      `;
    })
    .join('');
}

// Initialize
void initGame();
setupToolbox();
animate();
