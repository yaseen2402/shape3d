import { context, reddit } from '@devvit/web/server';
import { initializeGameForPost } from './gameInit';



export const createPost = async () => {
  const { subredditName } = context;
  if (!subredditName) {
    throw new Error('subredditName is required');
  }

  const post = await reddit.submitCustomPost({
    splash: {
      // Clean and Simple Splash Screen
      appDisplayName: 'Shape3D',
      backgroundUri: 'splash.png',
      buttonLabel: 'Play',
      description: ``,
      heading: 'Shape3D',
      appIconUri: 'icon2_nobg.png',
    },
    postData: {
      gameState: 'initial',
      score: 0,
    },
    subredditName: subredditName,
    title: 'Shape3D',
  });

  // Initialize the first challenge immediately after post creation
  try {
    await initializeGameForPost(post.id);
    console.log(`Game initialized for new post ${post.id}`);
  } catch (error) {
    console.error(`Failed to initialize game for post ${post.id}:`, error);
  }

  return post;
};


