const test = require("node:test");
const assert = require("node:assert/strict");
const { csvCell, ordersToCsv, fetchOrdersForExport } = require("../services/orderCsvExport");

test("cells are quoted when needed and formulas are neutralized", () => {
    assert.equal(csvCell("Latte"), "Latte");
    assert.equal(csvCell('My "best", drink'), '"My ""best"", drink"');
    assert.equal(csvCell('=HYPERLINK("http://evil")'), '"\'=HYPERLINK(""http://evil"")"');
    assert.equal(csvCell("+639171234567"), "'+639171234567");
    assert.equal(csvCell("-5"), "'-5");
    assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
    assert.equal(csvCell(null), "");
});

test("one row per order in Manila time, with no customer contact details", () => {
    const csv = ordersToCsv([
        {
            created_at: "2026-10-30T17:30:00Z",
            tracking_code: "CL-ABC123",
            status: "Delivered",
            fulfillment_method: "delivery",
            payment_method: "cash",
            cash_collected_at: "2026-10-30T18:00:00Z",
            pricing: { total_cents: 67770 },
            customer: { name: "Juan", phone: "09171234567" },
            delivery_address: "Secret street",
            order_items: [{ name: "=Morning, boost" }, { name: null, classification: "Latte" }]
        }
    ]);
    assert.ok(csv.startsWith("﻿"), "BOM so Excel reads UTF-8");
    const [header, row, trailing] = csv.slice(1).split("\r\n");
    assert.equal(
        header,
        "Date (Manila),Tracking code,Status,Pickup or delivery,Payment,Cash collected,Drinks,Drink names,Total (PHP)"
    );
    assert.equal(row, `2026-10-31 01:30,CL-ABC123,Delivered,delivery,cash,yes,2,"'=Morning, boost; Latte",677.70`);
    assert.equal(trailing, "");
    assert.doesNotMatch(csv, /Juan|0917|Secret street/);
});

test("pages through more than 1000 orders", async () => {
    const all = Array.from({ length: 1001 }, (_, index) => ({ tracking_code: `T${index}` }));
    let selected = "";
    const fakeSupabase = {
        from: () => {
            const query = {
                select: (columns) => ((selected = columns), query),
                gte: () => query,
                order: () => query,
                range: (from, to) => Promise.resolve({ data: all.slice(from, to + 1), error: null })
            };
            return query;
        }
    };
    const orders = await fetchOrdersForExport(fakeSupabase, { days: 30 });
    assert.equal(orders.length, 1001);
    assert.doesNotMatch(selected, /customer|address|phone|coordinates|notes/, "never selects personal data");
});
