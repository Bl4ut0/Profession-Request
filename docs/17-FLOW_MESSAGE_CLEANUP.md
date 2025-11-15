# Flow Message Cleanup System

**Document:** 17-FLOW_MESSAGE_CLEANUP.md  
**Date:** November 13, 2025  
**Status:** ✅ IMPLEMENTED

---

## Overview

The flow message cleanup system prevents visual clutter by automatically cleaning up previous flow messages when a user starts a new flow. This ensures users always see a clean interface with just the main menu (in DM mode) and the current flow they're working on.

## Problem Statement

### Before Implementation
When users navigated between flows (e.g., Create Request → My Requests → Create Request), previous flow messages would accumulate:

```
[DM Channel View]
📌 Welcome to the Guild Request System! [Main Menu - stays]

🧵 New Request                          [Old flow - should be cleaned]
Who is this request for?
[Dropdown menu]

📋 My Requests                          [Old flow - should be cleaned]
Select a profession...
[Buttons]

🧵 New Request                          [Current flow - keep]
Who is this request for?
[Dropdown menu]
```

This created confusion and visual clutter.

### After Implementation
```
[DM Channel View]
📌 Welcome to the Guild Request System! [Main Menu - stays]

🧵 New Request                          [Current flow - keep]
Who is this request for?
[Dropdown menu]
```

Clean, focused interface with only the current active flow.

---

## Architecture

### Core Components

#### 1. **Message Tracking System** (`utils/cleanupService.js`)

```javascript
// Flow message tracking - tracks messages created by each flow for cleanup
// Structure: Map<userId, { channelId, messageIds: Set<messageId>, flowType }>
const flowMessages = new Map();
```

Tracks all messages created during a user's flow session for later cleanup.

#### 2. **Cleanup Functions**

##### `trackFlowMessage(userId, channelId, messageId, flowType)`
Records a message for future cleanup.

**Parameters:**
- `userId` - User who initiated the flow
- `channelId` - Channel where message was sent
- `messageId` - Message ID to track
- `flowType` - Flow identifier (e.g., 'request', 'status', 'character')

**Example:**
```javascript
const msg = await channel.send({ content: '...' });
cleanupService.trackFlowMessage(userId, channel.id, msg.id, 'request');
```

##### `cleanupFlowMessages(userId, client, preserveMenu = true)`
Deletes all tracked messages for a user's previous flow.

**Parameters:**
- `userId` - User whose messages to clean
- `client` - Discord client instance
- `preserveMenu` - Whether to preserve DM menu (default: true)

**Example:**
```javascript
// Call at START of new flow to clean previous flow
await cleanupService.cleanupFlowMessages(userId, client);
```

##### `clearFlowTracking(userId)`
Clears tracking without deleting messages (for flow completion).

**Example:**
```javascript
// Call at END of flow when user completes their action
cleanupService.clearFlowTracking(userId);
cleanupService.clearUserActivity(userId);
```

---

## Integration Pattern

### Flow Start Pattern

**Call at the beginning of EVERY flow:**

```javascript
async function handleYourFlow(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // ** CLEANUP: Clear previous flow messages **
  await cleanupService.cleanupFlowMessages(userId, client);
  
  // ** RE-ESTABLISH: Ensure DM menu is present if in DM mode **
  if (config.requestMode === 'dm' && channel.type === ChannelType.DM) {
    await ensureDMMenu(channel, client);
  }
  
  // Continue with flow...
  const msg = await channel.send({ /* your content */ });
  
  // ** TRACK: Track this message for cleanup on next flow **
  cleanupService.trackFlowMessage(userId, channel.id, msg.id, 'your_flow_type');
  
  // ... rest of flow
}
```

### Flow Completion Pattern

**Call when user COMPLETES a flow (e.g., request submitted, character registered):**

```javascript
// ** CLEAR TRACKING: Flow complete, clear message tracking **
cleanupService.clearFlowTracking(userId);
cleanupService.clearUserActivity(userId);

// Then schedule final cleanup
if (config.requestMode === 'channel') {
  cleanupService.scheduleChannelDeletion(channel, config.confirmationDisplayTime);
} else if (config.requestMode === 'dm') {
  cleanupService.scheduleDMCleanup(channel, client, config.confirmationDisplayTime, userId);
}
```

