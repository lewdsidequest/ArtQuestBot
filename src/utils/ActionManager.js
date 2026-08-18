// src/utils/ActionManager.js
const activeUsers = new Set();

module.exports = {
  /**
   * Intenta bloquear al usuario. Retorna true si tuvo éxito, false si el usuario ya estaba ocupado.
   */
  lockUser(userId) {
    if (activeUsers.has(userId)) {
      return false; // El usuario ya está haciendo algo
    }
    activeUsers.add(userId);
    return true; // Bloqueo exitoso
  },

  /**
   * Libera al usuario para que pueda usar más comandos/botones.
   */
  unlockUser(userId) {
    activeUsers.delete(userId);
  },
};
