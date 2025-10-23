import express from 'express';
import { 
  InitResponse, 
  JoinGameResponse, 
  PlaceShapeResponse,
  PlaceShapeRequest,
  GameState,
  PlacedShape,
  Challenge,
  ShapeType,
  ShapeColor,
  Position3D
} from '../shared/types/api';
import { redis, reddit, createServer, context, getServerPort } from '@devvit/web/server';
import { createPost } from './core/post';

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text());

const router = express.Router();

// Game constants
const CHALLENGE_DURATION = 30000; // 30 seconds
const CHALLENGE_INTERVAL = 30000; // Every 30 seconds
const CHALLENGE_COMPLETION_DELAY = 30000; // 30 seconds after completion
const TOTAL_ROUNDS = 5; // Total number of challenge rounds
const GRID_SIZE = 20;

// Challenge timers storage
const challengeTimers = new Map<string, NodeJS.Timeout>();

// Helper functions
function generateId(): string {
  return Math.random().toString(36).substr(2, 9);
}

function getRandomPosition(): Position3D {
  const half = Math.floor(GRID_SIZE / 2);
  return {
    x: Math.floor(Math.random() * GRID_SIZE) - half,
    y: Math.floor(Math.random() * 11), // 0 to 10 levels high
    z: Math.floor(Math.random() * GRID_SIZE) - half
  };
}

function getRandomShape(): ShapeType {
  const shapes: ShapeType[] = ['cube', 'triangle', 'sphere'];
  return shapes[Math.floor(Math.random() * shapes.length)]!;
}

function getRandomColor(): ShapeColor {
  const colors: ShapeColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];
  return colors[Math.floor(Math.random() * colors.length)]!;
}

// Data Storage: Using Redis (available in Devvit 0.12.1)
// Note: In newer Devvit versions, consider migrating to the built-in key-value store
async function getGameState(postId: string): Promise<GameState> {
  const [shapesData, challengeData, playersData, leaderboardData, roundData] = await Promise.all([
    redis.get(`game:${postId}:shapes`),
    redis.get(`game:${postId}:challenge`),
    redis.get(`game:${postId}:players`),
    redis.get(`game:${postId}:leaderboard`),
    redis.get(`game:${postId}:round`)
  ]);

  const currentRound = roundData ? parseInt(roundData) : 0;

  return {
    shapes: shapesData ? JSON.parse(shapesData) : [],
    currentChallenge: challengeData ? JSON.parse(challengeData) : null,
    players: playersData ? JSON.parse(playersData) : [],
    leaderboard: leaderboardData ? JSON.parse(leaderboardData) : [],
    currentRound,
    totalRounds: TOTAL_ROUNDS,
    isActive: currentRound < TOTAL_ROUNDS
  };
}

async function saveGameState(postId: string, gameState: GameState): Promise<void> {
  await Promise.all([
    redis.set(`game:${postId}:shapes`, JSON.stringify(gameState.shapes)),
    redis.set(`game:${postId}:challenge`, JSON.stringify(gameState.currentChallenge)),
    redis.set(`game:${postId}:players`, JSON.stringify(gameState.players)),
    redis.set(`game:${postId}:leaderboard`, JSON.stringify(gameState.leaderboard)),
    redis.set(`game:${postId}:round`, gameState.currentRound.toString())
  ]);
}

async function createChallenge(postId: string): Promise<Challenge | null> {
  // Get current game state to check for existing shapes and round count
  const gameState = await getGameState(postId);
  
  // Check if we've reached the maximum number of rounds
  if (gameState.currentRound >= TOTAL_ROUNDS) {
    console.log(`Game ${postId} has completed all ${TOTAL_ROUNDS} rounds`);
    return null;
  }
  
  // Increment round counter
  gameState.currentRound += 1;
  
  // Generate unique positions that don't conflict with existing shapes
  const positions: Position3D[] = [];
  const maxAttempts = 100; // Prevent infinite loops
  
  for (let i = 0; i < 3; i++) {
    let attempts = 0;
    let position: Position3D;
    
    do {
      position = getRandomPosition();
      attempts++;
    } while (
      attempts < maxAttempts && 
      (isPositionOccupied(gameState.shapes, position) || 
       positions.some(p => p.x === position.x && p.y === position.y && p.z === position.z))
    );
    
    positions.push(position);
  }
  
  const challenge: Challenge = {
    id: generateId(),
    positions,
    shapes: [getRandomShape(), getRandomShape(), getRandomShape()],
    colors: [getRandomColor(), getRandomColor(), getRandomColor()],
    startTime: Date.now(),
    duration: CHALLENGE_DURATION
  };

  await redis.set(`game:${postId}:challenge`, JSON.stringify(challenge));
  
  // Save updated game state with new round number
  await saveGameState(postId, gameState);
  
  // Clear any existing timer for this post
  if (challengeTimers.has(postId)) {
    clearTimeout(challengeTimers.get(postId)!);
  }
  
  // Auto-clear challenge after duration if not completed
  const timer = setTimeout(async () => {
    await redis.del(`game:${postId}:challenge`);
    challengeTimers.delete(postId);
    
    // Check if there are more rounds before starting next challenge
    const updatedGameState = await getGameState(postId);
    if (updatedGameState.currentRound < TOTAL_ROUNDS) {
      setTimeout(async () => {
        await createChallenge(postId);
      }, CHALLENGE_INTERVAL);
    } else {
      console.log(`Game ${postId} completed all rounds`);
    }
  }, CHALLENGE_DURATION);
  
  challengeTimers.set(postId, timer);
  return challenge;
}

