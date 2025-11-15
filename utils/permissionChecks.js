// utils/permissionChecks.js
const config = require('../config/config.js');
const log = require('./logWriter.js');

/**
 * Gets the professions that a member has permission for (based on role IDs).
 * HIERARCHICAL: Admin role grants access to ALL professions automatically.
 * @param {import('discord.js').GuildMember} member
 * @returns {string[]} Array of profession names
 */
function getUserProfessionRoles(member) {
  if (!member) return [];
  
  // HIERARCHY: Admin role grants ALL profession permissions
  if (config.adminRoleId && member.roles.cache.has(config.adminRoleId)) {
    const allProfessions = Object.keys(config.professionRoles);
    
    if (config.debugMode) {
      log.debug('[PERMISSION] Admin detected - granting ALL profession permissions');
      log.debug(`  User: ${member.user.tag} (${member.user.id})`);
      log.debug(`  Granted Professions: [${allProfessions.join(', ')}]`);
    }
    
    return allProfessions;
  }
  
  // Non-admin: Check individual profession roles
  const matched = [];
  for (const [profession, roleId] of Object.entries(config.professionRoles)) {
    // Skip if role ID is not configured (null)
    if (!roleId) continue;
    
    // Check if member has this role by ID
    if (member.roles.cache.has(roleId)) {
      matched.push(profession);
    }
  }
  
  if (config.debugMode) {
    const userRoleIds = member.roles.cache.map(r => r.id).join(', ');
    log.debug('[PERMISSION] Profession Role Check:');
    log.debug(`  User: ${member.user.tag} (${member.user.id})`);
    log.debug(`  User's Role IDs: [${userRoleIds}]`);
    log.debug(`  Configured Profession Roles:`, config.professionRoles);
    log.debug(`  Matched Professions: [${matched.join(', ')}]`);
  }
  
  return matched;
}

/**
 * Checks if a member is an admin (based on role ID).
 * @param {import('discord.js').GuildMember} member
 * @returns {boolean}
 */
function isAdmin(member) {
  if (!member || !config.adminRoleId) return false;
  
  const hasRole = member.roles.cache.has(config.adminRoleId);
  
  if (config.debugMode) {
    log.debug('[PERMISSION] Admin Role Check:');
    log.debug(`  User: ${member.user.tag} (${member.user.id})`);
    log.debug(`  Required Admin Role ID: ${config.adminRoleId}`);
    log.debug(`  Has Admin Role: ${hasRole}`);
  }
  
  return hasRole;
}

/**
 * Checks if a member has the required registration role.
 * HIERARCHICAL: Admin and profession roles automatically grant register permission.
 * @param {import('discord.js').GuildMember} member
 * @returns {boolean}
 */
function hasRegisterRole(member) {
  if (!member || !config.requiredRegisterRoleId) {
    if (config.debugMode) {
      log.debug('[PERMISSION] No member or requiredRegisterRoleId not configured - allowing access');
    }
    return true; // Allow if not configured
  }
  
  // HIERARCHY: Admin role grants register permission
  if (config.adminRoleId && member.roles.cache.has(config.adminRoleId)) {
    if (config.debugMode) {
      log.debug('[PERMISSION] Admin detected - granting register permission');
      log.debug(`  User: ${member.user.tag} (${member.user.id})`);
    }
    return true;
  }
  
  // HIERARCHY: Any profession role grants register permission
  for (const roleId of Object.values(config.professionRoles)) {
    if (roleId && member.roles.cache.has(roleId)) {
      if (config.debugMode) {
        log.debug('[PERMISSION] Profession role detected - granting register permission');
        log.debug(`  User: ${member.user.tag} (${member.user.id})`);
      }
      return true;
    }
  }
  
  // Base check: Direct register role
  const hasRole = member.roles.cache.has(config.requiredRegisterRoleId);
  
  if (config.debugMode) {
    const userRoleIds = member.roles.cache.map(r => r.id).join(', ');
    log.debug('[PERMISSION] Register Role Check:');
    log.debug(`  User: ${member.user.tag} (${member.user.id})`);
    log.debug(`  Required Role ID: ${config.requiredRegisterRoleId}`);
    log.debug(`  User's Role IDs: [${userRoleIds}]`);
    log.debug(`  Has Required Role: ${hasRole}`);
  }
  
  return hasRole;
}

/**
 * Check if member has Core role (required for guild-provided materials)
 * @param {import('discord.js').GuildMember} member
 * @returns {boolean}
 */
function hasCoreRole(member) {
  if (!member || !config.coreRoleId) {
    if (config.debugMode) {
      log.debug('[PERMISSION] No member or coreRoleId not configured - denying Core access');
    }
    return false; // Deny if not configured
  }
  
  // Admin role grants Core permission
  if (config.adminRoleId && member.roles.cache.has(config.adminRoleId)) {
    if (config.debugMode) {
      log.debug('[PERMISSION] Admin detected - granting Core permission');
      log.debug(`  User: ${member.user.tag} (${member.user.id})`);
    }
    return true;
  }
  
  // Direct Core role check
  const hasRole = member.roles.cache.has(config.coreRoleId);
  
  if (config.debugMode) {
    const userRoleIds = member.roles.cache.map(r => r.id).join(', ');
    log.debug('[PERMISSION] Core Role Check:');
    log.debug(`  User: ${member.user.tag} (${member.user.id})`);
    log.debug(`  Required Role ID: ${config.coreRoleId}`);
    log.debug(`  User's Role IDs: [${userRoleIds}]`);
    log.debug(`  Has Required Role: ${hasRole}`);
  }
  
  return hasRole;
}

module.exports = {
  getUserProfessionRoles,
  isAdmin,
  hasRegisterRole,
  hasCoreRole
};
