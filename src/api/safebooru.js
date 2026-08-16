const BaseImageAPI = require("./base");

class SafebooruAPI extends BaseImageAPI {
  constructor(config) {
    super(config);
    this.name = "safebooru";
  }

  async search({
    tags = "",
    extraTags = [],
    filters = [],
    limit = 100,
    page = 0,
  }) {
    const allTags = [tags, ...extraTags, ...filters].filter(Boolean).join(" ");

    const url = new URL(this.config.baseUrl);
    url.searchParams.set("page", "dapi");
    url.searchParams.set("s", "post");
    url.searchParams.set("q", "index");
    url.searchParams.set("tags", allTags);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("pid", String(page));
    url.searchParams.set("json", "1");

    try {
      const res = await fetch(url.toString(), {
        headers: { "User-Agent": "ArtTradingBot/1.0" },
      });

      if (!res.ok) {
        console.error(`[Safebooru] HTTP ${res.status}: ${res.statusText}`);
        return [];
      }

      const text = await res.text();
      if (!text || text.trim() === "") {
        return [];
      }

      const data = JSON.parse(text);
      const posts = Array.isArray(data) ? data : [];
      return posts.map((p) => this.normalize(p)).filter(Boolean);
    } catch (err) {
      console.error("[Safebooru] Search error:", err.message);
      return [];
    }
  }

  normalize(raw) {
    if (!raw || !raw.file_url) return null;

    // Ignorar posts inactivos explícitos[cite: 6]
    if (raw.status && raw.status !== "active") return null;

    const tagList =
      typeof raw.tags === "string"
        ? raw.tags
            .split(" ")
            .map((t) => t.trim())
            .filter(Boolean)
        : Array.isArray(raw.tags)
          ? raw.tags
          : [];

    return {
      sourceApi: this.name,
      sourceId: String(raw.id || raw.post_id || ""),
      imageUrl: this.sanitizeUrl(raw.file_url),
      sampleUrl: this.sanitizeUrl(
        raw.sample_url || raw.preview_url || raw.file_url,
      ),
      tags: tagList,
      score: parseInt(raw.score, 10) || 0,
      rating: raw.rating || "safe",
    };
  }
}

module.exports = SafebooruAPI;
