import * as THREE from 'three';
import { connectRealtime } from '@devvit/web/client';
import { context } from '@devvit/web/client';

// Access postId directly from context

import {
  InitResponse,
  JoinGameResponse,
  PlaceShapeResponse,
  PlaceShapeRequest,
  ShapeType,
  ShapeColor,
  Position3D,
  GameState
} from '../shared/types/api';

let postId = context.postId;

let realtimeConnection: { disconnect: () => Promise<void> } | null = null;

// Game state
let gameState: GameState | null = null;
let username: string = '';
let gameStarted = false;

// let realtimeConnection: any = null;

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
// No scene background - using transparent renderer to show CSS gradient

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(22, 22, 22); // Moved back to accommodate larger grid
camera.lookAt(0, 0, 0);

// Create arena background with large shapes
function createArenaBackground(): void {
  const arenaShapes: THREE.Mesh[] = [];

  // Large background cubes
  const cubeGeometry = new THREE.BoxGeometry(8, 8, 8);
  const cubeMaterial = new THREE.MeshLambertMaterial({
    color: 0x34495e,
    transparent: true,
    opacity: 0.3
  });

  // Large background spheres
  const sphereGeometry = new THREE.SphereGeometry(6, 16, 12);
  const sphereMaterial = new THREE.MeshLambertMaterial({
    color: 0x3498db,
    transparent: true,
    opacity: 0.2
  });

  // Large background triangles (cones)
  const triangleGeometry = new THREE.ConeGeometry(5, 10, 3);
  const triangleMaterial = new THREE.MeshLambertMaterial({
    color: 0xe74c3c,
    transparent: true,
    opacity: 0.25
  });

  // Position large shapes around the arena
  const positions = [
    { x: -40, y: 15, z: -40 },
    { x: 40, y: 20, z: -40 },
    { x: -40, y: 18, z: 40 },
    { x: 40, y: 12, z: 40 },
    { x: 0, y: 25, z: -50 },
    { x: -50, y: 10, z: 0 },
    { x: 50, y: 22, z: 0 },
    { x: 0, y: 16, z: 50 }
  ];

  positions.forEach((pos, index) => {
    let mesh: THREE.Mesh;
    const shapeType = index % 3;

    if (shapeType === 0) {
      mesh = new THREE.Mesh(cubeGeometry, cubeMaterial);
    } else if (shapeType === 1) {
      mesh = new THREE.Mesh(sphereGeometry, sphereMaterial);
    } else {
      mesh = new THREE.Mesh(triangleGeometry, triangleMaterial);
    }

    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.rotation.x = Math.random() * Math.PI;
    mesh.rotation.y = Math.random() * Math.PI;
    mesh.rotation.z = Math.random() * Math.PI;

    scene.add(mesh);
    arenaShapes.push(mesh);
  });

  // Add subtle rotation animation to background shapes
  function animateArenaShapes(): void {
    arenaShapes.forEach((shape, index) => {
      shape.rotation.x += 0.001 * (index % 2 === 0 ? 1 : -1);
      shape.rotation.y += 0.002 * (index % 3 === 0 ? 1 : -1);
    });
  }

  // Store the animation function globally so it can be called from the main animate loop
  (window as any).animateArenaShapes = animateArenaShapes;
}

// Initialize arena background
createArenaBackground();

// Camera controls
let isMouseDown = false;
let mouseX = 0;
let mouseY = 0;
const cameraDistance = 35; // Increased for larger grid
let cameraAngleX = Math.PI / 6; // 30 degrees
let cameraAngleY = Math.PI / 4; // 45 degrees

