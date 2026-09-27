const assistantPanel = document.getElementById('chat-container');
const assistantButton = document.getElementById('open-assistant');
const assistantInput = document.getElementById('chat-input');
const messageHistory = document.getElementById('chat-history');
function setAssistantOpen(open) {
    assistantPanel.hidden = !open;
    assistantButton.setAttribute('aria-expanded', String(open));
    if (open) assistantInput.focus({preventScroll:true});
    else if(window.CampusUI)window.CampusUI.activate('explore');
    else assistantButton.focus();
}

assistantButton.addEventListener('click', () => setAssistantOpen(assistantPanel.hidden));
document.getElementById('close-assistant').addEventListener('click', () => setAssistantOpen(false));
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !window.CampusUI && !assistantPanel.hidden) setAssistantOpen(false);
});

function addMessage(text, className) {
    const message = document.createElement('div');
    message.className = `assistant-message ${className}`;
    message.textContent = text;
    messageHistory.append(message);
    messageHistory.scrollTop = messageHistory.scrollHeight;
    return message;
}

document.getElementById('assistant-form').addEventListener('submit', async event => {
    event.preventDefault();
    const message = assistantInput.value.trim();
    if (!message) return;
    addMessage(message, 'from-user');
    assistantInput.value = '';
    const formButton = event.currentTarget.querySelector('button');
    formButton.disabled = true;
    const pending = addMessage('Thinking…', 'from-assistant');
    try {
        // The existing Python service runs locally; this UI also works without it.
        const endpoint = window.CAMPUS_ASSISTANT_URL || (['localhost','127.0.0.1'].includes(location.hostname) ? 'http://127.0.0.1:5000/chat' : '/api/chat');
        const response = await fetch(endpoint, {
            signal: AbortSignal.timeout(20000),
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });
        if (!response.ok) throw new Error('Chat service unavailable');
        const data = await response.json();
        const reply=typeof data.reply === 'string' ? data.reply : 'I could not find an answer.';
        // Markdown is rendered only after sanitizing the model's HTML output.
        pending.textContent = reply;
        if (window.marked && window.DOMPurify?.isSupported) {
            try {
                const html = window.marked.parse(reply, { gfm: true, breaks: true });
                const content = window.DOMPurify.sanitize(html, {
                    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'ul', 'ol', 'li',
                        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code',
                        'a', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
                    ALLOWED_ATTR: ['href', 'title', 'start'],
                    ALLOW_DATA_ATTR: false,
                    ALLOW_ARIA_ATTR: false,
                    RETURN_DOM_FRAGMENT: true,
                });
                pending.replaceChildren(content);
                pending.classList.add('is-markdown');
            } catch {
                // Keep a readable reply even if Markdown rendering is unavailable.
                pending.textContent = reply;
            }
        }
    } catch {
        pending.textContent = 'The assistant is unavailable right now. Your message is saved above. Please try again shortly.';
        const retry=document.createElement('button');retry.type='button';retry.textContent='Try again';retry.className='cu-assistant-retry';
        retry.addEventListener('click',()=>{assistantInput.value=message;document.getElementById('assistant-form').requestSubmit();retry.remove();});pending.append(retry);
    } finally {
        formButton.disabled = false;
        messageHistory.scrollTop = messageHistory.scrollHeight;
        if(!window.CampusUI||window.CampusUI.getState().tab==='assistant')assistantInput.focus({preventScroll:true});
    }
});