---

## Implementation by Flow

### ✅ Request Flow (`interactions/shared/requestFlow.js`)

**Start:** `handleRequestFlow()`
- Cleans previous messages
- Re-establishes DM menu
- Tracks initial message

**Complete:** After request submission
- Clears tracking
- Schedules final cleanup

### ✅ Status Flow (`interactions/shared/statusFlow.js`)

**Start:** `handleStatusCommand()`
- Cleans previous messages
- Re-establishes DM menu
- Tracks status menu message

**Note:** Status is a viewing flow, so it doesn't have a "completion" - cleanup happens on next flow start.

### ✅ Requests Overview (`interactions/shared/requestsFlow.js`)

**Start:** `handleRequestsOverview()`
- Cleans previous messages
- Re-establishes DM menu
- Tracks overview message

**Complete:** Immediately after display
- Clears tracking
- Schedules final cleanup

### ✅ Character Management (`interactions/shared/characterFlow.js`)

**Start:** `handleCharacterManagement()`
- Cleans previous messages
- Re-establishes DM menu
- Tracks character menu message

**Complete:** After character registration
- Clears tracking
- Schedules final cleanup

---

## Flow Lifecycle Example

### Scenario: User Creates Request, Views Status, Creates Another Request

#### Step 1: Create Request (First)
```
1. User clicks "Create New Request" button
2. handleRequestFlow() called
   - cleanupFlowMessages() → Nothing to clean (first flow)
   - ensureDMMenu() → Menu already present
   - Sends character selection message
   - trackFlowMessage() → Tracks message ID #123
```

**DM View:**
```
📌 Welcome Menu [Main]
🧵 New Request [Tracked: #123]
  Choose character...
```

#### Step 2: User Completes Request
```
1. User finishes request flow
2. Confirmation sent
3. clearFlowTracking() → Clears tracking for #123
4. scheduleDMCleanup() → Schedules cleanup in 30s
```

#### Step 3: User Views Status (Before cleanup timer)
```
1. User clicks "My Requests" button
2. handleStatusCommand() called
   - cleanupFlowMessages() → Deletes message #123
   - ensureDMMenu() → Menu already present
   - Sends status menu message
   - trackFlowMessage() → Tracks message ID #456
```

**DM View:**
```
📌 Welcome Menu [Main]
📋 My Requests [Tracked: #456]
  Select profession...
```

#### Step 4: User Creates Another Request
```
1. User clicks "Create New Request" button
2. handleRequestFlow() called
   - cleanupFlowMessages() → Deletes message #456
   - ensureDMMenu() → Menu already present
   - Sends character selection message
   - trackFlowMessage() → Tracks message ID #789
```

**DM View:**
```
📌 Welcome Menu [Main]
🧵 New Request [Tracked: #789]
  Choose character...
```

**Result:** Always clean, only current flow visible!

---

## Key Features

### 🧹 Automatic Cleanup
- Previous flow messages deleted when new flow starts
- No manual intervention required
- Works seamlessly with all flow types

### 📌 Menu Preservation
- DM menu is NEVER deleted
- Menu is re-established after cleanup (if missing)
- Ensures users always have navigation access

### 🔄 Flow Independence
- Each flow is tracked independently
- Multiple users can use flows simultaneously
- No cross-user interference

### ⚡ Performance
- Minimal overhead (in-memory tracking)
- Efficient batch deletion
- Rate-limit aware (50ms delays)

### 🛡️ Error Handling
- Graceful handling of already-deleted messages
- Falls back safely if cleanup fails
- Logs issues for debugging

---

## Configuration

### No Additional Config Required
The cleanup system works with existing configuration:

```javascript
// config/config.js
{
  requestMode: 'dm',              // or 'channel'
  tempChannelTTL: 90000,          // 90 seconds
  confirmationDisplayTime: 30000   // 30 seconds
}
```

### Cleanup Behavior by Mode