const renderer = new THREE.WebGLRenderer({ antialias: true, canvas, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio ?? 1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0); // Transparent background
// Shadows disabled for cleaner look
renderer.shadowMap.enabled = false;

// Arena Lighting
const ambientLight = new THREE.AmbientLight(0x404040, 0.4); // Dimmer ambient for arena feel
scene.add(ambientLight);

// Main directional light (like arena spotlights)
const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
directionalLight.position.set(10, 30, 5);
scene.add(directionalLight);

// Additional arena spotlights
const spotlight1 = new THREE.DirectionalLight(0x3498db, 0.3);
spotlight1.position.set(-20, 25, -20);
scene.add(spotlight1);

const spotlight2 = new THREE.DirectionalLight(0xe74c3c, 0.3);
spotlight2.position.set(20, 25, 20);
scene.add(spotlight2);

// Subtle colored rim lighting
const rimLight = new THREE.DirectionalLight(0x9b59b6, 0.2);
rimLight.position.set(0, 10, -30);
scene.add(rimLight);

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

// Camera animation state
let isAnimatingCamera = false;
let animationStartTime = 0;
let startAngleX = 0;
let startAngleY = 0;
let targetAngleX = 0;
let targetAngleY = 0;
const CAMERA_ANIMATION_DURATION = 800; // 800ms for smooth transition

// Camera control functions
function updateCameraPosition(): void {
  const x = Math.cos(cameraAngleY) * Math.cos(cameraAngleX) * cameraDistance;
  const y = Math.sin(cameraAngleX) * cameraDistance;
  const z = Math.sin(cameraAngleY) * Math.cos(cameraAngleX) * cameraDistance;

  camera.position.set(x, y, z);
  camera.lookAt(0, 0, 0);
}

// Smooth camera animation function
function animateCameraToPosition(newAngleX: number, newAngleY: number): void {
  if (isAnimatingCamera) return; // Prevent multiple animations

  startAngleX = cameraAngleX;
  startAngleY = cameraAngleY;
  targetAngleX = newAngleX;
  targetAngleY = newAngleY;

  // Handle Y angle wrapping for shortest path
  let deltaY = targetAngleY - startAngleY;
  if (deltaY > Math.PI) {
    targetAngleY -= Math.PI * 2;
  } else if (deltaY < -Math.PI) {
    targetAngleY += Math.PI * 2;
  }

  isAnimatingCamera = true;
  animationStartTime = Date.now();
}

// Easing function for smooth animation
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Update camera animation (called from main animation loop)
function updateCameraAnimation(): void {
  if (!isAnimatingCamera) return;

  const elapsed = Date.now() - animationStartTime;
  const progress = Math.min(elapsed / CAMERA_ANIMATION_DURATION, 1);
  const easedProgress = easeInOutCubic(progress);

  // Interpolate angles
  cameraAngleX = startAngleX + (targetAngleX - startAngleX) * easedProgress;
  cameraAngleY = startAngleY + (targetAngleY - startAngleY) * easedProgress;

  updateCameraPosition();

  // Check if animation is complete
  if (progress >= 1) {
    isAnimatingCamera = false;
    cameraAngleX = targetAngleX;
    cameraAngleY = targetAngleY;

    // Normalize Y angle after animation
    while (cameraAngleY >= Math.PI * 2) cameraAngleY -= Math.PI * 2;
    while (cameraAngleY < 0) cameraAngleY += Math.PI * 2;
  }
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
    // Valid placement - show in selected color with very subtle green tint
    material.opacity = 0.8;
    material.emissive = new THREE.Color(0x001100); // Very subtle green glow
  } else {
    // Invalid placement - show in selected color with very subtle red tint
    material.opacity = 0.6;
    material.emissive = new THREE.Color(0x110000); // Very subtle red glow
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
// Camera rotation functions
function rotateCamera(direction: 'horizontal' | 'up' | 'down'): void {
  if (isAnimatingCamera) {
    return;
  }

  let newAngleX = cameraAngleX;
  let newAngleY = cameraAngleY;

  switch (direction) {
    case 'horizontal':
      // Rotate 90 degrees to the right around Y axis
      newAngleY = cameraAngleY + Math.PI / 2;
      break;
    case 'up':
      // Look up by 30 degrees, but clamp to prevent going too high
      newAngleX = Math.min(Math.PI / 2 - 0.1, cameraAngleX + Math.PI / 6);
      break;
    case 'down':
      // Look down by 30 degrees, but clamp to prevent going too low
      newAngleX = Math.max(-Math.PI / 3, cameraAngleX - Math.PI / 6);
      break;
  }

  // Start smooth animation to new position
  animateCameraToPosition(newAngleX, newAngleY);

  // Remove active state from reset button when rotating
  document.querySelectorAll('.camera-btn').forEach(btn => {
    btn.classList.remove('camera-btn-active');
  });
}

function resetCamera(): void {
  if (isAnimatingCamera) {
    return;
  }

  // Animate to default isometric view
  animateCameraToPosition(Math.PI / 6, Math.PI / 4);

  // Update active button state
  document.querySelectorAll('.camera-btn').forEach(btn => {
    btn.classList.remove('camera-btn-active');
  });

  // Add active class to reset button
  const resetButton = Array.from(document.querySelectorAll('.camera-btn')).find(
    btn => btn.textContent?.trim() === '⌂'
  );

  if (resetButton) {
    resetButton.classList.add('camera-btn-active');
  }
}

// Keep the old function for backward compatibility but make it use the new system
function setCameraPerspective(angle: 'top' | 'front' | 'side' | 'iso'): void {
  if (isAnimatingCamera) {
    return;
  }

  let newAngleX: number;
  let newAngleY: number;

  switch (angle) {
    case 'top':
      newAngleX = Math.PI / 2 - 0.1;
      newAngleY = 0;
      break;
    case 'front':
      newAngleX = 0;
      newAngleY = 0;
      break;
    case 'side':
      newAngleX = 0;
      newAngleY = Math.PI / 2;
      break;
    case 'iso':
      resetCamera();
      return;
  }

  // Start smooth animation to new position
  animateCameraToPosition(newAngleX, newAngleY);

  // Remove active state from all camera buttons
  document.querySelectorAll('.camera-btn').forEach(btn => {
    btn.classList.remove('camera-btn-active');
  });
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
      postId = postId;
      gameState = data.gameState;
      updateGameDisplay();

      // Automatically join the game
      await joinGame();


    }
  } catch (err) {
    console.error('Error initializing game:', err);
    showToast('Failed to initialize game', 'error');
  }
}

