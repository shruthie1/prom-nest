export class ConnectionManagerConfig {
  // Health check and connection constants
  static readonly HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
  static readonly MAX_CONNECTION_ATTEMPTS = 3;
  static readonly MAX_CONSECUTIVE_FAILURES = 5;
  static readonly CONNECTION_TIMEOUT = 30000; // 30 seconds
  static readonly RECONNECTION_DELAY = 2000; // 2 seconds between attempts
  static readonly DISCONNECT_TIMEOUT = 5000; // 5 seconds

  // Rotation constants
  static readonly ROTATION_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours
  static readonly ACTIVE_SLOTS = 4;

  // Randomization settings for anti-detection
  static readonly MIN_ROTATION_INTERVAL = 3 * 60 * 60 * 1000; // 3 hours minimum
  static readonly MAX_ROTATION_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours maximum
  static readonly ROTATION_JITTER_PERCENTAGE = 0.3; // 30% jitter
  static readonly MIN_ACTIVE_CHANGE_PERCENTAGE = 0.3; // Change at least 30% of active mobiles

  // History and cleanup settings
  static readonly MAX_ROTATION_HISTORY = 50; // Keep last 50 rotations
  static readonly CLIENT_RETRY_ATTEMPTS = 3;
  static readonly CLIENT_RETRY_DELAY_BASE = 1000; // 1 second base delay
}
