(() => {
    try {
        const savedTheme = localStorage.getItem("coffee-lab-theme")
            || localStorage.getItem("bean-bloom-theme");
        const theme = savedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
        document.documentElement.dataset.theme = theme;
    } catch {
        document.documentElement.dataset.theme = "light";
    }
})();
