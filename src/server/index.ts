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

const TOTAL_ROUNDS = 5; // Total number of challenge rounds
const GRID_SIZE = 20;

// Challenge timers storage
const challengeTimers = new Map<string, NodeJS.Timeout>();

// Helper functions
function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

// Game initialization moved to gameInit.ts to avoid circular imports

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

async function completeChallengeAndScheduleNext(postId: string): Promise<Challenge | null> {
  console.log(`🎉 Challenge completed for post ${postId}! Starting next challenge immediately...`);
  
  // Clear current challenge
  await redis.del(`game:${postId}:challenge`);
  
  // Small delay to ensure Redis operations complete
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Check if there are more rounds before creating next challenge
  const gameState = await getGameState(postId);
  console.log(`📊 Current game state for ${postId}: Round ${gameState.currentRound}/${TOTAL_ROUNDS}`);
  
  if (gameState.currentRound < TOTAL_ROUNDS) {
    console.log(`🚀 Creating next challenge immediately for post ${postId}`);
    
    // Clear any existing timer first
    if (challengeTimers.has(postId)) {
      console.log(`🧹 Clearing existing timer for post ${postId}`);
      clearTimeout(challengeTimers.get(postId)!);
      challengeTimers.delete(postId);
    }
    
    // Clear any countdown state
    await Promise.all([
      redis.del(`game:${postId}:nextChallengeTime`),
      redis.del(`game:${postId}:countdownActive`)
    ]);
    
    try {
      // Create next challenge immediately
      const newChallenge = await createChallenge(postId);
      if (newChallenge) {
        console.log(`✅ New challenge created successfully for post ${postId}:`, {
          challengeId: newChallenge.id,
          round: (await getGameState(postId)).currentRound
        });
        return newChallenge;
      } else {
        console.log(`❌ Failed to create new challenge for post ${postId} - game may be complete`);
        return null;
      }
    } catch (error) {
      console.error(`💥 Error creating next challenge for post ${postId}:`, error);
      return null;
    }
  } else {
    console.log(`🏁 Game ${postId} completed all ${TOTAL_ROUNDS} rounds`);
    return null;
  }
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
  const [shapesData, challengeData, playersData, leaderboardData, roundData, nextChallengeTimeData, countdownActiveData] = await Promise.all([
    redis.get(`game:${postId}:shapes`),
    redis.get(`game:${postId}:challenge`),
    redis.get(`game:${postId}:players`),
    redis.get(`game:${postId}:leaderboard`),
    redis.get(`game:${postId}:round`),
    redis.get(`game:${postId}:nextChallengeTime`),
    redis.get(`game:${postId}:countdownActive`)
  ]);

  const currentRound = roundData ? parseInt(roundData) : 0;
  const nextChallengeStartTime = nextChallengeTimeData ? parseInt(nextChallengeTimeData) : undefined;
  const countdownActive = countdownActiveData === 'true';

  return {
    shapes: shapesData ? JSON.parse(shapesData) : [],
    currentChallenge: challengeData ? JSON.parse(challengeData) : null,
    players: playersData ? JSON.parse(playersData) : [],
    leaderboard: leaderboardData ? JSON.parse(leaderboardData) : [],
    currentRound,
    totalRounds: TOTAL_ROUNDS,
    isActive: currentRound < TOTAL_ROUNDS,
    ...(nextChallengeStartTime && { nextChallengeStartTime }),
    ...(countdownActive && { countdownActive })
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
  console.log(`createChallenge called for post ${postId}`);
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
    duration: 0 // No duration - challenges only end when completed
  };

  // Update the game state with the new challenge BEFORE saving
  gameState.currentChallenge = challenge;
  
  // Save updated game state with new round number AND new challenge
  await saveGameState(postId, gameState);
  console.log(`Challenge and game state saved for post ${postId}:`, challenge);
  
  // Verify the challenge was actually saved by reading it back immediately
  const verifyGameState = await getGameState(postId);
  console.log(`🔍 Immediate verification - Challenge in saved game state:`, {
    hasChallenge: !!verifyGameState.currentChallenge,
    challengeId: verifyGameState.currentChallenge?.id,
    round: verifyGameState.currentRound
  });
  
  // Clear any existing timer for this post (cleanup)
  if (challengeTimers.has(postId)) {
    clearTimeout(challengeTimers.get(postId)!);
    challengeTimers.delete(postId);
  }
  
  // No timeout - challenges only progress when completed by players
  return challenge;
}

// Duplicate functions removed - using the ones defined above

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

