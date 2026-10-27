import { useState, type FormEvent } from "react";
import { Bot, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { BACKEND_URL } from "../lib/api";
import { TOKEN_KEY } from "../lib/authToken";

type ChatMessage = { role: "user" | "assistant"; text: string };
export default function CampusChatbot() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: "Hi! I’m CampusSync Assistant. Ask me about your timetable, attendance, or scheduling tools." }
  ]);
  if (!user) return null;
  const prompts = user.role === "student"
    ? ["Show my timetable", "Summarize my attendance"]
    : user.role === "teacher"
      ? ["Show my timetable", "Summarize my attendance"]
      : ["Validate timetable conflicts", "How can I recover a schedule?"];
  const send = async (event?: FormEvent, supplied?: string) => {
    event?.preventDefault();
    const message = (supplied ?? input).trim();
    if (!message || busy) return;
    setMessages(old => [...old, { role: "user", text: message }]);
    setInput(""); setBusy(true);
    try {
      if (!BACKEND_URL) throw new Error("AI Assistant needs the backend. Set VITE_API_URL in .env and start the API server.");
      const token = localStorage.getItem(TOKEN_KEY);
      const response = await fetch(`${BACKEND_URL}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ message })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Assistant request failed (${response.status}).`);
      setMessages(old => [...old, { role: "assistant", text: payload.answer || "I couldn't find an answer in the available campus data." }]);
    } catch (e) {
      setMessages(old => [...old, { role: "assistant", text: e instanceof Error ? e.message : "Could not reach CampusSync Assistant." }]);
    } finally { setBusy(false); }
  };
  return <div className="campus-chatbot">
    {open && <section className="chat-window" aria-label="CampusSync AI assistant">
      <header className="chat-header"><span className="chat-avatar"><Bot size={20}/></span><div><strong>CampusSync AI</strong><small>{user.role[0].toUpperCase()+user.role.slice(1)} assistant · role protected</small></div><button type="button" className="chat-close" aria-label="Close assistant" onClick={() => setOpen(false)}><X size={18}/></button></header>
      <div className="chat-messages" aria-live="polite">
        {messages.map((m,i)=><div key={i} className={`chat-message ${m.role}`}><span>{m.role==="assistant" ? <Bot size={15}/> : "You"}</span><p>{m.text}</p></div>)}
        {busy && <div className="chat-typing"><span className="typing-dot"/><span className="typing-dot"/><span className="typing-dot"/> Checking campus data…</div>}
      </div>
      <div className="chat-prompts">{prompts.map(p=><button key={p} type="button" onClick={() => void send(undefined,p)} disabled={busy}>{p}</button>)}</div>
      <form className="chat-input-row" onSubmit={e => void send(e)}><input aria-label="Ask CampusSync" placeholder="Ask CampusSync…" value={input} onChange={e=>setInput(e.target.value)} maxLength={1000}/><button type="submit" aria-label="Send message" disabled={busy || !input.trim()}><Send size={17}/></button></form>
      <p className="chat-disclaimer"><Sparkles size={12}/> Answers use role-authorized CampusSync data.</p>
    </section>}
    <button type="button" className={`chat-launcher ${open ? "is-open" : ""}`} onClick={() => setOpen(v=>!v)} aria-label={open ? "Close AI assistant" : "Open AI assistant"}>{open ? <X size={22}/> : <><MessageCircle size={21}/><span>Ask AI</span></>}</button>
  </div>;
}
