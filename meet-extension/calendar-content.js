// Luna 2.0 Google Calendar Integration Content Script

function checkAndInjectButton() {
    // Look for Google Calendar event details popover cards
    const dialogs = document.querySelectorAll('div[role="dialog"]');
    
    dialogs.forEach(dialog => {
        // Find Google Meet link inside the card
        const meetLink = dialog.querySelector('a[href^="https://meet.google.com/"]');
        if (!meetLink) return;

        // Verify if we have already injected our button
        if (dialog.querySelector('.send-luna-cal-btn')) return;

        console.log("[Luna 2.0 Calendar] Found Google Meet link:", meetLink.href);

        // Find the container to append our button next to
        // Meet buttons usually sit inside a block with other link buttons
        const buttonParent = meetLink.parentElement;
        if (!buttonParent) return;

        // Create the Send Luna 2.0 button
        const btn = document.createElement('button');
        btn.className = 'send-luna-cal-btn';
        btn.textContent = 'Send Luna 2.0';
        
        // Premium styling matching Luna's brand
        btn.style.background = 'linear-gradient(135deg, #6366f1, #d946ef)';
        btn.style.color = '#ffffff';
        btn.style.border = 'none';
        btn.style.borderRadius = '18px';
        btn.style.padding = '8px 16px';
        btn.style.fontSize = '0.75rem';
        btn.style.fontWeight = '600';
        btn.style.cursor = 'pointer';
        btn.style.marginLeft = '12px';
        btn.style.fontFamily = '"Google Sans", Roboto, Arial, sans-serif';
        btn.style.boxShadow = '0 3px 8px rgba(99, 102, 241, 0.35)';
        btn.style.transition = 'all 0.2s ease';
        btn.style.outline = 'none';

        btn.addEventListener('mouseover', () => {
            btn.style.transform = 'translateY(-1px)';
            btn.style.boxShadow = '0 5px 12px rgba(217, 70, 239, 0.45)';
        });
        btn.addEventListener('mouseout', () => {
            btn.style.transform = 'translateY(0)';
            btn.style.boxShadow = '0 3px 8px rgba(99, 102, 241, 0.35)';
        });

        // Click Handler
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const targetUrl = meetLink.href;
            btn.textContent = 'Sending...';
            btn.disabled = true;
            btn.style.background = '#64748b';

            // Send call to local Node.js API to run Chrome script
            fetch('http://127.0.0.1:8000/api/join-meet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                mode: 'cors',
                body: JSON.stringify({ url: targetUrl })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    btn.textContent = 'Luna 2.0 Sent!';
                    btn.style.background = '#10b981';
                    btn.style.boxShadow = '0 3px 8px rgba(16, 185, 129, 0.4)';
                } else {
                    btn.textContent = 'Failed';
                    btn.style.background = '#ef4444';
                    btn.disabled = false;
                    setTimeout(() => {
                        btn.textContent = 'Send Luna 2.0';
                        btn.style.background = 'linear-gradient(135deg, #6366f1, #d946ef)';
                    }, 3000);
                }
            })
            .catch(err => {
                console.error("[Luna 2.0 Calendar Error] API call failed:", err);
                btn.textContent = 'Offline';
                btn.style.background = '#ef4444';
                btn.disabled = false;
                setTimeout(() => {
                    btn.textContent = 'Send Luna 2.0';
                    btn.style.background = 'linear-gradient(135deg, #6366f1, #d946ef)';
                }, 3000);
            });
        });

        // Insert button right after the Google Meet anchor element
        meetLink.insertAdjacentElement('afterend', btn);
    });
}

// Watch DOM for popping cards using MutationObserver
const observer = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
        if (mutation.addedNodes && mutation.addedNodes.length > 0) {
            checkAndInjectButton();
        }
    });
});

observer.observe(document.body, { childList: true, subtree: true });

// Run check on initial script load in case dialog is already open
checkAndInjectButton();
