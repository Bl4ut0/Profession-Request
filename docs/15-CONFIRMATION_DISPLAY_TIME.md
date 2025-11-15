# Confirmation Display Time Implementation

**Status:** ✅ COMPLETE  
**Date:** 2025-01-XX  
**Type:** Configuration Enhancement

---

## Overview

Implemented configurable display time for final confirmation messages, separate from the intermediate flow cleanup timer. This allows users to read completion messages before they're cleaned up, while maintaining faster cleanup for in-progress flow steps.

---

## Problem Statement

Previously, all messages (intermediate steps and final confirmations) were cleaned up using the same `tempChannelTTL` timer (90 seconds). This meant:

1. Final confirmation messages (e.g., "✅ Request submitted successfully") disappeared at the same rate as intermediate flow steps
2. Users might not have enough time to read/screenshot final confirmations
3. No flexibility to configure different cleanup times for different message types

---

## Solution

### 1. Configuration Addition

Added new config option `confirmationDisplayTime` in `config/config.js`:

```javascript
confirmationDisplayTime: 30000, // Delay before cleaning up final confirmation messages (in milliseconds)
```

**Default:** 30 seconds (30000ms)  
**Purpose:** How long final confirmation messages remain visible before cleanup

This is separate from `tempChannelTTL` (90000ms), which continues to handle:
- Temporary channel creation in channel mode
- Intermediate flow step timeouts
- Inactivity cleanup during multi-step flows

### 2. Cleanup Service Enhancement

**File:** `utils/cleanupService.js`

#### Enhanced `scheduleChannelDeletion`
- Added optional `customDelay` parameter
- Defaults to `config.tempChannelTTL` if not specified
- Allows specifying custom delay for final confirmations

```javascript
function scheduleChannelDeletion(channel, customDelay = null) {
  const delay = customDelay !== null ? customDelay : config.tempChannelTTL;
  // ... scheduling logic
}
```

#### New `scheduleDMCleanup` Function
- Schedules DM message cleanup with custom delay
- Uses same timer management system as channel cleanup
- Preserves main DM menu

```javascript
function scheduleDMCleanup(dmChannel, client, delay) {
  // Schedules cleanupDMMessages after specified delay
}
```

---

## Implementation Details

### Flow Updates

All flows now distinguish between:
- **Intermediate steps:** Use `scheduleChannelDeletion(channel)` with default `tempChannelTTL`
- **Final confirmations:** Use `scheduleChannelDeletion(channel, config.confirmationDisplayTime)`

### Modified Files

#### 1. `interactions/shared/requestFlow.js`
**Location:** Line 377 (finalizeRequest)

```javascript
// Final cleanup with confirmation display time
if (config.requestMode === 'channel') {
    cleanupService.scheduleChannelDeletion(interaction.channel, config.confirmationDisplayTime);
} else if (config.requestMode === 'dm') {
    cleanupService.scheduleDMCleanup(interaction.channel, client, config.confirmationDisplayTime);
}
```

**Trigger:** After successfully submitting a profession request

---

#### 2. `interactions/shared/characterFlow.js`
**Location:** Line 244 (handleCharacterModal) + Line 322 (character deletion)

**Character Registration:**
```javascript
// Final cleanup with confirmation display time
if (config.requestMode === 'channel' && channel.type === ChannelType.GuildText) {
    cleanupService.scheduleChannelDeletion(channel, config.confirmationDisplayTime);
} else if (config.requestMode === 'dm') {
    cleanupService.scheduleDMCleanup(channel, client, config.confirmationDisplayTime);
}
```

**Character Deletion:**
```javascript
// Reschedule cleanup with confirmation display time for final message
if (config.requestMode === 'channel' && interaction.channel.type === ChannelType.GuildText) {
    cleanupService.scheduleChannelDeletion(interaction.channel, config.confirmationDisplayTime);
} else if (config.requestMode === 'dm') {
    cleanupService.scheduleDMCleanup(interaction.channel, client, config.confirmationDisplayTime);
}
```

**Triggers:**
- After successfully registering a character
- After successfully deleting a character

---

#### 3. `interactions/shared/statusFlow.js`
**Location:** Line 45 (handleStatusCommand)