async function joinGame(): Promise<void> {
  try {
    const response = await fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = (await response.json()) as JoinGameResponse;
    if (data.success) {
      gameState = data.gameState;
      gameStarted = true;
      updateGameDisplay();

      // Initialize preview mode
      isPreviewMode = true;
      updatePreviewShape();

      // Start real-time connection after username is set
      await startRealtimeConnection();

      // Setup toolbox event listeners
      setupToolboxEventListeners();
    } else {
      throw new Error('Failed to join game');
    }
  } catch (err) {
    console.error('Error joining game:', err);
    showToast('Failed to join game. Please try again.', 'error');
  }
}





// Simple realtime connection based on docs
async function startRealtimeConnection(): Promise<void> {
  if (!postId) {
    return;
  }

  const channel = `game${postId}`;

  try {

    realtimeConnection = await connectRealtime({
      channel: channel,
      onConnect: () => {
        showToast('Connected to live updates!', 'success');
      },
      onDisconnect: () => {
        showToast('Disconnected from live updates', 'info');
      },
      onMessage: (data) => {
        if (data && typeof data === 'object') {
          const msg = data as any;

          if (msg.type === 'test') {
            showToast(`Test: ${msg.message}`, 'info');
          } else if (msg.type === 'shapePlace') {
            if (msg.shape?.playerId !== username) {
              if (msg.gameState) {
                gameState = msg.gameState;
                updateGameDisplay();
                showToast(`${msg.playerName} placed a shape`, 'info');
              }
            }
          } else if (msg.type === 'newChallenge') {
            if (msg.gameState) {
              gameState = msg.gameState;
              updateGameDisplay();
              showToast('New challenge started!', 'success');
            }
          } else if (msg.type === 'gameComplete') {
            if (msg.gameState) {
              gameState = msg.gameState;
              updateGameDisplay();
              showToast('Game completed!', 'success');
            }
          }
        }
      }
    });
  } catch (error) {
    showToast('Failed to connect to live updates', 'error');
  }
}

