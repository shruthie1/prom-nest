# Promotion Services - NestJS Architecture (Global Singleton with Per-Client Services)

This document outlines the new NestJS service architecture that implements a **global singleton promotion system** with **per-client service instances**.

## Architecture Overview

The promotion system follows a hybrid architecture:

### Singleton Components (Global)
- **PromotionService** - Single instance that manages all clients globally
- **PromotionStateService** - Manages promotion states for all clients
- **ClientServicesFactory** - Factory that creates and manages per-client services

### Per-Client Components
- **ChannelService** - One instance per client for channel management
- **DialogsService** - One instance per client for dialog fetching
- **MessagingService** - One instance per client for message sending
- **HealthService** - One instance per client for health monitoring
- **MessageQueueService** - One instance per client for message queue management
- **StatsService** - One instance per client for statistics handling

## Key Features

### 🔄 **Global Management**
- Single `PromotionService` instance manages all connected clients
- Automatically initializes services for new clients from `ConnectionManagerService`
- Global promotion loop processes all healthy clients
- Centralized state management across all clients

### 🏭 **Per-Client Service Isolation**
- Each client gets its own service instances for complete isolation
- No shared state between client services
- Independent processing and error handling per client
- Memory-efficient factory pattern for service creation

### 🚀 **Automatic Client Discovery**
- Integrates with `ConnectionManagerService` to discover managed clients
- Automatically initializes services for new clients
- Removes services for disconnected clients
- Real-time client health monitoring

## File Structure

```
src/components/promotions/
├── interfaces/
│   └── promotion.interfaces.ts           # Type definitions
├── services/
│   ├── channel.service.ts                # Per-client channel management
│   ├── dialogs.service.ts               # Per-client dialog fetching
│   ├── health.service.ts                # Per-client health monitoring
│   ├── message-queue.service.ts         # Per-client message queue
│   ├── messaging.service.ts             # Per-client messaging
│   ├── promotion-state.service.ts       # Global state management
│   ├── stats.service.ts                 # Per-client statistics
│   └── client-services.factory.ts       # Factory for per-client services
├── promotion.service.ts                 # Global singleton orchestrator
├── promotion.module.ts                  # NestJS module configuration
├── index.ts                            # Barrel exports
└── README.md                           # This documentation
```

## Service Lifecycle

### 1. **Initialization (OnModuleInit)**
```typescript
// PromotionService automatically:
1. Discovers all managed clients from ConnectionManagerService
2. Creates ClientServices instances for each client
3. Initializes PromotionState for each client
4. Starts the global promotion loop
```

### 2. **Global Promotion Loop**
```typescript
// Every 10 seconds:
1. Get all healthy mobiles from PromotionStateService
2. For each healthy mobile:
   - Get client-specific services from ClientServicesFactory
   - Process promotion for that client
   - Handle errors independently per client
3. Continue to next client without blocking
```

### 3. **Client Management**
```typescript
// Dynamic client management:
- addNewClient(mobile) - Add services for new client
- removeClient(mobile) - Remove services for disconnected client
- Automatic cleanup on module destroy
```

## Usage Example

### Basic Usage
```typescript
// The service starts automatically on module initialization
// No manual intervention needed for basic operation

// Access the global promotion service
constructor(private readonly promotionService: PromotionService) {}

// Get statistics for all clients
const stats = this.promotionService.getMobileStats();

// Get active clients
const activeClients = this.promotionService.getActiveClients();
```

### Manual Client Management
```typescript
// Add a new client manually
await this.promotionService.addNewClient('1234567890');

// Remove a client
this.promotionService.removeClient('1234567890');

// Check queued messages for specific client
await this.promotionService.checkQueuedMessages('1234567890');
```

### Per-Client Operations
```typescript
// Save stats for specific client
await this.promotionService.saveStatsToFile('1234567890');

// Load stats for specific client
await this.promotionService.loadStatsFromFile('1234567890');

// Get promotion state for specific client
const state = this.promotionService.getPromotionState('1234567890');
```

## Integration Points

### ConnectionManagerService
- **getTelegramClient(mobile)** - Get client instance
- **getConnectionInfo(mobile)** - Get client health status
- **getManagedMobiles()** - Get all managed mobile numbers

### Client Health Monitoring
```typescript
// Healthy clients are determined by:
- state.daysLeft < 7
- Recent message activity (12 mins for daysLeft < 1, 3 mins for daysLeft > 0)
- state.sleepTime < Date.now() (not rate limited)
```

## Benefits of This Architecture

### 🎯 **Efficient Resource Management**
- Single global loop instead of multiple per-client loops
- Reduced CPU and memory overhead
- Centralized error handling and logging

### 🔒 **Client Isolation**
- Complete service isolation between clients
- Independent error recovery per client
- No cross-client interference

### 📈 **Scalability**
- Easy to add/remove clients dynamically
- Factory pattern for efficient service creation
- Memory-efficient state management

### 🛠️ **Maintainability**
- Clear separation between global and client-specific logic
- Single point of configuration and monitoring
- Simplified debugging and troubleshooting

## Configuration

### Environment Variables
```bash
# Required for proper operation
CLIENT_ID=your_client_id
PROMOTE_REPL=https://api.example.com
LOGS_CHANNEL_2=your_logs_channel_id
```

### Timing Configuration
```typescript
// Adjustable constants in PromotionService
PROMOTION_INTERVAL = 10000;  // Global loop interval (10 seconds)
```

## Monitoring and Debugging

### Global Statistics
```typescript
// Get comprehensive stats for all clients
const allStats = promotionService.getMobileStats();
```

### Per-Client Diagnostics
```typescript
// Check specific client status
const state = promotionService.getPromotionState(mobile);
const isActive = state?.isPromoting;
const lastActivity = state?.lastMessageTime;
```

### Health Monitoring
```typescript
// Monitor client health across the system
const healthyMobiles = promotionStateService.getHealthyMobiles();
const activeClients = promotionService.getActiveClients();
```

This architecture provides the best of both worlds: **global efficiency** with **per-client isolation**, making it ideal for managing multiple Telegram clients in a single, scalable system.
