// Utility functions for shuffling arrays and preventing collision
export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]; // Create a copy to avoid mutating original
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Generate a mobile-specific seed based on mobile number to ensure
 * different but deterministic shuffling per mobile
 */
export function getMobileSeed(mobile: string): number {
  let hash = 0;
  for (let i = 0; i < mobile.length; i++) {
    const char = mobile.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Shuffle array with mobile-specific seeding for more deterministic
 * but still random ordering per mobile
 */
export function shuffleArrayWithMobileSeed<T>(array: T[], mobile: string): T[] {
  const shuffled = [...array];
  const seed = getMobileSeed(mobile);
  
  // Use the seed to generate mobile-specific random numbers
  let currentSeed = seed;
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    // Simple linear congruential generator for predictable randomness
    currentSeed = (currentSeed * 1664525 + 1013904223) % Math.pow(2, 32);
    const j = Math.floor((currentSeed / Math.pow(2, 32)) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

/**
 * Get a random starting index based on mobile number
 */
export function getRandomStartIndex(mobile: string, arrayLength: number): number {
  if (arrayLength === 0) return 0;
  const seed = getMobileSeed(mobile);
  return seed % arrayLength;
}