function checkChallengeCompletion(gameState: GameState): boolean {
  if (!gameState.currentChallenge) return false;
  
  const challenge = gameState.currentChallenge;
  
  // Check if all challenge positions are filled with correct shapes and colors
  for (let i = 0; i < challenge.positions.length; i++) {
    const requiredPos = challenge.positions[i];
    const requiredShape = challenge.shapes[i];
    const requiredColor = challenge.colors[i];
    
    if (!requiredPos || !requiredShape || !requiredColor) {
      return false; // Invalid challenge data
    }
    
    // Find if there's a shape at this position with correct type and color
    const matchingShape = gameState.shapes.find(shape => 
      shape.position.x === requiredPos.x &&
      shape.position.y === requiredPos.y &&
      shape.position.z === requiredPos.z &&
      shape.type === requiredShape &&
      shape.color === requiredColor
    );
    
    if (!matchingShape) {
      return false; // Challenge not complete
    }
  }
  
  return true; // All positions filled correctly
}

async function completeChallengeAndScheduleNext(postId: string): Promise<void> {
  // Clear current challenge
  await redis.del(`game:${postId}:challenge`);
  
  // Clear any existing timer
  if (challengeTimers.has(postId)) {
    clearTimeout(challengeTimers.get(postId)!);
    challengeTimers.delete(postId);
  }
  
  // Check if there are more rounds before scheduling next challenge
  const gameState = await getGameState(postId);
  if (gameState.currentRound < TOTAL_ROUNDS) {
    // Schedule next challenge after completion delay
    const timer = setTimeout(async () => {
      await createChallenge(postId);
    }, CHALLENGE_COMPLETION_DELAY);
    
    challengeTimers.set(postId, timer);
  } else {
    console.log(`Game ${postId} completed all ${TOTAL_ROUNDS} rounds`);
  }
}

function isPositionOccupied(shapes: PlacedShape[], position: Position3D): boolean {
  return shapes.some(shape => 
    shape.position.x === position.x && 
    shape.position.y === position.y && 
    shape.position.z === position.z
  );
}

// Check if a placement is a valid challenge completion
function isValidChallengeMove(gameState: GameState, shape: PlacedShape): boolean {
  if (!gameState.currentChallenge) return false;
  
  const challenge = gameState.currentChallenge;
  
  // Find if this position matches any challenge position
  const challengeIndex = challenge.positions.findIndex(pos => 
    pos.x === shape.position.x && 
    pos.y === shape.position.y && 
    pos.z === shape.position.z
  );
  
  if (challengeIndex === -1) return false;
  
  // Check if shape and color match requirements
  const requiredShape = challenge.shapes[challengeIndex];
  const requiredColor = challenge.colors[challengeIndex];
  
  return shape.type === requiredShape && shape.color === requiredColor;
}

// Update player score in leaderboard
function updatePlayerScore(gameState: GameState, playerId: string): void {
  let playerScore = gameState.leaderboard.find(p => p.playerId === playerId);
  
  if (!playerScore) {
    playerScore = { playerId, score: 0 };
    gameState.leaderboard.push(playerScore);
  }
  
  playerScore.score += 1;
  playerScore.lastPlacement = Date.now();
  
  // Sort leaderboard by score (descending), then by last placement time (ascending for tiebreaker)
  gameState.leaderboard.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score; // Higher score first
    }
    return (a.lastPlacement || 0) - (b.lastPlacement || 0); // Earlier placement wins ties
  });
}

