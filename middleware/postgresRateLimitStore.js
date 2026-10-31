/**
 * express-rate-limit store that keeps counters in Postgres (rate_limit_hits),
 * so every server instance shares the same limits. Each limiter gets its own
 * prefix, so e.g. login and checkout attempts are counted separately.
 */
class PostgresRateLimitStore {
    constructor(prefix, getClient) {
        this.prefix = `${prefix}:`;
        this.getClient = getClient;
        // Counters live outside this process.
        this.localKeys = false;
    }

    init(options) {
        this.windowMs = options.windowMs;
    }

    async increment(key) {
        const { data, error } = await this.getClient().rpc("rate_limit_hit", {
            p_key: this.prefix + key,
            p_window_ms: this.windowMs
        });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        return { totalHits: row.total_hits, resetTime: new Date(row.reset_at) };
    }

    async decrement(key) {
        const { error } = await this.getClient().rpc("rate_limit_decrement", { p_key: this.prefix + key });
        if (error) throw error;
    }

    async resetKey(key) {
        const { error } = await this.getClient().rpc("rate_limit_reset", { p_key: this.prefix + key });
        if (error) throw error;
    }
}

module.exports = { PostgresRateLimitStore };
