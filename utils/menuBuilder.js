// utils/menuBuilder.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Builds the standardized menu content and button layout
 * Used by both primaryChannel.js and dmMenu.js for consistency
 * @returns {Object} { content, components }
 */
function buildMainMenu() {
  // First row: Manage Requests button (separated, top position)
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('action_manage_requests')
      .setLabel('🔨 Manage Requests')
      .setStyle(ButtonStyle.Success)
  );

  // Second row: Primary action buttons (3 buttons in a row)
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('action_request')
      .setLabel('🧵 Create New Request')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('action_status')
      .setLabel('📋 My Requests')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('action_manage_characters')
      .setLabel('👤 Manage Characters')
      .setStyle(ButtonStyle.Secondary)
  );

  const content = 
    `📌 **Welcome to the Guild Request System!**\n\n` +
    `**🔨 Manage Requests** — For crafters and admins to manage the crafting queue\n\n` +
    `Use the buttons below to interact with the bot:\n` +
    `• 🧵 **Create New Request** — Start a new profession request\n` +
    `• 📋 **My Requests** — Check your personal requests\n` +
    `• 👤 **Manage Characters** — Register or manage your characters\n\n` +
    `You can also use these slash commands (server only, won't work in DM):\n` +
    `• **/request** — Start a new profession request\n` +
    `• **/status** — Check your personal requests\n` +
    `• **/register** — Manage your main and alt characters\n` +
    `• **/requests** — View all profession requests by status/profession\n\n` +
    `Please follow guild rules and have all required materials ready.`;

  return {
    content,
    components: [row1, row2]
  };
}

module.exports = {
  buildMainMenu
};
