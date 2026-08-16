const BaseImageAPI = require("./base");

class E621API extends BaseImageAPI {
  constructor(config) {
    super(config);
    this.name = "e621";
  }

  async search({
    tags = "",
    extraTags = [],
    filters = [],
    limit = 100,
    page = 1,
  }) {
    const allTags = [tags, ...extraTags, ...filters].filter(Boolean).join(" ");

    const url = new URL(`${this.config.baseUrl}/posts.json`);
    url.searchParams.set("tags", allTags);
    url.searchParams.set("limit", String(Math.min(limit, 320)));

    // Evitamos que el sistema de caché pida una página mayor a 750. Para evitar HTTP 410 Gone.
    const safePage = Math.min(Math.max(1, page), 750);
    url.searchParams.set("page", String(safePage));

    // Usamos el User-Agent que comprobaste que funciona en Postman
    const headers = {
      "User-Agent": `ArtQuestBot/1.0 (by ${this.config.userLogin || "DiscordUser"} on e621)`,
    };

    // Volvemos a usar Basic Auth con Buffer (El estándar más robusto para Node.js)
    if (this.config.userLogin && this.config.apiKey) {
      const auth = Buffer.from(
        `${this.config.userLogin}:${this.config.apiKey}`,
      ).toString("base64");
      headers.Authorization = `Basic ${auth}`;
    }

    try {
      const res = await fetch(url.toString(), { headers });

      if (!res.ok) {
        console.error(`[E621] HTTP ${res.status}: ${res.statusText}`);
        return [];
      }

      const data = await res.json();
      const posts = data.posts || [];
      return posts.map((p) => this.normalize(p)).filter(Boolean);
    } catch (err) {
      console.error("[E621] Search error:", err.message);
      return [];
    }
  }

  normalize(raw) {
    if (!raw || !raw.file?.url) return null;
    if (raw.flags?.deleted || raw.flags?.pending) return null;

    const tagList = [
      ...(raw.tags?.general || []),
      ...(raw.tags?.species || []),
      ...(raw.tags?.character || []),
      ...(raw.tags?.copyright || []),
      ...(raw.tags?.artist || []),
    ];

    return {
      sourceApi: this.name,
      sourceId: String(raw.id || ""),
      imageUrl: this.sanitizeUrl(raw.file.url),
      sampleUrl: this.sanitizeUrl(
        raw.sample?.url || raw.preview?.url || raw.file.url,
      ),
      tags: tagList,
      score: raw.score?.total || 0,
      rating: raw.rating || "safe",
    };
  }
}

module.exports = E621API;