// Test function to trigger a broadcast from server
async function testRealtimeBroadcast(): Promise<void> {
  try {
    const response = await fetch('/api/test-broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    showToast('Test broadcast sent!', 'success');
  } catch (error) {
    showToast('Test broadcast failed', 'error');
  }
}

// Make test function globally accessible for console testing
if (typeof window !== 'undefined') {
  (window as any).testRealtimeBroadcast = testRealtimeBroadcast;
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
      // Update local game state immediately for current player
      const oldChallengeId = gameState?.currentChallenge?.id;
      gameState = data.gameState;
      updateGameDisplay();

      // Show success toast for current player only
      if (data.message) {
        const toastType = data.isFirstPlacement ? 'success' : 'success';
        showToast(data.message, toastType);
      }

      // Show special first place bonus notification
      if (data.isFirstPlacement) {
        setTimeout(() => {
          showFirstPlaceBonusNotification();
        }, 1000);
      }

      // Check for challenge state changes for current player
      const newChallengeId = gameState.currentChallenge?.id;

      if (oldChallengeId && !newChallengeId) {
        showToast('Challenge completed!', 'success');
      } else if (oldChallengeId && newChallengeId && oldChallengeId !== newChallengeId) {
        showToast('Challenge completed! New challenge started!', 'success');
      } else if (!oldChallengeId && newChallengeId) {
        showToast('New challenge started!', 'success');
      }

      // Note: Other players will receive updates via real-time events
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
  if (!gameState) {
    return;
  }



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

    // Show enhanced challenge info whenever there's an active challenge
    const challengeInfoElement = document.getElementById('challenge-info');
    if (challengeInfoElement) {
      challengeInfoElement.style.display = 'block';

      // Setup help button event listener now that challenge card is visible
      setupHelpButton();
    }
    updateChallengeInfo(gameState.currentChallenge);

    // Hide game over display when there's an active challenge
    document.getElementById('game-over-display')!.style.display = 'none';
  } else {
    // Hide challenge info when no active challenge
    document.getElementById('challenge-info')!.style.display = 'none';

    // Check if game is completed (no active challenge and reached max rounds)
    if (gameState.currentRound >= gameState.totalRounds) {
      showGameOverDisplay();
    } else {
      // Hide game over display if not completed
      document.getElementById('game-over-display')!.style.display = 'none';
    }

    // Show enhanced completion message if we just completed a challenge
    if (challengeHighlights.length > 0) {
      showEnhancedChallengeCompletion();
      showChallengeCompletionMessage();
    }
  }
}

