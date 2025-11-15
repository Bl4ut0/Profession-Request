// utils/requestFormatter.js

/**
 * Human‐readable title of any request row.
 */
function getRequestLabel(req) {
    return req.request_name;
  }
  
  /**
   * Profession subtitle (e.g. “Enchanting”, “Alchemy”, etc).
   */
  function getRequestSubtext(req) {
    return req.profession.charAt(0).toUpperCase() + req.profession.slice(1);
  }
  
  module.exports = { getRequestLabel, getRequestSubtext };
  