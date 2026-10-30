(() => {
    const $ = (selector) => document.querySelector(selector);
    const authPage = $("#auth-page");
    const authMessage = $("#auth-message");
    let recoveryCodes = [];
    let createdUsername = "";

    function showMessage(message, isError = true) {
        authMessage.textContent = message;
        authMessage.dataset.state = isError ? "error" : "success";
    }

    function showScreen(name) {
        document.querySelectorAll("[data-auth-screen]").forEach((screen) => {
            screen.hidden = screen.dataset.authScreen !== name;
        });
        authMessage.textContent = "";
        authMessage.dataset.state = "";
        const heading =
            document.querySelector(`[data-auth-screen="${name}"] h2`) ||
            (name === "codes" ? $("#recovery-codes-title") : $("#auth-title"));
        heading.focus?.();
    }

    function showCoffeeLab(user) {
        authPage.hidden = true;
        $("#app-header").hidden = false;
        const isAdmin = user.role === "admin";
        $("#customizer-page").hidden = isAdmin;
        $("#customer-nav").hidden = isAdmin;
        $("#order-history-page").hidden = true;
        $("#tracking-page").hidden = true;
        $("#admin-page").hidden = !isAdmin;
        $("#unit-toggle").closest(".unit-control").hidden = isAdmin;
        $("#surprise-button").hidden = isAdmin;
        $("#signed-in-user").textContent = `Hi, ${user.username}`;
        if (isAdmin) window.CoffeeLabAdmin?.startForUser(user);
        // Lets customer-only features (e.g. the caffeine guardian) start once signed in.
        // Also recorded on window, because app.js may load after this event fires.
        window.CoffeeLabSession = { role: user.role };
        document.dispatchEvent(new CustomEvent("coffeelab:signed-in", { detail: { role: user.role } }));
    }

    async function readResponse(response) {
        let result;
        try {
            result = await response.json();
        } catch {
            throw new Error("The server returned an unreadable response. Please try again.");
        }
        if (!response.ok) throw new Error(result.error || "The request could not be completed.");
        return result;
    }

    async function submitForm(form, action) {
        const submitButton = form.querySelector("button[type='submit']");
        submitButton.disabled = true;
        showMessage("");
        try {
            const result = await action();
            return result;
        } catch (error) {
            showMessage(error.message);
            return null;
        } finally {
            submitButton.disabled = false;
        }
    }

    document.querySelectorAll("[data-show-auth]").forEach((button) => {
        button.addEventListener("click", () => showScreen(button.dataset.showAuth));
    });

    $("#login-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const result = await submitForm(form, async () => {
            const response = await fetch("/api/users/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({
                    username: $("#login-username").value.trim(),
                    password: $("#login-password").value,
                    staySignedIn: $("#stay-signed-in").checked
                })
            });
            return readResponse(response);
        });
        if (result?.mfaRequired) {
            await startAdminMfa(result);
        } else if (result) {
            showCoffeeLab(result.user);
        }
    });

    let adminMfaFactorId = "";

    async function startAdminMfa(result) {
        adminMfaFactorId = result.factorId || "";
        $("#admin-mfa-bootstrap-token").value = "";
        $("#admin-mfa-bootstrap-token").hidden = false;
        $("#admin-mfa-enroll").disabled = false;
        $("#admin-mfa-qr").hidden = true;
        $("#admin-mfa-secret").hidden = true;
        $("#admin-mfa-secret").textContent = "";
        $("#admin-mfa-code").value = "";
        $("#admin-mfa-code").disabled = true;
        $("#admin-mfa-verify").disabled = true;
        $("#admin-mfa-enroll").hidden = false;
        showScreen("admin-mfa");
        $("#admin-mfa-description").textContent = result.setupRequired
            ? `Welcome, ${result.username}. Your project owner must provide a one-time setup authorization before you can register an authenticator.`
            : result.setupInProgress
              ? `Finish the authenticator setup for ${result.username} using the app where you saved the setup key.`
              : `Enter the current authenticator code for ${result.username}.`;
        $("#admin-mfa-setup").hidden = !result.setupRequired;
        $("#admin-mfa-bootstrap-token").required = result.setupRequired;
        if (result.factorId) {
            $("#admin-mfa-code").disabled = false;
            $("#admin-mfa-verify").disabled = false;
        } else if (!result.setupRequired) {
            showMessage(
                "No owner-approved authenticator is available. Contact the Supabase project owner to authorize or recover setup."
            );
        }
    }

    $("#admin-mfa-enroll").addEventListener("click", async () => {
        const button = $("#admin-mfa-enroll");
        const bootstrapToken = $("#admin-mfa-bootstrap-token").value.trim();
        if (bootstrapToken.length < 32) {
            showMessage("Enter the one-time setup authorization from the project owner.");
            $("#admin-mfa-bootstrap-token").focus();
            return;
        }
        button.disabled = true;
        showMessage("");
        try {
            const response = await fetch("/api/users/admin/mfa/enroll", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ bootstrapToken })
            });
            const enrollment = await readResponse(response);
            adminMfaFactorId = enrollment.factorId;
            $("#admin-mfa-qr").src = enrollment.qrCode;
            $("#admin-mfa-qr").hidden = false;
            $("#admin-mfa-secret").textContent = enrollment.secret;
            $("#admin-mfa-secret").hidden = false;
            $("#admin-mfa-bootstrap-token").value = "";
            $("#admin-mfa-bootstrap-token").required = false;
            $("#admin-mfa-bootstrap-token").hidden = true;
            button.hidden = true;
            $("#admin-mfa-code").disabled = false;
            $("#admin-mfa-verify").disabled = false;
            $("#admin-mfa-code").focus();
        } catch (error) {
            showMessage(`Could not authorize authenticator setup: ${error.message}`);
        } finally {
            button.disabled = false;
        }
    });

    $("#admin-mfa-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!adminMfaFactorId) {
            showMessage("The authenticator setup is incomplete. Sign in again to retry.");
            return;
        }
        const submitButton = event.currentTarget.querySelector("button[type='submit']");
        submitButton.disabled = true;
        showMessage("");
        try {
            const response = await fetch("/api/users/admin/mfa/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({
                    factorId: adminMfaFactorId,
                    code: $("#admin-mfa-code").value.trim()
                })
            });
            const result = await readResponse(response);
            adminMfaFactorId = "";
            $("#admin-mfa-form").reset();
            $("#admin-mfa-bootstrap-token").hidden = false;
            $("#admin-mfa-enroll").hidden = false;
            $("#admin-mfa-code").disabled = true;
            $("#admin-mfa-verify").disabled = true;
            showCoffeeLab(result.user);
        } catch (error) {
            showMessage(error.message);
            $("#admin-mfa-code").focus();
        } finally {
            submitButton.disabled = false;
        }
    });

    $("#admin-mfa-cancel").addEventListener("click", async () => {
        let signOutError;
        try {
            const response = await fetch("/api/users/logout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: "{}"
            });
            await readResponse(response);
        } catch (error) {
            signOutError = error;
        } finally {
            adminMfaFactorId = "";
            $("#admin-mfa-form").reset();
            $("#admin-mfa-bootstrap-token").hidden = false;
            $("#admin-mfa-enroll").hidden = false;
            $("#admin-mfa-code").disabled = true;
            $("#admin-mfa-verify").disabled = true;
            showScreen("login");
        }
        if (signOutError) showMessage(`Could not complete sign out: ${signOutError.message}`);
    });

    $("#signup-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const password = $("#signup-password").value;
        if (password !== $("#signup-password-confirm").value) {
            showMessage("The passwords do not match.");
            $("#signup-password-confirm").focus();
            return;
        }
        const result = await submitForm(form, async () => {
            const response = await fetch("/api/users/signup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({
                    username: $("#signup-username").value.trim(),
                    password
                })
            });
            return readResponse(response);
        });
        if (!result) return;

        createdUsername = result.user.username;
        recoveryCodes = result.recoveryCodes;
        const list = $("#recovery-code-list");
        list.replaceChildren();
        recoveryCodes.forEach((code) => {
            const item = document.createElement("li");
            const codeElement = document.createElement("code");
            codeElement.textContent = code;
            item.append(codeElement);
            list.append(item);
        });
        $("#recovery-codes-saved").checked = false;
        $("#finish-signup").disabled = true;
        $("#signup-form").reset();
        showScreen("codes");
        showMessage("Account created. Save your recovery codes before continuing.", false);
    });

    $("#recovery-codes-saved").addEventListener("change", (event) => {
        $("#finish-signup").disabled = !event.currentTarget.checked;
    });
    $("#copy-recovery-codes").addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(recoveryCodes.join("\n"));
            showMessage("Recovery codes copied. Store them somewhere private and safe.", false);
        } catch (error) {
            showMessage(`Could not copy the codes: ${error.message}. You can select and copy them manually.`);
        }
    });
    $("#finish-signup").addEventListener("click", () => {
        if (!$("#recovery-codes-saved").checked) return;
        recoveryCodes = [];
        $("#recovery-code-list").replaceChildren();
        showScreen("login");
        showMessage("Your account is ready. Log in with your username and password.", false);
        $("#login-username").value = createdUsername;
        $("#login-username").focus();
    });

    $("#recovery-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        if ($("#reset-password").value !== $("#reset-password-confirm").value) {
            showMessage("The passwords do not match.");
            $("#reset-password-confirm").focus();
            return;
        }
        const submitButton = form.querySelector("button[type='submit']");
        submitButton.disabled = true;
        showMessage("");
        try {
            const response = await fetch("/api/users/password/reset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({
                    username: $("#recovery-username").value.trim(),
                    recoveryCode: $("#recovery-code").value.trim(),
                    password: $("#reset-password").value
                })
            });
            const result = await readResponse(response);
            form.reset();
            showScreen("login");
            showMessage(result.message, false);
        } catch (error) {
            showMessage(error.message);
        } finally {
            submitButton.disabled = false;
        }
    });

    $("#logout-button").addEventListener("click", async () => {
        const button = $("#logout-button");
        button.disabled = true;
        try {
            const response = await fetch("/api/users/logout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: "{}"
            });
            await readResponse(response);
            window.location.reload();
        } catch (error) {
            $("#app-notice").textContent = `Could not log out: ${error.message}`;
        } finally {
            button.disabled = false;
        }
    });

    async function restoreSession() {
        try {
            const response = await fetch("/api/users/me", { credentials: "same-origin" });
            if (response.status === 401) {
                authPage.hidden = false;
                showScreen("login");
                return;
            }
            const result = await readResponse(response);
            showCoffeeLab(result.user);
        } catch (error) {
            authPage.hidden = false;
            showScreen("login");
            showMessage(`Could not verify your session: ${error.message} Try logging in or reload this page.`);
        }
    }

    restoreSession();
})();