// Update enhanced challenge info card
function updateChallengeInfo(challenge: any): void {
  if (!challenge || !gameState) return;

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

  // Update progress bar
  const progressFill = document.getElementById('progress-fill') as HTMLElement;
  const progressText = document.getElementById('progress-text') as HTMLElement;

  if (progressFill && progressText) {
    const progressPercent = (completedCount / totalCount) * 100;
    progressFill.style.width = `${progressPercent}%`;
    progressText.textContent = `${completedCount}/${totalCount} Complete`;
  }

  // Update requirements list
  const requirementsList = document.getElementById('requirements-list') as HTMLElement;
  if (requirementsList) {
    const requirementItems = challenge.shapes.map((shape: string, index: number) => {
      const pos = challenge.positions[index];
      const color = challenge.colors[index];

      const isCompleted = gameState!.shapes.some(s =>
        s.position.x === pos.x &&
        s.position.y === pos.y &&
        s.position.z === pos.z &&
        s.type === shape &&
        s.color === color
      );

      const shapeIcon = getShapeIcon(shape);
      const completedClass = isCompleted ? 'completed' : '';

      return `
        <div class="requirement-item ${completedClass}">
          <span class="requirement-shape">${shapeIcon}</span>
          <span class="requirement-color">${color}</span>
        </div>
      `;
    }).join('');

    requirementsList.innerHTML = requirementItems;
  }

  // Update challenge title
  const challengeTitle = document.querySelector('.challenge-title') as HTMLElement;
  if (challengeTitle) {
    if (completedCount === totalCount) {
      challengeTitle.textContent = 'Challenge Complete! 🎉';
    } else {
      challengeTitle.textContent = `Challenge Active! (${completedCount}/${totalCount})`;
    }
  }

  // No timer needed - challenges run until completed
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

// Timer display removed - challenges no longer have timeouts

// Enhanced challenge completion with card animation
function showEnhancedChallengeCompletion(): void {
  const challengeCard = document.getElementById('challenge-info') as HTMLElement;
  if (challengeCard) {
    // Add completion animation
    challengeCard.style.animation = 'challengeComplete 1s ease-out';

    // Update card content for completion
    const challengeTitle = document.querySelector('.challenge-title') as HTMLElement;
    const statusIndicator = document.querySelector('.status-indicator') as HTMLElement;

    if (challengeTitle) {
      challengeTitle.textContent = 'Challenge Complete! 🎉';
    }

    if (statusIndicator) {
      statusIndicator.style.background = '#4caf50';
      statusIndicator.style.animation = 'completionGlow 0.5s ease-in-out infinite';
    }

    // Reset animation after completion
    setTimeout(() => {
      challengeCard.style.animation = 'challengeCardPulse 2s ease-in-out infinite';
    }, 1000);
  }
}



// Show challenge completion feedback
function showChallengeCompletionMessage(): void {
  const completionMsg = document.createElement('div');
  completionMsg.className = 'challenge-completion';
  completionMsg.innerHTML = `
    <div class="completion-icon">🎉</div>
    <div class="completion-text">Challenge Completed!</div>
    <div class="completion-subtext">Next challenge starting soon...</div>
  `;

  document.body.appendChild(completionMsg);

  // Remove message after 3 seconds
  setTimeout(() => {
    if (completionMsg.parentNode) {
      completionMsg.parentNode.removeChild(completionMsg);
    }
  }, 3000);
}

// Show first place bonus notification
function showFirstPlaceBonusNotification(): void {
  const bonusMsg = document.createElement('div');
  bonusMsg.className = 'first-place-bonus';
  bonusMsg.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 2px;">
      <span class="bonus-icon">🥇</span>
    </div>
    <div class="bonus-subtext">+1 Bonus Point</div>
  `;

  document.body.appendChild(bonusMsg);

  // Remove message after 2 seconds
  setTimeout(() => {
    if (bonusMsg.parentNode) {
      bonusMsg.parentNode.removeChild(bonusMsg);
    }
  }, 2000);
}

// Show game over display with leaderboard
function showGameOverDisplay(): void {
  const gameOverDisplay = document.getElementById('game-over-display');
  const gameOverStats = document.getElementById('game-over-stats');
  const leaderboardList = document.getElementById('game-over-leaderboard-list');


  if (!gameOverDisplay || !gameOverStats || !leaderboardList || !gameState) return;

  // Calculate game statistics
  const totalShapes = gameState.shapes.length;
  const playerCount = gameState.players.length;
  const totalRounds = gameState.totalRounds;

  // Update leaderboard display
  if (gameState.leaderboard.length > 0) {
    const leaderboardHTML = gameState.leaderboard.slice(0, 10).map((player, index) => {
      const rank = index + 1;
      let rankClass = '';
      let medal = '';

      if (rank === 1) {
        rankClass = 'first-place';
        medal = '🥇';
      } else if (rank === 2) {
        rankClass = 'second-place';
        medal = '🥈';
      } else if (rank === 3) {
        rankClass = 'third-place';
        medal = '🥉';
      } else {
        medal = `${rank}.`;
      }

      return `
        <div class="leaderboard-entry ${rankClass}">
          <div class="leaderboard-rank">
            <span class="rank-medal">${medal}</span>
          </div>
          <div class="leaderboard-player">${player.playerId}</div>
          <div class="leaderboard-score">${player.score} pts</div>
        </div>
      `;
    }).join('');

    leaderboardList.innerHTML = leaderboardHTML;
  } else {
    leaderboardList.innerHTML = '<div class="no-players">No players scored points</div>';
  }

  // Update stats content
  gameOverStats.innerHTML = `
    <div>🏗️ Total shapes placed: ${totalShapes}</div>
    <div>👥 Players participated: ${playerCount}</div>
    <div>🎯 Rounds completed: ${totalRounds}</div>
  `;

  // Show the display
  gameOverDisplay.style.display = 'block';

  // Setup explore button event listener
  setTimeout(() => {
    setupExploreButton();
  }, 100);

  console.log('Game over display with leaderboard shown');
}

// Close game over display
function closeGameOverDisplay(): void {
  console.log('closeGameOverDisplay called');
  const gameOverDisplay = document.getElementById('game-over-display');
  console.log('Game over display element:', gameOverDisplay);
  if (gameOverDisplay) {
    console.log('Current display style:', gameOverDisplay.style.display);
    gameOverDisplay.style.display = 'none';
    console.log('Game over display closed - display set to none');
  } else {
    console.error('Game over display element not found!');
  }
}

// Setup explore button and close button event listeners
function setupExploreButton(): void {
  // Setup explore button
  const exploreBtn = document.getElementById('explore-button');
  if (exploreBtn) {
    // Remove any existing listeners
    exploreBtn.removeEventListener('click', closeGameOverDisplay);

    // Add the event listener
    exploreBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      console.log('Explore button clicked!');
      closeGameOverDisplay();
    });

    console.log('Explore button event listener added');

    // Visual debugging - make sure it's clickable
    exploreBtn.style.cursor = 'pointer';
  } else {
    console.error('Explore button not found when trying to set up event listener');
  }

  // Setup close button (×)
  const closeBtn = document.getElementById('game-over-close-button');
  if (closeBtn) {
    closeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      console.log('Game over close button clicked!');
      closeGameOverDisplay();
    });
    console.log('Game over close button event listener added');
  } else {
    console.error('Game over close button not found');
  }

  // Click outside to close
  const gameOverModal = document.getElementById('game-over-display');
  if (gameOverModal) {
    gameOverModal.addEventListener('click', (event) => {
      if (event.target === gameOverModal) {
        console.log('Clicked outside game over modal');
        closeGameOverDisplay();
      }
    });
    console.log('Game over modal backdrop click listener added');
  }
}

// Make closeGameOverDisplay globally accessible immediately
(window as any).closeGameOverDisplay = closeGameOverDisplay;

// Open help modal
function openHelpModal(): void {
  console.log('openHelpModal called');
  const helpModal = document.getElementById('help-modal');
  console.log('Help modal element:', helpModal);
  if (helpModal) {
    helpModal.style.display = 'flex';
    console.log('Help modal opened - display set to flex');

    // Setup close button event listeners when modal is opened
    setTimeout(() => {
      setupHelpModalCloseButtons();
    }, 100);
  } else {
    console.error('Help modal element not found!');
  }
}

// Close help modal
function closeHelpModal(): void {
  console.log('closeHelpModal called');
  const helpModal = document.getElementById('help-modal');
  console.log('Help modal element found:', !!helpModal);
  if (helpModal) {
    console.log('Current display style:', helpModal.style.display);
    helpModal.style.display = 'none';
    console.log('Help modal closed - display set to none');
  } else {
    console.error('Help modal element not found when trying to close!');
  }
}

// Make functions globally accessible immediately
(window as any).openHelpModal = openHelpModal;
(window as any).closeHelpModal = closeHelpModal;

// Setup help button event listener
function setupHelpButton(): void {
  const helpBtn = document.getElementById('help-button');
  if (helpBtn) {
    // Remove any existing listeners
    helpBtn.removeEventListener('click', openHelpModal);

    // Add the event listener
    helpBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      console.log('Help button clicked!');
      openHelpModal();
    });

    console.log('Help button event listener added');

    // Visual debugging - make sure it's clickable
    helpBtn.style.cursor = 'pointer';
    helpBtn.style.border = '1px solid blue'; // Temporary debug border
  } else {
    console.error('Help button not found when trying to set up event listener');
  }
}

// Setup help modal close button event listeners
function setupHelpModalCloseButtons(): void {
  // Close button (×)
  const closeBtn = document.getElementById('help-close-button');
  if (closeBtn) {
    closeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      console.log('Help close button clicked!');
      closeHelpModal();
    });
    console.log('Help close button event listener added');
  }

  // Got it button
  const gotItBtn = document.getElementById('help-got-it-button');
  if (gotItBtn) {
    gotItBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      console.log('Got it button clicked!');
      closeHelpModal();
    });
    console.log('Help got it button event listener added');
  }

  // Click outside to close
  const helpModal = document.getElementById('help-modal');
  if (helpModal) {
    helpModal.addEventListener('click', (event) => {
      if (event.target === helpModal) {
        console.log('Clicked outside help modal');
        closeHelpModal();
      }
    });
    console.log('Help modal backdrop click listener added');
  }
}

// Make functions globally accessible
(window as any).closeGameOverDisplay = closeGameOverDisplay;
(window as any).openHelpModal = openHelpModal;
(window as any).closeHelpModal = closeHelpModal;

// Show toast notification
function showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = type === 'success' ? '' : type === 'error' ? '' : 'ℹ';
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
      // Update preview shape with new shape type
      if (gameStarted && isPreviewMode) {
        updatePreviewShape();
      }
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
      // Update preview shape with new color
      if (gameStarted && isPreviewMode) {
        updatePreviewShape();
      }
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
      // Update preview shape with new color
      if (gameStarted && isPreviewMode) {
        updatePreviewShape();
      }
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

// Touch controls for camera (mobile support)
let touchStartX = 0;
let touchStartY = 0;

window.addEventListener('touchstart', (event) => {
  if (event.touches.length === 1 && event.touches[0]) {
    isMouseDown = true;
    touchStartX = event.touches[0].clientX;
    touchStartY = event.touches[0].clientY;
    mouseX = touchStartX;
    mouseY = touchStartY;
  }
});

window.addEventListener('touchmove', (event) => {
  if (event.touches.length === 1 && isMouseDown && event.touches[0]) {
    const touch = event.touches[0];
    const deltaX = touch.clientX - mouseX;
    const deltaY = touch.clientY - mouseY;

    cameraAngleY += deltaX * 0.01;
    cameraAngleX += deltaY * 0.01;

    // Clamp vertical angle
    cameraAngleX = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, cameraAngleX));

    updateCameraPosition();

    mouseX = touch.clientX;
    mouseY = touch.clientY;

    // Prevent page scrolling while rotating camera
    event.preventDefault();
  }
}, { passive: false });

window.addEventListener('touchend', () => {
  isMouseDown = false;
});

window.addEventListener('touchcancel', () => {
  isMouseDown = false;
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

// Global keyboard shortcuts (work even when game not started)
window.addEventListener('keydown', (event) => {
  switch (event.key) {
    case 'Escape':
      // Close help modal if open
      const helpModal = document.getElementById('help-modal');
      if (helpModal && helpModal.style.display === 'flex') {
        closeHelpModal();
        event.preventDefault();
      }
      // Close game over display if open
      const gameOverDisplay = document.getElementById('game-over-display');
      if (gameOverDisplay && gameOverDisplay.style.display === 'block') {
        closeGameOverDisplay();
        event.preventDefault();
      }
      break;
  }
});



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

  // Setup help button event listener
  const helpBtn = document.getElementById('help-button');
  if (helpBtn) {
    helpBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      console.log('Help button clicked!');
      openHelpModal();
    });
    console.log('Help button event listener added');

    // Make sure it's clickable
    helpBtn.style.cursor = 'pointer';
    helpBtn.style.border = '1px solid blue'; // Temporary debug border
  } else {
    console.log('Help button not found - will try again later');
  }

  // Add event listeners for movement buttons (only once)
  setTimeout(() => {
    setupMovementButtons();
    setupPlaceButton();
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

      // Touch support for mobile
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();

        // First immediate move
        movePreview(direction);

        // Start long press timer
        longPressTimer = setTimeout(() => {
          // Start continuous movement
          moveInterval = setInterval(() => {
            movePreview(direction);
          }, 150);
        }, 300);
      });

      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        stopMovement();
      });

      btn.addEventListener('touchcancel', (e) => {
        e.preventDefault();
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

  // Update camera animation
  updateCameraAnimation();

  // Animate arena background shapes if they exist
  if ((window as any).animateArenaShapes) {
    (window as any).animateArenaShapes();
  }

  renderer.render(scene, camera);
}



// Make functions globally accessible for HTML onclick handlers
(window as any).movePreview = movePreview;
(window as any).setCameraPerspective = setCameraPerspective;
(window as any).rotateCamera = rotateCamera;
(window as any).resetCamera = resetCamera;
(window as any).toggleToolboxContent = toggleToolboxContent;
(window as any).placeCurrentShape = placeCurrentShape;



// Setup camera control event listeners as backup
function setupCameraControls(): void {
  console.log('🎥 Setting up camera controls...');

  // Find all camera buttons and add event listeners
  const cameraButtons = document.querySelectorAll('.camera-btn');
  console.log(`Found ${cameraButtons.length} camera buttons`);

  cameraButtons.forEach((button) => {
    const buttonText = button.textContent?.trim();

    // Add click event listener as backup
    button.addEventListener('click', (e) => {
      e.preventDefault();
      console.log(`🎥 Camera button clicked: ${buttonText}`);

      switch (buttonText) {
        case '↻':
          rotateCamera('horizontal');
          break;
        case '↑':
          rotateCamera('up');
          break;
        case '↓':
          rotateCamera('down');
          break;
        case '⌂':
          resetCamera();
          break;
        default:
          console.warn(`Unknown camera button: ${buttonText}`);
      }
    });

    console.log(`✅ Added event listener for ${buttonText} button`);
  });
}

// Cleanup function for realtime connection
async function cleanupRealtimeConnection(): Promise<void> {
  if (realtimeConnection) {
    console.log('🧹 Cleaning up realtime connection...');
    try {
      await realtimeConnection.disconnect();
      console.log('✅ Realtime connection disconnected successfully');
      realtimeConnection = null;
    } catch (error) {
      console.error('❌ Error disconnecting realtime connection:', error);
    }
  }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  void cleanupRealtimeConnection();
});

// Make cleanup function globally accessible
(window as any).cleanupRealtimeConnection = cleanupRealtimeConnection;

// Initialize
void initGame();
setupToolbox();
animate();

// Setup camera controls after a short delay to ensure DOM is ready
setTimeout(setupCameraControls, 500);
