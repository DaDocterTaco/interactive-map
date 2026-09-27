

const assistantPanel = document.getElementById('chat-container');
const assistantButton = document.getElementById('open-assistant');
const assistantInput = document.getElementById('chat-input');
const messageHistory = document.getElementById('chat-history');
function setAssistantOpen(open) {
    assistantPanel.hidden = !open;
    assistantButton.setAttribute('aria-expanded', String(open));
    if (open) assistantInput.focus();
    else assistantButton.focus();
}

assistantButton.addEventListener('click', () => setAssistantOpen(assistantPanel.hidden));
document.getElementById('close-assistant').addEventListener('click', () => setAssistantOpen(false));
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !assistantPanel.hidden) setAssistantOpen(false);
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
        const response = await fetch('http://127.0.0.1:5000/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });
        if (!response.ok) throw new Error('Chat service unavailable');
        const data = await response.json();
        pending.innerHTML = typeof data.reply === 'string' ? marked.parse(data.reply) : 'I could not find an answer.';
    } catch {
        pending.textContent = 'The assistant is unavailable. Start the Python chat server and try again.';
    } finally {
        formButton.disabled = false;
        messageHistory.scrollTop = messageHistory.scrollHeight;
        assistantInput.focus();
    }
});