// Check if this is the first valid placement in the current challenge
function isFirstPlacementInChallenge(gameState: GameState, currentShape: PlacedShape): boolean {
  if (!gameState.currentChallenge) return false;
  
  const challenge = gameState.currentChallenge;
  
  // Count how many valid challenge placements have been made in this challenge
  const validPlacements = gameState.shapes.filter(shape => {
    // Skip the current shape we're checking
    if (shape.id === currentShape.id) return false;
    
    // Check if this shape was placed after the challenge started
    if (shape.timestamp < challenge.startTime) return false;
    
    // Check if this shape is a valid challenge placement
    const challengeIndex = challenge.positions.findIndex(pos => 
      pos.x === shape.position.x && 
      pos.y === shape.position.y && 
      pos.z === shape.position.z
    );
    
    if (challengeIndex === -1) return false;
    
    const requiredShape = challenge.shapes[challengeIndex];
    const requiredColor = challenge.colors[challengeIndex];
    
    return shape.type === requiredShape && shape.color === requiredColor;
  });
  
  // This is the first placement if no other valid placements exist
  return validPlacements.length === 0;
}

// Update player score in leaderboard
function updatePlayerScore(gameState: GameState, playerId: string, bonusPoints: number = 1): void {
  let playerScore = gameState.leaderboard.find(p => p.playerId === playerId);
  
  if (!playerScore) {
    playerScore = { playerId, score: 0 };
    gameState.leaderboard.push(playerScore);
  }
  
  playerScore.score += bonusPoints;
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

    // Challenge should already exist from post creation initialization

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

    // Get updated game state after saving
    const updatedGameState = await getGameState(postId);

    res.json({
      type: 'join',
      success: true,
      gameState: updatedGameState
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
    
    // Check if this is the first placement in the current challenge (before adding to game state)
    const isFirstPlacement = isValidMove && isFirstPlacementInChallenge(gameState, newShape);
    
    // Add shape to game state
    gameState.shapes.push(newShape);
    
    // Update player score if it was a valid challenge move
    let bonusMessage = '';
    if (isValidMove) {
      if (isFirstPlacement) {
        // Give 2 points for first placement (1 regular + 1 bonus)
        updatePlayerScore(gameState, username ?? 'anonymous', 2);
        bonusMessage = ' (+1 First Place Bonus!)';
      } else {
        // Give 1 point for regular placement
        updatePlayerScore(gameState, username ?? 'anonymous', 1);
      }
    }
    
    // Save the current game state first
    await saveGameState(postId, gameState);
    
    // Check if this placement completes the current challenge (AFTER adding the shape)
    let updatedGameState = gameState;
    if (gameState.currentChallenge && checkChallengeCompletion(gameState)) {
      // Challenge completed! Create next challenge immediately
      console.log(`🎯 Challenge completed! Creating next challenge for post ${postId}`);
      const newChallenge = await completeChallengeAndScheduleNext(postId);
      
      if (newChallenge) {
        // Add a small delay to ensure Redis consistency
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Update the game state with the new challenge directly
        updatedGameState = await getGameState(postId);
        console.log(`📋 Updated game state after challenge completion:`, {
          hasChallenge: !!updatedGameState.currentChallenge,
          challengeId: updatedGameState.currentChallenge?.id,
          round: updatedGameState.currentRound
        });
        
        // If still no challenge, try reading directly from Redis
        if (!updatedGameState.currentChallenge) {
          const directChallengeRead = await redis.get(`game:${postId}:challenge`);
          console.log(`🔍 Direct Redis read for challenge:`, directChallengeRead ? JSON.parse(directChallengeRead) : null);
        }
      } else {
        // No new challenge (game completed)
        updatedGameState.currentChallenge = null;
        console.log(`🏁 Game completed, no more challenges`);
      }
    }

    res.json({
      type: 'place',
      success: true,
      shape: newShape,
      gameState: updatedGameState,
      message: `${username ?? 'Anonymous'} placed a ${request.color} ${request.type}${bonusMessage}`,
      playerName: username ?? 'Anonymous',
      isFirstPlacement: isFirstPlacement
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

// Leaderboard API endpoint
router.get('/api/leaderboard', async (_req, res): Promise<void> => {
  const { postId } = context;
  
  if (!postId) {
    res.status(400).json({
      status: 'error',
      message: 'postId is required',
    });
    return;
  }

  try {
    const gameState = await getGameState(postId);
    res.json({
      type: 'leaderboard',
      leaderboard: gameState.leaderboard,
      totalPlayers: gameState.players.length,
      currentRound: gameState.currentRound,
      totalRounds: gameState.totalRounds
    });
  } catch (error) {
    console.error(`Leaderboard error:`, error);
    res.status(400).json({
      type: 'leaderboard',
      leaderboard: [],
      totalPlayers: 0,
      currentRound: 0,
      totalRounds: TOTAL_ROUNDS
    });
  }
});

// Legacy routes for app installation and menu actions
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
