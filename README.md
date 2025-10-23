# Shape3D - Multiplayer 3D Building Game

A real-time multiplayer 3D building game built with Devvit (Reddit) and Three.js. Players compete to place shapes in a shared 3D space during timed challenges.

## Game Features

🎮 **Multiplayer Building**: Real-time collaborative 3D building experience  
🎯 **Timed Challenges**: Every 30 seconds, new challenges appear with specific shape/color/position requirements  
🎨 **Shape Variety**: Build with cubes, triangles, and spheres in 6 different colors  
🔧 **Grid-Based Building**: Minecraft-style grid snapping with preview system  
⚡ **Real-Time Sync**: See other players' builds instantly with live notifications  
🚫 **Collision Detection**: Prevents multiple players from placing shapes in the same position  
🔔 **Toast Notifications**: Real-time alerts when players place shapes or encounter errors  
🎮 **Advanced Controls**: WASD movement, mouse camera controls, and mobile-friendly touch controls  
📱 **Cross-Platform**: Works on desktop and mobile with adaptive UI  

## How to Play

1. **Start Screen**: Click "Start Game" to join or "How to Play" for detailed guide
2. **Select Tools**: Use the toolbox (bottom-left) to choose your shape and color
3. **Build**: 
   - **Desktop**: Use WASD to move preview cube, Q/E for height, Space to place
   - **Mobile**: Use arrow buttons in toolbox to move preview, tap to place
   - **Mouse**: Drag to rotate camera view
4. **Camera**: Use transparent arrow buttons (right side) for quick perspective changes
5. **Challenges**: Watch for challenge notifications (top-left) with yellow highlights
6. **Compete**: Be the first to complete challenge objectives!

## Game Mechanics

- **Grid System**: 20x20 grid with vertical building support (up to 10 levels high)
- **Shape Types**: Cube, Triangle (cone), Sphere  
- **Colors**: Red, Blue, Green, Yellow, Purple, Orange
- **Challenge Timing**: New challenges appear every 30 seconds OR 30 seconds after completion (whichever comes first)
- **Building Rules**: 
  - Can't place shapes in occupied positions (collision detection)
  - Can build vertically up to 10 levels
  - Real-time notifications for successful placements and errors
  - Live updates when other players place shapes
- **Controls**: 
  - **WASD**: Move preview horizontally
  - **Q/E**: Move preview up/down
  - **Space**: Place shape
  - **Mouse Drag**: Rotate camera
  - **Arrow Buttons**: Mobile movement controls
  - **Camera Buttons**: Quick perspective changes (Top, Front, Side, Isometric)

## Development

### Setup
```bash
npm install
npm run build
npm run dev
```

### Commands
- `npm run dev` - Development mode with hot reloading
- `npm run build` - Build for production  
- `npm run deploy` - Deploy to Reddit
- `npm run launch` - Build, deploy, and publish

### Architecture
- **Client**: Three.js 3D engine with real-time multiplayer UI
- **Server**: Express.js with Redis for game state management
- **Platform**: Devvit (Reddit) for hosting and user management

## Technical Stack

- **Frontend**: Three.js, TypeScript, HTML5 Canvas
- **Backend**: Node.js, Express, Redis
- **Platform**: Devvit (Reddit Apps Platform)
- **Build**: Vite, ESLint, Prettier

## Getting Started

> Make sure you have Node 22 downloaded on your machine before running!

1. Run `npm install` to install dependencies
2. Run `npm run dev` to start development mode
3. Follow the Devvit setup wizard to connect your Reddit account
4. Your game will be available at the provided Reddit URL

## License

BSD-3-Clause