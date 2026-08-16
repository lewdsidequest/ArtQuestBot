const supabase = require("../database/supabase");
const RarityManager = require("../utils/rarity"); // Importamos el gestor de rarezas

class TradeService {
  async initiate1v1Trade(
    senderId,
    receiverId,
    senderArtworkId,
    receiverArtworkId,
  ) {
    if (senderId === receiverId) {
      throw new Error("No puedes intercambiar contigo mismo.");
    }

    const { data: senderCard, error: sErr } = await supabase
      .from("player_artworks")
      .select("*, artworks(*)")
      .eq("id", senderArtworkId)
      .eq("player_id", senderId)
      .single();

    if (sErr || !senderCard)
      throw new Error(`No posees la carta con ID ${senderArtworkId}.`);
    if (senderCard.is_loved)
      throw new Error("No puedes ofrecer tu Carta 'Amada'.");

    const { data: receiverCard, error: rErr } = await supabase
      .from("player_artworks")
      .select("*, artworks(*)")
      .eq("id", receiverArtworkId)
      .eq("player_id", receiverId)
      .single();

    if (rErr || !receiverCard)
      throw new Error(
        `El usuario destino no posee la carta con ID ${receiverArtworkId}.`,
      );
    if (receiverCard.is_loved)
      throw new Error(
        "La carta que pides es la Carta 'Amada' del otro usuario.",
      );

    // ACTUALIZACIÓN: Comparamos el rarity_id numérico y armamos un mensaje dinámico
    if (senderCard.artworks.rarity_id !== receiverCard.artworks.rarity_id) {
      const sRarity = RarityManager.get(senderCard.artworks.rarity_id);
      const rRarity = RarityManager.get(receiverCard.artworks.rarity_id);

      const sRarityDisplay = sRarity
        ? `${sRarity.name} ${sRarity.emoji}`
        : "Desconocida";
      const rRarityDisplay = rRarity
        ? `${rRarity.name} ${rRarity.emoji}`
        : "Desconocida";

      throw new Error(
        `Ambas cartas deben ser de la misma rareza.\nOfreces: **${sRarityDisplay}** | Pides: **${rRarityDisplay}**`,
      );
    }

    const sIdNum = parseInt(senderArtworkId, 10);
    const rIdNum = parseInt(receiverArtworkId, 10);

    const { data: trade, error: tErr } = await supabase
      .from("trades")
      .insert({
        sender_id: senderId,
        receiver_id: receiverId,
        sender_offers: [sIdNum],
        receiver_offers: [rIdNum],
        status: "pending",
      })
      .select()
      .single();

    if (tErr)
      throw new Error(
        "Hubo un error al registrar el intercambio en la base de datos.",
      );

    return { trade, senderCard, receiverCard };
  }

  async execute1v1Trade(tradeId, senderDiscordId, receiverDiscordId) {
    const { data: trade } = await supabase
      .from("trades")
      .select("*")
      .eq("id", tradeId)
      .single();
    if (trade.status !== "pending")
      throw new Error("Este intercambio ya no es válido o ya fue resuelto.");

    const senderCardId = parseInt(trade.sender_offers[0], 10);
    const receiverCardId = parseInt(trade.receiver_offers[0], 10);

    // Transferir carta del Sender al Receiver simplemente cambiando el player_id
    await supabase
      .from("player_artworks")
      .update({ player_id: receiverDiscordId })
      .eq("id", senderCardId);

    // Transferir carta del Receiver al Sender
    await supabase
      .from("player_artworks")
      .update({ player_id: senderDiscordId })
      .eq("id", receiverCardId);

    await supabase
      .from("trades")
      .update({ status: "accepted", resolved_at: new Date().toISOString() })
      .eq("id", tradeId);
  }

  async cancelTrade(tradeId) {
    await supabase
      .from("trades")
      .update({ status: "cancelled", resolved_at: new Date().toISOString() })
      .eq("id", tradeId);
  }
}

module.exports = new TradeService();
