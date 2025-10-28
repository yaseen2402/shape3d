// Game Types
export type ShapeType = 'cube' | 'triangle' | 'sphere';
export type ShapeColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange';

export type Position3D = {
  x: number;
  y: number;
  z: number;
};

export type PlacedShape = {
  id: string;
  type: ShapeType;
  color: ShapeColor;
  position: Position3D;
  playerId: string;
  timestamp: number;
};

export type Challenge = {
  id: string;
  positions: Position3D[];
  shapes: ShapeType[];
  colors: ShapeColor[];
  startTime: number;
  duration: number; // 30 seconds
};

export type PlayerScore = {
  playerId: string;
  score: number;
  lastPlacement?: number; // timestamp of last successful placement
};

export type GameState = {
  shapes: PlacedShape[];
  currentChallenge: Challenge | null;
  players: string[];
  leaderboard: PlayerScore[];
  currentRound: number;
  totalRounds: number;
  isActive: boolean;
  nextChallengeStartTime?: number; // timestamp when next challenge will start
  countdownActive?: boolean; // whether countdown is currently active
};

// API Response Types
export type InitResponse = {
  type: "init";
  postId: string;
  username: string;
  gameState: GameState;
};

export type JoinGameResponse = {
  type: "join";
  success: boolean;
  gameState: GameState;
};

export type PlaceShapeResponse = {
  type: "place";
  success: boolean;
  shape?: PlacedShape;
  gameState: GameState;
  message?: string;
  playerName?: string;
  isFirstPlacement?: boolean;
};

export type GameUpdateResponse = {
  type: "update";
  gameState: GameState;
};

// Request Types
export type PlaceShapeRequest = {
  type: ShapeType;
  color: ShapeColor;
  position: Position3D;
};
