const GAME = require("../config/game");
const RarityManager = require("./rarity");

function calculatePower(
  rarityId,
  stars,
  level,
  prestige = 0,
  modifiers = null,
) {
  const rarityData = RarityManager.get(rarityId);
  const rarityWeight = rarityData ? rarityData.weight_score : 10;

  const starMult =
    modifiers?.star_multiplier ?? GAME.rarities.stars.multiplierPerStar;
  const levelMult =
    modifiers?.level_multiplier ?? GAME.rarities.levels.multiplierPerLevel;
  const prestigeMult = modifiers?.prestige_multiplier ?? 2.0;

  const starBonus = (stars - 1) * starMult;
  const levelBonus = (level - 1) * levelMult;
  const prestigeBonus = prestige * prestigeMult;

  return Math.floor(
    rarityWeight * (1 + starBonus) * (1 + levelBonus) * (1 + prestigeBonus),
  );
}

function calculateInkRate(
  baseRate,
  stars,
  level,
  prestige = 0,
  modifiers = null,
) {
  const starMult =
    modifiers?.star_multiplier ?? GAME.rarities.stars.multiplierPerStar;
  const levelMult =
    modifiers?.level_multiplier ?? GAME.rarities.levels.multiplierPerLevel;
  const prestigeMult = modifiers?.prestige_multiplier ?? 2.0;

  const starBonus = 1 + (stars - 1) * starMult;
  const levelBonus = 1 + (level - 1) * levelMult;
  const prestigeBonus = 1 + prestige * prestigeMult;

  return Math.floor(baseRate * starBonus * levelBonus * prestigeBonus);
}

// 🛠️ ACTUALIZADO: Recibe rarityId para extraer el cost_multiplier
function calculateLevelUpgradeCost(
  currentLevel,
  targetLevel,
  prestige = 0,
  rarityId,
  ecoConfig = null,
) {
  const rarityData = RarityManager.get(rarityId);
  const rarityMult = rarityData
    ? parseFloat(rarityData.cost_multiplier || 1)
    : 1;

  const base = ecoConfig?.level_upgrade_base ?? GAME.economy.levelUpgrade.base;
  const exponent =
    ecoConfig?.level_upgrade_exponent ?? GAME.economy.levelUpgrade.exponent;
  const taxMult =
    1 + prestige * parseFloat(ecoConfig?.prestige_cost_multiplier ?? 0.1);

  let totalCost = 0;
  for (let lvl = currentLevel; lvl < targetLevel; lvl++) {
    totalCost += Math.floor(
      base * Math.pow(lvl, exponent) * taxMult * rarityMult,
    );
  }
  return totalCost;
}

// 🛠️ ACTUALIZADO: Recibe rarityId para extraer el cost_multiplier
function calculateStarUpgradeCost(
  currentStars,
  targetStars,
  prestige = 0,
  rarityId,
  ecoConfig = null,
) {
  const rarityData = RarityManager.get(rarityId);
  const rarityMult = rarityData
    ? parseFloat(rarityData.cost_multiplier || 1)
    : 1;

  const costs = ecoConfig?.star_upgrade_cost ?? GAME.economy.starUpgradeCost;
  const taxMult =
    1 + prestige * parseFloat(ecoConfig?.prestige_cost_multiplier ?? 0.1);

  let totalCost = 0;
  for (let s = currentStars; s < targetStars; s++) {
    const costForLevel = costs[s] || costs[costs.length - 1];
    totalCost += Math.floor(costForLevel * taxMult * rarityMult);
  }
  return totalCost;
}

function calculateDustReward(rarityId, ecoConfig = null) {
  const rarityData = RarityManager.get(rarityId);
  return rarityData ? rarityData.dust_reward : 1;
}

function calculateRefund(
  investedInk,
  investedDust,
  rarityId,
  prestige = 0, // Añadimos el nivel de prestigio
  ecoConfig = null,
) {
  const refundPercent = parseFloat(ecoConfig?.refund_percentage ?? 0.5);
  const baseDust = calculateDustReward(rarityId, ecoConfig);

  // NUEVA FÓRMULA DE POLVO POR PRESTIGIO
  // Buscamos la variable configurable (default 0.5 = 50% extra por nivel)
  const prestigeDustMult = parseFloat(
    ecoConfig?.prestige_dust_multiplier ?? 0.5,
  );

  // Polvo Base + (Polvo Base * Multiplicador * Nivel de Prestigio)
  const prestigeBonus =
    prestige > 0 ? baseDust * prestigeDustMult * prestige : 0;
  const finalBaseDust = Math.floor(baseDust + prestigeBonus);

  return {
    refundedInk: Math.floor((investedInk || 0) * refundPercent),
    refundedDust:
      finalBaseDust + Math.floor((investedDust || 0) * refundPercent),
  };
}

module.exports = {
  calculatePower,
  calculateInkRate,
  calculateLevelUpgradeCost,
  calculateStarUpgradeCost,
  calculateDustReward,
  calculateRefund,
};
