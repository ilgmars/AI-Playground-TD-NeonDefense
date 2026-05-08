// No-retire injection script.
// Runs via page.addInitScript to disable the retire bonus entirely.
// The retire button is hidden and the retire path is stubbed out.

// Mark that retire is disabled for any code that checks.
window._NO_RETIRE = true;

// Wait for DOM to be ready, then patch retire UI and handlers.
(function() {
    const checkAndPatch = () => {
        const retireBtn = document.getElementById('retire-btn');
        const retireConfirm = document.getElementById('retire-confirm');

        if (retireBtn) retireBtn.classList.add('hidden');
        if (retireConfirm) retireConfirm.classList.add('hidden');

        // Remove any existing retire click handler by cloning the button
        // (removes all event listeners).
        if (retireBtn && retireBtn.parentNode) {
            const newBtn = retireBtn.cloneNode(true);
            retireBtn.parentNode.replaceChild(newBtn, retireBtn);
        }
    };

    // Run immediately if DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkAndPatch);
    } else {
        checkAndPatch();
    }

    // Also run periodically in case elements are added dynamically
    const interval = setInterval(() => {
        const retireBtn = document.getElementById('retire-btn');
        if (retireBtn && !retireBtn.classList.contains('hidden')) {
            retireBtn.classList.add('hidden');
        }
    }, 1000);

    // Stop checking after 10s (game should be loaded by then)
    setTimeout(() => clearInterval(interval), 10000);
})();
