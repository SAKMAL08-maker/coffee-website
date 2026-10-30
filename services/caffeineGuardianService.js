const { normalizeConfiguration, calculateNutrition } = require("./coffeeService");

/**
 * Caffeine guardian: tells a signed-in customer how much caffeine they have
 * ordered today and, when the drink they're building would push them past a
 * daily limit or their personal cutoff time, offers a one-tap half-caf version.
 *
 * Everything is decided here, on the server, from the same nutrition function
 * that checkout stores on each order item.
 */

// Common guidance for healthy adults (e.g. US FDA): up to about 400 mg a day.
// A suggestion, not medical advice; the UI says so.
const DAILY_CAFFEINE_LIMIT_MG = 400;
// The shop is in the Philippines, so "today" and the cutoff use Manila time,
// whatever the server's own clock zone is (Render runs in UTC).
const SHOP_TIME_ZONE = "Asia/Manila";
const CUTOFF_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

function getZonedParts(now, timeZone) {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", {
            timeZone,
            hourCycle: "h23",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        })
            .formatToParts(now)
            .map((part) => [part.type, Number(part.value)])
    );
    return parts;
}

/** Shop-local minutes since midnight, and the UTC instant the shop's day began. */
function getShopClock(now = new Date(), timeZone = SHOP_TIME_ZONE) {
    const { year, month, day, hour, minute, second } = getZonedParts(now, timeZone);
    const zonedAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
    const offsetMs = zonedAsUtcMs - Math.floor(now.getTime() / 1000) * 1000;
    const startOfDay = new Date(Date.UTC(year, month - 1, day) - offsetMs);
    return { minutesSinceMidnight: hour * 60 + minute, startOfDayIso: startOfDay.toISOString() };
}

/** "15:00" or Postgres "15:00:00" → minutes since midnight; null when unset. */
function parseCutoffMinutes(cutoffTime) {
    if (!cutoffTime) return null;
    const match = CUTOFF_PATTERN.exec(cutoffTime);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
}

/** Postgres "15:00:00" → "15:00" for the browser's <input type="time">. */
function formatCutoff(cutoffTime) {
    const minutes = parseCutoffMinutes(cutoffTime);
    if (minutes === null) return null;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function sumCaffeineMg(orderItems) {
    return orderItems.reduce((total, item) => {
        const caffeineMg = Number(item?.nutrition?.caffeineMg);
        return total + (Number.isFinite(caffeineMg) && caffeineMg > 0 ? caffeineMg : 0);
    }, 0);
}

function caffeineOf(configuration) {
    return calculateNutrition(normalizeConfiguration(configuration)).caffeineMg;
}

/**
 * Pure decision for one drink. Configurations must already be valid (Zod-checked).
 * `basketConfigurations` are drinks already in the basket but not yet ordered;
 * their caffeine is recalculated here, so the browser never supplies a number.
 * Suggests half-caf only when it is an actual change (a regular-caffeine drink).
 */
function evaluateDrink({ configuration, todayMg, basketConfigurations = [], cutoffTime, now = new Date() }) {
    const normalized = normalizeConfiguration(configuration);
    const drinkMg = calculateNutrition(normalized).caffeineMg;
    const basketMg = basketConfigurations.reduce((total, basketDrink) => total + caffeineOf(basketDrink), 0);
    const plannedMg = todayMg + basketMg;
    const projectedMg = plannedMg + drinkMg;
    const cutoffMinutes = parseCutoffMinutes(cutoffTime);
    const { minutesSinceMidnight } = getShopClock(now);

    const reasons = [];
    if (drinkMg > 0 && projectedMg > DAILY_CAFFEINE_LIMIT_MG) reasons.push("over-daily-limit");
    if (drinkMg > 0 && cutoffMinutes !== null && minutesSinceMidnight >= cutoffMinutes) reasons.push("past-cutoff");

    let suggestion = null;
    if (reasons.length && normalized.caffeineMode === "regular") {
        const halfCafMg = calculateNutrition({ ...normalized, caffeineMode: "half" }).caffeineMg;
        suggestion = {
            caffeineMode: "half",
            drinkMg: halfCafMg,
            projectedMg: plannedMg + halfCafMg,
            savesMg: drinkMg - halfCafMg
        };
    }

    return {
        todayMg,
        basketMg,
        drinkMg,
        projectedMg,
        dailyLimitMg: DAILY_CAFFEINE_LIMIT_MG,
        cutoffTime: formatCutoff(cutoffTime),
        reasons,
        suggestion
    };
}

/** Caffeine in everything this customer ordered since the shop's midnight. */
async function fetchTodayCaffeineMg(supabase, accountId, now = new Date()) {
    const { data, error } = await supabase
        .from("orders")
        .select("order_items(nutrition)")
        .eq("account_id", accountId)
        .gte("created_at", getShopClock(now).startOfDayIso);
    if (error) throw error;
    return sumCaffeineMg(data.flatMap((order) => order.order_items || []));
}

async function fetchCutoffTime(supabase, accountId) {
    const { data, error } = await supabase
        .from("coffee_users")
        .select("caffeine_cutoff_time")
        .eq("id", accountId)
        .maybeSingle();
    if (error) throw error;
    return data?.caffeine_cutoff_time || null;
}

async function checkDrinkForCustomer(supabase, accountId, { configuration, basket = [] }, now = new Date()) {
    const [todayMg, cutoffTime] = await Promise.all([
        fetchTodayCaffeineMg(supabase, accountId, now),
        fetchCutoffTime(supabase, accountId)
    ]);
    return evaluateDrink({ configuration, todayMg, basketConfigurations: basket, cutoffTime, now });
}

async function saveCutoffTime(supabase, accountId, cutoffTime) {
    const { data, error } = await supabase
        .from("coffee_users")
        .update({ caffeine_cutoff_time: cutoffTime, updated_at: new Date().toISOString() })
        .eq("id", accountId)
        .select("caffeine_cutoff_time")
        .single();
    if (error) throw error;
    return formatCutoff(data.caffeine_cutoff_time);
}

module.exports = {
    DAILY_CAFFEINE_LIMIT_MG,
    SHOP_TIME_ZONE,
    getShopClock,
    parseCutoffMinutes,
    formatCutoff,
    sumCaffeineMg,
    evaluateDrink,
    checkDrinkForCustomer,
    saveCutoffTime
};
