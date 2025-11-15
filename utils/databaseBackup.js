// utils/databaseBackup.js
const fs = require('fs');
const path = require('path');
const config = require('../config/config.js');
const log = require('./logWriter.js');

const BACKUP_DIR = path.join(__dirname, '../data/backups');
const DB_PATH = path.join(__dirname, '../data/guild-requests.sqlite');

/**
 * Ensures backup directory exists
 */
function ensureBackupDirectory() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    log.info('[DB BACKUP] Created backup directory');
  }
}

/**
 * Creates a backup of the database
 * @returns {Promise<string>} Path to backup file
 */
async function createBackup() {
  try {
    ensureBackupDirectory();
    
    // Check if database exists
    if (!fs.existsSync(DB_PATH)) {
      log.warn('[DB BACKUP] Database file not found, skipping backup');
      return null;
    }
    
    // Generate timestamp-based filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupFileName = `guild-requests_${timestamp}.sqlite`;
    const backupPath = path.join(BACKUP_DIR, backupFileName);
    
    // Copy database file
    await fs.promises.copyFile(DB_PATH, backupPath);
    
    const stats = fs.statSync(backupPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    log.info(`[DB BACKUP] Created backup: ${backupFileName} (${sizeMB} MB)`);
    
    // Cleanup old backups
    await cleanupOldBackups();
    
    return backupPath;
  } catch (err) {
    log.error(`[DB BACKUP] Failed to create backup: ${err.message}`);
    throw err;
  }
}

/**
 * Removes old backups beyond retention limit
 */
async function cleanupOldBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('guild-requests_') && f.endsWith('.sqlite'))
      .map(f => ({
        name: f,
        path: path.join(BACKUP_DIR, f),
        mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime); // Sort newest first
    
    // Keep only the configured number of backups
    const toDelete = files.slice(config.databaseBackup.maxBackups);
    
    for (const file of toDelete) {
      fs.unlinkSync(file.path);
      log.info(`[DB BACKUP] Deleted old backup: ${file.name}`);
    }
    
    if (toDelete.length > 0) {
      log.info(`[DB BACKUP] Cleaned up ${toDelete.length} old backup(s), retained ${files.length - toDelete.length}`);
    }
  } catch (err) {
    log.warn(`[DB BACKUP] Failed to cleanup old backups: ${err.message}`);
  }
}

/**
 * Lists all available backups
 * @returns {Array<Object>} Array of backup info objects
 */
function listBackups() {
  try {
    ensureBackupDirectory();
    
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('guild-requests_') && f.endsWith('.sqlite'))
      .map(f => {
        const fullPath = path.join(BACKUP_DIR, f);
        const stats = fs.statSync(fullPath);
        return {
          name: f,
          path: fullPath,
          size: stats.size,
          sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
          created: stats.mtime
        };
      })
      .sort((a, b) => b.created - a.created); // Sort newest first
    
    return files;
  } catch (err) {
    log.error(`[DB BACKUP] Failed to list backups: ${err.message}`);
    return [];
  }
}

/**
 * Restores database from a backup file
 * @param {string} backupFileName - Name of backup file to restore
 * @returns {Promise<boolean>} Success status
 */
async function restoreBackup(backupFileName) {
  try {
    const backupPath = path.join(BACKUP_DIR, backupFileName);
    
    if (!fs.existsSync(backupPath)) {
      log.error(`[DB BACKUP] Backup file not found: ${backupFileName}`);
      return false;
    }
    
    // Create safety backup of current database before restoring
    if (fs.existsSync(DB_PATH)) {
      const safetyBackup = path.join(BACKUP_DIR, `pre-restore_${Date.now()}.sqlite`);
      await fs.promises.copyFile(DB_PATH, safetyBackup);
      log.info(`[DB BACKUP] Created safety backup before restore: ${path.basename(safetyBackup)}`);
    }
    
    // Restore from backup
    await fs.promises.copyFile(backupPath, DB_PATH);
    
    log.info(`[DB BACKUP] Successfully restored from: ${backupFileName}`);
    return true;
  } catch (err) {
    log.error(`[DB BACKUP] Failed to restore backup: ${err.message}`);
    return false;
  }
}

/**
 * Schedules automatic backups based on config
 * @param {import('discord.js').Client} client - Discord client (for logging)
 */
function scheduleAutomaticBackups(client) {
  if (!config.databaseBackup || !config.databaseBackup.enabled) {
    log.info('[DB BACKUP] Automatic backups are disabled in config');
    return;
  }
  
  const intervalMs = config.databaseBackup.intervalHours * 60 * 60 * 1000;
  
  log.info(`[DB BACKUP] Scheduling automatic backups every ${config.databaseBackup.intervalHours} hour(s)`);
  
  // Create initial backup on startup
  if (config.databaseBackup.backupOnStartup) {
    setTimeout(() => {
      createBackup().catch(err => {
        log.error(`[DB BACKUP] Startup backup failed: ${err.message}`);
      });
    }, 10000); // Wait 10 seconds after startup
  }
  
  // Schedule recurring backups
  setInterval(async () => {
    try {
      await createBackup();
    } catch (err) {
      log.error(`[DB BACKUP] Scheduled backup failed: ${err.message}`);
    }
  }, intervalMs);
}

module.exports = {
  createBackup,
  cleanupOldBackups,
  listBackups,
  restoreBackup,
  scheduleAutomaticBackups,
  BACKUP_DIR
};
