const { getMenuCatalog, updateMenuPrice } = require("../services/menuPricingService");

async function listAdminMenu(request, response, next) {
    try {
        response.json(await getMenuCatalog());
    } catch (error) {
        next(error);
    }
}

async function updateAdminMenuPrice(request, response, next) {
    try {
        const catalog = await updateMenuPrice(request.params.priceKey, request.body.value);
        response.json({
            source: catalog.source,
            prices: catalog.prices
        });
    } catch (error) {
        next(error);
    }
}

module.exports = { listAdminMenu, updateAdminMenuPrice };
