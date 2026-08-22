class ActionManager {
  constructor() {
    this.lockedUsers = new Set();
    this.cooldowns = new Map();
  }

  /**
   * Intenta bloquear a un usuario para una transacción.
   * @param {string} userId - ID del usuario de Discord
   * @returns {boolean} True si logró bloquearlo, False si ya estaba bloqueado o en cooldown.
   */
  lockUser(userId) {
    // 1. Si ya hay un proceso en curso, lo rechazamos
    if (this.lockedUsers.has(userId)) {
      return false;
    }

    // 2. Cooldown global estricto (Previene Auto-Clickers)
    // Evita que hagan acciones con menos de 1.5 segundos de diferencia
    const lastActionTime = this.cooldowns.get(userId) || 0;
    const timeSinceLastAction = Date.now() - lastActionTime;

    // Cooldown por accion 1seg = 1000
    if (timeSinceLastAction < 750) {
      return false;
    }

    // Si pasó ambas pruebas, lo bloqueamos
    this.lockedUsers.add(userId);
    return true;
  }

  /**
   * Libera al usuario después de terminar la transacción y activa su cooldown.
   * @param {string} userId - ID del usuario de Discord
   */
  unlockUser(userId) {
    this.lockedUsers.delete(userId);
    this.cooldowns.set(userId, Date.now()); // Registramos el momento exacto en que terminó
  }
}

// Exportamos como Singleton para que el bloqueo sea compartido en todos los comandos
module.exports = new ActionManager();
