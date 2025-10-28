import { redis } from '@devvit/web/server';
import { Challenge, Position3D, ShapeType, ShapeColor } from '../../shared/types/api';

// Game constants
const GRID_SIZE = 20;

// Helper functions
function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
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

// Initialize game for a new post - creates the first challenge immediately
export async function initializeGameForPost(postId: string): Promise<void> {
  console.log(`🎮 Initializing game for new post ${postId}`);
  
  try {
    // Set initial round to 1
    await redis.set(`game:${postId}:round`, '1');
    
    // Generate unique positions for the first challenge
    const positions: Position3D[] = [];
    const maxAttempts = 100;
    
    for (let i = 0; i < 3; i++) {
      let attempts = 0;
      let position: Position3D;
      
      do {
        position = getRandomPosition();
        attempts++;
      } while (
        attempts < maxAttempts && 
        positions.some(p => p.x === position.x && p.y === position.y && p.z === position.z)
      );
      
      positions.push(position);
    }
    
    // Create the first challenge
    const challenge: Challenge = {
      id: generateId(),
      positions,
      shapes: [getRandomShape(), getRandomShape(), getRandomShape()],
      colors: [getRandomColor(), getRandomColor(), getRandomColor()],
      startTime: Date.now(),
      duration: 0 // No duration - challenges only end when completed
    };

    // Save the challenge
    await redis.set(`game:${postId}:challenge`, JSON.stringify(challenge));
    
    // Initialize empty arrays for other game data
    await Promise.all([
      redis.set(`game:${postId}:shapes`, JSON.stringify([])),
      redis.set(`game:${postId}:players`, JSON.stringify([])),
      redis.set(`game:${postId}:leaderboard`, JSON.stringify([]))
    ]);
    
    console.log(`✅ First challenge created immediately for post ${postId}:`, {
      challengeId: challenge.id,
      round: 1,
      positions: challenge.positions.length
    });
  } catch (error) {
    console.error(`❌ Failed to create initial challenge for post ${postId}:`, error);
    throw error;
  }
}