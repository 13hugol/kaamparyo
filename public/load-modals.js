// Load shared modals into the page
(function() {
    fetch('/modals.html')
        .then(response => response.text())
        .then(html => {
            const modalsContainer = document.createElement('div');
            modalsContainer.innerHTML = html;
            document.body.appendChild(modalsContainer);
            
            console.log('[Modals] Loaded successfully');
            
            // Dispatch event to notify that modals are loaded
            const event = new CustomEvent('modalsLoaded');
            window.dispatchEvent(event);
            
            // Also call attachModalHandlers if it exists
            if (typeof window.attachModalHandlers === 'function') {
                window.attachModalHandlers();
            }
            
            // Attach task form handler
            if (typeof window.attachTaskFormHandler === 'function') {
                window.attachTaskFormHandler();
            }
        })
        .catch(error => {
            console.error('Failed to load modals:', error);
        });
})();
