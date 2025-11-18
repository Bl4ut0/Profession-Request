// utils/requestFormatter.js

/**
 * Human‐readable title of any request row, including quantity when > 1.
 */
function getRequestLabel(req) {
  const base = req.request_name || '';
  const qty = parseInt(req.quantity_requested || req.quantity || 1, 10) || 1;
  if (qty > 1) {
    return `${base} x${qty}`;
  }
  return base;
}
  
  /**
   * Profession subtitle (e.g. “Enchanting”, “Alchemy”, etc).
   */
  function getRequestSubtext(req) {
    return req.profession.charAt(0).toUpperCase() + req.profession.slice(1);
  }
  
  module.exports = { getRequestLabel, getRequestSubtext };
  