#### DM Mode
- Cleans all bot messages except main menu
- Preserves menu between flows
- Respects `confirmationDisplayTime` for final messages

#### Channel Mode
- Creates new channel for each flow
- Deletes entire channel on completion
- No message tracking needed (channel deletion handles cleanup)

---

## Developer Guidelines

### When to Track Messages

**✅ DO track:**
- Initial flow messages (menus, prompts)
- Messages that should be cleaned on next flow

**❌ DON'T track:**
- Main menu messages (auto-preserved)
- Messages updated via `interaction.update()` (same message)
- Final confirmation messages (cleanup scheduled separately)

### When to Clean

**✅ DO clean:**
- At the START of every new flow
- Before sending new flow content

**❌ DON'T clean:**
- In the middle of a flow
- After every interaction (too aggressive)
- During dropdown updates (no new messages)

### When to Clear Tracking

**✅ DO clear:**
- When flow completes successfully
- When user submits final data
- When transitioning out of flow

**❌ DON'T clear:**
- At flow start (cleanup does this)
- On every interaction
- Before flow completes

---

## Testing Checklist

### Manual Testing

- [ ] Start request flow → Check only menu + flow visible
- [ ] Complete request → Check confirmation visible
- [ ] Start status flow → Check previous flow cleaned
- [ ] Start request again → Check status flow cleaned
- [ ] Verify menu never deleted in DM mode
- [ ] Test in channel mode → Verify channel cleanup works
- [ ] Test with multiple users → Verify no interference

### Scenarios to Verify

1. **Flow → Flow Navigation**
   - Create request → My requests → Create request
   - Verify only current flow visible

2. **Rapid Flow Switching**
   - Click through multiple flows quickly
   - Verify no message accumulation

3. **Flow Abandonment**
   - Start flow but don't complete
   - Start different flow
   - Verify abandoned flow cleaned

4. **Menu Preservation**
   - Delete all bot messages manually
   - Start new flow
   - Verify menu re-established

---

## Troubleshooting

### Messages Not Cleaning

**Cause:** Flow not calling `cleanupFlowMessages()` at start  
**Solution:** Add cleanup call to flow entry point

### Menu Getting Deleted

**Cause:** `preserveMenu` set to false or menu detection failing  
**Solution:** Check menu content matches: `📌 **Welcome to the Guild Request System!**`

### Messages Accumulating

**Cause:** Messages not being tracked with `trackFlowMessage()`  
**Solution:** Add tracking after every `channel.send()`

### Cleanup Too Slow

**Cause:** Rate limiting or many messages  
**Solution:** Normal behavior (50ms delay per message)

---

## Future Enhancements

### Planned Features
- [ ] Batch message deletion (if Discord API supports)
- [ ] Configurable cleanup delay
- [ ] Flow-specific cleanup rules
- [ ] Cleanup statistics/monitoring

### Potential Optimizations
- [ ] Cache message IDs in database (survive bot restart)
- [ ] Cleanup on bot restart (clear orphaned messages)
- [ ] Message age-based cleanup (delete very old messages)

---

## Related Documentation

- **[FLOW_STANDARDS.md](FLOW_STANDARDS.md)** - Flow architecture standards
- **[15-CONFIRMATION_DISPLAY_TIME.md](15-CONFIRMATION_DISPLAY_TIME.md)** - Cleanup timing configuration
- **[02-FLOW_ARCHITECTURE.md](02-FLOW_ARCHITECTURE.md)** - Flow patterns reference

---

## Migration Notes

### Breaking Changes
- ✅ No breaking changes - extends existing cleanup system

### New Requirements
- ✅ All flows MUST call `cleanupFlowMessages()` at start
- ✅ All flows MUST call `trackFlowMessage()` for new messages
- ✅ All flows MUST call `clearFlowTracking()` on completion

### Benefits
- 🧹 Clean, professional user experience
- 📱 Reduced visual clutter
- 🎯 Better focus on current task
- ♻️ Consistent behavior across all flows

---

**Status:** ✅ Production Ready  
**Impact:** Significantly improved UX in DM mode  
**Compatibility:** Fully backward compatible