```javascript
// Schedule cleanup with confirmation display time
if (config.requestMode === 'channel' && channel.type === ChannelType.GuildText) {
  cleanupService.scheduleChannelDeletion(channel, config.confirmationDisplayTime);
} else if (config.requestMode === 'dm') {
  cleanupService.scheduleDMCleanup(channel, client, config.confirmationDisplayTime);
}
```

**Trigger:** After displaying user's request status history

---

#### 4. `interactions/shared/requestsFlow.js`
**Location:** Line 38 (handleRequestsOverview)

```javascript
// Schedule cleanup with confirmation display time
if (config.requestMode === 'channel' && channel.type === ChannelType.GuildText) {
  cleanupService.scheduleChannelDeletion(channel, config.confirmationDisplayTime);
} else if (config.requestMode === 'dm') {
  cleanupService.scheduleDMCleanup(channel, client, config.confirmationDisplayTime);
}
```

**Trigger:** After displaying profession queue overview for crafters

---

## Timer Behavior

### Channel Mode (Temporary Channels)
1. Channel created → `scheduleChannelDeletion(channel)` with `tempChannelTTL` (90s)
2. User interacts → Timer gets **replaced** (resets to 90s)
3. Final confirmation sent → Timer gets **replaced** with `confirmationDisplayTime` (30s)
4. 30 seconds later → Channel deleted

**Key Point:** Each call to `scheduleChannelDeletion` replaces the previous timer, preventing duplicates

### DM Mode
1. User triggers command → `resolveResponseChannel` cleans up old messages
2. New content sent
3. Final confirmation displayed
4. `scheduleDMCleanup` scheduled with `confirmationDisplayTime` (30s)
5. 30 seconds later → Bot messages cleaned (menu preserved)

---

## Configuration Guide

### Recommended Settings

**Fast Cleanup (default):**
```javascript
tempChannelTTL: 90000,          // 90 seconds for flow steps
confirmationDisplayTime: 30000,  // 30 seconds for confirmations
```

**Extended Reading Time:**
```javascript
tempChannelTTL: 120000,         // 2 minutes for flow steps
confirmationDisplayTime: 60000,  // 1 minute for confirmations
```

**Minimal Cleanup (testing/debugging):**
```javascript
tempChannelTTL: 300000,         // 5 minutes for flow steps
confirmationDisplayTime: 120000, // 2 minutes for confirmations
```

**No Auto-Cleanup:**
```javascript
tempChannelTTL: 86400000,       // 24 hours (effectively disabled)
confirmationDisplayTime: 86400000, // 24 hours (effectively disabled)
```

---

## Testing Checklist

- [x] Request submission shows confirmation for 30s before cleanup
- [x] Character registration shows confirmation for 30s before cleanup
- [x] Character deletion shows confirmation for 30s before cleanup
- [x] Status command displays results for 30s before cleanup
- [x] Requests overview displays results for 30s before cleanup
- [x] Intermediate flow steps still use tempChannelTTL (90s)
- [x] Channel mode: Timer replacement works correctly
- [x] DM mode: Scheduled cleanup preserves menu
- [x] Configuration example updated
- [x] No linting errors

---

## Benefits

1. **User Experience:** Final confirmations stay visible long enough to read/screenshot
2. **Flexibility:** Admins can configure different times for flows vs confirmations
3. **Clean Channels:** Still maintains automated cleanup to prevent clutter
4. **Backward Compatible:** Defaults to reasonable values if config not updated
5. **Consistent Pattern:** All flows use the same cleanup approach

---

## Future Enhancements

Possible improvements:
1. **Per-Flow Configuration:** Different confirmation times for different command types
2. **User Preferences:** Allow users to set their own confirmation display time
3. **Persistent Confirmations:** Option to never auto-delete certain message types
4. **Activity-Based Cleanup:** Extend timer if user is still active in channel

---

## Related Documentation

- `docs/02-FLOW_ARCHITECTURE.md` - Flow pattern explanation
- `docs/11-FLOW_UNIFICATION_COMPLETE.md` - Unified cleanup system
- `docs/12-FLOW_ANALYSIS_DM_CHANNEL_ISSUES.md` - DM cleanup requirements
- `config/config.js.example` - Configuration reference