// API Routes
router.get('/api/init', async (_req, res): Promise<void> => {
  const { postId } = context;

  if (!postId) {
    res.status(400).json({
      status: 'error',
      message: 'postId is required but missing from context',
    });
    return;
  }

  try {
    const [gameState, username] = await Promise.all([
      getGameState(postId),
      reddit.getCurrentUsername()
    ]);

    res.json({
      type: 'init',
      postId,
      username: username ?? 'anonymous',
      gameState
    } as InitResponse);
  } catch (error) {
    console.error(`API Init Error for post ${postId}:`, error);
    res.status(400).json({ 
      status: 'error', 
      message: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

router.post('/api/join', async (_req, res): Promise<void> => {
  const { postId } = context;
  
  if (!postId) {
    res.status(400).json({
      status: 'error',
      message: 'postId is required',
    });
    return;
  }

  try {
    const username = await reddit.getCurrentUsername();
    const gameState = await getGameState(postId);
    
    // Add player if not already in game
    if (!gameState.players.includes(username ?? 'anonymous')) {
      gameState.players.push(username ?? 'anonymous');
      await saveGameState(postId, gameState);
    }

    // Start challenge cycle if this is the first player and no challenge is active
    if (gameState.players.length === 1 && !gameState.currentChallenge && !challengeTimers.has(postId)) {
      // Create first challenge after a short delay
      setTimeout(async () => {
        await createChallenge(postId);
      }, 5000);
    }

    res.json({
      type: 'join',
      success: true,
      gameState
    } as JoinGameResponse);
  } catch (error) {
    console.error(`Join game error:`, error);
    res.status(400).json({
      type: 'join',
      success: false,
      gameState: await getGameState(postId)
    } as JoinGameResponse);
  }
});

router.post('/api/place', async (req, res): Promise<void> => {
  const { postId } = context;
  
  if (!postId) {
    res.status(400).json({
      status: 'error',
      message: 'postId is required',
    });
    return;
  }

  try {
    const username = await reddit.getCurrentUsername();
    const request = req.body as PlaceShapeRequest;
    const gameState = await getGameState(postId);

    // Validate position is not occupied
    if (isPositionOccupied(gameState.shapes, request.position)) {
      res.json({
        type: 'place',
        success: false,
        gameState,
        message: `Position (${request.position.x}, ${request.position.y}, ${request.position.z}) is already occupied!`
      } as PlaceShapeResponse);
      return;
    }

    // Create new shape
    const newShape: PlacedShape = {
      id: generateId(),
      type: request.type,
      color: request.color,
      position: request.position,
      playerId: username ?? 'anonymous',
      timestamp: Date.now()
    };

    // Check if this is a valid challenge move before adding to game state
    const isValidMove = isValidChallengeMove(gameState, newShape);
    
    // Add shape to game state
    gameState.shapes.push(newShape);
    
    // Update player score if it was a valid challenge move
    if (isValidMove) {
      updatePlayerScore(gameState, username ?? 'anonymous');
    }
    
    // Check if this placement completes the current challenge
    if (gameState.currentChallenge && checkChallengeCompletion(gameState)) {
      // Challenge completed! Schedule next challenge
      await completeChallengeAndScheduleNext(postId);
      // Update game state to reflect challenge completion
      gameState.currentChallenge = null;
    }
    
    await saveGameState(postId, gameState);

    res.json({
      type: 'place',
      success: true,
      shape: newShape,
      gameState,
      message: `${username ?? 'Anonymous'} placed a ${request.color} ${request.type} at (${request.position.x}, ${request.position.y}, ${request.position.z})`,
      playerName: username ?? 'Anonymous'
    } as PlaceShapeResponse);
  } catch (error) {
    console.error(`Place shape error:`, error);
    res.json({
      type: 'place',
      success: false,
      gameState: await getGameState(postId)
    } as PlaceShapeResponse);
  }
});

// Legacy routes for app installation
router.post('/internal/on-app-install', async (_req, res): Promise<void> => {
  try {
    const post = await createPost();
    res.json({
      status: 'success',
      message: `Post created in subreddit ${context.subredditName} with id ${post.id}`,
    });
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    res.status(400).json({
      status: 'error',
      message: 'Failed to create post',
    });
  }
});

router.post('/internal/menu/post-create', async (_req, res): Promise<void> => {
  try {
    const post = await createPost();
    res.json({
      navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
    });
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    res.status(400).json({
      status: 'error',
      message: 'Failed to create post',
    });
  }
});

app.use(router);

const server = createServer(app);
server.on('error', (err) => console.error(`server error; ${err.stack}`));

// Cleanup timers on server shutdown
process.on('SIGTERM', () => {
  challengeTimers.forEach(timer => clearTimeout(timer));
  challengeTimers.clear();
});

process.on('SIGINT', () => {
  challengeTimers.forEach(timer => clearTimeout(timer));
  challengeTimers.clear();
  process.exit(0);
});

server.listen(getServerPort());
