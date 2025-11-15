// commands/requests.js
const { SlashCommandBuilder } = require('discord.js');
const db = require('../utils/database');
const config = require('../config/config.js');
const log = require('../utils/logWriter');
const { resolveResponseChannel } = require('../utils/requestChannel');
const cleanupService = require('../utils/cleanupService');
const { isAdmin, getUserProfessionRoles } = require('../utils/permissionChecks');
const { getRequestLabel } = require('../utils/requestFormatter');

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
    log.error('[REQUESTS_CMD] Failed to fetch guild member:', err);
    return null;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('requests')
    .setDescription('List requests by profession/status')
    .addStringOption(o => o.setName('profession').setDescription('Filter by profession').setRequired(false))
    .addStringOption(o => o.setName('status').    setDescription('Filter by status').    setRequired(false)),

  async execute(interaction, client) {
    try {
      const userId = interaction.user.id;
      const member = await getGuildMember(interaction, client);
      const admin = await isAdmin(member);
      const roles = getUserProfessionRoles(member);

      const profArg = interaction.options.getString('profession');
      const statArg = interaction.options.getString('status');

      let profs = [];
      if (admin) {
        profs = profArg ? [profArg] : config.enabledProfessions;
      } else {
        profs = profArg
          ? roles.includes(profArg) ? [profArg] : []
          : roles;
      }
      if (!profs.length) {
        return interaction.reply({ 
          content: `❌ You don't have permission to view requests for this profession. Check your roles.`, 
          flags: 1 << 6
        });
      }

      const channel = await resolveResponseChannel(interaction, client);
      
      // Schedule cleanup if in channel mode
      if (config.requestMode === 'channel') {
        cleanupService.scheduleChannelDeletion(channel);
      }

      for (const prof of profs) {
        const list = await db.getRequestsByProfession(prof, statArg || config.defaultVisibleStatuses);
        if (!list.length) {
          await channel.send(`📂 No ${prof} requests${statArg?` (${statArg})`:''}.`);
          continue;
        }
        let text = `📋 **${prof[0].toUpperCase()+prof.slice(1)} Requests**\n`;
        for (const req of list) {
          const label = getRequestLabel(req);
          text += `• ${req.character} — ${label} to ${req.gear_slot} (${req.status}`;
          if (req.claimed_by_name) text += ` by ${req.claimed_by_name}`;
          text += `)\n`;
        }
        await channel.send(text);
      }

      // Reply with navigation
      const confirmation = config.requestMode === 'dm'
        ? '✅ I\'ve sent the requests via DM—please check your direct messages.'
        : `✅ Request list is in <#${channel.id}>.`;
      
      await interaction.reply({ content: confirmation, flags: 1 << 6 });
    } catch (error) {
      log.error('Error in /requests:', error);
      const errorMessage = error.message.includes('channel')
        ? '❌ Could not create request channel. Check bot permissions.'
        : '❌ An error occurred while listing requests.';
      
      await interaction.reply({ content: errorMessage, flags: 1 << 6 });
    }
  }
};
