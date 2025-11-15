# Data Directory

This directory contains the bot's persistent data storage.

## Database

**guild-requests.sqlite** - Main SQLite database containing:
- Character registrations
- Request records
- Request status history
- Temporary session data

## Database Backups

Automatic backups are stored in `backups/` subdirectory:
- **Location**: `data/backups/guild-requests_YYYY-MM-DDTHH-MM-SS.sqlite`
- **Frequency**: Configured in `config/config.js` (default: every 6 hours)
- **Retention**: Last 10 backups retained automatically
- **On Startup**: Backup created 10 seconds after bot starts

### Configuration

Edit `config/config.js` to adjust backup settings:

```javascript
databaseBackup: {
  enabled: true,              // Toggle automatic backups
  backupOnStartup: true,      // Create backup on bot start
  intervalHours: 6,           // Backup frequency
  maxBackups: 10,             // Number of backups to keep
}
```

### Manual Backup Operations

Use the database backup utility for manual operations:

```javascript
const { createBackup, listBackups, restoreBackup } = require('../utils/databaseBackup');

// Create manual backup
await createBackup();

// List all backups
const backups = listBackups();

// Restore from backup (creates safety backup first)
await restoreBackup('guild-requests_2025-11-14T12-30-00.sqlite');
```

## Important Notes

- ✅ Database is automatically backed up
- ✅ Safety backup created before any restore operation
- ⚠️ Do not manually delete `guild-requests.sqlite` while bot is running
- ⚠️ WAL files (`.sqlite-wal`, `.sqlite-shm`) are temporary and managed by SQLite

## Disaster Recovery

1. Stop the bot
2. Navigate to `data/backups/`
3. Identify the backup file to restore
4. Copy backup to `data/guild-requests.sqlite`
5. Restart the bot

Or use the programmatic restore function for automatic safety backup.
