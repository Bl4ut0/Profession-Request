// utils/professionLoader.js

const fs = require('fs');
const path = require('path');
const log = require('./logWriter');

/**
 * Parse material strings into object format
 * Converts ["Soul Dust x10", "Dream Dust x5"] to {"Soul Dust": 10, "Dream Dust": 5}
 * @param {Array<string>} materialsArray - Array of material strings in "Name xQuantity" format
 * @returns {Object} Object with material names as keys and quantities as values
 */
function parseMaterials(materialsArray) {
  if (!Array.isArray(materialsArray)) {
    log.warn('parseMaterials called with non-array:', materialsArray);
    return {};
  }

  const result = {};
  for (const materialStr of materialsArray) {
    // Match "Material Name xQuantity" pattern
    const match = materialStr.match(/^(.+?)\s+x(\d+)$/);
    if (match) {
      const [, name, quantity] = match;
      result[name.trim()] = parseInt(quantity, 10);
    } else {
      log.warn(`Failed to parse material string: "${materialStr}"`);
    }
  }
  return result;
}

/**
 * In-memory cache for profession data
 * Structure: { professionName: { gearSlot: [recipes] } }
 */
let professionCache = {};

/**
 * Metadata about loaded professions
 * Structure: { professionName: { recipeCount, gearSlotCount, loadedAt } }
 */
let professionMetadata = {};

/**
 * Load all profession data files from the config directory into memory
 * This runs once at bot startup for optimal performance
 * 
 * @returns {Object} Summary of loaded professions
 */
function loadProfessions() {
  const configDir = path.join(__dirname, '../config');
  const professionFiles = fs.readdirSync(configDir).filter(file => 
    file.endsWith('.json') && file !== 'config.js.example'
  );

  let totalRecipes = 0;
  let totalProfessions = 0;

  log.info(`🔄 Loading profession data files...`);

  for (const file of professionFiles) {
    const professionName = path.basename(file, '.json');
    const filePath = path.join(configDir, file);

    try {
      // Read and parse the profession file
      const rawData = fs.readFileSync(filePath, 'utf8');
      const professionData = JSON.parse(rawData);

      // Validate the data structure
      if (!professionData.items && !professionData.enchants && !professionData.recipes && !professionData.crafts) {
        log.warn(`⚠️ Invalid profession file structure: ${file} (missing 'items' key)`);
        continue;
      }

      // Use unified 'items' key, with fallback to legacy keys for backward compatibility
      const items = professionData.items || professionData.enchants || professionData.recipes || professionData.crafts || {};

      // Process each slot's items to convert materials to object format
      const processedItems = {};
      for (const [slot, itemList] of Object.entries(items)) {
        if (Array.isArray(itemList)) {
          processedItems[slot] = itemList.map(item => ({
            ...item,
            materials: parseMaterials(item.materials)
          }));
        } else {
          processedItems[slot] = itemList;
        }
      }

      // Store in cache
      professionCache[professionName] = processedItems;

      // Calculate metadata
      const slots = Object.keys(items);
      let itemCount = 0;
      for (const slot of slots) {
        if (Array.isArray(items[slot])) {
          itemCount += items[slot].length;
        }
      }

      professionMetadata[professionName] = {
        itemCount,
        slotCount: slots.length,
        loadedAt: new Date().toISOString(),
        filePath: file
      };

      totalRecipes += itemCount;
      totalProfessions++;

      log.info(`  ✅ ${professionName}: ${itemCount} items across ${slots.length} slots`);

    } catch (error) {
      log.error(`❌ Failed to load profession file: ${file}`, error);
    }
  }

  log.info(`✨ Profession data loaded: ${totalProfessions} professions, ${totalRecipes} total items`);

  return {
    professionsLoaded: totalProfessions,
    totalItems: totalRecipes,
    professions: Object.keys(professionCache)
  };
}

/**
 * Get all items for a specific profession and slot
 * Works for all professions: enchants, crafts, recipes, consumables, etc.
 * 
 * @param {string} profession - The profession name (e.g., "enchanting", "tailoring")
 * @param {string} slot - The slot/category (e.g., "Chest", "Weapon", "Bags", "Consumable")
 * @returns {Array} Array of item objects, or empty array if not found
 */
function getRecipes(profession, slot) {
  const professionData = professionCache[profession.toLowerCase()];
  if (!professionData) {
    log.warn(`Profession not found in cache: ${profession}`);
    return [];
  }

  const items = professionData[slot];
  if (!items || !Array.isArray(items)) {
    log.debug(`No items found for ${profession} > ${slot}`);
    return [];
  }

  return items;
}

