window.CoffeeLabState = (() => {
    const BASES = {
        espresso: { label: "Espresso", caffeine: 64, calories: 3, sugar: 0 },
        drip: { label: "Filter coffee", caffeine: 80, calories: 2, sugar: 0 },
        coldBrew: { label: "Cold brew", caffeine: 100, calories: 5, sugar: 0 },
        matcha: { label: "Matcha", caffeine: 70, calories: 6, sugar: 0 }
    };
    const MILKS = {
        whole: { label: "Whole milk", calories: 0.62, sugar: 0.05 },
        skim: { label: "Skim milk", calories: 0.35, sugar: 0.05 },
        oat: { label: "Oat milk", calories: 0.5, sugar: 0.04 },
        almond: { label: "Almond milk", calories: 0.18, sugar: 0.01 }
    };
    const SYRUPS = {
        vanilla: { label: "Vanilla syrup", calories: 20, sugar: 5, ml: 7 },
        caramel: { label: "Caramel sauce", calories: 25, sugar: 6, ml: 7 },
        chocolate: { label: "Dark chocolate mocha", calories: 28, sugar: 5, ml: 8 }
    };
    const SWEETENERS = {
        whiteSugar: { label: "White sugar", calories: 16, sugar: 4 },
        rawSugar: { label: "Raw sugar", calories: 16, sugar: 4 },
        honey: { label: "Honey", calories: 21, sugar: 5.7 },
        stevia: { label: "Stevia", calories: 0, sugar: 0 }
    };
    const CLASSICS = {
        latte: {
            name: "Classic Latte",
            base: "espresso",
            caffeineMode: "regular",
            volumeMl: 300,
            shots: 2,
            extraction: "standard",
            temperature: "hot",
            iceStyle: "cube",
            milk: "whole",
            foam: 20,
            syrups: { vanilla: 0, caramel: 0, chocolate: 0 },
            sweeteners: [],
            toppings: { cinnamon: false, whippedCream: false, cocoa: false }
        },
        cappuccino: {
            name: "Cappuccino",
            base: "espresso",
            caffeineMode: "regular",
            volumeMl: 180,
            shots: 2,
            extraction: "standard",
            temperature: "hot",
            iceStyle: "cube",
            milk: "whole",
            foam: 75,
            syrups: { vanilla: 0, caramel: 0, chocolate: 0 },
            sweeteners: [],
            toppings: { cinnamon: false, whippedCream: false, cocoa: false }
        },
        cortado: {
            name: "Cortado",
            base: "espresso",
            caffeineMode: "regular",
            volumeMl: 120,
            shots: 2,
            extraction: "standard",
            temperature: "hot",
            iceStyle: "cube",
            milk: "whole",
            foam: 10,
            syrups: { vanilla: 0, caramel: 0, chocolate: 0 },
            sweeteners: [],
            toppings: { cinnamon: false, whippedCream: false, cocoa: false }
        },
        americano: {
            name: "Americano",
            base: "drip",
            caffeineMode: "regular",
            volumeMl: 240,
            shots: 2,
            extraction: "standard",
            temperature: "hot",
            iceStyle: "cube",
            milk: "whole",
            foam: 0,
            syrups: { vanilla: 0, caramel: 0, chocolate: 0 },
            sweeteners: [],
            toppings: { cinnamon: false, whippedCream: false, cocoa: false }
        },
        flatWhite: {
            name: "Flat White",
            base: "espresso",
            caffeineMode: "regular",
            volumeMl: 180,
            shots: 2,
            extraction: "standard",
            temperature: "hot",
            iceStyle: "cube",
            milk: "whole",
            foam: 15,
            syrups: { vanilla: 0, caramel: 0, chocolate: 0 },
            sweeteners: [],
            toppings: { cinnamon: false, whippedCream: false, cocoa: false }
        },
        macchiato: {
            name: "Macchiato",
            base: "espresso",
            caffeineMode: "regular",
            volumeMl: 90,
            shots: 2,
            extraction: "standard",
            temperature: "hot",
            iceStyle: "cube",
            milk: "whole",
            foam: 85,
            syrups: { vanilla: 0, caramel: 0, chocolate: 0 },
            sweeteners: [],
            toppings: { cinnamon: false, whippedCream: false, cocoa: false }
        }
    };
    const state = {
        base: "espresso",
        caffeineMode: "regular",
        volumeMl: 240,
        shots: 2,
        extraction: "standard",
        temperature: "hot",
        iceStyle: "cube",
        milk: "whole",
        foam: 25,
        syrups: { vanilla: 0, caramel: 0, chocolate: 0 },
        sweeteners: [],
        toppings: { cinnamon: false, whippedCream: false, cocoa: false },
        metric: true,
        darkMode: document.documentElement.dataset.theme === "dark",
        cartItems: [],
        deliveryAddress: "",
        fulfillmentMethod: "delivery",
        tipPercent: 0,
        customTipPercent: 15,
        // Spend loyalty points on a free drink (checkout checkbox; the server checks the balance).
        redeemFreeDrink: false,
        orderStatus: null
    };

    return { BASES, MILKS, SYRUPS, SWEETENERS, CLASSICS, state };
})();
