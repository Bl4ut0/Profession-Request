// interactions/shared/requestsFlow.js
const db = require('../../utils/database');
const config = require('../../config/config.js');
const { isAdmin, getUserProfessionRoles } = require('../../utils/permissionChecks');
const { resolveResponseChannel } = require('../../utils/requestChannel');
const { getNavigationMessage } = require('../../utils/navigationHelper');
const { getRequestLabel } = require('../../utils/requestFormatter');
const cleanupService = require('../../utils/cleanupService');
const { ensureDMMenu } = require('../../utils/dmMenu');
const { ChannelType } = require('discord.js');
const log = require('../../utils/logWriter');

/**
 * Helper to get guild member from interaction (works in both DM and guild contexts)
 */
async function getGuildMember(interaction, client) {
  if (interaction.member) {
    return interaction.member;
  }
  
  try {
    const guild = await client.guilds.fetch(config.guildId);
    const member = await guild.members.fetch(interaction.user.id);
    return member;
  } catch (err) {
    log.error('[REQUESTS_FLOW] Failed to fetch guild member:', err);
    return null;
  }
}

async function handleRequestsOverview(interaction, client) {
  // Fetch guild member (works in both DM and guild contexts)
  const member = await getGuildMember(interaction, client);
  const admin  = isAdmin(member);
  const roles  = getUserProfessionRoles(member);

  const profs = config.enabledProfessions.filter(p => admin || roles.includes(p));
  if (!profs.length) {
    return interaction.reply({
      content: '❌ You do not have access to view any profession queues.',
      flags: 1 << 6
    });
  }

  // ** CLEANUP: Clear ALL other Level 1 flows before starting requests overview **
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  // NOTE: resolveResponseChannel already calls ensureDMMenu in DM mode
  
  // ** TRACK: Remember this channel BEFORE cleanup **
  cleanupService.trackUserChannel(userId, channel.id);
  await cleanupService.cleanupAllFlowMessages(userId, client);

  let text = `📖 **All Requests Overview**\n`;

  for (const prof of profs) {
    const requests = await db.getRequestsByProfession(prof, config.defaultVisibleStatuses);
    if (requests.length) {
      text += `\n🔧 **${prof.toUpperCase()}**\n`;
      for (const req of requests) {
        const label = getRequestLabel(req);
        text += `• [${req.status}] ${req.character}: ${label} to ${req.gear_slot}\n`;
      }
    }
  }

  const msg = await channel.send({ content: text });
  
  // Schedule cleanup with submenu timeout (SUBMENU = viewing request list)
  if (config.requestMode === 'channel' && channel.type === ChannelType.GuildText) {
    const timeout = cleanupService.getCleanupTimeout(cleanupService.MessageType.SUBMENU);
    cleanupService.scheduleChannelDeletion(channel, timeout);
  } else if (config.requestMode === 'dm') {
    const timeout = cleanupService.getCleanupTimeout(cleanupService.MessageType.SUBMENU);
    cleanupService.scheduleDMCleanup(channel, client, timeout, interaction.user.id);
  }

  const confirmation = getNavigationMessage(interaction, channel);
  if (confirmation) {
    await interaction.reply({
      content: confirmation,
      flags: 1 << 6
    });
  } else {
    // In DM, just acknowledge without message
    await interaction.deferUpdate();
  }
}

module.exports = { handleRequestsOverview };