/**
 * Get all available gear slots for a profession
 * 
 * @param {string} profession - The profession name
 * @returns {Array<string>} Array of gear slot names
 */
function getGearSlots(profession) {
  const professionData = professionCache[profession.toLowerCase()];
  if (!professionData) {
    log.warn(`Profession not found in cache: ${profession}`);
    return [];
  }

  return Object.keys(professionData).filter(slot => 
    !slot.startsWith('_') && Array.isArray(professionData[slot])
  );
}

/**
 * Get a specific recipe by name
 * 
 * @param {string} profession - The profession name
 * @param {string} gearSlot - The gear slot
 * @param {string} recipeName - The exact recipe name
 * @returns {Object|null} Recipe object or null if not found
 */
function getRecipe(profession, gearSlot, recipeName) {
  const recipes = getRecipes(profession, gearSlot);
  return recipes.find(r => r.name === recipeName) || null;
}

/**
 * Check if profession data is loaded
 * 
 * @param {string} profession - Optional profession name to check
 * @returns {boolean} True if loaded (or if specific profession is loaded)
 */
function isLoaded(profession = null) {
  if (profession) {
    return professionCache.hasOwnProperty(profession.toLowerCase());
  }
  return Object.keys(professionCache).length > 0;
}

/**
 * Get metadata about loaded professions
 * 
 * @returns {Object} Metadata object with profession statistics
 */
function getMetadata() {
  return {
    professions: { ...professionMetadata },
    totalProfessions: Object.keys(professionCache).length,
    cacheSize: JSON.stringify(professionCache).length,
    lastLoaded: professionMetadata[Object.keys(professionMetadata)[0]]?.loadedAt
  };
}

/**
 * Reload a specific profession or all professions
 * Useful for hot-reloading profession data without restarting the bot
 * 
 * @param {string|null} profession - Specific profession to reload, or null for all
 * @returns {Object} Summary of reload operation
 */
function reloadProfessions(profession = null) {
  if (profession) {
    // Reload specific profession
    const fileName = `${profession.toLowerCase()}.json`;
    const filePath = path.join(__dirname, '../config', fileName);
    
    try {
      const rawData = fs.readFileSync(filePath, 'utf8');
      const professionData = JSON.parse(rawData);
      const recipes = professionData.enchants || professionData.recipes || {};
      
      // Process materials to convert arrays to objects
      const processedRecipes = {};
      for (const [gearSlot, recipeList] of Object.entries(recipes)) {
        if (Array.isArray(recipeList)) {
          processedRecipes[gearSlot] = recipeList.map(recipe => ({
            ...recipe,
            materials: parseMaterials(recipe.materials)
          }));
        } else {
          processedRecipes[gearSlot] = recipeList;
        }
      }
      
      professionCache[profession.toLowerCase()] = processedRecipes;
      
      // Update metadata
      const gearSlots = Object.keys(recipes);
      let recipeCount = 0;
      for (const slot of gearSlots) {
        if (Array.isArray(recipes[slot])) {
          recipeCount += recipes[slot].length;
        }
      }
      
      professionMetadata[profession.toLowerCase()] = {
        recipeCount,
        gearSlotCount: gearSlots.length,
        loadedAt: new Date().toISOString(),
        filePath: fileName
      };
      
      log.info(`♻️ Reloaded profession: ${profession} (${recipeCount} recipes)`);
      return { success: true, profession, recipeCount };
      
    } catch (error) {
      log.error(`Failed to reload profession: ${profession}`, error);
      return { success: false, profession, error: error.message };
    }
    
  } else {
    // Reload all professions
    professionCache = {};
    professionMetadata = {};
    return loadProfessions();
  }
}

/**
 * Search for recipes by partial name match
 * 
 * @param {string} profession - The profession name
 * @param {string} searchTerm - Partial recipe name to search for
 * @returns {Array} Array of matching recipes with their gear slots
 */
function searchRecipes(profession, searchTerm) {
  const professionData = professionCache[profession.toLowerCase()];
  if (!professionData) {
    return [];
  }

  const results = [];
  const searchLower = searchTerm.toLowerCase();

  for (const [gearSlot, recipes] of Object.entries(professionData)) {
    if (gearSlot.startsWith('_') || !Array.isArray(recipes)) continue;

    for (const recipe of recipes) {
      if (recipe.name.toLowerCase().includes(searchLower)) {
        results.push({
          ...recipe,
          gearSlot,
          profession
        });
      }
    }
  }

  return results;
}

module.exports = {
  loadProfessions,
  getRecipes,
  getGearSlots,
  getRecipe,
  isLoaded,
  getMetadata,
  reloadProfessions,
  searchRecipes,
  parseMaterials
};
