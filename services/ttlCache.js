/**
 * Tiny in-memory cache: keeps each value for ttlMs, and shares one in-flight
 * load between callers that ask for the same key at the same time.
 * Per server process; good for read-heavy, slightly-stale-is-fine data.
 */
function createTtlCache(ttlMs, now = () => Date.now()) {
    const entries = new Map();

    async function get(key, load) {
        const entry = entries.get(key);
        if (entry && (entry.pending || entry.expiresAt > now())) return entry.pending || entry.value;

        const pending = load();
        entries.set(key, { pending });
        try {
            const value = await pending;
            entries.set(key, { value, expiresAt: now() + ttlMs });
            return value;
        } catch (error) {
            // Failures aren't cached; the next call tries again.
            entries.delete(key);
            throw error;
        }
    }

    return { get, clear: () => entries.clear() };
}

module.exports = { createTtlCache };
