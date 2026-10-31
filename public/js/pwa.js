/**
 * Installable app: registers the service worker (public/sw.js) and shows an "Install app" button in
 * the footer when the browser offers installation (Chrome, Edge and Samsung Internet on Android, and
 * desktop Chrome/Edge). iPhone Safari has no install prompt, so there the button explains
 * Share → Add to Home Screen instead.
 */
(() => {
    if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => {
            navigator.serviceWorker.register("/sw.js").catch(() => {
                // Without it the site still works; it just can't be installed or open offline.
            });
        });
    }

    const button = document.getElementById("install-app-button");
    const hint = document.getElementById("install-app-hint");
    if (!button) return;
    const installed = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    let deferredPrompt = null;

    if (installed) return;
    if (isIos) button.hidden = false;

    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        deferredPrompt = event;
        button.hidden = false;
    });
    window.addEventListener("appinstalled", () => {
        deferredPrompt = null;
        button.hidden = true;
        if (hint) hint.hidden = true;
    });

    button.addEventListener("click", async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            await deferredPrompt.userChoice;
            deferredPrompt = null;
            button.hidden = true;
        } else if (hint) {
            hint.hidden = !hint.hidden;
        }
    });
})();
