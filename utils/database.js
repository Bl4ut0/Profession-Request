const sqlite3 = require('sqlite3').verbose();
const path =require('path');
const fs = require('fs');
const config = require('../config/config.js');
const log = require('./logWriter');

// Ensure data directory exists
const dataDir = path.resolve(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

// Path to SQLite file
const dbPath = path.resolve(dataDir, 'guild-requests.sqlite');
const db = new sqlite3.Database(dbPath);

// Session cleanup interval (runs every 30 minutes)
const SESSION_CLEANUP_INTERVAL = 30 * 60 * 1000;
// Sessions expire after 24 hours
const SESSION_EXPIRY_TIME = 24 * 60 * 60 * 1000;
let cleanupTimer = null;

/**
 * Initialize all necessary tables with the updated schema.
 * NOTE: If you have an existing DB, delete data/guild-requests.sqlite
 * so this schema takes effect.
 */
function initDatabase() {
  db.serialize(() => {
    // Characters table
    db.run(`CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      name TEXT,
      type TEXT
    )`);

    // Requests table with new columns request_id & request_name
    db.run(`CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      character TEXT,
      profession TEXT,
      gear_slot TEXT,
      request_id TEXT,
      request_name TEXT,
      status TEXT DEFAULT 'open',
      claimed_by TEXT,
      claimed_by_name TEXT,
      claimed_at TEXT,
      deny_reason TEXT,
      materials_json TEXT,
      provided_materials_json TEXT,
      provides_materials INTEGER,
      quantity_requested INTEGER DEFAULT 1,
      quantity_completed INTEGER DEFAULT 0,
      audit_log TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Audit logs table
    db.run(`CREATE TABLE IF NOT EXISTS action_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      action_type TEXT,
      target_request_id INTEGER,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      details_json TEXT
    )`);

    // Temp sessions for dropdown flows
    db.run(`CREATE TABLE IF NOT EXISTS temp_sessions (
      session_key TEXT PRIMARY KEY,
      user_id TEXT,
      data_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Active DM channels for cleanup tracking
    db.run(`CREATE TABLE IF NOT EXISTS active_dms (
      user_id TEXT PRIMARY KEY,
      dm_channel_id TEXT,
      last_activity TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Migration: Add provided_materials_json column if it doesn't exist
    db.run(`PRAGMA table_info(requests)`, (err, rows) => {
      if (err) {
        log.error('[DATABASE] Failed to check table structure:', err);
        return;
      }
    });
    
    db.all(`PRAGMA table_info(requests)`, (err, rows) => {
      if (err) {
        log.error('[DATABASE] Failed to check table structure:', err);
        return;
      }
      
      const hasProvidedMaterialsJson = rows.some(row => row.name === 'provided_materials_json');
      const hasQuantityRequested = rows.some(row => row.name === 'quantity_requested');
      const hasQuantityCompleted = rows.some(row => row.name === 'quantity_completed');
      const hasClaimedAt = rows.some(row => row.name === 'claimed_at');
      const hasAuditLog = rows.some(row => row.name === 'audit_log');
      
      if (!hasProvidedMaterialsJson) {
        db.run(`ALTER TABLE requests ADD COLUMN provided_materials_json TEXT`, (err) => {
          if (err) {
            log.error('[DATABASE] Failed to add provided_materials_json column:', err);
          } else {
            log.info('[DATABASE] Added provided_materials_json column to requests table');
          }
        });
      }
      
      if (!hasClaimedAt) {
        db.run(`ALTER TABLE requests ADD COLUMN claimed_at TEXT`, (err) => {
          if (err) {
            log.error('[DATABASE] Failed to add claimed_at column:', err);
          } else {
            log.info('[DATABASE] Added claimed_at column to requests table');
          }
        });
      }
      
      if (!hasAuditLog) {
        db.run(`ALTER TABLE requests ADD COLUMN audit_log TEXT`, (err) => {
          if (err) {
            log.error('[DATABASE] Failed to add audit_log column:', err);
          } else {
            log.info('[DATABASE] Added audit_log column to requests table');
          }
        });
      }
      
      if (!hasQuantityRequested) {
        db.run(`ALTER TABLE requests ADD COLUMN quantity_requested INTEGER DEFAULT 1`, (err) => {
          if (err) {
            log.error('[DATABASE] Failed to add quantity_requested column:', err);
          } else {
            log.info('[DATABASE] Added quantity_requested column to requests table');
          }
        });
      }

      if (!hasQuantityCompleted) {
        db.run(`ALTER TABLE requests ADD COLUMN quantity_completed INTEGER DEFAULT 0`, (err) => {
          if (err) {
            log.error('[DATABASE] Failed to add quantity_completed column:', err);
          } else {
            log.info('[DATABASE] Added quantity_completed column to requests table');
          }
        });
      }
    });
  });

  // Start the session cleanup routine
  startSessionCleanup();
  
  // Migration: Fix corrupted materials_json data
  fixMaterialsJsonFormat();
}

/**
 * Migration function to fix materials_json format
 * Converts any array format to proper object format
 */
async function fixMaterialsJsonFormat() {
  try {
    const requests = await all(`SELECT id, materials_json FROM requests WHERE materials_json IS NOT NULL AND materials_json != ''`);
    
    let fixedCount = 0;
    for (const req of requests) {
      try {
        const materials = JSON.parse(req.materials_json);
        
        // Check if it's in array format ["Material x10", ...]
        if (Array.isArray(materials)) {
          log.warn(`[DB_MIGRATION] Request ${req.id} has array format materials, converting...`);
          
          const convertedMaterials = {};
          for (const materialStr of materials) {
            const match = materialStr.match(/^(.+?)\s+x(\d+)$/);
            if (match) {
              const [, materialName, quantity] = match;
              convertedMaterials[materialName.trim()] = parseInt(quantity, 10);
            }
          }
          
          // Update the database with corrected format
          await run(
            `UPDATE requests SET materials_json = ? WHERE id = ?`,
            [JSON.stringify(convertedMaterials), req.id]
          );
          
          fixedCount++;
          log.info(`[DB_MIGRATION] Fixed materials format for request ${req.id}`);
        }
        // Check if it's in malformed object format with numeric keys
        else if (typeof materials === 'object' && materials !== null) {
          const hasNumericKeys = Object.keys(materials).some(key => key.match(/^\d+$/));
          if (hasNumericKeys) {
            log.warn(`[DB_MIGRATION] Request ${req.id} has numeric keys, attempting to fix...`);
            
            // Try to reconstruct from the values if they're in "Material xQty" format
            const convertedMaterials = {};
            for (const [key, value] of Object.entries(materials)) {
              // Skip numeric keys and try to parse the value
              if (key.match(/^\d+$/)) {
                const match = value.match(/^(.+?)\s+x(\d+)$/);
                if (match) {
                  const [, materialName, quantity] = match;
                  convertedMaterials[materialName.trim()] = parseInt(quantity, 10);
                }
              } else {
                // Keep non-numeric keys as-is
                convertedMaterials[key] = parseInt(value, 10) || 0;
              }
            }
            
            if (Object.keys(convertedMaterials).length > 0) {
              await run(
                `UPDATE requests SET materials_json = ? WHERE id = ?`,
                [JSON.stringify(convertedMaterials), req.id]
              );
              
              fixedCount++;
              log.info(`[DB_MIGRATION] Fixed materials format for request ${req.id}`);
            }
          }
        }
      } catch (err) {
        log.error(`[DB_MIGRATION] Failed to fix materials for request ${req.id}:`, err);
      }
    }
    
    if (fixedCount > 0) {
      log.info(`[DB_MIGRATION] Fixed materials format for ${fixedCount} request(s)`);
    }
  } catch (err) {
    log.error('[DB_MIGRATION] Failed to run materials migration:', err);
  }
}

// Promise-based wrappers
function run(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Character functions
function registerCharacter(userId, name, type) {
  return run(
    `INSERT INTO characters (user_id, name, type) VALUES (?, ?, ?)`,
    [userId, name, type]
  );
}

function getCharactersByUser(userId) {
  return all(`SELECT * FROM characters WHERE user_id = ?`, [userId]);
}

async function deleteCharacter(userId, characterId) {
    try {
        // Get character name before deletion
        const character = await get('SELECT name FROM characters WHERE id = ? AND user_id = ?', [characterId, userId]);
        if (!character) {
            throw new Error('Character not found');
        }

        // Get all open or in-progress requests for this character
        const requests = await all(
            `SELECT id FROM requests WHERE character = ? AND user_id = ? AND status IN ('open', 'claimed', 'in_progress')`,
            [character.name, userId]
        );

        // Cancel each request with audit log
        const timestamp = new Date().toISOString();
        for (const request of requests) {
            // Update request status to denied with reason
            await run(
                `UPDATE requests SET status = 'denied', deny_reason = ?, updated_at = ? WHERE id = ?`,
                ['Character deleted by owner', timestamp, request.id]
            );

            // Add audit log entry
            await appendAuditLog(request.id, 'cancelled_character_deleted', userId, {
                reason: 'Character deleted by owner'
            });
        }

        // Delete the character
        await run(`DELETE FROM characters WHERE id = ? AND user_id = ?`, [characterId, userId]);

        log.info(`[DB] Deleted character ${character.name} (ID: ${characterId}) for user ${userId}, cancelled ${requests.length} requests`);
        return { deletedCharacter: character.name, cancelledRequests: requests.length };
    } catch (err) {
        log.error('[DB] Error deleting character:', err);
        throw err;
    }
}

// Request functions
function getRequestById(id) {
  return get(`SELECT * FROM requests WHERE id = ?`, [id]);
}

function getRequestsByCharacters(characters, statuses, limit = 10, profession = null) {
  const cp = characters.map(() => '?').join(',');
  const sp = statuses.map(() => '?').join(',');
  
  let query = `SELECT * FROM requests WHERE character IN (${cp}) AND status IN (${sp})`;
  let params = [...characters, ...statuses];
  
  if (profession) {
    query += ` AND profession = ?`;
    params.push(profession);
  }
  
  query += ` ORDER BY updated_at DESC LIMIT ?`;
  params.push(limit);
  
  return all(query, params);
}

function getRequestsByUserId(userId, statuses, limit = 10, profession = null) {
  const sp = statuses.map(() => '?').join(',');
  
  let query = `SELECT * FROM requests WHERE user_id = ? AND status IN (${sp})`;
  let params = [userId, ...statuses];
  
  if (profession) {
    query += ` AND profession = ?`;
    params.push(profession);
  }
  
  query += ` ORDER BY updated_at DESC LIMIT ?`;
  params.push(limit);
  
  return all(query, params);
}

function getAllRequests() {
  return all(
    `SELECT * FROM requests ORDER BY id ASC`
  );
}

function getRequestsByProfession(profession, statusFilter) {
  const placeholders = Array.isArray(statusFilter)
    ? statusFilter.map(() => '?').join(',')
    : '?';
  const params = Array.isArray(statusFilter)
    ? [profession, ...statusFilter]
    : [profession, statusFilter];

  return all(
    `SELECT * FROM requests
      WHERE profession = ?
        AND status IN (${placeholders})
      ORDER BY updated_at DESC`,
    params
  );
}

function updateRequestStatus(id, status, claimedBy = null) {
  return new Promise(async (resolve, reject) => {
    try {
      // First, fetch the current request to validate the transition
      const request = await get('SELECT status FROM requests WHERE id = ?', [id]);
      
      if (!request) {
        return reject(new Error(`Request with id ${id} not found`));
      }

      // Validate the status transition
      if (!isValidStatusTransition(request.status, status)) {
        const err = new Error(
          `Invalid status transition: ${request.status} -> ${status}`
        );
        log.warn('[DB] Invalid status transition:', err.message);
        return reject(err);
      }

      const timestamp = new Date().toISOString();
      if (status === 'claimed') {
        await run(
          `UPDATE requests
             SET status = ?, claimed_by = ?, claimed_by_name = ?, updated_at = ?
           WHERE id = ?`,
          [status, claimedBy, null, timestamp, id]
        );
      } else {
        await run(
          `UPDATE requests
             SET status = ?, updated_at = ?
           WHERE id = ?`,
          [status, timestamp, id]
        );
      }

      resolve({ changes: 1 });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Validates status transitions to prevent invalid state changes.
 * Valid transitions:
 * - open -> claimed
 * - open -> denied
 * - claimed -> in_progress
 * - claimed -> denied
 * - in_progress -> complete
 * - in_progress -> denied
 * - Any status -> denied (override)
 * @param {string} currentStatus
 * @param {string} newStatus
 * @returns {boolean}
 */
function isValidStatusTransition(currentStatus, newStatus) {
  const validTransitions = {
    'open': ['claimed', 'denied'],
    'claimed': ['in_progress', 'denied'],
    'in_progress': ['complete', 'denied'], // Allow admin cancellation
    'complete': [], // Terminal state
    'denied': []     // Terminal state (user-facing: "Cancelled")
  };

  if (!validTransitions[currentStatus]) {
    log.warn(`[DB] Unknown current status: ${currentStatus}`);
    return false;
  }

  // Special case: 'cancelled' was renamed to 'denied' internally
  if (newStatus === 'cancelled') {
    log.error(`[DB] Attempted to use deprecated 'cancelled' status. Use 'denied' instead. This may indicate cached code - restart the bot.`);
    return false;
  }

  return validTransitions[currentStatus].includes(newStatus);
}

function getClaimedRequestsByUser(userId) {
  return all(
    `SELECT * FROM requests
      WHERE claimed_by = ?
        AND status IN ('claimed','in_progress')`,
    [userId]
  );
}

/**
 * Checks for duplicate requests within a given time window (in milliseconds).
 * Prevents users from submitting identical requests in rapid succession.
 * @param {string} userId
 * @param {string} character
 * @param {string} profession
 * @param {string} gear_slot
 * @param {string} request_id
 * @param {number} timeWindowMs - Time window to check for duplicates (default: 5000ms = 5 seconds)
 * @returns {Promise<boolean>} true if a duplicate was found, false otherwise
 */
async function checkDuplicateRequest(userId, character, profession, gear_slot, request_id, timeWindowMs = 5000) {
  const recentTime = new Date(Date.now() - timeWindowMs).toISOString();
  const duplicate = await get(
    `SELECT id FROM requests
      WHERE user_id = ?
        AND character = ?
        AND profession = ?
        AND gear_slot = ?
        AND request_id = ?
        AND created_at > ?
      LIMIT 1`,
    [userId, character, profession, gear_slot, request_id, recentTime]
  );
  return !!duplicate;
}

// Add a new request (using generic request_id & request_name)
function addRequest({ user_id, character, profession, gear_slot, request_id, request_name, materials_json, provided_materials_json, provides_materials, quantity_requested = 1, quantity_completed = 0 }) {
  // Validate required fields
  if (!user_id || !character || !profession || !gear_slot || !request_id || !request_name) {
    log.error('[DB] addRequest: Missing required fields', {
      user_id: !!user_id,
      character: !!character,
      profession: !!profession,
      gear_slot: !!gear_slot,
      request_id: !!request_id,
      request_name: !!request_name
    });
    return Promise.reject(new Error('Missing required request fields: user_id, character, profession, gear_slot, request_id, and request_name are all required'));
  }

  const ts = new Date().toISOString();
  const initialAuditLog = JSON.stringify([{
    action: 'created',
    by: user_id,
    at: ts
  }]);
  
  return run(
    `INSERT INTO requests
       (user_id, character, profession, gear_slot, request_id, request_name, materials_json, provided_materials_json, provides_materials, quantity_requested, quantity_completed, audit_log, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [user_id, character, profession, gear_slot, request_id, request_name, materials_json, provided_materials_json || '{}', provides_materials, quantity_requested, quantity_completed, initialAuditLog, ts, ts]
  );
}

// Session handling
function storeTempSession(sessionKey, userId, data = {}) {
  const json = JSON.stringify(data);
  log.debug(`[DB] Storing session for key: ${sessionKey}, user: ${userId}`);
  return run(
    `INSERT OR REPLACE INTO temp_sessions (session_key, user_id, data_json) VALUES (?, ?, ?)`,
    [sessionKey, userId, json]
  );
}

function getTempSession(sessionKey) {
  log.debug(`[DB] Getting session for key: ${sessionKey}`);
  return get(`SELECT data_json FROM temp_sessions WHERE session_key = ?`, [sessionKey])
    .then(row => {
      if (row) {
        log.debug(`[DB] Session found for key: ${sessionKey}`);
        return JSON.parse(row.data_json);
      }
      log.error(`[DB] Session not found for key: ${sessionKey}`);
      return null;
    });
}

function hasActiveSession(userId) {
  log.debug(`[DB] Checking for active sessions for user: ${userId}`);
  return get(`SELECT COUNT(*) as count FROM temp_sessions WHERE user_id = ?`, [userId])
    .then(row => {
      const hasSession = row && row.count > 0;
      log.debug(`[DB] User ${userId} has ${row?.count || 0} active sessions`);
      return hasSession;
    });
}

function deleteTempSession(sessionKey) {
  log.debug(`[DB] Deleting session for key: ${sessionKey}`);
  return run(`DELETE FROM temp_sessions WHERE session_key = ?`, [sessionKey])
    .then(() => {
      log.debug(`[DB] Session deleted: ${sessionKey}`);
    });
}

// Audit logs
function logAction(userId, actionType, targetRequestId = null, details = {}) {
  const jsonDetails = JSON.stringify(details);
  return run(
    `INSERT INTO action_logs
       (user_id, action_type, target_request_id, details_json)
     VALUES (?, ?, ?, ?)`,
    [userId, actionType, targetRequestId, jsonDetails]
  );
}

/**
 * Appends an entry to the audit log for a request.
 * @param {number} requestId
 * @param {string} action - Type of action (created, claimed, status_change, completed, etc.)
 * @param {string} userId - User who performed the action
 * @param {object} details - Additional details about the action
 */
async function appendAuditLog(requestId, action, userId, details = {}) {
  try {
    const request = await get('SELECT audit_log FROM requests WHERE id = ?', [requestId]);
    if (!request) {
      throw new Error(`Request ${requestId} not found`);
    }

    const auditLog = request.audit_log ? JSON.parse(request.audit_log) : [];
    const entry = {
      action,
      by: userId,
      at: new Date().toISOString(),
      ...details
    };
    auditLog.push(entry);

    await run(
      'UPDATE requests SET audit_log = ? WHERE id = ?',
      [JSON.stringify(auditLog), requestId]
    );

    log.debug(`[DB] Appended audit log entry for request ${requestId}: ${action}`);
  } catch (err) {
    log.error(`[DB] Failed to append audit log for request ${requestId}:`, err);
    throw err;
  }
}

/**
 * Claims a request for a crafter.
 * @param {number} requestId
 * @param {string} userId - The crafter's user ID
 * @param {string} userName - The crafter's Discord username
 */
async function claimRequest(requestId, userId, userName) {
  const timestamp = new Date().toISOString();
  
  await run(
    `UPDATE requests
       SET status = 'in_progress', claimed_by = ?, claimed_by_name = ?, claimed_at = ?, updated_at = ?
     WHERE id = ?`,
    [userId, userName, timestamp, timestamp, requestId]
  );

  await appendAuditLog(requestId, 'claimed', userId, { userName });
  log.info(`[DB] Request ${requestId} claimed by ${userName} (${userId})`);
}

/**
 * Releases a claimed request back to open status.
 * @param {number} requestId
 * @param {string} userId - The user releasing the request
 */
async function releaseRequest(requestId, userId) {
  const timestamp = new Date().toISOString();
  
  await run(
    `UPDATE requests
       SET status = 'open', claimed_by = NULL, claimed_by_name = NULL, claimed_at = NULL, updated_at = ?
     WHERE id = ?`,
    [timestamp, requestId]
  );

  await appendAuditLog(requestId, 'released', userId);
  log.info(`[DB] Request ${requestId} released by user ${userId}`);
}

/**
 * Completes a request.
 * @param {number} requestId
 * @param {string} userId - The crafter completing the request
 */
async function completeRequest(requestId, userId) {
  // Deprecated single-complete signature maintained for backwards compatibility
  return completeRequestWithQuantity(requestId, userId, null);
}

/**
 * Completes a request, supporting partial quantity completions.
 * If `completedQty` is null, the request is treated as fully completed.
 */
async function completeRequestWithQuantity(requestId, userId, completedQty = null) {
  try {
    const timestamp = new Date().toISOString();

    const req = await get('SELECT quantity_requested, quantity_completed FROM requests WHERE id = ?', [requestId]);
    if (!req) throw new Error(`Request ${requestId} not found`);

    const qtyRequested = parseInt(req.quantity_requested || 1, 10);
    const currentCompleted = parseInt(req.quantity_completed || 0, 10);

    if (completedQty === null) {
      // Full completion
      await run(
        `UPDATE requests
           SET status = 'complete', quantity_completed = ?, updated_at = ?
         WHERE id = ?`,
        [qtyRequested, timestamp, requestId]
      );

      await appendAuditLog(requestId, 'completed', userId, { completed: qtyRequested, totalCompleted: qtyRequested });
      log.info(`[DB] Request ${requestId} marked complete by user ${userId} (full)`);
      return;
    }

    // Partial completion requested
    const add = parseInt(completedQty || 0, 10);
    const newCompleted = Math.min(qtyRequested, currentCompleted + add);
    const newStatus = newCompleted >= qtyRequested ? 'complete' : 'in_progress';

    await run(
      `UPDATE requests
         SET quantity_completed = ?, status = ?, updated_at = ?
       WHERE id = ?`,
      [newCompleted, newStatus, timestamp, requestId]
    );

    await appendAuditLog(requestId, 'partial_completed', userId, { added: add, totalCompleted: newCompleted });
    log.info(`[DB] Request ${requestId} partial complete by ${userId}: +${add} (now ${newCompleted}/${qtyRequested})`);
  } catch (err) {
    log.error('[DB] Error completing request with quantity:', err);
    throw err;
  }
}

/**
 * Gets all open requests for a specific profession.
 * @param {string} profession
 */
function getOpenRequestsByProfession(profession) {
  return all(
    `SELECT * FROM requests
      WHERE profession = ? AND status = 'open'
      ORDER BY created_at ASC`,
    [profession]
  );
}

/**
 * Gets all in-progress and recently cancelled requests claimed by a specific user.
 * Includes denied status so crafters can see why their work disappeared.
 * @param {string} userId
 */
function getInProgressRequestsByUser(userId) {
  return all(
    `SELECT * FROM requests
      WHERE claimed_by = ? AND status IN ('claimed', 'in_progress', 'denied')
      ORDER BY 
        CASE status
          WHEN 'in_progress' THEN 1
          WHEN 'claimed' THEN 2
          WHEN 'denied' THEN 3
        END,
        claimed_at ASC`,
    [userId]
  );
}

/**
 * Gets all requests (any status) for a specific character.
 * @param {string} characterName
 */
function getRequestsByCharacterName(characterName) {
  return all(
    `SELECT * FROM requests
      WHERE character = ?
      ORDER BY created_at DESC`,
    [characterName]
  );
}

/**
 * Gets summary of requests grouped by profession and status.
 */
async function getRequestSummary() {
  const summary = await all(
    `SELECT profession, status, COUNT(*) as count, claimed_by_name
      FROM requests
      WHERE status IN ('open', 'in_progress')
      GROUP BY profession, status, claimed_by_name
      ORDER BY profession, status`
  );
  
  return summary;
}

/**
 * Gets all requests claimed by a specific crafter (by user ID), grouped by status.
 * @param {string} userId
 */
function getAllRequestsByClaimedUser(userId) {
  return all(
    `SELECT * FROM requests
      WHERE claimed_by = ?
      ORDER BY status, updated_at DESC`,
    [userId]
  );
}

/**
 * Gets all unique crafters who have claimed requests.
 * @param {boolean} includeCompleted - Whether to include crafters with only completed requests
 */
async function getAllCrafters(includeCompleted = false) {
  const statusFilter = includeCompleted 
    ? `status IN ('in_progress', 'complete')`
    : `status = 'in_progress'`;
    
  const crafters = await all(
    `SELECT DISTINCT claimed_by, claimed_by_name
      FROM requests
      WHERE claimed_by IS NOT NULL AND ${statusFilter}
      ORDER BY claimed_by_name ASC`
  );
  
  return crafters;
}

/**
 * Gets all unique crafters with their professions and last activity.
 * Orders by most recent completion/claim time.
 * @returns {Array} Array of crafter objects with professions array and last_activity timestamp
 */
async function getAllCraftersWithProfessions() {
  const crafters = await all(
    `SELECT 
       claimed_by,
       claimed_by_name,
       GROUP_CONCAT(DISTINCT profession) as professions,
       MAX(updated_at) as last_activity,
       SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count,
       SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) as completed_count
     FROM requests
     WHERE claimed_by IS NOT NULL 
       AND status IN ('in_progress', 'complete')
     GROUP BY claimed_by, claimed_by_name
     ORDER BY last_activity DESC`
  );
  
  // Parse professions string into array
  return crafters.map(crafter => ({
    ...crafter,
    professions: crafter.professions ? crafter.professions.split(',') : []
  }));
}

/**
 * Starts a periodic cleanup task that deletes expired temp sessions.
 * Sessions older than SESSION_EXPIRY_TIME are removed.
 */
function startSessionCleanup() {
  // Clear any existing timer
  if (cleanupTimer) clearInterval(cleanupTimer);

  // Run cleanup immediately on startup
  cleanupExpiredSessions();

  // Then run periodically
  cleanupTimer = setInterval(cleanupExpiredSessions, SESSION_CLEANUP_INTERVAL);
  log.info('[DB] Session cleanup routine started');
}

/**
 * Removes temp sessions that have expired.
 */
async function cleanupExpiredSessions() {
  try {
    const expiryDate = new Date(Date.now() - SESSION_EXPIRY_TIME).toISOString();
    const result = await run(
      `DELETE FROM temp_sessions WHERE created_at < ?`,
      [expiryDate]
    );
    if (result.changes && result.changes > 0) {
      log.info(`[DB] Cleaned up ${result.changes} expired session(s)`);
    }
  } catch (err) {
    log.error('[DB] Error during session cleanup:', err);
  }
}

/**
 * Records a DM channel as active for later cleanup
 * @param {string} userId - The user ID
 * @param {string} dmChannelId - The DM channel ID
 */
function trackActiveDM(userId, dmChannelId) {
  return run(
    `INSERT OR REPLACE INTO active_dms (user_id, dm_channel_id, last_activity) 
     VALUES (?, ?, CURRENT_TIMESTAMP)`,
    [userId, dmChannelId]
  );
}

/**
 * Gets all tracked DM channels for cleanup
 * @returns {Promise<Array>} Array of {user_id, dm_channel_id, last_activity}
 */
function getAllActiveDMs() {
  return all(`SELECT * FROM active_dms`);
}

/**
 * Removes a DM from tracking (after cleanup)
 * @param {string} userId - The user ID
 */
function removeActiveDM(userId) {
  return run(`DELETE FROM active_dms WHERE user_id = ?`, [userId]);
}

/**
 * Cleans up old DM tracking entries (older than 7 days)
 */
async function cleanupOldDMTracking() {
  try {
    const expiryDate = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString();
    const result = await run(
      `DELETE FROM active_dms WHERE last_activity < ?`,
      [expiryDate]
    );
    if (result.changes && result.changes > 0) {
      log.info(`[DB] Cleaned up ${result.changes} old DM tracking entries`);
    }
  } catch (err) {
    log.error('[DB] Error during DM tracking cleanup:', err);
  }
}

module.exports = {
  initDatabase,
  run,
  get,
  all,
  registerCharacter,
  getCharactersByUser,
  deleteCharacter,
  getRequestById,
  getRequestsByCharacters,
  getRequestsByUserId,
  getRequestsByProfession,
  updateRequestStatus,
  getClaimedRequestsByUser,
  addRequest,
  storeTempSession,
  getTempSession,
  deleteTempSession,
  hasActiveSession,
  logAction,
  cleanupExpiredSessions,
  checkDuplicateRequest,
  isValidStatusTransition,
  trackActiveDM,
  getAllActiveDMs,
  removeActiveDM,
  cleanupOldDMTracking,
  // New crafting queue functions
  appendAuditLog,
  claimRequest,
  releaseRequest,
  completeRequest,
  completeRequestWithQuantity,
  getOpenRequestsByProfession,
  getInProgressRequestsByUser,
  getRequestsByCharacterName,
  getRequestSummary,
  getAllRequestsByClaimedUser,
  getAllCrafters,
  getAllCraftersWithProfessions,
  getAllRequests
};
